import * as THREE from "three";
import { loadArMapModel, landLocalToRootLocal, latLngToLandLocal, loadLatLongDistortion } from "../map/loadArMapModel";
import {
  applyMapDesktopAppearance,
  loadDesktopEnvironmentMap,
} from "../map/mapDesktopAppearance";
import {
  createMapPulseController,
  MAP_PULSE_ORIGIN_LAT,
  MAP_PULSE_ORIGIN_LNG,
  type MapPulseController,
} from "../map/mapPulseController";
import { MAP_ADMIN_CROP } from "../shared/types";
import { bakeLayer7RippleMasks, type Layer7RippleMasks } from "./modelRippleMasks";

const MODEL_PULSE_REPEAT_DELAY_MS = 1500;

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
  /** Water-layer + land masks for the /admin ripples shader. */
  rippleMasks: Layer7RippleMasks;
  /** Play the 3D model pulse shader on a loop, or hide it. */
  setModelPulseLoop: (enabled: boolean) => void;
  /** Detach from the current host; keep the shared GPU resources warm. */
  dispose: () => void;
};

type SharedBackdrop = {
  canvas: HTMLCanvasElement;
  aspectWidth: number;
  aspectHeight: number;
  syncView: (view: MapModelView) => void;
  rippleMasks: Layer7RippleMasks;
  setModelPulseLoop: (enabled: boolean) => void;
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

  const rippleMasks = bakeLayer7RippleMasks(model.root, pinBounds);

  let lastBufferW = 0;
  let lastBufferH = 0;

  const render = (): void => {
    renderer.render(scene, camera);
  };

  let pulse: MapPulseController | null = null;
  let pulseRoot: THREE.Object3D | null = null;
  let pulseWanted = false;
  let pulseLooping = false;
  let pulseRepeatTimer = 0;
  let pulseRenderRaf = 0;
  let pulseSetup: Promise<void> | null = null;

  const stopPulseRenderLoop = (): void => {
    if (pulseRenderRaf) {
      cancelAnimationFrame(pulseRenderRaf);
      pulseRenderRaf = 0;
    }
  };

  const startPulseRenderLoop = (): void => {
    stopPulseRenderLoop();
    const tick = (): void => {
      if (!pulseLooping) return;
      render();
      pulseRenderRaf = requestAnimationFrame(tick);
    };
    pulseRenderRaf = requestAnimationFrame(tick);
  };

  const stopModelPulseLoop = (): void => {
    pulseWanted = false;
    pulseLooping = false;
    window.clearTimeout(pulseRepeatTimer);
    pulseRepeatTimer = 0;
    stopPulseRenderLoop();
    pulse?.resetPulse();
    if (pulseRoot) pulseRoot.visible = false;
    render();
  };

  const playPulseCycle = (): void => {
    if (!pulseWanted || !pulse) return;
    pulse.startPulse(
      undefined,
      () => {
        if (!pulseWanted) return;
        pulseRepeatTimer = window.setTimeout(() => {
          playPulseCycle();
        }, MODEL_PULSE_REPEAT_DELAY_MS);
      },
      true
    );
  };

  const startModelPulseLoop = (): void => {
    if (!pulse || !pulseRoot) return;
    window.clearTimeout(pulseRepeatTimer);
    pulseRepeatTimer = 0;
    pulseLooping = true;
    pulseRoot.visible = true;
    playPulseCycle();
    startPulseRenderLoop();
  };

  const ensurePulse = (): Promise<void> => {
    if (pulse) return Promise.resolve();
    if (pulseSetup) return pulseSetup;
    pulseSetup = (async () => {
      const overlay = model.root.clone(true);
      overlay.name = "ar-map-pulse-overlay";
      overlay.position.set(0, 0, 0);
      overlay.rotation.set(0, 0, 0);
      overlay.scale.set(1, 1, 1);
      overlay.visible = false;
      overlay.traverse((obj) => {
        obj.raycast = () => undefined;
      });
      model.root.add(overlay);
      try {
        const controller = await createMapPulseController(overlay);
        model.root.updateMatrixWorld(true);
        const size = model.bounds.getSize(new THREE.Vector3());
        const fit = Math.max(size.x, size.z);
        controller.setPulseScale(fit * 0.55);
        if (model.land && model.landGeomBounds) {
          const distortion = await loadLatLongDistortion().catch(() => null);
          const landLocal = latLngToLandLocal(
            MAP_PULSE_ORIGIN_LAT,
            MAP_PULSE_ORIGIN_LNG,
            model.landGeomBounds,
            distortion
          );
          const rootLocal = landLocalToRootLocal(model.land, landLocal, model.root);
          controller.setCenterWorld(model.root.localToWorld(rootLocal));
        } else {
          controller.setCenterWorld(model.root.getWorldPosition(new THREE.Vector3()));
        }
        pulseRoot = overlay;
        pulse = controller;
      } catch (error) {
        overlay.removeFromParent();
        throw error;
      }
    })()
      .catch((error) => {
        pulseSetup = null;
        throw error;
      });
    return pulseSetup;
  };

  const setModelPulseLoop = (enabled: boolean): void => {
    if (!enabled) {
      stopModelPulseLoop();
      return;
    }
    pulseWanted = true;
    void ensurePulse()
      .then(() => {
        if (!pulseWanted) return;
        startModelPulseLoop();
      })
      .catch((error) => {
        console.warn("admin model pulse setup failed", error);
      });
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
    rippleMasks,
    setModelPulseLoop,
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    shared?.setModelPulseLoop(false);
    shared = null;
    sharedPromise = null;
  });
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
      rippleMasks: backdrop.rippleMasks,
      syncView: () => undefined,
      setModelPulseLoop: () => undefined,
      dispose: () => undefined,
    };
  }

  backdrop.retainers += 1;
  host.insertBefore(backdrop.canvas, beforeNode);

  return {
    canvas: backdrop.canvas,
    aspectWidth: backdrop.aspectWidth,
    aspectHeight: backdrop.aspectHeight,
    rippleMasks: backdrop.rippleMasks,
    syncView: backdrop.syncView,
    setModelPulseLoop: backdrop.setModelPulseLoop,
    dispose(): void {
      backdrop.setModelPulseLoop(false);
      backdrop.retainers = Math.max(0, backdrop.retainers - 1);
      if (backdrop.canvas.parentElement === host) {
        backdrop.canvas.remove();
      }
    },
  };
}
