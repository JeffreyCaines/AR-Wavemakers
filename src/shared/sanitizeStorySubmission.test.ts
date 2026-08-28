import { describe, expect, it } from "vitest";
import { sanitizeIndividualSubmissionInput } from "./sanitizeGetNoticed";
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
    expect(sanitizeEmail("Contact@Example.COM")).toEqual({
      email: "contact@example.com",
      substitutions: [],
    });
  });

  it("rejects invalid format", () => {
    expect(sanitizeEmail("not-an-email")).toEqual({ substitutions: [] });
    expect(sanitizeEmail("@missing-local.com")).toEqual({ substitutions: [] });
  });

  it("replaces IDN homographs in the domain and does not keep the original glyph", () => {
    expect(sanitizeEmail("user@exampl\u0435.com")).toEqual({
      email: "user@example.com",
      substitutions: [{ correct: "e", homoglyph: "\u0435" }],
    });
    expect(sanitizeEmail("user@\u0440\u0430ypal.com")).toEqual({
      email: "user@paypal.com",
      substitutions: [
        { correct: "p", homoglyph: "\u0440" },
        { correct: "a", homoglyph: "\u0430" },
      ],
    });
  });

  it("replaces IDN homographs in the local part", () => {
    expect(sanitizeEmail("\u0430dmin@example.com")).toEqual({
      email: "admin@example.com",
      substitutions: [{ correct: "a", homoglyph: "\u0430" }],
    });
  });

  it("returns undefined email for empty input", () => {
    expect(sanitizeEmail("")).toEqual({ substitutions: [] });
    expect(sanitizeEmail("   ")).toEqual({ substitutions: [] });
  });
});

describe("sanitizeHttpUrl", () => {
  it("accepts valid http and https URLs", () => {
    expect(sanitizeHttpUrl("https://example.com/logo.png", 500)).toEqual({
      url: "https://example.com/logo.png",
      substitutions: [],
    });
    expect(sanitizeHttpUrl("http://example.co.uk", 500)).toEqual({
      url: "http://example.co.uk/",
      substitutions: [],
    });
  });

  it("rejects non-http schemes and embedded credentials", () => {
    expect(sanitizeHttpUrl("javascript:alert(1)", 500)).toEqual({ substitutions: [] });
    expect(sanitizeHttpUrl("https://user:pass@example.com", 500)).toEqual({ substitutions: [] });
  });

  it("replaces unicode hostname homographs and does not keep the original host", () => {
    const result = sanitizeHttpUrl("https://\u0430\u0440\u0440le.com", 500);
    expect(result.url).toBe("https://apple.com/");
    expect(result.substitutions).toEqual([
      { correct: "a", homoglyph: "\u0430" },
      { correct: "p", homoglyph: "\u0440" },
    ]);
    expect(result.url).not.toContain("\u0430");
    expect(result.url).not.toContain("\u0440");
  });

  it("decodes punycode IDN labels, replaces homoglyphs, and drops the original encoding", () => {
    const result = sanitizeHttpUrl("https://xn--80ak6aa92e.com", 500);
    expect(result.url).toBe("https://apple.com/");
    expect(result.url).not.toContain("xn--");
    expect(result.substitutions).toEqual([
      { correct: "a", homoglyph: "\u0430" },
      { correct: "p", homoglyph: "\u0440" },
      { correct: "l", homoglyph: "\u04cf" },
      { correct: "e", homoglyph: "\u0435" },
    ]);
  });

  it("returns undefined URL for empty or invalid URLs", () => {
    expect(sanitizeHttpUrl("", 500)).toEqual({ substitutions: [] });
    expect(sanitizeHttpUrl("not a url", 500)).toEqual({ substitutions: [] });
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
    expect(result.value.hadHomograph).toBe(false);
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
        submissionType: "legacy",
        title: "Title",
        companyName: "",
        body: "Story body",
        address: "Toronto, Canada",
        contactEmail: undefined,
        imageUrl: undefined,
        linkUrl: undefined,
        hadHomograph: false,
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

  it("rejects invalid emails and replaces homograph emails", () => {
    expect(
      sanitizeStorySubmissionInput({ ...validInput, contactEmail: "bad-email" })
    ).toEqual({
      ok: false,
      error: "Enter a valid ASCII email address or leave it blank.",
    });
    const homograph = sanitizeStorySubmissionInput({
      ...validInput,
      contactEmail: "user@exampl\u0435.com",
    });
    expect(homograph.ok).toBe(true);
    if (!homograph.ok) return;
    expect(homograph.value.hadHomograph).toBe(true);
    expect(homograph.value.contactEmail).toBe("user@example.com");
    expect(homograph.value.contactEmail).not.toContain("\u0435");
    expect(homograph.value.homographFields?.contactEmail).toEqual([
      { correct: "e", homoglyph: "\u0435" },
    ]);
  });

  it("replaces homograph URLs and flags the field", () => {
    const result = sanitizeStorySubmissionInput({
      ...validInput,
      linkUrl: "https://\u0430\u0440\u0440le.com",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hadHomograph).toBe(true);
    expect(result.value.linkUrl).toBe("https://apple.com/");
    expect(result.value.linkUrl).not.toContain("\u0430");
    expect(result.value.homographFields?.linkUrl).toEqual([
      { correct: "a", homoglyph: "\u0430" },
      { correct: "p", homoglyph: "\u0440" },
    ]);
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

describe("sanitizeIndividualSubmissionInput homograph flag", () => {
  const validIndividual = {
    submissionType: "individual",
    firstName: "Ada",
    lastName: "Lovelace",
    isTechNlMember: "Yes",
    profession: ["Software"],
    currLocation: "St. John's, NL",
    origLocation: "St. John's, NL",
    email: "ada@example.com",
    logoUrl: "/api/uploads/abc123",
    optInModeration: true,
    optInNewsletter: false,
  };

  it("replaces LinkedIn homoglyphs, flags the field, and drops the original host", () => {
    const result = sanitizeIndividualSubmissionInput({
      ...validIndividual,
      linkedin: "https://\u0430\u0440\u0440le.com/in/ada",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hadHomograph).toBe(true);
    expect(result.value.linkedin).toBe("https://apple.com/in/ada");
    expect(result.value.linkedin).not.toContain("\u0430");
    expect(result.value.homographFields?.linkedin).toEqual([
      { correct: "a", homoglyph: "\u0430" },
      { correct: "p", homoglyph: "\u0440" },
    ]);
  });

  it("keeps client substitution flags when the posted value is already cleaned", () => {
    const result = sanitizeIndividualSubmissionInput({
      ...validIndividual,
      linkedin: "https://apple.com/in/ada",
      homographFields: {
        linkedin: [{ correct: "a", homoglyph: "\u0430" }],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hadHomograph).toBe(true);
    expect(result.value.linkedin).toBe("https://apple.com/in/ada");
    expect(result.value.homographFields?.linkedin).toEqual([
      { correct: "a", homoglyph: "\u0430" },
    ]);
  });

  it("leaves homograph flags empty for ASCII URLs and local uploads", () => {
    const result = sanitizeIndividualSubmissionInput({
      ...validIndividual,
      linkedin: "https://linkedin.com/in/ada",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hadHomograph).toBe(false);
    expect(result.value.homographFields).toBeUndefined();
  });
});
