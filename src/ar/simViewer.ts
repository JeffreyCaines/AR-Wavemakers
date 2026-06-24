import "./styles.css";
import "./simViewer.css";
import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { renderAdminLogin } from "../admin/login";
import { fetchActiveCards, getAdminToken } from "../shared/api";
import { loadMapAspectRatio } from "../shared/geo";
import { DEFAULT_MAP_ASPECT_RATIO, MAP_REFERENCE_PATH } from "../shared/types";
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

const ORIENTATION_STORAGE_KEY = "ar_preview_orientation";
const CAMERA_DISTANCE = 1.5;
const PITCH_LIMIT = THREE.MathUtils.degToRad(30);

type SimOrientation = "portrait" | "landscape";

export function initArSimViewer(root: HTMLElement): void {
  if (!getAdminToken()) {
    renderAdminLogin(root, {
      title: "AR Preview",
      subtitle: "Sign in to preview the AR experience on desktop.",
      onSuccess: () => renderSimViewer(root),
    });
    return;
  }
  renderSimViewer(root);
}

function renderSimViewer(root: HTMLElement): void {
  const initialOrientation = loadOrientation();

  root.innerHTML = `
    <div class="ar-sim">
      <div class="ar-sim__chrome">
        <a href="/admin" class="ar-sim__back">← Back to admin</a>
        <button type="button" id="ar-sim-orientation-toggle" class="ar-sim__orientation-toggle" aria-pressed="false">
          Switch to landscape
        </button>
      </div>
      <p class="ar-sim__hint">Drag inside the phone frame to move around the map.</p>
      <div class="ar-sim__stage">
        <div id="ar-sim-device" class="ar-sim-device ar-sim-device--${initialOrientation}">
          <div class="ar-app ar-app--running ar-app--sim">
            <div id="ar-container" class="ar-container"></div>
            <div class="ar-ui">
              <div class="ar-instructions">
                <header class="ar-header ar-header--compact">
                  <h1>NL World Map AR</h1>
                  <p class="ar-subtitle">Desktop preview</p>
                </header>
                <div id="ar-status" class="ar-status ar-status--tracking">Loading…</div>
              </div>
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
        </div>
      </div>
    </div>
  `;

  const deviceEl = root.querySelector("#ar-sim-device") as HTMLElement;
  const orientationToggle = root.querySelector("#ar-sim-orientation-toggle") as HTMLButtonElement;
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
    },
    onDismiss: () => {
      activeCardTracker?.resetSheetTimer();
      arApp.classList.remove("ar-app--sheet-open");
    },
  });

  let activeCardTracker: ActiveCardTracker | null = null;
  let overlays: CardOverlay[] = [];
  let aspectRatio = DEFAULT_MAP_ASPECT_RATIO;
  let renderer: THREE.WebGLRenderer | null = null;
  let cssRenderer: CSS2DRenderer | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let scene: THREE.Scene | null = null;

  let cameraYaw = 0;
  let cameraPitch = 0;
  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartYaw = 0;
  let dragStartPitch = 0;

  const onPopState = (): void => {
    if (detailSheet.isOpen()) {
      detailSheet.dismissFromHistory();
      activeCardTracker?.resetSheetTimer();
    }
  };
  window.addEventListener("popstate", onPopState);

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

  function updateCameraPosition(): void {
    if (!camera) return;
    const x = CAMERA_DISTANCE * Math.sin(cameraYaw) * Math.cos(cameraPitch);
    const y = CAMERA_DISTANCE * Math.sin(cameraPitch);
    const z = CAMERA_DISTANCE * Math.cos(cameraYaw) * Math.cos(cameraPitch);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (detailSheet.isOpen()) return;
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
    cameraYaw = dragStartYaw - dx * 0.005;
    cameraPitch = THREE.MathUtils.clamp(dragStartPitch + dy * 0.005, -PITCH_LIMIT, PITCH_LIMIT);
    updateCameraPosition();
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

  void bootstrap();

  async function bootstrap(): Promise<void> {
    try {
      aspectRatio = await loadMapAspectRatio(MAP_REFERENCE_PATH, DEFAULT_MAP_ASPECT_RATIO);
      const cards = await fetchActiveCards();
      await initScene(cards);
      statusEl.textContent = "Map detected. Aim at a location.";
      statusEl.classList.add("ar-status--tracking");
    } catch {
      statusEl.textContent = "Could not load cards. Check your connection.";
      statusEl.classList.remove("ar-status--tracking");
    }
  }

  async function initScene(cards: InfoCard[]): Promise<void> {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
    updateCameraPosition();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    cssRenderer = new CSS2DRenderer();
    cssRenderer.domElement.className = "ar-css-renderer";
    container.appendChild(cssRenderer.domElement);

    const texture = await loadTexture(MAP_REFERENCE_PATH);
    const mapHeight = 1 / aspectRatio;
    const mapGeometry = new THREE.PlaneGeometry(1, mapHeight);
    const mapMaterial = new THREE.MeshBasicMaterial({ map: texture });
    const mapMesh = new THREE.Mesh(mapGeometry, mapMaterial);
    scene.add(mapMesh);

    const anchorGroup = new THREE.Group();
    mapMesh.add(anchorGroup);

    overlays = cards.map((card) => createCardOverlay(card, aspectRatio));
    overlays.forEach(({ markerObject, panelObject }) => {
      anchorGroup.add(markerObject);
      anchorGroup.add(panelObject);
    });

    activeCardTracker = createActiveCardTracker(detailSheet);

    onResize();

    const render = (): void => {
      if (!renderer || !cssRenderer || !scene || !camera) return;
      updateTrackingUI(statusEl, true);
      const activeCard = updatePointing(overlays, camera, detailSheet.isOpen());
      activeCardTracker?.handleActiveCard(activeCard);
      cssRenderer.render(scene, camera);
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    render();
  }
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
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
