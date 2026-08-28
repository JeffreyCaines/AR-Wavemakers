import type { AdminLoginSuccess, AdminPublicAccount, AdminSessionUser } from "./adminAuth";
import type { CalibrationPoint, GeocodeResult, InfoCard, RipplesAnchor, StorySubmission, StorySubmissionInput } from "./types";
import { normalizeRipplesAnchor } from "./ripplesAnchor";

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

export async function fetchRipplesAnchor(): Promise<RipplesAnchor> {
  const response = await fetch("/api/ripples-anchor", { headers: authHeaders() });
  return normalizeRipplesAnchor(await parseJson<RipplesAnchor>(response));
}

/** Public read for the AR viewer (no admin token). */
export async function fetchRipplesAnchorConfig(): Promise<RipplesAnchor> {
  const response = await fetch("/api/ripples-anchor");
  return normalizeRipplesAnchor(await parseJson<RipplesAnchor>(response));
}

export async function saveRipplesAnchor(anchor: RipplesAnchor): Promise<RipplesAnchor> {
  const response = await fetch("/api/ripples-anchor", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(anchor),
  });
  return parseJson<RipplesAnchor>(response);
}

export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  return parseJson<GeocodeResult>(response);
}

export type AdminLoginResult =
  | { ok: true } & AdminLoginSuccess
  | { ok: false; status: number; error: string };

function readErrorMessage(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch {
    // Keep fallback.
  }
  return text || fallback;
}

export async function loginAdmin(email: string, password: string): Promise<AdminLoginResult> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: readErrorMessage(text, `Sign-in failed (HTTP ${response.status}).`),
    };
  }
  const data = JSON.parse(text) as AdminLoginSuccess;
  setAdminToken(data.token);
  return { ok: true, ...data };
}

export async function logoutAdmin(): Promise<void> {
  try {
    if (getAdminToken()) {
      await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() });
    }
  } finally {
    clearAdminToken();
  }
}

export async function changeAdminPassword(
  newPassword: string,
  currentPassword?: string
): Promise<AdminLoginResult> {
  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ newPassword, currentPassword }),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: readErrorMessage(text, `Password update failed (HTTP ${response.status}).`),
    };
  }
  const data = JSON.parse(text) as AdminLoginSuccess;
  setAdminToken(data.token);
  return { ok: true, ...data };
}

export async function fetchAdminMe(): Promise<AdminSessionUser> {
  const response = await fetch("/api/auth/me", { headers: authHeaders() });
  return parseJson<AdminSessionUser>(response);
}

export async function fetchAdminAccounts(): Promise<AdminPublicAccount[]> {
  const response = await fetch("/api/admins", { headers: authHeaders() });
  return parseJson<AdminPublicAccount[]>(response);
}

export async function createAdminAccount(email: string, password: string): Promise<AdminPublicAccount> {
  const response = await fetch("/api/admins", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email, password }),
  });
  return parseJson<AdminPublicAccount>(response);
}

export async function deleteAdminAccount(id: string): Promise<void> {
  const response = await fetch(`/api/admins/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(readErrorMessage(text, response.statusText));
  }
}

export async function resetAdminPassword(id: string, password: string): Promise<AdminPublicAccount> {
  const response = await fetch(`/api/admins/${id}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ password }),
  });
  return parseJson<AdminPublicAccount>(response);
}

export async function submitStory(input: StorySubmissionInput): Promise<{ ok: true; id: string }> {
  const response = await fetch("/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson<{ ok: true; id: string }>(response);
}

export async function uploadImage(file: File): Promise<{ ok: true; id: string; url: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type || "image/jpeg", data: dataUrl }),
  });
  return parseJson<{ ok: true; id: string; url: string }>(response);
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
