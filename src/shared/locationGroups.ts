import type { InfoCard } from "./types";

const LOCATION_PRECISION = 6;

export interface LocationGroup {
  key: string;
  mapX: number;
  mapY: number;
  cards: InfoCard[];
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
