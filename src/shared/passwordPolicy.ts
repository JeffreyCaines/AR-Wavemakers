export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRequirementId =
  | "length"
  | "lowercase"
  | "uppercase"
  | "digit"
  | "special"
  | "notEmail";

export interface PasswordRequirementState {
  id: PasswordRequirementId;
  label: string;
  met: boolean;
}

export const PASSWORD_HINT_ICON_UNMET = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/></svg>`;

export const PASSWORD_HINT_ICON_MET = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check-circle" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="m10.97 4.97-.02.022-3.473 4.425-2.093-2.094a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05"/></svg>`;

export const PASSWORD_REQUIREMENTS = [
  `At least ${PASSWORD_MIN_LENGTH} characters`,
  "One lowercase letter",
  "One uppercase letter",
  "One digit",
  "One special character",
  "Must not match the account email",
] as const;

export type PasswordPolicyResult = { ok: true } | { ok: false; error: string };

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidAdminEmail(email: string): boolean {
  const value = normalizeAdminEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validatePassword(
  password: string,
  email: string,
  options: { currentPassword?: string } = {}
): PasswordPolicyResult {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Password is required." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, error: "Password must include a lowercase letter." };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: "Password must include an uppercase letter." };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: "Password must include a digit." };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, error: "Password must include a special character." };
  }

  const normalizedEmail = normalizeAdminEmail(email);
  if (normalizedEmail && password.toLowerCase() === normalizedEmail) {
    return { ok: false, error: "Password must not match the account email." };
  }
  if (options.currentPassword !== undefined && password === options.currentPassword) {
    return { ok: false, error: "New password must differ from the current password." };
  }

  return { ok: true };
}

export function passwordRequirementStates(password: string, email: string): PasswordRequirementState[] {
  const empty = password.length === 0;
  const normalizedEmail = normalizeAdminEmail(email);
  return [
    {
      id: "length",
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: !empty && password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: "lowercase",
      label: "One lowercase letter",
      met: !empty && /[a-z]/.test(password),
    },
    {
      id: "uppercase",
      label: "One uppercase letter",
      met: !empty && /[A-Z]/.test(password),
    },
    {
      id: "digit",
      label: "One digit",
      met: !empty && /[0-9]/.test(password),
    },
    {
      id: "special",
      label: "One special character",
      met: !empty && /[^A-Za-z0-9]/.test(password),
    },
    {
      id: "notEmail",
      label: "Must not match the account email",
      met: !empty && (!normalizedEmail || password.toLowerCase() !== normalizedEmail),
    },
  ];
}

export function passwordHintsHtml(): string {
  const items = passwordRequirementStates("", "")
    .map(
      (rule) =>
        `<li data-requirement="${rule.id}" data-met="false">${PASSWORD_HINT_ICON_UNMET}<span>${rule.label}</span></li>`
    )
    .join("");
  return `<ul class="admin-password-hints">${items}</ul>`;
}
