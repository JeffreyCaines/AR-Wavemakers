import { changeAdminPassword } from "../shared/api";
import { passwordHintsHtml } from "../shared/passwordPolicy";
import { bindPasswordHints, disablePasswordAutofill } from "./passwordHints";

export function changePasswordDialogHtml(): string {
  return `
    <div id="change-password-dialog" class="admin-dialog" hidden>
      <form id="change-password-dialog-form" class="admin-login" autocomplete="off">
        <h2>Change password</h2>
        <label class="admin-login__field">
          Current password
          <input type="password" id="dialog-current-password" required autocomplete="current-password" />
        </label>
        <label class="admin-login__field">
          New password
          <input type="password" id="dialog-new-password" required autocomplete="off" readonly data-lpignore="true" data-1p-ignore="true" />
        </label>
        <label class="admin-login__field">
          Confirm new password
          <input type="password" id="dialog-confirm-password" required autocomplete="off" readonly data-lpignore="true" data-1p-ignore="true" />
        </label>
        ${passwordHintsHtml()}
        <button type="submit">Update password</button>
        <button type="button" id="change-password-cancel" class="admin-btn admin-btn--ghost">Cancel</button>
        <p id="change-password-dialog-error" class="admin-error" hidden></p>
      </form>
    </div>
  `;
}

export function setupChangePasswordDialog(
  root: HTMLElement,
  options: { showToast: (message: string) => void; email: string }
): { open: () => void; close: () => void } {
  const dialog = root.querySelector("#change-password-dialog") as HTMLElement | null;
  const form = root.querySelector("#change-password-dialog-form") as HTMLFormElement | null;
  const errorEl = root.querySelector("#change-password-dialog-error") as HTMLElement | null;
  const cancelBtn = root.querySelector("#change-password-cancel") as HTMLButtonElement | null;
  const newPassword = root.querySelector("#dialog-new-password") as HTMLInputElement | null;
  const hints = form?.querySelector(".admin-password-hints");
  if (!dialog || !form || !errorEl) {
    return { open: () => undefined, close: () => undefined };
  }
  const confirmPassword = root.querySelector("#dialog-confirm-password") as HTMLInputElement | null;
  if (hints instanceof HTMLElement && newPassword) {
    bindPasswordHints({
      list: hints,
      passwordInput: newPassword,
      getEmail: () => options.email,
    });
  }
  if (newPassword) disablePasswordAutofill(newPassword);
  if (confirmPassword) disablePasswordAutofill(confirmPassword);

  const close = (): void => {
    dialog.hidden = true;
    form.reset();
    errorEl.hidden = true;
  };

  const open = (): void => {
    errorEl.hidden = true;
    dialog.hidden = false;
  };

  cancelBtn?.addEventListener("click", () => close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    const currentPassword = (root.querySelector("#dialog-current-password") as HTMLInputElement).value;
    const newPassword = (root.querySelector("#dialog-new-password") as HTMLInputElement).value;
    const confirmPassword = (root.querySelector("#dialog-confirm-password") as HTMLInputElement).value;
    if (newPassword !== confirmPassword) {
      errorEl.textContent = "New passwords do not match.";
      errorEl.hidden = false;
      return;
    }
    const submitBtn = form.querySelector("button[type=submit]") as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      const result = await changeAdminPassword(newPassword, currentPassword);
      if (!result.ok) {
        errorEl.textContent = result.error;
        errorEl.hidden = false;
        return;
      }
      close();
      options.showToast("Password updated.");
    } catch {
      errorEl.textContent = "Could not reach the server.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  return { open, close };
}
