import { validatePassword } from "../../../src/shared/passwordPolicy";
import { consume, tooManyRequests } from "./rateLimit";
import {
  createSession,
  createWavemakerAccount,
  deleteWavemakerAccount,
  findAccountByEmail,
  getBearerToken,
  getAdminSeedError,
  isLoginRateLimited,
  loadAdmins,
  publicAccount,
  publicAccounts,
  recordLoginFailure,
  requireAdmin,
  requireProjectAdmin,
  revokeSession,
  revokeSessionsForUser,
  setAccountPassword,
  tooManyLoginAttempts,
  verifyAccountPassword,
} from "./adminStore";
import { jsonResponse, unauthorized } from "./storage";

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function handleAuth(req: Request, path: string, ip: string): Promise<Response> {
  if (path.endsWith("/auth/login")) {
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const body = (await readJson(req)) as Record<string, unknown>;
    const email = readString(body.email);
    const password = readString(body.password);

    if (await isLoginRateLimited(email, ip)) {
      return tooManyLoginAttempts();
    }

    const account = await findAccountByEmail(email);
    const valid = await verifyAccountPassword(account, password);
    if (!account || !valid) {
      // Count the attempt before branching so a seeding misconfiguration cannot
      // be used as an unthrottled password oracle.
      await recordLoginFailure(email, ip);
      const seedError = getAdminSeedError();
      if (seedError) {
        // The detail names environment variables, so it only goes to the logs.
        console.error(seedError);
        return jsonResponse({ error: "Sign-in is unavailable. Contact the site administrator." }, 503);
      }
      return jsonResponse({ error: "Invalid email or password." }, 401);
    }

    const token = await createSession(account, { mustChangePassword: account.mustChangePassword });
    return jsonResponse({
      token,
      email: account.email,
      role: account.role,
      mustChangePassword: account.mustChangePassword,
    });
  }

  if (path.endsWith("/auth/logout")) {
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const token = getBearerToken(req.headers);
    if (token) await revokeSession(token);
    return jsonResponse({ ok: true });
  }

  if (path.endsWith("/auth/change-password")) {
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const auth = await requireAdmin(req.headers, { allowLimited: true });
    if (!auth.ok) return auth.response;

    if (!(await consume("changePasswordAccount", auth.account.id))) {
      return tooManyRequests("Too many password change attempts. Try again later.");
    }

    const body = (await readJson(req)) as Record<string, unknown>;
    const currentPassword = readString(body.currentPassword);
    const newPassword = readString(body.newPassword);

    if (!auth.session.mustChangePassword) {
      const currentOk = await verifyAccountPassword(auth.account, currentPassword);
      if (!currentOk) {
        return jsonResponse({ error: "Current password is incorrect." }, 401);
      }
    }

    const policy = validatePassword(newPassword, auth.account.email, {
      currentPassword: currentPassword || undefined,
    });
    if (!policy.ok) {
      return jsonResponse({ error: policy.error }, 400);
    }

    const matchesCurrent = await verifyAccountPassword(auth.account, newPassword);
    if (matchesCurrent) {
      return jsonResponse({ error: "New password must differ from the current password." }, 400);
    }

    const updated = await setAccountPassword(auth.account.id, newPassword, { mustChangePassword: false });
    if (!updated) return unauthorized();
    await revokeSessionsForUser(updated.id);
    const token = await createSession(updated, { mustChangePassword: false });
    return jsonResponse({
      token,
      email: updated.email,
      role: updated.role,
      mustChangePassword: false,
    });
  }

  if (path.endsWith("/auth/me")) {
    if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
    const auth = await requireAdmin(req.headers, { allowLimited: true });
    if (!auth.ok) return auth.response;
    return jsonResponse({
      email: auth.account.email,
      role: auth.account.role,
      mustChangePassword: auth.session.mustChangePassword || auth.account.mustChangePassword,
    });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export async function handleAdmins(req: Request, path: string): Promise<Response> {
  const auth = await requireProjectAdmin(req.headers);
  if (!auth.ok) return auth.response;

  if (req.method !== "GET" && !(await consume("adminWriteAccount", auth.account.id))) {
    return tooManyRequests("Too many account changes. Try again later.");
  }

  const resetMatch = path.match(/\/admins\/([^/]+)\/reset-password$/);
  if (resetMatch) {
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const accountId = resetMatch[1];
    const accounts = await loadAdmins();
    const account = accounts.find((entry) => entry.id === accountId);
    if (!account) return jsonResponse({ error: "Not found" }, 404);
    if (account.role === "project_admin") {
      return jsonResponse({ error: "Reset the project admin password from Change password." }, 403);
    }

    const body = (await readJson(req)) as Record<string, unknown>;
    const password = readString(body.password);
    const policy = validatePassword(password, account.email);
    if (!policy.ok) {
      return jsonResponse({ error: policy.error }, 400);
    }

    const updated = await setAccountPassword(account.id, password, { mustChangePassword: true });
    if (!updated) return jsonResponse({ error: "Not found" }, 404);
    await revokeSessionsForUser(updated.id);
    return jsonResponse(publicAccount(updated));
  }

  const idMatch = path.match(/\/admins\/([^/]+)$/);
  if (idMatch) {
    if (req.method !== "DELETE") return jsonResponse({ error: "Method not allowed" }, 405);
    const result = await deleteWavemakerAccount(idMatch[1]);
    if (!result.ok) return jsonResponse({ error: result.error }, result.status);
    return jsonResponse({ ok: true });
  }

  if (!path.endsWith("/admins")) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  if (req.method === "GET") {
    return jsonResponse(publicAccounts(await loadAdmins()));
  }

  if (req.method === "POST") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = await createWavemakerAccount(readString(body.email), readString(body.password));
    if (!result.ok) return jsonResponse({ error: result.error }, result.status);
    return jsonResponse(result.account, 201);
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
