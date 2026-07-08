import { geocodeAddress, saveCalibration } from "../shared/api";
import { describeProjection, latLngToMapXY, mapXYAdminToOriginal, mapXYOriginalToAdmin } from "../shared/geo";
import type { CalibrationPoint } from "../shared/types";
import { createMapEditor } from "./mapEditor";

export interface CalibrationPanelCallbacks {
  onChange: (points: CalibrationPoint[]) => void;
}

export function createCalibrationPanel(
  sideHost: HTMLElement,
  mapHost: HTMLElement,
  initialPoints: CalibrationPoint[],
  callbacks: CalibrationPanelCallbacks
): { getPoints: () => CalibrationPoint[]; refreshMap: () => void; destroy: () => void } {
  let points = [...initialPoints];
  let selectedId: string | null = points[0]?.id ?? null;
  let mapEditor: ReturnType<typeof createMapEditor> | null = null;

  sideHost.innerHTML = `
    <div class="calibration-side__controls">
      <p id="calibration-help" class="calibration__help">
        This map is artistic and does not match real-world geography. Add at least
        <strong>two</strong> cities you can identify on the wall map, drag each pin
        to its true spot, then save. Future geocoding uses that fit.
      </p>
      <p id="calibration-status" class="admin-muted calibration__status"></p>
      <div class="calibration__add">
        <input type="text" id="calibration-address" placeholder="City, Country" />
        <button type="button" id="calibration-add-btn" class="admin-btn--pill">Add point</button>
      </div>
      <p id="calibration-msg" class="calibration__msg admin-muted" hidden></p>
    </div>
    <div class="admin-scroll calibration-side__scroll">
      <ul class="calibration__list"></ul>
    </div>
    <div class="submission-sidebar__footer">
      <div class="submission-sidebar__actions">
        <button type="button" id="calibration-save-btn" class="admin-btn--pill">Save</button>
        <button type="button" id="calibration-delete-btn" class="admin-btn--pill admin-btn--pill--purple" disabled>Delete</button>
      </div>
    </div>
  `;

  const listEl = sideHost.querySelector(".calibration__list") as HTMLUListElement;
  const statusEl = sideHost.querySelector("#calibration-status") as HTMLElement;
  const addressInput = sideHost.querySelector("#calibration-address") as HTMLInputElement;
  const addBtn = sideHost.querySelector("#calibration-add-btn") as HTMLButtonElement;
  const saveBtn = sideHost.querySelector("#calibration-save-btn") as HTMLButtonElement;
  const deleteBtn = sideHost.querySelector("#calibration-delete-btn") as HTMLButtonElement;
  const msgEl = sideHost.querySelector("#calibration-msg") as HTMLElement;
  const helpEl = sideHost.querySelector("#calibration-help") as HTMLElement;
  const defaultAddressPlaceholder = "City, Country";

  mapHost.replaceChildren();

  const setAddressPlaceholder = (message?: string): void => {
    addressInput.placeholder = message
      ? `${defaultAddressPlaceholder} - ${message}`
      : defaultAddressPlaceholder;
  };

  const showSaveMessage = (message: string): void => {
    msgEl.textContent = message;
    msgEl.hidden = !message;
  };

  addressInput.addEventListener("input", () => {
    if (addressInput.placeholder !== defaultAddressPlaceholder) {
      setAddressPlaceholder();
    }
  });

  const refreshStatus = (): void => {
    statusEl.textContent = describeProjection(points);
    helpEl.hidden = points.length >= 2;
  };

  const updateDeleteAction = (): void => {
    deleteBtn.disabled = !selectedId || !points.some((point) => point.id === selectedId);
  };

  const removeSelectedPoint = (): void => {
    if (!selectedId) return;
    points = points.filter((point) => point.id !== selectedId);
    selectedId = points[0]?.id ?? null;
    refreshList();
    refreshMap();
    refreshStatus();
    updateDeleteAction();
  };

  const refreshList = (): void => {
    if (points.length === 0) {
      listEl.innerHTML = `<li class="admin-muted">No calibration points yet.</li>`;
      updateDeleteAction();
      return;
    }
    listEl.innerHTML = points
      .map(
        (p) => `
          <li class="calibration__item ${p.id === selectedId ? "calibration__item--active" : ""}">
            <button type="button" class="calibration__select" data-id="${escapeAttr(p.id)}">
              <strong>${escapeHtml(p.label || "Untitled")}</strong>
              <span>${p.lat.toFixed(2)}°, ${p.lng.toFixed(2)}°</span>
            </button>
          </li>
        `
      )
      .join("");

    listEl.querySelectorAll(".calibration__select").forEach((btn) => {
      const id = btn.getAttribute("data-id");
      btn.addEventListener("click", () => {
        selectedId = id;
        refreshList();
        refreshMap();
        updateDeleteAction();
      });
      if (id) {
        btn.addEventListener("mouseenter", () => mapEditor?.showCardPreview(id));
        btn.addEventListener("mouseleave", () => mapEditor?.showCardPreview(null));
      }
    });

    updateDeleteAction();
  };

  const buildCalibrationPreviewHtml = (pinId: string): string | null => {
    const point = points.find((p) => p.id === pinId);
    if (!point) return null;
    return `
      <strong class="ar-card__title">${escapeHtml(point.label || "Untitled")}</strong>
      <span class="ar-card__address">${point.lat.toFixed(4)}°, ${point.lng.toFixed(4)}°</span>
    `;
  };

  const refreshMap = (): void => {
    mapEditor?.destroy();
    mapEditor = createMapEditor(
      mapHost,
      {
        pins: points.map((p) => ({ id: p.id, label: p.label, mapX: p.mapX, mapY: p.mapY })),
        selectedId,
        pinClass: "map-editor__pin--calibration",
        toDisplayCoords: mapXYOriginalToAdmin,
        fromDisplayCoords: mapXYAdminToOriginal,
        getPreviewHtml: buildCalibrationPreviewHtml,
        allowSelectedPinDrag: true,
      },
      {
        onPinMove(mapX, mapY) {
          if (!selectedId) return;
          const idx = points.findIndex((p) => p.id === selectedId);
          if (idx === -1) return;
          points[idx] = { ...points[idx], mapX, mapY };
        },
      }
    );
  };

  addBtn.addEventListener("click", async () => {
    const query = addressInput.value.trim();
    if (!query) {
      setAddressPlaceholder("Enter a city first.");
      return;
    }
    addBtn.disabled = true;
    setAddressPlaceholder("Looking up…");
    try {
      const result = await geocodeAddress(query);
      const { mapX, mapY } = latLngToMapXY(result.lat, result.lng);
      const point: CalibrationPoint = {
        id: crypto.randomUUID(),
        label: result.displayName.split(",")[0]?.trim() || query,
        lat: result.lat,
        lng: result.lng,
        mapX,
        mapY,
      };
      points.push(point);
      selectedId = point.id;
      addressInput.value = "";
      setAddressPlaceholder();
      showSaveMessage("Drag the teal pin to the correct spot on the map, then save.");
      refreshList();
      refreshMap();
      refreshStatus();
    } catch (error) {
      setAddressPlaceholder(error instanceof Error ? error.message : "Geocoding failed.");
    } finally {
      addBtn.disabled = false;
    }
  });

  const syncSelectedPinPosition = (): void => {
    const pos = mapEditor?.getSelectedPinPosition();
    if (!pos || !selectedId) return;
    const idx = points.findIndex((p) => p.id === selectedId);
    if (idx === -1) return;
    points[idx] = { ...points[idx], mapX: pos.mapX, mapY: pos.mapY };
  };

  deleteBtn.addEventListener("click", () => {
    removeSelectedPoint();
  });

  saveBtn.addEventListener("click", async () => {
    syncSelectedPinPosition();
    saveBtn.disabled = true;
    showSaveMessage("Saving…");
    try {
      points = await saveCalibration(points);
      callbacks.onChange(points);
      showSaveMessage("Calibration saved.");
      refreshList();
      refreshStatus();
    } catch (error) {
      showSaveMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  refreshStatus();
  refreshList();
  refreshMap();

  return {
    getPoints: () => points,
    refreshMap,
    destroy: () => {
      mapEditor?.destroy();
    },
  };
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
