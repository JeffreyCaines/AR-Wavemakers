import * as THREE from "three";
import { playArSound, stopArSound } from "../ar/sounds";
import { MapPulseLandMaterial, MapPulseWaterMaterial } from "./mapPulseMaterials";

const mapAssetUrls = import.meta.glob("./*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function mapAssetUrl(filename: string): string {
  const key = Object.keys(mapAssetUrls).find((path) =>
    path.replace(/\\/g, "/").endsWith(`/${filename}`)
  );
  if (!key) throw new Error(`Missing map asset: ${filename}`);
  return mapAssetUrls[key];
}

async function loadTexture(url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = colorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** Live lerp helper: clamp((a - e) / (t - e), 0, 1). */
function pulseLerp(start: number, end: number, value: number): number {
  return Math.min(1, Math.max(0, (value - start) / (end - start)));
}

export type MapPulseController = {
  /** St. John's world-space pulse origin (live uses 47.560533, -52.754796). */
  setCenterWorld: (center: THREE.Vector3) => void;
  /** Max pulse travel distance in world units (live `b.current`, default 1). */
  setPulseScale: (scale: number) => void;
  startPulse: (onMid?: () => void, onComplete?: () => void) => void;
  resetPulse: () => void;
  dispose: () => void;
  water: MapPulseWaterMaterial;
  land: MapPulseLandMaterial;
  nfld: MapPulseLandMaterial;
};

/**
 * Apply live pulse materials onto a seated TechNL map root and drive StartPulse.
 * Water layers → MapPulseWaterMaterial; land + NFLD → MapPulseLandMaterial.
 */
export async function createMapPulseController(
  mapRoot: THREE.Object3D
): Promise<MapPulseController> {
  const water = new MapPulseWaterMaterial();
  const land = new MapPulseLandMaterial();
  const nfld = new MapPulseLandMaterial();

  const [landCurvature, nfldCurvature, waterCurvature] = await Promise.all([
    loadTexture(mapAssetUrl("map_land_M_Curvature.jpg"), THREE.NoColorSpace),
    loadTexture(mapAssetUrl("map_nfld_M_Curvature.jpg"), THREE.NoColorSpace),
    loadTexture(mapAssetUrl("map_water_M_Curvature.jpg"), THREE.NoColorSpace),
  ]);

  mapRoot.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = mesh.name || "";
    const prev = mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    const map = "map" in prev ? prev.map : null;

    let next: MapPulseWaterMaterial | MapPulseLandMaterial;
    let aoMap: THREE.Texture | null = null;
    if (name.startsWith("Layer_")) {
      next = water;
      aoMap = waterCurvature;
    } else if (name.includes("NFLD") || name.toLowerCase().includes("nfld")) {
      next = nfld;
      aoMap = nfldCurvature;
    } else if (name.includes("land") || name.includes("Land")) {
      next = land;
      aoMap = landCurvature;
    } else {
      return;
    }

    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      next.map = map;
    }
    if (aoMap) {
      next.aoMap = aoMap;
      if (mesh.geometry.getAttribute("uv") && !mesh.geometry.getAttribute("uv2")) {
        mesh.geometry.setAttribute("uv2", mesh.geometry.getAttribute("uv"));
      }
    }
    next.needsUpdate = true;
    mesh.material = next;
    mesh.frustumCulled = false;
  });

  let pulseScale = 1;
  let rafId: number | null = null;
  let startedAt = 0;
  let onMidCb: (() => void) | null = null;
  let onCompleteCb: (() => void) | null = null;

  const resetPulse = (): void => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    stopArSound("pulse");
    water.fillPower = 0;
    land.fillPower = 0;
    nfld.fillPower = 0;
    water.pulseDistance = 0;
    water.pulseRange = 0;
    water.pulseCount = 0;
    water.pulseFill = 0.2;
    water.pulsePower = 0;
    onMidCb = null;
    onCompleteCb = null;
  };

  const tick = (): void => {
    const e = (Date.now() - startedAt) * 0.001;
    if (e < 1) {
      water.pulseRange = (1 - Math.cos(0.5 + 0.5 * pulseLerp(0, 1, e))) * 0.1 * pulseScale;
      water.pulseCount = 1;
      water.pulseDistance = pulseLerp(0, 1, e) * pulseScale;
      water.pulsePower = 1 - pulseLerp(0.9, 1, e);
      water.pulseFill = 0.5 * Math.sin(pulseLerp(0, 1, e) * Math.PI);
      const fill = 0.5 * Math.sin(pulseLerp(0, 1, e) * Math.PI);
      water.fillPower = land.fillPower = nfld.fillPower = fill;
    } else {
      if (onMidCb) {
        onMidCb();
        onMidCb = null;
      }
      water.pulseRange = (0.05 + (1 - Math.cos(0.5 + 0.5 * pulseLerp(1, 4, e)))) * pulseScale;
      water.pulseCount = 3;
      water.pulseDistance = 2 * pulseLerp(1, 4, e) * pulseScale;
      water.pulsePower = 1 - pulseLerp(1.8, 4, e);
      water.pulseFill = 1 - Math.cos(pulseLerp(1, 4, e) * Math.PI * 0.5);
      const fill = 0.5 * Math.sin(pulseLerp(1, 2, e) * Math.PI);
      water.fillPower = land.fillPower = nfld.fillPower = fill;
    }

    if (e < 4) {
      rafId = window.requestAnimationFrame(tick);
      return;
    }

    rafId = null;
    if (onCompleteCb) {
      onCompleteCb();
      onCompleteCb = null;
    }
  };

  const startPulse = (onMid?: () => void, onComplete?: () => void): void => {
    resetPulse();
    onMidCb = onMid ?? null;
    onCompleteCb = onComplete ?? null;
    playArSound("pulse");
    startedAt = Date.now();
    rafId = window.requestAnimationFrame(tick);
  };

  return {
    setCenterWorld(center) {
      water.center = center;
    },
    setPulseScale(scale) {
      pulseScale = Math.max(0.01, scale);
    },
    startPulse,
    resetPulse,
    dispose() {
      resetPulse();
      water.dispose();
      land.dispose();
      nfld.dispose();
      landCurvature.dispose();
      nfldCurvature.dispose();
      waterCurvature.dispose();
    },
    water,
    land,
    nfld,
  };
}

/** St. John's lat/lng used by live StartPulse origin. */
export const MAP_PULSE_ORIGIN_LAT = 47.560533;
export const MAP_PULSE_ORIGIN_LNG = -52.754796;
