import { saveRipplesAnchor } from "../shared/api";
import { mapXYAdminToOriginal, mapXYOriginalToAdmin } from "../shared/geo";
import { normalizeRipplesAnchor } from "../shared/ripplesAnchor";
import type { RipplesAnchor } from "../shared/types";
import { getRipplesPlacement } from "../shared/types";
import { createMapEditor } from "./mapEditor";
import type { Layer7Edge } from "./modelRippleMasks";
import {
  DEFAULT_MODEL_RIPPLES_VISUALS,
  type ModelRipplesVisuals,
} from "./modelRipplesVisuals";

export interface RipplesAnchorPanelCallbacks {
  onChange: (anchor: RipplesAnchor) => void;
}

function formatSliderValue(name: string, value: number): string {
  if (name === "ringCount") return String(Math.round(value));
  if (name === "lineWidthPx" || name === "expansionSec") return value.toFixed(1);
  return value.toFixed(2);
}

function sliderRow(
  name: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number
): string {
  return `
    <label class="ripples-slider-row">
      <span class="ripples-slider-row__label">${label}</span>
      <span class="ripples-slider-row__value" data-ripples-value="${name}">${formatSliderValue(name, value)}</span>
      <input
        class="ripples-slider"
        type="range"
        data-ripples-slider="${name}"
        min="${min}"
        max="${max}"
        step="${step}"
        value="${value}"
      />
    </label>
  `;
}

function formatCoords(mapX: number, mapY: number): string {
  return `(${mapX.toFixed(3)}, ${mapY.toFixed(3)})`;
}

export function createRipplesAnchorPanel(
  sideHost: HTMLElement,
  mapHost: HTMLElement,
  initialAnchor: RipplesAnchor,
  callbacks: RipplesAnchorPanelCallbacks
): { getAnchor: () => RipplesAnchor; refreshMap: () => void; destroy: () => void } {
  return createModelRipplesPanel(sideHost, mapHost, initialAnchor, callbacks);
}

function createModelRipplesPanel(
  sideHost: HTMLElement,
  mapHost: HTMLElement,
  initialAnchor: RipplesAnchor,
  callbacks: RipplesAnchorPanelCallbacks
): { getAnchor: () => RipplesAnchor; refreshMap: () => void; destroy: () => void } {
  let anchor = normalizeRipplesAnchor(initialAnchor);
  let layer7Edge: Layer7Edge = "outer";
  let visuals: ModelRipplesVisuals = { ...DEFAULT_MODEL_RIPPLES_VISUALS };
  let shaderSource: "model" | "custom" = "custom";
  let mapEditor: ReturnType<typeof createMapEditor> | null = null;

  sideHost.innerHTML = `
    <div class="calibration-side">
      <div class="admin-scroll calibration-side__scroll admin-list-scroll">
        <fieldset class="ripples-active-fieldset">
          <legend class="ripples-active-fieldset__legend">Shader</legend>
          <label class="ripples-active-option">
            <input type="radio" name="ripples-source" value="model" />
            3D model
          </label>
          <label class="ripples-active-option">
            <input type="radio" name="ripples-source" value="custom" checked />
            Ripples shader
          </label>
        </fieldset>
        <div id="ripples-custom-settings">
        <fieldset class="ripples-active-fieldset">
          <legend class="ripples-active-fieldset__legend">Layer 7 cutoff</legend>
          <label class="ripples-active-option">
            <input type="radio" name="ripples-layer7-edge" value="outer" checked />
            Outer edge
          </label>
          <label class="ripples-active-option">
            <input type="radio" name="ripples-layer7-edge" value="inner" />
            Inner edge
          </label>
        </fieldset>
        <p class="calibration__status admin-muted"></p>
        <p id="ripples-msg" class="calibration__msg admin-muted" hidden></p>
        <fieldset class="ripples-active-fieldset ripples-visuals-fieldset">
          <legend class="ripples-active-fieldset__legend">Ripples settings</legend>
          ${sliderRow("ringCount", "Rings", visuals.ringCount, 1, 8, 1)}
          ${sliderRow("lineWidthPx", "Line width", visuals.lineWidthPx, 1, 40, 0.5)}
          ${sliderRow("maxRadius", "Max radius", visuals.maxRadius, 0.1, 1.5, 0.05)}
          ${sliderRow("expansionSec", "Expand time (s)", visuals.expansionSec, 0.5, 12, 0.1)}
          ${sliderRow("spawnDelaySec", "Spawn delay (s)", visuals.spawnDelaySec, 0, 3, 0.05)}
          ${sliderRow("fadeOutAt", "Fade out", visuals.fadeOutAt, 0.1, 1, 0.05)}
          ${sliderRow("speed", "Speed", visuals.speed, 0.1, 3, 0.05)}
          ${sliderRow("softness", "Softness", visuals.softness, 0.1, 8, 0.05)}
          ${sliderRow("opacity", "Opacity", visuals.opacity, 0.05, 1, 0.05)}
          <label class="ripples-slider-row ripples-slider-row--color">
            <span class="ripples-slider-row__label">Color</span>
            <input class="ripples-color" type="color" data-ripples-color value="${visuals.color}" />
          </label>
        </fieldset>
        </div>
      </div>
      <div class="submission-sidebar__footer" id="ripples-custom-footer">
        <div class="submission-sidebar__actions">
          <button type="button" id="ripples-save-btn" class="admin-btn--pill">Save</button>
        </div>
      </div>
    </div>
  `;

  const statusEl = sideHost.querySelector(".calibration__status") as HTMLElement;
  const saveBtn = sideHost.querySelector("#ripples-save-btn") as HTMLButtonElement;
  const msgEl = sideHost.querySelector("#ripples-msg") as HTMLElement;
  const layer7Radios = sideHost.querySelectorAll<HTMLInputElement>('input[name="ripples-layer7-edge"]');
  const sliderInputs = sideHost.querySelectorAll<HTMLInputElement>("[data-ripples-slider]");
  const colorInput = sideHost.querySelector<HTMLInputElement>("[data-ripples-color]");
  const sourceRadios = sideHost.querySelectorAll<HTMLInputElement>('input[name="ripples-source"]');
  const customSettings = sideHost.querySelector("#ripples-custom-settings") as HTMLElement;
  const customFooter = sideHost.querySelector("#ripples-custom-footer") as HTMLElement;

  mapHost.replaceChildren();

  const showMessage = (message: string): void => {
    msgEl.textContent = message;
    msgEl.hidden = !message;
  };

  const originPlacement = (): { mapX: number; mapY: number } => {
    return getRipplesPlacement(anchor, anchor.activeVariant);
  };

  const refreshStatus = (): void => {
    const placement = originPlacement();
    statusEl.textContent = `Origin ${formatCoords(placement.mapX, placement.mapY)}`;
  };

  const applyOrigin = (mapX: number, mapY: number): void => {
    const loop = { ...getRipplesPlacement(anchor, "loop"), mapX, mapY };
    const fade = { ...getRipplesPlacement(anchor, "fade"), mapX, mapY };
    anchor = { ...anchor, loop, fade };
  };

  const syncOriginFromMap = (): void => {
    const pos = mapEditor?.getOverlayPosition();
    if (!pos) return;
    applyOrigin(pos.mapX, pos.mapY);
  };

  const refreshMap = (): void => {
    syncOriginFromMap();
    mapEditor?.destroy();
    const placement = originPlacement();
    mapEditor = createMapEditor(
      mapHost,
      {
        pins: [],
        selectedId: null,
        backdrop: "model3d",
        toDisplayCoords: mapXYOriginalToAdmin,
        fromDisplayCoords: mapXYAdminToOriginal,
        ripplesShader: {
          variant: "loop",
          originMapX: placement.mapX,
          originMapY: placement.mapY,
        },
        allowRipplesOriginDrag: true,
        layer7Edge,
        ripplesVisuals: visuals,
        ripplesOverlayEnabled: shaderSource === "custom",
      },
      {
        onPinMove: () => undefined,
        onOverlayMove(mapX, mapY) {
          applyOrigin(mapX, mapY);
          refreshStatus();
        },
      }
    );
    refreshStatus();
  };

  const readVisuals = (): ModelRipplesVisuals => {
    const num = (name: string, fallback: number): number => {
      const input = sideHost.querySelector<HTMLInputElement>(`[data-ripples-slider="${name}"]`);
      const value = Number(input?.value);
      return Number.isFinite(value) ? value : fallback;
    };
    return {
      ringCount: Math.round(num("ringCount", visuals.ringCount)),
      lineWidthPx: num("lineWidthPx", visuals.lineWidthPx),
      maxRadius: num("maxRadius", visuals.maxRadius),
      expansionSec: num("expansionSec", visuals.expansionSec),
      spawnDelaySec: num("spawnDelaySec", visuals.spawnDelaySec),
      fadeOutAt: num("fadeOutAt", visuals.fadeOutAt),
      speed: num("speed", visuals.speed),
      softness: num("softness", visuals.softness),
      opacity: num("opacity", visuals.opacity),
      color: colorInput?.value || visuals.color,
    };
  };

  const paintSliderValues = (): void => {
    sliderInputs.forEach((input) => {
      const name = input.dataset.ripplesSlider;
      if (!name) return;
      const label = sideHost.querySelector(`[data-ripples-value="${name}"]`);
      if (label) label.textContent = formatSliderValue(name, Number(input.value));
    });
  };

  const applyVisualsFromUi = (): void => {
    visuals = readVisuals();
    paintSliderValues();
    mapEditor?.setRipplesVisuals(visuals);
  };

  sliderInputs.forEach((input) => {
    input.addEventListener("input", applyVisualsFromUi);
  });
  colorInput?.addEventListener("input", applyVisualsFromUi);

  const applyShaderSource = (): void => {
    const custom = shaderSource === "custom";
    customSettings.hidden = !custom;
    customFooter.hidden = !custom;
    mapEditor?.setRipplesOverlayEnabled(custom);
  };

  sourceRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      if (radio.value !== "model" && radio.value !== "custom") return;
      shaderSource = radio.value;
      applyShaderSource();
    });
  });

  layer7Radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      if (radio.value !== "inner" && radio.value !== "outer") return;
      layer7Edge = radio.value;
      mapEditor?.setRipplesLayer7Edge(layer7Edge);
    });
  });

  saveBtn.addEventListener("click", async () => {
    syncOriginFromMap();
    saveBtn.disabled = true;
    showMessage("Saving…");
    try {
      anchor = normalizeRipplesAnchor(await saveRipplesAnchor(anchor));
      callbacks.onChange(anchor);
      refreshStatus();
      showMessage("Ripples origin saved.");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  refreshMap();

  return {
    getAnchor: () => anchor,
    refreshMap,
    destroy: () => {
      mapEditor?.destroy();
    },
  };
}
