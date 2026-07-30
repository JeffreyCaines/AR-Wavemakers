import {
  DEFAULT_RIPPLES_ANCHOR,
  DEFAULT_RIPPLES_PLACEMENT,
  type RipplesAnchor,
  type RipplesAnchorPlacement,
  type RipplesVariant,
} from "./types";

export function normalizeRipplesAnchor(input: unknown): RipplesAnchor {
  if (!input || typeof input !== "object") return cloneRipplesAnchor(DEFAULT_RIPPLES_ANCHOR);

  const value = input as Record<string, unknown>;

  // Migrate legacy flat anchor objects.
  if ("mapX" in value && !("loop" in value)) {
    const legacy = normalizeRipplesPlacement(value);
    return {
      activeVariant: "loop",
      loop: legacy,
      fade: { ...legacy },
    };
  }

  const activeVariant: RipplesVariant = value.activeVariant === "fade" ? "fade" : "loop";
  const loop = normalizeRipplesPlacement(value.loop);
  const fade = normalizeRipplesPlacement(value.fade ?? loop);

  return { activeVariant, loop, fade };
}

function normalizeRipplesPlacement(input: unknown): RipplesAnchorPlacement {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const mapX = Number(record.mapX);
  const mapY = Number(record.mapY);
  const originX = Number(record.originX);
  const originY = Number(record.originY);
  const widthRatio = Number(record.widthRatio);
  return {
    mapX: Number.isFinite(mapX) ? mapX : DEFAULT_RIPPLES_PLACEMENT.mapX,
    mapY: Number.isFinite(mapY) ? mapY : DEFAULT_RIPPLES_PLACEMENT.mapY,
    originX: Number.isFinite(originX) ? originX : DEFAULT_RIPPLES_PLACEMENT.originX,
    originY: Number.isFinite(originY) ? originY : DEFAULT_RIPPLES_PLACEMENT.originY,
    widthRatio: Number.isFinite(widthRatio) ? widthRatio : DEFAULT_RIPPLES_PLACEMENT.widthRatio,
  };
}

function cloneRipplesAnchor(anchor: RipplesAnchor): RipplesAnchor {
  return {
    activeVariant: anchor.activeVariant,
    loop: { ...anchor.loop },
    fade: { ...anchor.fade },
  };
}
