import "./styles.css";
import "./eighthWallStyles.css";
import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import tapSurfaceUrl from "../images/TapSurface-icon_shadow.png";
import {
  getLandMesh,
  landLocalToRootLocal,
  latLngToLandLocal,
  loadArMapModel,
  loadLatLongDistortion,
  mapXYToModelLocal,
  type ArMapModel,
  type LatLongDistortionMap,
} from "../map/loadArMapModel";
import {
  createMapPulseController,
  MAP_PULSE_ORIGIN_LAT,
  MAP_PULSE_ORIGIN_LNG,
  type MapPulseController,
} from "../map/mapPulseController";
import { fetchActiveCards } from "../shared/api";
import type { CardType, InfoCard } from "../shared/types";
import { buildArChromeHtml, wireArChrome, type ArChromeController } from "./chromeUi";
import { loadXr8Engine } from "./loadXr8";
import { preloadArSounds, unlockArSounds } from "./sounds";
import type { XR8Api, Xr8PipelineModule } from "./xr8";
import {
  applyPinVisibility,
  createActiveCardTracker,
  createCardDetailSheet,
  createOverlaysFromCards,
  removeOverlaysFromParent,
  updatePointing,
  type ActiveCardTracker,
  type CardOverlay,
} from "./viewerShared";

const MAP_WIDTH_M = 2.2;
const MARKER_SIZE_PX = 18;
/** Same hit radius as /ar-preview: ~1.25× marker diameter from center. */
const POINT_TARGET_RADIUS_PX = (MARKER_SIZE_PX * 1.25) / 2;

/**
 * World-tracking (SLAM) AR route powered by the 8th Wall engine binary.
 * Tap a surface to place the 3D map; two-finger tap recenters tracking.
 */
export function initEighthWallArViewer(root: HTMLElement): void {
  document.documentElement.classList.add("ew-active");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#000");

  root.innerHTML = `
    <!-- This product includes the XR Engine software developed by Niantic Spatial, Inc.
         Copyright © 2026 Niantic Spatial, Inc. All rights reserved.
         License: https://github.com/8thwall/engine/blob/main/LICENSE -->
    <div class="ew-app ar-app">
      <canvas id="ew-camerafeed" class="ew-canvas" width="640" height="960"></canvas>
      <div class="ew-ui ar-ui">
        <div class="ar-crosshair" aria-hidden="true"></div>
      </div>
      ${buildArChromeHtml({ showReposition: true })}
      <div id="ew-place" class="ew-place" aria-hidden="false">
        <div class="ew-place__tap">
          <img class="ew-place__tap-gif" src="${tapSurfaceUrl}" alt="" decoding="async" />
        </div>
        <div class="ew-place__footer">Tap to place the map in your space.</div>
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

  const canvas = root.querySelector("#ew-camerafeed") as HTMLCanvasElement;
  const arApp = root.querySelector(".ew-app") as HTMLElement;
  const placeEl = root.querySelector("#ew-place") as HTMLElement;
  const sheetBackdrop = root.querySelector("#ar-sheet-backdrop") as HTMLElement;
  const sheetEl = root.querySelector("#ar-sheet") as HTMLElement;
  const sheetContent = root.querySelector("#ar-sheet-content") as HTMLElement;

  window.THREE = THREE;

  let started = false;
  let disposed = false;
  let mapModel: ArMapModel | null = null;
  let distortion: LatLongDistortionMap | null = null;
  let allCards: InfoCard[] = [];
  let cardTypeFilter: CardType = "organization";
  let overlays: CardOverlay[] = [];
  let placedRoot: THREE.Group | null = null;
  let cssRenderer: CSS2DRenderer | null = null;
  let activeCardTracker: ActiveCardTracker | null = null;
  let chromeUi: ArChromeController | null = null;
  let mapPlaced = false;
  let mapPulse: MapPulseController | null = null;

  const detailSheet = createCardDetailSheet(sheetBackdrop, sheetEl, sheetContent, {
    onOpen: () => {
      arApp.classList.add("ar-app--sheet-open");
      document.documentElement.classList.add("ar-sheet-open");
      applyPinVisibility(overlays, true);
      syncChromeVisibility();
    },
    onDismiss: () => {
      activeCardTracker?.resetSheetTimer();
      arApp.classList.remove("ar-app--sheet-open");
      document.documentElement.classList.remove("ar-sheet-open");
      applyPinVisibility(overlays, false);
      syncChromeVisibility();
    },
  });
  activeCardTracker = createActiveCardTracker(detailSheet);

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
    onReposition: () => {
      removePlacedMap();
    },
  });

  preloadArSounds();
  void bootstrap();

  function visibleCards(): InfoCard[] {
    return chromeUi ? chromeUi.filterCards(allCards) : allCards;
  }

  function syncChromeVisibility(): void {
    const visible = mapPlaced && !detailSheet.isOpen();
    chromeUi?.setVisible(visible);
    arApp.classList.toggle("ar-app--chrome", visible);
  }

  function setPlacementUiVisible(visible: boolean): void {
    placeEl.hidden = !visible;
    placeEl.setAttribute("aria-hidden", visible ? "false" : "true");
    arApp.classList.toggle("ew-app--placing", visible);
  }

  function removePlacedMap(): void {
    if (detailSheet.isOpen()) {
      detailSheet.dismiss();
      activeCardTracker?.resetSheetTimer();
    }
    mapPulse?.dispose();
    mapPulse = null;
    if (placedRoot) {
      placedRoot.parent?.remove(placedRoot);
      removeOverlaysFromParent(overlays, placedRoot);
      overlays = [];
      placedRoot = null;
    }
    mapPlaced = false;
    activeCardTracker?.handleActiveOverlay(null);
    setPlacementUiVisible(true);
    syncChromeVisibility();
  }

  function syncPulseOrigin(): void {
    if (!mapPulse || !placedRoot || !mapModel) return;
    placedRoot.updateMatrixWorld(true);
    const land = getLandMesh(placedRoot);
    if (land && mapModel.landGeomBounds) {
      const local = latLngToLandLocal(
        MAP_PULSE_ORIGIN_LAT,
        MAP_PULSE_ORIGIN_LNG,
        mapModel.landGeomBounds,
        distortion
      );
      const rootLocal = landLocalToRootLocal(land, local, placedRoot);
      mapPulse.setCenterWorld(placedRoot.localToWorld(rootLocal));
    } else {
      const size = mapModel.bounds.getSize(new THREE.Vector3());
      mapPulse.setCenterWorld(
        placedRoot.localToWorld(
          new THREE.Vector3(
            mapModel.bounds.min.x + size.x * 0.72,
            mapModel.bounds.max.y,
            mapModel.bounds.min.z + size.z * 0.55
          )
        )
      );
    }
    const size = mapModel.bounds.getSize(new THREE.Vector3());
    mapPulse.setPulseScale(Math.max(size.x, size.z) * 0.55);
  }

  function pinPositionForOverlay(overlay: CardOverlay): THREE.Vector3 {
    if (!mapModel || !placedRoot) return new THREE.Vector3();
    const card = overlay.group.cards[0];
    const land = getLandMesh(placedRoot);
    if (
      land &&
      mapModel.landGeomBounds &&
      Number.isFinite(card.lat) &&
      Number.isFinite(card.lng)
    ) {
      const local = latLngToLandLocal(
        card.lat,
        card.lng,
        mapModel.landGeomBounds,
        distortion
      );
      return landLocalToRootLocal(land, local, placedRoot);
    }
    return mapXYToModelLocal(overlay.group.mapX, overlay.group.mapY, mapModel.pinBounds);
  }

  function rebuildOverlays(): void {
    if (!placedRoot || !mapModel) return;
    if (detailSheet.isOpen()) {
      detailSheet.dismiss();
      activeCardTracker?.resetSheetTimer();
    }
    removeOverlaysFromParent(overlays, placedRoot);
    overlays = createOverlaysFromCards(visibleCards(), 1);
    for (const overlay of overlays) {
      const pos = pinPositionForOverlay(overlay);
      overlay.markerObject.position.copy(pos);
      overlay.panelObject.position.copy(pos);
      // Lift panel slightly so it reads above the pin.
      overlay.panelObject.position.y += 0.04;
      placedRoot.add(overlay.markerObject);
      placedRoot.add(overlay.panelObject);
    }
    applyPinVisibility(overlays, detailSheet.isOpen());
    activeCardTracker?.handleActiveOverlay(null);
  }

  async function bootstrap(): Promise<void> {
    try {
      const [cards, model, distortionMap] = await Promise.all([
        fetchActiveCards(),
        loadArMapModel(MAP_WIDTH_M),
        loadLatLongDistortion().catch((err) => {
          console.warn(err);
          return null;
        }),
      ]);
      allCards = cards;
      mapModel = model;
      distortion = distortionMap;

      const XR8 = await loadXr8Engine();
      if (disposed) return;

      await XR8.loadChunk("slam");
      if (disposed) return;

      startPipeline(XR8);
      setPlacementUiVisible(true);
    } catch (err) {
      console.error(err);
      const footer = placeEl.querySelector(".ew-place__footer");
      if (footer) {
        footer.textContent =
          err instanceof Error ? err.message : "Could not start 8th Wall AR.";
      }
    }
  }

  function startPipeline(XR8: XR8Api): void {
    if (started) return;
    started = true;

    XR8.addCameraPipelineModules([
      fullWindowCanvasModule(canvas),
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      placeMapPipelineModule(),
    ]);

    XR8.run({
      canvas,
      allowedDevices: XR8.XrConfig.device().ANY,
    });

    function placeMapPipelineModule(): Xr8PipelineModule {
      const raycaster = new THREE.Raycaster();
      const tapNdc = new THREE.Vector2();
      let surface: THREE.Mesh | null = null;

      function initScene(
        scene: THREE.Scene,
        camera: THREE.Camera,
        renderer: THREE.WebGLRenderer
      ): void {
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        scene.add(new THREE.AmbientLight(0xfff1e6, 0.85));
        scene.add(new THREE.HemisphereLight(0xfff5eb, 0xc8d0d8, 0.55));
        const key = new THREE.DirectionalLight(0xffe8d2, 1.05);
        key.position.set(2.4, 4.2, 1.6);
        scene.add(key);

        surface = new THREE.Mesh(
          new THREE.PlaneGeometry(40, 40),
          new THREE.ShadowMaterial({ opacity: 0.28 })
        );
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = 0;
        surface.receiveShadow = true;
        scene.add(surface);

        const grid = new THREE.GridHelper(10, 20, 0x74c8cb, 0x1a3048);
        grid.position.y = 0.01;
        scene.add(grid);

        camera.position.set(0, 1.6, 0);

        cssRenderer = new CSS2DRenderer();
        cssRenderer.setSize(window.innerWidth, window.innerHeight);
        cssRenderer.domElement.className = "ar-css-renderer ew-css-renderer";
        arApp.appendChild(cssRenderer.domElement);
        window.addEventListener("resize", () => {
          cssRenderer?.setSize(window.innerWidth, window.innerHeight);
        });
      }

      function placeMapAt(point: THREE.Vector3): void {
        if (!mapModel) return;

        const { scene } = XR8.Threejs.xrScene();

        if (!placedRoot) {
          placedRoot = mapModel.root.clone(true);
          scene.add(placedRoot);
          void createMapPulseController(placedRoot).then((controller) => {
            if (!placedRoot || disposed) {
              controller.dispose();
              return;
            }
            mapPulse = controller;
            syncPulseOrigin();
            // Live: ResetPulse + Map_pulse_2.wav + StartPulse when map appears.
            mapPulse.startPulse();
          });
          rebuildOverlays();
        }

        placedRoot.position.set(point.x, 0, point.z);
        mapPlaced = true;
        setPlacementUiVisible(false);
        syncChromeVisibility();
        syncPulseOrigin();
      }

      function pickSurface(clientX: number, clientY: number): void {
        if (!surface || detailSheet.isOpen() || chromeUi?.isPanelOpen()) return;
        // Only place while in placement mode; after place, taps go to pin targeting.
        if (mapPlaced) return;
        unlockArSounds();
        const { camera } = XR8.Threejs.xrScene();
        tapNdc.x = (clientX / window.innerWidth) * 2 - 1;
        tapNdc.y = -(clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(tapNdc, camera as THREE.PerspectiveCamera);
        const hits = raycaster.intersectObject(surface);
        if (hits.length > 0) {
          placeMapAt(hits[0].point);
        }
      }

      function onTouchStart(e: TouchEvent): void {
        if (e.touches.length === 2) {
          XR8.XrController.recenter();
          return;
        }
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        pickSurface(touch.clientX, touch.clientY);
      }

      function onClick(e: MouseEvent): void {
        pickSurface(e.clientX, e.clientY);
      }

      return {
        name: "wavemakers-slam-place",
        onStart: ({ canvas: feed }) => {
          const { scene, camera, renderer } = XR8.Threejs.xrScene();
          initScene(scene, camera, renderer);

          feed.addEventListener("touchstart", onTouchStart, { passive: true });
          feed.addEventListener("click", onClick);
          feed.addEventListener(
            "touchmove",
            (ev) => {
              ev.preventDefault();
            },
            { passive: false }
          );

          XR8.XrController.updateCameraProjectionMatrix({
            origin: camera.position,
            facing: camera.quaternion,
          });

          setPlacementUiVisible(true);
        },
        onUpdate: () => {
          if (!cssRenderer || !placedRoot) return;
          const { scene, camera } = XR8.Threejs.xrScene();
          const active = updatePointing(overlays, camera, detailSheet.isOpen(), {
            thresholdPx: POINT_TARGET_RADIUS_PX,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          });
          activeCardTracker?.handleActiveOverlay(active);
          cssRenderer.render(scene, camera);
        },
      };
    }
  }

  const observer = new MutationObserver(() => {
    if (!document.body.contains(root) && !disposed) {
      disposed = true;
      document.documentElement.classList.remove("ew-active", "ar-sheet-open");
      observer.disconnect();
      try {
        window.XR8?.stop();
      } catch {
        /* ignore */
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function fullWindowCanvasModule(canvas: HTMLCanvasElement): Xr8PipelineModule {
  const apply = (): void => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    canvas.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "bottom:0",
      `width:${w}px`,
      `height:${h}px`,
      "margin:0",
      "padding:0",
      "border:0",
      "max-width:none",
      "max-height:none",
      "z-index:0",
      "display:block",
      "object-fit:cover",
    ].join(";");
  };

  return {
    name: "wavemakers-fullwindowcanvas",
    onStart: () => {
      apply();
      window.addEventListener("resize", apply);
      window.addEventListener("orientationchange", apply);
    },
    onUpdate: () => {
      if (
        canvas.style.width !== `${window.innerWidth}px` ||
        canvas.style.height !== `${window.innerHeight}px`
      ) {
        apply();
      }
    },
  };
}
