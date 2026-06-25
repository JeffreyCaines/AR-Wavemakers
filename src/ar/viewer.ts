import "./styles.css";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { MindARThree } from "mind-ar/dist/mindar-image-three.prod.js";
import { fetchActiveCards } from "../shared/api";
import { loadMapAspectRatio } from "../shared/geo";
import { DEFAULT_MAP_ASPECT_RATIO, MAP_REFERENCE_PATH, MAP_TARGET_PATH } from "../shared/types";
import type { InfoCard } from "../shared/types";
import {
  createActiveCardTracker,
  createCardDetailSheet,
  createCardOverlay,
  updatePointing,
  updateTrackingUI,
  type ActiveCardTracker,
  type CardOverlay,
} from "./viewerShared";

export function initArViewer(root: HTMLElement): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f3f6fb");
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
  let activeCardTracker: ActiveCardTracker | null = null;
  let arSessionActive = false;
  const arApp = root.querySelector(".ar-app") as HTMLElement;

  const sheetBackdrop = root.querySelector("#ar-sheet-backdrop") as HTMLElement;
  const sheetEl = root.querySelector("#ar-sheet") as HTMLElement;
  const sheetContent = root.querySelector("#ar-sheet-content") as HTMLElement;
  const detailSheet = createCardDetailSheet(sheetBackdrop, sheetEl, sheetContent, {
    onOpen: () => {
      arApp.classList.add("ar-app--sheet-open");
      document.documentElement.classList.add("ar-sheet-open");
    },
    onDismiss: () => {
      activeCardTracker?.resetSheetTimer();
      arApp.classList.remove("ar-app--sheet-open");
      document.documentElement.classList.remove("ar-sheet-open");
    },
  });

  setupLandscapeAndFullscreen(arApp, () => arSessionActive, handleOrientationTransition);

  void bootstrap();

  function resetTargetingState(): void {
    tracking = false;
    activeCardTracker?.resetSheetTimer();

    const sheetOpen = detailSheet.isOpen();
    for (const overlay of overlays) {
      overlay.markerObject.visible = !sheetOpen;
      overlay.marker.classList.remove("ar-card__marker--active");
      overlay.panel.classList.remove("ar-card__panel--visible");
    }
    updateTrackingUI(statusEl, false);
  }

  function resetArViewport(): void {
    if (!mindarThree || !cssRenderer) return;
    mindarThree.resize();
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
  }

  function handleOrientationTransition(): void {
    if (!arSessionActive) return;
    resetTargetingState();
    const syncViewport = (): void => {
      resetArViewport();
      applyViewportHeight();
    };
    syncViewport();
    window.setTimeout(syncViewport, 100);
    window.setTimeout(syncViewport, 300);
    window.setTimeout(syncViewport, 600);
  }

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
      void requestAppFullscreen();
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
      if (mindarThree) {
        mindarThree.resize();
      }
      cssRenderer?.setSize(container.clientWidth, container.clientHeight);
      applyViewportHeight();
    };
    window.addEventListener("resize", resize);

    try {
      await mindarThree.start();
      root.querySelector(".ar-header")?.classList.add("ar-header--compact");
      arSessionActive = true;
      arApp.classList.add("ar-app--running");
      syncLandscapeLayout(arApp, true);
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
}

function isLandscapeOrientation(): boolean {
  const orientationType = window.screen?.orientation?.type;
  if (orientationType) {
    return orientationType.startsWith("landscape");
  }
  return window.innerWidth > window.innerHeight;
}

function applyViewportHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

function hideMobileBrowserChrome(): void {
  window.scrollTo(0, 1);
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function updateLandscapeClass(app: HTMLElement): boolean {
  const landscape = isLandscapeOrientation();
  app.classList.toggle("ar-app--landscape", landscape);
  return landscape;
}

async function requestAppFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true;
  const root = document.documentElement;
  try {
    if (root.requestFullscreen) {
      await root.requestFullscreen();
      return true;
    }
    const webkitRequest = (root as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> })
      .webkitRequestFullscreen;
    if (webkitRequest) {
      await webkitRequest.call(root);
      return true;
    }
  } catch {
    // Fullscreen may require a user gesture or is unsupported (e.g. iOS Safari).
  }
  return Boolean(document.fullscreenElement);
}

async function ensureLandscapeFullscreen(): Promise<void> {
  if (!isLandscapeOrientation()) return;

  hideMobileBrowserChrome();

  if (!document.fullscreenElement) {
    await requestAppFullscreen();
  }

  applyViewportHeight();
}

function syncLandscapeLayout(app: HTMLElement, arActive: boolean): void {
  const landscape = updateLandscapeClass(app);
  applyViewportHeight();

  if (landscape && arActive) {
    void ensureLandscapeFullscreen();
  } else if (!landscape && document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
}

function scheduleLandscapeSync(app: HTMLElement, getArActive: () => boolean): void {
  const run = (): void => syncLandscapeLayout(app, getArActive());
  run();
  window.setTimeout(run, 100);
  window.setTimeout(run, 300);
  window.setTimeout(run, 600);
}

function setupLandscapeAndFullscreen(
  app: HTMLElement,
  getArActive: () => boolean,
  onOrientationTransition?: () => void
): void {
  const sync = (): void => syncLandscapeLayout(app, getArActive());

  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", () => {
    scheduleLandscapeSync(app, getArActive);
    onOrientationTransition?.();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", sync);
    window.visualViewport.addEventListener("scroll", sync);
  }

  sync();
}
