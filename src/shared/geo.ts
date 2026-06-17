/** Equirectangular projection: lat/lng to normalized map coordinates (0–1, top-left origin). */
export function latLngToMapXY(lat: number, lng: number): { mapX: number; mapY: number } {
  const mapX = (lng + 180) / 360;
  const mapY = (90 - lat) / 180;
  return {
    mapX: clamp(mapX, 0, 1),
    mapY: clamp(mapY, 0, 1),
  };
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
