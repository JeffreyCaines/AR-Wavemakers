import type { CalibrationPoint } from "./types";

/** Equirectangular projection: lat/lng to normalized map coordinates (0–1, top-left origin). */
export function latLngToMapXY(lat: number, lng: number): { mapX: number; mapY: number } {
  const mapX = (lng + 180) / 360;
  const mapY = (90 - lat) / 180;
  return {
    mapX: clamp(mapX, 0, 1),
    mapY: clamp(mapY, 0, 1),
  };
}

/**
 * A fitted mapping from (lat, lng) to normalized map coords.
 * - `linear`: mapX = mx·lng + bx, mapY = my·lat + by (covers equirectangular).
 * - `affine`: full 2D fit on unwrapped longitude.
 * - `tps`: thin-plate spline on (unwrappedLng, lat) with longitude unwrap.
 */
export type Projection =
  | { kind: "linear"; mx: number; bx: number; my: number; by: number }
  | {
      kind: "affine";
      lngCenter: number;
      controlRawLng: readonly number[];
      controlLat: readonly number[];
      controlUnwrappedLng: readonly number[];
      x: readonly [number, number, number];
      y: readonly [number, number, number];
    }
  | {
      kind: "tps";
      lngCenter: number;
      controlRawLng: readonly number[];
      controlLat: readonly number[];
      controlUnwrappedLng: readonly number[];
      wx: readonly number[];
      ax: readonly [number, number, number];
      wy: readonly number[];
      ay: readonly [number, number, number];
    };

// Plain equirectangular expressed as a linear projection.
const EQUIRECTANGULAR: Projection = {
  kind: "linear",
  mx: 1 / 360,
  bx: 0.5,
  my: -1 / 180,
  by: 0.5,
};

const MIN_TPS_POINTS = 4;

/**
 * Fit a projection to the supplied calibration points:
 * - 0 points → equirectangular (uncalibrated).
 * - 1 point  → equirectangular translated to pass through that point.
 * - 2 points → per-axis linear fit (good for north-up, axis-aligned maps).
 * - 3 points → least-squares affine fit on unwrapped longitude.
 * - 4+ points → thin-plate spline (TPS) with longitude unwrap; affine if TPS fails.
 */
export function buildProjection(points: readonly CalibrationPoint[]): Projection {
  const pts = points.filter(isFinitePoint);

  if (pts.length >= MIN_TPS_POINTS) {
    const prepared = prepareCalibrationCoords(pts);
    const tps = solveTPS(prepared);
    if (tps) return tps;
  }
  if (pts.length >= 3) {
    const prepared = prepareCalibrationCoords(pts);
    const affine = solveAffine(prepared);
    if (affine) return affine;
  }
  if (pts.length >= 2) {
    return solveLinear(pts[0], pts[pts.length - 1]);
  }
  if (pts.length === 1) {
    const p = pts[0];
    const eq = applyProjection(EQUIRECTANGULAR, p.lat, p.lng);
    return {
      kind: "linear",
      mx: EQUIRECTANGULAR.kind === "linear" ? EQUIRECTANGULAR.mx : 1 / 360,
      bx: 0.5 + (p.mapX - eq.mapX),
      my: EQUIRECTANGULAR.kind === "linear" ? EQUIRECTANGULAR.my : -1 / 180,
      by: 0.5 + (p.mapY - eq.mapY),
    };
  }
  return EQUIRECTANGULAR;
}

/** Apply a fitted projection and clamp into the [0, 1] map square. */
export function projectLatLng(
  projection: Projection,
  lat: number,
  lng: number
): { mapX: number; mapY: number } {
  const { mapX, mapY } = applyProjection(projection, lat, lng);
  return { mapX: clamp(mapX, 0, 1), mapY: clamp(mapY, 0, 1) };
}

/** Human-readable summary of which projection the current points produce. */
export function describeProjection(points: readonly CalibrationPoint[]): string {
  const n = points.filter(isFinitePoint).length;
  if (n >= MIN_TPS_POINTS) {
    return `Thin-plate spline from ${n} calibration points (longitude unwrap).`;
  }
  if (n >= 3) return `Affine fit from ${n} calibration points (longitude unwrap).`;
  if (n === 2) return "Linear fit from 2 calibration points.";
  if (n === 1) return "Equirectangular shifted onto 1 calibration point.";
  return "Equirectangular (uncalibrated). Add points for an accurate fit.";
}

interface PreparedCalibration {
  lngCenter: number;
  rawLng: number[];
  lat: number[];
  unwrappedLng: number[];
  mapX: number[];
  mapY: number[];
}

function prepareCalibrationCoords(pts: readonly CalibrationPoint[]): PreparedCalibration {
  const rawLng = pts.map((p) => wrapLng(p.lng));
  const lat = pts.map((p) => p.lat);
  const unwrappedLng = buildConsistentUnwrappedLngs(rawLng);
  const lngCenter = estimateLngCenter(unwrappedLng, pts.map((p) => p.mapX));
  return {
    lngCenter,
    rawLng,
    lat,
    unwrappedLng,
    mapX: pts.map((p) => p.mapX),
    mapY: pts.map((p) => p.mapY),
  };
}

function applyProjection(
  projection: Projection,
  lat: number,
  lng: number
): { mapX: number; mapY: number } {
  if (projection.kind === "linear") {
    return { mapX: projection.mx * lng + projection.bx, mapY: projection.my * lat + projection.by };
  }
  const uLng = unwrapLngNearest(
    lng,
    lat,
    projection.controlRawLng,
    projection.controlLat,
    projection.controlUnwrappedLng
  );

  if (projection.kind === "affine") {
    return {
      mapX: projection.x[0] * uLng + projection.x[1] * lat + projection.x[2],
      mapY: projection.y[0] * uLng + projection.y[1] * lat + projection.y[2],
    };
  }

  return {
    mapX: evalTPS(
      uLng,
      lat,
      projection.controlUnwrappedLng,
      projection.controlLat,
      projection.wx,
      projection.ax
    ),
    mapY: evalTPS(
      uLng,
      lat,
      projection.controlUnwrappedLng,
      projection.controlLat,
      projection.wy,
      projection.ay
    ),
  };
}

function unwrapLngNearest(
  lng: number,
  lat: number,
  controlRawLng: readonly number[],
  controlLat: readonly number[],
  controlUnwrappedLng: readonly number[]
): number {
  const wrapped = wrapLng(lng);
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < controlRawLng.length; i++) {
    const dLng = shortestLngDelta(controlRawLng[i], wrapped);
    const dLat = lat - controlLat[i];
    const score = dLng * dLng + dLat * dLat;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return controlUnwrappedLng[best] + shortestLngDelta(controlRawLng[best], wrapped);
}

function solveLinear(a: CalibrationPoint, b: CalibrationPoint): Projection {
  const dLng = b.lng - a.lng;
  const dLat = b.lat - a.lat;

  let mx = 1 / 360;
  let bx = a.mapX - mx * a.lng;
  if (Math.abs(dLng) > 1e-9) {
    mx = (b.mapX - a.mapX) / dLng;
    bx = a.mapX - mx * a.lng;
  }

  let my = -1 / 180;
  let by = a.mapY - my * a.lat;
  if (Math.abs(dLat) > 1e-9) {
    my = (b.mapY - a.mapY) / dLat;
    by = a.mapY - my * a.lat;
  }

  return { kind: "linear", mx, bx, my, by };
}

function solveAffine(prepared: PreparedCalibration): Projection | null {
  const n = prepared.unwrappedLng.length;
  let sLngLng = 0;
  let sLngLat = 0;
  let sLng = 0;
  let sLatLat = 0;
  let sLat = 0;
  let sLngX = 0;
  let sLatX = 0;
  let sX = 0;
  let sLngY = 0;
  let sLatY = 0;
  let sY = 0;

  for (let i = 0; i < n; i++) {
    const lng = prepared.unwrappedLng[i];
    const lat = prepared.lat[i];
    const mapX = prepared.mapX[i];
    const mapY = prepared.mapY[i];
    sLngLng += lng * lng;
    sLngLat += lng * lat;
    sLng += lng;
    sLatLat += lat * lat;
    sLat += lat;
    sLngX += lng * mapX;
    sLatX += lat * mapX;
    sX += mapX;
    sLngY += lng * mapY;
    sLatY += lat * mapY;
    sY += mapY;
  }

  const m: Matrix3 = [
    [sLngLng, sLngLat, sLng],
    [sLngLat, sLatLat, sLat],
    [sLng, sLat, n],
  ];
  const inv = invert3(m);
  if (!inv) return null;

  return {
    kind: "affine",
    lngCenter: prepared.lngCenter,
    controlRawLng: prepared.rawLng,
    controlLat: prepared.lat,
    controlUnwrappedLng: prepared.unwrappedLng,
    x: multiply3(inv, [sLngX, sLatX, sX]),
    y: multiply3(inv, [sLngY, sLatY, sY]),
  };
}

function solveTPS(prepared: PreparedCalibration): Projection | null {
  const { lngCenter, rawLng, lat, unwrappedLng, mapX, mapY } = prepared;
  const n = unwrappedLng.length;
  const system = buildTPSMatrix(unwrappedLng, lat);
  const rhsX = [...mapX, 0, 0, 0];
  const rhsY = [...mapY, 0, 0, 0];
  const solX = solveLinearSystem(system, rhsX);
  const solY = solveLinearSystem(system, rhsY);
  if (!solX || !solY) return null;

  return {
    kind: "tps",
    lngCenter,
    controlRawLng: rawLng,
    controlLat: lat,
    controlUnwrappedLng: unwrappedLng,
    wx: solX.slice(0, n),
    ax: [solX[n], solX[n + 1], solX[n + 2]],
    wy: solY.slice(0, n),
    ay: [solY[n], solY[n + 1], solY[n + 2]],
  };
}

function buildTPSMatrix(controlLng: readonly number[], controlLat: readonly number[]): number[][] {
  const n = controlLng.length;
  const size = n + 3;
  const matrix: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = controlLng[i] - controlLng[j];
      const dy = controlLat[i] - controlLat[j];
      matrix[i][j] = tpsKernel(Math.hypot(dx, dy));
    }
    matrix[i][n] = 1;
    matrix[i][n + 1] = controlLng[i];
    matrix[i][n + 2] = controlLat[i];
    matrix[n][i] = 1;
    matrix[n + 1][i] = controlLng[i];
    matrix[n + 2][i] = controlLat[i];
  }

  return matrix;
}

function evalTPS(
  lng: number,
  lat: number,
  controlLng: readonly number[],
  controlLat: readonly number[],
  weights: readonly number[],
  affine: readonly [number, number, number]
): number {
  let value = affine[0] + affine[1] * lng + affine[2] * lat;
  for (let i = 0; i < weights.length; i++) {
    const dx = lng - controlLng[i];
    const dy = lat - controlLat[i];
    value += weights[i] * tpsKernel(Math.hypot(dx, dy));
  }
  return value;
}

function tpsKernel(r: number): number {
  if (r <= 1e-10) return 0;
  return r * r * Math.log(r);
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const augmented = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][col]) < 1e-10) return null;
    if (pivot !== col) {
      [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col] / augmented[col][col];
      for (let j = col; j <= n; j++) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  const solution = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= augmented[i][j] * solution[j];
    }
    solution[i] = sum / augmented[i][i];
  }
  return solution;
}

function buildConsistentUnwrappedLngs(rawLng: readonly number[]): number[] {
  const n = rawLng.length;
  if (n === 0) return [];
  const unwrapped = new Array<number>(n);
  unwrapped[0] = rawLng[0];
  const used = new Set<number>([0]);

  while (used.size < n) {
    let bestI = 0;
    let bestJ = -1;
    let bestDist = Infinity;
    for (const i of used) {
      for (let j = 0; j < n; j++) {
        if (used.has(j)) continue;
        const d = Math.abs(shortestLngDelta(rawLng[i], rawLng[j]));
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestJ === -1) break;
    unwrapped[bestJ] = unwrapped[bestI] + shortestLngDelta(rawLng[bestI], rawLng[bestJ]);
    used.add(bestJ);
  }

  return unwrapped;
}

function estimateLngCenter(unwrappedLng: readonly number[], mapX: readonly number[]): number {
  if (unwrappedLng.length === 0) return 0;
  const n = unwrappedLng.length;
  let sLng = 0;
  let sLngLng = 0;
  let sLngX = 0;
  let sX = 0;
  for (let i = 0; i < n; i++) {
    const lng = unwrappedLng[i];
    sLng += lng;
    sLngLng += lng * lng;
    sLngX += lng * mapX[i];
    sX += mapX[i];
  }
  const det = n * sLngLng - sLng * sLng;
  if (Math.abs(det) < 1e-9) return wrapLng(unwrappedLng[0]);
  const mx = (n * sLngX - sLng * sX) / det;
  const bx = (sX - mx * sLng) / n;
  if (Math.abs(mx) < 1e-9) return wrapLng(unwrappedLng[0]);
  return wrapLng((0.5 - bx) / mx);
}

function wrapLng(lng: number): number {
  const x = lng % 360;
  return x >= 180 ? x - 360 : x < -180 ? x + 360 : x;
}

function shortestLngDelta(fromLng: number, toLng: number): number {
  let d = wrapLng(toLng) - wrapLng(fromLng);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

type Vec3 = [number, number, number];
type Matrix3 = [Vec3, Vec3, Vec3];

function invert3(m: Matrix3): Matrix3 | null {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return null;

  const invDet = 1 / det;
  return [
    [A * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [B * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [C * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

function multiply3(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function isFinitePoint(p: CalibrationPoint): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Number.isFinite(p.mapX) &&
    Number.isFinite(p.mapY)
  );
}

/** Inverse of latLngToMapXY for display purposes. */
export function mapXYToLatLng(mapX: number, mapY: number): { lat: number; lng: number } {
  const lng = mapX * 360 - 180;
  const lat = 90 - mapY * 180;
  return { lat, lng };
}

/**
 * Convert normalized map coords to a MindAR anchor-plane position.
 *
 * MindAR normalizes the image target so its width spans 1 unit (x: -0.5 … 0.5)
 * and its height spans (imageHeight / imageWidth) = 1 / aspectRatio units.
 * `aspectRatio` here is width / height, so the vertical axis is divided by it.
 */
export function mapXYToAnchorPosition(
  mapX: number,
  mapY: number,
  aspectRatio: number
): { x: number; y: number } {
  const safeAspect = aspectRatio > 0 ? aspectRatio : 1;
  return {
    x: mapX - 0.5,
    y: (0.5 - mapY) / safeAspect,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Read the natural aspect ratio (width / height) of the reference image. */
export async function loadMapAspectRatio(
  imagePath: string,
  fallback = 1.5
): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight || fallback);
    img.onerror = () => resolve(fallback);
    img.src = imagePath;
  });
}
