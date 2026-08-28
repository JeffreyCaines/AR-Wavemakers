import type { InfoCard, RipplesVariant } from "./types";
import { haversineMeters } from "./locationGroups";
import {
  getRipplesFadeOutAt,
  leadingRippleRadiusNorm,
  mapPixelDistance,
  maxRadiusFromOriginPx,
} from "./ripplesSim";

/** Seed card that stays visible before/during the ripple reveal. */
export const ST_JOHNS_CARD_ID = "seed-st-johns";

/** Seed St. John's pin (also used to keep people pins in the city visible). */
export const ST_JOHNS_LAT = 47.5615;
export const ST_JOHNS_LNG = -52.7126;

/** City-scale radius so people pins near St. John's stay visible with the seed pin. */
const ST_JOHNS_ALWAYS_VISIBLE_M = 25_000;

const ST_JOHNS_NAME = /st\.?\s*john'?s/i;

type StJohnsCardFields = Pick<InfoCard, "id"> &
  Partial<Pick<InfoCard, "lat" | "lng" | "address" | "currLocation" | "origLocation" | "nlLocation">>;

function stJohnsNameHit(value: string | undefined): boolean {
  return Boolean(value && ST_JOHNS_NAME.test(value));
}

/** True for the seed org pin or any card located in St. John's. */
export function isStJohnsCard(card: StJohnsCardFields): boolean {
  if (card.id === ST_JOHNS_CARD_ID) return true;
  if (
    stJohnsNameHit(card.address) ||
    stJohnsNameHit(card.currLocation) ||
    stJohnsNameHit(card.origLocation) ||
    stJohnsNameHit(card.nlLocation)
  ) {
    return true;
  }
  if (
    card.lat != null &&
    card.lng != null &&
    Number.isFinite(card.lat) &&
    Number.isFinite(card.lng) &&
    !(card.lat === 0 && card.lng === 0)
  ) {
    return haversineMeters(card.lat, card.lng, ST_JOHNS_LAT, ST_JOHNS_LNG) <= ST_JOHNS_ALWAYS_VISIBLE_M;
  }
  return false;
}

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
  card: Pick<InfoCard, "id" | "mapX" | "mapY"> & StJohnsCardFields,
  origin: RipplesRevealOrigin,
  elapsedSec: number | null,
  playDurationSec: number,
  variant: RipplesVariant,
  maskWidth: number,
  maskHeight: number,
  forceAll = false
): boolean {
  if (forceAll || isStJohnsCard(card)) return true;
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
