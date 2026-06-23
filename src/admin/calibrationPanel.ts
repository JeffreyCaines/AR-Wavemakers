import { geocodeAddress, saveCalibration } from "../shared/api";
import { describeProjection, latLngToMapXY } from "../shared/geo";
import type { CalibrationPoint } from "../shared/types";
import { createMapEditor } from "./mapEditor";

export interface CalibrationPanelCallbacks {
  onChange: (points: CalibrationPoint[]) => void;
}

export function createCalibrationPanel(
  container: HTMLElement,
  initialPoints: CalibrationPoint[],
  callbacks: CalibrationPanelCallbacks
): { getPoints: () => CalibrationPoint[]; destroy: () => void } {
  let points = [...initialPoints];
  let selectedId: string | null = points[0]?.id ?? null;
  let mapEditor: ReturnType<typeof createMapEditor> | null = null;

  container.innerHTML = `
    <div class="calibration">
      <div class="calibration__head">
        <h3>Map calibration</h3>
        <p id="calibration-status" class="admin-muted"></p>
      </div>
      <p class="calibration__help">
        This map is artistic and does not match real-world geography. Add at least
        <strong>two</strong> cities you can identify on the wall map, drag each pin
        to its true spot, then save. Future geocoding uses that fit.
      </p>
      <div class="calibration__add">
        <input type="text" id="calibration-address" placeholder="City, Country" />
        <button type="button" id="calibration-add-btn" class="admin-btn admin-btn--ghost">Add point</button>
      </div>
      <ul id="calibration-list" class="calibration__list"></ul>
      <div id="calibration-map-host" class="admin-map-host"></div>
      <div class="calibration__actions">
        <button type="button" id="calibration-save-btn" class="admin-btn">Save calibration</button>
        <span id="calibration-msg" class="admin-muted"></span>
      </div>
    </div>
  `;

  const statusEl = container.querySelector("#calibration-status") as HTMLElement;
  const listEl = container.querySelector("#calibration-list") as HTMLUListElement;
  const mapHost = container.querySelector("#calibration-map-host") as HTMLElement;
  const addressInput = container.querySelector("#calibration-address") as HTMLInputElement;
  const addBtn = container.querySelector("#calibration-add-btn") as HTMLButtonElement;
  const saveBtn = container.querySelector("#calibration-save-btn") as HTMLButtonElement;
  const msgEl = container.querySelector("#calibration-msg") as HTMLElement;

  const refreshStatus = (): void => {
    statusEl.textContent = describeProjection(points);
  };

  const refreshList = (): void => {
    if (points.length === 0) {
      listEl.innerHTML = `<li class="admin-muted">No calibration points yet.</li>`;
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
            <button type="button" class="calibration__delete admin-btn admin-btn--danger" data-id="${escapeAttr(p.id)}" title="Remove">×</button>
          </li>
        `
      )
      .join("");

    listEl.querySelectorAll(".calibration__select").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedId = btn.getAttribute("data-id");
        refreshList();
        refreshMap();
      });
    });

    listEl.querySelectorAll(".calibration__delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        points = points.filter((p) => p.id !== id);
        if (selectedId === id) selectedId = points[0]?.id ?? null;
        refreshList();
        refreshMap();
        refreshStatus();
      });
    });
  };

  const refreshMap = (): void => {
    mapEditor?.destroy();
    mapEditor = createMapEditor(
      mapHost,
      {
        pins: points.map((p) => ({ id: p.id, label: p.label, mapX: p.mapX, mapY: p.mapY })),
        selectedId,
        pinClass: "map-editor__pin--calibration",
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
      msgEl.textContent = "Enter a city first.";
      return;
    }
    addBtn.disabled = true;
    msgEl.textContent = "Looking up…";
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
      msgEl.textContent = "Drag the orange pin to the correct spot on the map, then save.";
      refreshList();
      refreshMap();
      refreshStatus();
    } catch (error) {
      msgEl.textContent = error instanceof Error ? error.message : "Geocoding failed.";
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

  saveBtn.addEventListener("click", async () => {
    syncSelectedPinPosition();
    saveBtn.disabled = true;
    msgEl.textContent = "Saving…";
    try {
      points = await saveCalibration(points);
      callbacks.onChange(points);
      msgEl.textContent = "Calibration saved.";
      refreshList();
      refreshStatus();
    } catch (error) {
      msgEl.textContent = error instanceof Error ? error.message : "Save failed.";
    } finally {
      saveBtn.disabled = false;
    }
  });

  refreshStatus();
  refreshList();
  refreshMap();

  return {
    getPoints: () => points,
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
