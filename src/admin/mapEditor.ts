import { buildCardContentHtml } from "../shared/cardContent";
import { MAP_ADMIN_REFERENCE_PATH, type InfoCard } from "../shared/types";
import { getCanvasCardsMinWidth, getCanvasRowGap } from "./canvasLayout";

export interface PinDatum {
  id: string;
  label: string;
  mapX: number;
  mapY: number;
}

export interface MapEditorCallbacks {
  onPinMove: (mapX: number, mapY: number) => void;
}

export interface MapEditorOptions {
  pins: PinDatum[];
  selectedId: string | null;
  draftPosition?: { mapX: number; mapY: number };
  /** Extra CSS class on each pin (e.g. calibration vs card pins). */
  pinClass?: string;
  imagePath?: string;
  /** Convert stored coords to the displayed image space. Defaults to identity. */
  toDisplayCoords?: (mapX: number, mapY: number) => { mapX: number; mapY: number };
  /** Convert displayed image coords back to stored space. Defaults to identity. */
  fromDisplayCoords?: (mapX: number, mapY: number) => { mapX: number; mapY: number };
  /** When set, hovering near a pin shows the AR-style card preview. */
  previewCards?: InfoCard[];
  /** When set, hovering a list item or pin shows custom preview HTML for that pin. */
  getPreviewHtml?: (pinId: string) => string | null;
  /** When false, the selected pin is not draggable (e.g. cards list is showing). */
  allowSelectedPinDrag?: boolean;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_FACTOR = 1.1;
const PREVIEW_GAP_SCREEN_PX = 12;
const SAFE_ZONE_PAD_SCREEN_PX = 10;
const PREVIEW_CARD_RADIUS_PX = 12;
const PREVIEW_SAFE_BLUR_MASK_BLEED_PX = 1.5;
const PREVIEW_PIN_MASK_INSET_PX = 1;

function snapMaskLength(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}

function clampCornerRadius(radius: number, width: number, height: number): number {
  return Math.max(0, Math.min(radius, width / 2, height / 2));
}

function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number
): string {
  const tl = clampCornerRadius(topLeft, width, height);
  const tr = clampCornerRadius(topRight, width, height);
  const br = clampCornerRadius(bottomRight, width, height);
  const bl = clampCornerRadius(bottomLeft, width, height);
  const right = x + width;
  const bottom = y + height;

  return [
    `M ${x + tl} ${y}`,
    `H ${right - tr}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${right} ${y + tr}` : `L ${right} ${y}`,
    `V ${bottom - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${right - br} ${bottom}` : `L ${right} ${bottom}`,
    `H ${x + bl}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 ${x} ${bottom - bl}` : `L ${x} ${bottom}`,
    `V ${y + tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : `L ${x} ${y}`,
    "Z",
  ].join(" ");
}

export function createMapEditor(
  container: HTMLElement,
  options: MapEditorOptions,
  callbacks: MapEditorCallbacks
): {
  setSelectedPin: (mapX: number, mapY: number) => void;
  getSelectedPinPosition: () => { mapX: number; mapY: number } | null;
  showCardPreview: (cardId: string | null) => void;
  destroy: () => void;
} {
  const {
    pins,
    selectedId,
    draftPosition,
    pinClass,
    imagePath = MAP_ADMIN_REFERENCE_PATH,
    toDisplayCoords = (mapX, mapY) => ({ mapX, mapY }),
    fromDisplayCoords = (mapX, mapY) => ({ mapX, mapY }),
    previewCards,
    getPreviewHtml,
    allowSelectedPinDrag = false,
  } = options;

  container.innerHTML = `
    <div class="map-editor">
      <div class="map-editor__viewport">
        <div class="map-editor__stage">
          <img src="${imagePath}" alt="Map reference" class="map-editor__image" draggable="false" />
          <div class="map-editor__pins"></div>
        </div>
      </div>
      <div class="map-editor__missing" hidden>
        Add <code>public/map-reference - cropped.jpg</code> to place pins visually.
      </div>
    </div>
  `;

  const mapEditor = container.querySelector(".map-editor") as HTMLElement;
  const viewport = container.querySelector(".map-editor__viewport") as HTMLElement;
  const stage = container.querySelector(".map-editor__stage") as HTMLElement;
  const image = container.querySelector(".map-editor__image") as HTMLImageElement;
  const missing = container.querySelector(".map-editor__missing") as HTMLElement;
  const pinsLayer = container.querySelector(".map-editor__pins") as HTMLElement;
  const fitContainer =
    (container.closest(".admin-layout") as HTMLElement | null) ??
    (container.closest(".admin-canvas") as HTMLElement | null) ??
    container;
  const canvasSection = container.closest(".admin-canvas") as HTMLElement | null;

  function getFitBounds(): { width: number; height: number } {
    const canvas = canvasSection;
    let padX = 0;
    let padY = 0;
    if (canvas) {
      const canvasStyles = getComputedStyle(canvas);
      padX = parseFloat(canvasStyles.paddingLeft) + parseFloat(canvasStyles.paddingRight);
      padY = parseFloat(canvasStyles.paddingTop) + parseFloat(canvasStyles.paddingBottom);
    }

    const bounds = fitContainer.getBoundingClientRect();
    const innerWidth = Math.max(1, bounds.width - padX);
    const innerHeight = Math.max(1, bounds.height - padY);
    const cardsPanel = (canvas ?? fitContainer).querySelector(".admin-canvas__cards") as HTMLElement | null;
    const gap = canvas ? getCanvasRowGap(canvas) : 16;

    if (!cardsPanel) {
      return { width: innerWidth, height: innerHeight };
    }

    const row = (canvas ?? fitContainer).querySelector(".admin-canvas__row") as HTMLElement | null;
    const stacked = row ? getComputedStyle(row).flexDirection === "column" : false;

    if (stacked) {
      const cardsHeight = cardsPanel.getBoundingClientRect().height;
      return {
        width: innerWidth,
        height: Math.max(1, innerHeight - cardsHeight - gap),
      };
    }

    const cardsMinWidth = getCanvasCardsMinWidth(cardsPanel);
    return {
      width: Math.max(1, innerWidth - cardsMinWidth - gap),
      height: innerHeight,
    };
  }
  let selectedPin: HTMLButtonElement | null = null;
  let previewHost: HTMLElement | null = null;
  let previewPanel: HTMLElement | null = null;
  let previewSafeBlur: HTMLElement | null = null;
  let previewSafeBlurMask: SVGMaskElement | null = null;
  let previewSafeBlurOuter: SVGPathElement | null = null;
  let previewSafeBlurInner: SVGPathElement | null = null;
  let previewSafeBlurPin: SVGCircleElement | null = null;
  let previewCardId: string | null = null;
  const previewEnabled = Boolean(previewCards?.length || getPreviewHtml);

  function resolvePreviewHtml(pinId: string): string | null {
    if (previewCards?.length) {
      const card = previewCards.find((entry) => entry.id === pinId);
      return card ? buildCardContentHtml(card) : null;
    }
    return getPreviewHtml?.(pinId) ?? null;
  }

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let stageWidth = 0;
  let stageHeight = 0;
  let dragging = false;
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  image.addEventListener("error", () => {
    image.style.display = "none";
    missing.hidden = false;
  });

  function measureStage(): void {
    const previousTransform = stage.style.transform;
    stage.style.transform = "none";

    const nw = image.naturalWidth;
    const nh = image.naturalHeight;
    const { width: fitWidth, height: fitHeight } = getFitBounds();

    if (nw > 0 && nh > 0 && fitWidth >= 1 && fitHeight >= 1) {
      const fitScale = Math.min(fitWidth / nw, fitHeight / nh);
      stageWidth = nw * fitScale;
      stageHeight = nh * fitScale;
      container.style.width = `${stageWidth}px`;
      container.style.height = `${stageHeight}px`;
      mapEditor.style.width = "100%";
      mapEditor.style.height = "100%";
      image.style.width = `${stageWidth}px`;
      image.style.height = `${stageHeight}px`;
    } else {
      stageWidth = image.offsetWidth;
      stageHeight = image.offsetHeight;
    }

    viewport.style.height = stageHeight > 0 ? `${stageHeight}px` : "";
    stage.style.transform = previousTransform;

    if (stageHeight > 0) {
      const row = (canvasSection ?? fitContainer).querySelector(".admin-canvas__row") as HTMLElement | null;
      const cardsPanel = (canvasSection ?? fitContainer).querySelector(".admin-canvas__cards") as HTMLElement | null;
      if (row) row.style.height = `${stageHeight}px`;
      if (cardsPanel) cardsPanel.style.height = `${stageHeight}px`;
    }
  }

  function applyTransform(): void {
    if (scale <= 1) {
      scale = 1;
      translateX = 0;
      translateY = 0;
      stage.style.transform = "translate3d(0px, 0px, 0) scale(1)";
      applyZoomCompensation();
      return;
    }

    for (let pass = 0; pass < 2; pass++) {
      stage.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;

      const viewportRect = viewport.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      let adjusted = false;

      if (imageRect.right < viewportRect.right - 0.5) {
        translateX += viewportRect.right - imageRect.right;
        adjusted = true;
      }
      if (imageRect.bottom < viewportRect.bottom - 0.5) {
        translateY += viewportRect.bottom - imageRect.bottom;
        adjusted = true;
      }
      if (imageRect.left > viewportRect.left + 0.5) {
        translateX += viewportRect.left - imageRect.left;
        adjusted = true;
      }
      if (imageRect.top > viewportRect.top + 0.5) {
        translateY += viewportRect.top - imageRect.top;
        adjusted = true;
      }

      if (!adjusted) break;
    }

    applyZoomCompensation();
  }

  function applyZoomCompensation(): void {
    pinsLayer.style.setProperty("--map-editor-zoom-comp", String(1 / scale));
    repositionActivePreview();
  }

  function repositionActivePreview(): void {
    if (!previewHost || !previewCardId || previewHost.hidden) {
      updatePreviewSafeBlur();
      return;
    }
    const pin = pins.find((entry) => entry.id === previewCardId);
    if (!pin) {
      updatePreviewSafeBlur();
      return;
    }
    const display = toDisplayCoords(pin.mapX, pin.mapY);
    positionPreviewHost(display.mapX, display.mapY);
    updatePreviewSafeBlur();
  }

  function updatePreviewSafeBlur(): void {
    if (!previewSafeBlur) return;
    if (!previewHost || previewHost.hidden || !previewCardId) {
      previewSafeBlur.hidden = true;
      return;
    }

    const panelRect = getPreviewPanelRect();
    const pin = getPinElement(previewCardId);
    if (!panelRect || !pin) {
      previewSafeBlur.hidden = true;
      return;
    }

    const pinRect = pin.getBoundingClientRect();
    const safe = getPreviewSafeBounds(panelRect, pinRect);
    const viewportRect = viewport.getBoundingClientRect();
    const left = snapMaskLength(safe.left - viewportRect.left);
    const top = snapMaskLength(safe.top - viewportRect.top);
    const width = snapMaskLength(safe.right - safe.left);
    const height = snapMaskLength(safe.bottom - safe.top);

    if (width <= 0 || height <= 0) {
      previewSafeBlur.hidden = true;
      return;
    }

    const holeLeft = snapMaskLength(panelRect.left - safe.left);
    const holeTop = snapMaskLength(panelRect.top - safe.top);
    const holeWidth = snapMaskLength(panelRect.width);
    const holeHeight = snapMaskLength(panelRect.height);
    const pad = SAFE_ZONE_PAD_SCREEN_PX;
    const cardRadius = getPreviewCardRadiusScreen(panelRect);
    const borderWidth = previewPanel
      ? parseFloat(getComputedStyle(previewPanel).borderTopWidth) || 0
      : 0;
    const maskBleed = PREVIEW_SAFE_BLUR_MASK_BLEED_PX + borderWidth;
    const innerLeft = holeLeft + maskBleed;
    const innerTop = holeTop + maskBleed;
    const innerWidth = Math.max(0, holeWidth - 2 * maskBleed);
    const innerHeight = Math.max(0, holeHeight - 2 * maskBleed);
    const innerRadius = Math.max(0, cardRadius - maskBleed);
    const pinMask = getPinMaskCircle(pinRect, safe.left, safe.top);

    previewSafeBlur.hidden = false;
    previewSafeBlur.style.left = `${left}px`;
    previewSafeBlur.style.top = `${top}px`;
    previewSafeBlur.style.width = `${width}px`;
    previewSafeBlur.style.height = `${height}px`;

    if (previewSafeBlurMask && previewSafeBlurOuter && previewSafeBlurInner) {
      previewSafeBlurMask.setAttribute("x", "0");
      previewSafeBlurMask.setAttribute("y", "0");
      previewSafeBlurMask.setAttribute("width", String(width));
      previewSafeBlurMask.setAttribute("height", String(height));
      previewSafeBlurOuter.setAttribute(
        "d",
        roundedRectPath(0, 0, width, height, pad, pad, pad, pad)
      );
      previewSafeBlurInner.setAttribute(
        "d",
        roundedRectPath(
          innerLeft,
          innerTop,
          innerWidth,
          innerHeight,
          innerRadius,
          innerRadius,
          innerRadius,
          innerRadius
        )
      );
      if (previewSafeBlurPin) {
        previewSafeBlurPin.setAttribute("cx", String(pinMask.cx));
        previewSafeBlurPin.setAttribute("cy", String(pinMask.cy));
        previewSafeBlurPin.setAttribute("r", String(pinMask.r));
      }
    }
  }

  function getPinMaskCircle(
    pinRect: DOMRect,
    safeLeft: number,
    safeTop: number
  ): { cx: number; cy: number; r: number } {
    const baseRadius = Math.min(pinRect.width, pinRect.height) / 2;
    const radius = Math.max(0, baseRadius - PREVIEW_PIN_MASK_INSET_PX);

    return {
      cx: snapMaskLength(pinRect.left + pinRect.width / 2 - safeLeft),
      cy: snapMaskLength(pinRect.top + pinRect.height / 2 - safeTop),
      r: snapMaskLength(radius),
    };
  }

  function getPreviewCardRadius(): number {
    if (!previewPanel) return PREVIEW_CARD_RADIUS_PX;
    const radius = parseFloat(getComputedStyle(previewPanel).borderTopLeftRadius);
    return Number.isFinite(radius) && radius > 0 ? radius : PREVIEW_CARD_RADIUS_PX;
  }

  function getPreviewCardRadiusScreen(panelRect: DOMRect): number {
    const cssRadius = getPreviewCardRadius();
    if (!previewPanel) return cssRadius;
    const layoutWidth = previewPanel.offsetWidth;
    if (layoutWidth <= 0) return cssRadius;
    return cssRadius * (panelRect.width / layoutWidth);
  }

  function updateStageMetrics(): void {
    measureStage();
    repositionAllPins();
    applyTransform();
  }

  const resizeObserver = new ResizeObserver(() => {
    updateStageMetrics();
  });
  resizeObserver.observe(fitContainer);

  image.addEventListener("load", updateStageMetrics);

  function ensurePreviewLayer(): void {
    if (previewHost) return;
    previewHost = document.createElement("div");
    previewHost.className = "map-editor__preview-host";
    previewPanel = document.createElement("div");
    previewPanel.className = "map-editor__preview";
    previewHost.append(previewPanel);
    pinsLayer.appendChild(previewHost);

    previewSafeBlur = document.createElement("div");
    previewSafeBlur.className = "map-editor__preview-safe-blur";
    previewSafeBlur.hidden = true;
    previewSafeBlur.innerHTML = `
      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <mask id="map-editor-preview-safe-blur-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="0" height="0">
            <path class="map-editor__preview-safe-blur__outer" fill="white" shape-rendering="geometricPrecision" d="" />
            <path class="map-editor__preview-safe-blur__inner" fill="black" shape-rendering="geometricPrecision" d="" />
            <circle class="map-editor__preview-safe-blur__pin" fill="black" shape-rendering="geometricPrecision" cx="0" cy="0" r="0" />
          </mask>
        </defs>
      </svg>
    `;
    previewSafeBlurMask = previewSafeBlur.querySelector(
      "#map-editor-preview-safe-blur-mask"
    ) as SVGMaskElement;
    previewSafeBlurOuter = previewSafeBlur.querySelector(
      ".map-editor__preview-safe-blur__outer"
    ) as SVGPathElement;
    previewSafeBlurInner = previewSafeBlur.querySelector(
      ".map-editor__preview-safe-blur__inner"
    ) as SVGPathElement;
    previewSafeBlurPin = previewSafeBlur.querySelector(
      ".map-editor__preview-safe-blur__pin"
    ) as SVGCircleElement;
    viewport.appendChild(previewSafeBlur);

    const previewResizeObserver = new ResizeObserver(() => {
      repositionActivePreview();
    });
    previewResizeObserver.observe(previewPanel);
  }

  function setPreviewPinHighlight(cardId: string | null): void {
    pinsLayer.querySelectorAll(".map-editor__pin").forEach((pin) => {
      const pinEl = pin as HTMLElement;
      pinEl.classList.toggle("map-editor__pin--preview", cardId !== null && pinEl.dataset.id === cardId);
    });
  }

  function hidePreview(): void {
    if (!previewHost) return;
    previewHost.hidden = true;
    previewCardId = null;
    setPreviewPinHighlight(null);
    updatePreviewSafeBlur();
  }

  function getPreviewPanelRect(): DOMRect | null {
    if (!previewPanel) return null;
    const rect = previewPanel.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  /** Safe bounds for hover: popup plus corridor down to the pin's bottom edge. */
  function getPreviewSafeBounds(
    panelRect: DOMRect,
    pinRect: DOMRect,
    pad: number = SAFE_ZONE_PAD_SCREEN_PX
  ): { left: number; top: number; right: number; bottom: number } {
    return {
      left: panelRect.left - pad,
      top: panelRect.top - pad,
      right: panelRect.right + pad,
      bottom: pinRect.bottom,
    };
  }

  function positionPreviewHost(mapX: number, mapY: number): void {
    if (!previewHost) return;

    if (stageWidth > 0 && stageHeight > 0) {
      previewHost.style.left = `${mapX * stageWidth}px`;
      previewHost.style.top = `${mapY * stageHeight}px`;
    } else {
      previewHost.style.left = `${mapX * 100}%`;
      previewHost.style.top = `${mapY * 100}%`;
    }

    const comp = 1 / scale;
    const gapStage = PREVIEW_GAP_SCREEN_PX / scale;
    const pinClearanceStage = 9 / scale;
    const height = previewPanel?.offsetHeight ?? previewHost.offsetHeight;

    previewHost.style.transformOrigin = "50% 100%";
    const offsetAbove =
      height > 0 ? -(height + gapStage + pinClearanceStage) : -(gapStage + pinClearanceStage);
    previewHost.style.transform = `translate(-50%, ${offsetAbove}px) scale(${comp})`;
    previewHost.dataset.placement = "above";
  }

  function showPreviewHtml(html: string, pinId: string, displayMapX: number, displayMapY: number): void {
    ensurePreviewLayer();
    previewPanel!.innerHTML = html;
    previewHost!.hidden = false;
    previewCardId = pinId;
    setPreviewPinHighlight(pinId);
    positionPreviewHost(displayMapX, displayMapY);
    updatePreviewSafeBlur();

    previewPanel!.querySelectorAll("img").forEach((img) => {
      if (img.complete) return;
      const onImageReady = (): void => repositionActivePreview();
      img.addEventListener("load", onImageReady, { once: true });
      img.addEventListener("error", onImageReady, { once: true });
    });
  }

  function openPinPreview(pinId: string | null): void {
    if (!pinId || !previewEnabled) {
      hidePreview();
      return;
    }

    const html = resolvePreviewHtml(pinId);
    const pin = pins.find((entry) => entry.id === pinId);
    if (!html || !pin) {
      hidePreview();
      return;
    }

    const display = toDisplayCoords(pin.mapX, pin.mapY);
    showPreviewHtml(html, pinId, display.mapX, display.mapY);
  }

  function getPinElement(cardId: string): HTMLElement | null {
    return pinsLayer.querySelector(`.map-editor__pin[data-id="${CSS.escape(cardId)}"]`);
  }

  function isPointerOnPinDot(event: PointerEvent, cardId: string): boolean {
    const pin = getPinElement(cardId);
    if (!pin) return false;

    const rect = pin.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;
    return Math.hypot(event.clientX - centerX, event.clientY - centerY) <= radius;
  }

  function pointInRect(x: number, y: number, rect: DOMRect, pad = 0): boolean {
    return (
      x >= rect.left - pad &&
      x <= rect.right + pad &&
      y >= rect.top - pad &&
      y <= rect.bottom + pad
    );
  }

  function isPointInPreviewSafeBounds(
    x: number,
    y: number,
    panelRect: DOMRect,
    pinRect: DOMRect
  ): boolean {
    const safe = getPreviewSafeBounds(panelRect, pinRect);
    return x >= safe.left && x <= safe.right && y >= safe.top && y <= safe.bottom;
  }

  function isPointerInPreviewSafeZone(event: PointerEvent, cardId: string): boolean {
    const { clientX: x, clientY: y } = event;
    const pin = getPinElement(cardId);

    if (pin && pointInRect(x, y, pin.getBoundingClientRect(), SAFE_ZONE_PAD_SCREEN_PX)) {
      return true;
    }

    if (!previewHost || previewHost.hidden || !previewPanel) return false;

    const panelRect = getPreviewPanelRect();
    if (!panelRect || !pin) return false;

    const pinRect = pin.getBoundingClientRect();
    return isPointInPreviewSafeBounds(x, y, panelRect, pinRect);
  }

  function findPreviewToOpen(
    event: PointerEvent
  ): { pinId: string; html: string; displayMapX: number; displayMapY: number } | null {
    if (!previewEnabled) return null;

    for (const pinDatum of pins) {
      if (!isPointerOnPinDot(event, pinDatum.id)) continue;

      const html = resolvePreviewHtml(pinDatum.id);
      if (!html) continue;

      const display = toDisplayCoords(pinDatum.mapX, pinDatum.mapY);
      return { pinId: pinDatum.id, html, displayMapX: display.mapX, displayMapY: display.mapY };
    }

    return null;
  }

  function updatePreviewFromPointer(event: PointerEvent): void {
    if (!previewEnabled || dragging || panning) {
      hidePreview();
      return;
    }

    if (previewCardId && previewHost && !previewHost.hidden) {
      if (isPointerInPreviewSafeZone(event, previewCardId)) {
        return;
      }

      const next = findPreviewToOpen(event);
      if (next) {
        showPreviewHtml(next.html, next.pinId, next.displayMapX, next.displayMapY);
        return;
      }

      hidePreview();
      return;
    }

    const match = findPreviewToOpen(event);
    if (!match) {
      hidePreview();
      return;
    }

    showPreviewHtml(match.html, match.pinId, match.displayMapX, match.displayMapY);
  }

  function renderPins(): void {
    pinsLayer.innerHTML = "";
    previewHost = null;
    previewPanel = null;
    previewCardId = null;
    selectedPin = null;

    for (const pinDatum of pins) {
      const pin = createPin(pinDatum.id, pinDatum.label, allowSelectedPinDrag && pinDatum.id === selectedId);
      const display = toDisplayCoords(pinDatum.mapX, pinDatum.mapY);
      positionPin(pin, display.mapX, display.mapY);
      pinsLayer.appendChild(pin);
    }

    if (allowSelectedPinDrag && !selectedId && draftPosition) {
      selectedPin = createPin("draft", "New location", true);
      const display = toDisplayCoords(draftPosition.mapX, draftPosition.mapY);
      positionPin(selectedPin, display.mapX, display.mapY);
      pinsLayer.appendChild(selectedPin);
    }
  }

  function repositionAllPins(): void {
    pinsLayer.querySelectorAll(".map-editor__pin").forEach((pinEl) => {
      const pin = pinEl as HTMLElement;
      const id = pin.dataset.id;
      if (!id) return;

      if (id === "draft" && draftPosition) {
        const display = toDisplayCoords(draftPosition.mapX, draftPosition.mapY);
        positionPin(pin, display.mapX, display.mapY);
        return;
      }

      const pinDatum = pins.find((entry) => entry.id === id);
      if (!pinDatum) return;
      const display = toDisplayCoords(pinDatum.mapX, pinDatum.mapY);
      positionPin(pin, display.mapX, display.mapY);
    });
  }

  function createPin(id: string, title: string, selected: boolean): HTMLButtonElement {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = pinClass ? `map-editor__pin ${pinClass}` : "map-editor__pin";
    pin.title = title;
    pin.dataset.id = id;
    if (selected) {
      pin.classList.add("map-editor__pin--selected");
      selectedPin = pin;
    }
    return pin;
  }

  function positionPin(pin: HTMLElement, mapX: number, mapY: number): void {
    if (stageWidth > 0 && stageHeight > 0) {
      pin.style.left = `${mapX * stageWidth}px`;
      pin.style.top = `${mapY * stageHeight}px`;
    } else {
      pin.style.left = `${mapX * 100}%`;
      pin.style.top = `${mapY * 100}%`;
    }
  }

  function pointerToMapXY(event: PointerEvent): { mapX: number; mapY: number } | null {
    if (stageWidth === 0 || stageHeight === 0) return null;
    const rect = viewport.getBoundingClientRect();
    const vx = event.clientX - rect.left;
    const vy = event.clientY - rect.top;
    const stageX = (vx - translateX) / scale;
    const stageY = (vy - translateY) / scale;
    return {
      mapX: clamp(stageX / stageWidth, 0, 1),
      mapY: clamp(stageY / stageHeight, 0, 1),
    };
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;

    const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);

    const stageX = (mx - translateX) / scale;
    const stageY = (my - translateY) / scale;

    translateX = mx - stageX * newScale;
    translateY = my - stageY * newScale;
    scale = newScale;

    applyTransform();
  };

  const onPointerDown = (event: PointerEvent): void => {
    const target = (event.target as HTMLElement).closest(".map-editor__pin") as HTMLButtonElement | null;
    if (allowSelectedPinDrag && target?.classList.contains("map-editor__pin--selected")) {
      dragging = true;
      hidePreview();
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".map-editor__preview")) return;

    panning = true;
    hidePreview();
    panStartX = event.clientX;
    panStartY = event.clientY;
    panOriginX = translateX;
    panOriginY = translateY;
    viewport.classList.add("map-editor__viewport--panning");
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragging && selectedPin) {
      hidePreview();
      const coords = pointerToMapXY(event);
      if (!coords) return;
      positionPin(selectedPin, coords.mapX, coords.mapY);
      const stored = fromDisplayCoords(coords.mapX, coords.mapY);
      callbacks.onPinMove(stored.mapX, stored.mapY);
      return;
    }

    if (panning) {
      translateX = panOriginX + (event.clientX - panStartX);
      translateY = panOriginY + (event.clientY - panStartY);
      applyTransform();
      return;
    }

    updatePreviewFromPointer(event);
  };

  const onPointerLeave = (event: PointerEvent): void => {
    const related = event.relatedTarget;
    if (related instanceof Node) {
      if (previewPanel?.contains(related)) return;
      if (previewHost?.contains(related)) return;
      if (previewCardId) {
        const pin = getPinElement(previewCardId);
        if (pin?.contains(related)) return;
      }
    }
    hidePreview();
  };

  const stopPointerInteraction = (): void => {
    dragging = false;
    panning = false;
    viewport.classList.remove("map-editor__viewport--panning");
  };

  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerleave", onPointerLeave);
  viewport.addEventListener("pointerup", stopPointerInteraction);
  viewport.addEventListener("pointercancel", stopPointerInteraction);

  renderPins();
  applyTransform();
  if (image.complete) {
    updateStageMetrics();
  }

  return {
    setSelectedPin(mapX: number, mapY: number): void {
      if (!selectedPin) return;
      const display = toDisplayCoords(mapX, mapY);
      positionPin(selectedPin, display.mapX, display.mapY);
    },
    getSelectedPinPosition(): { mapX: number; mapY: number } | null {
      if (!selectedPin) return null;
      const left = parseFloat(selectedPin.style.left);
      const top = parseFloat(selectedPin.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      if (stageWidth > 0 && stageHeight > 0) {
        return fromDisplayCoords(left / stageWidth, top / stageHeight);
      }
      return fromDisplayCoords(left / 100, top / 100);
    },
    showCardPreview(cardId: string | null): void {
      openPinPreview(cardId);
    },
    destroy(): void {
      resizeObserver.disconnect();
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerleave", onPointerLeave);
      viewport.removeEventListener("pointerup", stopPointerInteraction);
      viewport.removeEventListener("pointercancel", stopPointerInteraction);
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
