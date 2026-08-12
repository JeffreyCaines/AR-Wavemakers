import "./formStyles.css";
import { INDUSTRIES, PROFESSIONS, TECHNL_MEMBER_OPTIONS } from "./options";
import { submitStory, uploadImage } from "../shared/api";
import {
  sanitizeIndividualSubmissionInput,
  sanitizeOrganizationSubmissionInput,
} from "../shared/sanitizeGetNoticed";
import infoIconUrl from "../images/infoIcon.png";
import sampleImageUrl from "../images/sampleImage.png";
import orgLogoPlaceholderUrl from "../images/logo.png";
import expandIconUrl from "../images/expand.png";
import exitIconUrl from "../images/exitIcon.png";

export type GetNoticedKind = "individual" | "organization";

type PopupKey =
  | "why"
  | "email"
  | "story"
  | "linkedin"
  | "name"
  | "submitterEmail"
  | "media"
  | "incomplete"
  | "thanks";

const OPTIONAL_INTRO =
  "Answer any of the following questions to highlight your achievements and global impact. Select the questions that can best tell your story. techNL will review all submissions to ensure they align with the project’s eligibility and purpose—showcasing the NL tech sector’s contribution at home and around the world.";

const STORY_QUESTION =
  "Do you have a tech project or success story that you’d like to share with techNL— something that you’ve worked on, are especially proud of, or excited about? Tell us your story";

const CONSENT_COPY =
  "I agree to allow techNL to review, approve, and publish my content to the Wavemakers Experience.";

const NEWSLETTER_COPY =
  "Stay informed about techNL’s latest initiatives and events. By joining, I agree to have my email added to techNL’s marketing list.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function infoButtonHtml(popupKey: PopupKey, ariaLabel = "More info"): string {
  return `<button type="button" class="copy-form__hint-btn" data-popup="${popupKey}" aria-label="${escapeHtml(ariaLabel)}"><img src="${infoIconUrl}" alt="" width="15" height="15" decoding="async" /></button>`;
}

function fieldLabel(text: string, required = false, hintKey?: PopupKey): string {
  const req = required ? `<span class="req">*</span>` : "";
  const hint = hintKey ? infoButtonHtml(hintKey) : "";
  // Live short labels: text + <img> as flex children of .Edit_titleText__t9Rrb
  // Live wrapping labels: <p>text<img></p> so the icon sits on the last line
  const wraps = text.length > 70;
  if (hintKey && wraps) {
    return `
    <div class="copy-form__label">
      <p class="copy-form__label-text">${req}${escapeHtml(text)}${hint}</p>
    </div>`;
  }
  return `
    <div class="copy-form__label">
      <span class="copy-form__label-text">${req}${escapeHtml(text)}</span>${hint}
    </div>`;
}

function singleDropdownHtml(name: string, options: readonly string[]): string {
  return `
    <div class="copy-form__dd" data-dd="${escapeHtml(name)}" data-dd-mode="single">
      <input type="hidden" name="${escapeHtml(name)}" value="" />
      <button type="button" class="copy-form__dd-toggle" aria-expanded="false">
        <span class="copy-form__dd-label copy-form__dd-placeholder">Select One</span>
        <img class="copy-form__dd-chevron" src="${expandIconUrl}" alt="" width="15" height="9" decoding="async" aria-hidden="true" />
      </button>
      <div class="copy-form__dd-container">
        <div class="copy-form__dd-menu" hidden>
          ${options
            .map(
              (opt) => `
            <button type="button" class="copy-form__dd-option" data-value="${escapeHtml(opt)}">
              <span class="copy-form__dd-option-text">${escapeHtml(opt)}</span>
            </button>`
            )
            .join("")}
        </div>
      </div>
    </div>`;
}

function multiDropdownHtml(name: string, options: readonly string[]): string {
  return `
    <div class="copy-form__dd" data-dd="${escapeHtml(name)}" data-dd-mode="multi" data-multi="${escapeHtml(name)}">
      <button type="button" class="copy-form__dd-toggle" aria-expanded="false">
        <span class="copy-form__dd-label copy-form__dd-placeholder">Select One</span>
        <img class="copy-form__dd-chevron" src="${expandIconUrl}" alt="" width="15" height="9" decoding="async" aria-hidden="true" />
      </button>
      <div class="copy-form__dd-container">
        <div class="copy-form__dd-menu" hidden>
          ${options
            .map(
              (opt) => `
            <label class="copy-form__dd-option">
              <input type="checkbox" value="${escapeHtml(opt)}" />
              <span class="copy-form__check-box" aria-hidden="true"></span>
              <span class="copy-form__dd-option-text">${escapeHtml(opt)}</span>
            </label>`
            )
            .join("")}
        </div>
      </div>
    </div>`;
}

function checkHtml(
  name: string,
  highlight: string,
  body: string,
  required = false
): string {
  return `
    <label class="copy-form__check">
      <input type="checkbox" name="${escapeHtml(name)}" ${required ? "required" : ""} />
      <span class="copy-form__check-box" aria-hidden="true"></span>
      <span class="copy-form__check-copy"><span class="copy-form__highlight">${escapeHtml(highlight)}</span> ${escapeHtml(body)}</span>
    </label>`;
}

function textField(
  name: string,
  label: string,
  opts: {
    required?: boolean;
    hint?: PopupKey;
    type?: string;
    placeholder?: string;
    maxlength?: number;
    min?: number;
    max?: number;
  } = {}
): string {
  const type = opts.type || "text";
  const maxlength = opts.maxlength ?? 200;
  const extra =
    type === "number"
      ? `min="${opts.min ?? ""}" max="${opts.max ?? ""}"`
      : `maxlength="${maxlength}"`;
  return `
    <div class="copy-form__field">
      ${fieldLabel(label, Boolean(opts.required), opts.hint)}
      <input name="${escapeHtml(name)}" type="${type}" placeholder="${escapeHtml(opts.placeholder || "")}" ${opts.required ? "required" : ""} ${extra} />
    </div>`;
}

function areaField(
  name: string,
  label: string,
  opts: { hint?: PopupKey; placeholder?: string; maxlength: number; required?: boolean }
): string {
  return `
    <div class="copy-form__field">
      ${fieldLabel(label, Boolean(opts.required), opts.hint)}
      <textarea name="${escapeHtml(name)}" maxlength="${opts.maxlength}" placeholder="${escapeHtml(opts.placeholder || "")}" data-count rows="4"></textarea>
      <span class="copy-form__char"><span data-count-out>0</span>/${opts.maxlength}</span>
    </div>`;
}

function individualFieldsHtml(): string {
  return `
    <div class="copy-form__upload" data-upload="logo">
      <div class="copy-form__photo">
        <div class="copy-form__photo-preview">
          <img class="copy-form__photo-default" src="${sampleImageUrl}" alt="" data-default-src="${sampleImageUrl}" decoding="async" />
          <button type="button" class="copy-form__photo-remove" aria-label="Remove photo" hidden><span aria-hidden="true">×</span></button>
        </div>
      </div>
      <button type="button" class="copy-form__photo-btn" data-pick-file><span>Add Photo</span></button>
      <input type="file" accept="image/*" hidden />
      <input type="hidden" name="logoUrl" value="" />
    </div>

    <div class="copy-form__fields">
      ${textField("firstName", "First Name", { required: true, placeholder: "Enter First Name", maxlength: 120 })}
      ${textField("lastName", "Last Name", { required: true, placeholder: "Enter Last Name", maxlength: 120 })}
      <div class="copy-form__field">
        ${fieldLabel("Are you or your organization a techNL member?", true)}
        ${singleDropdownHtml("isTechNlMember", TECHNL_MEMBER_OPTIONS)}
      </div>
      ${textField("pronouns", "Pronouns (optional)", { placeholder: "Enter Pronouns", maxlength: 120 })}
      <div class="copy-form__field">
        ${fieldLabel("Profession / Field of Study", true)}
        ${multiDropdownHtml("profession", PROFESSIONS)}
      </div>
      ${textField("currLocation", "Where do you currently live?", { required: true, placeholder: "Enter a location" })}
      ${textField("origLocation", "Where were you born or do you consider home?", { required: true, placeholder: "Enter a location" })}
      ${textField("linkedin", "LinkedIn", { hint: "linkedin", type: "url", placeholder: "Enter LinkedIn profile URL", maxlength: 500 })}
      ${textField("email", "Email", { required: true, hint: "email", type: "email", placeholder: "Enter email" })}

      <div class="copy-form__section">
        <div class="copy-form__section-title">Optional Questions:</div>
        <div class="copy-form__section-body">${escapeHtml(OPTIONAL_INTRO)}</div>
      </div>

      ${areaField("nlDescription", "What do you love most about working (or studying), or living in Newfoundland and Labrador (NL)?", { maxlength: 250, placeholder: "Enter answer (250-character limit)" })}
      ${areaField("whyDescription", "Why I choose to work (or study) in the NL tech sector?", { maxlength: 250, placeholder: "Enter answer (250-character limit)" })}
      ${areaField("dreamJob", "What is your tech-related dream job? Maybe you already have your dream job, if so, what is it and what do you love most about it?", { maxlength: 250, placeholder: "Enter answer (250-character limit)" })}
      ${areaField("story", STORY_QUESTION, { hint: "story", maxlength: 750, placeholder: "Enter answer (750-character limit)" })}

      ${checkHtml("optInModeration", "*Consent to Share Content:", CONSENT_COPY, true)}
      ${checkHtml("optInNewsletter", "Join Our Mailing List:", NEWSLETTER_COPY)}

      <div class="copy-form__submit-wrap">
        <button type="submit" class="copy-form__submit">Submit</button>
      </div>
    </div>
  `;
}

function organizationFieldsHtml(): string {
  return `
    <div class="copy-form__upload" data-upload="logo">
      <div class="copy-form__photo">
        <div class="copy-form__photo-preview">
          <img class="copy-form__photo-default" src="${orgLogoPlaceholderUrl}" alt="" data-default-src="${orgLogoPlaceholderUrl}" decoding="async" />
          <button type="button" class="copy-form__photo-remove" aria-label="Remove logo" hidden><span aria-hidden="true">×</span></button>
        </div>
      </div>
      <button type="button" class="copy-form__photo-btn" data-pick-file><span>Add Logo</span></button>
      <input type="file" accept="image/*" hidden />
      <input type="hidden" name="logoUrl" value="" />
    </div>

    <div class="copy-form__fields">
      ${textField("submitterName", "Name (Submitter)", { required: true, hint: "name", placeholder: "Enter your name", maxlength: 120 })}
      ${textField("submitterEmail", "Email (Submitter)", { required: true, hint: "submitterEmail", type: "email", placeholder: "Enter your email" })}
      ${textField("orgName", "Organization Name", { required: true, placeholder: "Enter organization Name", maxlength: 120 })}
      <div class="copy-form__field">
        ${fieldLabel("Are you or your organization a techNL member?", true)}
        ${singleDropdownHtml("isTechNlMember", TECHNL_MEMBER_OPTIONS)}
      </div>
      <div class="copy-form__field">
        ${fieldLabel("Industry", true)}
        ${multiDropdownHtml("industry", INDUSTRIES)}
      </div>
      ${textField("nlLocation", "Head office location", { required: true, placeholder: "Enter a location" })}
      <div class="copy-form__field copy-form__field--tight" data-repeat="locations">
        ${fieldLabel("Where does your organization conduct business?", true)}
        <div class="copy-form__repeat">
          <input type="text" maxlength="200" placeholder="Enter a location" data-repeat-input />
        </div>
        <button type="button" class="copy-form__add" data-add-repeat>+<u>Add New</u></button>
      </div>
      ${textField("websiteUrl", "Website", { required: true, type: "url", placeholder: "Enter organization website URL", maxlength: 500 })}
      ${textField("linkedinUrl", "LinkedIn", { hint: "linkedin", type: "url", placeholder: "Enter LinkedIn profile URL", maxlength: 500 })}
      ${textField("orgContactEmail", "Organization's General Inquires Email", { required: true, type: "email", placeholder: "Enter Organization's General Inquires Email" })}
      ${textField("yearEstablished", "Year established (optional)", { type: "number", placeholder: "YYYY", min: 1800, max: new Date().getFullYear() })}
      ${areaField("mainDescription", "Description (optional)", { maxlength: 250, placeholder: "Enter a brief description of the organization, e.g., products, services, and value proposition." })}
      ${areaField("companyBio", "Company Bio (optional)", { maxlength: 250, placeholder: "." })}

      <div class="copy-form__field copy-form__field--tight">${fieldLabel("Media (optional)", false, "media")}
        <div class="copy-form__media-row">
          <button type="button" class="copy-form__media-slot" data-upload="mediaOne">
            <span>Tap to add a image</span>
            <input type="file" accept="image/*" hidden />
            <input type="hidden" name="mediaOneUrl" value="" />
          </button>
          <button type="button" class="copy-form__media-slot" data-upload="mediaTwo">
            <span>Tap to add a image</span>
            <input type="file" accept="image/*" hidden />
            <input type="hidden" name="mediaTwoUrl" value="" />
          </button>
        </div>
      </div>
      <div class="copy-form__field copy-form__field--tight">
        <input name="youtubeLink" type="url" maxlength="500" placeholder="Enter a YouTube video link" />
      </div>

      <div class="copy-form__section-spacer" aria-hidden="true"></div>
      <div class="copy-form__section">
        <div class="copy-form__section-title">Optional Questions:</div>
        <div class="copy-form__section-body"><br>${escapeHtml(OPTIONAL_INTRO)}</div>
      </div>

      <div class="copy-form__field copy-form__field--tight" data-repeat="exportLocations">
        ${fieldLabel("Does your organization export its technology, products, or services outside of NL? If so, where?")}
        <div class="copy-form__repeat">
          <input type="text" maxlength="200" placeholder="Enter a location" data-repeat-input />
        </div>
        <button type="button" class="copy-form__add" data-add-repeat>+<u>Add New</u></button>
      </div>
      ${areaField("stakeholderDescription", "How do/would you describe the NL tech sector stakeholders who live outside the province?", { maxlength: 250, placeholder: "Enter answer (250-character limit)" })}
      ${areaField("storyDescription", "Share a tech-related success story that demonstrates your NL-based organization's impact, whether within Newfoundland and Labrador or beyond? If applicable, please include the country, province, or state connected to your story.", { hint: "story", maxlength: 250, placeholder: "Enter answer (250-character limit)" })}

      ${checkHtml("optInModeration", "*Consent to Share Content:", CONSENT_COPY, true)}
      ${checkHtml("optInNewsletter", "Join Our Mailing List:", NEWSLETTER_COPY)}

      <div class="copy-form__submit-wrap">
        <button type="submit" class="copy-form__submit">Submit</button>
      </div>
    </div>
  `;
}

function popupContent(key: PopupKey, kind: GetNoticedKind): { title: string; html: string } {
  switch (key) {
    case "why":
      return {
        title: "Why Participate?",
        html: `
          <div class="copy-modal__text"><b class="copy-modal__lead">Share Your Story:</b> Upload a portrait and personal story to highlight your unique perspective.<br><br><b class="copy-modal__lead">Showcase Your Impact:</b> Showcase your contributions to the NL tech sector by adding your story to the map.<br><br><b class="copy-modal__lead">Join a Global Narrative:</b> Join the Wavemakers Experience to be part of a project that celebrates NL’s diverse and innovative tech community.<br><br>Take a few minutes to submit your information and answer a question or two (or up to four). There are two streams, one for individuals and one for organizations. Share your story and help us illustrate how Newfoundland and Labrador's tech sector is making waves around the world.</div>
          <div class="copy-modal__header">Wavemakers Eligibility</div>
          <div class="copy-modal__text">For your profile to qualify for the Wavemakers Experience, ${
            kind === "individual"
              ? "individuals must 1) be directly connected to the tech sector by work or school, and 2) live in Newfoundland and Labrador (NL) or work remotely for an NL-based company."
              : "organizations must 1) be directly connected to the tech sector by work or school, and 2) live in Newfoundland and Labrador (NL) or work remotely for an NL-based company."
          }</div>`,
      };
    case "email":
      return {
        title: "Email Usage",
        html: `<p>This will be connected to your submission in case there is feedback or additional questions. Your email address will not be shared or sold.</p>`,
      };
    case "submitterEmail":
      return {
        title: "Your Email Usage",
        html: `<p>This will be tied to your submission in case there is feedback or additional questions. Your email address will not be shared or sold.</p>`,
      };
    case "name":
      return {
        title: "Your Name Usage",
        html: `<p>This will be tied to your submission in case there is feedback or additional questions. Your name will not be shared.</p>`,
      };
    case "linkedin":
      return {
        title: "Your LinkedIn",
        html: `<p>Your LinkedIn profile will showcase your career journey.</p>`,
      };
    case "story":
      return kind === "individual"
        ? {
            title: "Share Your Story",
            html: `<p>This question is designed to highlight sector success stories. These stories will not be published until they have been verified by techNL. We love hearing about successes and wins in the sector, so please don’t hesitate to share them—or email us anytime at info@technl.ca to share your news!</p>`,
          }
        : {
            title: "Sharing Your Story",
            html: `<p>This question is a tool to collect success stories and content. It would require techNL follow up</p>`,
          };
    case "media":
      return {
        title: "Media",
        html: `<p>Add one or two high-quality images or short videos showcasing the organization.Format: PNG/JPG. Max size: 100 MB.</p>`,
      };
    case "incomplete":
      return {
        title: "Incomplete Submission",
        html: `<p>It looks like some information is missing. Please review and complete all *Required Fields before submitting.</p>`,
      };
    case "thanks":
      return {
        title: "Thank you for sharing your story!",
        html: `<p>Your submission will be reviewed by techNL before it appears on the Wavemakers map.</p>`,
      };
  }
}

function readMulti(form: HTMLFormElement, name: string): string[] {
  const root = form.querySelector(`[data-multi="${name}"]`);
  if (!root) return [];
  return [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(
    (el) => el.value
  );
}

function readRepeat(form: HTMLFormElement, name: string): string[] {
  const root = form.querySelector(`[data-repeat="${name}"]`);
  if (!root) return [];
  return [...root.querySelectorAll<HTMLInputElement>("[data-repeat-input]")]
    .map((el) => el.value.trim())
    .filter(Boolean);
}

function updateMultiLabel(dd: HTMLElement): void {
  const checked = [...dd.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')];
  const label = dd.querySelector(".copy-form__dd-label");
  if (!label) return;
  if (checked.length === 0) {
    label.textContent = "Select One";
    label.classList.add("copy-form__dd-placeholder");
  } else {
    label.textContent = checked.map((el) => el.value).join(", ");
    label.classList.remove("copy-form__dd-placeholder");
  }
}

function wireDropdowns(root: HTMLElement, form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>("[data-dd]").forEach((dd) => {
    const toggle = dd.querySelector<HTMLButtonElement>(".copy-form__dd-toggle");
    const menu = dd.querySelector<HTMLElement>(".copy-form__dd-menu");
    if (!toggle || !menu) return;

    const setOpen = (open: boolean): void => {
      dd.classList.toggle("is-open", open);
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
    };

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(!dd.classList.contains("is-open"));
    });

    if (dd.dataset.ddMode === "single") {
      const hidden = dd.querySelector<HTMLInputElement>('input[type="hidden"]');
      const label = dd.querySelector(".copy-form__dd-label");
      dd.querySelectorAll<HTMLButtonElement>(".copy-form__dd-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          const value = opt.dataset.value || "";
          if (hidden) hidden.value = value;
          if (label) {
            label.textContent = value;
            label.classList.remove("copy-form__dd-placeholder");
          }
          setOpen(false);
        });
      });
    } else {
      dd.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
        box.addEventListener("change", () => updateMultiLabel(dd));
      });
    }
  });

  root.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    form.querySelectorAll<HTMLElement>("[data-dd].is-open").forEach((dd) => {
      if (target && dd.contains(target)) return;
      dd.classList.remove("is-open");
      dd.querySelector(".copy-form__dd-toggle")?.classList.remove("is-open");
      const menu = dd.querySelector<HTMLElement>(".copy-form__dd-menu");
      if (menu) menu.hidden = true;
    });
  });
}

async function handleFileUpload(
  fileInput: HTMLInputElement,
  previewHost: HTMLElement,
  hiddenInput: HTMLInputElement
): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error("Image must be 4MB or smaller.");
  }
  const result = await uploadImage(file);
  hiddenInput.value = result.url;
  let img = previewHost.querySelector<HTMLImageElement>("img.copy-form__photo-default, img");
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    previewHost.prepend(img);
  }
  img.src = result.url;
  img.classList.add("copy-form__photo-uploaded");
  img.classList.remove("copy-form__photo-default");
  const removeBtn = previewHost.querySelector<HTMLButtonElement>(".copy-form__photo-remove");
  if (removeBtn) {
    removeBtn.hidden = false;
    removeBtn.classList.add("is-visible");
  }
  const slotLabel = previewHost.querySelector("span");
  if (slotLabel && previewHost.classList.contains("copy-form__media-slot")) {
    slotLabel.setAttribute("hidden", "");
  }
}

export function openGetNoticedForm(root: HTMLElement, kind: GetNoticedKind): void {
  const existing = root.querySelector(".copy-form-overlay");
  existing?.remove();

  const title =
    kind === "individual" ? "Get Noticed - Individuals" : "Get Noticed - Organizations";

  const overlay = document.createElement("div");
  overlay.className = "copy-form-overlay";
  overlay.innerHTML = `
    <button type="button" class="copy-form-overlay__desktop-close" aria-label="Close"><img src="${exitIconUrl}" alt="" width="23" height="23" decoding="async" /></button>
    <form class="copy-form" novalidate>
      <header class="copy-form__header">
        <div class="copy-form__heading">
          <h2 class="copy-form__title">${title}</h2>
          <button type="button" class="copy-form__info" data-popup="why" aria-label="Why participate"><img src="${infoIconUrl}" alt="" width="15" height="15" decoding="async" /></button>
        </div>
        <button type="button" class="copy-form__close" aria-label="Close"><img src="${exitIconUrl}" alt="" width="30" height="30" decoding="async" /></button>
      </header>
      <div class="copy-form__body">
        ${kind === "individual" ? individualFieldsHtml() : organizationFieldsHtml()}
        <p class="copy-form__error" hidden></p>
      </div>
    </form>
  `;
  root.appendChild(overlay);

  const form = overlay.querySelector("form") as HTMLFormElement;
  const errorEl = form.querySelector(".copy-form__error") as HTMLElement;
  const submitBtn = form.querySelector(".copy-form__submit") as HTMLButtonElement;

  const close = (): void => overlay.remove();

  overlay.querySelector(".copy-form__close")?.addEventListener("click", close);
  overlay.querySelector(".copy-form-overlay__desktop-close")?.addEventListener("click", close);

  const showPopup = (key: PopupKey): void => {
    const content = popupContent(key, kind);
    const fieldInfoKeys: PopupKey[] = [
      "email",
      "submitterEmail",
      "name",
      "linkedin",
      "story",
      "media",
    ];
    const isFieldInfo = fieldInfoKeys.includes(key);
    const modal = document.createElement("div");
    modal.className = `copy-modal${isFieldInfo ? " copy-modal--field" : ""}`;
    modal.innerHTML = `
      <div class="copy-modal__panel ${key === "thanks" || key === "incomplete" ? "copy-modal__panel--white" : ""}">
        <button type="button" class="copy-modal__close" aria-label="Close"><img src="${exitIconUrl}" alt="" width="24" height="24" decoding="async" /></button>
        <div class="copy-modal__content">
          <div class="copy-modal__header">${escapeHtml(content.title)}</div>
          ${content.html}
        </div>
        ${
          key === "thanks"
            ? `<button type="button" class="copy-modal__done" data-done>Done</button>`
            : ""
        }
      </div>`;
    overlay.appendChild(modal);
    const dismiss = (): void => modal.remove();
    modal.querySelector(".copy-modal__close")?.addEventListener("click", dismiss);
    modal.querySelector("[data-done]")?.addEventListener("click", () => {
      dismiss();
      close();
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) dismiss();
    });
  };

  showPopup("why");

  overlay.querySelectorAll<HTMLElement>("[data-popup]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.popup as PopupKey | undefined;
      if (key) showPopup(key);
    });
  });

  wireDropdowns(overlay, form);

  form.querySelectorAll<HTMLTextAreaElement>("[data-count]").forEach((area) => {
    const out = area.parentElement?.querySelector("[data-count-out]");
    const update = (): void => {
      if (out) out.textContent = String(area.value.length);
    };
    area.addEventListener("input", update);
    update();
  });

  form.querySelectorAll<HTMLElement>("[data-add-repeat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const host = btn.closest("[data-repeat]");
      const list = host?.querySelector(".copy-form__repeat");
      if (!list) return;
      if (list.querySelectorAll("[data-repeat-input]").length >= 20) return;
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 200;
      input.placeholder = "Enter a location";
      input.dataset.repeatInput = "";
      list.appendChild(input);
    });
  });

  const wireUpload = (host: HTMLElement): void => {
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]');
    const hidden = host.querySelector<HTMLInputElement>('input[type="hidden"]');
    const pickBtn = host.querySelector<HTMLButtonElement>("[data-pick-file]") || host;
    const preview =
      host.querySelector<HTMLElement>(".copy-form__photo-preview") || host;
    if (!fileInput || !hidden) return;

    pickBtn.addEventListener("click", (event) => {
      event.preventDefault();
      fileInput.click();
    });

    host.querySelector(".copy-form__photo-remove")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hidden.value = "";
      fileInput.value = "";
      const img = preview.querySelector<HTMLImageElement>("img");
      const defaultSrc = img?.dataset.defaultSrc;
      if (img && defaultSrc) {
        img.src = defaultSrc;
        img.classList.add("copy-form__photo-default");
        img.classList.remove("copy-form__photo-uploaded");
      } else {
        img?.remove();
        preview.querySelector("span")?.removeAttribute("hidden");
      }
      const removeBtn = preview.querySelector<HTMLButtonElement>(".copy-form__photo-remove");
      if (removeBtn) {
        removeBtn.hidden = true;
        removeBtn.classList.remove("is-visible");
      }
    });

    fileInput.addEventListener("change", async () => {
      errorEl.hidden = true;
      try {
        await handleFileUpload(fileInput, preview, hidden);
      } catch (error) {
        errorEl.textContent = error instanceof Error ? error.message : "Upload failed.";
        errorEl.hidden = false;
      }
    });
  };

  form.querySelectorAll<HTMLElement>("[data-upload]").forEach(wireUpload);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;

    const fd = new FormData(form);
    let payload: Record<string, unknown>;

    if (kind === "individual") {
      payload = {
        submissionType: "individual",
        firstName: fd.get("firstName"),
        lastName: fd.get("lastName"),
        isTechNlMember: fd.get("isTechNlMember"),
        pronouns: fd.get("pronouns"),
        profession: readMulti(form, "profession"),
        currLocation: fd.get("currLocation"),
        origLocation: fd.get("origLocation"),
        linkedin: fd.get("linkedin"),
        email: fd.get("email"),
        nlDescription: fd.get("nlDescription"),
        whyDescription: fd.get("whyDescription"),
        dreamJob: fd.get("dreamJob"),
        story: fd.get("story"),
        logoUrl: fd.get("logoUrl"),
        optInModeration: form.querySelector<HTMLInputElement>('[name="optInModeration"]')?.checked === true,
        optInNewsletter: form.querySelector<HTMLInputElement>('[name="optInNewsletter"]')?.checked === true,
      };
    } else {
      const yearRaw = String(fd.get("yearEstablished") || "").trim();
      payload = {
        submissionType: "organization",
        submitterName: fd.get("submitterName"),
        submitterEmail: fd.get("submitterEmail"),
        orgName: fd.get("orgName"),
        isTechNlMember: fd.get("isTechNlMember"),
        industry: readMulti(form, "industry"),
        nlLocation: fd.get("nlLocation"),
        locations: readRepeat(form, "locations"),
        websiteUrl: fd.get("websiteUrl"),
        linkedinUrl: fd.get("linkedinUrl"),
        orgContactEmail: fd.get("orgContactEmail"),
        yearEstablished: yearRaw ? Number(yearRaw) : undefined,
        mainDescription: fd.get("mainDescription"),
        companyBio: fd.get("companyBio"),
        mediaOneUrl: fd.get("mediaOneUrl") || undefined,
        mediaTwoUrl: fd.get("mediaTwoUrl") || undefined,
        youtubeLink: fd.get("youtubeLink"),
        exportLocations: readRepeat(form, "exportLocations"),
        stakeholderDescription: fd.get("stakeholderDescription"),
        storyDescription: fd.get("storyDescription"),
        logoUrl: fd.get("logoUrl"),
        optInModeration: form.querySelector<HTMLInputElement>('[name="optInModeration"]')?.checked === true,
        optInNewsletter: form.querySelector<HTMLInputElement>('[name="optInNewsletter"]')?.checked === true,
      };
    }

    const result =
      kind === "individual"
        ? sanitizeIndividualSubmissionInput(payload)
        : sanitizeOrganizationSubmissionInput(payload);

    if (!result.ok) {
      showPopup("incomplete");
      errorEl.textContent = result.error;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      return;
    }

    try {
      await submitStory(result.value);
      showPopup("thanks");
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Submission failed.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
