import type { InfoCard } from "../../../src/shared/types";
import {
  sanitizeEmail,
  sanitizeHttpUrl,
  sanitizeMultilineText,
  sanitizePlainText,
} from "../../../src/shared/sanitizeStorySubmission";

/**
 * Mirrors the maxlength attributes on the admin card form so saving an existing
 * card never silently truncates it.
 */
const LIMITS = {
  name: 120,
  member: 32,
  location: 200,
  email: 200,
  url: 500,
  option: 120,
  shortAnswer: 250,
  longStory: 750,
  body: 4000,
  maxListItems: 20,
} as const;

type Sanitizer = (value: unknown) => unknown;

function text(maxLen: number): Sanitizer {
  return (value) => sanitizePlainText(value, maxLen);
}

function multiline(maxLen: number): Sanitizer {
  return (value) => sanitizeMultilineText(value, maxLen);
}

/** Accepts an https/http URL or a local upload path; anything else becomes undefined. */
function url(value: unknown): string | undefined {
  const raw = sanitizePlainText(value, LIMITS.url);
  if (!raw) return undefined;
  if (raw.startsWith("/api/uploads/")) {
    return /^\/api\/uploads\/[a-zA-Z0-9_-]+$/.test(raw) ? raw : undefined;
  }
  return sanitizeHttpUrl(raw, LIMITS.url).url;
}

function email(value: unknown): string | undefined {
  return sanitizeEmail(value).email;
}

function list(maxLen: number): Sanitizer {
  return (value) => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      const entry = sanitizePlainText(item, maxLen);
      if (entry && !out.includes(entry)) out.push(entry);
      if (out.length >= LIMITS.maxListItems) break;
    }
    return out;
  };
}

function boolean(value: unknown): boolean {
  return value === true;
}

function clampedNumber(min: number, max: number, fallback: number): Sanitizer {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
}

function finiteNumber(fallback: number): Sanitizer {
  return (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
}

function year(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < 1800 || parsed > new Date().getFullYear() + 1) return undefined;
  return parsed;
}

function cardType(value: unknown): InfoCard["cardType"] {
  return value === "individual" ? "individual" : "organization";
}

/**
 * Allowlist of writable card fields. Anything absent from this map is dropped,
 * so a client cannot inject arbitrary keys through the spread in handleCards.
 */
const FIELDS: Record<string, Sanitizer> = {
  title: text(LIMITS.name),
  body: multiline(LIMITS.body),
  companyName: text(LIMITS.name),
  address: text(LIMITS.location),
  lat: clampedNumber(-90, 90, 0),
  lng: clampedNumber(-180, 180, 0),
  mapX: finiteNumber(0.5),
  mapY: finiteNumber(0.5),
  imageUrl: url,
  linkUrl: url,
  active: boolean,
  cardType,

  firstName: text(LIMITS.name),
  lastName: text(LIMITS.name),
  pronouns: text(LIMITS.name),
  profession: list(LIMITS.option),
  currLocation: text(LIMITS.location),
  origLocation: text(LIMITS.location),
  linkedin: url,
  email,
  nlDescription: multiline(LIMITS.shortAnswer),
  whyDescription: multiline(LIMITS.shortAnswer),
  dreamJob: multiline(LIMITS.shortAnswer),
  story: multiline(LIMITS.longStory),

  submitterName: text(LIMITS.name),
  submitterEmail: email,
  orgName: text(LIMITS.name),
  industry: list(LIMITS.option),
  nlLocation: text(LIMITS.location),
  locations: list(LIMITS.location),
  websiteUrl: url,
  linkedinUrl: url,
  orgContactEmail: email,
  yearEstablished: year,
  mainDescription: multiline(LIMITS.shortAnswer),
  companyBio: multiline(LIMITS.shortAnswer),
  mediaOneUrl: url,
  mediaTwoUrl: url,
  youtubeLink: url,
  exportLocations: list(LIMITS.location),
  stakeholderDescription: multiline(LIMITS.shortAnswer),
  storyDescription: multiline(LIMITS.shortAnswer),

  isTechNlMember: text(LIMITS.member),
  logoUrl: url,
  optInModeration: boolean,
  optInNewsletter: boolean,
};

/** Fields an InfoCard must always carry, with the defaults used when creating one. */
const CREATE_DEFAULTS: Record<string, unknown> = {
  title: "",
  body: "",
  address: "",
  lat: 0,
  lng: 0,
  mapX: 0.5,
  mapY: 0.5,
  active: false,
};

/**
 * Sanitize a card payload against the allowlist. Only keys present in the input
 * are returned, so PUT can still be used for partial updates.
 */
export function sanitizeCardPatch(input: unknown): Partial<InfoCard> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [field, sanitize] of Object.entries(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    // `undefined` is kept so an admin clearing a URL or email field, or supplying
    // one that fails validation, overwrites the stored value instead of keeping it.
    patch[field] = sanitize(raw[field]);
  }
  return patch as Partial<InfoCard>;
}

export function sanitizeNewCard(input: unknown): Omit<InfoCard, "id"> | null {
  const patch = sanitizeCardPatch(input);
  if (!patch) return null;
  return { ...CREATE_DEFAULTS, ...patch } as Omit<InfoCard, "id">;
}
