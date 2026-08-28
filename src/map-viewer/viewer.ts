import "../ar/styles.css";
import "./styles.css";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { buildArChromeHtml, wireArChrome, type ArChromeController } from "../ar/chromeUi";
import { preloadArSounds, unlockArSounds } from "../ar/sounds";
import {
  createCardDetailSheet,
  createOverlaysFromCards,
  removeOverlaysFromParent,
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
  pulseRevealAlpha,
  type MapPulseController,
} from "../map/mapPulseController";
import { fetchActiveCards } from "../shared/api";
import type { ExperienceViewOptions } from "../shared/experienceView";
import { isStJohnsCard } from "../shared/ripplesReveal";
import type { CardType, InfoCard } from "../shared/types";

/** Match phone map-viewer; desktop shelf is a right dock above this width. */
const DESKTOP_SHELF_MQ = "(min-width: 900px)";
const MAP_SHELF_CLICK_SLOP_PX = 6;

function isDesktopShelf(): boolean {
  return window.matchMedia(DESKTOP_SHELF_MQ).matches;
}

/** Extra XZ travel past the map AABB, as a fraction of max(width, depth). */
const PAN_LIMIT_PAD = 0.1;

/** Cone stem height in map-local units (map spans ~1 unit). */
const PIN_CONE_HEIGHT = 0.055;
const PIN_CONE_RADIUS = 0.011;
const PIN_COLOR = 0x991e72;
const PIN_COLOR_ACTIVE = 0x74c8cb;

type Point2D = { x: number; y: number };

type PinStem = {
  overlay: CardOverlay;
  group: THREE.Group;
  cone: THREE.Mesh;
  pinMat: THREE.MeshStandardMaterial;
  pinMatActive: THREE.MeshStandardMaterial;
  revealAlpha: number;
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

export function initMapViewer(
  root: HTMLElement,
  options: ExperienceViewOptions = {}
): () => void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#e8e2d8");
  document.title = "Map Viewer · Wavemakers";

  root.innerHTML = `
    <div class="map-viewer map-viewer--gradual-reveal ar-app">
      <div id="map-viewer-canvas" class="map-viewer__canvas-wrap"></div>
      ${buildArChromeHtml()}
      <p id="map-viewer-status" class="map-viewer__status" data-state="loading">Loading map…</p>
      <button type="button" class="map-viewer__reveal-replay" id="map-viewer-replay-reveal">
        Replay reveal
      </button>
      <div id="ar-sheet-backdrop" class="ar-sheet-backdrop" hidden aria-hidden="true"></div>
      <aside id="ar-sheet" class="ar-sheet" hidden aria-hidden="true" role="dialog" aria-modal="true">
        <div class="ar-sheet__handle" aria-hidden="true">
          <span class="ar-sheet__grabber"></span>
        </div>
        <button type="button" class="ar-sheet__close" aria-label="Close">×</button>
        <div id="ar-sheet-content" class="ar-sheet__body"></div>
      </aside>
    </div>
  `;

  const appEl = root.querySelector(".map-viewer") as HTMLElement;
  const canvasWrap = root.querySelector("#map-viewer-canvas") as HTMLElement;
  const statusEl = root.querySelector("#map-viewer-status") as HTMLElement;
  const replayRevealBtn = root.querySelector("#map-viewer-replay-reveal") as HTMLButtonElement;
  const sheetBackdrop = root.querySelector("#ar-sheet-backdrop") as HTMLElement;
  const sheetEl = root.querySelector("#ar-sheet") as HTMLElement;
  const sheetContent = root.querySelector("#ar-sheet-content") as HTMLElement;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8e2d8);

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
  controls.screenSpacePanning = false;
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
    transparent: true,
  });
  const pinMatActive = new THREE.MeshStandardMaterial({
    color: PIN_COLOR_ACTIVE,
    roughness: 0.35,
    metalness: 0.08,
    transparent: true,
  });

  const panLimit = new THREE.Box3();
  let panLimitReady = false;
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
  let mapPulse: MapPulseController | null = null;
  let mapReady = false;
  let disposed = false;
  let pulseCycleActive = false;
  let hoveredOverlay: CardOverlay | null = null;
  let lastPointer: Point2D | null = null;
  const hoverRaycaster = new THREE.Raycaster();
  const hoverNdc = new THREE.Vector2();
  const pinWorld = new THREE.Vector3();

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
      setHoveredOverlay(null);
      syncPinReveal();
      syncChromeVisibility();
      syncControlsEnabled();
    },
    onDismiss: () => {
      appEl.classList.remove("ar-app--sheet-open");
      document.documentElement.classList.remove("ar-sheet-open");
      syncPinReveal();
      syncChromeVisibility();
      syncControlsEnabled();
    },
  });

  chromeUi = wireArChrome(root, {
    getCards: () => allCards,
    onCardTypeChange: (type) => {
      if (cardTypeFilter === type) return;
      cardTypeFilter = type;
      rebuildOverlays();
      if (mapReady) replayPulse();
    },
    onFiltersChange: () => {
      rebuildOverlays();
    },
    onSelectCard: (card) => {
      detailSheet.show(card);
    },
    onHome: () => {
      const steps = detailSheet.isOpen() ? 2 : 1;
      if (options.onExit) options.onExit(steps);
      else window.location.assign("/");
    },
  });

  function visibleCards(): InfoCard[] {
    return chromeUi ? chromeUi.filterCards(allCards) : allCards;
  }

  function hidesPinsForSheet(): boolean {
    return detailSheet.isOpen() && !isDesktopShelf();
  }

  function syncChromeVisibility(): void {
    const visible = mapReady && !hidesPinsForSheet();
    chromeUi?.setVisible(visible);
    appEl.classList.toggle("ar-app--chrome", visible);
  }

  function syncControlsEnabled(): void {
    const block = hidesPinsForSheet() || Boolean(chromeUi?.isPanelOpen());
    controls.enabled = !block;
  }

  function clampControlsPan(): void {
    if (!panLimitReady) return;
    const t = controls.target;
    const x = THREE.MathUtils.clamp(t.x, panLimit.min.x, panLimit.max.x);
    const y = THREE.MathUtils.clamp(t.y, panLimit.min.y, panLimit.max.y);
    const z = THREE.MathUtils.clamp(t.z, panLimit.min.z, panLimit.max.z);
    const dx = x - t.x;
    const dy = y - t.y;
    const dz = z - t.z;
    if (dx === 0 && dy === 0 && dz === 0) return;
    t.set(x, y, z);
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
  }

  function clearPinStems(): void {
    for (const stem of pinStems) {
      mapContent.remove(stem.group);
      stem.cone.geometry.dispose();
      stem.pinMat.dispose();
      stem.pinMatActive.dispose();
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

    const idleMat = pinMat.clone();
    const activeMat = pinMatActive.clone();

    // Tip at local y=0 (on surface); wide end under the CSS2D marker head.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(PIN_CONE_RADIUS, PIN_CONE_HEIGHT, 20),
      idleMat,
    );
    cone.rotation.x = Math.PI;
    cone.position.y = PIN_CONE_HEIGHT / 2;
    cone.castShadow = false;
    cone.receiveShadow = false;
    group.add(cone);
    mapContent.add(group);

    return { overlay, group, cone, pinMat: idleMat, pinMatActive: activeMat, revealAlpha: 0 };
  }

  function pinRevealAlphaForStem(stem: PinStem): number {
    if (stem.overlay.group.cards.some((card) => isStJohnsCard(card))) {
      stem.revealAlpha = 1;
      return 1;
    }
    if (!mapPulse || !pulseCycleActive) return 1;
    const dist = stem.group.getWorldPosition(pinWorld).distanceTo(mapPulse.getCenterWorld());
    const next = pulseRevealAlpha(
      dist,
      mapPulse.getPulseDistance(),
      mapPulse.getPulseRange(),
      mapPulse.getPulseCount(),
    );
    stem.revealAlpha = Math.max(stem.revealAlpha, next);
    return stem.revealAlpha;
  }

  function syncPinReveal(): void {
    const hide = hidesPinsForSheet();
    for (const stem of pinStems) {
      const alpha = hide ? 0 : pinRevealAlphaForStem(stem);
      const visible = alpha > 0.02;
      stem.overlay.markerObject.visible = visible;
      stem.group.visible = visible;
      if (!visible) {
        stem.overlay.marker.classList.remove("ar-card__marker--active", "ar-card__marker--revealed");
        stem.overlay.panel.classList.remove("ar-card__panel--visible");
        stem.overlay.marker.style.removeProperty("--pin-reveal-alpha");
        continue;
      }
      stem.overlay.marker.style.setProperty("--pin-reveal-alpha", alpha.toFixed(3));
      if (!stem.overlay.marker.classList.contains("ar-card__marker--revealed")) {
        stem.overlay.marker.classList.add("ar-card__marker--revealed");
      }
      const active = stem.overlay === hoveredOverlay;
      stem.cone.material = active ? stem.pinMatActive : stem.pinMat;
      stem.pinMat.opacity = alpha;
      stem.pinMatActive.opacity = alpha;
    }
  }

  function replayPulse(): void {
    for (const stem of pinStems) stem.revealAlpha = 0;
    if (!mapPulse) {
      pulseCycleActive = false;
      syncPinReveal();
      return;
    }
    pulseCycleActive = true;
    mapPulse.startPulse(undefined, () => {
      pulseCycleActive = false;
      syncPinReveal();
    });
    syncPinReveal();
  }

  function waitForAnimationFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  /** Compile pulse shaders and present a map frame before the clock starts. */
  async function waitUntilMapVisible(): Promise<void> {
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      await waitForAnimationFrame();
      renderer.render(scene, camera);
      cssRenderer.render(scene, camera);
      if (!mapPulse || mapPulse.water.shader) break;
    }
    await waitForAnimationFrame();
  }

  function openOverlayShelf(overlay: CardOverlay): void {
    if (overlay.group.cards.length === 1) {
      detailSheet.show(overlay.group.cards[0]);
    }
  }

  function wirePopupClick(overlay: CardOverlay): void {
    overlay.marker.addEventListener("click", (event) => {
      event.stopPropagation();
      openOverlayShelf(overlay);
    });

    overlay.panel.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a")) return;
      event.stopPropagation();

      if (overlay.group.cards.length === 1) {
        openOverlayShelf(overlay);
        return;
      }

      const entry = (event.target as HTMLElement).closest("[data-card-id]");
      const cardId = entry instanceof HTMLElement ? entry.dataset.cardId : undefined;
      if (!cardId) return;
      const card = overlay.group.cards.find((item) => item.id === cardId);
      if (card) detailSheet.show(card);
    });
  }

  function getMarkerGeometry(overlay: CardOverlay): { center: Point2D; radius: number } | null {
    const rect = overlay.marker.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      radius: Math.max(rect.width, rect.height) / 2,
    };
  }

  function isPointerOnPin(overlay: CardOverlay, x: number, y: number): boolean {
    const geo = getMarkerGeometry(overlay);
    if (!geo) return false;
    return Math.hypot(x - geo.center.x, y - geo.center.y) <= geo.radius;
  }

  function findConeUnderPointer(x: number, y: number): CardOverlay | null {
    const canvas = renderer.domElement.getBoundingClientRect();
    if (canvas.width <= 0 || canvas.height <= 0) return null;
    hoverNdc.set(
      ((x - canvas.left) / canvas.width) * 2 - 1,
      -((y - canvas.top) / canvas.height) * 2 + 1,
    );
    hoverRaycaster.setFromCamera(hoverNdc, camera);
    const cones = pinStems.filter((stem) => stem.group.visible).map((stem) => stem.cone);
    if (cones.length === 0) return null;
    const hits = hoverRaycaster.intersectObjects(cones, false);
    if (hits.length === 0) return null;
    const stem = pinStems.find((entry) => entry.cone === hits[0].object);
    return stem?.overlay ?? null;
  }

  function isPointerInPinSafeZone(overlay: CardOverlay, x: number, y: number): boolean {
    if (isPointerOnPin(overlay, x, y)) return true;

    const panelRect = overlay.panel.getBoundingClientRect();
    if (panelRect.width <= 0 || panelRect.height <= 0) return false;

    const geo = getMarkerGeometry(overlay);
    const pinFarX = geo ? geo.center.x - geo.radius : panelRect.left;
    // Popup is to the right: extend the pin-facing top/bottom edges to the far side of the pin.
    const left = Math.min(pinFarX, panelRect.left);
    return x >= left && x <= panelRect.right && y >= panelRect.top && y <= panelRect.bottom;
  }

  function findPinUnderPointer(x: number, y: number): CardOverlay | null {
    let closest: { overlay: CardOverlay; dist: number } | null = null;
    for (const overlay of overlays) {
      if (!overlay.markerObject.visible) continue;
      const geo = getMarkerGeometry(overlay);
      if (!geo) continue;
      const dist = Math.hypot(x - geo.center.x, y - geo.center.y);
      if (dist <= geo.radius && (!closest || dist < closest.dist)) {
        closest = { overlay, dist };
      }
    }
    if (closest) return closest.overlay;
    return findConeUnderPointer(x, y);
  }

  function pickHoveredOverlay(x: number, y: number): CardOverlay | null {
    if (hoveredOverlay && isPointerInPinSafeZone(hoveredOverlay, x, y)) {
      return hoveredOverlay;
    }
    return findPinUnderPointer(x, y);
  }

  function setHoveredOverlay(next: CardOverlay | null): void {
    if (hoveredOverlay === next) return;
    for (const overlay of overlays) {
      const isActive = overlay === next;
      overlay.marker.classList.toggle("ar-card__marker--active", isActive);
      overlay.panel.classList.toggle("ar-card__panel--visible", isActive);
      if (!isActive) overlay.selectedCardId = null;
    }
    hoveredOverlay = next;
    syncPinReveal();
  }

  function refreshHover(): void {
    if (!mapReady || chromeUi?.isPanelOpen() || !lastPointer) {
      setHoveredOverlay(null);
      return;
    }
    if (hidesPinsForSheet()) {
      setHoveredOverlay(null);
      return;
    }
    setHoveredOverlay(pickHoveredOverlay(lastPointer.x, lastPointer.y));
  }

  function onPointerMove(event: PointerEvent): void {
    lastPointer = { x: event.clientX, y: event.clientY };
    refreshHover();
  }

  function onPointerLeave(): void {
    lastPointer = null;
    setHoveredOverlay(null);
  }

  function onPopupWheel(event: WheelEvent): void {
    if (event.target instanceof Element && event.target.closest(".ar-sheet")) return;
    if (!hoveredOverlay) return;
    const panel = hoveredOverlay.panel;
    if (panel.scrollHeight <= panel.clientHeight + 1) return;
    if (panel.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    panel.scrollTop += event.deltaY;
  }

  function pinPositionForOverlay(overlay: CardOverlay): THREE.Vector3 {
    // Same space as /admin: stored mapX/mapY → admin crop → land world AABB.
    if (pinBounds) {
      return mapXYToModelLocal(overlay.group.mapX, overlay.group.mapY, pinBounds, 0);
    }
    return new THREE.Vector3();
  }

  function rebuildOverlays(): void {
    if (!pinBounds) return;
    if (detailSheet.isOpen()) {
      detailSheet.dismiss();
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
      wirePopupClick(overlay);
    }
    hoveredOverlay = null;
    syncPinReveal();
    refreshHover();
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
      const pad = fit * PAN_LIMIT_PAD;
      panLimit.min.set(mapBounds.min.x - pad, center.y, mapBounds.min.z - pad);
      panLimit.max.set(mapBounds.max.x + pad, center.y, mapBounds.max.z + pad);
      panLimitReady = true;
      controls.update();
      clampControlsPan();

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
        pulseRoot.traverse((obj) => {
          obj.raycast = () => {};
        });
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
      } catch (pulseErr) {
        console.warn("Map pulse setup failed", pulseErr);
      }

      rebuildOverlays();
      if (mapPulse) {
        pulseCycleActive = true;
        syncPinReveal();
      }
      await waitUntilMapVisible();
      if (disposed || !root.contains(canvasWrap)) return;
      mapReady = true;
      syncChromeVisibility();
      replayPulse();

      statusEl.textContent = "Ready";
      statusEl.dataset.state = "ready";
      window.setTimeout(() => {
        statusEl.hidden = true;
      }, 1200);
      options.onReady?.();
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        err instanceof Error ? err.message : "Failed to load map model";
      statusEl.dataset.state = "error";
      if (!disposed) options.onFailed?.();
    }
  })();

  const resize = (): void => {
    const w = canvasWrap.clientWidth || window.innerWidth;
    const h = canvasWrap.clientHeight || window.innerHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    cssRenderer.setSize(w, h);
    syncPinReveal();
    syncChromeVisibility();
    syncControlsEnabled();
  };
  resize();
  window.addEventListener("resize", resize);

  const onPopState = (): void => {
    if (detailSheet.isOpen()) {
      detailSheet.dismissFromHistory();
    }
  };
  window.addEventListener("popstate", onPopState);

  let mapPointer: Point2D & { id: number } | null = null;
  const onMapPointerDown = (event: PointerEvent): void => {
    mapPointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const onMapPointerUp = (event: PointerEvent): void => {
    if (!mapPointer || mapPointer.id !== event.pointerId) return;
    const dx = event.clientX - mapPointer.x;
    const dy = event.clientY - mapPointer.y;
    mapPointer = null;
    if (Math.hypot(dx, dy) > MAP_SHELF_CLICK_SLOP_PX) return;

    const pin = findPinUnderPointer(event.clientX, event.clientY);
    if (pin) {
      openOverlayShelf(pin);
      return;
    }
    if (detailSheet.isOpen() && isDesktopShelf()) {
      detailSheet.dismiss();
    }
  };
  renderer.domElement.addEventListener("pointerdown", onMapPointerDown);
  renderer.domElement.addEventListener("pointerup", onMapPointerUp);

  // Keep orbit locked while chrome search/filter panels are open.
  root.addEventListener("click", () => {
    syncControlsEnabled();
  });
  root.addEventListener("input", () => {
    syncControlsEnabled();
  });
  appEl.addEventListener("pointermove", onPointerMove);
  appEl.addEventListener("pointerleave", onPointerLeave);
  appEl.addEventListener("wheel", onPopupWheel, { capture: true, passive: false });

  replayRevealBtn.addEventListener("click", () => {
    if (!mapReady) return;
    setHoveredOverlay(null);
    replayPulse();
  });

  let frame = 0;
  const tick = (): void => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    controls.update();
    clampControlsPan();
    syncControlsEnabled();
    if (pulseCycleActive) {
      syncPinReveal();
    }

    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
    refreshHover();
  };
  tick();

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("pointerdown", unlockAudioOnce);
    renderer.domElement.removeEventListener("pointerdown", onMapPointerDown);
    renderer.domElement.removeEventListener("pointerup", onMapPointerUp);
    appEl.removeEventListener("pointermove", onPointerMove);
    appEl.removeEventListener("pointerleave", onPointerLeave);
    appEl.removeEventListener("wheel", onPopupWheel, { capture: true });
    mapPulse?.dispose();
    mapPulse = null;
    controls.dispose();
    renderer.dispose();
    pinMat.dispose();
    pinMatActive.dispose();
    clearPinStems();
    cssRenderer.domElement.remove();
    document.documentElement.classList.remove("ar-sheet-open");
    detailSheet.destroy();
    observer.disconnect();
  };

  const observer = new MutationObserver(() => {
    if (root.contains(canvasWrap)) return;
    dispose();
  });
  observer.observe(root, { childList: true });

  return dispose;
}
