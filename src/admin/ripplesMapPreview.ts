import * as THREE from "three";
import { createRipplesEffect, type RipplesEffect } from "../ar/ripplesEffect";
import { MAP_ADMIN_CROP, MAP_REFERENCE_PATH, type RipplesVariant } from "../shared/types";

export interface RipplesMapPreview {
  canvas: HTMLCanvasElement;
  setOrigin: (mapX: number, mapY: number) => void;
  setVariant: (variant: RipplesVariant) => void;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
}

function loadMapTexture(url: string): Promise<THREE.Texture> {
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

/** Frame the full-map plane so the visible view matches the admin crop. */
function applyAdminCropCamera(
  camera: THREE.OrthographicCamera,
  mapHeight: number
): void {
  const cropLeft = MAP_ADMIN_CROP.x / MAP_ADMIN_CROP.originalWidth;
  const cropTop = MAP_ADMIN_CROP.y / MAP_ADMIN_CROP.originalHeight;
  const cropW = MAP_ADMIN_CROP.width / MAP_ADMIN_CROP.originalWidth;
  const cropH = MAP_ADMIN_CROP.height / MAP_ADMIN_CROP.originalHeight;

  const centerX = cropLeft + cropW / 2 - 0.5;
  const centerY = mapHeight / 2 - (cropTop + cropH / 2) * mapHeight;
  const halfW = cropW / 2;
  const halfH = (cropH * mapHeight) / 2;

  camera.left = centerX - halfW;
  camera.right = centerX + halfW;
  camera.top = centerY + halfH;
  camera.bottom = centerY - halfH;
  camera.updateProjectionMatrix();
}

/**
 * Admin calibrate preview: full-map + ripples shader (same as AR), framed to the
 * admin crop so the panel matches calibration-points dimensions.
 */
export async function createRipplesMapPreview(
  host: HTMLElement,
  options: {
    variant: RipplesVariant;
    originMapX: number;
    originMapY: number;
  }
): Promise<RipplesMapPreview> {
  const fullAspect = MAP_ADMIN_CROP.originalWidth / MAP_ADMIN_CROP.originalHeight;
  const mapHeight = 1 / fullAspect;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  });
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = true;

  const canvas = renderer.domElement;
  canvas.className = "map-editor__ripples-canvas";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, mapHeight / 2, -mapHeight / 2, 0.1, 10);
  camera.position.z = 1;
  applyAdminCropCamera(camera, mapHeight);

  const mapTexture = await loadMapTexture(MAP_REFERENCE_PATH);
  const mapGeometry = new THREE.PlaneGeometry(1, mapHeight);
  const mapMaterial = new THREE.MeshBasicMaterial({ map: mapTexture });
  const mapMesh = new THREE.Mesh(mapGeometry, mapMaterial);
  scene.add(mapMesh);

  const effect: RipplesEffect = await createRipplesEffect(
    fullAspect,
    options.variant,
    options.originMapX,
    options.originMapY
  );
  effect.mesh.position.z = 0.002;
  effect.setLooping(true);
  effect.start();
  mapMesh.add(effect.mesh);

  let disposed = false;
  let rafId = 0;

  const renderFrame = (): void => {
    if (disposed) return;
    effect.update();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(renderFrame);
  };
  rafId = requestAnimationFrame(renderFrame);

  return {
    canvas,
    setOrigin(mapX: number, mapY: number) {
      effect.setOrigin(mapX, mapY);
    },
    setVariant(variant: RipplesVariant) {
      effect.setVariant(variant);
    },
    setSize(width: number, height: number) {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      effect.dispose();
      mapGeometry.dispose();
      mapMaterial.dispose();
      mapTexture.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
