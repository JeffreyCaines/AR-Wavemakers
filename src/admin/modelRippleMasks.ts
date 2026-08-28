import * as THREE from "three";

export type Layer7Edge = "inner" | "outer";

export type Layer7RippleMasks = {
  inner: THREE.DataTexture;
  outer: THREE.DataTexture;
  width: number;
  height: number;
};

const MASK_LONG_SIDE = 1024;

type Vec2 = { x: number; y: number };

function isLayer07(mesh: THREE.Mesh): boolean {
  const name = mesh.name || "";
  return name === "Layer_07" || name.includes("Layer_07");
}

function isWaterLayer(mesh: THREE.Mesh): boolean {
  return /Layer_\d+/i.test(mesh.name || "");
}

function isLandMesh(mesh: THREE.Mesh): boolean {
  const name = mesh.name || "";
  return (
    name.includes("land") ||
    name.includes("Land") ||
    name.includes("NFLD") ||
    name.toLowerCase().includes("nfld")
  );
}

function collectMeshes(root: THREE.Object3D, keep: (mesh: THREE.Mesh) => boolean): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && keep(mesh) && mesh.geometry) meshes.push(mesh);
  });
  return meshes;
}

function edge(a: Vec2, b: Vec2, p: Vec2): number {
  return (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
}

function stamp(mask: Uint8Array, width: number, height: number, p: Vec2): void {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  mask[y * width + x] = 1;
}

function fillTriangle(
  mask: Uint8Array,
  width: number,
  height: number,
  a: Vec2,
  b: Vec2,
  c: Vec2
): void {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  if (maxX < minX || maxY < minY) return;

  const area = edge(a, b, c);
  if (Math.abs(area) < 1e-6) {
    stamp(mask, width, height, a);
    stamp(mask, width, height, b);
    stamp(mask, width, height, c);
    return;
  }

  const p: Vec2 = { x: 0, y: 0 };
  for (let y = minY; y <= maxY; y++) {
    p.y = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      p.x = x + 0.5;
      const w0 = edge(b, c, p);
      const w1 = edge(c, a, p);
      const w2 = edge(a, b, p);
      const inside = area > 0 ? w0 >= 0 && w1 >= 0 && w2 >= 0 : w0 <= 0 && w1 <= 0 && w2 <= 0;
      if (inside) mask[y * width + x] = 1;
    }
  }
}

/** Land-plate UV: u = X, v = Z, v = 0 at north (min.z, mapY = 0). */
function rasterize(
  meshes: THREE.Mesh[],
  plateBounds: THREE.Box3,
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const minX = plateBounds.min.x;
  const minZ = plateBounds.min.z;
  const sizeX = Math.max(plateBounds.max.x - minX, 1e-6);
  const sizeZ = Math.max(plateBounds.max.z - minZ, 1e-6);
  const world = new THREE.Vector3();
  const meshMatrix = new THREE.Matrix4();

  const project = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number): Vec2 => {
    world.fromBufferAttribute(attr, index);
    world.applyMatrix4(meshMatrix);
    return {
      x: ((world.x - minX) / sizeX) * (width - 1),
      y: ((world.z - minZ) / sizeZ) * (height - 1),
    };
  };

  const seen = new Set<THREE.BufferGeometry>();
  for (const mesh of meshes) {
    const geom = mesh.geometry;
    if (seen.has(geom)) continue;
    seen.add(geom);
    const pos = geom.getAttribute("position");
    if (!pos) continue;
    meshMatrix.copy(mesh.matrixWorld);
    const index = geom.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      fillTriangle(mask, width, height, project(pos, i0), project(pos, i1), project(pos, i2));
    }
  }
  return mask;
}

function toDataTexture(mask: Uint8Array, width: number, height: number): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 255 : 0;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function countBits(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

/**
 * Top-down masks in land-plate UV (mapY = 0 is north / top).
 * Water is the union of Layer_01–Layer_07 so rings draw over the inner ocean,
 * not only the Layer_07 ring. Land / NFLD stay clear.
 * Outer cutoff = Layer_07's outer extent (outermost water).
 * Inner cutoff = water inward of Layer_07 (Layers 1–6).
 */
export function bakeLayer7RippleMasks(
  root: THREE.Object3D,
  plateBounds: THREE.Box3
): Layer7RippleMasks {
  const size = plateBounds.getSize(new THREE.Vector3());
  const aspectW = Math.max(size.x, 1e-6);
  const aspectH = Math.max(size.z, 1e-6);
  const width = MASK_LONG_SIDE;
  const height = Math.max(1, Math.round(MASK_LONG_SIDE * (aspectH / aspectW)));

  const water = rasterize(collectMeshes(root, isWaterLayer), plateBounds, width, height);
  const layer7 = rasterize(collectMeshes(root, isLayer07), plateBounds, width, height);
  const land = rasterize(collectMeshes(root, isLandMesh), plateBounds, width, height);

  const outer = new Uint8Array(width * height);
  const inner = new Uint8Array(width * height);

  for (let i = 0; i < outer.length; i++) {
    if (land[i] || !water[i]) continue;
    outer[i] = 1;
    if (!layer7[i]) inner[i] = 1;
  }

  if (countBits(outer) === 0) {
    for (let i = 0; i < outer.length; i++) outer[i] = land[i] ? 0 : 1;
  }
  if (countBits(inner) === 0) inner.set(outer);

  return {
    inner: toDataTexture(inner, width, height),
    outer: toDataTexture(outer, width, height),
    width,
    height,
  };
}
