import type { InfoCard } from "./types";

export function buildCardContentHtml(card: InfoCard): string {
  return `
    <strong class="ar-card__title">${escapeHtml(card.title)}</strong>
    ${card.companyName ? `<span class="ar-card__company">${escapeHtml(card.companyName)}</span>` : ""}
    ${card.address ? `<span class="ar-card__address">${escapeHtml(card.address)}</span>` : ""}
    ${card.imageUrl ? `<img class="ar-card__image" src="${escapeAttr(card.imageUrl)}" alt="" />` : ""}
    <p class="ar-card__body">${escapeHtml(card.body)}</p>
    ${card.linkUrl ? `<a class="ar-card__link" href="${escapeAttr(card.linkUrl)}" target="_blank" rel="noopener noreferrer">Learn more</a>` : ""}
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
