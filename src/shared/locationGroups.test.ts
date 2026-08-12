import { describe, expect, it } from "vitest";
import {
  buildLocationNameSet,
  findGroupForCardId,
  findMatchingPin,
  groupCardsByLocation,
  haversineMeters,
  locationKey,
  NEARBY_PIN_METERS,
  normalizeLocationName,
} from "./locationGroups";
import type { InfoCard } from "./types";

function card(partial: Partial<InfoCard> & Pick<InfoCard, "id" | "mapX" | "mapY">): InfoCard {
  return {
    title: partial.title ?? partial.id,
    body: "",
    address: "",
    lat: 0,
    lng: 0,
    active: true,
    ...partial,
  };
}

describe("locationKey", () => {
  it("rounds to 6 decimals", () => {
    expect(locationKey(0.123456789, 0.987654321)).toBe("0.123457|0.987654");
  });

  it("groups near-identical floats", () => {
    expect(locationKey(0.5, 0.5)).toBe(locationKey(0.5000001, 0.5000004));
  });
});

describe("groupCardsByLocation", () => {
  it("keeps distinct positions separate", () => {
    const groups = groupCardsByLocation([
      card({ id: "a", mapX: 0.1, mapY: 0.2 }),
      card({ id: "b", mapX: 0.3, mapY: 0.4 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.cards.map((c) => c.id).join(",")).sort()).toEqual(["a", "b"]);
  });

  it("merges cards at the same rounded position", () => {
    const groups = groupCardsByLocation([
      card({ id: "a", mapX: 0.28, mapY: 0.38, title: "One" }),
      card({ id: "b", mapX: 0.28, mapY: 0.38, title: "Two" }),
      card({ id: "c", mapX: 0.52, mapY: 0.35 }),
    ]);
    expect(groups).toHaveLength(2);
    const multi = groups.find((g) => g.cards.length === 2)!;
    expect(multi.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(multi.key).toBe(locationKey(0.28, 0.38));
  });
});

describe("findGroupForCardId", () => {
  it("returns the group containing the card", () => {
    const groups = groupCardsByLocation([
      card({ id: "a", mapX: 0.1, mapY: 0.1 }),
      card({ id: "b", mapX: 0.1, mapY: 0.1 }),
    ]);
    expect(findGroupForCardId(groups, "b")?.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(findGroupForCardId(groups, "missing")).toBeUndefined();
  });
});

describe("normalizeLocationName", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeLocationName("  Brasília,  Brasil  ")).toBe("brasília, brasil");
  });
});

describe("buildLocationNameSet", () => {
  it("stores normalized addresses", () => {
    const names = buildLocationNameSet([
      card({ id: "a", mapX: 0.1, mapY: 0.1, address: "Brasília, Brasil" }),
      card({ id: "b", mapX: 0.2, mapY: 0.2, address: "  brasília, brasil " }),
      card({ id: "c", mapX: 0.3, mapY: 0.3, address: "" }),
    ]);
    expect(names.size).toBe(1);
    expect(names.has("brasília, brasil")).toBe(true);
  });
});

describe("haversineMeters", () => {
  it("returns ~0 for identical points", () => {
    expect(haversineMeters(-15.79, -47.88, -15.79, -47.88)).toBeLessThan(1);
  });

  it("measures short city-scale distances", () => {
    const meters = haversineMeters(-15.7939869, -47.8828, -15.7945, -47.883);
    expect(meters).toBeGreaterThan(50);
    expect(meters).toBeLessThan(NEARBY_PIN_METERS);
  });
});

describe("findMatchingPin", () => {
  const brasilia = card({
    id: "br",
    mapX: 0.35,
    mapY: 0.69,
    address: "Brasília, Plano Piloto, Distrito Federal, Brasil",
    lat: -15.7939869,
    lng: -47.8828,
    title: "Brasília",
  });

  it("matches by normalized location name", () => {
    const match = findMatchingPin([brasilia], {
      address: "brasília, plano piloto, distrito federal, brasil",
      lat: 0,
      lng: 0,
    });
    expect(match?.reason).toBe("name");
    expect(match?.card.id).toBe("br");
  });

  it("matches by lat/lng proximity", () => {
    const match = findMatchingPin([brasilia], {
      address: "Brazil",
      lat: -15.7942,
      lng: -47.8831,
    });
    expect(match?.reason).toBe("proximity");
    expect(match?.card.id).toBe("br");
    expect(match?.distanceMeters).toBeLessThan(NEARBY_PIN_METERS);
  });

  it("ignores pins farther than the threshold", () => {
    const match = findMatchingPin([brasilia], {
      address: "Somewhere else",
      lat: -22.9,
      lng: -43.2,
    });
    expect(match).toBeUndefined();
  });

  it("respects excludeId", () => {
    const match = findMatchingPin([brasilia], {
      address: brasilia.address,
      lat: brasilia.lat,
      lng: brasilia.lng,
    }, { excludeId: "br" });
    expect(match).toBeUndefined();
  });
});
