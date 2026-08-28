import type { CalibrationPoint, GeocodeResult, InfoCard, StorySubmission } from "../../../src/shared/types";
import { DEFAULT_RIPPLES_ANCHOR, SEED_CARDS, type RipplesAnchor } from "../../../src/shared/types";
import { normalizeRipplesAnchor } from "../../../src/shared/ripplesAnchor";

const STORE_NAME = "ar-map-cards";
const BLOB_KEY = "cards.json";
const CALIBRATION_KEY = "calibration.json";
const RIPPLES_ANCHOR_KEY = "ripples-anchor.json";
const SUBMISSIONS_KEY = "submissions.json";
const GEOCODE_CACHE_KEY = "geocode-cache.json";

/** Netlify Dev runs a separate Blobs sandbox — use data/*.json so prod exports work locally. */
function useLocalStorage(): boolean {
  return process.env.NETLIFY_DEV === "true";
}

/**
 * Thrown when the backing store could not be read or written. Callers must never
 * treat this as "no data": doing so is what allows an outage to silently wipe the
 * admin accounts or overwrite live cards with the seed set.
 */
export class StoreUnavailableError extends Error {
  constructor(key: string) {
    super(`Storage unavailable for ${key}`);
    this.name = "StoreUnavailableError";
  }
}

/** `value: null` means the key is genuinely absent, distinct from a failed read. */
export type LoadResult<T> = { ok: true; value: T | null } | { ok: false };

async function loadLocalJsonResult<T>(fileName: string): Promise<LoadResult<T>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.join(process.cwd(), "data", fileName);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: null };
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    // Corrupt file: fail closed rather than reporting an empty store.
    return { ok: false };
  }
}

async function saveLocalJson(fileName: string, value: unknown): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.join(process.cwd(), "data", fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export async function loadStoredJsonResult<T>(key: string): Promise<LoadResult<T>> {
  if (useLocalStorage()) {
    return loadLocalJsonResult<T>(key);
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    const data = await store.get(key, { type: "json" });
    return { ok: true, value: data === undefined ? null : (data as T | null) };
  } catch {
    // Blobs unavailable (e.g. plain `vite dev`); a local file may still hold the data.
  }

  const local = await loadLocalJsonResult<T>(key);
  // No local copy either: this is a read failure, not an empty store.
  if (local.ok && local.value === null) return { ok: false };
  return local;
}

export async function loadStoredJson<T>(key: string, fallback: T): Promise<T> {
  const result = await loadStoredJsonResult<T>(key);
  if (!result.ok) throw new StoreUnavailableError(key);
  return result.value ?? fallback;
}

export async function saveStoredJson(key: string, value: unknown): Promise<void> {
  if (useLocalStorage()) {
    await saveLocalJson(key, value);
    return;
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    await store.setJSON(key, value);
    return;
  } catch {
    // Fall through to local file storage during dev.
  }

  try {
    await saveLocalJson(key, value);
  } catch {
    // Netlify's function filesystem is read-only, so this only succeeds in dev.
    throw new StoreUnavailableError(key);
  }
}

/**
 * Reads a key that must hold an array. Anything else stored under it is treated
 * as a failure so the caller cannot overwrite unrecognised data with an empty
 * list or the seed set.
 */
async function loadStoredArray<T>(key: string): Promise<T[] | null> {
  const result = await loadStoredJsonResult<unknown>(key);
  if (!result.ok) throw new StoreUnavailableError(key);
  if (result.value === null) return null;
  if (!Array.isArray(result.value)) throw new StoreUnavailableError(key);
  return result.value as T[];
}

export async function loadCards(): Promise<InfoCard[]> {
  const cards = await loadStoredArray<InfoCard>(BLOB_KEY);
  if (cards) return cards;
  // First run: persist the seed set so admin edits have a base.
  await saveStoredJson(BLOB_KEY, SEED_CARDS);
  return [...SEED_CARDS];
}

export async function saveCards(cards: InfoCard[]): Promise<void> {
  await saveStoredJson(BLOB_KEY, cards);
}

export async function loadCalibration(): Promise<CalibrationPoint[]> {
  return (await loadStoredArray<CalibrationPoint>(CALIBRATION_KEY)) ?? [];
}

export async function saveCalibration(points: CalibrationPoint[]): Promise<void> {
  await saveStoredJson(CALIBRATION_KEY, points);
}

export async function loadRipplesAnchor(): Promise<RipplesAnchor> {
  const data = await loadStoredJson<unknown>(RIPPLES_ANCHOR_KEY, DEFAULT_RIPPLES_ANCHOR);
  return normalizeRipplesAnchor(data);
}

export async function saveRipplesAnchor(anchor: RipplesAnchor): Promise<void> {
  await saveStoredJson(RIPPLES_ANCHOR_KEY, normalizeRipplesAnchor(anchor));
}

export async function loadSubmissions(): Promise<StorySubmission[]> {
  return (await loadStoredArray<StorySubmission>(SUBMISSIONS_KEY)) ?? [];
}

export async function saveSubmissions(submissions: StorySubmission[]): Promise<void> {
  await saveStoredJson(SUBMISSIONS_KEY, submissions);
}

function isGeocodeCache(value: unknown): value is Record<string, GeocodeResult> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return true;
}

export async function loadGeocodeCache(): Promise<Record<string, GeocodeResult>> {
  const data = await loadStoredJson<unknown>(GEOCODE_CACHE_KEY, {});
  return isGeocodeCache(data) ? data : {};
}

export async function saveGeocodeCache(cache: Record<string, GeocodeResult>): Promise<void> {
  await saveStoredJson(GEOCODE_CACHE_KEY, cache);
}

export type UploadMeta = {
  id: string;
  contentType: string;
  createdAt: string;
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function getMaxUploadBytes(): number {
  return MAX_UPLOAD_BYTES;
}

export function isAllowedUploadContentType(contentType: string): boolean {
  return ALLOWED_UPLOAD_TYPES.has(contentType);
}

/**
 * Identify an image from its leading bytes. The client-declared content type is
 * never trusted: whatever this returns is what gets stored and served back.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (isRiff && isWebp) return "image/webp";
  return null;
}

async function saveLocalUpload(id: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "data", "uploads");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.bin`), bytes);
  const meta: UploadMeta = { id, contentType, createdAt: new Date().toISOString() };
  await fs.writeFile(path.join(dir, `${id}.meta.json`), JSON.stringify(meta), "utf-8");
}

async function loadLocalUpload(
  id: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "data", "uploads");
  try {
    const bytes = new Uint8Array(await fs.readFile(path.join(dir, `${id}.bin`)));
    const metaRaw = await fs.readFile(path.join(dir, `${id}.meta.json`), "utf-8");
    const meta = JSON.parse(metaRaw) as UploadMeta;
    return { bytes, contentType: meta.contentType || "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function saveUpload(
  bytes: Uint8Array,
  contentType: string
): Promise<{ id: string; url: string }> {
  const id = newId();
  const meta: UploadMeta = { id, contentType, createdAt: new Date().toISOString() };

  if (useLocalStorage()) {
    await saveLocalUpload(id, bytes, contentType);
    return { id, url: `/api/uploads/${id}` };
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    await store.set(`uploads/${id}`, bytes);
    await store.setJSON(`uploads/${id}.meta`, meta);
    return { id, url: `/api/uploads/${id}` };
  } catch {
    // Fall through to local file storage during dev.
  }

  await saveLocalUpload(id, bytes, contentType);
  return { id, url: `/api/uploads/${id}` };
}

export async function loadUpload(
  id: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;

  if (useLocalStorage()) {
    return loadLocalUpload(id);
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    const data = await store.get(`uploads/${id}`, { type: "arrayBuffer" });
    if (!data) return null;
    const meta = (await store.get(`uploads/${id}.meta`, { type: "json" })) as UploadMeta | null;
    const contentType = meta?.contentType || "application/octet-stream";
    return { bytes: new Uint8Array(data), contentType };
  } catch {
    // Blobs unavailable; fall back to local file.
  }

  return loadLocalUpload(id);
}

export function unauthorized(): Response {
  return jsonResponse({ error: "Unauthorized" }, 401);
}

export function forbidden(message = "Forbidden"): Response {
  return jsonResponse({ error: message }, 403);
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // API payloads include session tokens and admin-only data; never let a
      // browser or intermediary cache them.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function newId(): string {
  return crypto.randomUUID();
}
