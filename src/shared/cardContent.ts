import type { InfoCard } from "./types";

export type CardContentField =
  | "title"
  | "companyName"
  | "address"
  | "body"
  | "imageUrl"
  | "linkUrl";

export interface CardContentOptions {
  /** When true, fields include data-field hooks for admin inline editing. */
  editable?: boolean;
}

export function buildCardContentHtml(card: InfoCard, options: CardContentOptions = {}): string {
  const editable = options.editable === true;
  const fieldAttr = (field: CardContentField): string =>
    editable ? ` data-field="${field}"` : "";

  const company = card.companyName?.trim() ?? "";
  const address = card.address?.trim() ?? "";
  const imageUrl = card.imageUrl?.trim() ?? "";
  const linkUrl = card.linkUrl?.trim() ?? "";
  const body = card.body ?? "";

  const companyHtml =
    editable || company
      ? `<span class="ar-card__company"${fieldAttr("companyName")}${
          editable && !company ? ` data-placeholder="Add company"` : ""
        }>${escapeHtml(company)}</span>`
      : "";

  const addressHtml =
    editable || address
      ? `<span class="ar-card__address"${fieldAttr("address")}${
          editable && !address ? ` data-placeholder="Add address"` : ""
        }>${escapeHtml(address)}</span>`
      : "";

  const imageHtml =
    editable || imageUrl
      ? imageUrl
        ? `<img class="ar-card__image"${fieldAttr("imageUrl")} src="${escapeAttr(imageUrl)}" alt="" />`
        : `<button type="button" class="ar-card__image-placeholder"${fieldAttr(
            "imageUrl"
          )} data-placeholder="Add image URL">Add image</button>`
      : "";

  const linkHtml =
    editable || linkUrl
      ? linkUrl
        ? `<a class="ar-card__link"${fieldAttr("linkUrl")} href="${escapeAttr(
            linkUrl
          )}" target="_blank" rel="noopener noreferrer">Learn more</a>`
        : `<button type="button" class="ar-card__link ar-card__link--placeholder"${fieldAttr(
            "linkUrl"
          )} data-placeholder="Add link URL">Add link</button>`
      : "";

  return `
    <strong class="ar-card__title"${fieldAttr("title")}${
      editable && !card.title.trim() ? ` data-placeholder="Add title"` : ""
    }>${escapeHtml(card.title)}</strong>
    ${companyHtml}
    ${addressHtml}
    ${imageHtml}
    <p class="ar-card__body"${fieldAttr("body")}${
      editable && !body.trim() ? ` data-placeholder="Add story"` : ""
    }>${escapeHtml(body)}</p>
    ${linkHtml}
  `;
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
      const company = card.companyName?.trim() ?? "";
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
export function buildCardDetailWithBackHtml(
  card: InfoCard,
  options: CardContentOptions = {}
): string {
  return `
    <button type="button" class="ar-card__back" data-action="back-to-entries">Back</button>
    ${buildCardContentHtml(card, options)}
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
