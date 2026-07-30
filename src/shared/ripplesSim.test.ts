import { describe, expect, it } from "vitest";
import {
  getRipplesSimDurationSec,
  leadingRippleRadiusNorm,
  rippleState,
  RIPPLE_EXPANSION_DURATION_SEC,
  RIPPLE_SPAWN_DELAY_SEC,
} from "./ripplesSim";

describe("ripplesSim", () => {
  it("matches ripples.py total_duration", () => {
    expect(getRipplesSimDurationSec()).toBeCloseTo(
      (4 - 1) * RIPPLE_SPAWN_DELAY_SEC + RIPPLE_EXPANSION_DURATION_SEC,
      5
    );
  });

  it("keeps later ripples unspawned until their delay", () => {
    expect(rippleState(1, 0.5, 1).radius).toBe(0);
    expect(rippleState(1, RIPPLE_SPAWN_DELAY_SEC, 1).radius).toBe(0);
    expect(rippleState(1, RIPPLE_SPAWN_DELAY_SEC + 0.01, 1).radius).toBeGreaterThan(0);
  });

  it("uses the first ripple as the leading radius", () => {
    const t = 2;
    expect(leadingRippleRadiusNorm(t, 1)).toBe(rippleState(0, t, 1).radius);
  });
});
