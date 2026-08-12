import { resolveCardType, type InfoCard } from "./types";

/** Full card details (sheet / expanded view). */
export function buildCardContentHtml(card: InfoCard): string {
  if (resolveCardType(card) === "individual" && hasIndividualDetails(card)) {
    return buildIndividualCardHtml(card);
  }
  if (resolveCardType(card) === "organization" && hasOrganizationDetails(card)) {
    return buildOrganizationCardHtml(card);
  }
  return buildLegacyCardHtml(card);
}

/** Compact hover preview. Individuals show name, profession, hometown only. */
export function buildCardPreviewHtml(card: InfoCard): string {
  if (resolveCardType(card) === "individual" && hasIndividualDetails(card)) {
    return buildIndividualPreviewHtml(card);
  }
  return buildCardContentHtml(card);
}

function buildLegacyCardHtml(card: InfoCard): string {
  const company = card.companyName?.trim() ?? "";
  const address = card.address?.trim() ?? "";
  const imageUrl = card.imageUrl?.trim() ?? "";
  const linkUrl = card.linkUrl?.trim() ?? "";
  const body = card.body ?? "";

  const companyHtml = company
    ? `<span class="ar-card__company">${escapeHtml(company)}</span>`
    : "";

  const addressHtml = address
    ? `<span class="ar-card__address">${escapeHtml(address)}</span>`
    : "";

  const imageHtml = imageUrl
    ? `<img class="ar-card__image" src="${escapeAttr(imageUrl)}" alt="" />`
    : "";

  const linkHtml = linkUrl
    ? `<a class="ar-card__link" href="${escapeAttr(
        linkUrl
      )}" target="_blank" rel="noopener noreferrer">Learn more</a>`
    : "";

  return `
    <article class="ar-card__detail">
      <strong class="ar-card__title">${escapeHtml(card.title)}</strong>
      ${companyHtml}
      ${addressHtml}
      ${imageHtml}
      ${body ? `<p class="ar-card__body">${escapeHtml(body)}</p>` : ""}
      ${linkHtml}
    </article>
  `;
}

function individualDisplayName(card: InfoCard): string {
  return [card.firstName, card.lastName].filter(Boolean).join(" ").trim() || card.title;
}

function buildIndividualPreviewHtml(card: InfoCard): string {
  const fields = [
    textField("Profession", joinList(card.profession)),
    textField("Hometown", card.origLocation),
  ]
    .filter(Boolean)
    .join("");

  return `
    <article class="ar-card__detail ar-card__detail--preview">
      <strong class="ar-card__title">${escapeHtml(individualDisplayName(card))}</strong>
      <dl class="ar-card__fields">${fields}</dl>
    </article>
  `;
}

function buildIndividualCardHtml(card: InfoCard): string {
  const photoUrl = (card.logoUrl || card.imageUrl)?.trim() ?? "";
  const fields = [
    textField("Pronouns", card.pronouns),
    textField("techNL member", card.isTechNlMember),
    textField("Profession", joinList(card.profession)),
    textField("Current location", card.currLocation || card.address),
    textField("Hometown", card.origLocation),
    emailField("Email", card.email),
    linkField("LinkedIn", card.linkedin),
    textField("What I love about NL", card.nlDescription),
    textField("Why I choose NL tech", card.whyDescription),
    textField("Tech-related dream job", card.dreamJob),
    textField("Success story", card.story),
    textField("Newsletter opt-in", boolLabel(card.optInNewsletter)),
    textField("Consent to share", boolLabel(card.optInModeration)),
  ]
    .filter(Boolean)
    .join("");

  return `
    <article class="ar-card__detail">
      <strong class="ar-card__title">${escapeHtml(individualDisplayName(card))}</strong>
      ${
        photoUrl
          ? `<img class="ar-card__image" src="${escapeAttr(photoUrl)}" alt="" />`
          : ""
      }
      <dl class="ar-card__fields">${fields}</dl>
    </article>
  `;
}

function buildOrganizationCardHtml(card: InfoCard): string {
  const orgName = card.orgName?.trim() || card.companyName?.trim() || card.title;
  const logoUrl = (card.logoUrl || card.imageUrl)?.trim() ?? "";
  const fields = [
    textField("Submitter", card.submitterName),
    emailField("Submitter email", card.submitterEmail),
    emailField("Organization email", card.orgContactEmail),
    textField("techNL member", card.isTechNlMember),
    textField("Industry", joinList(card.industry)),
    textField("Head office", card.nlLocation || card.address),
    textField("Business locations", joinList(card.locations, "; ")),
    textField("Export locations", joinList(card.exportLocations, "; ")),
    textField(
      "Year established",
      card.yearEstablished != null ? String(card.yearEstablished) : undefined
    ),
    textField("Description", card.mainDescription),
    textField("Company bio", card.companyBio),
    textField("Stakeholders outside NL", card.stakeholderDescription),
    textField("Success story", card.storyDescription),
    linkField("Website", card.websiteUrl || card.linkUrl),
    linkField("LinkedIn", card.linkedinUrl),
    linkField("YouTube", card.youtubeLink),
    imageField("Media 1", card.mediaOneUrl),
    imageField("Media 2", card.mediaTwoUrl),
    textField("Newsletter opt-in", boolLabel(card.optInNewsletter)),
    textField("Consent to share", boolLabel(card.optInModeration)),
  ]
    .filter(Boolean)
    .join("");

  return `
    <article class="ar-card__detail">
      <strong class="ar-card__title">${escapeHtml(orgName)}</strong>
      ${
        logoUrl
          ? `<img class="ar-card__image" src="${escapeAttr(logoUrl)}" alt="" />`
          : ""
      }
      <dl class="ar-card__fields">${fields}</dl>
    </article>
  `;
}

function hasIndividualDetails(card: InfoCard): boolean {
  return Boolean(
    card.firstName ||
      card.lastName ||
      card.profession?.length ||
      card.nlDescription ||
      card.whyDescription ||
      card.dreamJob ||
      card.story
  );
}

function hasOrganizationDetails(card: InfoCard): boolean {
  return Boolean(
    card.orgName ||
      card.industry?.length ||
      card.mainDescription ||
      card.companyBio ||
      card.storyDescription ||
      card.stakeholderDescription ||
      card.websiteUrl ||
      card.mediaOneUrl ||
      card.mediaTwoUrl
  );
}

function textField(label: string, value: string | undefined | null): string {
  const text = value?.trim();
  if (!text) return "";
  return `
    <div class="ar-card__field">
      <dt class="ar-card__field-label">${escapeHtml(label)}</dt>
      <dd class="ar-card__field-value">${escapeHtml(text)}</dd>
    </div>`;
}

function emailField(label: string, email: string | undefined | null): string {
  const text = email?.trim();
  if (!text) return "";
  return `
    <div class="ar-card__field">
      <dt class="ar-card__field-label">${escapeHtml(label)}</dt>
      <dd class="ar-card__field-value">
        <a class="ar-card__link" href="mailto:${escapeAttr(text)}">${escapeHtml(text)}</a>
      </dd>
    </div>`;
}

function linkField(label: string, url: string | undefined | null): string {
  const href = url?.trim();
  if (!href) return "";
  return `
    <div class="ar-card__field">
      <dt class="ar-card__field-label">${escapeHtml(label)}</dt>
      <dd class="ar-card__field-value">
        <a class="ar-card__link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>
      </dd>
    </div>`;
}

function imageField(label: string, url: string | undefined | null): string {
  const href = url?.trim();
  if (!href) return "";
  return `
    <div class="ar-card__field ar-card__field--image">
      <dt class="ar-card__field-label">${escapeHtml(label)}</dt>
      <dd class="ar-card__field-value">
        <img class="ar-card__image" src="${escapeAttr(href)}" alt="" />
      </dd>
    </div>`;
}

function joinList(values: string[] | undefined, separator = ", "): string | undefined {
  if (!values?.length) return undefined;
  const text = values.map((value) => value.trim()).filter(Boolean).join(separator);
  return text || undefined;
}

function boolLabel(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? "Yes" : "No";
}

export interface LocationEntryMenuOptions {
  /** Optional heading above the list (e.g. "3 stories"). */
  heading?: string;
  /** When true, include a Back control above the card detail (unused here; for callers). */
  showBack?: boolean;
}

/** Scrollable list of entries at one map location. Buttons use data-card-id. */
export function buildLocationEntryMenuHtml(
  cards: InfoCard[],
  options: LocationEntryMenuOptions = {}
): string {
  const heading =
    options.heading ??
    (cards.length === 1 ? "1 story" : `${cards.length} stories`);

  const items = cards
    .map((card) => {
      const company = card.companyName?.trim() || card.orgName?.trim() || "";
      const companyHtml = company
        ? `<span class="ar-card__entry-company">${escapeHtml(company)}</span>`
        : "";
      return `
        <button type="button" class="ar-card__entry" data-card-id="${escapeAttr(card.id)}">
          <strong class="ar-card__entry-title">${escapeHtml(card.title || "Untitled")}</strong>
          ${companyHtml}
        </button>
      `;
    })
    .join("");

  return `
    <div class="ar-card__entry-menu">
      <p class="ar-card__entry-heading">${escapeHtml(heading)}</p>
      <div class="ar-card__entry-list">${items}</div>
    </div>
  `;
}

/** Card detail with a Back control to return to a multi-entry menu. */
export function buildCardDetailWithBackHtml(card: InfoCard): string {
  return `
    <button type="button" class="ar-card__back" data-action="back-to-entries">Back</button>
    ${buildCardContentHtml(card)}
  `;
}

/** Compact preview with a Back control (hover / pin popup). */
export function buildCardPreviewWithBackHtml(card: InfoCard): string {
  return `
    <button type="button" class="ar-card__back" data-action="back-to-entries">Back</button>
    ${buildCardPreviewHtml(card)}
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
