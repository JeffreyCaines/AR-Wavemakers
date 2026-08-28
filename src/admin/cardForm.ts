import { INDUSTRIES, PROFESSIONS, TECHNL_MEMBER_OPTIONS } from "../copy/options";
import {
  buildIndividualBody,
  buildOrganizationBody,
} from "../shared/sanitizeGetNoticed";
import type { CardType, InfoCard } from "../shared/types";

export type CardFormState = Omit<InfoCard, "id">;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const optionList = (options: readonly string[]): string =>
  options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");

const resolveCardType = (card: Pick<InfoCard, "cardType">): CardType =>
  card.cardType === "individual" ? "individual" : "organization";

export function emptyCardForm(cardType: CardType = "organization"): CardFormState {
  return {
    title: "",
    body: "",
    companyName: "",
    address: "",
    lat: 0,
    lng: 0,
    mapX: 0.5,
    mapY: 0.5,
    imageUrl: "",
    linkUrl: "",
    active: true,
    cardType,
    firstName: "",
    lastName: "",
    pronouns: "",
    profession: [],
    currLocation: "",
    origLocation: "",
    linkedin: "",
    email: "",
    nlDescription: "",
    whyDescription: "",
    dreamJob: "",
    story: "",
    submitterName: "",
    submitterEmail: "",
    orgName: "",
    industry: [],
    nlLocation: "",
    locations: [],
    websiteUrl: "",
    linkedinUrl: "",
    orgContactEmail: "",
    yearEstablished: undefined,
    mainDescription: "",
    companyBio: "",
    mediaOneUrl: "",
    mediaTwoUrl: "",
    youtubeLink: "",
    exportLocations: [],
    stakeholderDescription: "",
    storyDescription: "",
    isTechNlMember: "",
    logoUrl: "",
    optInModeration: false,
    optInNewsletter: false,
  };
}

export function cardFormFieldsHtml(): string {
  return `
    <div class="admin-form__tabs" role="tablist" aria-label="Card fields">
      <button type="button" class="admin-form__tab admin-form__tab--active" role="tab" aria-selected="true" data-form-tab="details">Details</button>
      <button type="button" class="admin-form__tab" role="tab" aria-selected="false" data-form-tab="media">Media</button>
    </div>
    <div class="admin-form__scroll admin-scroll">
      <div class="admin-form__tabpanel admin-form__tabpanel--active" data-form-tabpanel="details" role="tabpanel">
        <fieldset data-card-fields="individual" class="admin-form__type-fields">
          <label>First name<input name="firstName" maxlength="120" /></label>
          <label>Last name<input name="lastName" maxlength="120" /></label>
          <label>techNL member
            <select name="isTechNlMember">
              <option value="">Select one</option>
              ${optionList(TECHNL_MEMBER_OPTIONS)}
            </select>
          </label>
          <label>Pronouns (optional)<input name="pronouns" maxlength="120" /></label>
          <label>Profession / field of study
            <select name="profession" multiple size="8">${optionList(PROFESSIONS)}</select>
          </label>
          <label>Where do you currently live?<input name="currLocation" maxlength="200" /></label>
          <label>Where were you born or do you consider home?<input name="origLocation" maxlength="200" /></label>
          <label>LinkedIn<input name="linkedin" type="url" maxlength="500" placeholder="https://…" /></label>
          <label>Email<input name="email" type="email" maxlength="200" /></label>
          <p class="admin-form__section-title">Optional questions</p>
          <label>What do you love most about working (or studying), or living in Newfoundland and Labrador (NL)?
            <textarea name="nlDescription" rows="4" maxlength="250"></textarea>
          </label>
          <label>Why I choose to work (or study) in the NL tech sector?
            <textarea name="whyDescription" rows="4" maxlength="250"></textarea>
          </label>
          <label>What is your tech-related dream job?
            <textarea name="dreamJob" rows="4" maxlength="250"></textarea>
          </label>
          <label>Success story
            <textarea name="story" rows="6" maxlength="750"></textarea>
          </label>
          <label class="admin-checkbox"><input name="optInModeration" type="checkbox" disabled /> Consent to share content</label>
          <label class="admin-checkbox"><input name="optInNewsletter" type="checkbox" disabled /> Join mailing list</label>
        </fieldset>

        <fieldset data-card-fields="organization" class="admin-form__type-fields" hidden disabled>
          <label>Name (submitter)<input name="submitterName" maxlength="120" /></label>
          <label>Email (submitter)<input name="submitterEmail" type="email" maxlength="200" /></label>
          <label>Organization name<input name="orgName" maxlength="120" /></label>
          <label>techNL member
            <select name="isTechNlMemberOrg">
              <option value="">Select one</option>
              ${optionList(TECHNL_MEMBER_OPTIONS)}
            </select>
          </label>
          <label>Industry
            <select name="industry" multiple size="8">${optionList(INDUSTRIES)}</select>
          </label>
          <label>Head office location<input name="nlLocation" maxlength="200" /></label>
          <label>Where does your organization conduct business?
            <textarea name="locations" rows="3" placeholder="One location per line"></textarea>
          </label>
          <label>Website<input name="websiteUrl" type="url" maxlength="500" placeholder="https://…" /></label>
          <label>LinkedIn<input name="linkedinUrl" type="url" maxlength="500" placeholder="https://…" /></label>
          <label>Organization's general inquiries email<input name="orgContactEmail" type="email" maxlength="200" /></label>
          <label>Year established (optional)<input name="yearEstablished" type="number" min="1800" max="2100" placeholder="YYYY" /></label>
          <label>Description (optional)<textarea name="mainDescription" rows="4" maxlength="250"></textarea></label>
          <label>Company bio (optional)<textarea name="companyBio" rows="4" maxlength="250"></textarea></label>
          <p class="admin-form__section-title">Optional questions</p>
          <label>Export locations (outside NL)
            <textarea name="exportLocations" rows="3" placeholder="One location per line"></textarea>
          </label>
          <label>How do/would you describe the NL tech sector stakeholders who live outside the province?
            <textarea name="stakeholderDescription" rows="4" maxlength="250"></textarea>
          </label>
          <label>Success story
            <textarea name="storyDescription" rows="4" maxlength="250"></textarea>
          </label>
          <label class="admin-checkbox"><input name="optInModerationOrg" type="checkbox" disabled /> Consent to share content</label>
          <label class="admin-checkbox"><input name="optInNewsletterOrg" type="checkbox" disabled /> Join mailing list</label>
        </fieldset>

        <div class="admin-form__map-section">
          <p class="admin-form__section-title">Map placement</p>
          <label class="admin-checkbox"><input name="active" type="checkbox" checked /> Active</label>
          <label>Address<input name="address" placeholder="City, Country" /></label>
          <button type="button" id="geocode-btn" class="admin-btn--pill admin-form__geocode-btn">Geocode address</button>
          <button type="button" id="recalc-pin-btn" class="admin-btn--pill admin-form__geocode-btn">
            Recalculate pin from calibration
          </button>
          <span id="geocode-result" class="admin-muted admin-form__geocode-result"></span>
          <small class="admin-attribution">Geocoding &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</small>
        </div>
      </div>

      <div class="admin-form__tabpanel" data-form-tabpanel="media" role="tabpanel" hidden>
        <fieldset data-card-fields="individual" class="admin-form__type-fields">
          <label>Photo URL<input name="logoUrl" type="text" maxlength="500" placeholder="https://… or /api/uploads/…" /></label>
        </fieldset>
        <fieldset data-card-fields="organization" class="admin-form__type-fields" hidden disabled>
          <label>Logo URL<input name="logoUrlOrg" type="text" maxlength="500" placeholder="https://… or /api/uploads/…" /></label>
          <label>Media 1 URL<input name="mediaOneUrl" type="text" maxlength="500" placeholder="https://… or /api/uploads/…" /></label>
          <label>Media 2 URL<input name="mediaTwoUrl" type="text" maxlength="500" placeholder="https://… or /api/uploads/…" /></label>
          <label>YouTube link<input name="youtubeLink" type="url" maxlength="500" placeholder="https://…" /></label>
        </fieldset>
      </div>
    </div>
  `;
}

export function syncCardFormTypeFields(form: HTMLFormElement, cardType: CardType): void {
  form.querySelectorAll<HTMLFieldSetElement>("[data-card-fields]").forEach((fieldset) => {
    const matches = fieldset.dataset.cardFields === cardType;
    fieldset.hidden = !matches;
    fieldset.disabled = !matches;
  });
}

const linesToList = (value: FormDataEntryValue | null): string[] => {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const multiSelectValues = (form: HTMLFormElement, name: string): string[] => {
  const el = form.elements.namedItem(name);
  if (!(el instanceof HTMLSelectElement)) return [];
  return Array.from(el.selectedOptions).map((option) => option.value);
};

const setMultiSelectValues = (form: HTMLFormElement, name: string, values: string[] | undefined): void => {
  const el = form.elements.namedItem(name);
  if (!(el instanceof HTMLSelectElement)) return;
  const selected = new Set(values ?? []);
  Array.from(el.options).forEach((option) => {
    option.selected = selected.has(option.value);
  });
};

const setInputValue = (form: HTMLFormElement, name: string, value: string): void => {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = value;
  }
};

const setCheckbox = (form: HTMLFormElement, name: string, checked: boolean): void => {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLInputElement) el.checked = checked;
};

const optionalText = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed || undefined;
};

/** Prefill typed fields from legacy core fields when needed. */
export function hydrateCardFormState(card: InfoCard): CardFormState {
  const type = resolveCardType(card);
  const base: CardFormState = {
    ...emptyCardForm(type),
    ...card,
    cardType: type,
    profession: card.profession ?? [],
    industry: card.industry ?? [],
    locations: card.locations ?? [],
    exportLocations: card.exportLocations ?? [],
  };

  if (type === "individual") {
    if (!base.firstName && !base.lastName && card.title) {
      const parts = card.title.trim().split(/\s+/);
      base.firstName = parts[0] ?? "";
      base.lastName = parts.slice(1).join(" ");
    }
    if (!base.currLocation) base.currLocation = card.address || "";
    if (!base.logoUrl) base.logoUrl = card.imageUrl || "";
    if (!base.linkedin) base.linkedin = card.linkUrl || "";
    if (!base.email) base.email = "";
    return base;
  }

  if (!base.orgName) base.orgName = card.companyName || card.title || "";
  if (!base.nlLocation) base.nlLocation = card.address || "";
  if (!base.logoUrl) base.logoUrl = card.imageUrl || "";
  if (!base.websiteUrl) base.websiteUrl = card.linkUrl || "";
  if (!base.mainDescription && card.body) base.mainDescription = card.body;
  return base;
}

export function readCardForm(form: HTMLFormElement, current: CardFormState): CardFormState {
  const fd = new FormData(form);
  const cardType = resolveCardType(current);
  const next: CardFormState = {
    ...emptyCardForm(cardType),
    lat: current.lat,
    lng: current.lng,
    mapX: current.mapX,
    mapY: current.mapY,
    address: String(fd.get("address") || ""),
    active: fd.get("active") === "on",
    cardType,
    optInModeration: Boolean(current.optInModeration),
    optInNewsletter: Boolean(current.optInNewsletter),
  };

  if (cardType === "individual") {
    next.firstName = String(fd.get("firstName") || "").trim();
    next.lastName = String(fd.get("lastName") || "").trim();
    next.isTechNlMember = String(fd.get("isTechNlMember") || "").trim();
    next.pronouns = optionalText(String(fd.get("pronouns") || ""));
    next.profession = multiSelectValues(form, "profession");
    next.currLocation = String(fd.get("currLocation") || "").trim();
    next.origLocation = String(fd.get("origLocation") || "").trim();
    next.linkedin = optionalText(String(fd.get("linkedin") || ""));
    next.email = String(fd.get("email") || "").trim();
    next.nlDescription = optionalText(String(fd.get("nlDescription") || ""));
    next.whyDescription = optionalText(String(fd.get("whyDescription") || ""));
    next.dreamJob = optionalText(String(fd.get("dreamJob") || ""));
    next.story = optionalText(String(fd.get("story") || ""));
    next.logoUrl = optionalText(String(fd.get("logoUrl") || ""));
    return deriveCardDisplayFields(next);
  }

  next.submitterName = String(fd.get("submitterName") || "").trim();
  next.submitterEmail = String(fd.get("submitterEmail") || "").trim();
  next.orgName = String(fd.get("orgName") || "").trim();
  next.isTechNlMember = String(fd.get("isTechNlMemberOrg") || "").trim();
  next.industry = multiSelectValues(form, "industry");
  next.nlLocation = String(fd.get("nlLocation") || "").trim();
  next.locations = linesToList(fd.get("locations"));
  next.websiteUrl = optionalText(String(fd.get("websiteUrl") || ""));
  next.linkedinUrl = optionalText(String(fd.get("linkedinUrl") || ""));
  next.orgContactEmail = String(fd.get("orgContactEmail") || "").trim();
  const yearRaw = String(fd.get("yearEstablished") || "").trim();
  next.yearEstablished = yearRaw ? Number(yearRaw) : undefined;
  if (next.yearEstablished !== undefined && !Number.isFinite(next.yearEstablished)) {
    next.yearEstablished = undefined;
  }
  next.mainDescription = optionalText(String(fd.get("mainDescription") || ""));
  next.companyBio = optionalText(String(fd.get("companyBio") || ""));
  next.exportLocations = linesToList(fd.get("exportLocations"));
  next.stakeholderDescription = optionalText(String(fd.get("stakeholderDescription") || ""));
  next.storyDescription = optionalText(String(fd.get("storyDescription") || ""));
  next.logoUrl = optionalText(String(fd.get("logoUrlOrg") || ""));
  next.mediaOneUrl = optionalText(String(fd.get("mediaOneUrl") || ""));
  next.mediaTwoUrl = optionalText(String(fd.get("mediaTwoUrl") || ""));
  next.youtubeLink = optionalText(String(fd.get("youtubeLink") || ""));
  return deriveCardDisplayFields(next);
}

export function deriveCardDisplayFields(state: CardFormState): CardFormState {
  const cardType = resolveCardType(state);
  if (cardType === "individual") {
    const title = `${state.firstName ?? ""} ${state.lastName ?? ""}`.trim() || state.title;
    const body = buildIndividualBody({
      nlDescription: state.nlDescription,
      whyDescription: state.whyDescription,
      dreamJob: state.dreamJob,
      story: state.story,
    });
    return {
      ...state,
      cardType,
      title,
      companyName: "",
      body,
      imageUrl: state.logoUrl || state.imageUrl,
      linkUrl: state.linkedin || undefined,
    };
  }

  const orgName = (state.orgName || state.companyName || state.title || "").trim();
  const body = buildOrganizationBody({
    mainDescription: state.mainDescription,
    companyBio: state.companyBio,
    stakeholderDescription: state.stakeholderDescription,
    storyDescription: state.storyDescription,
  });
  return {
    ...state,
    cardType,
    title: orgName || state.title,
    companyName: orgName || undefined,
    orgName: orgName || state.orgName,
    body,
    imageUrl: state.logoUrl || state.imageUrl,
    linkUrl: state.websiteUrl || undefined,
  };
}

export function fillCardForm(form: HTMLFormElement, state: CardFormState): void {
  const cardType = resolveCardType(state);
  syncCardFormTypeFields(form, cardType);

  setInputValue(form, "address", state.address || "");
  setCheckbox(form, "active", Boolean(state.active));

  if (cardType === "individual") {
    setInputValue(form, "firstName", state.firstName || "");
    setInputValue(form, "lastName", state.lastName || "");
    setInputValue(form, "isTechNlMember", state.isTechNlMember || "");
    setInputValue(form, "pronouns", state.pronouns || "");
    setMultiSelectValues(form, "profession", state.profession);
    setInputValue(form, "currLocation", state.currLocation || "");
    setInputValue(form, "origLocation", state.origLocation || "");
    setInputValue(form, "linkedin", state.linkedin || "");
    setInputValue(form, "email", state.email || "");
    setInputValue(form, "nlDescription", state.nlDescription || "");
    setInputValue(form, "whyDescription", state.whyDescription || "");
    setInputValue(form, "dreamJob", state.dreamJob || "");
    setInputValue(form, "story", state.story || "");
    setCheckbox(form, "optInModeration", Boolean(state.optInModeration));
    setCheckbox(form, "optInNewsletter", Boolean(state.optInNewsletter));
    setInputValue(form, "logoUrl", state.logoUrl || state.imageUrl || "");
    return;
  }

  setInputValue(form, "submitterName", state.submitterName || "");
  setInputValue(form, "submitterEmail", state.submitterEmail || "");
  setInputValue(form, "orgName", state.orgName || state.companyName || state.title || "");
  setInputValue(form, "isTechNlMemberOrg", state.isTechNlMember || "");
  setMultiSelectValues(form, "industry", state.industry);
  setInputValue(form, "nlLocation", state.nlLocation || "");
  setInputValue(form, "locations", (state.locations ?? []).join("\n"));
  setInputValue(form, "websiteUrl", state.websiteUrl || state.linkUrl || "");
  setInputValue(form, "linkedinUrl", state.linkedinUrl || "");
  setInputValue(form, "orgContactEmail", state.orgContactEmail || "");
  setInputValue(
    form,
    "yearEstablished",
    state.yearEstablished != null && Number.isFinite(state.yearEstablished)
      ? String(state.yearEstablished)
      : ""
  );
  setInputValue(form, "mainDescription", state.mainDescription || "");
  setInputValue(form, "companyBio", state.companyBio || "");
  setInputValue(form, "exportLocations", (state.exportLocations ?? []).join("\n"));
  setInputValue(form, "stakeholderDescription", state.stakeholderDescription || "");
  setInputValue(form, "storyDescription", state.storyDescription || "");
  setCheckbox(form, "optInModerationOrg", Boolean(state.optInModeration));
  setCheckbox(form, "optInNewsletterOrg", Boolean(state.optInNewsletter));
  setInputValue(form, "logoUrlOrg", state.logoUrl || state.imageUrl || "");
  setInputValue(form, "mediaOneUrl", state.mediaOneUrl || "");
  setInputValue(form, "mediaTwoUrl", state.mediaTwoUrl || "");
  setInputValue(form, "youtubeLink", state.youtubeLink || "");
}
