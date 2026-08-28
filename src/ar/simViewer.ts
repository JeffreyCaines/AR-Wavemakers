import "./styles.css";
import "./simViewer.css";
import "../admin/styles.css";
import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { fetchActiveCards, fetchRipplesAnchorConfig } from "../shared/api";
import { loadMapAspectRatio } from "../shared/geo";
import { isPinRevealed, isStJohnsCard } from "../shared/ripplesReveal";
import { getRipplesSimDurationSec, RIPPLE_MASK_HEIGHT, RIPPLE_MASK_WIDTH } from "../shared/ripplesSim";
import {
  DEFAULT_MAP_ASPECT_RATIO,
  DEFAULT_RIPPLES_ANCHOR,
  getActiveRipplesPlacement,
  MAP_REFERENCE_PATH,
} from "../shared/types";
import type { CardType, InfoCard, RipplesAnchor } from "../shared/types";
import { buildArChromeHtml, wireArChrome, type ArChromeController } from "./chromeUi";
import { createRipplesEffect, type RipplesEffect } from "./ripplesEffect";
import { playArSound, preloadArSounds, stopArSound, unlockArSounds } from "./sounds";
import {
  applyPinVisibility,
  createActiveCardTracker,
  createCardDetailSheet,
  createOverlaysFromCards,
  pinUnlockTimingOffset,
  removeOverlaysFromParent,
  RIPPLES_REVEAL_DELAY_MS,
  updatePointing,
  updateTrackingUI,
  type ActiveCardTracker,
  type CardOverlay,
} from "./viewerShared";

const RIPPLE_MASK_SIZE = { width: RIPPLE_MASK_WIDTH, height: RIPPLE_MASK_HEIGHT };

const ORIENTATION_STORAGE_KEY = "ar_preview_orientation";
const MAP_DISTANCE = 0.85;
const DRAG_SENSITIVITY = 0.002;
const MARKER_SIZE_PX = 18;
/** Hit radius = 1.25× dot diameter, measured from crosshair to marker center. */
const POINT_TARGET_RADIUS_PX = (MARKER_SIZE_PX * 1.25) / 2;

type SimOrientation = "portrait" | "landscape";

let pullToRefreshPrevented = false;

function enableArPreviewPullToRefreshGuard(): void {
  if (pullToRefreshPrevented) return;
  pullToRefreshPrevented = true;
  document.documentElement.classList.add("ar-preview-active");
  document.addEventListener("touchmove", preventArPreviewPullToRefresh, { passive: false });
}

function isScrollableSheetTouch(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const sheetBody = target.closest(".ar-sheet__body");
  if (sheetBody instanceof HTMLElement && sheetBody.scrollHeight > sheetBody.clientHeight) {
    return true;
  }
  const chromeScroll = target.closest(".ar-chrome__results, .ar-chrome__filter-props");
  if (chromeScroll instanceof HTMLElement && chromeScroll.scrollHeight > chromeScroll.clientHeight) {
    return true;
  }
  return false;
}

function preventArPreviewPullToRefresh(event: TouchEvent): void {
  if (isScrollableSheetTouch(event.target)) return;
  event.preventDefault();
}

export function initArSimViewer(root: HTMLElement): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f3f6fb");
  enableArPreviewPullToRefreshGuard();

  const initialOrientation = loadOrientation();

  root.innerHTML = `
    <div class="ar-sim">
      <div class="ar-sim__chrome">
        <button type="button" id="ar-sim-replay-ripples" class="admin-btn--pill">
          Replay ripples
        </button>
        <button type="button" id="ar-sim-orientation-toggle" class="admin-btn--pill" aria-pressed="false">
          Switch to landscape
        </button>
      </div>
      <p class="ar-sim__hint">Drag inside the phone frame to move around the map. Use Replay ripples to re-run pin reveals.</p>
      <div class="ar-sim__stage">
        <div id="ar-sim-device" class="ar-sim-device ar-sim-device--${initialOrientation}">
          <div class="ar-app ar-app--running ar-app--sim">
            <div id="ar-container" class="ar-container"></div>
            <div class="ar-ui">
              <div class="ar-instructions">
                <header class="ar-header ar-header--compact">
                  <p class="ar-subtitle">Desktop preview</p>
                </header>
                <div id="ar-status" class="ar-status ar-status--tracking">Loading…</div>
              </div>
              <div class="ar-crosshair" aria-hidden="true"></div>
            </div>
            ${buildArChromeHtml()}
            <div id="ar-sheet-backdrop" class="ar-sheet-backdrop" hidden aria-hidden="true"></div>
            <aside id="ar-sheet" class="ar-sheet" hidden aria-hidden="true" role="dialog" aria-modal="true">
              <div class="ar-sheet__handle" aria-hidden="true">
                <span class="ar-sheet__grabber"></span>
              </div>
              <div id="ar-sheet-content" class="ar-sheet__body"></div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  `;

  const deviceEl = root.querySelector("#ar-sim-device") as HTMLElement;
  const orientationToggle = root.querySelector("#ar-sim-orientation-toggle") as HTMLButtonElement;
  const replayBtn = root.querySelector("#ar-sim-replay-ripples") as HTMLButtonElement;
  const container = root.querySelector("#ar-container") as HTMLElement;
  const statusEl = root.querySelector("#ar-status") as HTMLElement;
  const arApp = root.querySelector(".ar-app") as HTMLElement;

  let orientation: SimOrientation = initialOrientation;
  applyOrientationClasses(deviceEl, arApp, orientation);
  updateOrientationToggleLabel(orientationToggle, orientation);

  orientationToggle.addEventListener("click", () => {
    orientation = orientation === "portrait" ? "landscape" : "portrait";
    saveOrientation(orientation);
    applyOrientationClasses(deviceEl, arApp, orientation);
    updateOrientationToggleLabel(orientationToggle, orientation);
    onResize();
  });

  const sheetBackdrop = root.querySelector("#ar-sheet-backdrop") as HTMLElement;
  const sheetEl = root.querySelector("#ar-sheet") as HTMLElement;
  const sheetContent = root.querySelector("#ar-sheet-content") as HTMLElement;
  const detailSheet = createCardDetailSheet(sheetBackdrop, sheetEl, sheetContent, {
    onOpen: () => {
      arApp.classList.add("ar-app--sheet-open");
      syncChromeVisibility();
    },
    onDismiss: () => {
      activeCardTracker?.resetSheetTimer();
      arApp.classList.remove("ar-app--sheet-open");
      syncChromeVisibility();
    },
  });

  let activeCardTracker: ActiveCardTracker | null = null;
  let overlays: CardOverlay[] = [];
  let allCards: InfoCard[] = [];
  let cardTypeFilter: CardType = "organization";
  let chromeUi: ArChromeController | null = null;
  let aspectRatio = DEFAULT_MAP_ASPECT_RATIO;
  let renderer: THREE.WebGLRenderer | null = null;
  let cssRenderer: CSS2DRenderer | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let scene: THREE.Scene | null = null;
  let anchorGroup: THREE.Group | null = null;

  let ripplesEffect: RipplesEffect | null = null;
  let ripplesAnchor: RipplesAnchor = { ...DEFAULT_RIPPLES_ANCHOR };
  let ripplesShowGeneration = 0;
  let ripplesTimer: ReturnType<typeof setTimeout> | null = null;
  let pinsFullyRevealed = false;
  let allowPinTargeting = false;
  /** Sim treats the map as always tracked once the scene is ready. */
  let tracking = false;

  let cameraYaw = 0;
  let cameraPitch = 0;
  let maxCameraYaw = Math.PI / 4;
  let maxCameraPitch = Math.PI / 4;
  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartYaw = 0;
  let dragStartPitch = 0;

  function visibleCards(): InfoCard[] {
    return chromeUi ? chromeUi.filterCards(allCards) : allCards;
  }

  function syncChromeVisibility(): void {
    const visible = tracking && !detailSheet.isOpen();
    chromeUi?.setVisible(visible);
    arApp.classList.toggle("ar-app--chrome", visible);
  }

  const onPopState = (): void => {
    if (detailSheet.isOpen()) {
      detailSheet.dismissFromHistory();
      activeCardTracker?.resetSheetTimer();
    }
  };
  window.addEventListener("popstate", onPopState);

  replayBtn.addEventListener("click", () => {
    unlockArSounds();
    replayRipplesReveal();
  });

  function cardIsRevealedAt(card: InfoCard, elapsedSec: number | null): boolean {
    if (pinsFullyRevealed) return true;
    if (!tracking) return isStJohnsCard(card);
    const origin = getActiveRipplesPlacement(ripplesAnchor);
    const playSec = getRipplesSimDurationSec();
    return isPinRevealed(
      card,
      origin,
      elapsedSec,
      playSec,
      ripplesAnchor.activeVariant,
      RIPPLE_MASK_SIZE.width,
      RIPPLE_MASK_SIZE.height,
      false
    );
  }

  function cardIsRevealed(card: InfoCard): boolean {
    return cardIsRevealedAt(card, ripplesEffect?.getElapsedSec() ?? null);
  }

  function syncPinVisibility(): void {
    applyPinVisibility(overlays, detailSheet.isOpen(), cardIsRevealed);
  }

  function clearActivePinVisuals(): void {
    for (const overlay of overlays) {
      overlay.marker.classList.remove("ar-card__marker--active");
      overlay.panel.classList.remove("ar-card__panel--visible");
    }
  }

  function lockPinTargeting(): void {
    allowPinTargeting = false;
    pinsFullyRevealed = false;
    activeCardTracker?.resetSheetTimer();
    clearActivePinVisuals();
    syncPinVisibility();
  }

  function unlockPinTargeting(): void {
    allowPinTargeting = true;
    pinsFullyRevealed = true;
  }

  function rebuildOverlays(): void {
    if (!anchorGroup) return;
    if (detailSheet.isOpen()) {
      detailSheet.dismiss();
      activeCardTracker?.resetSheetTimer();
    }
    removeOverlaysFromParent(overlays, anchorGroup);
    overlays = createOverlaysFromCards(visibleCards(), aspectRatio);
    overlays.forEach(({ markerObject, panelObject }) => {
      anchorGroup!.add(markerObject);
      anchorGroup!.add(panelObject);
    });
    syncPinVisibility();
    clearActivePinVisuals();
    activeCardTracker?.handleActiveOverlay(null);
  }

  function allActivePinsVisibleAt(elapsedSec: number | null): boolean {
    if (overlays.length === 0) return true;
    return overlays.every((overlay) =>
      overlay.group.cards.some((card) => cardIsRevealedAt(card, elapsedSec))
    );
  }

  /**
   * Unlock when all pins are visible, shifted by `pinUnlockTimingOffset` ms
   * (positive = later, negative = earlier).
   */
  function maybeUnlockWhenAllPinsVisible(): void {
    if (allowPinTargeting || pinsFullyRevealed || !tracking) return;
    if (!ripplesEffect?.isPlaying()) return;
    const elapsed = ripplesEffect.getElapsedSec();
    if (elapsed == null) return;
    const adjustedElapsed = elapsed - pinUnlockTimingOffset / 1000;
    if (!allActivePinsVisibleAt(adjustedElapsed)) return;
    unlockPinTargeting();
  }

  function cancelRipplesReveal(): void {
    if (ripplesTimer !== null) {
      clearTimeout(ripplesTimer);
      ripplesTimer = null;
    }
    ripplesShowGeneration += 1;
    stopArSound("pulse");
    ripplesEffect?.stop();
    if (!pinsFullyRevealed) {
      allowPinTargeting = false;
      syncPinVisibility();
      return;
    }
    unlockPinTargeting();
  }

  function startRipplesPlaybackClock(): void {
    if (!tracking || !ripplesEffect) return;
    playArSound("pulse");
    ripplesEffect.start();
    syncPinVisibility();
    maybeUnlockWhenAllPinsVisible();
  }

  function beginSyncedRipplesPlayback(showGeneration: number): void {
    if (!tracking || !ripplesEffect) return;
    if (showGeneration !== ripplesShowGeneration) return;
    ripplesEffect.setVariant(ripplesAnchor.activeVariant);
    const origin = getActiveRipplesPlacement(ripplesAnchor);
    ripplesEffect.setOrigin(origin.mapX, origin.mapY);
    startRipplesPlaybackClock();
  }

  function scheduleRipplesReveal(): void {
    if (!tracking) return;
    if (!ripplesEffect || ripplesTimer !== null || ripplesEffect.isPlaying()) return;

    lockPinTargeting();
    const showGeneration = ripplesShowGeneration;

    ripplesTimer = setTimeout(() => {
      ripplesTimer = null;
      if (showGeneration !== ripplesShowGeneration || !tracking || !ripplesEffect) return;
      beginSyncedRipplesPlayback(showGeneration);
    }, RIPPLES_REVEAL_DELAY_MS);
  }

  function replayRipplesReveal(): void {
    if (!ripplesEffect || !tracking) return;
    if (detailSheet.isOpen()) {
      detailSheet.dismiss();
    }
    cancelRipplesReveal();
    pinsFullyRevealed = false;
    allowPinTargeting = false;
    syncPinVisibility();
    scheduleRipplesReveal();
  }

  function onResize(): void {
    if (!renderer || !cssRenderer || !camera) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    cssRenderer.setSize(width, height);
  }

  function updateCameraView(): void {
    if (!camera) return;
    camera.position.set(0, 0, 0);
    const targetX = Math.tan(cameraYaw) * MAP_DISTANCE;
    const targetY = -Math.tan(cameraPitch) * MAP_DISTANCE;
    camera.lookAt(targetX, targetY, -MAP_DISTANCE);
  }

  function updateViewLimits(mapHeight: number): void {
    const margin = 1.15;
    maxCameraYaw = Math.atan((0.5 * margin) / MAP_DISTANCE);
    maxCameraPitch = Math.atan((mapHeight * 0.5 * margin) / MAP_DISTANCE);
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (detailSheet.isOpen()) return;
    if (chromeUi?.isPanelOpen()) return;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartYaw = cameraYaw;
    dragStartPitch = cameraPitch;
    container.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragPointerId !== event.pointerId) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    cameraYaw = dragStartYaw - dx * DRAG_SENSITIVITY;
    cameraPitch = THREE.MathUtils.clamp(
      dragStartPitch - dy * DRAG_SENSITIVITY,
      -maxCameraPitch,
      maxCameraPitch
    );
    cameraYaw = THREE.MathUtils.clamp(cameraYaw, -maxCameraYaw, maxCameraYaw);
    updateCameraView();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (dragPointerId !== event.pointerId) return;
    container.releasePointerCapture(event.pointerId);
    dragPointerId = null;
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("resize", onResize);

  chromeUi = wireArChrome(root, {
    getCards: () => allCards,
    onCardTypeChange: (type) => {
      if (cardTypeFilter === type) return;
      cardTypeFilter = type;
      rebuildOverlays();
    },
    onFiltersChange: () => {
      rebuildOverlays();
    },
    onSelectCard: (card) => {
      detailSheet.show(card);
    },
    onHome: () => {
      window.location.assign("/");
    },
  });

  preloadArSounds();
  unlockArSounds();
  void bootstrap();

  async function bootstrap(): Promise<void> {
    try {
      aspectRatio = await loadMapAspectRatio(MAP_REFERENCE_PATH, DEFAULT_MAP_ASPECT_RATIO);
      const [cards, anchor] = await Promise.all([
        fetchActiveCards(),
        fetchRipplesAnchorConfig().catch(() => ({ ...DEFAULT_RIPPLES_ANCHOR })),
      ]);
      allCards = cards;
      ripplesAnchor = anchor;
      await initScene(cards);
      statusEl.textContent = "Map detected. Aim at a location.";
      statusEl.classList.add("ar-status--tracking");
    } catch {
      statusEl.textContent = "Could not load cards. Check your connection.";
      statusEl.classList.remove("ar-status--tracking");
    }
  }

  async function initScene(_cards: InfoCard[]): Promise<void> {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    cssRenderer = new CSS2DRenderer();
    cssRenderer.domElement.className = "ar-css-renderer";
    container.appendChild(cssRenderer.domElement);

    const texture = await loadTexture(MAP_REFERENCE_PATH);
    const mapHeight = 1 / aspectRatio;
    updateViewLimits(mapHeight);

    const mapGeometry = new THREE.PlaneGeometry(1, mapHeight);
    const mapMaterial = new THREE.MeshBasicMaterial({ map: texture });
    const mapMesh = new THREE.Mesh(mapGeometry, mapMaterial);
    mapMesh.position.set(0, 0, -MAP_DISTANCE);
    scene.add(mapMesh);

    anchorGroup = new THREE.Group();
    mapMesh.add(anchorGroup);

    const origin = getActiveRipplesPlacement(ripplesAnchor);
    // Wall-map preview keeps the photo-mask shader. /admin uses a separate 3D overlay.
    ripplesEffect = await createRipplesEffect(
      aspectRatio,
      ripplesAnchor.activeVariant,
      origin.mapX,
      origin.mapY
    );
    anchorGroup.add(ripplesEffect.mesh);

    overlays = createOverlaysFromCards(visibleCards(), aspectRatio);
    overlays.forEach(({ markerObject, panelObject }) => {
      anchorGroup!.add(markerObject);
      anchorGroup!.add(panelObject);
    });

    activeCardTracker = createActiveCardTracker(detailSheet);

    tracking = true;
    pinsFullyRevealed = false;
    allowPinTargeting = false;
    syncPinVisibility();
    syncChromeVisibility();
    scheduleRipplesReveal();

    updateCameraView();
    onResize();

    const render = (): void => {
      if (!renderer || !cssRenderer || !scene || !camera) return;
      updateTrackingUI(statusEl, tracking);
      ripplesEffect?.update();
      maybeUnlockWhenAllPinsVisible();
      if (allowPinTargeting) {
        const activeOverlay = updatePointing(overlays, camera, detailSheet.isOpen(), {
          thresholdPx: POINT_TARGET_RADIUS_PX,
          viewportWidth: container.clientWidth,
          viewportHeight: container.clientHeight,
          isRevealed: cardIsRevealed,
        });
        activeCardTracker?.handleActiveOverlay(activeOverlay);
      } else {
        syncPinVisibility();
        clearActivePinVisuals();
        activeCardTracker?.handleActiveOverlay(null);
      }
      cssRenderer.render(scene, camera);
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    render();
  }
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      },
      undefined,
      reject
    );
  });
}

function loadOrientation(): SimOrientation {
  const stored = sessionStorage.getItem(ORIENTATION_STORAGE_KEY);
  return stored === "landscape" ? "landscape" : "portrait";
}

function saveOrientation(orientation: SimOrientation): void {
  sessionStorage.setItem(ORIENTATION_STORAGE_KEY, orientation);
}

function applyOrientationClasses(deviceEl: HTMLElement, arApp: HTMLElement, orientation: SimOrientation): void {
  deviceEl.classList.toggle("ar-sim-device--portrait", orientation === "portrait");
  deviceEl.classList.toggle("ar-sim-device--landscape", orientation === "landscape");
  arApp.classList.toggle("ar-app--landscape", orientation === "landscape");
}

function updateOrientationToggleLabel(button: HTMLButtonElement, orientation: SimOrientation): void {
  const isLandscape = orientation === "landscape";
  button.textContent = isLandscape ? "Switch to portrait" : "Switch to landscape";
  button.setAttribute("aria-pressed", String(isLandscape));
}
