import type { CalibrationPoint, InfoCard, StorySubmission } from "../../../src/shared/types";
import { SEED_CARDS } from "../../../src/shared/types";

const STORE_NAME = "ar-map-cards";
const BLOB_KEY = "cards.json";
const CALIBRATION_KEY = "calibration.json";
const SUBMISSIONS_KEY = "submissions.json";

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
