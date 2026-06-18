import type { CalibrationPoint, GeocodeResult, InfoCard } from "./types";

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
