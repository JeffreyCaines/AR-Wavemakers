import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mapXYOriginalToAdmin } from "../shared/geo";

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

function rewriteMapUrl(url: string): string {
  const name = url.split("/").pop()?.split("?")[0];
  if (!name) return url;
  const key = Object.keys(mapAssetUrls).find((path) =>
    path.replace(/\\/g, "/").endsWith(`/${name}`)
  );
  return key ? mapAssetUrls[key] : url;
}

/** Map is authored in XY with thin Z relief. Lay it flat on the XZ floor. */
function layMapFlat(root: THREE.Object3D): THREE.Box3 {
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

/**
 * AABB used for photo-space pin fallback. Prefer the land plate — its aspect
 * matches the admin cropped reference photo.
 */
export function getMapPinBounds(root: THREE.Object3D): THREE.Box3 {
  const land = root.getObjectByName("techNL_map_land");
  if (land) return new THREE.Box3().setFromObject(land);
  return new THREE.Box3().setFromObject(root);
}

/** Geometry AABB of `techNL_map_land` in mesh-local XY (production pin space). */
export function getLandGeometryBounds(root: THREE.Object3D): THREE.Box3 | null {
  const land = root.getObjectByName("techNL_map_land") as THREE.Mesh | undefined;
  if (!land?.isMesh) return null;
  if (!land.geometry.boundingBox) land.geometry.computeBoundingBox();
  return land.geometry.boundingBox?.clone() ?? null;
}

export function getLandMesh(root: THREE.Object3D): THREE.Mesh | null {
  const land = root.getObjectByName("techNL_map_land") as THREE.Mesh | undefined;
  return land?.isMesh ? land : null;
}

export type LatLongDistortionMap = {
  width: number;
  height: number;
  /** RGBA bytes from the distortion JPEG (`flipY: false` sampling). */
  data: Uint8ClampedArray;
};

/** Load production `LatLongDistortion.jpg` pixel buffer for pin warping. */
export async function loadLatLongDistortion(): Promise<LatLongDistortionMap> {
  const url = mapAssetUrl("LatLongDistortion.jpg");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load LatLongDistortion.jpg (${response.status})`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not read LatLongDistortion.jpg");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data,
  };
}

function webMercatorNormalized(lat: number, lng: number): { u: number; v: number } {
  const safeLat = Math.min(85, Math.max(-85, lat));
  const u = (lng + 180) / 360;
  const v =
    0.5 +
    Math.log(Math.tan(Math.PI / 4 + ((safeLat * Math.PI) / 180) / 2)) / (2 * Math.PI);
  return { u, v };
}

/**
 * Production nlwavemakers pin formula: lat/lng → equirect X + Web Mercator Y,
 * plus RG offsets from LatLongDistortion.jpg, lerped across land geometry AABB
 * in mesh-local XY (thin Z = height).
 */
export function latLngToLandLocal(
  lat: number,
  lng: number,
  landBox: THREE.Box3,
  distortion: LatLongDistortionMap | null,
  height = 0.03
): THREE.Vector3 {
  const { u, v } = webMercatorNormalized(lat, lng);
  let dx = 0;
  let dy = 0;
  if (distortion && distortion.width > 0 && distortion.height > 0) {
    const px = Math.min(
      distortion.width - 1,
      Math.max(0, Math.round(u * distortion.width))
    );
    const py = Math.min(
      distortion.height - 1,
      Math.max(0, Math.round(distortion.height - v * distortion.height))
    );
    const idx = (px + py * distortion.width) * 4;
    dx = (distortion.data[idx]! - 128) / 128;
    dy = (distortion.data[idx + 1]! - 128) / 128;
    dx = 0.71 * dx - 0.335;
    dy = 0.68 * dy - 0.315;
  }

  const size = landBox.getSize(new THREE.Vector3());
  return new THREE.Vector3(
    landBox.min.x + size.x * (u + dx),
    landBox.min.y + size.y * (v + dy),
    height
  );
}

/**
 * Convert land-local pin position into `targetRoot` local space after seating.
 */
export function landLocalToRootLocal(
  land: THREE.Object3D,
  landLocal: THREE.Vector3,
  targetRoot: THREE.Object3D
): THREE.Vector3 {
  land.updateWorldMatrix(true, false);
  targetRoot.updateWorldMatrix(true, false);
  const world = land.localToWorld(landLocal.clone());
  return targetRoot.worldToLocal(world);
}

export type ArMapModel = {
  root: THREE.Group;
  /** Full model AABB after seating + scale (Y up). */
  bounds: THREE.Box3;
  /** Land-plate world AABB (photo-space fallback). */
  pinBounds: THREE.Box3;
  /** Land geometry AABB in mesh-local XY (lat/lng pin space). */
  landGeomBounds: THREE.Box3 | null;
  land: THREE.Mesh | null;
};

/**
 * Load TechNL_map_Textured.gltf and normalize to `targetWidth` meters on XZ.
 */
export async function loadArMapModel(targetWidth = 2.2): Promise<ArMapModel> {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(rewriteMapUrl);

  const gltf = await new GLTFLoader(manager).loadAsync(
    mapAssetUrl("TechNL_map_Textured.gltf")
  );
  const mapRoot = gltf.scene;
  mapRoot.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const std = mat as THREE.MeshStandardMaterial;
      if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
      std.side = THREE.DoubleSide;
      std.needsUpdate = true;
    }
  });

  const box = layMapFlat(mapRoot);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 1e-6);
  const scale = targetWidth / span;
  mapRoot.scale.setScalar(scale);
  mapRoot.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(mapRoot);
  mapRoot.position.y -= scaled.min.y;
  mapRoot.updateMatrixWorld(true);

  const wrap = new THREE.Group();
  wrap.name = "ar-map-model";
  wrap.add(mapRoot);

  const bounds = new THREE.Box3().setFromObject(wrap);
  const pinBounds = getMapPinBounds(wrap);
  const land = getLandMesh(wrap);
  const landGeomBounds = getLandGeometryBounds(wrap);
  return { root: wrap, bounds, pinBounds, landGeomBounds, land };
}

/**
 * Photo-space fallback: stored mapX/mapY (full AR reference) → admin crop →
 * land world AABB on seated XZ. Prefer `latLngToLandLocal` for the 3D sculpture.
 */
export function mapXYToModelLocal(
  mapX: number,
  mapY: number,
  bounds: THREE.Box3,
  heightOffset = 0.03
): THREE.Vector3 {
  const admin = mapXYOriginalToAdmin(mapX, mapY);
  const size = bounds.getSize(new THREE.Vector3());
  return new THREE.Vector3(
    bounds.min.x + admin.mapX * size.x,
    bounds.max.y + heightOffset,
    bounds.min.z + admin.mapY * size.z
  );
}
