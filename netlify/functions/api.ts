import type { Config, Context } from "@netlify/functions";
import type { CalibrationPoint, InfoCard, StorySubmission } from "../../src/shared/types";
import { sanitizeStorySubmissionInput } from "../../src/shared/sanitizeStorySubmission";
import {
  isAuthorized,
  jsonResponse,
  loadCalibration,
  loadCards,
  loadSubmissions,
  newId,
  saveCalibration,
  saveCards,
  saveSubmissions,
  unauthorized,
} from "./_shared/storage";

const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim usage policy: absolute max of 1 request/second.
const MIN_GEOCODE_INTERVAL_MS = 1100;

// Module-scoped state persists across warm function invocations: cache repeated
// queries (policy requirement) and rate-limit outbound requests.
const geocodeCache = new Map<string, { lat: number; lng: number; displayName: string }>();
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
  if (geocodeCache.size > 500) geocodeCache.clear();
  geocodeCache.set(cacheKey, result);

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
      title: submission.title,
      body: submission.body,
      companyName: submission.companyName || undefined,
      address: submission.address,
      lat: 0,
      lng: 0,
      mapX: 0.5,
      mapY: 0.5,
      imageUrl: submission.imageUrl || undefined,
      linkUrl: submission.linkUrl || undefined,
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
      const result = sanitizeStorySubmissionInput(body);
      if (!result.ok) {
        return jsonResponse({ error: result.error }, 400);
      }

      const submission: StorySubmission = {
        id: newId(),
        ...result.value,
        submittedAt: new Date().toISOString(),
      };

      const submissions = await loadSubmissions();
      submissions.unshift(submission);
      await saveSubmissions(submissions);
      return jsonResponse({ ok: true, id: submission.id }, 201);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
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
