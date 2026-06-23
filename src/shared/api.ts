import type { CalibrationPoint, GeocodeResult, InfoCard, StorySubmission, StorySubmissionInput } from "./types";

const TOKEN_KEY = "ar_admin_token";

export function getAdminToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): HeadersInit {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (typeof parsed.error === "string" && parsed.error) {
        throw new Error(parsed.error);
      }
    } catch (error) {
      if (error instanceof Error && error.message !== text) throw error;
    }
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

export async function fetchActiveCards(): Promise<InfoCard[]> {
  const response = await fetch("/api/cards");
  return parseJson<InfoCard[]>(response);
}

export async function fetchAllCards(): Promise<InfoCard[]> {
  const response = await fetch("/api/cards/all", { headers: authHeaders() });
  return parseJson<InfoCard[]>(response);
}

export async function createCard(card: Omit<InfoCard, "id">): Promise<InfoCard> {
  const response = await fetch("/api/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(card),
  });
  return parseJson<InfoCard>(response);
}

export async function updateCard(id: string, card: Partial<InfoCard>): Promise<InfoCard> {
  const response = await fetch(`/api/cards/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(card),
  });
  return parseJson<InfoCard>(response);
}

export async function deleteCard(id: string): Promise<void> {
  const response = await fetch(`/api/cards/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
}

export async function fetchCalibration(): Promise<CalibrationPoint[]> {
  const response = await fetch("/api/calibration", { headers: authHeaders() });
  return parseJson<CalibrationPoint[]>(response);
}

export async function saveCalibration(points: CalibrationPoint[]): Promise<CalibrationPoint[]> {
  const response = await fetch("/api/calibration", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(points),
  });
  return parseJson<CalibrationPoint[]>(response);
}

export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  return parseJson<GeocodeResult>(response);
}

export async function verifyAdminPassword(password: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch("/api/cards/all", {
    headers: { Authorization: `Bearer ${password}` },
  });
  return { ok: response.ok, status: response.status };
}

export async function submitStory(input: StorySubmissionInput): Promise<{ ok: true; id: string }> {
  const response = await fetch("/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson<{ ok: true; id: string }>(response);
}

export async function fetchSubmissions(): Promise<StorySubmission[]> {
  const response = await fetch("/api/submissions", { headers: authHeaders() });
  return parseJson<StorySubmission[]>(response);
}

export async function approveSubmission(id: string): Promise<InfoCard> {
  const response = await fetch(`/api/submissions/${id}/approve`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson<InfoCard>(response);
}

export async function rejectSubmission(id: string): Promise<void> {
  const response = await fetch(`/api/submissions/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
}
