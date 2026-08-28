import type { AdminPublicAccount, AdminRole } from "../../../src/shared/adminAuth";
import { isValidAdminEmail, normalizeAdminEmail, validatePassword } from "../../../src/shared/passwordPolicy";
import { createSessionToken, hashPassword, hashToken, verifyPassword } from "./passwordHash";
import { isRateLimited, recordHit } from "./rateLimit";
import {
  forbidden,
  jsonResponse,
  loadStoredJsonResult,
  newId,
  saveStoredJson,
  StoreUnavailableError,
  unauthorized,
} from "./storage";

const ADMINS_KEY = "admins.json";
const SESSIONS_KEY = "sessions.json";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const DUMMY_HASH = "00".repeat(64);
const DUMMY_SALT = "00".repeat(16);

export interface AdminAccount {
  id: string;
  email: string;
  role: AdminRole;
  passwordHash: string;
  passwordSalt: string;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface AdminSessionRecord {
  tokenHash: string;
  userId: string;
  role: AdminRole;
  mustChangePassword: boolean;
  expiresAt: number;
  createdAt: string;
}

export type AdminAuthResult =
  | { ok: true; account: AdminAccount; session: AdminSessionRecord }
  | { ok: false; response: Response };

function toPublicAccount(account: AdminAccount): AdminPublicAccount {
  return {
    id: account.id,
    email: account.email,
    role: account.role,
    mustChangePassword: account.mustChangePassword,
  };
}

function isAdminAccount(value: unknown): value is AdminAccount {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.email === "string" &&
    (row.role === "project_admin" || row.role === "wavemaker_admin") &&
    typeof row.passwordHash === "string" &&
    typeof row.passwordSalt === "string" &&
    typeof row.mustChangePassword === "boolean" &&
    typeof row.createdAt === "string"
  );
}

function isSessionRecord(value: unknown): value is AdminSessionRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.tokenHash === "string" &&
    typeof row.userId === "string" &&
    (row.role === "project_admin" || row.role === "wavemaker_admin") &&
    typeof row.mustChangePassword === "boolean" &&
    typeof row.expiresAt === "number" &&
    typeof row.createdAt === "string"
  );
}

async function persistAdmins(accounts: AdminAccount[]): Promise<void> {
  await saveStoredJson(ADMINS_KEY, accounts);
}

async function persistSessions(sessions: AdminSessionRecord[]): Promise<void> {
  await saveStoredJson(SESSIONS_KEY, sessions);
}

/**
 * Returns an empty list only when the store was read successfully and genuinely
 * holds no accounts. Every other outcome throws, because the caller reacts to an
 * empty list by seeding, which overwrites the whole account list.
 */
async function loadRawAdmins(): Promise<AdminAccount[]> {
  const result = await loadStoredJsonResult<unknown>(ADMINS_KEY);
  if (!result.ok) throw new StoreUnavailableError(ADMINS_KEY);
  if (result.value === null) return [];
  if (!Array.isArray(result.value)) throw new StoreUnavailableError(ADMINS_KEY);
  const accounts = result.value.filter(isAdminAccount);
  if (accounts.length === 0 && result.value.length > 0) {
    throw new StoreUnavailableError(ADMINS_KEY);
  }
  return accounts;
}

function readEnvValue(name: string): string {
  const raw = process.env[name] ?? "";
  return raw.replace(/\r/g, "").trim().replace(/^['"]|['"]$/g, "");
}

let lastSeedError: string | null = null;

export function getAdminSeedError(): string | null {
  return lastSeedError;
}

async function seedProjectAdminIfEmpty(accounts: AdminAccount[]): Promise<AdminAccount[]> {
  lastSeedError = null;
  if (accounts.length > 0) return accounts;

  const email = normalizeAdminEmail(readEnvValue("ADMIN_EMAIL"));
  const password = readEnvValue("ADMIN_PASSWORD");
  if (!isValidAdminEmail(email) || !password) {
    lastSeedError =
      "Admin seed failed. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env, then restart Netlify Dev.";
    return accounts;
  }

  const policy = validatePassword(password, email);
  if (!policy.ok) {
    lastSeedError = `Admin seed failed. ${policy.error}`;
    return accounts;
  }

  const { hash, salt } = await hashPassword(password);
  const seeded: AdminAccount = {
    id: newId(),
    email,
    role: "project_admin",
    passwordHash: hash,
    passwordSalt: salt,
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
  };
  const next = [seeded];
  await persistAdmins(next);
  return next;
}

export async function loadAdmins(): Promise<AdminAccount[]> {
  return seedProjectAdminIfEmpty(await loadRawAdmins());
}

export async function loadSessions(): Promise<AdminSessionRecord[]> {
  const result = await loadStoredJsonResult<unknown>(SESSIONS_KEY);
  if (!result.ok) throw new StoreUnavailableError(SESSIONS_KEY);
  if (result.value === null) return [];
  if (!Array.isArray(result.value)) throw new StoreUnavailableError(SESSIONS_KEY);
  return result.value.filter(isSessionRecord);
}

/**
 * Only platform-set values are trusted. `x-forwarded-for` is client supplied, so
 * honouring it would let an attacker mint a fresh rate-limit bucket per request.
 * Falling back to the function context keeps every caller from collapsing into a
 * single shared bucket if the header is ever missing.
 */
export function clientIp(req: Request, context?: { ip?: string }): string {
  const header = req.headers.get("x-nf-client-connection-ip")?.trim();
  if (header) return header;
  return context?.ip?.trim() || "unknown";
}

export async function isLoginRateLimited(email: string, ip: string): Promise<boolean> {
  const emailKey = `${normalizeAdminEmail(email)}|${ip}`;
  if (await isRateLimited("loginEmailIp", emailKey)) return true;
  return isRateLimited("loginIp", ip);
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const emailKey = `${normalizeAdminEmail(email)}|${ip}`;
  await recordHit("loginEmailIp", emailKey);
  await recordHit("loginIp", ip);
}

export function getBearerToken(headers: Headers): string | null {
  const authHeader = headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

export async function requireAdmin(
  headers: Headers,
  options: { allowLimited?: boolean } = {}
): Promise<AdminAuthResult> {
  const token = getBearerToken(headers);
  if (!token) return { ok: false, response: unauthorized() };

  const now = Date.now();
  const sessions = await loadSessions();
  const tokenHash = hashToken(token);
  const session = sessions.find((entry) => entry.tokenHash === tokenHash && entry.expiresAt > now);
  if (!session) return { ok: false, response: unauthorized() };

  const accounts = await loadAdmins();
  const account = accounts.find((entry) => entry.id === session.userId);
  if (!account) return { ok: false, response: unauthorized() };

  const mustChangePassword = session.mustChangePassword || account.mustChangePassword;
  if (mustChangePassword && !options.allowLimited) {
    return { ok: false, response: forbidden("Password change required") };
  }

  return { ok: true, account, session };
}

export async function requireProjectAdmin(headers: Headers): Promise<AdminAuthResult> {
  const auth = await requireAdmin(headers);
  if (!auth.ok) return auth;
  if (auth.account.role !== "project_admin") {
    return { ok: false, response: forbidden() };
  }
  return auth;
}

async function pruneSessions(sessions: AdminSessionRecord[]): Promise<AdminSessionRecord[]> {
  const now = Date.now();
  const next = sessions.filter((session) => session.expiresAt > now);
  if (next.length !== sessions.length) {
    await persistSessions(next);
  }
  return next;
}

export async function createSession(
  account: AdminAccount,
  options: { mustChangePassword: boolean }
): Promise<string> {
  const sessions = await pruneSessions(await loadSessions());
  const token = createSessionToken();
  const record: AdminSessionRecord = {
    tokenHash: hashToken(token),
    userId: account.id,
    role: account.role,
    mustChangePassword: options.mustChangePassword,
    expiresAt: Date.now() + SESSION_TTL_MS,
    createdAt: new Date().toISOString(),
  };
  sessions.push(record);
  await persistSessions(sessions);
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const sessions = await loadSessions();
  const next = sessions.filter((session) => session.tokenHash !== tokenHash);
  if (next.length !== sessions.length) {
    await persistSessions(next);
  }
}

export async function revokeSessionsForUser(userId: string): Promise<void> {
  const sessions = await loadSessions();
  const next = sessions.filter((session) => session.userId !== userId);
  if (next.length !== sessions.length) {
    await persistSessions(next);
  }
}

export async function findAccountByEmail(email: string): Promise<AdminAccount | undefined> {
  const normalized = normalizeAdminEmail(email);
  const accounts = await loadAdmins();
  return accounts.find((account) => account.email === normalized);
}

export async function verifyAccountPassword(account: AdminAccount | undefined, password: string): Promise<boolean> {
  const hash = account?.passwordHash ?? DUMMY_HASH;
  const salt = account?.passwordSalt ?? DUMMY_SALT;
  const matches = await verifyPassword(password, hash, salt);
  return Boolean(account && matches);
}

export async function setAccountPassword(
  accountId: string,
  password: string,
  options: { mustChangePassword: boolean }
): Promise<AdminAccount | null> {
  const accounts = await loadAdmins();
  const index = accounts.findIndex((account) => account.id === accountId);
  if (index === -1) return null;
  const { hash, salt } = await hashPassword(password);
  accounts[index] = {
    ...accounts[index],
    passwordHash: hash,
    passwordSalt: salt,
    mustChangePassword: options.mustChangePassword,
  };
  await persistAdmins(accounts);
  return accounts[index];
}

export async function createWavemakerAccount(email: string, password: string): Promise<
  { ok: true; account: AdminPublicAccount } | { ok: false; error: string; status: number }
> {
  const normalized = normalizeAdminEmail(email);
  if (!isValidAdminEmail(normalized)) {
    return { ok: false, error: "Enter a valid email address.", status: 400 };
  }
  const policy = validatePassword(password, normalized);
  if (!policy.ok) {
    return { ok: false, error: policy.error, status: 400 };
  }

  const accounts = await loadAdmins();
  if (accounts.some((account) => account.email === normalized)) {
    return { ok: false, error: "An account with that email already exists.", status: 409 };
  }

  const { hash, salt } = await hashPassword(password);
  const account: AdminAccount = {
    id: newId(),
    email: normalized,
    role: "wavemaker_admin",
    passwordHash: hash,
    passwordSalt: salt,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  await persistAdmins(accounts);
  return { ok: true, account: toPublicAccount(account) };
}

export async function deleteWavemakerAccount(accountId: string): Promise<
  { ok: true } | { ok: false; error: string; status: number }
> {
  const accounts = await loadAdmins();
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) {
    return { ok: false, error: "Not found", status: 404 };
  }
  if (account.role === "project_admin") {
    return { ok: false, error: "Cannot delete the project admin account.", status: 403 };
  }
  await persistAdmins(accounts.filter((entry) => entry.id !== accountId));
  await revokeSessionsForUser(accountId);
  return { ok: true };
}

export function publicAccounts(accounts: AdminAccount[]): AdminPublicAccount[] {
  return accounts.map(toPublicAccount);
}

export function publicAccount(account: AdminAccount): AdminPublicAccount {
  return toPublicAccount(account);
}

export function tooManyLoginAttempts(): Response {
  return jsonResponse({ error: "Too many sign-in attempts. Try again later." }, 429);
}
