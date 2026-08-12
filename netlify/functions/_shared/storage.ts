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

export async function loadCards(): Promise<InfoCard[]> {
  if (useLocalStorage()) {
    return loadLocalCards();
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    const data = await store.get(BLOB_KEY, { type: "json" });
    if (Array.isArray(data)) {
      return data as InfoCard[];
    }
    // First run on Netlify: persist the seed set so admin edits have a base.
    await store.setJSON(BLOB_KEY, SEED_CARDS);
    return [...SEED_CARDS];
  } catch {
    // Blobs unavailable (e.g. plain `vite dev`); fall back to a local file.
  }

  return loadLocalCards();
}

export async function saveCards(cards: InfoCard[]): Promise<void> {
  if (useLocalStorage()) {
    await saveLocalCards(cards);
    return;
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    await store.setJSON(BLOB_KEY, cards);
    return;
  } catch {
    // Fall through to local file storage during dev.
  }

  await saveLocalCards(cards);
}

async function loadLocalCards(): Promise<InfoCard[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.join(process.cwd(), "data", "cards.json");

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as InfoCard[];
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Seed on first run.
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(SEED_CARDS, null, 2), "utf-8");
  return [...SEED_CARDS];
}

async function saveLocalCards(cards: InfoCard[]): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.join(process.cwd(), "data", "cards.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(cards, null, 2), "utf-8");
}

export async function loadCalibration(): Promise<CalibrationPoint[]> {
  if (useLocalStorage()) {
    return loadLocalJson<CalibrationPoint[]>("calibration.json", []);
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    const data = await store.get(CALIBRATION_KEY, { type: "json" });
    if (Array.isArray(data)) return data as CalibrationPoint[];
    return [];
  } catch {
    // Blobs unavailable (e.g. plain `vite dev`); fall back to a local file.
  }
  return loadLocalJson<CalibrationPoint[]>("calibration.json", []);
}

export async function saveCalibration(points: CalibrationPoint[]): Promise<void> {
  if (useLocalStorage()) {
    await saveLocalJson("calibration.json", points);
    return;
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    await store.setJSON(CALIBRATION_KEY, points);
    return;
  } catch {
    // Fall through to local file storage during dev.
  }
  await saveLocalJson("calibration.json", points);
}

export async function loadRipplesAnchor(): Promise<RipplesAnchor> {
  if (useLocalStorage()) {
    return normalizeRipplesAnchor(await loadLocalJson("ripples-anchor.json", DEFAULT_RIPPLES_ANCHOR));
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    const data = await store.get(RIPPLES_ANCHOR_KEY, { type: "json" });
    return normalizeRipplesAnchor(data);
  } catch {
    // Blobs unavailable (e.g. plain `vite dev`); fall back to a local file.
  }
  return normalizeRipplesAnchor(await loadLocalJson("ripples-anchor.json", DEFAULT_RIPPLES_ANCHOR));
}

export async function saveRipplesAnchor(anchor: RipplesAnchor): Promise<void> {
  const sanitized = normalizeRipplesAnchor(anchor);
  if (useLocalStorage()) {
    await saveLocalJson("ripples-anchor.json", sanitized);
    return;
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    await store.setJSON(RIPPLES_ANCHOR_KEY, sanitized);
    return;
  } catch {
    // Fall through to local file storage during dev.
  }
  await saveLocalJson("ripples-anchor.json", sanitized);
}

async function loadLocalJson<T>(fileName: string, fallback: T): Promise<T> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.join(process.cwd(), "data", fileName);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function saveLocalJson(fileName: string, value: unknown): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.join(process.cwd(), "data", fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export async function loadSubmissions(): Promise<StorySubmission[]> {
  if (useLocalStorage()) {
    return loadLocalJson<StorySubmission[]>("submissions.json", []);
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    const data = await store.get(SUBMISSIONS_KEY, { type: "json" });
    if (Array.isArray(data)) return data as StorySubmission[];
    return [];
  } catch {
    // Blobs unavailable (e.g. plain `vite dev`); fall back to a local file.
  }
  return loadLocalJson<StorySubmission[]>("submissions.json", []);
}

export async function saveSubmissions(submissions: StorySubmission[]): Promise<void> {
  if (useLocalStorage()) {
    await saveLocalJson("submissions.json", submissions);
    return;
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    await store.setJSON(SUBMISSIONS_KEY, submissions);
    return;
  } catch {
    // Fall through to local file storage during dev.
  }
  await saveLocalJson("submissions.json", submissions);
}

function isGeocodeCache(value: unknown): value is Record<string, GeocodeResult> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return true;
}

export async function loadGeocodeCache(): Promise<Record<string, GeocodeResult>> {
  if (useLocalStorage()) {
    const data = await loadLocalJson<unknown>("geocode-cache.json", {});
    return isGeocodeCache(data) ? data : {};
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    const data = await store.get(GEOCODE_CACHE_KEY, { type: "json" });
    if (isGeocodeCache(data)) return data;
    return {};
  } catch {
    // Blobs unavailable (e.g. plain `vite dev`); fall back to a local file.
  }
  const data = await loadLocalJson<unknown>("geocode-cache.json", {});
  return isGeocodeCache(data) ? data : {};
}

export async function saveGeocodeCache(cache: Record<string, GeocodeResult>): Promise<void> {
  if (useLocalStorage()) {
    await saveLocalJson("geocode-cache.json", cache);
    return;
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore(STORE_NAME);
    await store.setJSON(GEOCODE_CACHE_KEY, cache);
    return;
  } catch {
    // Fall through to local file storage during dev.
  }
  await saveLocalJson("geocode-cache.json", cache);
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

export function isAuthorized(headers: Headers): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // No password configured: only permit writes during local netlify dev.
    return process.env.NETLIFY_DEV === "true";
  }
  const authHeader = headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  return timingSafeEqual(authHeader.slice(7), password);
}

/** Constant-time string comparison to avoid leaking the password via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function unauthorized(): Response {
  return jsonResponse({ error: "Unauthorized" }, 401);
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function newId(): string {
  return crypto.randomUUID();
}
