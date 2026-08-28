import "../admin/styles.css";
import { changeAdminPassword, loginAdmin } from "../shared/api";
import { passwordHintsHtml } from "../shared/passwordPolicy";
import { bindPasswordHints, disablePasswordAutofill } from "./passwordHints";

export interface AdminLoginOptions {
  title: string;
  subtitle: string;
  onSuccess: () => void;
  mode?: "login" | "change-password";
  email?: string;
}

function showError(errorEl: HTMLElement, message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function loginErrorMessage(status: number, error: string): string {
  if (status === 401) return "Invalid email or password.";
  if (status === 429) return error || "Too many sign-in attempts. Try again later.";
  if (status === 404) {
    return "API not found (404). Check that Netlify Functions deployed and /api/auth/login is reachable.";
  }
  return error || `Sign-in failed (HTTP ${status}). Check Netlify function logs.`;
}

function bindChangePasswordForm(
  root: HTMLElement,
  options: { requireCurrent: boolean; onSuccess: () => void }
): void {
  const form = root.querySelector("#change-password-form") as HTMLFormElement;
  const errorEl = root.querySelector("#login-error") as HTMLElement;
  const submitBtn = form.querySelector("button[type=submit]") as HTMLButtonElement;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    const currentPassword = options.requireCurrent
      ? (root.querySelector("#current-password") as HTMLInputElement | null)?.value
      : undefined;
    const newPassword = (root.querySelector("#new-password") as HTMLInputElement).value;
    const confirmPassword = (root.querySelector("#confirm-password") as HTMLInputElement).value;
    if (newPassword !== confirmPassword) {
      showError(errorEl, "New passwords do not match.");
      return;
    }

    submitBtn.disabled = true;
    try {
      const result = await changeAdminPassword(newPassword, currentPassword);
      if (!result.ok) {
        showError(errorEl, result.error);
        return;
      }
      options.onSuccess();
    } catch {
      showError(errorEl, "Could not reach the server.");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function renderChangePassword(root: HTMLElement, options: AdminLoginOptions, requireCurrent: boolean): void {
  root.innerHTML = `
    <div class="admin admin--login">
      <form class="admin-login" id="change-password-form">
        <h1>${options.title}</h1>
        <p>${options.subtitle}</p>
        ${
          requireCurrent
            ? `<label class="admin-login__field">
          Current password
          <input type="password" id="current-password" required autocomplete="current-password" />
        </label>`
            : ""
        }
        <label class="admin-login__field">
          New password
          <input type="password" id="new-password" required autocomplete="off" readonly data-lpignore="true" data-1p-ignore="true" />
        </label>
        <label class="admin-login__field">
          Confirm new password
          <input type="password" id="confirm-password" required autocomplete="off" readonly data-lpignore="true" data-1p-ignore="true" />
        </label>
        ${passwordHintsHtml()}
        <button type="submit">Save password</button>
        <p id="login-error" class="admin-error" hidden></p>
      </form>
    </div>
  `;
  bindChangePasswordForm(root, { requireCurrent, onSuccess: options.onSuccess });
  const passwordInput = root.querySelector("#new-password") as HTMLInputElement | null;
  const confirmInput = root.querySelector("#confirm-password") as HTMLInputElement | null;
  const hints = root.querySelector(".admin-password-hints");
  if (hints instanceof HTMLElement && passwordInput) {
    bindPasswordHints({
      list: hints,
      passwordInput,
      getEmail: () => options.email ?? "",
    });
  }
  if (passwordInput) disablePasswordAutofill(passwordInput);
  if (confirmInput) disablePasswordAutofill(confirmInput);
}

export function renderAdminLogin(root: HTMLElement, options: AdminLoginOptions): void {
  if (options.mode === "change-password") {
    renderChangePassword(root, options, false);
    return;
  }

  root.innerHTML = `
    <div class="admin admin--login">
      <form class="admin-login" id="login-form">
        <h1>${options.title}</h1>
        <p>${options.subtitle}</p>
        <input type="email" id="login-email" placeholder="Email" required autocomplete="username" />
        <input type="password" id="login-password" placeholder="Password" required autocomplete="current-password" />
        <button type="submit">Sign in</button>
        <p id="login-error" class="admin-error" hidden></p>
      </form>
    </div>
  `;

  const form = root.querySelector("#login-form") as HTMLFormElement;
  const errorEl = root.querySelector("#login-error") as HTMLElement;
  const submitBtn = form.querySelector("button[type=submit]") as HTMLButtonElement;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = (root.querySelector("#login-email") as HTMLInputElement).value;
    const password = (root.querySelector("#login-password") as HTMLInputElement).value;
    errorEl.hidden = true;
    submitBtn.disabled = true;

    try {
      const result = await loginAdmin(email, password);
      if (!result.ok) {
        showError(errorEl, loginErrorMessage(result.status, result.error));
        return;
      }
      if (result.mustChangePassword) {
        renderChangePassword(
          root,
          {
            ...options,
            email: result.email,
            subtitle: "Create a new password to finish signing in.",
          },
          false
        );
        return;
      }
      options.onSuccess();
    } catch {
      showError(errorEl, "Could not reach the server.");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

