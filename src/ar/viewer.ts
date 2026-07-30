import "./styles.css";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { MindARThree } from "mind-ar/dist/mindar-image-three.prod.js";
import { fetchActiveCards, fetchRipplesAnchorConfig } from "../shared/api";
import { loadMapAspectRatio } from "../shared/geo";
import { isPinRevealed, ST_JOHNS_CARD_ID } from "../shared/ripplesReveal";
import { getRipplesSimDurationSec, RIPPLE_MASK_HEIGHT, RIPPLE_MASK_WIDTH } from "../shared/ripplesSim";
import {
  DEFAULT_MAP_ASPECT_RATIO,
  DEFAULT_RIPPLES_ANCHOR,
  getActiveRipplesPlacement,
  MAP_REFERENCE_PATH,
  MAP_TARGET_PATH,
} from "../shared/types";
import type { InfoCard, RipplesAnchor } from "../shared/types";
import { createRipplesEffect, type RipplesEffect } from "./ripplesEffect";
import {
  applyPinVisibility,
  createActiveCardTracker,
  createCardDetailSheet,
  createOverlaysFromCards,
  ORIENTATION_TRACKING_GRACE_MS,
  pinUnlockTimingOffset,
  RIPPLES_REVEAL_DELAY_MS,
  updatePointing,
  updateTrackingUI,
  type ActiveCardTracker,
  type CardOverlay,
} from "./viewerShared";

const RIPPLE_MASK_SIZE = { width: RIPPLE_MASK_WIDTH, height: RIPPLE_MASK_HEIGHT };

export function initArViewer(root: HTMLElement): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#000");
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
      <button
        type="button"
        id="ar-fullscreen-prompt"
        class="ar-fullscreen-prompt"
        hidden
        aria-hidden="true"
      >
        Tap to enter fullscreen
      </button>
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
  let ripplesEffect: RipplesEffect | null = null;
  let ripplesAnchor: RipplesAnchor = { ...DEFAULT_RIPPLES_ANCHOR };
  let ripplesTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumps on cancel so in-flight start work does not begin reveal. */
  let ripplesShowGeneration = 0;
  /** After one full ripples play, all pins stay visible until re-locked. */
  let pinsFullyRevealed = false;
  /** Pin targeting stays off until all pins are revealed by ripples. */
  let allowPinTargeting = true;
  /** performance.now() deadline — target-lost during this window does not wipe pins. */
  let orientationGraceUntil = 0;
  /** Target-lost deferred while orientation grace is active. */
  let pendingTargetLost = false;
  let orientationGraceTimer: ReturnType<typeof setTimeout> | null = null;
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

  function cardIsRevealedAt(card: InfoCard, elapsedSec: number | null): boolean {
    if (pinsFullyRevealed) return true;
    if (!tracking) return card.id === ST_JOHNS_CARD_ID;
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

  function inOrientationGrace(): boolean {
    return performance.now() < orientationGraceUntil;
  }

  function flushPendingTargetLost(): void {
    if (!pendingTargetLost) return;
    if (inOrientationGrace()) return;
    pendingTargetLost = false;
    tracking = false;
    cancelRipplesReveal();
    updateTrackingUI(statusEl, false);
  }

  function beginOrientationGrace(): void {
    orientationGraceUntil = performance.now() + ORIENTATION_TRACKING_GRACE_MS;
    if (orientationGraceTimer !== null) {
      clearTimeout(orientationGraceTimer);
    }
    orientationGraceTimer = setTimeout(() => {
      orientationGraceTimer = null;
      flushPendingTargetLost();
    }, ORIENTATION_TRACKING_GRACE_MS + 50);
  }

  function resetArViewport(): void {
    if (!mindarThree || !cssRenderer) return;
    mindarThree.resize();
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
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
    // Rotation grace: don't wipe a completed reveal by re-locking pins.
    if (inOrientationGrace() && pinsFullyRevealed) return;

    lockPinTargeting();
    const showGeneration = ripplesShowGeneration;

    ripplesTimer = setTimeout(() => {
      ripplesTimer = null;
      if (showGeneration !== ripplesShowGeneration || !tracking || !ripplesEffect) return;
      beginSyncedRipplesPlayback(showGeneration);
    }, RIPPLES_REVEAL_DELAY_MS);
  }

  function handleOrientationTransition(): void {
    if (!arSessionActive) return;
    beginOrientationGrace();
    // Do not reset targeting / wipe pins — MindAR often drops tracking briefly on rotate.
    clearActivePinVisuals();
    activeCardTracker?.resetSheetTimer();
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
      if (isLandscapeOrientation()) {
        void requestAppFullscreen();
      }
      void startAr();
    });
  }

  async function startAr(): Promise<void> {
    if (mindarThree) return;

    startBtn.disabled = true;
    statusEl.textContent = "Starting camera…";

    let cards: InfoCard[];
    try {
      [cards, ripplesAnchor] = await Promise.all([
        fetchActiveCards(),
        fetchRipplesAnchorConfig().catch(() => ({ ...DEFAULT_RIPPLES_ANCHOR })),
      ]);
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

    const origin = getActiveRipplesPlacement(ripplesAnchor);
    try {
      ripplesEffect = await createRipplesEffect(
        aspectRatio,
        ripplesAnchor.activeVariant,
        origin.mapX,
        origin.mapY
      );
      anchor.group.add(ripplesEffect.mesh);
    } catch {
      statusEl.textContent = "Could not load ripples masks.";
      startBtn.disabled = false;
      mindarThree = null;
      return;
    }

    anchor.onTargetFound = () => {
      pendingTargetLost = false;
      tracking = true;
      scheduleRipplesReveal();
    };
    anchor.onTargetLost = () => {
      if (inOrientationGrace()) {
        // Keep reveal state; MindAR may drop tracking briefly during rotate.
        pendingTargetLost = true;
        return;
      }
      pendingTargetLost = false;
      tracking = false;
      cancelRipplesReveal();
    };

    cssRenderer = new CSS2DRenderer();
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
    cssRenderer.domElement.className = "ar-css-renderer";
    container.appendChild(cssRenderer.domElement);

    overlays = createOverlaysFromCards(cards, aspectRatio);
    overlays.forEach(({ markerObject, panelObject }) => {
      anchor.group.add(markerObject);
      anchor.group.add(panelObject);
    });
    // Only St. John's until the first full ripples play completes.
    pinsFullyRevealed = false;
    allowPinTargeting = false;
    syncPinVisibility();

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
      ripplesEffect?.update();
      maybeUnlockWhenAllPinsVisible();
      if (allowPinTargeting) {
        const activeOverlay = updatePointing(overlays, camera, detailSheet.isOpen(), {
          isRevealed: cardIsRevealed,
        });
        activeCardTracker?.handleActiveOverlay(activeOverlay);
      } else {
        syncPinVisibility();
        clearActivePinVisuals();
        activeCardTracker?.handleActiveOverlay(null);
      }
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

function isDocumentFullscreen(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
}

async function requestAppFullscreen(): Promise<boolean> {
  if (isDocumentFullscreen()) return true;
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  try {
    if (root.requestFullscreen) {
      await root.requestFullscreen();
      return true;
    }
    if (root.webkitRequestFullscreen) {
      await root.webkitRequestFullscreen.call(root);
      return true;
    }
  } catch {
    // Fullscreen may require a user gesture or is unsupported (e.g. iOS Safari).
  }
  return isDocumentFullscreen();
}

function getFullscreenPrompt(app: HTMLElement): HTMLButtonElement | null {
  return app.querySelector("#ar-fullscreen-prompt");
}

function setFullscreenPromptVisible(app: HTMLElement, visible: boolean): void {
  const prompt = getFullscreenPrompt(app);
  if (!prompt) return;
  prompt.classList.toggle("is-visible", visible);
  prompt.hidden = !visible;
  prompt.setAttribute("aria-hidden", visible ? "false" : "true");
}

function syncLandscapeLayout(app: HTMLElement, arActive: boolean): void {
  const landscape = updateLandscapeClass(app);
  applyViewportHeight();

  if (!landscape) {
    setFullscreenPromptVisible(app, false);
    if (isDocumentFullscreen()) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
    return;
  }

  if (!arActive) {
    setFullscreenPromptVisible(app, false);
    return;
  }

  hideMobileBrowserChrome();
  setFullscreenPromptVisible(app, !isDocumentFullscreen());
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
  const prompt = getFullscreenPrompt(app);

  prompt?.addEventListener("click", () => {
    void requestAppFullscreen().then((entered) => {
      hideMobileBrowserChrome();
      applyViewportHeight();
      if (entered || isDocumentFullscreen()) {
        setFullscreenPromptVisible(app, false);
      }
    });
  });

  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", () => {
    scheduleLandscapeSync(app, getArActive);
    onOrientationTransition?.();
  });
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);

  const orientation = window.screen?.orientation;
  if (orientation && typeof orientation.addEventListener === "function") {
    orientation.addEventListener("change", () => {
      scheduleLandscapeSync(app, getArActive);
      onOrientationTransition?.();
    });
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", sync);
    window.visualViewport.addEventListener("scroll", sync);
  }

  sync();
}
