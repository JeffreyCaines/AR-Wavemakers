import { describe, expect, it } from "vitest";
import { isPinRevealed, ST_JOHNS_CARD_ID } from "./ripplesReveal";
import { leadingRippleRadiusNorm, RIPPLE_EXPANSION_DURATION_SEC } from "./ripplesSim";

const ORIGIN = { mapX: 0.35, mapY: 0.5 };
const W = 4032;
const H = 3024;
const PLAY_SEC = 12.1;

const stJohns = { id: ST_JOHNS_CARD_ID, mapX: 0.34, mapY: 0.52 };
const near = { id: "near-pin", mapX: 0.36, mapY: 0.51 };
const far = { id: "far-pin", mapX: 0.9, mapY: 0.1 };

describe("leadingRippleRadiusNorm", () => {
  it("grows over expansion duration", () => {
    expect(leadingRippleRadiusNorm(0, 1)).toBe(0);
    expect(leadingRippleRadiusNorm(RIPPLE_EXPANSION_DURATION_SEC / 2, 1)).toBeCloseTo(0.5, 5);
    expect(leadingRippleRadiusNorm(RIPPLE_EXPANSION_DURATION_SEC, 1)).toBe(1);
  });
});

describe("isPinRevealed", () => {
  it("always reveals St. John's", () => {
    expect(isPinRevealed(stJohns, ORIGIN, null, PLAY_SEC, "loop", W, H)).toBe(true);
    expect(isPinRevealed(stJohns, ORIGIN, 0, PLAY_SEC, "loop", W, H)).toBe(true);
  });

  it("hides other pins before playback starts", () => {
    expect(isPinRevealed(near, ORIGIN, null, PLAY_SEC, "loop", W, H)).toBe(false);
  });

  it("reveals nearer pins before farther pins", () => {
    const mid = RIPPLE_EXPANSION_DURATION_SEC * 0.15;
    expect(isPinRevealed(near, ORIGIN, mid, PLAY_SEC, "loop", W, H)).toBe(true);
    expect(isPinRevealed(far, ORIGIN, mid, PLAY_SEC, "loop", W, H)).toBe(false);
  });

  it("reveals all pins when forceAll or play finished", () => {
    expect(isPinRevealed(far, ORIGIN, 0, PLAY_SEC, "loop", W, H, true)).toBe(true);
    expect(isPinRevealed(far, ORIGIN, PLAY_SEC, PLAY_SEC, "loop", W, H)).toBe(true);
  });
});
