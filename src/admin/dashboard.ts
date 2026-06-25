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
import { buildProjection, describeProjection, mapXYAdminToOriginal, mapXYOriginalToAdmin, projectLatLng, type Projection } from "../shared/geo";
import type { CalibrationPoint, GeocodeResult, InfoCard, StorySubmission } from "../shared/types";
import { createCalibrationPanel } from "./calibrationPanel";
import { renderAdminLogin } from "./login";
import { createMapEditor } from "./mapEditor";

type FormState = Omit<InfoCard, "id">;

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
        <div class="admin-header__brand">
          <a href="https://technl.ca/">
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
          <button type="button" id="logout-btn" class="admin-btn admin-btn--ghost">Sign out</button>
        </div>
      </header>
      <div class="admin-layout">
        <section class="admin-panel admin-panel--editor">
          <div id="edit-cards-section" class="admin-panel__body edit-cards-section" hidden>
            <h2 id="form-title">Edit card</h2>
            <form id="card-form" class="admin-form">
              <label>Title<input name="title" required /></label>
              <label>Company<input name="companyName" /></label>
              <label>Impact story<textarea name="body" rows="4" required></textarea></label>
              <label class="admin-form__address">
                Address
                <span class="admin-form__address-row">
                  <input name="address" placeholder="City, Country" />
                  <button type="button" id="geocode-btn" class="admin-btn admin-btn--ghost">Geocode address</button>
                </span>
              </label>
              <span id="geocode-result" class="admin-muted admin-form__geocode-result"></span>
              <small class="admin-attribution">Geocoding &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</small>
              <label>Image URL<input name="imageUrl" type="url" placeholder="https://…" /></label>
              <label>Link URL<input name="linkUrl" type="url" placeholder="https://…" /></label>
              <label class="admin-checkbox"><input name="active" type="checkbox" checked /> Active</label>
              <div class="admin-form__actions">
                <button type="submit" class="admin-btn">Save</button>
                <button type="button" id="delete-btn" class="admin-btn admin-btn--danger" hidden>Delete</button>
              </div>
              <p id="form-error" class="admin-error" hidden></p>
            </form>
            <div id="map-editor-host" class="admin-map-host"></div>
            <p id="geocode-hint" class="admin-muted">Drag the selected (green) pin to fine-tune placement on the map.</p>
          </div>
          <div id="calibration-section" class="admin-panel__body calibration-section" hidden>
            <div id="calibration-host"></div>
          </div>
          <div id="submissions-section" class="admin-scroll admin-panel__body" hidden>
            <div id="submission-detail-host"></div>
          </div>
        </section>
        <div class="admin-sidebar">
          <section class="admin-panel admin-panel--sidebar-placeholder" id="sidebar-placeholder"></section>
          <section class="admin-panel admin-panel--submissions" id="submissions-sidebar-panel" hidden>
            <div class="admin-panel__head">
              <h2>Pending submissions <span id="submission-count" class="admin-badge" hidden>0</span></h2>
            </div>
            <div class="admin-scroll admin-panel__body">
              <ul id="submission-list" class="admin-card-list"></ul>
            </div>
          </section>
          <section class="admin-panel admin-panel--cards" hidden>
            <div class="admin-panel__head">
              <h2>Cards</h2>
              <button type="button" id="new-card-btn" class="admin-btn">New card</button>
            </div>
            <div class="admin-scroll admin-panel__body">
              <ul id="card-list" class="admin-card-list"></ul>
            </div>
          </section>
          <section class="admin-panel admin-panel--calibration-list" id="calibration-sidebar-panel" hidden>
            <div class="admin-panel__head">
              <h2>Calibration points</h2>
            </div>
            <div class="admin-scroll admin-panel__body" id="calibration-list-host"></div>
          </section>
        </div>
      </div>
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

  void setupDashboard(root);
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
  const geocodeHint = root.querySelector("#geocode-hint") as HTMLElement;
  const editCardsSection = root.querySelector("#edit-cards-section") as HTMLElement;
  const calibrationSection = root.querySelector("#calibration-section") as HTMLElement;
  const calibrationHost = root.querySelector("#calibration-host") as HTMLElement;
  const editCardsToggleBtn = root.querySelector("#edit-cards-toggle-btn") as HTMLButtonElement;
  const calibrateToggleBtn = root.querySelector("#calibrate-toggle-btn") as HTMLButtonElement;
  const submissionsToggleBtn = root.querySelector("#submissions-toggle-btn") as HTMLButtonElement;
  const submissionsSection = root.querySelector("#submissions-section") as HTMLElement;
  const cardsSidebarPanel = root.querySelector(".admin-panel--cards") as HTMLElement;
  const calibrationSidebarPanel = root.querySelector("#calibration-sidebar-panel") as HTMLElement;
  const submissionsSidebarPanel = root.querySelector("#submissions-sidebar-panel") as HTMLElement;
  const sidebarPlaceholder = root.querySelector("#sidebar-placeholder") as HTMLElement;
  const calibrationListHost = root.querySelector("#calibration-list-host") as HTMLElement;
  const mapHost = root.querySelector("#map-editor-host") as HTMLElement;
  const deleteBtn = root.querySelector("#delete-btn") as HTMLButtonElement;
  const impactStoryInput = form.elements.namedItem("body") as HTMLTextAreaElement;
  let impactStoryMinHeightPx = 0;

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
    sidebarPlaceholder.hidden = activePanel !== null;
    cardsSidebarPanel.hidden = activePanel !== "edit";
    calibrationSidebarPanel.hidden = activePanel !== "calibrate";
    submissionsSidebarPanel.hidden = activePanel !== "submissions";
  };

  const updatePanelVisibility = (): void => {
    editCardsSection.hidden = activePanel !== "edit";
    calibrationSection.hidden = activePanel !== "calibrate";
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
    geocodeHint.textContent =
      points.length >= 2
        ? `${describeProjection(points)} Drag the green pin to fine-tune if needed.`
        : "Open Calibrate map and add at least 2 points for accurate geocoding. Until then, placement is approximate — drag the pin manually.";
  };

  const mountCalibrationPanel = (): void => {
    calibrationPanel?.destroy();
    calibrationPanel = createCalibrationPanel(calibrationListHost, calibrationHost, calibrationPoints, {
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
      selectCard(selectedId);
      return;
    }
    if (!selectedId && cards.length > 0) {
      selectCard(cards[0].id);
      return;
    }
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
          <button type="button" id="submission-approve-btn" class="admin-btn">Approve</button>
          <button type="button" id="submission-reject-btn" class="admin-btn admin-btn--ghost">Reject</button>
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
      button.addEventListener("click", () => selectCard(button.getAttribute("data-id")!));
    });
  };

  const selectCard = (id: string): void => {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    selectedId = id;
    formState = { ...card };
    formTitle.textContent = "Edit card";
    deleteBtn.hidden = false;
    geocodeResult.textContent = "";
    fillForm(form, formState);
    renderList();
    if (activePanel === "edit") {
      refreshMapEditor();
    }
  };

  const refreshMapEditor = (): void => {
    mapEditor?.destroy();
    mapEditor = createMapEditor(
      mapHost,
      {
        pins: cards.map((c) => ({ id: c.id, label: c.title, mapX: c.mapX, mapY: c.mapY })),
        selectedId,
        draftPosition: selectedId ? undefined : { mapX: formState.mapX, mapY: formState.mapY },
        toDisplayCoords: mapXYOriginalToAdmin,
        fromDisplayCoords: mapXYAdminToOriginal,
        previewCards: cards,
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
    if (activePanel === "edit") {
      refreshMapEditor();
    }
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
