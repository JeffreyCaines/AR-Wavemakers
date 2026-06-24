import "../admin/styles.css";
import { setAdminToken, verifyAdminPassword } from "../shared/api";

export interface AdminLoginOptions {
  title: string;
  subtitle: string;
  onSuccess: () => void;
}

export function renderAdminLogin(root: HTMLElement, options: AdminLoginOptions): void {
  root.innerHTML = `
    <div class="admin admin--login">
      <form class="admin-login" id="login-form">
        <h1>${options.title}</h1>
        <p>${options.subtitle}</p>
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
    const password = (root.querySelector("#login-password") as HTMLInputElement).value;
    errorEl.hidden = true;
    submitBtn.disabled = true;

    try {
      const { ok, status } = await verifyAdminPassword(password);
      if (!ok) {
        if (status === 401) {
          errorEl.textContent = "Invalid password.";
        } else if (status === 404) {
          errorEl.textContent =
            "API not found (404). Check that Netlify Functions deployed and /api/cards/all is reachable.";
        } else {
          errorEl.textContent = `Sign-in failed (HTTP ${status}). Check Netlify function logs.`;
        }
        errorEl.hidden = false;
        return;
      }
      setAdminToken(password);
      options.onSuccess();
    } catch {
      errorEl.textContent = "Could not reach the server.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
