import { describe, expect, it } from "vitest";
import { normalizeRipplesAnchor } from "./ripplesAnchor";
import { DEFAULT_RIPPLES_PLACEMENT } from "./types";

describe("normalizeRipplesAnchor", () => {
  it("migrates legacy flat anchor objects", () => {
    const normalized = normalizeRipplesAnchor({
      mapX: 0.31,
      mapY: 0.42,
      originX: 0.33,
      originY: 0.67,
      widthRatio: 1,
    });

    expect(normalized.activeVariant).toBe("loop");
    expect(normalized.loop.mapX).toBe(0.31);
    expect(normalized.fade.mapY).toBe(0.42);
  });

  it("fills missing variant placements with defaults", () => {
    const normalized = normalizeRipplesAnchor({
      activeVariant: "fade",
      fade: { mapX: 0.4, mapY: 0.5, originX: 0.33, originY: 0.67, widthRatio: 1 },
    });

    expect(normalized.activeVariant).toBe("fade");
    expect(normalized.fade.mapX).toBe(0.4);
    expect(normalized.loop.mapX).toBe(DEFAULT_RIPPLES_PLACEMENT.mapX);
  });
});
