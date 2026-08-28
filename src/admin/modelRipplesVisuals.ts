import {
  getRipplesFadeOutAt,
  RIPPLE_COLOR,
  RIPPLE_EXPANSION_DURATION_SEC,
  RIPPLE_MAX_RADIUS,
  RIPPLE_NUM,
  RIPPLE_SPAWN_DELAY_SEC,
  rippleLineWidthPx,
} from "../shared/ripplesSim";

/** Live /admin preview knobs. Not saved; AR still uses shared sim constants. */
export type ModelRipplesVisuals = {
  ringCount: number;
  lineWidthPx: number;
  maxRadius: number;
  expansionSec: number;
  spawnDelaySec: number;
  fadeOutAt: number;
  speed: number;
  softness: number;
  opacity: number;
  color: string;
};

export const DEFAULT_MODEL_RIPPLES_VISUALS: ModelRipplesVisuals = {
  ringCount: RIPPLE_NUM,
  lineWidthPx: rippleLineWidthPx(1024),
  maxRadius: RIPPLE_MAX_RADIUS,
  expansionSec: RIPPLE_EXPANSION_DURATION_SEC,
  spawnDelaySec: RIPPLE_SPAWN_DELAY_SEC,
  fadeOutAt: getRipplesFadeOutAt("loop"),
  speed: 1,
  softness: 1.25,
  opacity: 1,
  color: rgbToHex(RIPPLE_COLOR.r, RIPPLE_COLOR.g, RIPPLE_COLOR.b),
};

export function modelRipplesLoopDurationSec(visuals: ModelRipplesVisuals): number {
  const n = Math.max(1, visuals.ringCount);
  return Math.max(0.1, (n - 1) * visuals.spawnDelaySec + visuals.expansionSec);
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (c: number): string =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
