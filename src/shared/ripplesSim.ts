/** Shared constants/math mirroring Documents/Image Masking/ripples.py */

export const RIPPLE_NUM = 4;
export const RIPPLE_SPAWN_DELAY_SEC = 0.7;
export const RIPPLE_EXPANSION_DURATION_SEC = 5.0;
export const RIPPLE_MAX_RADIUS = 1.0;
/** Fade variant cuts ring alpha after this fraction of each ripple's expansion. */
export const RIPPLE_FADE_OUT_AT = 0.8;
export const RIPPLE_LOOP_FADE_OUT_AT = 1.0;
export const RIPPLE_COLOR = { r: 140 / 255, g: 199 / 255, b: 255 / 255 };

export const RIPPLE_MASK_PATH = "/assets/ripple_mask.png";
export const RIPPLE_MASK_FADE_PATH = "/assets/ripple_mask_fade.png";
/** Native mask / map-reference pixel size. */
export const RIPPLE_MASK_WIDTH = 4032;
export const RIPPLE_MASK_HEIGHT = 3024;
/** Ripple center in mask pixels — same as ripples.py ORIGIN_X / ORIGIN_Y. */
export const RIPPLE_ORIGIN_X_PX = 1400;
export const RIPPLE_ORIGIN_Y_PX = 1570;

/** Normalized map origin for the shader and pin reveal (pixel / mask size). */
export function getRipplesOriginMapXY(): { mapX: number; mapY: number } {
  return {
    mapX: RIPPLE_ORIGIN_X_PX / RIPPLE_MASK_WIDTH,
    mapY: RIPPLE_ORIGIN_Y_PX / RIPPLE_MASK_HEIGHT,
  };
}

/** Total animation length: last ripple spawns then fully expands. */
export function getRipplesSimDurationSec(): number {
  return (RIPPLE_NUM - 2) * RIPPLE_SPAWN_DELAY_SEC + RIPPLE_EXPANSION_DURATION_SEC;
}

export function getRipplesSimDurationMs(): number {
  return Math.round(getRipplesSimDurationSec() * 1000);
}

export function getRipplesFadeOutAt(variant: "loop" | "fade"): number {
  return variant === "fade" ? RIPPLE_FADE_OUT_AT : RIPPLE_LOOP_FADE_OUT_AT;
}

export function getRipplesMaskPath(variant: "loop" | "fade"): string {
  return variant === "fade" ? RIPPLE_MASK_FADE_PATH : RIPPLE_MASK_PATH;
}

/** Per-ripple radius (0–1) and alpha at absolute time t (seconds), matching ripple_state(). */
export function rippleState(
  index: number,
  tSec: number,
  fadeOutAt: number
): { radius: number; alpha: number } {
  const spawnTime = index * RIPPLE_SPAWN_DELAY_SEC;
  if (tSec < spawnTime) return { radius: 0, alpha: 0 };

  const age = tSec - spawnTime;
  const progress = Math.min(age / RIPPLE_EXPANSION_DURATION_SEC, 1);
  const radius = progress * RIPPLE_MAX_RADIUS;
  if (progress >= fadeOutAt) return { radius, alpha: 0 };
  const alpha = 1 - progress / fadeOutAt;
  return { radius, alpha };
}

/** Leading (first) ripple radius in 0–1 of max corner radius — used for pin reveal. */
export function leadingRippleRadiusNorm(tSec: number, fadeOutAt: number): number {
  return rippleState(0, tSec, fadeOutAt).radius;
}

/**
 * Pixel-space distance on the reference image (same metric as ripples.py hypot on pixels).
 * mapX/mapY are normalized 0–1; width/height are mask pixel size.
 */
export function mapPixelDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  height: number
): number {
  const dx = (bx - ax) * width;
  const dy = (by - ay) * height;
  return Math.hypot(dx, dy);
}

/** Max pixel distance from origin to a corner of the reference image. */
export function maxRadiusFromOriginPx(
  originX: number,
  originY: number,
  width: number,
  height: number
): number {
  const ox = originX * width;
  const oy = originY * height;
  return Math.max(
    Math.hypot(ox - 0, oy - 0),
    Math.hypot(ox - width, oy - 0),
    Math.hypot(ox - 0, oy - height),
    Math.hypot(ox - width, oy - height)
  );
}

/** Outline width in pixels — 4× ripples.py's max(4, width // 500). */
export function rippleLineWidthPx(textureWidth: number): number {
  return Math.max(4, Math.floor(textureWidth / 500)) * 2.5;
}
