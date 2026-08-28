/** Homoglyph character and the Latin letter it is impersonating. */
export interface HomoglyphSubstitution {
  correct: string;
  homoglyph: string;
}

export type HomographFieldMap = Record<string, HomoglyphSubstitution[]>;

export type HomographFlags = {
  fields: HomographFieldMap;
};

const HOMOGRAPH_FIELD_KEYS = new Set([
  "contactEmail",
  "imageUrl",
  "linkUrl",
  "email",
  "linkedin",
  "logoUrl",
  "submitterEmail",
  "websiteUrl",
  "linkedinUrl",
  "orgContactEmail",
  "mediaOneUrl",
  "mediaTwoUrl",
  "youtubeLink",
]);

function buildHomoglyphMap(): Map<string, string> {
  const map = new Map<string, string>();
  const add = (homoglyph: string, latin: string): void => {
    map.set(homoglyph, latin);
  };

  add("а", "a");
  add("А", "A");
  add("е", "e");
  add("Е", "E");
  add("о", "o");
  add("О", "O");
  add("р", "p");
  add("Р", "P");
  add("с", "c");
  add("С", "C");
  add("у", "y");
  add("У", "Y");
  add("х", "x");
  add("Х", "X");
  add("і", "i");
  add("І", "I");
  add("ї", "i");
  add("Ї", "I");
  add("ј", "j");
  add("Ј", "J");
  add("һ", "h");
  add("Һ", "H");
  add("ѕ", "s");
  add("Ѕ", "S");
  add("ԁ", "d");
  add("Ԁ", "D");
  add("ԛ", "q");
  add("Ԛ", "Q");
  add("ԝ", "w");
  add("Ԝ", "W");
  add("ѵ", "v");
  add("Ѵ", "V");
  add("к", "k");
  add("К", "K");
  add("м", "m");
  add("М", "M");
  add("н", "h");
  add("Н", "H");
  add("т", "t");
  add("Т", "T");
  add("в", "b");
  add("В", "B");
  add("ё", "e");
  add("Ё", "E");
  add("ӏ", "l");
  add("Ӏ", "I");
  add("ү", "y");
  add("Ү", "Y");
  add("ө", "o");
  add("Ө", "O");
  add("ә", "a");
  add("Ә", "A");
  add("ҫ", "c");
  add("Ҫ", "C");

  add("α", "a");
  add("Α", "A");
  add("ο", "o");
  add("Ο", "O");
  add("ε", "e");
  add("Ε", "E");
  add("ι", "i");
  add("Ι", "I");
  add("ν", "v");
  add("Ν", "N");
  add("ρ", "p");
  add("Ρ", "P");
  add("τ", "t");
  add("Τ", "T");
  add("χ", "x");
  add("Χ", "X");
  add("η", "n");
  add("Η", "H");
  add("κ", "k");
  add("Κ", "K");
  add("υ", "u");
  add("Υ", "Y");
  add("ϲ", "c");
  add("Ϲ", "C");
  add("β", "b");
  add("Β", "B");

  add("օ", "o");
  add("Օ", "O");
  add("ս", "u");
  add("հ", "h");
  add("Տ", "S");
  add("Լ", "L");
  add("Հ", "H");
  add("Ս", "S");

  add("ɑ", "a");
  add("ɡ", "g");
  add("ℓ", "l");

  for (let i = 0; i < 26; i += 1) {
    add(String.fromCharCode(0xff41 + i), String.fromCharCode(97 + i));
    add(String.fromCharCode(0xff21 + i), String.fromCharCode(65 + i));
  }

  return map;
}

export const HOMOGLYPH_TO_LATIN = buildHomoglyphMap();

export function emptyHomographFlags(): HomographFlags {
  return { fields: {} };
}

export function homographFlagsDetected(flags: HomographFlags): boolean {
  return Object.keys(flags.fields).length > 0;
}

export function replaceHomoglyphs(text: string): {
  text: string;
  substitutions: HomoglyphSubstitution[];
} {
  let out = "";
  const substitutions: HomoglyphSubstitution[] = [];
  const seen = new Set<string>();
  for (const char of text) {
    const latin = HOMOGLYPH_TO_LATIN.get(char);
    if (latin === undefined) {
      out += char;
      continue;
    }
    out += latin;
    const key = `${latin}\0${char}`;
    if (seen.has(key)) continue;
    seen.add(key);
    substitutions.push({ correct: latin, homoglyph: char });
  }
  return { text: out, substitutions };
}

export function mergeSubstitutions(
  existing: HomoglyphSubstitution[] | undefined,
  extra: HomoglyphSubstitution[]
): HomoglyphSubstitution[] {
  if (!extra.length) return existing ? [...existing] : [];
  const out = existing ? [...existing] : [];
  const seen = new Set(out.map((item) => `${item.correct}\0${item.homoglyph}`));
  for (const item of extra) {
    const key = `${item.correct}\0${item.homoglyph}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function recordFieldSubstitutions(
  flags: HomographFlags,
  field: string,
  substitutions: HomoglyphSubstitution[]
): void {
  if (!substitutions.length) return;
  flags.fields[field] = mergeSubstitutions(flags.fields[field], substitutions);
}

export function aliasFieldSubstitutions(flags: HomographFlags, from: string, to: string): void {
  const list = flags.fields[from];
  if (!list?.length) return;
  flags.fields[to] = mergeSubstitutions(flags.fields[to], list);
}

function isValidSubstitution(value: unknown): value is HomoglyphSubstitution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const correct = (value as HomoglyphSubstitution).correct;
  const homoglyph = (value as HomoglyphSubstitution).homoglyph;
  if (typeof correct !== "string" || typeof homoglyph !== "string") return false;
  if ([...correct].length !== 1 || [...homoglyph].length !== 1) return false;
  return HOMOGLYPH_TO_LATIN.get(homoglyph) === correct;
}

/** Keep only known field keys and mapped glyph pairs from a client payload. */
export function mergeIncomingHomographFields(flags: HomographFlags, raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  for (const [field, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!HOMOGRAPH_FIELD_KEYS.has(field) || !Array.isArray(list)) continue;
    const valid = list.filter(isValidSubstitution);
    recordFieldSubstitutions(flags, field, valid);
  }
}

const PUNY_BASE = 36;
const PUNY_TMIN = 1;
const PUNY_TMAX = 26;
const PUNY_SKEW = 38;
const PUNY_DAMP = 700;
const PUNY_INITIAL_BIAS = 72;
const PUNY_INITIAL_N = 128;

function punycodeDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return -1;
}

function punycodeAdapt(delta: number, numPoints: number, firstTime: boolean): number {
  let next = firstTime ? Math.floor(delta / PUNY_DAMP) : Math.floor(delta / 2);
  next += Math.floor(next / numPoints);
  let k = 0;
  while (next > Math.floor(((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) / 2)) {
    next = Math.floor(next / (PUNY_BASE - PUNY_TMIN));
    k += PUNY_BASE;
  }
  return k + Math.floor(((PUNY_BASE - PUNY_TMIN + 1) * next) / (next + PUNY_SKEW));
}

function decodePunycodeLabel(label: string): string | undefined {
  const lower = label.toLowerCase();
  if (!lower.startsWith("xn--")) return label;
  const input = lower.slice(4);
  if (!input) return undefined;

  const output: string[] = [];
  let n = PUNY_INITIAL_N;
  let i = 0;
  let bias = PUNY_INITIAL_BIAS;
  const lastDash = input.lastIndexOf("-");
  let index = 0;
  if (lastDash >= 0) {
    for (let j = 0; j < lastDash; j += 1) {
      const code = input.charCodeAt(j);
      if (code > 0x7f) return undefined;
      output.push(input.charAt(j));
    }
    index = lastDash + 1;
  }

  while (index < input.length) {
    const oldI = i;
    let w = 1;
    for (let k = PUNY_BASE; ; k += PUNY_BASE) {
      if (index >= input.length) return undefined;
      const digit = punycodeDigit(input.charCodeAt(index));
      index += 1;
      if (digit < 0) return undefined;
      i += digit * w;
      if (!Number.isSafeInteger(i)) return undefined;
      const t = k <= bias ? PUNY_TMIN : k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias;
      if (digit < t) break;
      w *= PUNY_BASE - t;
    }
    const outLen = output.length + 1;
    bias = punycodeAdapt(i - oldI, outLen, oldI === 0);
    n += Math.floor(i / outLen);
    i %= outLen;
    if (n > 0x10ffff) return undefined;
    output.splice(i, 0, String.fromCodePoint(n));
    i += 1;
  }

  return output.join("");
}

export function decodePunycodeHostname(hostname: string): string {
  return hostname
    .split(".")
    .map((label) => decodePunycodeLabel(label) ?? label)
    .join(".");
}
