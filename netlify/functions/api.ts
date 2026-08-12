import type { Config, Context } from "@netlify/functions";
import type { CalibrationPoint, InfoCard, RipplesAnchor, StorySubmission } from "../../src/shared/types";
import { normalizeRipplesAnchor } from "../../src/shared/ripplesAnchor";
import { sanitizeAnyStorySubmissionInput, infoCardPayloadFromSubmission } from "../../src/shared/sanitizeGetNoticed";
import {
  getMaxUploadBytes,
  isAllowedUploadContentType,
  isAuthorized,
  jsonResponse,
  loadCalibration,
  loadCards,
  loadGeocodeCache,
  loadRipplesAnchor,
  loadSubmissions,
  loadUpload,
  newId,
  saveCalibration,
  saveCards,
  saveGeocodeCache,
  saveRipplesAnchor,
  saveSubmissions,
  saveUpload,
  unauthorized,
} from "./_shared/storage";

const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim usage policy: absolute max of 1 request/second.
const MIN_GEOCODE_INTERVAL_MS = 1100;
const MAX_GEOCODE_CACHE_ENTRIES = 500;

// Module-scoped state persists across warm function invocations: cache repeated
// queries (policy requirement) and rate-limit outbound requests.
const geocodeCache = new Map<string, { lat: number; lng: number; displayName: string }>();
let geocodeCacheHydrated = false;
let lastGeocodeAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip trailing slashes and the function prefix so routing sees `/api/...`. */
function normalizePath(rawPath: string): string {
  const path = rawPath.replace(/\/+$/, "");
  return path.replace(/^\/\.netlify\/functions\/api/, "/api");
}

function getCardId(path: string): string | null {
  const match = path.match(/\/cards\/([^/]+)$/);
  if (!match || match[1] === "all") return null;
  return match[1];
}

function getSubmissionId(path: string): string | null {
  const match = path.match(/\/submissions\/([^/]+)/);
  return match?.[1] ?? null;
}

async function handleCards(req: Request, path: string): Promise<Response> {
  const method = req.method;
  const cardId = getCardId(path);
  const isAllRoute = path.endsWith("/cards/all");

  if (method === "GET" && isAllRoute) {
    if (!isAuthorized(req.headers)) return unauthorized();
    return jsonResponse(await loadCards());
  }

  if (method === "GET" && !cardId) {
    const cards = (await loadCards()).filter((card) => card.active);
    return jsonResponse(cards);
  }

  if (!isAuthorized(req.headers)) return unauthorized();

  if (method === "POST" && !cardId) {
    const body = (await readJson(req)) as Omit<InfoCard, "id">;
    const cards = await loadCards();
    const card: InfoCard = { ...body, id: newId() };
    cards.push(card);
    await saveCards(cards);
    return jsonResponse(card, 201);
  }

  if (method === "PUT" && cardId) {
    const body = (await readJson(req)) as Partial<InfoCard>;
    const cards = await loadCards();
    const index = cards.findIndex((c) => c.id === cardId);
    if (index === -1) return jsonResponse({ error: "Not found" }, 404);
    cards[index] = { ...cards[index], ...body, id: cardId };
    await saveCards(cards);
    return jsonResponse(cards[index]);
  }

  if (method === "DELETE" && cardId) {
    const cards = await loadCards();
    const next = cards.filter((c) => c.id !== cardId);
    if (next.length === cards.length) return jsonResponse({ error: "Not found" }, 404);
    await saveCards(next);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

async function handleGeocode(req: Request, url: URL): Promise<Response> {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!isAuthorized(req.headers)) return unauthorized();

  const query = url.searchParams.get("q")?.trim();
  if (!query) return jsonResponse({ error: "Missing query parameter q" }, 400);

  const cacheKey = query.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached) return jsonResponse(cached);

  if (!geocodeCacheHydrated) {
    const persisted = await loadGeocodeCache();
    for (const [key, value] of Object.entries(persisted)) {
      if (!geocodeCache.has(key)) geocodeCache.set(key, value);
    }
    geocodeCacheHydrated = true;
    const hydrated = geocodeCache.get(cacheKey);
    if (hydrated) return jsonResponse(hydrated);
  }

  // Endpoint is configurable so the geocoding service can be switched at the
  // provider's request without a code change/redeploy (Nominatim policy).
  const endpoint = process.env.GEOCODER_URL || DEFAULT_GEOCODER_URL;
  const email = process.env.NOMINATIM_EMAIL;

  const params = new URLSearchParams({ q: query, format: "json", limit: "1" });
  if (email) params.set("email", email);

  // Identify the application (never a stock library UA) and a contact if provided.
  const userAgent = email ? `NL-World-Map-AR/1.0 (+${email})` : "NL-World-Map-AR/1.0";

  // Honor the 1 request/second cap within a warm function instance.
  const sinceLast = Date.now() - lastGeocodeAt;
  if (sinceLast < MIN_GEOCODE_INTERVAL_MS) {
    await sleep(MIN_GEOCODE_INTERVAL_MS - sinceLast);
  }
  lastGeocodeAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
    });
  } catch {
    return jsonResponse({ error: "Geocoding request failed" }, 502);
  }

  if (!response.ok) return jsonResponse({ error: "Geocoding failed" }, 502);

  const results = (await response.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;

  if (results.length === 0) return jsonResponse({ error: "Address not found" }, 404);

  const hit = results[0];
  const result = {
    lat: parseFloat(hit.lat),
    lng: parseFloat(hit.lon),
    displayName: hit.display_name,
  };

  // Cache results so repeated identical queries are not re-sent (policy requirement).
  // Persist across cold starts via Blobs / local file.
  while (geocodeCache.size >= MAX_GEOCODE_CACHE_ENTRIES) {
    const oldest = geocodeCache.keys().next().value;
    if (oldest === undefined) break;
    geocodeCache.delete(oldest);
  }
  geocodeCache.set(cacheKey, result);
  await saveGeocodeCache(Object.fromEntries(geocodeCache));

  return jsonResponse(result);
}

async function handleCalibration(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers)) return unauthorized();

  if (req.method === "GET") {
    return jsonResponse(await loadCalibration());
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    if (!Array.isArray(body)) {
      return jsonResponse({ error: "Expected an array of calibration points" }, 400);
    }
    const points = sanitizeCalibration(body);
    await saveCalibration(points);
    return jsonResponse(points);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

function sanitizeCalibration(input: unknown[]): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const mapX = Number(p.mapX);
    const mapY = Number(p.mapY);
    if (![lat, lng, mapX, mapY].every(Number.isFinite)) continue;
    points.push({
      id: typeof p.id === "string" && p.id ? p.id : newId(),
      label: typeof p.label === "string" ? p.label : "",
      lat,
      lng,
      mapX,
      mapY,
    });
  }
  return points;
}

function isFiniteRipplesPlacement(placement: RipplesAnchor["loop"]): boolean {
  return [placement.mapX, placement.mapY, placement.originX, placement.originY, placement.widthRatio].every(
    Number.isFinite
  );
}

async function handleRipplesAnchor(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return jsonResponse(await loadRipplesAnchor());
  }

  if (!isAuthorized(req.headers)) return unauthorized();

  if (req.method === "PUT") {
    const body = await readJson(req);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Expected a ripples anchor object" }, 400);
    }
    const anchor = normalizeRipplesAnchor(body);
    if (
      (anchor.activeVariant !== "loop" && anchor.activeVariant !== "fade") ||
      !isFiniteRipplesPlacement(anchor.loop) ||
      !isFiniteRipplesPlacement(anchor.fade)
    ) {
      return jsonResponse({ error: "Invalid ripples anchor" }, 400);
    }
    await saveRipplesAnchor(anchor);
    return jsonResponse(anchor);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

async function handleSubmissions(req: Request, path: string): Promise<Response> {
  const method = req.method;
  const submissionId = getSubmissionId(path);
  const isApproveRoute = Boolean(submissionId && path.endsWith(`/submissions/${submissionId}/approve`));

  if (isApproveRoute) {
    if (method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    if (!isAuthorized(req.headers)) return unauthorized();

    const submissions = await loadSubmissions();
    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) return jsonResponse({ error: "Not found" }, 404);

    const cards = await loadCards();
    const card: InfoCard = {
      id: newId(),
      ...infoCardPayloadFromSubmission(submission),
      lat: 0,
      lng: 0,
      mapX: 0.5,
      mapY: 0.5,
      active: false,
    };
    cards.push(card);
    await saveCards(cards);
    await saveSubmissions(submissions.filter((s) => s.id !== submissionId));

    return jsonResponse(card, 201);
  }

  if (submissionId) {
    if (method !== "DELETE") return jsonResponse({ error: "Method not allowed" }, 405);
    if (!isAuthorized(req.headers)) return unauthorized();

    const submissions = await loadSubmissions();
    const next = submissions.filter((s) => s.id !== submissionId);
    if (next.length === submissions.length) return jsonResponse({ error: "Not found" }, 404);
    await saveSubmissions(next);
    return jsonResponse({ ok: true });
  }

  if (path.endsWith("/submissions")) {
    if (method === "GET") {
      if (!isAuthorized(req.headers)) return unauthorized();
      return jsonResponse(await loadSubmissions());
    }

    if (method === "POST") {
      const body = await readJson(req);
      const result = sanitizeAnyStorySubmissionInput(body);
      if (!result.ok) {
        return jsonResponse({ error: result.error }, 400);
      }

      const submission: StorySubmission = {
        id: newId(),
        ...result.value,
        submittedAt: new Date().toISOString(),
      } as StorySubmission;

      const submissions = await loadSubmissions();
      submissions.unshift(submission);
      await saveSubmissions(submissions);
      return jsonResponse({ ok: true, id: submission.id }, 201);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

function getUploadId(path: string): string | null {
  const match = path.match(/\/uploads\/([^/]+)$/);
  return match?.[1] ?? null;
}

async function handleUploads(req: Request, path: string): Promise<Response> {
  const uploadId = getUploadId(path);

  if (uploadId) {
    if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
    const file = await loadUpload(uploadId);
    if (!file) return jsonResponse({ error: "Not found" }, 404);
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (!path.endsWith("/uploads")) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Invalid upload payload." }, 400);
  }

  const raw = body as Record<string, unknown>;
  const contentType = typeof raw.contentType === "string" ? raw.contentType : "";
  const data = typeof raw.data === "string" ? raw.data : "";
  if (!isAllowedUploadContentType(contentType)) {
    return jsonResponse({ error: "Only JPEG, PNG, WebP, or GIF images are allowed." }, 400);
  }
  if (!data) return jsonResponse({ error: "Missing image data." }, 400);

  let bytes: Uint8Array;
  try {
    const binary = atob(data.includes(",") ? data.split(",")[1]! : data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return jsonResponse({ error: "Invalid base64 image data." }, 400);
  }

  if (bytes.byteLength === 0) return jsonResponse({ error: "Empty image." }, 400);
  if (bytes.byteLength > getMaxUploadBytes()) {
    return jsonResponse({ error: "Image must be 4MB or smaller." }, 400);
  }

  const saved = await saveUpload(bytes, contentType);
  return jsonResponse({ ok: true, id: saved.id, url: saved.url }, 201);
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const path = normalizePath(url.pathname);

  if (path.endsWith("/geocode")) {
    return handleGeocode(req, url);
  }

  if (path.endsWith("/calibration")) {
    return handleCalibration(req);
  }

  if (path.endsWith("/ripples-anchor")) {
    return handleRipplesAnchor(req);
  }

  if (path.includes("/uploads")) {
    return handleUploads(req, path);
  }

  if (path.includes("/submissions")) {
    return handleSubmissions(req, path);
  }

  if (path.includes("/cards")) {
    return handleCards(req, path);
  }

  return jsonResponse({ error: "Not found" }, 404);
};

export const config: Config = {
  path: "/api/*",
};
