import "./styles.css";
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { MindARThree } from "mind-ar/dist/mindar-image-three.prod.js";
import { fetchActiveCards } from "../shared/api";
import { loadMapAspectRatio, mapXYToAnchorPosition } from "../shared/geo";
import { DEFAULT_MAP_ASPECT_RATIO, MAP_REFERENCE_PATH, MAP_TARGET_PATH } from "../shared/types";
import type { InfoCard } from "../shared/types";

// How close (in normalized device coordinates) the screen-center crosshair must
// be to a card anchor for that card to expand. ~8% of the map width.
const POINT_THRESHOLD = 0.12;
const SHEET_OPEN_DELAY_MS = 1500;
const SHEET_SWIPE_DISMISS_PX = 72;

interface CardOverlay {
  card: InfoCard;
  markerObject: CSS2DObject;
  panelObject: CSS2DObject;
  marker: HTMLDivElement;
  panel: HTMLDivElement;
}

export function initArViewer(root: HTMLElement): void {
  root.innerHTML = `
    <div class="ar-app">
      <div id="ar-container" class="ar-container"></div>
      <div class="ar-ui">
        <div class="ar-instructions">
          <header class="ar-header">
            <h1>NL World Map AR</h1>
            <p class="ar-subtitle">Point your phone at the wall map</p>
          </header>
          <div id="ar-status" class="ar-status">Loading cards…</div>
          <div id="ar-hint" class="ar-hint">Aim the crosshair at a location on the map to reveal impact stories.</div>
        </div>
        <button id="ar-start" class="ar-btn" disabled>Start AR</button>
        <div class="ar-crosshair" aria-hidden="true"></div>
      </div>
      <div id="ar-sheet-backdrop" class="ar-sheet-backdrop" hidden aria-hidden="true"></div>
      <aside id="ar-sheet" class="ar-sheet" hidden aria-hidden="true" role="dialog" aria-modal="true">
        <div class="ar-sheet__handle" aria-hidden="true">
          <span class="ar-sheet__grabber"></span>
        </div>
        <div id="ar-sheet-content" class="ar-sheet__body"></div>
      </aside>
    </div>
  `;

  const container = root.querySelector("#ar-container") as HTMLElement;
  const startBtn = root.querySelector("#ar-start") as HTMLButtonElement;
  const statusEl = root.querySelector("#ar-status") as HTMLElement;

  let mindarThree: InstanceType<typeof MindARThree> | null = null;
  let cssRenderer: CSS2DRenderer | null = null;
  let overlays: CardOverlay[] = [];
  let aspectRatio = DEFAULT_MAP_ASPECT_RATIO;
  let tracking = false;
  let sheetTimer: ReturnType<typeof setTimeout> | null = null;
  let loseTargetTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSheetCardId: string | null = null;
  let activeCardTracker: ActiveCardTracker | null = null;
  const arApp = root.querySelector(".ar-app") as HTMLElement;

  const sheetBackdrop = root.querySelector("#ar-sheet-backdrop") as HTMLElement;
  const sheetEl = root.querySelector("#ar-sheet") as HTMLElement;
  const sheetContent = root.querySelector("#ar-sheet-content") as HTMLElement;
  const detailSheet = createCardDetailSheet(sheetBackdrop, sheetEl, sheetContent, {
    onOpen: () => arApp.classList.add("ar-app--sheet-open"),
    onDismiss: () => {
      clearSheetTimers();
      pendingSheetCardId = null;
      arApp.classList.remove("ar-app--sheet-open");
    },
  });

  setupLandscapeAndFullscreen(arApp);

  void bootstrap();

  async function bootstrap(): Promise<void> {
    try {
      aspectRatio = await loadMapAspectRatio(MAP_REFERENCE_PATH, DEFAULT_MAP_ASPECT_RATIO);

      const mindResponse = await fetch(MAP_TARGET_PATH, { method: "HEAD" });
      if (!mindResponse.ok) {
        statusEl.textContent = "Missing map-target.mind. Run `npm run compile-target` first.";
        return;
      }

      await fetchActiveCards();
      statusEl.textContent = "Ready. Tap Start AR and point at the map.";
      startBtn.disabled = false;
    } catch {
      statusEl.textContent = "Could not load cards. Check your connection.";
    }

    startBtn.addEventListener("click", () => {
      void startAr();
    });
  }

  async function startAr(): Promise<void> {
    if (mindarThree) return;

    startBtn.disabled = true;
    statusEl.textContent = "Starting camera…";

    let cards: InfoCard[];
    try {
      cards = await fetchActiveCards();
    } catch {
      statusEl.textContent = "Could not load cards. Check your connection.";
      startBtn.disabled = false;
      return;
    }

    mindarThree = new MindARThree({
      container,
      imageTargetSrc: MAP_TARGET_PATH,
      uiScanning: false,
      uiLoading: false,
      filterMinCF: 0.0001,
      filterBeta: 5000,
      missTolerance: 5,
      warmupTolerance: 5,
    });

    const { renderer, scene, camera } = mindarThree;
    const anchor = mindarThree.addAnchor(0);
    anchor.onTargetFound = () => {
      tracking = true;
    };
    anchor.onTargetLost = () => {
      tracking = false;
    };

    cssRenderer = new CSS2DRenderer();
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
    cssRenderer.domElement.className = "ar-css-renderer";
    container.appendChild(cssRenderer.domElement);

    overlays = cards.map((card) => createCardOverlay(card, aspectRatio));
    overlays.forEach(({ markerObject, panelObject }) => {
      anchor.group.add(markerObject);
      anchor.group.add(panelObject);
    });

    activeCardTracker = createActiveCardTracker(detailSheet);

    const onPopState = (): void => {
      if (detailSheet.isOpen()) {
        detailSheet.dismissFromHistory();
        activeCardTracker?.resetSheetTimer();
      }
    };
    window.addEventListener("popstate", onPopState);

    const resize = (): void => {
      cssRenderer?.setSize(container.clientWidth, container.clientHeight);
      updateLandscapeClass(arApp);
    };
    window.addEventListener("resize", resize);

    try {
      await mindarThree.start();
      root.querySelector(".ar-header")?.classList.add("ar-header--compact");
      arApp.classList.add("ar-app--running");
      updateLandscapeClass(arApp);
      void requestAppFullscreen();
    } catch {
      statusEl.textContent = "Camera access denied or not supported.";
      startBtn.disabled = false;
      window.removeEventListener("popstate", onPopState);
      return;
    }

    renderer.setAnimationLoop(() => {
      updateTrackingUI(statusEl, tracking);
      const activeCard = updatePointing(overlays, camera, detailSheet.isOpen());
      activeCardTracker?.handleActiveCard(activeCard);
      cssRenderer?.render(scene, camera);
      renderer.render(scene, camera);
    });
  }

  function clearSheetTimers(): void {
    if (sheetTimer !== null) {
      clearTimeout(sheetTimer);
      sheetTimer = null;
    }
    if (loseTargetTimer !== null) {
      clearTimeout(loseTargetTimer);
      loseTargetTimer = null;
    }
  }

  function createActiveCardTracker(sheet: CardDetailSheet): ActiveCardTracker {
    return {
      handleActiveCard(activeCard: InfoCard | null): void {
        if (sheet.isOpen()) {
          return;
        }

        if (!activeCard) {
          if (pendingSheetCardId && loseTargetTimer === null) {
            loseTargetTimer = setTimeout(() => {
              loseTargetTimer = null;
              clearSheetTimers();
              pendingSheetCardId = null;
            }, 500);
          }
          return;
        }

        if (loseTargetTimer !== null) {
          clearTimeout(loseTargetTimer);
          loseTargetTimer = null;
        }

        if (pendingSheetCardId !== activeCard.id) {
          if (sheetTimer !== null) {
            clearTimeout(sheetTimer);
            sheetTimer = null;
          }
          pendingSheetCardId = activeCard.id;
          sheetTimer = setTimeout(() => {
            sheetTimer = null;
            if (pendingSheetCardId === activeCard.id && !sheet.isOpen()) {
              sheet.show(activeCard);
            }
          }, SHEET_OPEN_DELAY_MS);
        }
      },
      resetSheetTimer(): void {
        clearSheetTimers();
        pendingSheetCardId = null;
      },
    };
  }
}

function createCardOverlay(card: InfoCard, aspectRatio: number): CardOverlay {
  const pos = mapXYToAnchorPosition(card.mapX, card.mapY, aspectRatio);

  const markerHost = document.createElement("div");
  markerHost.className = "ar-card-marker-host";

  const marker = document.createElement("div");
  marker.className = "ar-card__marker";
  markerHost.append(marker);

  const panelHost = document.createElement("div");
  panelHost.className = "ar-card-panel-host";

  const panel = document.createElement("div");
  panel.className = "ar-card__panel";
  panel.innerHTML = buildCardContentHtml(card);
  panelHost.append(panel);

  const markerObject = new CSS2DObject(markerHost);
  markerObject.position.set(pos.x, pos.y, 0);
  markerObject.renderOrder = 0;

  const panelObject = new CSS2DObject(panelHost);
  panelObject.position.set(pos.x, pos.y, 0);
  panelObject.renderOrder = 1;

  return { card, markerObject, panelObject, marker, panel };
}

function updateTrackingUI(statusEl: HTMLElement, tracking: boolean): void {
  if (tracking) {
    statusEl.textContent = "Map detected. Aim at a location.";
    statusEl.classList.add("ar-status--tracking");
  } else {
    statusEl.textContent = "Point your camera at the map on the wall.";
    statusEl.classList.remove("ar-status--tracking");
  }
}

/** Project each card to screen space and expand the one nearest the crosshair. */
function updatePointing(
  overlays: CardOverlay[],
  camera: THREE.Camera,
  sheetOpen: boolean
): InfoCard | null {
  const center = new THREE.Vector2(0, 0);
  const projected = new THREE.Vector3();
  let closest: { id: string; distance: number } | null = null;

  for (const overlay of overlays) {
    overlay.markerObject.getWorldPosition(projected);
    projected.project(camera);

    // Skip anchors behind the camera.
    if (projected.z > 1) continue;

    const distance = center.distanceTo(new THREE.Vector2(projected.x, projected.y));
    if (distance < POINT_THRESHOLD && (!closest || distance < closest.distance)) {
      closest = { id: overlay.card.id, distance };
    }
  }

  const nextActive = closest?.id ?? null;

  for (const overlay of overlays) {
    const isActive = overlay.card.id === nextActive;
    overlay.markerObject.visible = !sheetOpen;
    overlay.marker.classList.toggle("ar-card__marker--active", isActive && !sheetOpen);
    overlay.panel.classList.toggle("ar-card__panel--visible", isActive && !sheetOpen);
  }

  return overlays.find((overlay) => overlay.card.id === nextActive)?.card ?? null;
}

interface ActiveCardTracker {
  handleActiveCard: (activeCard: InfoCard | null) => void;
  resetSheetTimer: () => void;
}

interface CardDetailSheet {
  show: (card: InfoCard) => void;
  dismiss: () => void;
  dismissFromHistory: () => void;
  isOpen: () => boolean;
  getCardId: () => string | null;
}

function buildCardContentHtml(card: InfoCard): string {
  return `
    <strong class="ar-card__title">${escapeHtml(card.title)}</strong>
    ${card.companyName ? `<span class="ar-card__company">${escapeHtml(card.companyName)}</span>` : ""}
    ${card.address ? `<span class="ar-card__address">${escapeHtml(card.address)}</span>` : ""}
    ${card.imageUrl ? `<img class="ar-card__image" src="${escapeAttr(card.imageUrl)}" alt="" />` : ""}
    <p class="ar-card__body">${escapeHtml(card.body)}</p>
    ${card.linkUrl ? `<a class="ar-card__link" href="${escapeAttr(card.linkUrl)}" target="_blank" rel="noopener noreferrer">Learn more</a>` : ""}
  `;
}

function createCardDetailSheet(
  backdrop: HTMLElement,
  sheet: HTMLElement,
  content: HTMLElement,
  callbacks: { onOpen: () => void; onDismiss: () => void }
): CardDetailSheet {
  const handle = sheet.querySelector(".ar-sheet__handle") as HTMLElement;
  let open = false;
  let cardId: string | null = null;
  let historyPushed = false;
  let dragStartY = 0;
  let dragOffset = 0;
  let dragging = false;
  let dragPointerId: number | null = null;

  const clearSheetTransform = (): void => {
    sheet.style.removeProperty("transform");
  };

  const setSheetDragOffset = (offsetPx: number): void => {
    sheet.style.transform = `translateY(${offsetPx}px)`;
  };

  const showSheet = (): void => {
    backdrop.hidden = false;
    sheet.hidden = false;
    backdrop.setAttribute("aria-hidden", "false");
    sheet.setAttribute("aria-hidden", "false");
    clearSheetTransform();
    requestAnimationFrame(() => {
      backdrop.classList.add("ar-sheet-backdrop--visible");
      sheet.classList.add("ar-sheet--visible");
      sheet.classList.remove("ar-sheet--dragging");
    });
  };

  const hideSheet = (): void => {
    backdrop.classList.remove("ar-sheet-backdrop--visible");
    sheet.classList.remove("ar-sheet--visible", "ar-sheet--dragging");
    clearSheetTransform();
    backdrop.setAttribute("aria-hidden", "true");
    sheet.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
      if (!open) {
        backdrop.hidden = true;
        sheet.hidden = true;
      }
    }, 300);
  };

  const dismissInternal = (fromHistory: boolean): void => {
    if (!open) return;
    open = false;
    cardId = null;
    hideSheet();
    if (!fromHistory && historyPushed) {
      historyPushed = false;
      history.back();
    } else if (fromHistory) {
      historyPushed = false;
    }
    callbacks.onDismiss();
  };

  backdrop.addEventListener("click", () => dismissInternal(false));

  const canStartDrag = (target: EventTarget | null): boolean => {
    if (target instanceof Element && target.closest(".ar-sheet__body")) {
      return content.scrollTop <= 0;
    }
    return true;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!open || !canStartDrag(event.target)) return;
    dragging = true;
    dragPointerId = event.pointerId;
    dragStartY = event.clientY;
    dragOffset = 0;
    sheet.classList.add("ar-sheet--dragging");
    sheet.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || dragPointerId !== event.pointerId) return;
    dragOffset = Math.max(0, event.clientY - dragStartY);
    setSheetDragOffset(dragOffset);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging || dragPointerId !== event.pointerId) return;
    dragging = false;
    dragPointerId = null;
    sheet.releasePointerCapture(event.pointerId);
    if (dragOffset >= SHEET_SWIPE_DISMISS_PX) {
      dismissInternal(false);
      return;
    }
    sheet.classList.remove("ar-sheet--dragging");
    clearSheetTransform();
  };

  handle.addEventListener("pointerdown", onPointerDown);
  content.addEventListener("pointerdown", onPointerDown);
  sheet.addEventListener("pointermove", onPointerMove);
  sheet.addEventListener("pointerup", onPointerUp);
  sheet.addEventListener("pointercancel", onPointerUp);

  return {
    show(card: InfoCard): void {
      if (open && cardId === card.id) return;
      cardId = card.id;
      open = true;
      content.innerHTML = buildCardContentHtml(card);
      if (!historyPushed) {
        history.pushState({ arSheet: true }, "");
        historyPushed = true;
      }
      callbacks.onOpen();
      showSheet();
    },
    dismiss(): void {
      dismissInternal(false);
    },
    dismissFromHistory(): void {
      dismissInternal(true);
    },
    isOpen(): boolean {
      return open;
    },
    getCardId(): string | null {
      return cardId;
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function updateLandscapeClass(app: HTMLElement): boolean {
  const landscape = window.innerWidth > window.innerHeight;
  app.classList.toggle("ar-app--landscape", landscape);
  return landscape;
}

function setupLandscapeAndFullscreen(app: HTMLElement): void {
  const sync = (): void => {
    const landscape = updateLandscapeClass(app);
    if (landscape) {
      void requestAppFullscreen();
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  };

  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", () => window.setTimeout(sync, 150));
  sync();
}

async function requestAppFullscreen(): Promise<void> {
  if (document.fullscreenElement) return;
  const root = document.documentElement;
  try {
    if (root.requestFullscreen) {
      await root.requestFullscreen();
      return;
    }
    const webkitRequest = (root as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> })
      .webkitRequestFullscreen;
    if (webkitRequest) {
      await webkitRequest.call(root);
    }
  } catch {
    // Fullscreen may require a fresh user gesture or is unsupported (e.g. iOS Safari).
  }
}
