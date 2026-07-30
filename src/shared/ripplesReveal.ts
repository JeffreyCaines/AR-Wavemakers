import type { InfoCard, RipplesVariant } from "./types";
import {
  getRipplesFadeOutAt,
  leadingRippleRadiusNorm,
  mapPixelDistance,
  maxRadiusFromOriginPx,
} from "./ripplesSim";

/** Seed card that stays visible before/during the ripple reveal. */
export const ST_JOHNS_CARD_ID = "seed-st-johns";

/** Optional manual overrides: cardId → absolute time in seconds when the pin appears. */
export const RIPPLES_PIN_REVEAL_OVERRIDES: Readonly<Record<string, number>> = {
  // Example: "seed-london": 1.25,
};

export interface RipplesRevealOrigin {
  mapX: number;
  mapY: number;
}

/**
 * Whether a pin should be visible for the current ripple progress.
 * Default: reveal when the leading ripple radius reaches the pin (same metric as the shader).
 * St. John's is always revealed. Overrides in RIPPLES_PIN_REVEAL_OVERRIDES win when set.
 */
export function isPinRevealed(
  card: Pick<InfoCard, "id" | "mapX" | "mapY">,
  origin: RipplesRevealOrigin,
  elapsedSec: number | null,
  playDurationSec: number,
  variant: RipplesVariant,
  maskWidth: number,
  maskHeight: number,
  forceAll = false
): boolean {
  if (forceAll || card.id === ST_JOHNS_CARD_ID) return true;
  if (elapsedSec == null || elapsedSec < 0) return false;
  if (playDurationSec > 0 && elapsedSec >= playDurationSec) return true;

  const overrideSec = RIPPLES_PIN_REVEAL_OVERRIDES[card.id];
  if (overrideSec !== undefined) {
    return elapsedSec >= overrideSec;
  }

  const fadeOutAt = getRipplesFadeOutAt(variant);
  const radiusNorm = leadingRippleRadiusNorm(elapsedSec, fadeOutAt);
  if (radiusNorm <= 0) return false;

  const maxR = maxRadiusFromOriginPx(origin.mapX, origin.mapY, maskWidth, maskHeight);
  if (maxR <= 0) return false;

  const dist = mapPixelDistance(
    origin.mapX,
    origin.mapY,
    card.mapX,
    card.mapY,
    maskWidth,
    maskHeight
  );
  return dist <= radiusNorm * maxR;
}
