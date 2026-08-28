import type { AdminPublicAccount, AdminRole } from "../shared/adminAuth";
import { createAdminAccount, deleteAdminAccount, fetchAdminAccounts, resetAdminPassword } from "../shared/api";
import { passwordHintsHtml } from "../shared/passwordPolicy";
import { bindPasswordHints, disablePasswordAutofill } from "./passwordHints";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function roleLabel(role: AdminPublicAccount["role"]): string {
  return role === "project_admin" ? "Project admin" : "Wavemaker admin";
}

function sessionActionButtonsHtml(): string {
  return `
    <div class="admin-accounts__actions">
      <button type="button" class="admin-btn admin-btn--ghost" data-change-password>Change password</button>
      <button type="button" class="admin-btn" data-logout>Sign Out</button>
    </div>
  `;
}

function bindInputHint(input: HTMLInputElement, label: string, missing: string): void {
  input.title = label;
  const syncValidity = (): void => {
    if (!input.value) {
      input.setCustomValidity(missing);
      return;
    }
    if (input.validity.typeMismatch) {
      input.setCustomValidity(`Please enter a valid ${label.toLowerCase()}.`);
      return;
    }
    input.setCustomValidity("");
  };
  input.addEventListener("invalid", syncValidity);
  input.addEventListener("input", syncValidity);
  syncValidity();
}

export function setupAccountsPanel(
  root: HTMLElement,
  options: { showToast: (message: string) => void; sessionEmail: string; canManage: boolean }
): { refresh: () => Promise<void> } {
  const listEl = root.querySelector("#admin-account-list") as HTMLUListElement | null;
  const createDialog = root.querySelector("#create-admin-dialog") as HTMLElement | null;
  const createForm = root.querySelector("#create-admin-form") as HTMLFormElement | null;
  const createError = root.querySelector("#create-admin-error") as HTMLElement | null;
  const addAdminBtn = root.querySelector("#add-admin-btn") as HTMLButtonElement | null;
  const createCancel = root.querySelector("#create-admin-cancel") as HTMLButtonElement | null;
  if (!options.canManage || !listEl || !createDialog || !createForm || !createError || !addAdminBtn) {
    return { refresh: async () => undefined };
  }

  let accounts: AdminPublicAccount[] = [];

  const renderList = (): void => {
    if (accounts.length === 0) {
      listEl.innerHTML = `<li class="admin-muted">No accounts yet.</li>`;
      return;
    }

    listEl.innerHTML = accounts
      .map((account) => {
        const pending = account.mustChangePassword ? `<em>Temporary password</em>` : "";
        const isSessionAccount = account.email.toLowerCase() === options.sessionEmail.toLowerCase();
        const actions = isSessionAccount
          ? sessionActionButtonsHtml()
          : account.role === "project_admin"
            ? ""
            : `
              <div class="admin-accounts__actions">
                <button type="button" class="admin-btn admin-btn--ghost" data-reset="${escapeHtml(account.id)}">Reset password</button>
                <button type="button" class="admin-btn admin-btn--pill--purple" data-delete="${escapeHtml(account.id)}">Delete</button>
              </div>
            `;
        return `
          <li class="admin-accounts__item">
            <div class="admin-accounts__meta">
              <strong>${escapeHtml(account.email)}</strong>
              <span>${roleLabel(account.role)}</span>
              ${pending}
            </div>
            ${actions}
          </li>
        `;
      })
      .join("");

    listEl.querySelectorAll<HTMLButtonElement>("[data-reset]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.reset;
        if (!id) return;
        const account = accounts.find((entry) => entry.id === id);
        if (!account) return;
        openResetDialog(account);
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.delete;
        if (!id) return;
        const account = accounts.find((entry) => entry.id === id);
        if (!account) return;
        openDeleteDialog(account);
      });
    });
  };

  const dialog = root.querySelector("#delete-account-dialog") as HTMLElement | null;
  const dialogEmail = root.querySelector("#delete-account-email") as HTMLElement | null;
  const dialogError = root.querySelector("#delete-account-error") as HTMLElement | null;
  const dialogCancel = root.querySelector("#delete-account-cancel") as HTMLButtonElement | null;
  const dialogConfirm = root.querySelector("#delete-account-confirm") as HTMLButtonElement | null;
  let pendingDeleteId: string | null = null;

  const closeDeleteDialog = (): void => {
    pendingDeleteId = null;
    if (dialog) dialog.hidden = true;
    if (dialogError) dialogError.hidden = true;
  };

  const openDeleteDialog = (account: AdminPublicAccount): void => {
    if (!dialog || !dialogEmail) return;
    pendingDeleteId = account.id;
    dialogEmail.textContent = account.email;
    if (dialogError) dialogError.hidden = true;
    dialog.hidden = false;
    dialogCancel?.focus();
  };

  dialogCancel?.addEventListener("click", () => closeDeleteDialog());
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) closeDeleteDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!dialog?.isConnected || dialog.hidden) return;
    closeDeleteDialog();
  });
  dialogConfirm?.addEventListener("click", async () => {
    if (!pendingDeleteId || !dialogConfirm) return;
    const id = pendingDeleteId;
    dialogConfirm.disabled = true;
    if (dialogError) dialogError.hidden = true;
    try {
      await deleteAdminAccount(id);
      closeDeleteDialog();
      options.showToast("Account deleted.");
      await refresh();
    } catch (error) {
      if (dialogError) {
        dialogError.textContent = error instanceof Error ? error.message : "Delete failed.";
        dialogError.hidden = false;
      }
    } finally {
      dialogConfirm.disabled = false;
    }
  });

  const resetDialog = root.querySelector("#reset-password-dialog") as HTMLElement | null;
  const resetForm = root.querySelector("#reset-password-dialog-form") as HTMLFormElement | null;
  const resetEmailEl = root.querySelector("#reset-password-email") as HTMLElement | null;
  const resetError = root.querySelector("#reset-password-dialog-error") as HTMLElement | null;
  const resetCancel = root.querySelector("#reset-password-cancel") as HTMLButtonElement | null;
  const resetPassword = root.querySelector("#reset-dialog-password") as HTMLInputElement | null;
  const resetHints = resetForm?.querySelector(".admin-password-hints");
  let pendingReset: AdminPublicAccount | null = null;

  const closeResetDialog = (): void => {
    pendingReset = null;
    if (resetDialog) resetDialog.hidden = true;
    resetForm?.reset();
    if (resetError) resetError.hidden = true;
  };

  const openResetDialog = (account: AdminPublicAccount): void => {
    if (!resetDialog || !resetForm) return;
    pendingReset = account;
    if (resetEmailEl) resetEmailEl.textContent = account.email;
    if (resetError) resetError.hidden = true;
    resetDialog.hidden = false;
  };

  if (resetPassword) {
    bindInputHint(resetPassword, "Temporary password", "Please enter a temporary password.");
    disablePasswordAutofill(resetPassword);
  }
  if (resetHints instanceof HTMLElement && resetPassword) {
    bindPasswordHints({
      list: resetHints,
      passwordInput: resetPassword,
      getEmail: () => pendingReset?.email ?? "",
    });
  }

  resetCancel?.addEventListener("click", () => closeResetDialog());
  resetDialog?.addEventListener("click", (event) => {
    if (event.target === resetDialog) closeResetDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!resetDialog?.isConnected || resetDialog.hidden) return;
    closeResetDialog();
  });
  resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!pendingReset || !resetPassword || !resetError) return;
    resetError.hidden = true;
    const submitBtn = resetForm.querySelector("button[type=submit]") as HTMLButtonElement | null;
    if (submitBtn) submitBtn.disabled = true;
    try {
      await resetAdminPassword(pendingReset.id, resetPassword.value);
      closeResetDialog();
      options.showToast("Temporary password saved.");
      await refresh();
    } catch (error) {
      resetError.textContent = error instanceof Error ? error.message : "Reset failed.";
      resetError.hidden = false;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  const refresh = async (): Promise<void> => {
    accounts = await fetchAdminAccounts();
    renderList();
  };

  const createEmail = createForm.elements.namedItem("email") as HTMLInputElement | null;
  const createPassword = createForm.elements.namedItem("temporaryPassword") as HTMLInputElement | null;
  const createHints = createForm.querySelector(".admin-password-hints");
  if (createEmail) bindInputHint(createEmail, "Email", "Please enter an email.");
  if (createPassword) bindInputHint(createPassword, "Temporary password", "Please enter a temporary password.");
  if (createPassword) disablePasswordAutofill(createPassword);
  if (createHints instanceof HTMLElement && createPassword) {
    bindPasswordHints({ list: createHints, passwordInput: createPassword, emailInput: createEmail });
  }

  const closeCreateDialog = (): void => {
    createDialog.hidden = true;
    createForm.reset();
    createError.hidden = true;
  };

  const openCreateDialog = (): void => {
    createError.hidden = true;
    createDialog.hidden = false;
  };

  addAdminBtn.addEventListener("click", openCreateDialog);
  createCancel?.addEventListener("click", () => closeCreateDialog());
  createDialog.addEventListener("click", (event) => {
    if (event.target === createDialog) closeCreateDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!createDialog.isConnected || createDialog.hidden) return;
    closeCreateDialog();
  });

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    createError.hidden = true;
    const email = (createForm.elements.namedItem("email") as HTMLInputElement).value;
    const password = (createForm.elements.namedItem("temporaryPassword") as HTMLInputElement).value;
    const submitBtn = createForm.querySelector("button[type=submit]") as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      await createAdminAccount(email, password);
      closeCreateDialog();
      options.showToast("Wavemaker admin created.");
      await refresh();
    } catch (error) {
      createError.textContent = error instanceof Error ? error.message : "Could not create account.";
      createError.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  return { refresh };
}

export function accountsSectionHtml(options: {
  mode: "manage" | "settings";
  email?: string;
  role?: AdminRole;
}): string {
  if (options.mode === "settings") {
    const email = options.email ?? "";
    const role = options.role ?? "wavemaker_admin";
    return `
    <section id="accounts-section" class="admin-accounts admin-scroll" hidden aria-label="Account settings">
      <div class="admin-accounts__inner">
        <h2>Account Settings</h2>
        <ul class="admin-accounts__list">
          <li class="admin-accounts__item">
            <div class="admin-accounts__meta">
              <strong>${escapeHtml(email)}</strong>
              <span>${roleLabel(role)}</span>
            </div>
            ${sessionActionButtonsHtml()}
          </li>
        </ul>
      </div>
    </section>
    `;
  }

  return `
    <section id="accounts-section" class="admin-accounts admin-scroll" hidden aria-label="Manage accounts">
      <div class="admin-accounts__inner">
        <h2>Accounts</h2>
        <p class="admin-muted">Create wavemaker admins. They sign in with this temporary password, then must set a new one.</p>
        <ul id="admin-account-list" class="admin-accounts__list"></ul>
        <button type="button" id="add-admin-btn" class="admin-btn admin-accounts__add">Add new admin</button>
      </div>
    </section>
  `;
}

export function createAdminDialogHtml(): string {
  return `
    <div id="create-admin-dialog" class="admin-dialog" hidden>
      <form id="create-admin-form" class="admin-login" autocomplete="off">
        <h2>New wavemaker admin</h2>
        <label class="admin-login__field">
          Email
          <input type="email" name="email" title="Email" required autocomplete="off" />
        </label>
        <label class="admin-login__field">
          Temporary password
          <input type="password" name="temporaryPassword" title="Temporary password" required autocomplete="off" readonly data-lpignore="true" data-1p-ignore="true" />
        </label>
        ${passwordHintsHtml()}
        <button type="submit">Create account</button>
        <button type="button" id="create-admin-cancel" class="admin-btn admin-btn--ghost">Cancel</button>
        <p id="create-admin-error" class="admin-error" hidden></p>
      </form>
    </div>
  `;
}

export function resetPasswordDialogHtml(): string {
  return `
    <div id="reset-password-dialog" class="admin-dialog" hidden>
      <form id="reset-password-dialog-form" class="admin-login" autocomplete="off">
        <h2>Reset password</h2>
        <p id="reset-password-email" class="admin-muted"></p>
        <label class="admin-login__field">
          Temporary password
          <input type="password" id="reset-dialog-password" title="Temporary password" required autocomplete="off" readonly data-lpignore="true" data-1p-ignore="true" />
        </label>
        ${passwordHintsHtml()}
        <button type="submit">Save temporary password</button>
        <button type="button" id="reset-password-cancel" class="admin-btn admin-btn--ghost">Cancel</button>
        <p id="reset-password-dialog-error" class="admin-error" hidden></p>
      </form>
    </div>
  `;
}

export function deleteAccountDialogHtml(): string {
  return `
    <div id="delete-account-dialog" class="admin-dialog" hidden>
      <div class="admin-accounts__confirm" role="alertdialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-copy">
        <h2 id="delete-account-title">Delete account</h2>
        <p id="delete-account-copy">Delete <strong id="delete-account-email"></strong>? They will lose admin access immediately.</p>
        <div class="admin-accounts__confirm-actions">
          <button type="button" id="delete-account-cancel" class="admin-btn admin-btn--ghost">Cancel</button>
          <button type="button" id="delete-account-confirm" class="admin-btn admin-btn--pill--purple">Delete</button>
        </div>
        <p id="delete-account-error" class="admin-error" hidden></p>
      </div>
    </div>
  `;
}
