import type { InfoCard } from "./types";

const LOCATION_PRECISION = 6;
const EARTH_RADIUS_M = 6_371_000;

/** Treat two geocoded positions as the same pin when closer than this. */
export const NEARBY_PIN_METERS = 500;

export interface LocationGroup {
  key: string;
  mapX: number;
  mapY: number;
  cards: InfoCard[];
}

export type PinMatchReason = "name" | "proximity";

export interface PinMatch {
  card: InfoCard;
  reason: PinMatchReason;
  distanceMeters?: number;
}

/** Round map coords so near-identical floats share one location key. */
export function locationKey(mapX: number, mapY: number): string {
  return `${mapX.toFixed(LOCATION_PRECISION)}|${mapY.toFixed(LOCATION_PRECISION)}`;
}

export function groupCardsByLocation(cards: InfoCard[]): LocationGroup[] {
  const byKey = new Map<string, LocationGroup>();

  for (const card of cards) {
    const key = locationKey(card.mapX, card.mapY);
    const existing = byKey.get(key);
    if (existing) {
      existing.cards.push(card);
      continue;
    }
    byKey.set(key, {
      key,
      mapX: card.mapX,
      mapY: card.mapY,
      cards: [card],
    });
  }

  return Array.from(byKey.values());
}

export function findGroupForCardId(
  groups: LocationGroup[],
  cardId: string
): LocationGroup | undefined {
  return groups.find((group) => group.cards.some((card) => card.id === cardId));
}

export function findGroupByKey(
  groups: LocationGroup[],
  key: string
): LocationGroup | undefined {
  return groups.find((group) => group.key === key);
}

/** Normalize a place name/address for Set membership checks. */
export function normalizeLocationName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Build a Set of normalized addresses already used by pins. */
export function buildLocationNameSet(cards: readonly InfoCard[]): Set<string> {
  const names = new Set<string>();
  for (const card of cards) {
    const name = normalizeLocationName(card.address);
    if (name) names.add(name);
  }
  return names;
}

/** Great-circle distance in meters between two WGS84 points. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function hasUsableCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/**
 * Find an existing pin that a new card would collide with:
 * 1. Normalized address already in the location-name Set, or
 * 2. Lat/lng within {@link NEARBY_PIN_METERS} of an existing pin.
 */
export function findMatchingPin(
  cards: readonly InfoCard[],
  candidate: { address?: string; lat: number; lng: number },
  options: { excludeId?: string; maxMeters?: number } = {}
): PinMatch | undefined {
  const { excludeId, maxMeters = NEARBY_PIN_METERS } = options;
  const others = excludeId ? cards.filter((card) => card.id !== excludeId) : cards;
  if (others.length === 0) return undefined;

  const candidateName = normalizeLocationName(candidate.address ?? "");
  if (candidateName) {
    const names = buildLocationNameSet(others);
    if (names.has(candidateName)) {
      const card = others.find(
        (entry) => normalizeLocationName(entry.address) === candidateName
      );
      if (card) return { card, reason: "name" };
    }
  }

  if (!hasUsableCoords(candidate.lat, candidate.lng)) return undefined;

  let closest: PinMatch | undefined;
  for (const card of others) {
    if (!hasUsableCoords(card.lat, card.lng)) continue;
    const distanceMeters = haversineMeters(
      candidate.lat,
      candidate.lng,
      card.lat,
      card.lng
    );
    if (distanceMeters > maxMeters) continue;
    if (!closest || (closest.distanceMeters ?? Infinity) > distanceMeters) {
      closest = { card, reason: "proximity", distanceMeters };
    }
  }
  return closest;
}
