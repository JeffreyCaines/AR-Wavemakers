import { describe, expect, it } from "vitest";
import {
  findGroupForCardId,
  groupCardsByLocation,
  locationKey,
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
