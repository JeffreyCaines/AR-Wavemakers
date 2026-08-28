import "./styles.css";
import techNlLogoUrl from "../images/TechNL-Logo_Black.webp";
import {
  approveSubmission,
  createCard,
  deleteCard,
  fetchAdminMe,
  fetchAllCards,
  fetchCalibration,
  fetchRipplesAnchor,
  fetchSubmissions,
  geocodeAddress,
  getAdminToken,
  logoutAdmin,
  rejectSubmission,
  updateCard,
} from "../shared/api";
import type { AdminRole } from "../shared/adminAuth";
import { buildProjection, mapXYAdminToOriginal, mapXYOriginalToAdmin, projectLatLng, type Projection } from "../shared/geo";
import {
  findGroupForCardId,
  findMatchingPin,
  groupCardsByLocation,
  locationKey,
} from "../shared/locationGroups";
import type {
  CalibrationPoint,
  CardType,
  GeocodeResult,
  InfoCard,
  RipplesAnchor,
  StorySubmission,
} from "../shared/types";
import { MAP_ADMIN_CROP, MAP_ADMIN_REFERENCE_PATH } from "../shared/types";
import { safeHref } from "../shared/cardContent";
import {
  isIndividualSubmission,
  isOrganizationSubmission,
  submissionTypeLabel,
} from "../shared/sanitizeGetNoticed";
import { fitCanvasMainPanel, resetCanvasMainPanel } from "./canvasLayout";
import {
  cardFormFieldsHtml,
  emptyCardForm,
  fillCardForm,
  hydrateCardFormState,
  readCardForm,
  syncCardFormTypeFields,
  type CardFormState,
} from "./cardForm";
import { createCalibrationPanel } from "./calibrationPanel";
import { accountsSectionHtml, createAdminDialogHtml, deleteAccountDialogHtml, resetPasswordDialogHtml, setupAccountsPanel } from "./accountsPanel";
import { changePasswordDialogHtml, setupChangePasswordDialog } from "./changePasswordDialog";
import { renderAdminLogin } from "./login";
import { createMapEditor, type MapEditorBackdrop } from "./mapEditor";

type FormState = CardFormState;

export interface AdminDashboardOptions {
  /** `model3d` swaps the reference JPEG for a top-down AR map mesh. */
  backdrop?: MapEditorBackdrop;
  title?: string;
  subtitle?: string;
}

function renderAdminSiteFooter(): string {
  return `
    <footer class="admin-site-footer" aria-label="Site footer">
      <div class="admin-site-footer__bar">
        <p>&copy; ${new Date().getFullYear()} techNL</p>
      </div>
    </footer>
  `;
}

const resolveCardType = (card: Pick<InfoCard, "cardType">): CardType =>
  card.cardType === "individual" ? "individual" : "organization";

const resolveSubmissionCardType = (submission: Pick<StorySubmission, "submissionType">): CardType =>
  submission.submissionType === "individual" ? "individual" : "organization";

const emptyForm = (cardType: CardType = "organization"): FormState => emptyCardForm(cardType);

export function initAdminDashboard(root: HTMLElement, options: AdminDashboardOptions = {}): void {
  const backdrop = options.backdrop ?? "image";
  const title = options.title ?? "Admin Dashboard";
  const subtitle = options.subtitle ?? "Sign in with your admin email and password to manage info cards.";

  const enterDashboard = (): void => {
    void (async () => {
      try {
        const me = await fetchAdminMe();
        if (me.mustChangePassword) {
          renderAdminLogin(root, {
            title,
            subtitle: "Create a new password to finish signing in.",
            mode: "change-password",
            email: me.email,
            onSuccess: enterDashboard,
          });
          return;
        }
        renderDashboard(root, { backdrop, title, subtitle, role: me.role, email: me.email });
      } catch {
        await logoutAdmin();
        renderAdminLogin(root, {
          title,
          subtitle,
          onSuccess: enterDashboard,
        });
      }
    })();
  };

  if (!getAdminToken()) {
    renderAdminLogin(root, {
      title,
      subtitle,
      onSuccess: enterDashboard,
    });
    return;
  }

  enterDashboard();
}

function renderDashboard(
  root: HTMLElement,
  options: { backdrop: MapEditorBackdrop; title: string; subtitle: string; role: AdminRole; email: string }
): void {
  const { backdrop, title, subtitle, role, email } = options;
  const isProjectAdmin = role === "project_admin";
  document.title = `${title} · Wavemakers`;
  root.innerHTML = `
    <div class="admin">
      <header class="admin-header">
        <div class="admin-header__brand logo_container">
          <a href="https://technl.ca/">
            <span class="logo_helper" aria-hidden="true"></span>
            <img src="${techNlLogoUrl}" alt="techNL" class="admin-header__logo" width="1080" height="424" decoding="async" />
          </a>
        </div>
        <nav class="admin-header__nav" aria-label="Dashboard sections">
          <button type="button" id="edit-cards-toggle-btn" class="admin-btn admin-btn--ghost" aria-expanded="false">Edit Cards</button>
          <button type="button" id="calibrate-toggle-btn" class="admin-btn admin-btn--ghost" aria-expanded="false">Calibrate Map</button>
          <button type="button" id="submissions-toggle-btn" class="admin-btn admin-btn--ghost" aria-expanded="false">
            Review Submissions <span id="submission-toggle-badge" class="admin-badge" hidden>0</span>
          </button>
          <button type="button" id="accounts-toggle-btn" class="admin-btn admin-btn--ghost" aria-expanded="false">${
            isProjectAdmin ? "Accounts" : "Account"
          }</button>
        </nav>
        <div class="admin-header__menu">
          <button
            type="button"
            id="admin-header-menu-btn"
            class="admin-header__menu-toggle"
            aria-expanded="false"
            aria-controls="admin-header-actions"
            aria-label="Open menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="admin-header__menu-icon admin-header__menu-icon--list" viewBox="0 0 16 16" aria-hidden="true">
              <path fill-rule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5"/>
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="admin-header__menu-icon admin-header__menu-icon--close" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
            </svg>
          </button>
          <div id="admin-header-actions" class="admin-header__actions">
            <a href="/ar" id="admin-ar-viewer-link" class="admin-link" target="_blank" rel="noopener noreferrer">Open AR Viewer</a>
            <a href="/admin-manual.html" class="admin-link" target="_blank" rel="noopener noreferrer">User Manual</a>
          </div>
        </div>
      </header>
      <div id="admin-toast" class="admin-toast" role="status" aria-live="polite" hidden></div>
      <div class="admin-layout">
        <section id="edit-cards-section" class="admin-canvas" hidden aria-label="Edit cards">
          <div class="admin-canvas__workspace">
            <div class="admin-canvas__row">
              <div id="map-editor-host" class="admin-canvas__map"></div>
              <aside class="admin-canvas__cards" aria-label="Cards and editor">
                <div class="admin-canvas__cards-inner">
                  <div id="cards-shelf-view" class="admin-canvas__cards-view">
                    <div class="admin-canvas__cards-toolbar">
                      <h2>Cards</h2>
                    </div>
                    <div class="admin-form__tabs cards-type-tabs" role="tablist" aria-label="Card type">
                      <button type="button" class="admin-form__tab admin-form__tab--active" role="tab" aria-selected="true" data-cards-tab="individual">
                        Individuals
                      </button>
                      <button type="button" class="admin-form__tab" role="tab" aria-selected="false" data-cards-tab="organization">
                        Organizations
                      </button>
                    </div>
                    <div class="admin-scroll admin-canvas__cards-body admin-list-scroll">
                      <ul id="card-list" class="admin-card-list"></ul>
                    </div>
                    <div class="submission-sidebar__footer">
                      <div class="submission-sidebar__actions">
                        <button type="button" id="new-card-btn" class="admin-btn--pill">New card</button>
                      </div>
                    </div>
                  </div>
                  <div id="edit-shelf-view" class="admin-canvas__cards-view" hidden>
                    <div class="admin-canvas__cards-toolbar">
                      <h2 id="form-title">Edit card</h2>
                      <button type="button" id="edit-shelf-back" class="admin-canvas__cards-back" aria-label="Back to cards">×</button>
                    </div>
                    <form id="card-form" class="admin-form admin-form--edit" novalidate>
                      ${cardFormFieldsHtml()}
                      <div class="submission-sidebar__footer">
                        <div class="submission-sidebar__actions">
                          <button type="submit" class="admin-btn--pill">Save</button>
                          <button type="button" id="delete-btn" class="admin-btn--pill admin-btn--pill--purple" disabled>Delete</button>
                          <button type="button" id="add-entry-btn" class="admin-btn--pill submission-sidebar__actions-full" disabled>Add entry to this pin</button>
                        </div>
                        <p id="form-error" class="admin-error" hidden></p>
                      </div>
                    </form>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>
        <section id="calibrate-section" class="admin-canvas" hidden aria-label="Calibrate map">
          <div class="admin-canvas__workspace">
            <div class="admin-canvas__row">
              <div id="calibration-map-host" class="admin-canvas__map"></div>
              <aside class="admin-canvas__cards" aria-label="Calibration">
                <div class="admin-canvas__cards-inner">
                  <div class="admin-canvas__cards-view">
                    <div class="admin-canvas__cards-toolbar admin-canvas__cards-toolbar--split">
                      <h2>Map calibration</h2>
                      <div class="calibration-info">
                        <button
                          type="button"
                          id="calibration-info-btn"
                          class="calibration-info__btn"
                          aria-label="Calibration fit info"
                          aria-expanded="false"
                          aria-controls="calibration-info-tip"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-info-circle" viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                            <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
                          </svg>
                        </button>
                        <p id="calibration-info-tip" class="calibration-info__tip" role="tooltip" hidden></p>
                      </div>
                    </div>
                    <div id="calibration-side-host" class="calibration-side admin-form admin-form--edit"></div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>
        <section id="submissions-section" class="admin-canvas" hidden aria-label="Review submissions">
          <div class="admin-canvas__workspace">
            <div class="admin-canvas__row">
              <div class="admin-canvas__detail admin-canvas__map">
                <div class="submissions-detail__backdrop" aria-hidden="true">
                  ${
                    backdrop === "model3d"
                      ? `<div id="submissions-map-host" class="submissions-detail__map-host"></div>`
                      : `<img
                    class="submissions-detail__map submissions-detail__map--base"
                    src="${MAP_ADMIN_REFERENCE_PATH}"
                    alt=""
                    decoding="async"
                    draggable="false"
                  />
                  <img
                    class="submissions-detail__map submissions-detail__map--blur"
                    src="${MAP_ADMIN_REFERENCE_PATH}"
                    alt=""
                    decoding="async"
                    draggable="false"
                  />`
                  }
                </div>
                <div class="submissions-detail__frost">
                  <div class="admin-canvas__cards-inner">
                    <div class="admin-canvas__cards-view">
                      <button type="button" class="submission-detail__back" data-submission-back aria-label="Back to pending submissions">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                        </svg>
                      </button>
                      <div id="submission-detail-host" class="admin-scroll admin-canvas__cards-body"></div>
                      <div class="submission-detail__mobile-actions">
                        <div class="submission-sidebar__actions">
                          <button type="button" class="admin-btn--pill" data-submission-approve>Approve</button>
                          <button type="button" class="admin-btn--pill admin-btn--pill--purple" data-submission-reject>Reject</button>
                        </div>
                        <p class="admin-error" data-submission-mobile-error hidden></p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <aside class="admin-canvas__cards" id="submissions-sidebar-panel" aria-label="Pending submissions">
                <div class="admin-canvas__cards-inner">
                  <div class="admin-canvas__cards-view">
                    <div class="admin-canvas__cards-toolbar">
                      <h2>Pending submissions <span id="submission-count" class="admin-badge" hidden>0</span></h2>
                    </div>
                    <div class="admin-form__tabs cards-type-tabs" role="tablist" aria-label="Submission type">
                      <button type="button" class="admin-form__tab admin-form__tab--active" role="tab" aria-selected="true" data-submissions-tab="individual">
                        Individuals
                      </button>
                      <button type="button" class="admin-form__tab" role="tab" aria-selected="false" data-submissions-tab="organization">
                        Organizations
                      </button>
                    </div>
                    <div class="admin-scroll admin-canvas__cards-body admin-list-scroll">
                      <ul id="submission-list" class="admin-card-list"></ul>
                    </div>
                    <div class="submission-sidebar__footer">
                      <div class="submission-sidebar__actions">
                        <button type="button" id="submission-approve-btn" class="admin-btn--pill" disabled>Approve</button>
                        <button type="button" id="submission-reject-btn" class="admin-btn--pill admin-btn--pill--purple" disabled>Reject</button>
                      </div>
                      <p id="submission-detail-error" class="admin-error" hidden></p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>
        ${accountsSectionHtml(
          isProjectAdmin ? { mode: "manage" } : { mode: "settings", email, role }
        )}
      </div>
      ${changePasswordDialogHtml()}
      ${isProjectAdmin ? createAdminDialogHtml() : ""}
      ${isProjectAdmin ? resetPasswordDialogHtml() : ""}
      ${isProjectAdmin ? deleteAccountDialogHtml() : ""}
      ${renderAdminSiteFooter()}
    </div>
  `;

  root.querySelector("#accounts-section")?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-logout]")) return;
    void logoutAdmin().then(() => {
      renderAdminLogin(root, {
        title,
        subtitle,
        onSuccess: () => initAdminDashboard(root, { backdrop, title, subtitle }),
      });
    });
  });

  const header = root.querySelector(".admin-header") as HTMLElement | null;
  const headerBrand = root.querySelector(".admin-header__brand") as HTMLElement | null;
  const headerNav = root.querySelector(".admin-header__nav") as HTMLElement | null;
  const headerMenu = root.querySelector(".admin-header__menu") as HTMLElement | null;
  const headerMenuBtn = root.querySelector("#admin-header-menu-btn") as HTMLButtonElement | null;
  const headerActions = root.querySelector(".admin-header__actions") as HTMLElement | null;

  const setHeaderMenuOpen = (open: boolean): void => {
    if (!headerMenu || !headerMenuBtn) return;
    headerMenu.classList.toggle("is-open", open);
    headerMenuBtn.setAttribute("aria-expanded", String(open));
    headerMenuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };

  const flexRowContentWidth = (el: HTMLElement): number => {
    const style = getComputedStyle(el);
    const gap = Number.parseFloat(style.columnGap) || Number.parseFloat(style.gap) || 0;
    let width = 0;
    let visible = 0;
    for (const child of el.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (getComputedStyle(child).display === "none") continue;
      width += child.getBoundingClientRect().width;
      visible += 1;
    }
    if (visible > 1) width += gap * (visible - 1);
    return width;
  };

  const measureActionsInlineWidth = (actions: HTMLElement): number => {
    if (getComputedStyle(actions).display !== "none") {
      return Math.ceil(actions.scrollWidth);
    }
    const probe = actions.cloneNode(true) as HTMLElement;
    probe.removeAttribute("id");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "display:flex;flex-direction:row;flex-wrap:nowrap;position:absolute;visibility:hidden;pointer-events:none;inset:auto auto 0 0;";
    actions.parentElement?.appendChild(probe);
    const width = Math.ceil(probe.scrollWidth);
    probe.remove();
    return width;
  };

  const syncHeaderOverflow = (): void => {
    if (!header?.isConnected || !headerBrand || !headerNav || !headerMenuBtn || !headerActions) return;
    const headerStyle = getComputedStyle(header);
    const padX =
      (Number.parseFloat(headerStyle.paddingLeft) || 0) + (Number.parseFloat(headerStyle.paddingRight) || 0);
    const gap = Number.parseFloat(headerStyle.columnGap) || Number.parseFloat(headerStyle.gap) || 0;
    const available = header.clientWidth - padX;
    const expandedNeeded =
      flexRowContentWidth(headerBrand) +
      flexRowContentWidth(headerNav) +
      measureActionsInlineWidth(headerActions) +
      gap * 2;
    const compact = expandedNeeded > available + 0.5;
    if (header.classList.contains("admin-header--compact") === compact) return;
    header.classList.toggle("admin-header--compact", compact);
    if (!compact) setHeaderMenuOpen(false);
  };

  headerMenuBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    setHeaderMenuOpen(!headerMenu?.classList.contains("is-open"));
  });

  document.addEventListener("click", (event) => {
    if (!headerMenu?.isConnected || !headerMenu.classList.contains("is-open")) return;
    if (headerMenu.contains(event.target as Node)) return;
    setHeaderMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!headerMenu?.isConnected || !headerMenu.classList.contains("is-open")) return;
    setHeaderMenuOpen(false);
  });

  const headerOverflowObserver = new ResizeObserver(() => {
    syncHeaderOverflow();
  });
  if (header) headerOverflowObserver.observe(header);
  if (headerNav) headerOverflowObserver.observe(headerNav);
  syncHeaderOverflow();

  lockNativeScroll(root.querySelector(".admin") as HTMLElement);
  const cardForm = root.querySelector("#card-form") as HTMLFormElement | null;
  const activateFormTab = cardForm ? setupFormTabs(cardForm) : null;
  void setupDashboard(root, activateFormTab, backdrop, role, email);
}

function setupFormTabs(form: HTMLFormElement): (tabId: string) => void {
  const tabs = form.querySelectorAll<HTMLButtonElement>("[data-form-tab]");
  const panels = form.querySelectorAll<HTMLElement>("[data-form-tabpanel]");

  const activateTab = (tabId: string): void => {
    tabs.forEach((entry) => {
      const active = entry.dataset.formTab === tabId;
      entry.classList.toggle("admin-form__tab--active", active);
      entry.setAttribute("aria-selected", String(active));
    });

    panels.forEach((panel) => {
      const active = panel.dataset.formTabpanel === tabId;
      panel.hidden = !active;
      panel.classList.toggle("admin-form__tabpanel--active", active);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = tab.dataset.formTab;
      if (!tabId) return;
      activateTab(tabId);
    });
  });

  return activateTab;
}

function lockNativeScroll(container: HTMLElement): void {
  const allowScroll = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(".admin-scroll"));
  };

  const blockNativeScroll = (event: Event): void => {
    if (allowScroll(event.target)) return;
    event.preventDefault();
  };

  container.addEventListener("wheel", blockNativeScroll, { passive: false });
  container.addEventListener("touchmove", blockNativeScroll, { passive: false });
}

async function setupDashboard(
  root: HTMLElement,
  activateFormTab: ((tabId: string) => void) | null,
  backdrop: MapEditorBackdrop,
  role: AdminRole,
  sessionEmail: string
): Promise<void> {
  let cards: InfoCard[] = [];
  let submissions: StorySubmission[] = [];
  let calibrationPoints: CalibrationPoint[] = [];
  let ripplesAnchor: RipplesAnchor | null = null;
  let projection: Projection = buildProjection([]);
  let selectedId: string | null = null;
  let selectedSubmissionId: string | null = null;
  let submissionsMobileDetailOpen = false;
  /** Card ids that share the selected pin’s location (for group drag / save). */
  let selectedPinSiblingIds: string[] = [];
  let cardsTab: CardType = "individual";
  let submissionsTab: CardType = "individual";
  let formState = emptyForm(cardsTab);
  let mapEditor: ReturnType<typeof createMapEditor> | null = null;
  let submissionsMapEditor: ReturnType<typeof createMapEditor> | null = null;
  let calibrationPanel: ReturnType<typeof createCalibrationPanel> | null = null;
  type EditorPanel = "edit" | "calibrate" | "submissions" | "accounts";
  let activePanel: EditorPanel | null = null;

  const listEl = root.querySelector("#card-list") as HTMLUListElement;
  const cardsTabButtons = root.querySelectorAll<HTMLButtonElement>("[data-cards-tab]");
  const submissionsTabButtons = root.querySelectorAll<HTMLButtonElement>("[data-submissions-tab]");
  const submissionListEl = root.querySelector("#submission-list") as HTMLUListElement;
  const submissionCountEl = root.querySelector("#submission-count") as HTMLElement;
  const submissionToggleBadgeEl = root.querySelector("#submission-toggle-badge") as HTMLElement;
  const submissionDetailHost = root.querySelector("#submission-detail-host") as HTMLElement;
  const submissionApproveBtn = root.querySelector("#submission-approve-btn") as HTMLButtonElement;
  const submissionRejectBtn = root.querySelector("#submission-reject-btn") as HTMLButtonElement;
  const submissionDetailError = root.querySelector("#submission-detail-error") as HTMLElement;
  const submissionMobileError = root.querySelector("[data-submission-mobile-error]") as HTMLElement | null;
  const form = root.querySelector("#card-form") as HTMLFormElement;
  const formTitle = root.querySelector("#form-title") as HTMLElement;
  const formError = root.querySelector("#form-error") as HTMLElement;
  const geocodeResult = root.querySelector("#geocode-result") as HTMLElement;
  const editCardsSection = root.querySelector("#edit-cards-section") as HTMLElement;
  const calibrateSection = root.querySelector("#calibrate-section") as HTMLElement;
  const adminLayout = root.querySelector(".admin-layout") as HTMLElement;
  const submissionsSection = root.querySelector("#submissions-section") as HTMLElement;
  const submissionsDetailPanel = submissionsSection.querySelector(".admin-canvas__detail") as HTMLElement;
  const submissionsMapHost = root.querySelector("#submissions-map-host") as HTMLElement | null;
  const calibrationSideHost = root.querySelector("#calibration-side-host") as HTMLElement;
  const calibrationMapHost = root.querySelector("#calibration-map-host") as HTMLElement;
  const editCardsToggleBtn = root.querySelector("#edit-cards-toggle-btn") as HTMLButtonElement;
  const calibrateToggleBtn = root.querySelector("#calibrate-toggle-btn") as HTMLButtonElement;
  const submissionsToggleBtn = root.querySelector("#submissions-toggle-btn") as HTMLButtonElement;
  const accountsToggleBtn = root.querySelector("#accounts-toggle-btn") as HTMLButtonElement | null;
  const accountsSection = root.querySelector("#accounts-section") as HTMLElement | null;
  const mapHost = root.querySelector("#map-editor-host") as HTMLElement;
  const deleteBtn = root.querySelector("#delete-btn") as HTMLButtonElement;
  const addEntryBtn = root.querySelector("#add-entry-btn") as HTMLButtonElement;
  const toastEl = root.querySelector("#admin-toast") as HTMLElement;
  let toastHideTimer = 0;

  const showToast = (message: string): void => {
    window.clearTimeout(toastHideTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.remove("admin-toast--visible");
    // Retrigger enter animation when toast is already showing.
    void toastEl.offsetWidth;
    toastEl.classList.add("admin-toast--visible");
    toastHideTimer = window.setTimeout(() => {
      toastEl.classList.remove("admin-toast--visible");
      toastHideTimer = window.setTimeout(() => {
        toastEl.hidden = true;
        toastEl.textContent = "";
      }, 280);
    }, 2400);
  };
  const changePasswordDialog = setupChangePasswordDialog(root, { showToast, email: sessionEmail });
  accountsSection?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-change-password]")) return;
    changePasswordDialog.open();
  });
  const accountsPanel = setupAccountsPanel(root, {
    showToast,
    sessionEmail,
    canManage: role === "project_admin",
  });
  const cardsShelfView = root.querySelector("#cards-shelf-view") as HTMLElement;
  const editShelfView = root.querySelector("#edit-shelf-view") as HTMLElement;
  syncCardFormTypeFields(form, cardsTab);

  const showCardsView = (): void => {
    const wasEditView = isEditViewOpen();
    cardsShelfView.hidden = false;
    editShelfView.hidden = true;
    if (wasEditView) {
      selectedId = null;
      renderList();
    }
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const showEditView = (): void => {
    cardsShelfView.hidden = true;
    editShelfView.hidden = false;
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const isEditViewOpen = (): boolean => !editShelfView.hidden;

  const layoutSubmissionsCanvas = (): void => {
    if (submissionsSection.hidden) return;
    if (window.matchMedia("(max-width: 900px)").matches) {
      resetCanvasMainPanel(submissionsSection, submissionsDetailPanel);
      return;
    }
    if (submissionsMapHost) {
      return;
    }
    const mapImage = submissionsSection.querySelector(".submissions-detail__map--base") as HTMLImageElement | null;
    const aspectWidth =
      mapImage && mapImage.naturalWidth > 0 ? mapImage.naturalWidth : MAP_ADMIN_CROP.width;
    const aspectHeight =
      mapImage && mapImage.naturalHeight > 0 ? mapImage.naturalHeight : MAP_ADMIN_CROP.height;
    fitCanvasMainPanel(
      submissionsSection,
      submissionsDetailPanel,
      aspectWidth,
      aspectHeight
    );
  };

  const syncSubmissionsMobileView = (): void => {
    const compact = window.matchMedia("(max-width: 900px)").matches;
    const showDetail = compact && submissionsMobileDetailOpen && Boolean(selectedSubmissionId);
    submissionsSection.classList.toggle("admin-canvas--submissions-mobile-detail", showDetail);
  };

  const resetSubmissionsCanvasLayout = (): void => {
    submissionsMapEditor?.destroy();
    submissionsMapEditor = null;
    resetCanvasMainPanel(submissionsSection, submissionsDetailPanel);
  };

  const refreshSubmissionsMap = (): void => {
    if (!submissionsMapHost) return;
    submissionsMapEditor?.destroy();
    submissionsMapEditor = createMapEditor(
      submissionsMapHost,
      {
        pins: [],
        selectedId: null,
        backdrop,
        toDisplayCoords: mapXYOriginalToAdmin,
        fromDisplayCoords: mapXYAdminToOriginal,
        allowSelectedPinDrag: false,
      },
      {
        onPinMove() {
          /* Background only. */
        },
      }
    );
  };

  const updatePanelVisibility = (): void => {
    const isCanvasMode = activePanel === "edit" || activePanel === "calibrate" || activePanel === "submissions";
    const wasSubmissions = !submissionsSection.hidden;
    editCardsSection.hidden = activePanel !== "edit";
    calibrateSection.hidden = activePanel !== "calibrate";
    adminLayout.classList.toggle("admin-layout--canvas", isCanvasMode);
    adminLayout.classList.toggle("admin-layout--accounts", activePanel === "accounts");
    submissionsSection.hidden = activePanel !== "submissions";
    if (accountsSection) accountsSection.hidden = activePanel !== "accounts";
    if (wasSubmissions && activePanel !== "submissions") {
      resetSubmissionsCanvasLayout();
    }
    if (activePanel !== "submissions") {
      submissionsMobileDetailOpen = false;
      submissionsSection.classList.remove("admin-canvas--submissions-open", "admin-canvas--submissions-mobile-detail");
    }
    editCardsToggleBtn.setAttribute("aria-expanded", String(activePanel === "edit"));
    calibrateToggleBtn.setAttribute("aria-expanded", String(activePanel === "calibrate"));
    submissionsToggleBtn.setAttribute("aria-expanded", String(activePanel === "submissions"));
    accountsToggleBtn?.setAttribute("aria-expanded", String(activePanel === "accounts"));
    editCardsToggleBtn.classList.toggle("admin-btn--active", activePanel === "edit");
    calibrateToggleBtn.classList.toggle("admin-btn--active", activePanel === "calibrate");
    submissionsToggleBtn.classList.toggle("admin-btn--active", activePanel === "submissions");
    accountsToggleBtn?.classList.toggle("admin-btn--active", activePanel === "accounts");

    if (activePanel === "edit") {
      requestAnimationFrame(() => {
        refreshMapEditor();
      });
    } else if (activePanel === "calibrate") {
      requestAnimationFrame(() => calibrationPanel?.refreshMap());
    } else if (activePanel === "submissions") {
      submissionsSection.classList.remove("admin-canvas--submissions-open");
      if (window.matchMedia("(max-width: 900px)").matches) {
        submissionsMobileDetailOpen = false;
      }
      syncSubmissionsMobileView();
      renderSubmissionDetail();
      requestAnimationFrame(() => {
        layoutSubmissionsCanvas();
        refreshSubmissionsMap();
        requestAnimationFrame(() => {
          submissionsSection.classList.add("admin-canvas--submissions-open");
        });
      });
    }
  };

  const togglePanel = (panel: EditorPanel): void => {
    activePanel = activePanel === panel ? null : panel;
    if (activePanel === "submissions" && submissions.length > 0) {
      if (!selectedSubmissionId || !submissions.some((s) => s.id === selectedSubmissionId)) {
        selectedSubmissionId = submissions[0].id;
      }
      renderSubmissions();
    }
    if (activePanel === "accounts") {
      void accountsPanel.refresh();
    }
    updatePanelVisibility();
  };

  editCardsToggleBtn.addEventListener("click", () => {
    togglePanel("edit");
  });
  calibrateToggleBtn.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    togglePanel("calibrate");
  });
  submissionsToggleBtn.addEventListener("click", () => {
    togglePanel("submissions");
  });
  accountsToggleBtn?.addEventListener("click", () => {
    togglePanel("accounts");
  });

  const compactCalibrateMq = window.matchMedia("(max-width: 900px)");
  const closeCalibrateOnMobile = (): void => {
    if (!compactCalibrateMq.matches) return;
    if (activePanel !== "calibrate") return;
    activePanel = null;
    updatePanelVisibility();
  };
  compactCalibrateMq.addEventListener("change", closeCalibrateOnMobile);
  closeCalibrateOnMobile();
  compactCalibrateMq.addEventListener("change", () => {
    if (!compactCalibrateMq.matches) submissionsMobileDetailOpen = false;
    syncSubmissionsMobileView();
    layoutSubmissionsCanvas();
  });

  const submissionsResizeObserver = new ResizeObserver(() => layoutSubmissionsCanvas());
  submissionsResizeObserver.observe(adminLayout);
  window.addEventListener("resize", layoutSubmissionsCanvas);

  const applyCalibration = (points: CalibrationPoint[]): void => {
    calibrationPoints = points;
    projection = buildProjection(points);
  };

  const mountCalibrationPanel = (): void => {
    if (!ripplesAnchor) return;
    calibrationPanel?.destroy();
    calibrationPanel = createCalibrationPanel(calibrationSideHost, calibrationMapHost, calibrationPoints, ripplesAnchor, {
      onPointsChange(points) {
        applyCalibration(points);
      },
      onRipplesChange(anchor) {
        ripplesAnchor = anchor;
      },
    }, backdrop);
  };

  const load = async (): Promise<void> => {
    const [loadedCards, loadedCalibration, loadedRipplesAnchor, loadedSubmissions] = await Promise.all([
      fetchAllCards(),
      fetchCalibration(),
      fetchRipplesAnchor(),
      fetchSubmissions(),
    ]);
    cards = loadedCards;
    submissions = loadedSubmissions;
    ripplesAnchor = loadedRipplesAnchor;
    applyCalibration(loadedCalibration);
    mountCalibrationPanel();
    renderSubmissions();
    if (selectedId && cards.some((c) => c.id === selectedId)) {
      selectCard(selectedId, { openEditor: false });
      return;
    }
    showCardsView();
    renderList();
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const updateSubmissionBadges = (): void => {
    const count = submissions.length;
    submissionCountEl.textContent = String(count);
    submissionCountEl.hidden = count === 0;
    submissionToggleBadgeEl.textContent = String(count);
    submissionToggleBadgeEl.hidden = count === 0;
  };

  const selectSubmission = (id: string): void => {
    if (!submissions.some((s) => s.id === id)) return;
    selectedSubmissionId = id;
    if (window.matchMedia("(max-width: 900px)").matches) {
      submissionsMobileDetailOpen = true;
    }
    renderSubmissions();
    if (activePanel === "submissions") {
      renderSubmissionDetail();
      syncSubmissionsMobileView();
      submissionDetailHost.scrollTop = 0;
      requestAnimationFrame(() => {
        layoutSubmissionsCanvas();
        refreshSubmissionsMap();
      });
    }
  };

  const cardsOfActiveType = (): InfoCard[] =>
    cards.filter((card) => resolveCardType(card) === cardsTab);

  const setCardsTab = (tab: CardType): void => {
    if (cardsTab === tab) return;
    cardsTab = tab;
    cardsTabButtons.forEach((button) => {
      const selected = button.dataset.cardsTab === tab;
      button.classList.toggle("admin-form__tab--active", selected);
      button.setAttribute("aria-selected", String(selected));
    });

    if (selectedId) {
      const selected = cards.find((card) => card.id === selectedId);
      if (!selected || resolveCardType(selected) !== tab) {
        selectedId = null;
        selectedPinSiblingIds = [];
        formState = emptyForm(tab);
        fillCardForm(form, formState);
        syncCardFormTypeFields(form, tab);
        formTitle.textContent = "Edit card";
        geocodeResult.textContent = "";
        updateCardActions();
        showCardsView();
      }
    } else if (!isEditViewOpen()) {
      formState = { ...formState, cardType: tab };
      syncCardFormTypeFields(form, tab);
    }

    renderList();
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  cardsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.cardsTab;
      if (tab === "individual" || tab === "organization") {
        setCardsTab(tab);
      }
    });
  });

  const submissionsOfActiveType = (): StorySubmission[] =>
    submissions.filter((submission) => resolveSubmissionCardType(submission) === submissionsTab);

  const setSubmissionsTab = (tab: CardType): void => {
    if (submissionsTab === tab) return;
    submissionsTab = tab;
    submissionsTabButtons.forEach((button) => {
      const selected = button.dataset.submissionsTab === tab;
      button.classList.toggle("admin-form__tab--active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    if (window.matchMedia("(max-width: 900px)").matches) {
      submissionsMobileDetailOpen = false;
    }
    renderSubmissions();
    syncSubmissionsMobileView();
  };

  submissionsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.submissionsTab;
      if (tab === "individual" || tab === "organization") {
        setSubmissionsTab(tab);
      }
    });
  });

  const updateSubmissionActions = (): void => {
    const hasSelection = Boolean(
      selectedSubmissionId &&
        submissionsOfActiveType().some((submission) => submission.id === selectedSubmissionId)
    );
    submissionApproveBtn.disabled = !hasSelection;
    submissionRejectBtn.disabled = !hasSelection;
  };

  submissionApproveBtn.addEventListener("click", () => {
    if (selectedSubmissionId) {
      void handleApproveSubmission(selectedSubmissionId);
    }
  });
  submissionRejectBtn.addEventListener("click", () => {
    if (selectedSubmissionId) {
      void handleRejectSubmission(selectedSubmissionId);
    }
  });

  submissionsDetailPanel.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-submission-back]")) {
      submissionsMobileDetailOpen = false;
      syncSubmissionsMobileView();
      requestAnimationFrame(() => layoutSubmissionsCanvas());
      return;
    }
    if (target.closest("[data-submission-approve]") && selectedSubmissionId) {
      void handleApproveSubmission(selectedSubmissionId);
      return;
    }
    if (target.closest("[data-submission-reject]") && selectedSubmissionId) {
      void handleRejectSubmission(selectedSubmissionId);
    }
  });

  const renderSubmissions = (): void => {
    updateSubmissionBadges();

    const visible = submissionsOfActiveType();

    if (visible.length === 0) {
      selectedSubmissionId = null;
      submissionsMobileDetailOpen = false;
      submissionListEl.innerHTML = `<li class="admin-muted">No pending submissions.</li>`;
      if (activePanel === "submissions") {
        renderSubmissionDetail();
        syncSubmissionsMobileView();
      }
      updateSubmissionActions();
      return;
    }

    if (!selectedSubmissionId || !visible.some((s) => s.id === selectedSubmissionId)) {
      selectedSubmissionId = visible[0].id;
    }

    submissionListEl.innerHTML = visible
      .map(
        (submission) => `
          <li>
            <button type="button" data-id="${escapeAttr(submission.id)}" class="admin-card-item ${submission.id === selectedSubmissionId ? "admin-card-item--active" : ""}">
              <strong>${escapeHtml(submission.title)}</strong>
              <span>${escapeHtml(submissionTypeLabel(submission))}${
                submission.companyName ? ` · ${escapeHtml(submission.companyName)}` : ""
              }</span>
              <span>${escapeHtml(submission.address)}</span>
              <time class="admin-muted">${formatSubmittedAt(submission.submittedAt)}</time>
              ${
                submission.hadHomograph ||
                (submission.homographFields && Object.keys(submission.homographFields).length > 0)
                  ? `<span class="admin-card-item__homograph">Homograph detected</span>`
                  : ""
              }
            </button>
          </li>
        `
      )
      .join("");

    submissionListEl.querySelectorAll("[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => selectSubmission(btn.getAttribute("data-id")!));
    });

    if (activePanel === "submissions") {
      renderSubmissionDetail();
    }

    updateSubmissionActions();
  };

  const renderSubmissionDetail = (): void => {
    const submission = submissions.find((s) => s.id === selectedSubmissionId);
    if (!submission) {
      submissionDetailHost.innerHTML = `<p class="admin-muted">No pending submissions to review.</p>`;
      submissionDetailError.hidden = true;
      submissionDetailError.textContent = "";
      updateSubmissionActions();
      return;
    }

    const substitutionNotices = (fieldKey?: string): string => {
      if (!fieldKey) return "";
      const list = submission.homographFields?.[fieldKey];
      if (!list?.length) return "";
      return list
        .map(
          (item) =>
            `<p class="submission-detail__homograph-notice">${escapeHtml(item.correct)} was replaced by ${escapeHtml(item.homoglyph)}</p>`
        )
        .join("");
    };

    const field = (
      label: string,
      value: string | undefined | null,
      asHtml = false,
      fieldKey?: string
    ): string => {
      const notices = substitutionNotices(fieldKey);
      if (!value && !notices) return "";
      return `
        <div class="submission-detail__field">
          <dt>${escapeHtml(label)}</dt>
          <dd>${notices}${value ? (asHtml ? value : escapeHtml(value)) : ""}</dd>
        </div>`;
    };

    const linkField = (label: string, url: string | undefined, fieldKey?: string): string => {
      const href = safeHref(url ?? "");
      if (!href && !substitutionNotices(fieldKey)) return "";
      const link = href
        ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>`
        : "";
      return field(label, link || undefined, true, fieldKey);
    };

    const imageField = (label: string, url: string | undefined, fieldKey?: string): string => {
      const notices = substitutionNotices(fieldKey);
      const href = safeHref(url ?? "");
      if (!href && !notices) return "";
      return `
        <div class="submission-detail__field submission-detail__field--image">
          <dt>${escapeHtml(label)}</dt>
          <dd class="submission-detail__image-wrap">
            ${notices}
            ${
              href
                ? `<img class="submission-detail__image" src="${escapeAttr(href)}" alt="" loading="lazy" />
            <a class="submission-detail__image-link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>`
                : ""
            }
          </dd>
        </div>`;
    };

    let metaFields = "";
    let storyFields = field("Impact story", submission.body);
    let mediaFields =
      imageField("Image", submission.imageUrl, "imageUrl") +
      linkField("Link", submission.linkUrl, "linkUrl");

    if (isIndividualSubmission(submission)) {
      metaFields = [
        field("Type", "Individual"),
        field("Name", `${submission.firstName} ${submission.lastName}`),
        field("Pronouns", submission.pronouns),
        field("techNL member", submission.isTechNlMember),
        field("Profession", submission.profession.join(", ")),
        field("Current location", submission.currLocation),
        field("Hometown", submission.origLocation),
        field(
          "Email",
          submission.contactEmail
            ? `<a href="mailto:${escapeAttr(submission.contactEmail)}">${escapeHtml(submission.contactEmail)}</a>`
            : undefined,
          true,
          "contactEmail"
        ),
        field("Newsletter opt-in", submission.optInNewsletter ? "Yes" : "No"),
        field("Consent", submission.optInModeration ? "Yes" : "No"),
      ].join("");
      storyFields = [
        field("Love about NL", submission.nlDescription),
        field("Why NL tech", submission.whyDescription),
        field("Dream job", submission.dreamJob),
        field("Success story", submission.story),
        field("Combined body (card)", submission.body),
      ].join("");
      mediaFields =
        imageField("Photo", submission.logoUrl, "logoUrl") +
        linkField("LinkedIn", submission.linkedin, "linkedin");
    } else if (isOrganizationSubmission(submission)) {
      metaFields = [
        field("Type", "Organization"),
        field("Organization", submission.orgName),
        field("Submitter", submission.submitterName),
        field(
          "Submitter email",
          submission.submitterEmail
            ? `<a href="mailto:${escapeAttr(submission.submitterEmail)}">${escapeHtml(submission.submitterEmail)}</a>`
            : undefined,
          true,
          "submitterEmail"
        ),
        field(
          "Org email",
          submission.orgContactEmail
            ? `<a href="mailto:${escapeAttr(submission.orgContactEmail)}">${escapeHtml(submission.orgContactEmail)}</a>`
            : undefined,
          true,
          "orgContactEmail"
        ),
        field("techNL member", submission.isTechNlMember),
        field("Industry", submission.industry.join(", ")),
        field("Head office", submission.nlLocation),
        field("Business locations", submission.locations.join("; ")),
        field(
          "Export locations",
          submission.exportLocations?.length ? submission.exportLocations.join("; ") : undefined
        ),
        field(
          "Year established",
          submission.yearEstablished != null ? String(submission.yearEstablished) : undefined
        ),
        field("Newsletter opt-in", submission.optInNewsletter ? "Yes" : "No"),
        field("Consent", submission.optInModeration ? "Yes" : "No"),
      ].join("");
      storyFields = [
        field("Description", submission.mainDescription),
        field("Company bio", submission.companyBio),
        field("Stakeholders", submission.stakeholderDescription),
        field("Success story", submission.storyDescription),
        field("Combined body (card)", submission.body),
      ].join("");
      mediaFields = [
        imageField("Logo", submission.logoUrl, "logoUrl"),
        imageField("Media 1", submission.mediaOneUrl, "mediaOneUrl"),
        imageField("Media 2", submission.mediaTwoUrl, "mediaTwoUrl"),
        linkField("Website", submission.websiteUrl, "websiteUrl"),
        linkField("LinkedIn", submission.linkedinUrl, "linkedinUrl"),
        linkField("YouTube", submission.youtubeLink, "youtubeLink"),
      ].join("");
    } else {
      metaFields = [
        field("Type", "Story"),
        field("Company", submission.companyName || "—"),
        field("Address", submission.address),
        field(
          "Contact email",
          submission.contactEmail
            ? `<a href="mailto:${escapeAttr(submission.contactEmail)}">${escapeHtml(submission.contactEmail)}</a>`
            : undefined,
          true,
          "contactEmail"
        ),
      ].join("");
    }

    submissionDetailHost.innerHTML = `
      <article class="submission-detail">
        <header class="submission-detail__head">
          <h2>${escapeHtml(submission.title)}</h2>
          <time class="admin-muted">Submitted ${formatSubmittedAt(submission.submittedAt)}</time>
        </header>
        <div class="submission-detail__content">
          <div class="submission-detail__main">
            <dl class="submission-detail__fields submission-detail__fields--meta">${metaFields}</dl>
            <dl class="submission-detail__fields submission-detail__fields--story">${storyFields}</dl>
          </div>
          ${
            mediaFields
              ? `<dl class="submission-detail__fields submission-detail__fields--media">${mediaFields}</dl>`
              : ""
          }
        </div>
      </article>
    `;

    submissionDetailError.hidden = true;
    submissionDetailError.textContent = "";
    if (submissionMobileError) {
      submissionMobileError.hidden = true;
      submissionMobileError.textContent = "";
    }
    updateSubmissionActions();
  };

  const showSubmissionError = (message: string): void => {
    if (activePanel === "submissions") {
      submissionDetailError.textContent = message;
      submissionDetailError.hidden = false;
      if (submissionMobileError) {
        submissionMobileError.textContent = message;
        submissionMobileError.hidden = false;
      }
      return;
    }
    formError.textContent = message;
    formError.hidden = false;
  };

  const handleApproveSubmission = async (id: string): Promise<void> => {
    const submission = submissions.find((s) => s.id === id);
    if (!submission) return;
    if (!confirm(`Approve "${submission.title}" and add it to the map?`)) return;

    try {
      const card = await approveSubmission(id);
      submissions = submissions.filter((s) => s.id !== id);
      renderSubmissions();

      activePanel = "edit";
      updatePanelVisibility();
      applySavedCard(card);

      const address = submission.address.trim();
      if (!address) {
        geocodeResult.textContent = "Approved — no address to geocode. Add an address and geocode manually.";
        return;
      }

      geocodeResult.textContent = "Looking up location…";
      try {
        const result = await geocodeAddress(address);
        applyGeocodeToForm(result);
        const match = snapNewCardToExistingPin();
        const saved = await updateCard(card.id, {
          address: formState.address,
          lat: formState.lat,
          lng: formState.lng,
          mapX: formState.mapX,
          mapY: formState.mapY,
        });
        applySavedCard(saved);
        geocodeResult.textContent =
          `Approved and placed at ${result.displayName}. Drag the pin to fine-tune if needed.${geocodeAccuracyNote()}` +
          (match ? existingPinMatchNote(match) : "");
      } catch (geocodeError) {
        geocodeResult.textContent =
          geocodeError instanceof Error
            ? `Approved, but geocoding failed: ${geocodeError.message}. Place manually on the map.`
            : "Approved, but geocoding failed. Place manually on the map.";
      }
    } catch (error) {
      showSubmissionError(error instanceof Error ? error.message : "Approval failed.");
    }
  };

  const handleRejectSubmission = async (id: string): Promise<void> => {
    const submission = submissions.find((s) => s.id === id);
    if (!submission) return;
    if (!confirm(`Reject "${submission.title}"? This cannot be undone.`)) return;

    try {
      await rejectSubmission(id);
      submissions = submissions.filter((s) => s.id !== id);
      submissionsMobileDetailOpen = false;
      renderSubmissions();
      syncSubmissionsMobileView();
    } catch (error) {
      showSubmissionError(error instanceof Error ? error.message : "Rejection failed.");
    }
  };

  const syncPinPositionFromMap = (): void => {
    const pos = mapEditor?.getSelectedPinPosition();
    if (!pos) return;
    formState.mapX = pos.mapX;
    formState.mapY = pos.mapY;
  };

  const applyGroupPinMove = (mapX: number, mapY: number): void => {
    formState.mapX = mapX;
    formState.mapY = mapY;
    for (const siblingId of selectedPinSiblingIds) {
      const idx = cards.findIndex((card) => card.id === siblingId);
      if (idx === -1) continue;
      cards[idx] = { ...cards[idx], mapX, mapY };
    }
  };

  const persistGroupPinMove = async (mapX: number, mapY: number, excludeId: string): Promise<void> => {
    const targetKey = locationKey(mapX, mapY);
    const siblings = selectedPinSiblingIds.filter((id) => {
      if (id === excludeId) return false;
      const card = cards.find((entry) => entry.id === id);
      return card ? locationKey(card.mapX, card.mapY) === targetKey : false;
    });
    await Promise.all(
      siblings.map(async (siblingId) => {
        const saved = await updateCard(siblingId, { mapX, mapY });
        const idx = cards.findIndex((card) => card.id === saved.id);
        if (idx !== -1) cards[idx] = saved;
      })
    );
  };

  const refreshSelectedPinSiblings = (): void => {
    if (!selectedId) {
      selectedPinSiblingIds = [];
      return;
    }
    const groups = groupCardsByLocation(cards);
    const group = findGroupForCardId(groups, selectedId);
    selectedPinSiblingIds = group ? group.cards.map((card) => card.id) : [selectedId];
  };

  const updateCardActions = (): void => {
    deleteBtn.disabled = !selectedId;
    addEntryBtn.disabled = !selectedId;
  };

  const applySavedCard = (saved: InfoCard): void => {
    const type = resolveCardType(saved);
    selectedId = saved.id;
    formState = hydrateCardFormState(saved);
    const idx = cards.findIndex((c) => c.id === saved.id);
    if (idx === -1) {
      cards.push({ ...saved, cardType: type });
    } else {
      cards[idx] = { ...saved, cardType: type };
    }
    if (cardsTab !== type) {
      cardsTab = type;
      cardsTabButtons.forEach((button) => {
        const selected = button.dataset.cardsTab === cardsTab;
        button.classList.toggle("admin-form__tab--active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
    }
    refreshSelectedPinSiblings();
    formTitle.textContent = "Edit card";
    fillCardForm(form, formState);
    renderList();
    updateCardActions();
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const renderList = (): void => {
    const visibleCards = cardsOfActiveType();
    if (visibleCards.length === 0) {
      listEl.innerHTML = `<li class="admin-muted">No cards yet. Create one.</li>`;
      return;
    }
    listEl.innerHTML = visibleCards
      .map(
        (card) => `
          <li>
            <button type="button" data-id="${card.id}" class="admin-card-item ${card.id === selectedId ? "admin-card-item--active" : ""}">
              <strong>${escapeHtml(card.title || "Untitled")}</strong>
              <span>${escapeHtml(card.address || "No address")}</span>
              ${card.active ? "" : "<em>Inactive</em>"}
            </button>
          </li>
        `
      )
      .join("");

    listEl.querySelectorAll("[data-id]").forEach((button) => {
      const id = button.getAttribute("data-id")!;
      button.addEventListener("click", () => selectCard(id));
      button.addEventListener("mouseenter", () => {
        if (window.matchMedia("(max-width: 900px)").matches) return;
        mapEditor?.showCardPreview(id);
      });
      button.addEventListener("mouseleave", () => mapEditor?.showCardPreview(null));
    });
  };

  const selectCard = (id: string, options: { openEditor?: boolean } = { openEditor: true }): void => {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const type = resolveCardType(card);
    selectedId = id;
    formState = hydrateCardFormState(card);
    if (cardsTab !== type) {
      cardsTab = type;
      cardsTabButtons.forEach((button) => {
        const selected = button.dataset.cardsTab === cardsTab;
        button.classList.toggle("admin-form__tab--active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
    }
    refreshSelectedPinSiblings();
    formTitle.textContent = "Edit card";
    geocodeResult.textContent = "";
    fillCardForm(form, formState);
    renderList();
    updateCardActions();
    if (options.openEditor !== false) {
      activateFormTab?.("details");
      showEditView();
    } else if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const refreshMapEditor = (): void => {
    const allowSelectedPinDrag = isEditViewOpen();
    const visibleCards = cardsOfActiveType();
    const groups = groupCardsByLocation(visibleCards);
    const selectedPinId =
      allowSelectedPinDrag && selectedId ? locationKey(formState.mapX, formState.mapY) : null;

    mapEditor?.destroy();
    mapEditor = createMapEditor(
      mapHost,
      {
        pins: groups.map((group) => ({
          id: group.key,
          label:
            group.cards.length === 1
              ? group.cards[0].title || "Untitled"
              : `${group.cards.length} entries`,
          mapX: group.mapX,
          mapY: group.mapY,
          count: group.cards.length,
        })),
        selectedId: selectedPinId,
        draftPosition:
          allowSelectedPinDrag && !selectedId ? { mapX: formState.mapX, mapY: formState.mapY } : undefined,
        backdrop,
        toDisplayCoords: mapXYOriginalToAdmin,
        fromDisplayCoords: mapXYAdminToOriginal,
        previewCards: visibleCards,
        allowSelectedPinDrag,
      },
      {
        onPinMove(mapX, mapY) {
          applyGroupPinMove(mapX, mapY);
        },
        onPinActivate(pinId) {
          const atLocation = visibleCards.filter(
            (card) => locationKey(card.mapX, card.mapY) === pinId
          );
          const card = atLocation[0] ?? visibleCards.find((entry) => entry.id === pinId);
          if (!card) return;
          selectCard(card.id);
        },
      }
    );
  };

  const geocodeAccuracyNote = (): string =>
    calibrationPoints.length < 2 ? " (approximate — add calibration points for accuracy)" : "";

  /** Reuse an existing pin's coords when name or lat/lng collide (avoids stacked duplicate pins). */
  const snapNewCardToExistingPin = (): ReturnType<typeof findMatchingPin> => {
    const match = findMatchingPin(
      cardsOfActiveType(),
      {
        address: formState.address,
        lat: formState.lat,
        lng: formState.lng,
      },
      { excludeId: selectedId ?? undefined }
    );
    if (!match) return undefined;
    formState.lat = match.card.lat;
    formState.lng = match.card.lng;
    formState.mapX = match.card.mapX;
    formState.mapY = match.card.mapY;
    fillCardForm(form, formState);
    mapEditor?.setSelectedPin(match.card.mapX, match.card.mapY);
    return match;
  };

  const existingPinMatchNote = (match: NonNullable<ReturnType<typeof findMatchingPin>>): string => {
    const label = match.card.title || match.card.address || "Untitled";
    const how =
      match.reason === "name"
        ? "same location name"
        : `within ${Math.round(match.distanceMeters ?? 0)} m`;
    return ` Matches existing pin "${label}" (${how}). Saving adds another entry at that pin.`;
  };

  const applyGeocodeToForm = (result: GeocodeResult): void => {
    formState.address = result.displayName;
    formState.lat = result.lat;
    formState.lng = result.lng;
    const { mapX, mapY } = projectLatLng(projection, result.lat, result.lng);
    formState.mapX = mapX;
    formState.mapY = mapY;
    fillCardForm(form, formState);
    mapEditor?.setSelectedPin(mapX, mapY);
  };

  const recalculatePinFromCalibration = (): void => {
    formState = readCardForm(form, formState);
    if (
      !Number.isFinite(formState.lat) ||
      !Number.isFinite(formState.lng) ||
      (formState.lat === 0 && formState.lng === 0)
    ) {
      geocodeResult.textContent = "Geocode an address first so lat/lng are set.";
      return;
    }

    const { mapX, mapY } = projectLatLng(projection, formState.lat, formState.lng);
    applyGroupPinMove(mapX, mapY);
    mapEditor?.setSelectedPin(mapX, mapY);
    geocodeResult.textContent =
      `Pin updated from calibration at ${formState.lat.toFixed(4)}°, ${formState.lng.toFixed(4)}°.` +
      geocodeAccuracyNote() +
      " Save to keep.";
  };

  const geocodeFormAddress = async (): Promise<boolean> => {
    const address = (form.elements.namedItem("address") as HTMLInputElement).value.trim();
    if (!address) {
      geocodeResult.textContent = "Enter an address first.";
      return false;
    }

    try {
      geocodeResult.textContent = "Looking up…";
      const result = await geocodeAddress(address);
      applyGeocodeToForm(result);
      const match = snapNewCardToExistingPin();
      geocodeResult.textContent =
        result.displayName + geocodeAccuracyNote() + (match ? existingPinMatchNote(match) : "");
      return true;
    } catch (error) {
      geocodeResult.textContent = error instanceof Error ? error.message : "Geocoding failed.";
      return false;
    }
  };

  root.querySelector("#new-card-btn")?.addEventListener("click", () => {
    selectedId = null;
    selectedPinSiblingIds = [];
    formState = emptyForm(cardsTab);
    formTitle.textContent = "New card";
    geocodeResult.textContent = "";
    fillCardForm(form, formState);
    renderList();
    updateCardActions();
    activateFormTab?.("details");
    showEditView();
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  });

  addEntryBtn.addEventListener("click", () => {
    if (!selectedId) return;
    const source = cards.find((card) => card.id === selectedId);
    if (!source) return;

    selectedId = null;
    selectedPinSiblingIds = [];
    formState = {
      ...emptyForm(resolveCardType(source)),
      address: source.address,
      lat: source.lat,
      lng: source.lng,
      mapX: source.mapX,
      mapY: source.mapY,
    };
    formTitle.textContent = "New entry at pin";
    geocodeResult.textContent = "";
    fillCardForm(form, formState);
    renderList();
    updateCardActions();
    activateFormTab?.("details");
    showEditView();
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  });

  root.querySelector("#edit-shelf-back")?.addEventListener("click", () => {
    showCardsView();
  });

  root.querySelector("#geocode-btn")?.addEventListener("click", () => {
    void geocodeFormAddress();
  });

  root.querySelector("#recalc-pin-btn")?.addEventListener("click", () => {
    recalculatePinFromCalibration();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.hidden = true;
    syncPinPositionFromMap();
    formState = readCardForm(form, formState);

    try {
      const match = snapNewCardToExistingPin();
      const saved = selectedId
        ? await updateCard(selectedId, formState)
        : await createCard(formState);
      if (selectedId && selectedPinSiblingIds.length > 1) {
        await persistGroupPinMove(formState.mapX, formState.mapY, saved.id);
      }
      applySavedCard(saved);
      showToast(match ? `Card saved at existing pin "${match.card.title || "Untitled"}".` : "Card saved.");
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : "Save failed.";
      formError.hidden = false;
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    if (!confirm("Delete this card?")) return;
    try {
      await deleteCard(selectedId);
      selectedId = null;
      selectedPinSiblingIds = [];
      formState = emptyForm(cardsTab);
      fillCardForm(form, formState);
      formTitle.textContent = "New card";
      updateCardActions();
      showCardsView();
      await load();
      showToast("Card deleted.");
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : "Delete failed.";
      formError.hidden = false;
    }
  });

  await load();
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

function formatSubmittedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
