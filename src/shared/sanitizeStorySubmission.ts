import type { StorySubmissionInput } from "./types";

const LIMITS = {
  title: 120,
  companyName: 120,
  body: 4000,
  address: 200,
  contactEmail: 200,
  imageUrl: 500,
  linkUrl: 500,
} as const;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const HTML_TAGS = /<[^>]*>/g;

/** Strip markup, control characters, and normalize whitespace for single-line fields. */
export function sanitizePlainText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(CONTROL_CHARS, "")
    .replace(ZERO_WIDTH, "")
    .replace(HTML_TAGS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLen);
}

/** Like plain text but preserves paragraph breaks in the impact story. */
export function sanitizeMultilineText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(CONTROL_CHARS, "")
    .replace(ZERO_WIDTH, "")
    .replace(HTML_TAGS, "")
    
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, maxLen);
}

export function sanitizeEmail(value: unknown): string | undefined {
  const email = sanitizePlainText(value, LIMITS.contactEmail).toLowerCase();
  if (!email) return undefined;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return undefined;
  return email;
}

/** Allow only http/https URLs without embedded credentials. */
export function sanitizeHttpUrl(value: unknown, maxLen: number): string | undefined {
  const raw = sanitizePlainText(value, maxLen);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return url.toString().slice(0, maxLen);
  } catch {
    return undefined;
  }
}

export type SanitizeStoryInputResult =
  | { ok: true; value: StorySubmissionInput }
  | { ok: false; error: string };

export function sanitizeStorySubmissionInput(input: unknown): SanitizeStoryInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid submission." };
  }

  const raw = input as Record<string, unknown>;
  const title = sanitizePlainText(raw.title, LIMITS.title);
  const body = sanitizeMultilineText(raw.body, LIMITS.body);
  const address = sanitizePlainText(raw.address, LIMITS.address);
  const companyName = sanitizePlainText(raw.companyName, LIMITS.companyName);

  if (!title) return { ok: false, error: "Story title is required." };
  if (!body) return { ok: false, error: "Impact story is required." };
  if (!address) return { ok: false, error: "Location is required." };

  let contactEmail: string | undefined;
  const contactEmailRaw = sanitizePlainText(raw.contactEmail, LIMITS.contactEmail);
  if (contactEmailRaw) {
    contactEmail = sanitizeEmail(contactEmailRaw);
    if (!contactEmail) {
      return { ok: false, error: "Enter a valid contact email or leave it blank." };
    }
  }

  let imageUrl: string | undefined;
  const imageUrlRaw = sanitizePlainText(raw.imageUrl, LIMITS.imageUrl);
  if (imageUrlRaw) {
    imageUrl = sanitizeHttpUrl(imageUrlRaw, LIMITS.imageUrl);
    if (!imageUrl) {
      return { ok: false, error: "Image URL must be a valid http or https link." };
    }
  }

  let linkUrl: string | undefined;
  const linkUrlRaw = sanitizePlainText(raw.linkUrl, LIMITS.linkUrl);
  if (linkUrlRaw) {
    linkUrl = sanitizeHttpUrl(linkUrlRaw, LIMITS.linkUrl);
    if (!linkUrl) {
      return { ok: false, error: "Website URL must be a valid http or https link." };
    }
  }

  return {
    ok: true,
    value: { title, companyName, body, address, contactEmail, imageUrl, linkUrl },
  };
}
