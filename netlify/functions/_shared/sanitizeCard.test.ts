import { describe, expect, it } from "vitest";
import { sanitizeCardPatch, sanitizeNewCard } from "./sanitizeCard";
import { sniffImageType } from "./storage";

describe("sanitizeCardPatch", () => {
  it("drops keys outside the allowlist", () => {
    const patch = sanitizeCardPatch({ title: "Ok", id: "spoofed", passwordHash: "x" });
    expect(patch).toEqual({ title: "Ok" });
  });

  it("only returns fields present in the input so partial updates work", () => {
    expect(sanitizeCardPatch({ mapX: 0.25, mapY: 0.75 })).toEqual({ mapX: 0.25, mapY: 0.75 });
  });

  it("rejects javascript: and data: URLs", () => {
    const patch = sanitizeCardPatch({
      linkUrl: "javascript:alert(1)",
      imageUrl: "data:text/html,<script>alert(1)</script>",
    });
    expect(patch).toEqual({ linkUrl: undefined, imageUrl: undefined });
  });

  it("keeps http(s) links and local upload paths", () => {
    const patch = sanitizeCardPatch({
      websiteUrl: "https://example.com/a",
      logoUrl: "/api/uploads/abc123",
    });
    expect(patch?.websiteUrl).toBe("https://example.com/a");
    expect(patch?.logoUrl).toBe("/api/uploads/abc123");
  });

  it("rejects upload paths that try to traverse to another blob key", () => {
    expect(sanitizeCardPatch({ logoUrl: "/api/uploads/../admins.json" })?.logoUrl).toBeUndefined();
  });

  it("strips markup from text fields", () => {
    expect(sanitizeCardPatch({ title: "<img src=x onerror=alert(1)>Hi" })?.title).toBe("Hi");
  });

  it("clamps coordinates and rejects non-numeric input", () => {
    const patch = sanitizeCardPatch({ lat: 999, lng: -999, mapX: "nope" });
    expect(patch).toEqual({ lat: 90, lng: -180, mapX: 0.5 });
  });

  it("coerces active to a strict boolean", () => {
    expect(sanitizeCardPatch({ active: "yes" })?.active).toBe(false);
    expect(sanitizeCardPatch({ active: true })?.active).toBe(true);
  });

  it("rejects non-object payloads", () => {
    expect(sanitizeCardPatch(null)).toBeNull();
    expect(sanitizeCardPatch([{ title: "x" }])).toBeNull();
  });
});

describe("sanitizeNewCard", () => {
  it("fills required fields with defaults", () => {
    expect(sanitizeNewCard({ title: "Only a title" })).toEqual({
      title: "Only a title",
      body: "",
      address: "",
      lat: 0,
      lng: 0,
      mapX: 0.5,
      mapY: 0.5,
      active: false,
    });
  });
});

describe("sniffImageType", () => {
  const withHeader = (bytes: number[]): Uint8Array =>
    new Uint8Array([...bytes, ...new Array(16).fill(0)]);

  it("identifies the allowed image formats", () => {
    expect(sniffImageType(withHeader([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(sniffImageType(withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png"
    );
    expect(sniffImageType(withHeader([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
    const webp = withHeader([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("rejects payloads that are not images", () => {
    expect(sniffImageType(new TextEncoder().encode("<html>hello world</html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});
