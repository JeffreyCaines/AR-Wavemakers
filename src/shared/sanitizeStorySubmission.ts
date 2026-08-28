import {
  decodePunycodeHostname,
  emptyHomographFlags,
  homographFlagsDetected,
  mergeIncomingHomographFields,
  mergeSubstitutions,
  recordFieldSubstitutions,
  replaceHomoglyphs,
  type HomoglyphSubstitution,
  type HomographFlags,
} from "./homoglyphs";
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

/** Letters from scripts commonly used to impersonate Latin domain names. */
const HOMOGRAPH_LETTER =
  /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Hebrew}]/u;

const ASCII_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

function hasMixedLetterScripts(text: string): boolean {
  let hasLatin = false;
  let hasNonLatinLetter = false;
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    if (/\p{Script=Common}/u.test(char) || /\p{Script=Inherited}/u.test(char)) continue;
    if (/\p{Script=Latin}/u.test(char)) {
      hasLatin = true;
    } else {
      hasNonLatinLetter = true;
    }
    if (hasLatin && hasNonLatinLetter) return true;
  }
  return false;
}

/** True when a hostname label may be an IDN homograph. */
function hostnameLabelHasHomographRisk(label: string): boolean {
  if (!label) return false;
  const lower = label.toLowerCase();
  // Punycode-encoded IDN can still decode to brand lookalikes.
  if (lower.startsWith("xn--")) return true;
  if (HOMOGRAPH_LETTER.test(label)) return true;
  if (hasNonAscii(label) && /\p{L}/u.test(label)) return true;
  if (hasMixedLetterScripts(label)) return true;
  return false;
}

function hostnameHasHomographRisk(hostname: string): boolean {
  const host = hostname.replace(/^\[(.*)\]$/, "$1");
  if (host.includes(":")) return false;
  return host.split(".").some(hostnameLabelHasHomographRisk);
}

function emailHasHomographRisk(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (hasNonAscii(local) || HOMOGRAPH_LETTER.test(local) || hasMixedLetterScripts(local)) {
    return true;
  }
  return hostnameHasHomographRisk(domain);
}

function extractHostFromRawUrl(raw: string): string | null {
  const match = /^https?:\/\/([^/?#]+)/i.exec(raw);
  if (!match?.[1]) return null;
  const host = match[1].split("@").pop()?.split(":")[0];
  return host ?? null;
}

function decodeHostForCheck(host: string): string {
  try {
    return decodeURIComponent(host);
  } catch {
    return host;
  }
}

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

export type { HomoglyphSubstitution, HomographFlags };

export type SanitizeEmailResult = {
  email?: string;
  substitutions: HomoglyphSubstitution[];
};

export type SanitizeHttpUrlResult = {
  url?: string;
  substitutions: HomoglyphSubstitution[];
};

function cleanHostname(host: string): { host: string; substitutions: HomoglyphSubstitution[] } {
  const decoded = decodePunycodeHostname(decodeHostForCheck(host));
  const replaced = replaceHomoglyphs(decoded);
  return { host: replaced.text, substitutions: replaced.substitutions };
}

function rewriteRawUrlHost(raw: string, nextHost: string): string {
  return raw.replace(/^https?:\/\/([^/?#]+)/i, (full, hostPart: string) => {
    const at = hostPart.lastIndexOf("@");
    const user = at >= 0 ? hostPart.slice(0, at + 1) : "";
    const hostAndPort = at >= 0 ? hostPart.slice(at + 1) : hostPart;
    const colon = hostAndPort.indexOf(":");
    const port = colon >= 0 ? hostAndPort.slice(colon) : "";
    return `${full.slice(0, full.length - hostPart.length)}${user}${nextHost}${port}`;
  });
}

export function sanitizeEmail(value: unknown): SanitizeEmailResult {
  const raw = sanitizePlainText(value, LIMITS.contactEmail).toLowerCase();
  if (!raw) return { substitutions: [] };

  const replaced = replaceHomoglyphs(raw);
  let email = replaced.text;
  let substitutions = replaced.substitutions;

  const at = email.lastIndexOf("@");
  if (at > 0) {
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const domainClean = cleanHostname(domain);
    substitutions = mergeSubstitutions(substitutions, domainClean.substitutions);
    email = `${local}@${domainClean.host}`;
  }

  if (!ASCII_EMAIL.test(email)) return { substitutions };
  if (emailHasHomographRisk(email)) return { substitutions };
  return { email, substitutions };
}

/** Allow only http/https URLs without embedded credentials. Homoglyphs are replaced, not stored. */
export function sanitizeHttpUrl(value: unknown, maxLen: number): SanitizeHttpUrlResult {
  const raw = sanitizePlainText(value, maxLen);
  if (!raw) return { substitutions: [] };

  const inString = replaceHomoglyphs(raw);
  let working = inString.text;
  let substitutions = inString.substitutions;

  const rawHost = extractHostFromRawUrl(working);
  if (rawHost) {
    const hostClean = cleanHostname(rawHost);
    substitutions = mergeSubstitutions(substitutions, hostClean.substitutions);
    if (hostClean.host !== rawHost) {
      working = rewriteRawUrlHost(working, hostClean.host);
    }
  }

  try {
    const url = new URL(working);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { substitutions };
    }
    if (url.username || url.password) {
      return { substitutions };
    }
    if (hostnameHasHomographRisk(url.hostname)) {
      return { substitutions };
    }
    return { url: url.toString().slice(0, maxLen), substitutions };
  } catch {
    return { substitutions };
  }
}

export function takeSanitizedEmail(
  value: unknown,
  flags: HomographFlags,
  field: string
): string | undefined {
  const result = sanitizeEmail(value);
  recordFieldSubstitutions(flags, field, result.substitutions);
  return result.email;
}

export function takeSanitizedHttpUrl(
  value: unknown,
  maxLen: number,
  flags: HomographFlags,
  field: string
): string | undefined {
  const result = sanitizeHttpUrl(value, maxLen);
  recordFieldSubstitutions(flags, field, result.substitutions);
  return result.url;
}

function attachHomographMeta<T extends StorySubmissionInput>(
  value: T,
  flags: HomographFlags
): T {
  const hadHomograph = homographFlagsDetected(flags);
  return {
    ...value,
    hadHomograph,
    ...(hadHomograph ? { homographFields: flags.fields } : {}),
  };
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

  const flags = emptyHomographFlags();
  mergeIncomingHomographFields(flags, raw.homographFields);

  let contactEmail: string | undefined;
  const contactEmailRaw = sanitizePlainText(raw.contactEmail, LIMITS.contactEmail);
  if (contactEmailRaw) {
    contactEmail = takeSanitizedEmail(contactEmailRaw, flags, "contactEmail");
    if (!contactEmail) {
      return {
        ok: false,
        error: "Enter a valid ASCII email address or leave it blank.",
      };
    }
  }

  let imageUrl: string | undefined;
  const imageUrlRaw = sanitizePlainText(raw.imageUrl, LIMITS.imageUrl);
  if (imageUrlRaw) {
    imageUrl = takeSanitizedHttpUrl(imageUrlRaw, LIMITS.imageUrl, flags, "imageUrl");
    if (!imageUrl) {
      return {
        ok: false,
        error: "Image URL must be a valid http or https link with an ASCII domain name.",
      };
    }
  }

  let linkUrl: string | undefined;
  const linkUrlRaw = sanitizePlainText(raw.linkUrl, LIMITS.linkUrl);
  if (linkUrlRaw) {
    linkUrl = takeSanitizedHttpUrl(linkUrlRaw, LIMITS.linkUrl, flags, "linkUrl");
    if (!linkUrl) {
      return {
        ok: false,
        error: "Website URL must be a valid http or https link with an ASCII domain name.",
      };
    }
  }

  return {
    ok: true,
    value: attachHomographMeta(
      {
        submissionType: "legacy",
        title,
        companyName,
        body,
        address,
        contactEmail,
        imageUrl,
        linkUrl,
      },
      flags
    ),
  };
}
