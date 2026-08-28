import { describe, expect, it } from "vitest";
import { buildCardContentHtml, safeHref } from "./cardContent";
import type { InfoCard } from "./types";

const baseCard: InfoCard = {
  id: "card-1",
  title: "Test",
  body: "Body",
  address: "St. John's",
  lat: 0,
  lng: 0,
  mapX: 0.5,
  mapY: 0.5,
  active: true,
};

describe("safeHref", () => {
  it("allows http, https, mailto, and upload paths", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(safeHref("/api/uploads/abc")).toBe("/api/uploads/abc");
  });

  it("blocks script-bearing schemes regardless of casing or padding", () => {
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("  JaVaScRiPt:alert(1)")).toBe("");
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(safeHref("vbscript:msgbox(1)")).toBe("");
  });
});

describe("buildCardContentHtml", () => {
  it("omits a link whose URL uses an unsafe scheme", () => {
    const html = buildCardContentHtml({ ...baseCard, linkUrl: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("ar-card__link");
  });

  it("escapes text so stored markup cannot break out", () => {
    const html = buildCardContentHtml({ ...baseCard, title: '"><script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a valid link", () => {
    const html = buildCardContentHtml({ ...baseCard, linkUrl: "https://example.com/x" });
    expect(html).toContain('href="https://example.com/x"');
  });
});
