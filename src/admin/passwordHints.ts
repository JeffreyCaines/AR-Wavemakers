import {
  PASSWORD_HINT_ICON_MET,
  PASSWORD_HINT_ICON_UNMET,
  passwordRequirementStates,
} from "../shared/passwordPolicy";

export function bindPasswordHints(options: {
  list: HTMLElement;
  passwordInput: HTMLInputElement;
  emailInput?: HTMLInputElement | null;
  getEmail?: () => string;
}): void {
  const getEmail = (): string => options.emailInput?.value ?? options.getEmail?.() ?? "";

  const sync = (): void => {
    for (const rule of passwordRequirementStates(options.passwordInput.value, getEmail())) {
      const item = options.list.querySelector(`[data-requirement="${rule.id}"]`);
      if (!(item instanceof HTMLElement)) continue;
      item.dataset.met = rule.met ? "true" : "false";
      const icon = item.querySelector("svg");
      const markup = rule.met ? PASSWORD_HINT_ICON_MET : PASSWORD_HINT_ICON_UNMET;
      if (icon) icon.outerHTML = markup;
    }
  };

  options.passwordInput.addEventListener("input", sync);
  options.passwordInput.addEventListener("change", sync);
  options.emailInput?.addEventListener("input", sync);
  options.passwordInput.form?.addEventListener("reset", () => {
    queueMicrotask(sync);
  });
  sync();
}

export function disablePasswordAutofill(input: HTMLInputElement): void {
  input.autocomplete = "off";
  input.setAttribute("data-lpignore", "true");
  input.setAttribute("data-1p-ignore", "true");
  input.setAttribute("data-bwignore", "true");
  const lock = (): void => {
    input.readOnly = true;
  };
  const unlock = (): void => {
    input.readOnly = false;
  };
  lock();
  input.addEventListener("focusin", unlock);
  input.addEventListener("pointerdown", unlock);
  input.form?.addEventListener("reset", () => {
    queueMicrotask(lock);
  });
}
