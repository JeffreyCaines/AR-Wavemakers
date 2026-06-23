import "./styles.css";
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
  setAdminToken,
  updateCard,
  verifyAdminPassword,
} from "../shared/api";
import { buildProjection, describeProjection, projectLatLng, type Projection } from "../shared/geo";
import type { CalibrationPoint, InfoCard, StorySubmission } from "../shared/types";
import { createCalibrationPanel } from "./calibrationPanel";
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
    renderLogin(root);
    return;
  }

  renderDashboard(root);
}

function renderLogin(root: HTMLElement): void {
  root.innerHTML = `
    <div class="admin admin--login">
      <form class="admin-login" id="login-form">
        <h1>Admin Dashboard</h1>
        <p>Enter the admin password to manage info cards.</p>
        <input type="password" id="login-password" placeholder="Password" required autocomplete="current-password" />
        <button type="submit">Sign in</button>
        <p id="login-error" class="admin-error" hidden></p>
      </form>
    </div>
  `;

  const form = root.querySelector("#login-form") as HTMLFormElement;
  const errorEl = root.querySelector("#login-error") as HTMLElement;
  const submitBtn = form.querySelector("button[type=submit]") as HTMLButtonElement;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = (root.querySelector("#login-password") as HTMLInputElement).value;
    errorEl.hidden = true;
    submitBtn.disabled = true;

    try {
      const { ok, status } = await verifyAdminPassword(password);
      if (!ok) {
        if (status === 401) {
          errorEl.textContent = "Invalid password.";
        } else if (status === 404) {
          errorEl.textContent =
            "API not found (404). Check that Netlify Functions deployed and /api/cards/all is reachable.";
        } else {
          errorEl.textContent = `Sign-in failed (HTTP ${status}). Check Netlify function logs.`;
        }
        errorEl.hidden = false;
        return;
      }
      setAdminToken(password);
      renderDashboard(root);
    } catch {
      errorEl.textContent = "Could not reach the server.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function renderDashboard(root: HTMLElement): void {
  root.innerHTML = `
    <div class="admin">
      <header class="admin-header">
        <div>
          <a href="https://technl.ca/">
          <img src="/wp-content/uploads/2021/08/TechNL-Logo_Black.png" width="1080" height="424" alt="techNL" id="logo" data-height-percentage="54" data-actual-width="1080" data-actual-height="424">
          </a>
          <p>Place cards on the world map for the AR experience.</p>
        </div>
        <div class="admin-header__actions">
          <a href="/share-story.html" class="admin-link">Share story form</a>
          <a href="/" class="admin-link">Open AR Viewer</a>
          <button type="button" id="logout-btn" class="admin-btn admin-btn--ghost">Sign out</button>
        </div>
      </header>
      <div class="admin-layout">
        <div class="admin-sidebar">
          <section class="admin-panel admin-panel--submissions">
            <div class="admin-panel__head">
              <h2>Pending submissions <span id="submission-count" class="admin-badge" hidden>0</span></h2>
            </div>
            <ul id="submission-list" class="admin-submission-list"></ul>
          </section>
          <section class="admin-panel admin-panel--cards">
            <div class="admin-panel__head">
              <h2>Cards</h2>
              <button type="button" id="new-card-btn" class="admin-btn">New card</button>
            </div>
            <div class="admin-scroll admin-panel__body">
              <ul id="card-list" class="admin-card-list"></ul>
            </div>
          </section>
        </div>
        <section class="admin-panel admin-panel--editor">
          <h2 id="form-title">Edit card</h2>
          <div class="admin-scroll admin-panel__body">
          <form id="card-form" class="admin-form">
            <label>Title<input name="title" required /></label>
            <label>Company<input name="companyName" /></label>
            <label>Impact story<textarea name="body" rows="4" required></textarea></label>
            <label>Address<input name="address" placeholder="City, Country" /></label>
            <div class="admin-form__row">
              <button type="button" id="geocode-btn" class="admin-btn admin-btn--ghost">Geocode address</button>
              <span id="geocode-result" class="admin-muted"></span>
            </div>
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
          <button type="button" id="calibrate-toggle-btn" class="admin-btn admin-btn--ghost admin-calibrate-toggle" aria-expanded="false">Calibrate Map</button>
          <div id="calibration-host" hidden></div>
          </div>
        </section>
      </div>
    </div>
  `;

  root.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearAdminToken();
    renderLogin(root);
  });

  lockNativeScroll(root.querySelector(".admin") as HTMLElement);
  void setupDashboard(root);
}

function lockNativeScroll(container: HTMLElement): void {
  const allowScroll = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(".admin-scroll, .admin-panel--submissions"));
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
  let formState = emptyForm();
  let mapEditor: ReturnType<typeof createMapEditor> | null = null;
  let calibrationPanel: ReturnType<typeof createCalibrationPanel> | null = null;

  const listEl = root.querySelector("#card-list") as HTMLUListElement;
  const submissionListEl = root.querySelector("#submission-list") as HTMLUListElement;
  const submissionCountEl = root.querySelector("#submission-count") as HTMLElement;
  const form = root.querySelector("#card-form") as HTMLFormElement;
  const formTitle = root.querySelector("#form-title") as HTMLElement;
  const formError = root.querySelector("#form-error") as HTMLElement;
  const geocodeResult = root.querySelector("#geocode-result") as HTMLElement;
  const geocodeHint = root.querySelector("#geocode-hint") as HTMLElement;
  const calibrationHost = root.querySelector("#calibration-host") as HTMLElement;
  const calibrateToggleBtn = root.querySelector("#calibrate-toggle-btn") as HTMLButtonElement;
  const mapHost = root.querySelector("#map-editor-host") as HTMLElement;
  const deleteBtn = root.querySelector("#delete-btn") as HTMLButtonElement;

  calibrateToggleBtn.addEventListener("click", () => {
    const open = calibrationHost.hidden;
    calibrationHost.hidden = !open;
    calibrateToggleBtn.setAttribute("aria-expanded", String(open));
  });

  const applyCalibration = (points: CalibrationPoint[]): void => {
    calibrationPoints = points;
    projection = buildProjection(points);
    geocodeHint.textContent =
      points.length >= 2
        ? `${describeProjection(points)} Drag the green pin to fine-tune if needed.`
        : "Open Calibrate Map and add at least 2 points for accurate geocoding. Until then, placement is approximate — drag the pin manually.";
  };

  const mountCalibrationPanel = (): void => {
    calibrationPanel?.destroy();
    calibrationPanel = createCalibrationPanel(calibrationHost, calibrationPoints, {
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
    refreshMapEditor();
  };

  const renderSubmissions = (): void => {
    const count = submissions.length;
    submissionCountEl.textContent = String(count);
    submissionCountEl.hidden = count === 0;

    if (count === 0) {
      submissionListEl.innerHTML = `<li class="admin-muted">No pending submissions.</li>`;
      return;
    }

    submissionListEl.innerHTML = submissions
      .map(
        (submission) => `
          <li class="admin-submission">
            <div class="admin-submission__body">
              <strong>${escapeHtml(submission.title)}</strong>
              <span>${escapeHtml(submission.companyName || "No company")}</span>
              <span>${escapeHtml(submission.address)}</span>
              <time class="admin-muted">${formatSubmittedAt(submission.submittedAt)}</time>
            </div>
            <div class="admin-submission__actions">
              <button type="button" class="admin-btn admin-btn--small" data-approve="${escapeAttr(submission.id)}">Approve</button>
              <button type="button" class="admin-btn admin-btn--ghost admin-btn--small" data-reject="${escapeAttr(submission.id)}">Reject</button>
            </div>
          </li>
        `
      )
      .join("");

    submissionListEl.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void handleApproveSubmission(btn.getAttribute("data-approve")!);
      });
    });

    submissionListEl.querySelectorAll("[data-reject]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void handleRejectSubmission(btn.getAttribute("data-reject")!);
      });
    });
  };

  const handleApproveSubmission = async (id: string): Promise<void> => {
    const submission = submissions.find((s) => s.id === id);
    if (!submission) return;
    if (!confirm(`Approve "${submission.title}" and add it as an inactive card for map placement?`)) return;

    try {
      const card = await approveSubmission(id);
      submissions = submissions.filter((s) => s.id !== id);
      renderSubmissions();
      applySavedCard(card);
      geocodeResult.textContent = "Approved — geocode the address and drag the pin, then activate when ready.";
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : "Approval failed.";
      formError.hidden = false;
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
      formError.textContent = error instanceof Error ? error.message : "Rejection failed.";
      formError.hidden = false;
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
    refreshMapEditor();
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
    refreshMapEditor();
  };

  const refreshMapEditor = (): void => {
    mapEditor?.destroy();
    mapEditor = createMapEditor(
      mapHost,
      {
        pins: cards.map((c) => ({ id: c.id, label: c.title, mapX: c.mapX, mapY: c.mapY })),
        selectedId,
        draftPosition: selectedId ? undefined : { mapX: formState.mapX, mapY: formState.mapY },
      },
      {
        onPinMove(mapX, mapY) {
          formState.mapX = mapX;
          formState.mapY = mapY;
        },
      }
    );
  };

  root.querySelector("#new-card-btn")?.addEventListener("click", () => {
    selectedId = null;
    formState = emptyForm();
    formTitle.textContent = "New card";
    deleteBtn.hidden = true;
    geocodeResult.textContent = "";
    fillForm(form, formState);
    renderList();
    refreshMapEditor();
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
      formState.address = result.displayName;
      formState.lat = result.lat;
      formState.lng = result.lng;
      const { mapX, mapY } = projectLatLng(projection, result.lat, result.lng);
      formState.mapX = mapX;
      formState.mapY = mapY;
      fillForm(form, formState);
      mapEditor?.setSelectedPin(mapX, mapY);
      geocodeResult.textContent = result.displayName;
      if (calibrationPoints.length < 2) {
        geocodeResult.textContent += " (approximate — add calibration points for accuracy)";
      }
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
