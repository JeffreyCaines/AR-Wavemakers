import "./styles.css";
import techNlLogoUrl from "../images/TechNL-Logo_Black.webp";
import {
  approveSubmission,
  clearAdminToken,
  createCard,
  deleteCard,
  fetchAllCards,
  fetchCalibration,
  fetchSubmissions,
  geocodeAddress,
  getAdminToken,
  rejectSubmission,
  updateCard,
} from "../shared/api";
import { buildProjection, mapXYAdminToOriginal, mapXYOriginalToAdmin, projectLatLng, type Projection } from "../shared/geo";
import type { CalibrationPoint, GeocodeResult, InfoCard, StorySubmission } from "../shared/types";
import { createCalibrationPanel } from "./calibrationPanel";
import { renderAdminLogin } from "./login";
import { createMapEditor } from "./mapEditor";

type FormState = Omit<InfoCard, "id">;

function renderAdminSiteFooter(): string {
  return `
    <footer class="admin-site-footer" aria-label="Site footer">
      <div class="admin-site-footer__bar">
        <p>&copy; ${new Date().getFullYear()} techNL</p>
      </div>
    </footer>
  `;
}

const emptyForm = (): FormState => ({
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
});

export function initAdminDashboard(root: HTMLElement): void {
  if (!getAdminToken()) {
    renderAdminLogin(root, {
      title: "Admin Dashboard",
      subtitle: "Enter the admin password to manage info cards.",
      onSuccess: () => renderDashboard(root),
    });
    return;
  }

  renderDashboard(root);
}

function renderDashboard(root: HTMLElement): void {
  root.innerHTML = `
    <div class="admin">
      <header class="admin-header">
        <div class="admin-header__brand logo_container">
          <a href="https://technl.ca/">
            <span class="logo_helper" aria-hidden="true"></span>
            <img src="${techNlLogoUrl}" alt="techNL" class="admin-header__logo">
          </a>
          <!-- <p>Place cards on the world map for the AR experience.</p> -->
        </div>
        <nav class="admin-header__nav" aria-label="Dashboard sections">
          <button type="button" id="edit-cards-toggle-btn" class="admin-btn admin-btn--ghost" aria-expanded="false">Edit cards</button>
          <button type="button" id="calibrate-toggle-btn" class="admin-btn admin-btn--ghost" aria-expanded="false">Calibrate map</button>
          <button type="button" id="submissions-toggle-btn" class="admin-btn admin-btn--ghost" aria-expanded="false">
            Review submissions <span id="submission-toggle-badge" class="admin-badge" hidden>0</span>
          </button>
        </nav>
        <div class="admin-header__actions">
          <a href="/share-story.html" class="admin-link">Share story form</a>
          <a href="/ar-preview" class="admin-link">Open AR Viewer</a>
          <button type="button" id="logout-btn" class="admin-btn--pill">Sign out</button>
        </div>
      </header>
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
                      <button type="button" id="new-card-btn" class="admin-btn--pill">New card</button>
                    </div>
                    <div class="admin-scroll admin-canvas__cards-body">
                      <ul id="card-list" class="admin-card-list"></ul>
                    </div>
                  </div>
                  <div id="edit-shelf-view" class="admin-canvas__cards-view" hidden>
                    <div class="admin-canvas__cards-toolbar">
                      <h2 id="form-title">Edit card</h2>
                      <button type="button" id="edit-shelf-back" class="admin-canvas__cards-back" aria-label="Back to cards">×</button>
                    </div>
                    <form id="card-form" class="admin-form admin-form--edit">
                      <div class="admin-form__scroll admin-scroll">
                        <div class="admin-form__tabs" role="tablist" aria-label="Card fields">
                          <button type="button" class="admin-form__tab admin-form__tab--active" role="tab" aria-selected="true" data-form-tab="details">Details</button>
                          <button type="button" class="admin-form__tab" role="tab" aria-selected="false" data-form-tab="location">Location</button>
                          <button type="button" class="admin-form__tab" role="tab" aria-selected="false" data-form-tab="media">Media</button>
                        </div>
                        <div class="admin-form__tabpanel admin-form__tabpanel--active" data-form-tabpanel="details" role="tabpanel">
                          <label>Title<input name="title" required /></label>
                          <label>Company<input name="companyName" /></label>
                          <label>Impact story<textarea name="body" rows="20" required></textarea></label>
                          <label class="admin-checkbox"><input name="active" type="checkbox" checked /> Active</label>
                        </div>
                        <div class="admin-form__tabpanel" data-form-tabpanel="location" role="tabpanel" hidden>
                          <label>Address<input name="address" placeholder="City, Country" /></label>
                          <button type="button" id="geocode-btn" class="admin-btn--pill admin-form__geocode-btn">Geocode address</button>
                          <span id="geocode-result" class="admin-muted admin-form__geocode-result"></span>
                          <small class="admin-attribution">Geocoding &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</small>
                        </div>
                        <div class="admin-form__tabpanel" data-form-tabpanel="media" role="tabpanel" hidden>
                          <label>Image URL<input name="imageUrl" type="url" placeholder="https://…" /></label>
                          <label>Link URL<input name="linkUrl" type="url" placeholder="https://…" /></label>
                        </div>
                      </div>
                      <div class="admin-form__footer">
                        <div class="admin-form__actions">
                          <button type="submit" class="admin-btn--pill">Save</button>
                          <button type="button" id="delete-btn" class="admin-btn--pill admin-btn--pill--purple" hidden>Delete</button>
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
                    <div class="admin-canvas__cards-toolbar">
                      <h2>Calibration points</h2>
                    </div>
                    <div id="calibration-side-host" class="calibration-side admin-form admin-form--edit"></div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>
        <section class="admin-panel admin-panel--editor">
          <div id="submissions-section" class="admin-scroll admin-panel__body" hidden>
            <div id="submission-detail-host"></div>
          </div>
        </section>
        <div class="admin-sidebar">
          <section class="admin-panel admin-panel--submissions" id="submissions-sidebar-panel" hidden>
            <div class="admin-panel__head">
              <h2>Pending submissions <span id="submission-count" class="admin-badge" hidden>0</span></h2>
            </div>
            <div class="admin-scroll admin-panel__body">
              <ul id="submission-list" class="admin-card-list"></ul>
            </div>
          </section>
        </div>
      </div>
      ${renderAdminSiteFooter()}
    </div>
  `;

  root.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearAdminToken();
    renderAdminLogin(root, {
      title: "Admin Dashboard",
      subtitle: "Enter the admin password to manage info cards.",
      onSuccess: () => renderDashboard(root),
    });
  });

  lockNativeScroll(root.querySelector(".admin") as HTMLElement);
  const cardForm = root.querySelector("#card-form") as HTMLFormElement | null;
  if (cardForm) setupFormTabs(cardForm);
  void setupDashboard(root);
}

function setupFormTabs(form: HTMLFormElement): void {
  const tabs = form.querySelectorAll<HTMLButtonElement>("[data-form-tab]");
  const panels = form.querySelectorAll<HTMLElement>("[data-form-tabpanel]");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = tab.dataset.formTab;
      if (!tabId) return;

      tabs.forEach((entry) => {
        const active = entry === tab;
        entry.classList.toggle("admin-form__tab--active", active);
        entry.setAttribute("aria-selected", String(active));
      });

      panels.forEach((panel) => {
        const active = panel.dataset.formTabpanel === tabId;
        panel.hidden = !active;
        panel.classList.toggle("admin-form__tabpanel--active", active);
      });
    });
  });
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

async function setupDashboard(root: HTMLElement): Promise<void> {
  let cards: InfoCard[] = [];
  let submissions: StorySubmission[] = [];
  let calibrationPoints: CalibrationPoint[] = [];
  let projection: Projection = buildProjection([]);
  let selectedId: string | null = null;
  let selectedSubmissionId: string | null = null;
  let formState = emptyForm();
  let mapEditor: ReturnType<typeof createMapEditor> | null = null;
  let calibrationPanel: ReturnType<typeof createCalibrationPanel> | null = null;
  type EditorPanel = "edit" | "calibrate" | "submissions";
  let activePanel: EditorPanel | null = null;

  const listEl = root.querySelector("#card-list") as HTMLUListElement;
  const submissionListEl = root.querySelector("#submission-list") as HTMLUListElement;
  const submissionCountEl = root.querySelector("#submission-count") as HTMLElement;
  const submissionToggleBadgeEl = root.querySelector("#submission-toggle-badge") as HTMLElement;
  const submissionDetailHost = root.querySelector("#submission-detail-host") as HTMLElement;
  const form = root.querySelector("#card-form") as HTMLFormElement;
  const formTitle = root.querySelector("#form-title") as HTMLElement;
  const formError = root.querySelector("#form-error") as HTMLElement;
  const geocodeResult = root.querySelector("#geocode-result") as HTMLElement;
  const editCardsSection = root.querySelector("#edit-cards-section") as HTMLElement;
  const calibrateSection = root.querySelector("#calibrate-section") as HTMLElement;
  const adminLayout = root.querySelector(".admin-layout") as HTMLElement;
  const adminPanelEditor = root.querySelector(".admin-panel--editor") as HTMLElement;
  const adminSidebar = root.querySelector(".admin-sidebar") as HTMLElement;
  const calibrationSideHost = root.querySelector("#calibration-side-host") as HTMLElement;
  const calibrationMapHost = root.querySelector("#calibration-map-host") as HTMLElement;
  const editCardsToggleBtn = root.querySelector("#edit-cards-toggle-btn") as HTMLButtonElement;
  const calibrateToggleBtn = root.querySelector("#calibrate-toggle-btn") as HTMLButtonElement;
  const submissionsToggleBtn = root.querySelector("#submissions-toggle-btn") as HTMLButtonElement;
  const submissionsSection = root.querySelector("#submissions-section") as HTMLElement;
  const submissionsSidebarPanel = root.querySelector("#submissions-sidebar-panel") as HTMLElement;
  const mapHost = root.querySelector("#map-editor-host") as HTMLElement;
  const deleteBtn = root.querySelector("#delete-btn") as HTMLButtonElement;
  const cardsShelfView = root.querySelector("#cards-shelf-view") as HTMLElement;
  const editShelfView = root.querySelector("#edit-shelf-view") as HTMLElement;
  const impactStoryInput = form.elements.namedItem("body") as HTMLTextAreaElement;
  let impactStoryMinHeightPx = 0;

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
    requestAnimationFrame(captureImpactStoryMinHeight);
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const isEditViewOpen = (): boolean => !editShelfView.hidden;

  const captureImpactStoryMinHeight = (): void => {
    if (editCardsSection.hidden || impactStoryMinHeightPx > 0) return;

    const height = impactStoryInput.offsetHeight;
    if (height <= 0) return;

    impactStoryMinHeightPx = height;
    impactStoryInput.style.minHeight = `${height}px`;
  };

  const enforceImpactStoryMinHeight = (): void => {
    if (impactStoryMinHeightPx <= 0) return;
    if (impactStoryInput.offsetHeight < impactStoryMinHeightPx) {
      impactStoryInput.style.height = `${impactStoryMinHeightPx}px`;
    }
  };

  impactStoryInput.addEventListener("mouseup", enforceImpactStoryMinHeight);
  impactStoryInput.addEventListener("touchend", enforceImpactStoryMinHeight);
  void document.fonts.ready.then(captureImpactStoryMinHeight);

  const updateSidebarForMode = (): void => {
    if (activePanel === "edit" || activePanel === "calibrate") return;
    submissionsSidebarPanel.hidden = activePanel !== "submissions";
  };

  const updatePanelVisibility = (): void => {
    const isCanvasMode = activePanel === "edit" || activePanel === "calibrate";
    editCardsSection.hidden = activePanel !== "edit";
    calibrateSection.hidden = activePanel !== "calibrate";
    adminLayout.classList.toggle("admin-layout--canvas", isCanvasMode);
    adminPanelEditor.hidden = activePanel !== "submissions";
    adminSidebar.hidden = isCanvasMode || activePanel === null;
    submissionsSection.hidden = activePanel !== "submissions";
    editCardsToggleBtn.setAttribute("aria-expanded", String(activePanel === "edit"));
    calibrateToggleBtn.setAttribute("aria-expanded", String(activePanel === "calibrate"));
    submissionsToggleBtn.setAttribute("aria-expanded", String(activePanel === "submissions"));
    editCardsToggleBtn.classList.toggle("admin-btn--active", activePanel === "edit");
    calibrateToggleBtn.classList.toggle("admin-btn--active", activePanel === "calibrate");
    submissionsToggleBtn.classList.toggle("admin-btn--active", activePanel === "submissions");
    updateSidebarForMode();

    if (activePanel === "edit") {
      requestAnimationFrame(captureImpactStoryMinHeight);
      refreshMapEditor();
    } else if (activePanel === "calibrate") {
      calibrationPanel?.refreshMap();
    } else if (activePanel === "submissions") {
      renderSubmissionDetail();
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
    updatePanelVisibility();
  };

  editCardsToggleBtn.addEventListener("click", () => togglePanel("edit"));
  calibrateToggleBtn.addEventListener("click", () => togglePanel("calibrate"));
  submissionsToggleBtn.addEventListener("click", () => togglePanel("submissions"));
  updateSidebarForMode();

  const applyCalibration = (points: CalibrationPoint[]): void => {
    calibrationPoints = points;
    projection = buildProjection(points);
  };

  const mountCalibrationPanel = (): void => {
    calibrationPanel?.destroy();
    calibrationPanel = createCalibrationPanel(calibrationSideHost, calibrationMapHost, calibrationPoints, {
      onChange(points) {
        applyCalibration(points);
      },
    });
  };

  const load = async (): Promise<void> => {
    const [loadedCards, loadedCalibration, loadedSubmissions] = await Promise.all([
      fetchAllCards(),
      fetchCalibration(),
      fetchSubmissions(),
    ]);
    cards = loadedCards;
    submissions = loadedSubmissions;
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
    renderSubmissions();
    if (activePanel === "submissions") {
      renderSubmissionDetail();
    }
  };

  const renderSubmissions = (): void => {
    updateSubmissionBadges();

    if (submissions.length === 0) {
      selectedSubmissionId = null;
      submissionListEl.innerHTML = `<li class="admin-muted">No pending submissions.</li>`;
      if (activePanel === "submissions") {
        renderSubmissionDetail();
      }
      return;
    }

    if (!selectedSubmissionId || !submissions.some((s) => s.id === selectedSubmissionId)) {
      selectedSubmissionId = submissions[0].id;
    }

    submissionListEl.innerHTML = submissions
      .map(
        (submission) => `
          <li>
            <button type="button" data-id="${escapeAttr(submission.id)}" class="admin-card-item ${submission.id === selectedSubmissionId ? "admin-card-item--active" : ""}">
              <strong>${escapeHtml(submission.title)}</strong>
              <span>${escapeHtml(submission.companyName || "No company")}</span>
              <span>${escapeHtml(submission.address)}</span>
              <time class="admin-muted">${formatSubmittedAt(submission.submittedAt)}</time>
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
  };

  const renderSubmissionDetail = (): void => {
    const submission = submissions.find((s) => s.id === selectedSubmissionId);
    if (!submission) {
      submissionDetailHost.innerHTML = `<p class="admin-muted">No pending submissions to review.</p>`;
      return;
    }

    submissionDetailHost.innerHTML = `
      <article class="submission-detail">
        <header class="submission-detail__head">
          <h2>${escapeHtml(submission.title)}</h2>
          <time class="admin-muted">Submitted ${formatSubmittedAt(submission.submittedAt)}</time>
        </header>
        <dl class="submission-detail__fields">
          <div class="submission-detail__field">
            <dt>Company</dt>
            <dd>${escapeHtml(submission.companyName || "—")}</dd>
          </div>
          <div class="submission-detail__field">
            <dt>Address</dt>
            <dd>${escapeHtml(submission.address)}</dd>
          </div>
          ${
            submission.contactEmail
              ? `
          <div class="submission-detail__field">
            <dt>Contact email</dt>
            <dd><a href="mailto:${escapeAttr(submission.contactEmail)}">${escapeHtml(submission.contactEmail)}</a></dd>
          </div>`
              : ""
          }
          <div class="submission-detail__field submission-detail__field--full">
            <dt>Impact story</dt>
            <dd class="submission-detail__body">${escapeHtml(submission.body)}</dd>
          </div>
          ${
            submission.imageUrl
              ? `
          <div class="submission-detail__field submission-detail__field--full">
            <dt>Image</dt>
            <dd>
              <a href="${escapeAttr(submission.imageUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(submission.imageUrl)}</a>
              <img class="submission-detail__image" src="${escapeAttr(submission.imageUrl)}" alt="" loading="lazy" />
            </dd>
          </div>`
              : ""
          }
          ${
            submission.linkUrl
              ? `
          <div class="submission-detail__field">
            <dt>Link</dt>
            <dd><a href="${escapeAttr(submission.linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(submission.linkUrl)}</a></dd>
          </div>`
              : ""
          }
        </dl>
        <div class="submission-detail__actions">
          <button type="button" id="submission-approve-btn" class="admin-btn--pill">Approve</button>
          <button type="button" id="submission-reject-btn" class="admin-btn--pill admin-btn--pill--purple">Reject</button>
        </div>
        <p id="submission-detail-error" class="admin-error" hidden></p>
      </article>
    `;

    submissionDetailHost.querySelector("#submission-approve-btn")?.addEventListener("click", () => {
      void handleApproveSubmission(submission.id);
    });
    submissionDetailHost.querySelector("#submission-reject-btn")?.addEventListener("click", () => {
      void handleRejectSubmission(submission.id);
    });
  };

  const showSubmissionError = (message: string): void => {
    if (activePanel === "submissions") {
      const errorEl = submissionDetailHost.querySelector("#submission-detail-error") as HTMLElement | null;
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        return;
      }
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
        const saved = await updateCard(card.id, {
          address: formState.address,
          lat: formState.lat,
          lng: formState.lng,
          mapX: formState.mapX,
          mapY: formState.mapY,
        });
        applySavedCard(saved);
        geocodeResult.textContent = `Approved and placed at ${result.displayName}. Drag the pin to fine-tune if needed.${geocodeAccuracyNote()}`;
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
      renderSubmissions();
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

  const applySavedCard = (saved: InfoCard): void => {
    const { id, ...state } = saved;
    selectedId = id;
    formState = state;
    const idx = cards.findIndex((c) => c.id === id);
    if (idx === -1) {
      cards.push(saved);
    } else {
      cards[idx] = saved;
    }
    deleteBtn.hidden = false;
    formTitle.textContent = "Edit card";
    fillForm(form, formState);
    renderList();
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const renderList = (): void => {
    if (cards.length === 0) {
      listEl.innerHTML = `<li class="admin-muted">No cards yet. Create one.</li>`;
      return;
    }
    listEl.innerHTML = cards
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
      button.addEventListener("mouseenter", () => mapEditor?.showCardPreview(id));
      button.addEventListener("mouseleave", () => mapEditor?.showCardPreview(null));
    });
  };

  const selectCard = (id: string, options: { openEditor?: boolean } = { openEditor: true }): void => {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    selectedId = id;
    formState = { ...card };
    formTitle.textContent = "Edit card";
    deleteBtn.hidden = false;
    geocodeResult.textContent = "";
    fillForm(form, formState);
    renderList();
    if (options.openEditor !== false) {
      showEditView();
    } else if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const refreshMapEditor = (): void => {
    const allowSelectedPinDrag = isEditViewOpen();
    mapEditor?.destroy();
    mapEditor = createMapEditor(
      mapHost,
      {
        pins: cards.map((c) => ({ id: c.id, label: c.title, mapX: c.mapX, mapY: c.mapY })),
        selectedId: allowSelectedPinDrag ? selectedId : null,
        draftPosition:
          allowSelectedPinDrag && !selectedId ? { mapX: formState.mapX, mapY: formState.mapY } : undefined,
        toDisplayCoords: mapXYOriginalToAdmin,
        fromDisplayCoords: mapXYAdminToOriginal,
        previewCards: cards,
        allowSelectedPinDrag,
      },
      {
        onPinMove(mapX, mapY) {
          formState.mapX = mapX;
          formState.mapY = mapY;
        },
      }
    );
  };

  const geocodeAccuracyNote = (): string =>
    calibrationPoints.length < 2 ? " (approximate — add calibration points for accuracy)" : "";

  const applyGeocodeToForm = (result: GeocodeResult): void => {
    formState.address = result.displayName;
    formState.lat = result.lat;
    formState.lng = result.lng;
    const { mapX, mapY } = projectLatLng(projection, result.lat, result.lng);
    formState.mapX = mapX;
    formState.mapY = mapY;
    fillForm(form, formState);
    mapEditor?.setSelectedPin(mapX, mapY);
  };

  root.querySelector("#new-card-btn")?.addEventListener("click", () => {
    selectedId = null;
    formState = emptyForm();
    formTitle.textContent = "New card";
    deleteBtn.hidden = true;
    geocodeResult.textContent = "";
    fillForm(form, formState);
    renderList();
    showEditView();
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  });

  root.querySelector("#edit-shelf-back")?.addEventListener("click", () => {
    showCardsView();
  });

  root.querySelector("#geocode-btn")?.addEventListener("click", async () => {
    const address = (form.elements.namedItem("address") as HTMLInputElement).value.trim();
    if (!address) {
      geocodeResult.textContent = "Enter an address first.";
      return;
    }

    try {
      geocodeResult.textContent = "Looking up…";
      const result = await geocodeAddress(address);
      applyGeocodeToForm(result);
      geocodeResult.textContent = result.displayName + geocodeAccuracyNote();
    } catch (error) {
      geocodeResult.textContent = error instanceof Error ? error.message : "Geocoding failed.";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.hidden = true;
    syncPinPositionFromMap();
    formState = readForm(form, formState);

    try {
      const saved = selectedId
        ? await updateCard(selectedId, formState)
        : await createCard(formState);
      applySavedCard(saved);
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
      formState = emptyForm();
      fillForm(form, formState);
      deleteBtn.hidden = true;
      formTitle.textContent = "New card";
      showCardsView();
      await load();
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : "Delete failed.";
      formError.hidden = false;
    }
  });

  await load();
}

function readForm(form: HTMLFormElement, current: FormState): FormState {
  const fd = new FormData(form);
  return {
    title: String(fd.get("title") || ""),
    companyName: String(fd.get("companyName") || ""),
    body: String(fd.get("body") || ""),
    address: String(fd.get("address") || ""),
    lat: current.lat,
    lng: current.lng,
    mapX: current.mapX,
    mapY: current.mapY,
    imageUrl: String(fd.get("imageUrl") || ""),
    linkUrl: String(fd.get("linkUrl") || ""),
    active: fd.get("active") === "on",
  };
}

function fillForm(form: HTMLFormElement, state: FormState): void {
  (form.elements.namedItem("title") as HTMLInputElement).value = state.title;
  (form.elements.namedItem("companyName") as HTMLInputElement).value = state.companyName || "";
  (form.elements.namedItem("body") as HTMLTextAreaElement).value = state.body;
  (form.elements.namedItem("address") as HTMLInputElement).value = state.address;
  (form.elements.namedItem("imageUrl") as HTMLInputElement).value = state.imageUrl || "";
  (form.elements.namedItem("linkUrl") as HTMLInputElement).value = state.linkUrl || "";
  (form.elements.namedItem("active") as HTMLInputElement).checked = state.active;
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
