import * as THREE from "three";
import { loadArMapModel } from "../map/loadArMapModel";
import {
  applyMapDesktopAppearance,
  loadDesktopEnvironmentMap,
} from "../map/mapDesktopAppearance";
import { MAP_ADMIN_CROP } from "../shared/types";

export type MapModelView = {
  viewportWidth: number;
  viewportHeight: number;
  stageWidth: number;
  stageHeight: number;
  scale: number;
  translateX: number;
  translateY: number;
};

export type MapModelBackdrop = {
  canvas: HTMLCanvasElement;
  /** Land-plate width used for stage aspect (matches admin crop space). */
  aspectWidth: number;
  /** Land-plate depth used for stage aspect. */
  aspectHeight: number;
  /**
   * Keep the GPU buffer at viewport size and move the ortho frustum to match
   * the CSS pan/zoom (same cost model as /map-viewer).
   */
  syncView: (view: MapModelView) => void;
  /** Detach from the current host; keep the shared GPU resources warm. */
  dispose: () => void;
};

type SharedBackdrop = {
  canvas: HTMLCanvasElement;
  aspectWidth: number;
  aspectHeight: number;
  syncView: (view: MapModelView) => void;
  retainers: number;
};

let shared: SharedBackdrop | null = null;
let sharedPromise: Promise<SharedBackdrop> | null = null;

async function createSharedBackdrop(): Promise<SharedBackdrop> {
  const canvas = document.createElement("canvas");
  canvas.className = "map-editor__model";
  canvas.setAttribute("aria-label", "3D map (top-down)");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3efe8);

  scene.add(new THREE.AmbientLight(0xfff1e6, 0.75));
  scene.add(new THREE.HemisphereLight(0xfff5eb, 0xe0d4c4, 0.55));
  const key = new THREE.DirectionalLight(0xffe8d2, 1.1);
  key.position.set(2.4, 4.2, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xf3e6d6, 0.4);
  fill.position.set(-2.2, 1.8, -2.0);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xfff8f0, 0.25);
  rim.position.set(-1.2, 3.5, 2.8);
  scene.add(rim);

  const [model, envMap] = await Promise.all([
    loadArMapModel(2.2),
    loadDesktopEnvironmentMap(),
  ]);
  if (envMap) scene.environment = envMap;

  // Same seam + matte atlas treatment as /map-viewer (geometry is still local Z-up).
  await applyMapDesktopAppearance(model.root);
  scene.add(model.root);

  const pinBounds = model.pinBounds;
  const size = pinBounds.getSize(new THREE.Vector3());
  const center = pinBounds.getCenter(new THREE.Vector3());
  const aspectWidth = size.x > 1e-6 ? size.x : MAP_ADMIN_CROP.width;
  const aspectHeight = size.z > 1e-6 ? size.z : MAP_ADMIN_CROP.height;
  const minX = pinBounds.min.x;
  const minZ = pinBounds.min.z;
  const sizeX = aspectWidth;
  const sizeZ = aspectHeight;
  const camHeight = Math.max(aspectWidth, aspectHeight) * 2;

  const camera = new THREE.OrthographicCamera(
    -aspectWidth / 2,
    aspectWidth / 2,
    aspectHeight / 2,
    -aspectHeight / 2,
    0.01,
    50
  );
  // up = -Z so screen top is geographic north (mapY = 0 → min.z).
  camera.position.set(center.x, center.y + camHeight, center.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  let lastBufferW = 0;
  let lastBufferH = 0;

  const render = (): void => {
    renderer.render(scene, camera);
  };

  const syncView = (view: MapModelView): void => {
    const {
      viewportWidth,
      viewportHeight,
      stageWidth,
      stageHeight,
      scale,
      translateX,
      translateY,
    } = view;
    if (viewportWidth < 1 || viewportHeight < 1 || stageWidth < 1 || stageHeight < 1) return;

    const cssW = Math.max(1, Math.round(viewportWidth));
    const cssH = Math.max(1, Math.round(viewportHeight));
    if (cssW !== lastBufferW || cssH !== lastBufferH) {
      lastBufferW = cssW;
      lastBufferH = cssH;
      renderer.setSize(cssW, cssH, false);
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
    }

    // Stage pixels visible through the viewport after CSS translate/scale.
    const inv = 1 / Math.max(scale, 1e-6);
    const stageLeft = (0 - translateX) * inv;
    const stageTop = (0 - translateY) * inv;
    const stageRight = (viewportWidth - translateX) * inv;
    const stageBottom = (viewportHeight - translateY) * inv;

    const u0 = stageLeft / stageWidth;
    const u1 = stageRight / stageWidth;
    const v0 = stageTop / stageHeight;
    const v1 = stageBottom / stageHeight;

    const x0 = minX + u0 * sizeX;
    const x1 = minX + u1 * sizeX;
    const z0 = minZ + v0 * sizeZ;
    const z1 = minZ + v1 * sizeZ;
    const viewCenterX = (x0 + x1) * 0.5;
    const viewCenterZ = (z0 + z1) * 0.5;
    const halfW = (x1 - x0) * 0.5;
    const halfH = (z1 - z0) * 0.5;

    camera.position.set(viewCenterX, center.y + camHeight, viewCenterZ);
    camera.lookAt(viewCenterX, center.y, viewCenterZ);
    camera.left = -halfW;
    camera.right = halfW;
    // up = -Z: positive camera Y points toward smaller world Z (north / mapY=0).
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    render();
  };

  return {
    canvas,
    aspectWidth,
    aspectHeight,
    retainers: 0,
    syncView,
  };
}

function getSharedBackdrop(): Promise<SharedBackdrop> {
  if (shared) return Promise.resolve(shared);
  if (!sharedPromise) {
    sharedPromise = createSharedBackdrop()
      .then((value) => {
        shared = value;
        return value;
      })
      .catch((error) => {
        sharedPromise = null;
        throw error;
      });
  }
  return sharedPromise;
}

/**
 * Top-down orthographic view of the AR map model.
 * Canvas sits on the viewport (not inside the CSS-scaled stage). Pan/zoom move
 * the camera frustum so cost stays viewport-sized like /map-viewer.
 */
export async function mountMapModelBackdrop(
  host: HTMLElement,
  beforeNode: Node | null = null,
  isCancelled: () => boolean = () => false
): Promise<MapModelBackdrop> {
  const backdrop = await getSharedBackdrop();
  if (isCancelled()) {
    return {
      canvas: backdrop.canvas,
      aspectWidth: backdrop.aspectWidth,
      aspectHeight: backdrop.aspectHeight,
      syncView: () => undefined,
      dispose: () => undefined,
    };
  }

  backdrop.retainers += 1;
  host.insertBefore(backdrop.canvas, beforeNode);

  return {
    canvas: backdrop.canvas,
    aspectWidth: backdrop.aspectWidth,
    aspectHeight: backdrop.aspectHeight,
    syncView: backdrop.syncView,
    dispose(): void {
      backdrop.retainers = Math.max(0, backdrop.retainers - 1);
      if (backdrop.canvas.parentElement === host) {
        backdrop.canvas.remove();
      }
    },
  };
}
