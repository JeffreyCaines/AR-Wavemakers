import homeIconUrl from "../images/icon_home.png";
import searchIconUrl from "../images/icon_search.svg";
import searchCloseUrl from "../images/searchClose.svg";
import chevronIconUrl from "../images/icon_chevron.svg";
import placeButtonUrl from "../images/PlaceButton.svg";
import { INDUSTRIES, PROFESSIONS } from "../copy/options";
import { resolveCardType, type CardType, type InfoCard } from "../shared/types";

const CHECK_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><path d="M3 8.2L6.2 11.5L13 4.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)}`;

export type ArChromeCallbacks = {
  onCardTypeChange: (type: CardType) => void;
  onFiltersChange: () => void;
  onSelectCard: (card: InfoCard) => void;
  onHome: () => void;
  /** Present when reposition control is enabled (e.g. /8th-ar). */
  onReposition?: () => void;
  getCards: () => readonly InfoCard[];
};

export type ArChromeOptions = {
  /** Show PlaceButton reposition control (bottom-right). Default false. */
  showReposition?: boolean;
};

export type ArChromeController = {
  setVisible: (visible: boolean) => void;
  setCardType: (type: CardType) => void;
  getCardType: () => CardType;
  /** Returns cards after type + attribute filters (not search text). */
  filterCards: (cards: readonly InfoCard[]) => InfoCard[];
  closePanels: () => void;
  isPanelOpen: () => boolean;
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function cardDisplayName(card: InfoCard): string {
  if (resolveCardType(card) === "individual") {
    const name = [card.firstName, card.lastName].filter(Boolean).join(" ").trim();
    if (name) return name;
  }
  return card.orgName || card.companyName || card.title || "Untitled";
}

function cardMatchesQuery(card: InfoCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const haystack = [
    cardDisplayName(card),
    card.title,
    card.companyName,
    card.orgName,
    card.firstName,
    card.lastName,
    card.address,
    card.currLocation,
    card.nlLocation,
    ...(card.profession ?? []),
    ...(card.industry ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function cardMatchesSelectedTags(card: InfoCard, type: CardType, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  const tags = type === "individual" ? card.profession ?? [] : card.industry ?? [];
  return tags.some((tag) => selected.has(tag));
}

export function buildArChromeHtml(options: ArChromeOptions = {}): string {
  const reposition = options.showReposition
    ? `<button type="button" class="ar-chrome__reposition" data-chrome-reposition aria-label="Remove map">
        <img src="${placeButtonUrl}" alt="" width="50" height="50" decoding="async" />
      </button>`
    : "";

  return `
    <div class="ar-chrome" id="ar-chrome" hidden aria-hidden="true">
      <div class="ar-chrome__title" data-chrome-title>
        <div class="ar-chrome__search-field" data-chrome-search-field>
          <div class="ar-chrome__search-icons">
            <button type="button" class="ar-chrome__home" data-chrome-home aria-label="Home">
              <img src="${homeIconUrl}" alt="" width="14" height="14" decoding="async" />
            </button>
            <img class="ar-chrome__search-icon" src="${searchIconUrl}" alt="" width="14" height="14" decoding="async" />
          </div>
          <input
            type="search"
            data-chrome-search-input
            placeholder="Search person or organization"
            autocomplete="off"
            enterkeyhint="search"
          />
        </div>
        <div class="ar-chrome__filters-title" data-chrome-filters-title hidden>
          <button type="button" class="ar-chrome__title-btn ar-chrome__title-btn--left" data-chrome-clear hidden>
            Clear All
          </button>
          <p>Filters</p>
        </div>
        <button type="button" class="ar-chrome__title-btn ar-chrome__title-btn--right" data-chrome-filters-open>
          Filters
        </button>
        <button type="button" class="ar-chrome__title-btn ar-chrome__title-btn--right" data-chrome-close hidden aria-label="Close">
          <img src="${searchCloseUrl}" alt="" width="20" height="20" decoding="async" />
        </button>
      </div>

      <div class="ar-chrome__results" data-chrome-results hidden></div>

      <div class="ar-chrome__filter-screen" data-chrome-filter-screen hidden>
        <div class="ar-chrome__filters" data-chrome-filters></div>
        <button type="button" class="ar-chrome__view-items" data-chrome-view-items>VIEW 0 ITEMS</button>
      </div>

      <div class="ar-chrome__type-row" data-chrome-type-row role="tablist" aria-label="Card type">
        <button type="button" class="ar-chrome__type-btn ar-chrome__type-btn--active" role="tab" aria-selected="true" data-ar-card-type="organization">
          Organization
        </button>
        <button type="button" class="ar-chrome__type-btn" role="tab" aria-selected="false" data-ar-card-type="individual">
          People
        </button>
      </div>
      ${reposition}
    </div>
  `;
}

export function wireArChrome(root: ParentNode, callbacks: ArChromeCallbacks): ArChromeController {
  const chrome = root.querySelector("#ar-chrome") as HTMLElement;
  const searchField = root.querySelector("[data-chrome-search-field]") as HTMLElement;
  const filtersTitle = root.querySelector("[data-chrome-filters-title]") as HTMLElement;
  const searchInput = root.querySelector("[data-chrome-search-input]") as HTMLInputElement;
  const resultsEl = root.querySelector("[data-chrome-results]") as HTMLElement;
  const filterScreen = root.querySelector("[data-chrome-filter-screen]") as HTMLElement;
  const filtersEl = root.querySelector("[data-chrome-filters]") as HTMLElement;
  const typeRow = root.querySelector("[data-chrome-type-row]") as HTMLElement;
  const clearBtn = root.querySelector("[data-chrome-clear]") as HTMLButtonElement;
  const filtersOpenBtn = root.querySelector("[data-chrome-filters-open]") as HTMLButtonElement;
  const closeBtn = root.querySelector("[data-chrome-close]") as HTMLButtonElement;
  const viewItemsBtn = root.querySelector("[data-chrome-view-items]") as HTMLButtonElement;
  const typeButtons = root.querySelectorAll<HTMLButtonElement>("[data-ar-card-type]");

  let cardType: CardType = "organization";
  let searchActive = false;
  let filtersActive = false;
  const selectedTags = new Set<string>();
  const expandedFilters = new Set<string>();

  const filterCards = (cards: readonly InfoCard[]): InfoCard[] =>
    cards.filter(
      (card) =>
        resolveCardType(card) === cardType && cardMatchesSelectedTags(card, cardType, selectedTags)
    );

  const setVisible = (visible: boolean): void => {
    chrome.hidden = !visible;
    chrome.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible) closePanels();
  };

  const syncTitleMode = (): void => {
    const panelOpen = searchActive || filtersActive;
    searchField.hidden = filtersActive;
    filtersTitle.hidden = !filtersActive;
    filtersOpenBtn.hidden = panelOpen;
    closeBtn.hidden = !panelOpen;
    clearBtn.hidden = !(filtersActive && selectedTags.size > 0);
    typeRow.hidden = filtersActive;
    if (filtersActive) {
      filtersOpenBtn.innerHTML = "";
    } else if (selectedTags.size > 0) {
      filtersOpenBtn.innerHTML = `Filters<span class="ar-chrome__filter-count">${selectedTags.size}</span>`;
    } else {
      filtersOpenBtn.textContent = "Filters";
    }
  };

  const renderResults = (): void => {
    const query = searchInput.value;
    searchActive = query.trim().length > 0;
    resultsEl.hidden = !searchActive || filtersActive;
    if (!searchActive || filtersActive) {
      resultsEl.innerHTML = "";
      syncTitleMode();
      return;
    }

    const matches = filterCards(callbacks.getCards()).filter((card) => cardMatchesQuery(card, query));
    if (matches.length === 0) {
      resultsEl.innerHTML = `<div class="ar-chrome__result"><p>No Results</p></div>`;
    } else {
      resultsEl.innerHTML = matches
        .slice(0, 40)
        .map(
          (card) =>
            `<button type="button" class="ar-chrome__result" data-chrome-result-id="${card.id}">
              <p>${escapeHtml(cardDisplayName(card))}</p>
            </button>`
        )
        .join("");
      resultsEl.querySelectorAll<HTMLButtonElement>("[data-chrome-result-id]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          const id = btn.dataset.chromeResultId;
          const card = callbacks.getCards().find((entry) => entry.id === id);
          if (!card) return;
          closePanels();
          searchInput.value = "";
          callbacks.onSelectCard(card);
        });
      });
    }
    syncTitleMode();
  };

  const renderFilters = (): void => {
    const groupKey = cardType === "individual" ? "profession" : "industry";
    const groupLabel = cardType === "individual" ? "Profession" : "Industry";
    const options = cardType === "individual" ? PROFESSIONS : INDUSTRIES;
    const expanded = expandedFilters.has(groupKey);
    filtersEl.innerHTML = `
      <button type="button" class="ar-chrome__filter-type${expanded ? " ar-chrome__filter-type--active" : ""}" data-chrome-filter-group="${groupKey}">
        ${groupLabel}
        <img class="ar-chrome__filter-chevron" src="${chevronIconUrl}" alt="" width="15" height="8" decoding="async" />
      </button>
      <div class="ar-chrome__filter-props${expanded ? " ar-chrome__filter-props--active" : ""}" data-chrome-filter-props>
        ${options
          .map((option) => {
            const active = selectedTags.has(option);
            return `<button type="button" class="ar-chrome__filter-prop" data-chrome-filter-tag="${escapeHtml(option)}">
              <span class="ar-chrome__filter-check${active ? " ar-chrome__filter-check--active" : ""}">
                ${active ? `<img src="${CHECK_SVG}" alt="" width="14" height="14" decoding="async" />` : ""}
              </span>
              <p>${escapeHtml(titleCase(option))}</p>
            </button>`;
          })
          .join("")}
      </div>
    `;

    filtersEl.querySelector<HTMLButtonElement>("[data-chrome-filter-group]")?.addEventListener("click", () => {
      if (expandedFilters.has(groupKey)) expandedFilters.delete(groupKey);
      else expandedFilters.add(groupKey);
      renderFilters();
    });

    filtersEl.querySelectorAll<HTMLButtonElement>("[data-chrome-filter-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tag = btn.dataset.chromeFilterTag;
        if (!tag) return;
        if (selectedTags.has(tag)) selectedTags.delete(tag);
        else selectedTags.add(tag);
        renderFilters();
        updateViewItemsCount();
        syncTitleMode();
        callbacks.onFiltersChange();
      });
    });

    updateViewItemsCount();
  };

  const updateViewItemsCount = (): void => {
    const count = filterCards(callbacks.getCards()).length;
    viewItemsBtn.textContent = `VIEW ${count} ITEMS`;
  };

  const openFilters = (): void => {
    filtersActive = true;
    searchActive = false;
    resultsEl.hidden = true;
    filterScreen.hidden = false;
    expandedFilters.clear();
    expandedFilters.add(cardType === "individual" ? "profession" : "industry");
    renderFilters();
    syncTitleMode();
  };

  const closePanels = (): void => {
    filtersActive = false;
    searchActive = false;
    filterScreen.hidden = true;
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    searchInput.value = "";
    syncTitleMode();
  };

  const setCardType = (type: CardType): void => {
    cardType = type;
    selectedTags.clear();
    typeButtons.forEach((button) => {
      const selected = button.dataset.arCardType === type;
      button.classList.toggle("ar-chrome__type-btn--active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    if (filtersActive) renderFilters();
    else syncTitleMode();
  };

  typeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.arCardType;
      if (type !== "individual" && type !== "organization") return;
      if (type === cardType) return;
      setCardType(type);
      callbacks.onCardTypeChange(type);
    });
  });

  root.querySelector("[data-chrome-home]")?.addEventListener("click", () => {
    callbacks.onHome();
  });

  root.querySelector("[data-chrome-reposition]")?.addEventListener("click", () => {
    callbacks.onReposition?.();
  });

  filtersOpenBtn.addEventListener("click", openFilters);
  closeBtn.addEventListener("click", closePanels);
  clearBtn.addEventListener("click", () => {
    selectedTags.clear();
    renderFilters();
    syncTitleMode();
    callbacks.onFiltersChange();
  });
  viewItemsBtn.addEventListener("click", closePanels);

  searchInput.addEventListener("input", renderResults);
  searchInput.addEventListener("focus", renderResults);
  resultsEl.addEventListener("click", () => {
    closePanels();
  });

  syncTitleMode();

  return {
    setVisible,
    setCardType,
    getCardType: () => cardType,
    filterCards,
    closePanels,
    isPanelOpen: () => searchActive || filtersActive,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
