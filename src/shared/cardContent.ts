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

/** Compact hover preview. Omits description and other long story fields. */
export function buildCardPreviewHtml(card: InfoCard): string {
  if (resolveCardType(card) === "individual" && hasIndividualDetails(card)) {
    return buildIndividualPreviewHtml(card);
  }
  if (resolveCardType(card) === "organization" && hasOrganizationDetails(card)) {
    return buildOrganizationPreviewHtml(card);
  }
  return buildLegacyPreviewHtml(card);
}

function buildLegacyPreviewHtml(card: InfoCard): string {
  const company = card.companyName?.trim() ?? "";
  const address = card.address?.trim() ?? "";
  const imageUrl = safeHref(card.imageUrl ?? "");
  const linkUrl = safeHref(card.linkUrl ?? "");

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
    <article class="ar-card__detail ar-card__detail--preview">
      <strong class="ar-card__title">${escapeHtml(card.title)}</strong>
      ${companyHtml}
      ${addressHtml}
      ${imageHtml}
      ${linkHtml}
    </article>
  `;
}

function buildLegacyCardHtml(card: InfoCard): string {
  const company = card.companyName?.trim() ?? "";
  const address = card.address?.trim() ?? "";
  const imageUrl = safeHref(card.imageUrl ?? "");
  const linkUrl = safeHref(card.linkUrl ?? "");
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

function buildOrganizationPreviewHtml(card: InfoCard): string {
  const orgName = card.orgName?.trim() || card.companyName?.trim() || card.title;
  const logoUrl = safeHref((card.logoUrl || card.imageUrl) ?? "");
  const fields = [
    textField("Industry", joinList(card.industry)),
    textField("Head office location", card.nlLocation || card.address),
  ]
    .filter(Boolean)
    .join("");

  return `
    <article class="ar-card__detail ar-card__detail--preview">
      <strong class="ar-card__title">${escapeHtml(orgName)}</strong>
      ${logoUrl ? `<img class="ar-card__image" src="${escapeAttr(logoUrl)}" alt="" />` : ""}
      ${fields ? `<dl class="ar-card__fields">${fields}</dl>` : ""}
    </article>
  `;
}

function buildIndividualCardHtml(card: InfoCard): string {
  const photoUrl = safeHref((card.logoUrl || card.imageUrl) ?? "");
  const fields = [
    textField("Pronouns", card.pronouns),
    textField("Are you or your organization a techNL member?", card.isTechNlMember),
    textField("Profession / Field of Study", joinList(card.profession)),
    textField("Where do you currently live?", card.currLocation || card.address),
    textField("Where were you born or do you consider home?", card.origLocation),
    linkField("LinkedIn", card.linkedin),
    textField(
      "What do you love most about working (or studying), or living in Newfoundland and Labrador (NL)?",
      card.nlDescription,
      { wide: true }
    ),
    textField("Why I choose to work (or study) in the NL tech sector?", card.whyDescription, {
      wide: true,
    }),
    textField(
      "What is your tech-related dream job? Maybe you already have your dream job, if so, what is it and what do you love most about it?",
      card.dreamJob,
      { wide: true }
    ),
    textField(
      "Do you have a tech project or success story that you’d like to share with techNL, something that you’ve worked on, are especially proud of, or excited about? Tell us your story",
      card.story,
      { wide: true }
    ),
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
      ${fields ? `<dl class="ar-card__fields">${fields}</dl>` : ""}
    </article>
  `;
}

function buildOrganizationCardHtml(card: InfoCard): string {
  const orgName = card.orgName?.trim() || card.companyName?.trim() || card.title;
  const logoUrl = safeHref((card.logoUrl || card.imageUrl) ?? "");
  const fields = [
    textField("Are you or your organization a techNL member?", card.isTechNlMember),
    textField("Industry", joinList(card.industry)),
    textField("Head office location", card.nlLocation || card.address),
    textField("Where does your organization conduct business?", joinList(card.locations, "; ")),
    linkField("Website", card.websiteUrl || card.linkUrl),
    linkField("LinkedIn", card.linkedinUrl),
    emailField("Organization's General Inquires Email", card.orgContactEmail),
    textField(
      "Year established",
      card.yearEstablished != null ? String(card.yearEstablished) : undefined
    ),
    textField("Description", card.mainDescription, { wide: true }),
    textField("Company Bio", card.companyBio, { wide: true }),
    imageField("Media", card.mediaOneUrl),
    imageField("Media", card.mediaTwoUrl),
    linkField("YouTube", card.youtubeLink),
    textField(
      "Does your organization export its technology, products, or services outside of NL? If so, where?",
      joinList(card.exportLocations, "; ")
    ),
    textField(
      "How do/would you describe the NL tech sector stakeholders who live outside the province?",
      card.stakeholderDescription,
      { wide: true }
    ),
    textField(
      "Share a tech-related success story that demonstrates your NL-based organization's impact, whether within Newfoundland and Labrador or beyond? If applicable, please include the country, province, or state connected to your story.",
      card.storyDescription,
      { wide: true }
    ),
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
      ${fields ? `<dl class="ar-card__fields">${fields}</dl>` : ""}
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

function textField(
  label: string,
  value: string | undefined | null,
  options?: { wide?: boolean }
): string {
  const text = value?.trim();
  if (!text) return "";
  const wideClass = options?.wide ? " ar-card__field--wide" : "";
  return `
    <div class="ar-card__field${wideClass}">
      <dt class="ar-card__field-label">${escapeHtml(label)}</dt>
      <dd class="ar-card__field-value">${escapeHtml(text)}</dd>
    </div>`;
}

function emailField(label: string, email: string | undefined | null): string {
  const text = email?.trim();
  if (!text) return "";
  const href = safeHref(`mailto:${text}`);
  if (!href) return "";
  return `
    <div class="ar-card__field">
      <dt class="ar-card__field-label">${escapeHtml(label)}</dt>
      <dd class="ar-card__field-value ar-card__field-value--link"><a class="ar-card__link" href="${escapeAttr(href)}">${escapeHtml(text)}</a></dd>
    </div>`;
}

function linkField(label: string, url: string | undefined | null): string {
  const href = safeHref(url ?? "");
  if (!href) return "";
  return `
    <div class="ar-card__field">
      <dt class="ar-card__field-label">${escapeHtml(label)}</dt>
      <dd class="ar-card__field-value ar-card__field-value--link"><a class="ar-card__link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a></dd>
    </div>`;
}

function imageField(label: string, url: string | undefined | null): string {
  const href = safeHref(url ?? "");
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

/**
 * Scheme allowlist for anything that ends up in an href or src. Escaping alone
 * does not stop `javascript:` or `data:` URLs stored on a card before the server
 * started validating them.
 */
export function safeHref(value: string): string {
  const url = value.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url)) return url;
  if (url.startsWith("/api/uploads/")) return url;
  return "";
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
