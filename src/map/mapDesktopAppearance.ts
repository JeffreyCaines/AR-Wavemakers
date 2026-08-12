import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

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
  texture.flipY = false;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * UV islands duplicate verts at the same XYZ with hard normals (e.g. Alaska seam).
 * Classify top/bottom verts from connected face orientation (not stored normals),
 * then average only those. Rim walls stay sharp even when a top UV copy has a
 * bad exported normal.
 *
 * `upAxis`: authored GLTF is Z-up (`"z"`); after lay-flat seating use `"y"`.
 */
export function smoothNormalsAcrossUvSeams(
  geometry: THREE.BufferGeometry,
  quantize = 1e5,
  surfaceDot = 0.55,
  upAxis: "y" | "z" = "z"
): void {
  const pos = geometry.getAttribute("position");
  const nrm = geometry.getAttribute("normal");
  if (!pos || !nrm) return;

  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const axisIndex = upAxis === "y" ? 1 : 2;

  const faceAccum = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    faceNormal.crossVectors(ab, ac);
    if (faceNormal.lengthSq() < 1e-20) continue;

    for (const i of [i0, i1, i2]) {
      faceAccum[i * 3] += faceNormal.x;
      faceAccum[i * 3 + 1] += faceNormal.y;
      faceAccum[i * 3 + 2] += faceNormal.z;
    }
  }

  const isSurface = new Array<boolean>(pos.count);
  const faceN = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    faceN.set(faceAccum[i * 3], faceAccum[i * 3 + 1], faceAccum[i * 3 + 2]);
    if (faceN.lengthSq() < 1e-20) {
      const storedUp = upAxis === "y" ? nrm.getY(i) : nrm.getZ(i);
      isSurface[i] = Math.abs(storedUp) >= surfaceDot;
      continue;
    }
    faceN.normalize();
    isSurface[i] = Math.abs(faceN.getComponent(axisIndex)) >= surfaceDot;
  }

  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = [
      Math.round(pos.getX(i) * quantize),
      Math.round(pos.getY(i) * quantize),
      Math.round(pos.getZ(i) * quantize),
    ].join(",");
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }

  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    normals[i * 3] = nrm.getX(i);
    normals[i * 3 + 1] = nrm.getY(i);
    normals[i * 3 + 2] = nrm.getZ(i);
  }

  const avg = new THREE.Vector3();
  for (const indices of groups.values()) {
    const surface = indices.filter((i) => isSurface[i]);
    if (surface.length < 2) continue;

    // Prefer face-derived normals so a bad exported top normal cannot skew the seam.
    avg.set(0, 0, 0);
    for (const i of surface) {
      avg.x += faceAccum[i * 3];
      avg.y += faceAccum[i * 3 + 1];
      avg.z += faceAccum[i * 3 + 2];
    }
    if (avg.lengthSq() < 1e-20) continue;
    avg.normalize();
    for (const i of surface) {
      normals[i * 3] = avg.x;
      normals[i * 3 + 1] = avg.y;
      normals[i * 3 + 2] = avg.z;
    }
  }

  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
}

export function smoothMapMeshNormals(
  root: THREE.Object3D,
  upAxis: "y" | "z" = "z"
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    smoothNormalsAcrossUvSeams(mesh.geometry, 1e5, 0.55, upAxis);
  });
}

/**
 * Original atlas colors with a matte finish.
 * Land/nfld use solid base-color albedos (curvature = light AO only) so tops read uniform.
 */
export async function applyDesktopMaterials(root: THREE.Object3D): Promise<void> {
  const [landBase, nfldBase, landCurvature, nfldCurvature, waterBase, waterCurvature] =
    await Promise.all([
      loadTexture(mapAssetUrl("map_land_M_Base_color.png"), THREE.SRGBColorSpace),
      loadTexture(mapAssetUrl("map_nfld_M_Base_color.png"), THREE.SRGBColorSpace),
      loadTexture(mapAssetUrl("map_land_M_Curvature.jpg"), THREE.NoColorSpace),
      loadTexture(mapAssetUrl("map_nfld_M_Curvature.jpg"), THREE.NoColorSpace),
      loadTexture(mapAssetUrl("map_water_M_Base_color_vibrant.png"), THREE.SRGBColorSpace),
      loadTexture(mapAssetUrl("map_water_M_Curvature.jpg"), THREE.NoColorSpace),
    ]);

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.name || "").toLowerCase();

    let map: THREE.Texture = landBase;
    let aoMap: THREE.Texture | null = landCurvature;
    let roughness = 0.92;
    let aoMapIntensity = 0.12;
    let envMapIntensity = 0.06;

    if (name.includes("layer")) {
      map = waterBase;
      aoMap = waterCurvature;
      roughness = 0.85;
      aoMapIntensity = 0.18;
      envMapIntensity = 0.08;
    } else if (name.includes("nfld")) {
      map = nfldBase;
      aoMap = nfldCurvature;
      roughness = 0.92;
      aoMapIntensity = 0.12;
      envMapIntensity = 0.06;
    }

    const mat = new THREE.MeshStandardMaterial({
      map,
      aoMap: aoMap ?? undefined,
      aoMapIntensity: aoMap ? aoMapIntensity : 0,
      color: 0xffffff,
      metalness: 0.0,
      roughness,
      envMapIntensity,
      side: THREE.DoubleSide,
    });

    if (aoMap && mesh.geometry.getAttribute("uv") && !mesh.geometry.getAttribute("uv2")) {
      mesh.geometry.setAttribute("uv2", mesh.geometry.getAttribute("uv"));
    }

    if (mesh.material && !Array.isArray(mesh.material)) {
      (mesh.material as THREE.Material).dispose();
    }
    mesh.material = mat;
    mesh.frustumCulled = false;
  });
}

/** Optional warm cafe HDR for subtle contact shading (same as map-viewer). */
export async function loadDesktopEnvironmentMap(
  manager?: THREE.LoadingManager
): Promise<THREE.DataTexture | null> {
  try {
    const hdr = await new RGBELoader(manager).loadAsync(mapAssetUrl("comfy_cafe.hdr"));
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    return hdr;
  } catch {
    return null;
  }
}

/** Smooth UV seams + matte desktop atlases (map-viewer appearance). */
export async function applyMapDesktopAppearance(
  root: THREE.Object3D,
  upAxis: "y" | "z" = "z"
): Promise<void> {
  smoothMapMeshNormals(root, upAxis);
  await applyDesktopMaterials(root);
}
