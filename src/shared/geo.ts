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
 * - `affine`: full 2D fit, mapX = x·(lng, lat, 1), mapY = y·(lng, lat, 1).
 */
export type Projection =
  | { kind: "linear"; mx: number; bx: number; my: number; by: number }
  | {
      kind: "affine";
      x: readonly [number, number, number];
      y: readonly [number, number, number];
    };

// Plain equirectangular expressed as a linear projection.
const EQUIRECTANGULAR: Projection = {
  kind: "linear",
  mx: 1 / 360,
  bx: 0.5,
  my: -1 / 180,
  by: 0.5,
};

/**
 * Fit a projection to the supplied calibration points:
 * - 0 points → equirectangular (uncalibrated).
 * - 1 point  → equirectangular translated to pass through that point.
 * - 2 points → per-axis linear fit (good for north-up, axis-aligned maps).
 * - 3+ points → least-squares affine fit (handles scale, rotation, shear).
 */
export function buildProjection(points: readonly CalibrationPoint[]): Projection {
  const pts = points.filter(isFinitePoint);

  if (pts.length >= 3) {
    const affine = solveAffine(pts);
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
  if (n >= 3) return `Affine fit from ${n} calibration points.`;
  if (n === 2) return "Linear fit from 2 calibration points.";
  if (n === 1) return "Equirectangular shifted onto 1 calibration point.";
  return "Equirectangular (uncalibrated). Add points for an accurate fit.";
}

function applyProjection(
  projection: Projection,
  lat: number,
  lng: number
): { mapX: number; mapY: number } {
  if (projection.kind === "linear") {
    return { mapX: projection.mx * lng + projection.bx, mapY: projection.my * lat + projection.by };
  }
  return {
    mapX: projection.x[0] * lng + projection.x[1] * lat + projection.x[2],
    mapY: projection.y[0] * lng + projection.y[1] * lat + projection.y[2],
  };
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

function solveAffine(pts: readonly CalibrationPoint[]): Projection | null {
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
  const n = pts.length;

  for (const p of pts) {
    sLngLng += p.lng * p.lng;
    sLngLat += p.lng * p.lat;
    sLng += p.lng;
    sLatLat += p.lat * p.lat;
    sLat += p.lat;
    sLngX += p.lng * p.mapX;
    sLatX += p.lat * p.mapX;
    sX += p.mapX;
    sLngY += p.lng * p.mapY;
    sLatY += p.lat * p.mapY;
    sY += p.mapY;
  }

  // Normal-equation matrix (shared by both axes) and its inverse.
  const m: Matrix3 = [
    [sLngLng, sLngLat, sLng],
    [sLngLat, sLatLat, sLat],
    [sLng, sLat, n],
  ];
  const inv = invert3(m);
  if (!inv) return null;

  return {
    kind: "affine",
    x: multiply3(inv, [sLngX, sLatX, sX]),
    y: multiply3(inv, [sLngY, sLatY, sY]),
  };
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
