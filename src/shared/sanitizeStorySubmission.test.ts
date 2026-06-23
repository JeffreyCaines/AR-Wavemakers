import { describe, expect, it } from "vitest";
import {
  sanitizeEmail,
  sanitizeHttpUrl,
  sanitizeMultilineText,
  sanitizePlainText,
  sanitizeStorySubmissionInput,
} from "./sanitizeStorySubmission";

describe("sanitizePlainText", () => {
  it("strips HTML tags", () => {
    expect(sanitizePlainText("<b>Hello</b> world", 100)).toBe("Hello world");
  });

  it("removes control characters and zero-width spaces", () => {
    expect(sanitizePlainText("Hello\u0000\u200Bworld", 100)).toBe("Helloworld");
  });

  it("collapses whitespace and enforces max length", () => {
    expect(sanitizePlainText("  too   many   spaces  ", 100)).toBe("too many spaces");
    expect(sanitizePlainText("1234567890", 5)).toBe("12345");
  });

  it("returns empty string for non-strings", () => {
    expect(sanitizePlainText(null, 100)).toBe("");
    expect(sanitizePlainText(42, 100)).toBe("");
  });
});

describe("sanitizeMultilineText", () => {
  it("preserves paragraph breaks", () => {
    expect(sanitizeMultilineText("Line one\n\nLine two", 100)).toBe("Line one\n\nLine two");
  });

  it("normalizes each line and collapses excess blank lines", () => {
    expect(sanitizeMultilineText("  spaced  \n\n\n\nnext", 100)).toBe("spaced\n\nnext");
  });

  it("strips HTML across lines", () => {
    expect(sanitizeMultilineText("<script>x</script>\n<b>ok</b>", 100)).toBe("x\nok");
  });
});

describe("sanitizeEmail", () => {
  it("accepts valid ASCII email", () => {
    expect(sanitizeEmail("Contact@Example.COM")).toBe("contact@example.com");
  });

  it("rejects invalid format", () => {
    expect(sanitizeEmail("not-an-email")).toBeUndefined();
    expect(sanitizeEmail("@missing-local.com")).toBeUndefined();
  });

  it("rejects IDN homographs in the domain", () => {
    // Cyrillic "a" (U+0430) in domain label
    expect(sanitizeEmail("user@exampl\u0430.com")).toBeUndefined();
    expect(sanitizeEmail("user@\u0440\u0430ypal.com")).toBeUndefined();
  });

  it("rejects IDN homographs in the local part", () => {
    expect(sanitizeEmail("\u0430dmin@example.com")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(sanitizeEmail("")).toBeUndefined();
    expect(sanitizeEmail("   ")).toBeUndefined();
  });
});

describe("sanitizeHttpUrl", () => {
  it("accepts valid http and https URLs", () => {
    expect(sanitizeHttpUrl("https://example.com/logo.png", 500)).toBe("https://example.com/logo.png");
    expect(sanitizeHttpUrl("http://example.co.uk", 500)).toBe("http://example.co.uk/");
  });

  it("rejects non-http schemes and embedded credentials", () => {
    expect(sanitizeHttpUrl("javascript:alert(1)", 500)).toBeUndefined();
    expect(sanitizeHttpUrl("https://user:pass@example.com", 500)).toBeUndefined();
  });

  it("rejects unicode hostname homographs before normalization", () => {
    // Cyrillic "apple" lookalike
    expect(sanitizeHttpUrl("https://\u0430\u0440\u0440le.com", 500)).toBeUndefined();
  });

  it("rejects punycode IDN labels", () => {
    expect(sanitizeHttpUrl("https://xn--80ak6aa92e.com", 500)).toBeUndefined();
  });

  it("returns undefined for empty or invalid URLs", () => {
    expect(sanitizeHttpUrl("", 500)).toBeUndefined();
    expect(sanitizeHttpUrl("not a url", 500)).toBeUndefined();
  });
});

describe("sanitizeStorySubmissionInput", () => {
  const validInput = {
    title: "Ocean intelligence",
    companyName: "NL Ocean Tech",
    body: "We monitor marine conditions in real time.",
    address: "St. John's, NL, Canada",
    contactEmail: "team@example.com",
    imageUrl: "https://example.com/logo.png",
    linkUrl: "https://example.com",
  };

  it("accepts a fully valid submission", () => {
    const result = sanitizeStorySubmissionInput(validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Ocean intelligence");
    expect(result.value.contactEmail).toBe("team@example.com");
    expect(result.value.imageUrl).toBe("https://example.com/logo.png");
  });

  it("accepts submission without optional fields", () => {
    const result = sanitizeStorySubmissionInput({
      title: "Title",
      companyName: "",
      body: "Story body",
      address: "Toronto, Canada",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Title",
        companyName: "",
        body: "Story body",
        address: "Toronto, Canada",
        contactEmail: undefined,
        imageUrl: undefined,
        linkUrl: undefined,
      },
    });
  });

  it("rejects missing required fields", () => {
    expect(sanitizeStorySubmissionInput({ body: "x", address: "y" })).toEqual({
      ok: false,
      error: "Story title is required.",
    });
    expect(
      sanitizeStorySubmissionInput({ title: "T", address: "y", companyName: "", body: "" })
    ).toEqual({
      ok: false,
      error: "Impact story is required.",
    });
    expect(
      sanitizeStorySubmissionInput({ title: "T", body: "B", companyName: "", address: "" })
    ).toEqual({
      ok: false,
      error: "Location is required.",
    });
  });

  it("rejects invalid and homograph emails", () => {
    expect(
      sanitizeStorySubmissionInput({ ...validInput, contactEmail: "bad-email" })
    ).toEqual({
      ok: false,
      error: "Enter a valid ASCII email address or leave it blank.",
    });
    expect(
      sanitizeStorySubmissionInput({ ...validInput, contactEmail: "user@exampl\u0430.com" })
    ).toEqual({
      ok: false,
      error: "Enter a valid ASCII email address or leave it blank.",
    });
  });

  it("rejects homograph URLs", () => {
    expect(
      sanitizeStorySubmissionInput({ ...validInput, linkUrl: "https://\u0430\u0440\u0440le.com" })
    ).toEqual({
      ok: false,
      error: "Website URL must be a valid http or https link with an ASCII domain name.",
    });
  });

  it("strips HTML from text fields in accepted submissions", () => {
    const result = sanitizeStorySubmissionInput({
      title: "<em>Safe</em> title",
      companyName: "<b>Co</b>",
      body: "Line\n\n<script>bad</script>story",
      address: "City",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Safe title");
    expect(result.value.companyName).toBe("Co");
    expect(result.value.body).toBe("Line\n\nbadstory");
  });

  it("rejects non-object input", () => {
    expect(sanitizeStorySubmissionInput(null)).toEqual({ ok: false, error: "Invalid submission." });
    expect(sanitizeStorySubmissionInput([])).toEqual({ ok: false, error: "Invalid submission." });
  });
});
