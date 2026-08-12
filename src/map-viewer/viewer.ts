import "../ar/styles.css";
import "./styles.css";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { buildArChromeHtml, wireArChrome, type ArChromeController } from "../ar/chromeUi";
import { preloadArSounds, unlockArSounds } from "../ar/sounds";
import {
  applyPinVisibility,
  createActiveCardTracker,
  createCardDetailSheet,
  createOverlaysFromCards,
  removeOverlaysFromParent,
  updatePointing,
  type ActiveCardTracker,
  type CardOverlay,
} from "../ar/viewerShared";
import {
  getLandGeometryBounds,
  getLandMesh,
  getMapPinBounds,
  landLocalToRootLocal,
  latLngToLandLocal,
  loadLatLongDistortion,
  mapXYToModelLocal,
  type LatLongDistortionMap,
} from "../map/loadArMapModel";
import {
  applyDesktopMaterials,
  loadDesktopEnvironmentMap,
  smoothMapMeshNormals,
} from "../map/mapDesktopAppearance";
import {
  createMapPulseController,
  MAP_PULSE_ORIGIN_LAT,
  MAP_PULSE_ORIGIN_LNG,
  type MapPulseController,
} from "../map/mapPulseController";
import { fetchActiveCards } from "../shared/api";
import type { CardType, InfoCard } from "../shared/types";

const MARKER_SIZE_PX = 18;
const POINT_TARGET_RADIUS_PX = (MARKER_SIZE_PX * 1.25) / 2;
/** Cone stem height in map-local units (map spans ~1 unit). */
const PIN_CONE_HEIGHT = 0.055;
const PIN_CONE_RADIUS = 0.011;
const PIN_COLOR = 0x991e72;
const PIN_COLOR_ACTIVE = 0x74c8cb;

type PinStem = {
  overlay: CardOverlay;
  group: THREE.Group;
  cone: THREE.Mesh;
};

const mapAssetUrls = import.meta.glob("../map/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function mapAssetUrl(filename: string): string {
  const key = Object.keys(mapAssetUrls).find((path) =>
    path.replace(/\\/g, "/").endsWith(`/${filename}`),
  );
  if (!key) throw new Error(`Missing map asset: ${filename}`);
  return mapAssetUrls[key];
}

function rewriteMapUrl(url: string): string {
  const name = url.split("/").pop()?.split("?")[0];
  if (!name) return url;
  const key = Object.keys(mapAssetUrls).find((path) =>
    path.replace(/\\/g, "/").endsWith(`/${name}`),
  );
  return key ? mapAssetUrls[key] : url;
}

/** Map is authored in XY with thin Z relief. Lay it flat on the XZ floor. */
function layMapFlat(root: THREE.Object3D): THREE.Box3 {
  // Mesh +Y (geographic north) → world -Z after this pitch.
  root.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);

  return new THREE.Box3().setFromObject(root);
}

export function initMapViewer(root: HTMLElement): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f3efe8");
  document.title = "Map Viewer · techNL Wavemakers";

  root.innerHTML = `
    <div class="map-viewer ar-app">
      <div id="map-viewer-canvas" class="map-viewer__canvas-wrap"></div>
      <div class="ar-ui">
        <div class="ar-crosshair" aria-hidden="true"></div>
      </div>
      ${buildArChromeHtml()}
      <p id="map-viewer-status" class="map-viewer__status" data-state="loading">Loading map…</p>
      <div id="ar-sheet-backdrop" class="ar-sheet-backdrop" hidden aria-hidden="true"></div>
      <aside id="ar-sheet" class="ar-sheet" hidden aria-hidden="true" role="dialog" aria-modal="true">
        <div class="ar-sheet__handle" aria-hidden="true">
          <span class="ar-sheet__grabber"></span>
        </div>
        <div id="ar-sheet-content" class="ar-sheet__body"></div>
      </aside>
    </div>
  `;

  const appEl = root.querySelector(".map-viewer") as HTMLElement;
  const canvasWrap = root.querySelector("#map-viewer-canvas") as HTMLElement;
  const statusEl = root.querySelector("#map-viewer-status") as HTMLElement;
  const sheetBackdrop = root.querySelector("#ar-sheet-backdrop") as HTMLElement;
  const sheetEl = root.querySelector("#ar-sheet") as HTMLElement;
  const sheetContent = root.querySelector("#ar-sheet-content") as HTMLElement;

  const scene = new THREE.Scene();
  // Bright off-white surround so dark ocean edges read clearly.
  scene.background = new THREE.Color(0xf3efe8);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
  // Placeholder until the map bounds are known; framed from the south (north-up).
  camera.position.set(0, 1.8, 0.4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  canvasWrap.appendChild(renderer.domElement);

  const cssRenderer = new CSS2DRenderer();
  cssRenderer.domElement.className = "ar-css-renderer map-viewer__css-renderer";
  appEl.appendChild(cssRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 0, 0);
  controls.minDistance = 0.35;
  controls.maxDistance = 5;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI * 0.49;
  // Left drag pans; right drag orbits (swapped from OrbitControls defaults).
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.update();

  // Warm white gallery lighting (map-reference style, key from upper right).
  scene.add(new THREE.AmbientLight(0xfff1e6, 0.7));
  scene.add(new THREE.HemisphereLight(0xfff5eb, 0xe0d4c4, 0.5));
  const key = new THREE.DirectionalLight(0xffe8d2, 1.15);
  key.position.set(2.4, 4.2, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xf3e6d6, 0.4);
  fill.position.set(-2.2, 1.8, -2.0);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xfff8f0, 0.25);
  rim.position.set(-1.2, 3.5, 2.8);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 64),
    new THREE.MeshStandardMaterial({
      color: 0xe8e2d8,
      metalness: 0.0,
      roughness: 0.95,
      envMapIntensity: 0.1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  scene.add(ground);

  const mapContent = new THREE.Group();
  mapContent.name = "map-content";
  scene.add(mapContent);

  const pinRaycaster = new THREE.Raycaster();
  const pinRayOrigin = new THREE.Vector3();
  const pinRayDir = new THREE.Vector3(0, -1, 0);
  const pinMat = new THREE.MeshStandardMaterial({
    color: PIN_COLOR,
    roughness: 0.4,
    metalness: 0.05,
  });
  const pinMatActive = new THREE.MeshStandardMaterial({
    color: PIN_COLOR_ACTIVE,
    roughness: 0.35,
    metalness: 0.08,
  });

  let mapBounds: THREE.Box3 | null = null;
  let pinBounds: THREE.Box3 | null = null;
  let landGeomBounds: THREE.Box3 | null = null;
  let landMesh: THREE.Mesh | null = null;
  let distortion: LatLongDistortionMap | null = null;
  let mapRoot: THREE.Object3D | null = null;
  let overlays: CardOverlay[] = [];
  let pinStems: PinStem[] = [];
  let allCards: InfoCard[] = [];
  let cardTypeFilter: CardType = "organization";
  let chromeUi: ArChromeController | null = null;
  let activeCardTracker: ActiveCardTracker | null = null;
  let mapPulse: MapPulseController | null = null;
  let mapReady = false;

  preloadArSounds();
  const unlockAudioOnce = (): void => {
    unlockArSounds();
    window.removeEventListener("pointerdown", unlockAudioOnce);
  };
  window.addEventListener("pointerdown", unlockAudioOnce);

  const detailSheet = createCardDetailSheet(sheetBackdrop, sheetEl, sheetContent, {
    onOpen: () => {
      appEl.classList.add("ar-app--sheet-open");
      document.documentElement.classList.add("ar-sheet-open");
      applyPinVisibility(overlays, true);
      syncPinStemVisibility();
      syncChromeVisibility();
      syncControlsEnabled();
    },
    onDismiss: () => {
      activeCardTracker?.resetSheetTimer();
      appEl.classList.remove("ar-app--sheet-open");
      document.documentElement.classList.remove("ar-sheet-open");
      applyPinVisibility(overlays, false);
      syncPinStemVisibility();
      syncChromeVisibility();
      syncControlsEnabled();
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
  });

  function visibleCards(): InfoCard[] {
    return chromeUi ? chromeUi.filterCards(allCards) : allCards;
  }

  function syncChromeVisibility(): void {
    const visible = mapReady && !detailSheet.isOpen();
    chromeUi?.setVisible(visible);
    appEl.classList.toggle("ar-app--chrome", visible);
  }

  function syncControlsEnabled(): void {
    const block = detailSheet.isOpen() || Boolean(chromeUi?.isPanelOpen());
    controls.enabled = !block;
  }

  function clearPinStems(): void {
    for (const stem of pinStems) {
      mapContent.remove(stem.group);
      stem.cone.geometry.dispose();
    }
    pinStems = [];
  }

  /** Drop a ray onto the map mesh so the cone tip sits on the surface, not the AABB. */
  function sampleSurfaceY(x: number, z: number): number {
    if (!mapRoot || !mapBounds) return 0;
    pinRayOrigin.set(x, mapBounds.max.y + 1, z);
    pinRaycaster.set(pinRayOrigin, pinRayDir);
    const hits = pinRaycaster.intersectObject(mapRoot, true);
    if (hits.length > 0) return hits[0].point.y;
    return mapBounds.min.y;
  }

  function createPinStem(overlay: CardOverlay, x: number, z: number, surfaceY: number): PinStem {
    const group = new THREE.Group();
    group.name = `pin-stem-${overlay.group.key}`;
    group.position.set(x, surfaceY, z);

    // Tip at local y=0 (on surface); wide end under the CSS2D marker head.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(PIN_CONE_RADIUS, PIN_CONE_HEIGHT, 20),
      pinMat,
    );
    cone.rotation.x = Math.PI;
    cone.position.y = PIN_CONE_HEIGHT / 2;
    cone.castShadow = false;
    cone.receiveShadow = false;
    group.add(cone);
    mapContent.add(group);

    return { overlay, group, cone };
  }

  function syncPinStemVisibility(): void {
    for (const stem of pinStems) {
      stem.group.visible = stem.overlay.markerObject.visible;
      const active = stem.overlay.marker.classList.contains("ar-card__marker--active");
      stem.cone.material = active ? pinMatActive : pinMat;
    }
  }

  function pinPositionForOverlay(overlay: CardOverlay): THREE.Vector3 {
    // Same space as /3d-admin: stored mapX/mapY → admin crop → land world AABB.
    if (pinBounds) {
      return mapXYToModelLocal(overlay.group.mapX, overlay.group.mapY, pinBounds, 0);
    }
    return new THREE.Vector3();
  }

  function rebuildOverlays(): void {
    if (!pinBounds) return;
    if (detailSheet.isOpen()) {
      detailSheet.dismiss();
      activeCardTracker?.resetSheetTimer();
    }
    removeOverlaysFromParent(overlays, mapContent);
    clearPinStems();
    overlays = createOverlaysFromCards(visibleCards(), 1);
    for (const overlay of overlays) {
      const base = pinPositionForOverlay(overlay);
      const surfaceY = sampleSurfaceY(base.x, base.z);
      const tipY = surfaceY + PIN_CONE_HEIGHT;

      pinStems.push(createPinStem(overlay, base.x, base.z, surfaceY));

      overlay.markerObject.position.set(base.x, tipY, base.z);
      overlay.panelObject.position.set(base.x, tipY + 0.02, base.z);
      mapContent.add(overlay.markerObject);
      mapContent.add(overlay.panelObject);
    }
    applyPinVisibility(overlays, detailSheet.isOpen());
    syncPinStemVisibility();
    activeCardTracker?.handleActiveOverlay(null);
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier(rewriteMapUrl);

  void (async () => {
    try {
      try {
        // Keep IBL for subtle contact shading, but intensity is low on materials
        // so the warm cafe HDR does not pull water toward neon.
        const hdr = await loadDesktopEnvironmentMap(manager);
        if (hdr) scene.environment = hdr;
      } catch {
        // Local lights still work if HDR fails.
      }

      const [gltf, cards, distortionMap] = await Promise.all([
        new GLTFLoader(manager).loadAsync(mapAssetUrl("TechNL_map_Textured.gltf")),
        fetchActiveCards().catch((err) => {
          console.error(err);
          return [] as InfoCard[];
        }),
        loadLatLongDistortion().catch((err) => {
          console.warn(err);
          return null;
        }),
      ]);
      allCards = cards;
      distortion = distortionMap;

      mapRoot = gltf.scene;
      smoothMapMeshNormals(mapRoot);
      await applyDesktopMaterials(mapRoot);
      layMapFlat(mapRoot);
      mapContent.add(mapRoot);
      mapBounds = new THREE.Box3().setFromObject(mapContent);
      pinBounds = getMapPinBounds(mapContent);
      landMesh = getLandMesh(mapContent);
      landGeomBounds = getLandGeometryBounds(mapContent);

      const size = mapBounds.getSize(new THREE.Vector3());
      const fit = Math.max(size.x, size.z);
      const center = mapBounds.getCenter(new THREE.Vector3());
      const fovRad = (camera.fov * Math.PI) / 180;
      // Distance that frames the map; approach from south so geographic north (-Z) is screen-up.
      const radius = (fit * 0.5) / Math.tan(fovRad * 0.5) * 1.2;
      const phi = 0.22; // ~12.5° from vertical — top-down without polar roll singularity
      const theta = 0; // azimuth 0 = camera on +Z (south of map)
      camera.position.set(
        center.x + radius * Math.sin(phi) * Math.sin(theta),
        center.y + radius * Math.cos(phi),
        center.z + radius * Math.sin(phi) * Math.cos(theta),
      );
      controls.target.set(center.x, center.y, center.z);
      controls.update();

      try {
        // Pulse mats are transparent reveal shaders (fillPower ends at 0).
        // Keep solid desktop materials on mapRoot; run pulse on a clone overlay.
        // Clone already includes mapRoot.rotation; parent under mapRoot with
        // identity transform so we do not double-apply the lay-flat -90° X.
        const pulseRoot = mapRoot.clone(true);
        pulseRoot.position.set(0, 0, 0);
        pulseRoot.rotation.set(0, 0, 0);
        pulseRoot.scale.set(1, 1, 1);
        mapRoot.add(pulseRoot);
        mapPulse = await createMapPulseController(pulseRoot);
        mapRoot.updateMatrixWorld(true);
        if (landMesh && landGeomBounds) {
          const landLocal = latLngToLandLocal(
            MAP_PULSE_ORIGIN_LAT,
            MAP_PULSE_ORIGIN_LNG,
            landGeomBounds,
            distortion,
          );
          const rootLocal = landLocalToRootLocal(landMesh, landLocal, mapRoot);
          mapPulse.setCenterWorld(mapRoot.localToWorld(rootLocal));
          mapPulse.setPulseScale(fit * 0.55);
        } else {
          mapPulse.setPulseScale(fit * 0.55);
          mapPulse.setCenterWorld(mapRoot.getWorldPosition(new THREE.Vector3()));
        }
        mapPulse.startPulse(undefined, () => {
          mapPulse?.dispose();
          mapPulse = null;
          pulseRoot.removeFromParent();
        });
      } catch (pulseErr) {
        console.warn("Map pulse setup failed", pulseErr);
      }

      rebuildOverlays();
      mapReady = true;
      syncChromeVisibility();

      statusEl.textContent = "Ready";
      statusEl.dataset.state = "ready";
      window.setTimeout(() => {
        statusEl.hidden = true;
      }, 1200);
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        err instanceof Error ? err.message : "Failed to load map model";
      statusEl.dataset.state = "error";
    }
  })();

  const resize = (): void => {
    const w = canvasWrap.clientWidth || window.innerWidth;
    const h = canvasWrap.clientHeight || window.innerHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    cssRenderer.setSize(w, h);
  };
  resize();
  window.addEventListener("resize", resize);

  // Keep orbit locked while chrome search/filter panels are open.
  root.addEventListener("click", () => {
    syncControlsEnabled();
  });
  root.addEventListener("input", () => {
    syncControlsEnabled();
  });

  let frame = 0;
  const tick = (): void => {
    frame = requestAnimationFrame(tick);
    controls.update();
    syncControlsEnabled();

    if (mapReady && !detailSheet.isOpen() && !chromeUi?.isPanelOpen()) {
      const active = updatePointing(overlays, camera, false, {
        thresholdPx: POINT_TARGET_RADIUS_PX,
        viewportWidth: canvasWrap.clientWidth || window.innerWidth,
        viewportHeight: canvasWrap.clientHeight || window.innerHeight,
      });
      activeCardTracker?.handleActiveOverlay(active);
      syncPinStemVisibility();
    }

    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
  };
  tick();

  const observer = new MutationObserver(() => {
    if (root.contains(canvasWrap)) return;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointerdown", unlockAudioOnce);
    mapPulse?.dispose();
    mapPulse = null;
    controls.dispose();
    renderer.dispose();
    pinMat.dispose();
    pinMatActive.dispose();
    clearPinStems();
    cssRenderer.domElement.remove();
    document.documentElement.classList.remove("ar-sheet-open");
    observer.disconnect();
  });
  observer.observe(root, { childList: true });
}
