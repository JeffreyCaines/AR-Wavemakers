import { saveRipplesAnchor } from "../shared/api";
import { mapXYAdminToOriginal, mapXYOriginalToAdmin } from "../shared/geo";
import { normalizeRipplesAnchor } from "../shared/ripplesAnchor";
import type { RipplesAnchor, RipplesVariant } from "../shared/types";
import { getRipplesPlacement } from "../shared/types";
import { createMapEditor } from "./mapEditor";

export interface RipplesAnchorPanelCallbacks {
  onChange: (anchor: RipplesAnchor) => void;
}

function variantLabel(variant: RipplesVariant): string {
  return variant === "fade" ? "Fade" : "Loop";
}

export function createRipplesAnchorPanel(
  sideHost: HTMLElement,
  mapHost: HTMLElement,
  initialAnchor: RipplesAnchor,
  callbacks: RipplesAnchorPanelCallbacks
): { getAnchor: () => RipplesAnchor; refreshMap: () => void; destroy: () => void } {
  let anchor = normalizeRipplesAnchor(initialAnchor);
  let editingVariant: RipplesVariant = anchor.activeVariant;
  let mapEditor: ReturnType<typeof createMapEditor> | null = null;

  sideHost.innerHTML = `
    <div class="calibration-side">
      <div class="calibration-side__controls">
        <p class="calibration__help">
          Pick a shader variant, drag on the map to move the ripple origin, then save.
          Choose which variant the AR viewer shader uses.
        </p>
        <div class="admin-form__tabs ripples-variant-tabs" role="tablist" aria-label="Ripples shader variant to edit">
          <button type="button" class="admin-form__tab admin-form__tab--active" role="tab" aria-selected="true" data-ripples-variant="loop">
            Loop
          </button>
          <button type="button" class="admin-form__tab" role="tab" aria-selected="false" data-ripples-variant="fade">
            Fade
          </button>
        </div>
        <fieldset class="ripples-active-fieldset">
          <legend class="ripples-active-fieldset__legend">Active in AR viewer</legend>
          <label class="ripples-active-option">
            <input type="radio" name="ripples-active-variant" value="loop" />
            Loop
          </label>
          <label class="ripples-active-option">
            <input type="radio" name="ripples-active-variant" value="fade" />
            Fade
          </label>
        </fieldset>
        <p class="calibration__status admin-muted"></p>
        <p id="ripples-msg" class="calibration__msg admin-muted" hidden></p>
      </div>
      <div class="submission-sidebar__footer">
        <div class="submission-sidebar__actions">
          <button type="button" id="ripples-save-btn" class="admin-btn--pill">Save</button>
        </div>
      </div>
    </div>
  `;

  const statusEl = sideHost.querySelector(".calibration__status") as HTMLElement;
  const saveBtn = sideHost.querySelector("#ripples-save-btn") as HTMLButtonElement;
  const msgEl = sideHost.querySelector("#ripples-msg") as HTMLElement;
  const variantTabs = sideHost.querySelectorAll<HTMLButtonElement>("[data-ripples-variant]");
  const activeRadios = sideHost.querySelectorAll<HTMLInputElement>('input[name="ripples-active-variant"]');

  mapHost.replaceChildren();

  const showMessage = (message: string): void => {
    msgEl.textContent = message;
    msgEl.hidden = !message;
  };

  const syncVariantControls = (): void => {
    variantTabs.forEach((tab) => {
      const variant = tab.dataset.ripplesVariant as RipplesVariant;
      const selected = variant === editingVariant;
      tab.classList.toggle("admin-form__tab--active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    activeRadios.forEach((radio) => {
      radio.checked = radio.value === anchor.activeVariant;
    });
  };

  const refreshStatus = (): void => {
    const placement = getRipplesPlacement(anchor, editingVariant);
    statusEl.textContent = `Editing ${variantLabel(editingVariant)} at ${formatCoords(placement.mapX, placement.mapY)} · AR uses ${variantLabel(anchor.activeVariant)}`;
  };

  const syncEditingPlacementFromMap = (): void => {
    const pos = mapEditor?.getOverlayPosition();
    if (!pos) return;
    anchor = {
      ...anchor,
      [editingVariant]: {
        ...getRipplesPlacement(anchor, editingVariant),
        mapX: pos.mapX,
        mapY: pos.mapY,
      },
    };
  };

  const refreshMap = (): void => {
    syncEditingPlacementFromMap();
    mapEditor?.destroy();
    const placement = getRipplesPlacement(anchor, editingVariant);
    mapEditor = createMapEditor(
      mapHost,
      {
        pins: [],
        selectedId: null,
        toDisplayCoords: mapXYOriginalToAdmin,
        fromDisplayCoords: mapXYAdminToOriginal,
        ripplesShader: {
          variant: editingVariant,
          originMapX: placement.mapX,
          originMapY: placement.mapY,
        },
        allowRipplesOriginDrag: true,
      },
      {
        onPinMove: () => undefined,
        onOverlayMove(mapX, mapY) {
          anchor = {
            ...anchor,
            [editingVariant]: {
              ...getRipplesPlacement(anchor, editingVariant),
              mapX,
              mapY,
            },
          };
          refreshStatus();
        },
      }
    );
    syncVariantControls();
    refreshStatus();
  };

  variantTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const variant = tab.dataset.ripplesVariant;
      if (variant !== "loop" && variant !== "fade") return;
      syncEditingPlacementFromMap();
      editingVariant = variant;
      refreshMap();
    });
  });

  activeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      const variant = radio.value;
      if (variant !== "loop" && variant !== "fade") return;
      anchor = { ...anchor, activeVariant: variant };
      refreshStatus();
    });
  });

  saveBtn.addEventListener("click", async () => {
    syncEditingPlacementFromMap();

    saveBtn.disabled = true;
    showMessage("Saving…");
    try {
      anchor = normalizeRipplesAnchor(await saveRipplesAnchor(anchor));
      callbacks.onChange(anchor);
      refreshStatus();
      showMessage("Ripples anchor saved.");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  syncVariantControls();
  refreshMap();

  return {
    getAnchor: () => anchor,
    refreshMap,
    destroy: () => {
      mapEditor?.destroy();
    },
  };
}

function formatCoords(mapX: number, mapY: number): string {
  return `(${mapX.toFixed(3)}, ${mapY.toFixed(3)})`;
}
