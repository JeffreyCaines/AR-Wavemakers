import {
  buildCardPreviewHtml,
  buildCardPreviewWithBackHtml,
  buildLocationEntryMenuHtml,
} from "../shared/cardContent";
import { locationKey } from "../shared/locationGroups";
import {
  MAP_ADMIN_CROP,
  MAP_ADMIN_REFERENCE_PATH,
  type InfoCard,
  type RipplesVariant,
} from "../shared/types";
import { getCanvasCardsMinWidth, getCanvasRowGap } from "./canvasLayout";
import { mountMapModelBackdrop, type MapModelBackdrop } from "./mapModelBackdrop";
import { createRipplesMapPreview, type RipplesMapPreview } from "./ripplesMapPreview";

/** Image = cropped wall photo. model3d = top-down AR map mesh (same crop coord space). */
export type MapEditorBackdrop = "image" | "model3d";

export interface PinDatum {
  id: string;
  label: string;
  mapX: number;
  mapY: number;
}

export interface MapImageOverlay {
  url: string;
  mapX: number;
  mapY: number;
  originX: number;
  originY: number;
  widthRatio: number;
}

export interface MapRipplesShader {
  variant: RipplesVariant;
  originMapX: number;
  originMapY: number;
}

export interface MapEditorCallbacks {
  onPinMove: (mapX: number, mapY: number) => void;
  onOverlayMove?: (mapX: number, mapY: number) => void;
  /** Compact/touch UI: tap a pin instead of hovering for preview. */
  onPinActivate?: (pinId: string) => void;
}

export interface MapEditorOptions {
  pins: PinDatum[];
  selectedId: string | null;
  draftPosition?: { mapX: number; mapY: number };
  /** Extra CSS class on each pin (e.g. calibration vs card pins). */
  pinClass?: string;
  imagePath?: string;
  /** `image` (default) uses the cropped reference JPEG; `model3d` uses the AR mesh. */
  backdrop?: MapEditorBackdrop;
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
  imageOverlay?: MapImageOverlay;
  allowOverlayDrag?: boolean;
  /** Procedural ripples shader overlay (admin calibrate map). */
  ripplesShader?: MapRipplesShader;
  /** Drag on the shader canvas moves the ripple origin. */
  allowRipplesOriginDrag?: boolean;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_FACTOR = 1.1;
const PREVIEW_GAP_SCREEN_PX = 12;
const PREVIEW_EDGE_MARGIN_SCREEN_PX = 8;
const PREVIEW_PIN_CLEARANCE_SCREEN_PX = 9;
const SAFE_ZONE_PAD_SCREEN_PX = 10;
const PREVIEW_CONE_PAST_SCREEN_PX = 4;
const PREVIEW_CARD_RADIUS_PX = 12;
const PREVIEW_SAFE_BLUR_MASK_BLEED_PX = 1.5;
const PREVIEW_PIN_MASK_INSET_PX = 1;
const PIN_LAYOUT_SIZE_PX = 18;
const PIN_EMPHASIS_SCALE = 1.35;
/** Match stacked admin canvas; hover popups are impractical here. */
const COMPACT_POINTER_MQ = "(max-width: 900px)";
const PIN_ACTIVATE_MOVE_PX = 10;
/** Display-space nudge for arrow/WASD pin moves (Shift = fine). */
const PIN_NUDGE_STEP = 0.002;
const PIN_NUDGE_STEP_FINE = 0.0004;

type PreviewPlacement = "top" | "right" | "bottom" | "left" | "translated";
type PreviewFacingEdge = "top" | "right" | "bottom" | "left";

interface PopupTranslatedPosition {
  x: number;
  y: number;
}

interface Point2D {
  x: number;
  y: number;
}

interface PreviewCone {
  apex: Point2D;
  baseA: Point2D;
  baseB: Point2D;
}

function snapMaskLength(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}

function clampCornerRadius(radius: number, width: number, height: number): number {
  return Math.max(0, Math.min(radius, width / 2, height / 2));
}

function pointInTriangle(p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean {
  const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (denom === 0) return false;
  const alpha = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / denom;
  const beta = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / denom;
  const gamma = 1 - alpha - beta;
  return alpha >= 0 && beta >= 0 && gamma >= 0;
}

function trianglePath(a: Point2D, b: Point2D, c: Point2D): string {
  return `M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`;
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
  getOverlayPosition: () => { mapX: number; mapY: number } | null;
  showCardPreview: (cardId: string | null) => void;
  destroy: () => void;
} {
  const {
    pins,
    selectedId,
    draftPosition,
    pinClass,
    imagePath = MAP_ADMIN_REFERENCE_PATH,
    backdrop = "image",
    toDisplayCoords = (mapX, mapY) => ({ mapX, mapY }),
    fromDisplayCoords = (mapX, mapY) => ({ mapX, mapY }),
    previewCards,
    getPreviewHtml,
    allowSelectedPinDrag = false,
    imageOverlay,
    allowOverlayDrag = false,
    ripplesShader,
    allowRipplesOriginDrag = false,
  } = options;
  const { onPinMove, onOverlayMove, onPinActivate } = callbacks;
  const useModelBackdrop = backdrop === "model3d";

  const surfaceHtml = useModelBackdrop
    ? `<div class="map-editor__model-slot" aria-hidden="true"></div>`
    : `<img src="${imagePath}" alt="Map reference" class="map-editor__image" draggable="false" />`;
  const missingHtml = useModelBackdrop
    ? `Could not load the 3D map model.`
    : `Add <code>public/map-reference - cropped.jpg</code> to place pins visually.`;

  container.innerHTML = `
    <div class="map-editor${useModelBackdrop ? " map-editor--model3d" : ""}">
      <div class="map-editor__viewport">
        <div class="map-editor__stage">
          ${surfaceHtml}
          <div class="map-editor__pins"></div>
        </div>
      </div>
      <div class="map-editor__missing" hidden>
        ${missingHtml}
      </div>
    </div>
  `;

  const mapEditor = container.querySelector(".map-editor") as HTMLElement;
  const viewport = container.querySelector(".map-editor__viewport") as HTMLElement;
  const stage = container.querySelector(".map-editor__stage") as HTMLElement;
  const pinsLayer = container.querySelector(".map-editor__pins") as HTMLElement;
  const modelSlot = useModelBackdrop
    ? (container.querySelector(".map-editor__model-slot") as HTMLElement)
    : null;
  const image = useModelBackdrop
    ? null
    : (container.querySelector(".map-editor__image") as HTMLImageElement);
  let surface: HTMLElement = (image ?? modelSlot) as HTMLElement;
  const missing = container.querySelector(".map-editor__missing") as HTMLElement;
  let modelBackdrop: MapModelBackdrop | null = null;
  let modelBackdropDisposed = false;
  let surfaceAspectWidth = MAP_ADMIN_CROP.width as number;
  let surfaceAspectHeight = MAP_ADMIN_CROP.height as number;
  let surfaceReady = !useModelBackdrop;
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
      // Reserve menu space so cards can flex-fill leftover height below the map.
      const minCardsHeight = Math.min(360, Math.max(220, innerHeight * 0.4));
      return {
        width: innerWidth,
        height: Math.max(1, innerHeight - minCardsHeight - gap),
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
  let previewSafeBlurSvg: SVGSVGElement | null = null;
  let previewSafeBlurMask: SVGMaskElement | null = null;
  let previewSafeBlurOuter: SVGPathElement | null = null;
  let previewSafeBlurInner: SVGPathElement | null = null;
  let previewSafeBlurPin: SVGCircleElement | null = null;
  let previewCardId: string | null = null;
  /** When set, multi-entry pin preview shows this card’s detail instead of the menu. */
  let previewDetailCardId: string | null = null;
  /** True only after the user picked an entry from the location menu (shows Back). */
  let previewDetailFromEntryMenu = false;
  /**
   * After Back to the entry list, freeze safe-zone / blur updates until the pointer
   * re-enters the panel so a smaller menu cannot dismiss the preview immediately.
   */
  let previewSafeBoundsLockedUntilHover = false;
  const previewEnabled = Boolean(previewCards?.length || getPreviewHtml);
  const compactPointerMq = window.matchMedia(COMPACT_POINTER_MQ);
  let pendingPinActivateId: string | null = null;
  let pendingPinActivateX = 0;
  let pendingPinActivateY = 0;

  function isCompactPointerUi(): boolean {
    return compactPointerMq.matches;
  }

  function hoverPreviewsActive(): boolean {
    return previewEnabled && !isCompactPointerUi();
  }
  let overlayHost: HTMLElement | null = null;
  let overlayImg: HTMLImageElement | null = null;
  let overlayState: MapImageOverlay | null = imageOverlay ? { ...imageOverlay } : null;
  let overlayDragging = false;
  let ripplesPreview: RipplesMapPreview | null = null;
  let ripplesOrigin: { mapX: number; mapY: number } | null = ripplesShader
    ? { mapX: ripplesShader.originMapX, mapY: ripplesShader.originMapY }
    : null;
  let ripplesOriginDragging = false;
  let ripplesPreviewDisposed = false;

  function cardsAtPin(pinId: string): InfoCard[] {
    if (!previewCards?.length) return [];
    const pin = pins.find((entry) => entry.id === pinId);
    if (pin) {
      const key = locationKey(pin.mapX, pin.mapY);
      return previewCards.filter((entry) => locationKey(entry.mapX, entry.mapY) === key);
    }
    const card = previewCards.find((entry) => entry.id === pinId);
    if (!card) return [];
    const key = locationKey(card.mapX, card.mapY);
    return previewCards.filter((entry) => locationKey(entry.mapX, entry.mapY) === key);
  }

  function resolvePreviewHtml(pinId: string): string | null {
    if (previewCards?.length) {
      const groupCards = cardsAtPin(pinId);
      if (groupCards.length === 0) return null;

      if (groupCards.length === 1) {
        return buildCardPreviewHtml(groupCards[0]);
      }

      if (previewDetailCardId) {
        const detail =
          groupCards.find((entry) => entry.id === previewDetailCardId) ?? null;
        if (detail) {
          return previewDetailFromEntryMenu
            ? buildCardPreviewWithBackHtml(detail)
            : buildCardPreviewHtml(detail);
        }
      }

      return buildLocationEntryMenuHtml(groupCards);
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

  image?.addEventListener("error", () => {
    if (!image) return;
    image.style.display = "none";
    missing.hidden = false;
  });

  function measureStage(): void {
    const previousTransform = stage.style.transform;
    stage.style.transform = "none";

    const { width: fitWidth, height: fitHeight } = getFitBounds();
    let aspectW = surfaceAspectWidth;
    let aspectH = surfaceAspectHeight;

    if (image) {
      const nw = image.naturalWidth;
      const nh = image.naturalHeight;
      if (nw > 0 && nh > 0) {
        aspectW = nw;
        aspectH = nh;
        surfaceAspectWidth = nw;
        surfaceAspectHeight = nh;
      }
    }

    if (aspectW > 0 && aspectH > 0 && fitWidth >= 1 && fitHeight >= 1) {
      const fitScale = Math.min(fitWidth / aspectW, fitHeight / aspectH);
      stageWidth = aspectW * fitScale;
      stageHeight = aspectH * fitScale;
      container.style.width = `${stageWidth}px`;
      container.style.height = `${stageHeight}px`;
      mapEditor.style.width = "100%";
      mapEditor.style.height = "100%";
      surface.style.width = `${stageWidth}px`;
      surface.style.height = `${stageHeight}px`;
      syncModelBackdropView();
    } else {
      stageWidth = surface.offsetWidth;
      stageHeight = surface.offsetHeight;
    }

    viewport.style.height = stageHeight > 0 ? `${stageHeight}px` : "";
    stage.style.transform = previousTransform;

    if (stageHeight > 0) {
      const row = (canvasSection ?? fitContainer).querySelector(".admin-canvas__row") as HTMLElement | null;
      const cardsPanel = (canvasSection ?? fitContainer).querySelector(".admin-canvas__cards") as HTMLElement | null;
      const stacked = row ? getComputedStyle(row).flexDirection === "column" : false;
      if (stacked) {
        // CSS flex fills leftover height under the map on narrow viewports.
        if (row) row.style.height = "";
        if (cardsPanel) cardsPanel.style.height = "";
      } else {
        if (row) row.style.height = `${stageHeight}px`;
        if (cardsPanel) cardsPanel.style.height = `${stageHeight}px`;
      }
    }
  }

  function syncModelBackdropView(): void {
    if (!modelBackdrop || stageWidth <= 0 || stageHeight <= 0) return;
    const viewportWidth = viewport.clientWidth || stageWidth;
    const viewportHeight = viewport.clientHeight || stageHeight;
    modelBackdrop.syncView({
      viewportWidth,
      viewportHeight,
      stageWidth,
      stageHeight,
      scale,
      translateX,
      translateY,
    });
  }

  function applyTransform(): void {
    if (scale <= 1) {
      scale = 1;
      translateX = 0;
      translateY = 0;
      stage.style.transform = "translate3d(0px, 0px, 0) scale(1)";
      syncModelBackdropView();
      applyZoomCompensation();
      return;
    }

    for (let pass = 0; pass < 2; pass++) {
      stage.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;

      const viewportRect = viewport.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      let adjusted = false;

      if (surfaceRect.right < viewportRect.right - 0.5) {
        translateX += viewportRect.right - surfaceRect.right;
        adjusted = true;
      }
      if (surfaceRect.bottom < viewportRect.bottom - 0.5) {
        translateY += viewportRect.bottom - surfaceRect.bottom;
        adjusted = true;
      }
      if (surfaceRect.left > viewportRect.left + 0.5) {
        translateX += viewportRect.left - surfaceRect.left;
        adjusted = true;
      }
      if (surfaceRect.top > viewportRect.top + 0.5) {
        translateY += viewportRect.top - surfaceRect.top;
        adjusted = true;
      }

      if (!adjusted) break;
    }

    syncModelBackdropView();
    applyZoomCompensation();
  }

  function applyZoomCompensation(): void {
    pinsLayer.style.setProperty("--map-editor-zoom-comp", String(1 / scale));
    const activeId = previewCardId;
    if (!activeId) {
      updatePreviewSafeBlur();
      return;
    }
    if (previewSafeBoundsLockedUntilHover) return;
    // Redraw after the stage transform and zoom-comp are applied.
    requestAnimationFrame(() => {
      if (previewCardId === activeId && !previewSafeBoundsLockedUntilHover) {
        openPinPreview(activeId);
      }
    });
  }

  function repositionActivePreview(): void {
    if (previewSafeBoundsLockedUntilHover) return;
    if (!previewHost || !previewCardId || previewHost.hidden) {
      updatePreviewSafeBlur();
      return;
    }
    openPinPreview(previewCardId);
  }

  function updatePreviewSafeBlur(options: { force?: boolean } = {}): void {
    if (previewSafeBoundsLockedUntilHover && !options.force) return;
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

    const placement = getActivePreviewPlacement();
    const pad = SAFE_ZONE_PAD_SCREEN_PX;
    const pinGeometry = getPinScreenGeometry(pin);
    const safe = getPreviewSafeBounds(panelRect, pinGeometry, placement, pad);
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
    const toLocal = (point: Point2D): Point2D => ({
      x: snapMaskLength(point.x - safe.left),
      y: snapMaskLength(point.y - safe.top),
    });
    const coneLocal = {
      apex: toLocal(safe.cone.apex),
      baseA: toLocal(safe.cone.baseA),
      baseB: toLocal(safe.cone.baseB),
    };
    // Square the pin-facing corners so the cone meets the blur edge flush.
    const blurRadii = getBlurRadiiForFacing(placement, panelRect, pinGeometry.center, pad);
    const panelBlurPath = roundedRectPath(
      holeLeft - pad,
      holeTop - pad,
      holeWidth + 2 * pad,
      holeHeight + 2 * pad,
      blurRadii.topLeft,
      blurRadii.topRight,
      blurRadii.bottomRight,
      blurRadii.bottomLeft
    );
    const coneBlurPath = trianglePath(coneLocal.apex, coneLocal.baseA, coneLocal.baseB);

    previewSafeBlur.hidden = false;
    previewSafeBlur.style.left = `${left}px`;
    previewSafeBlur.style.top = `${top}px`;
    previewSafeBlur.style.width = `${width}px`;
    previewSafeBlur.style.height = `${height}px`;

    if (previewSafeBlurSvg) {
      previewSafeBlurSvg.setAttribute("width", String(width));
      previewSafeBlurSvg.setAttribute("height", String(height));
    }

    // Use the blur element's painted origin so the pin hole tracks nested stage transforms.
    const blurRect = previewSafeBlur.getBoundingClientRect();
    const pinMask = {
      cx: snapMaskLength(pinGeometry.center.x - blurRect.left),
      cy: snapMaskLength(pinGeometry.center.y - blurRect.top),
      r: snapMaskLength(Math.max(0, pinGeometry.radius - PREVIEW_PIN_MASK_INSET_PX)),
    };

    if (previewSafeBlurMask && previewSafeBlurOuter && previewSafeBlurInner) {
      previewSafeBlurMask.setAttribute("x", "0");
      previewSafeBlurMask.setAttribute("y", "0");
      previewSafeBlurMask.setAttribute("width", String(width));
      previewSafeBlurMask.setAttribute("height", String(height));
      previewSafeBlurOuter.setAttribute("d", `${panelBlurPath} ${coneBlurPath}`);
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

  /** Screen-space pin center from painted bounds; radius matches CSS zoom compensation. */
  function getPinScreenGeometry(pin: HTMLElement): { center: Point2D; radius: number } {
    const rect = pin.getBoundingClientRect();
    const emphasized =
      pin.classList.contains("map-editor__pin--preview") ||
      pin.classList.contains("map-editor__pin--selected") ||
      pin.classList.contains("map-editor__pin--targeted");
    return {
      center: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      // Pins counter-scale with the stage, so visual size stays at layout size.
      radius: (PIN_LAYOUT_SIZE_PX / 2) * (emphasized ? PIN_EMPHASIS_SCALE : 1),
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

  function getFullMapDisplayWidth(): number {
    if (stageWidth <= 0) return 0;
    const left = toDisplayCoords(0, 0.5).mapX;
    const right = toDisplayCoords(1, 0.5).mapX;
    return Math.abs(right - left) * stageWidth;
  }

  function positionImageOverlay(): void {
    if (!overlayHost || !overlayImg || !overlayState || stageWidth <= 0 || stageHeight <= 0) return;

    const display = toDisplayCoords(overlayState.mapX, overlayState.mapY);
    const overlayWidth = getFullMapDisplayWidth() * overlayState.widthRatio;
    overlayImg.style.width = `${Math.max(1, overlayWidth)}px`;

    overlayHost.style.left = `${display.mapX * stageWidth}px`;
    overlayHost.style.top = `${display.mapY * stageHeight}px`;

    const offsetX = (0.5 - overlayState.originX) * 100;
    const offsetY = (0.5 - overlayState.originY) * 100;
    overlayImg.style.transform = `translate(${offsetX}%, ${offsetY}%)`;
  }

  function renderImageOverlay(): void {
    overlayHost = null;
    overlayImg = null;
    if (!overlayState) return;

    overlayHost = document.createElement("div");
    overlayHost.className = "map-editor__overlay-host";
    if (allowOverlayDrag) {
      overlayHost.classList.add("map-editor__overlay-host--draggable");
    }

    overlayImg = document.createElement("img");
    overlayImg.src = overlayState.url;
    overlayImg.alt = "";
    overlayImg.className = "map-editor__overlay";
    overlayImg.draggable = false;
    overlayHost.append(overlayImg);
    pinsLayer.appendChild(overlayHost);
    positionImageOverlay();
  }

  function repositionImageOverlay(): void {
    positionImageOverlay();
  }

  let pendingRipplesMount: (() => void) | null = null;

  function mountRipplesPreview(): void {
    if (!ripplesShader || ripplesPreview) return;

    const start = (): void => {
      if (!surfaceReady) return;
      if (image && (image.naturalWidth <= 0 || image.naturalHeight <= 0)) return;
      void createRipplesMapPreview(pinsLayer, {
        variant: ripplesShader.variant,
        originMapX: ripplesOrigin?.mapX ?? ripplesShader.originMapX,
        originMapY: ripplesOrigin?.mapY ?? ripplesShader.originMapY,
      }).then((preview) => {
        if (ripplesPreviewDisposed) {
          preview.dispose();
          return;
        }
        ripplesPreview = preview;
        if (stageWidth > 0 && stageHeight > 0) {
          preview.setSize(stageWidth, stageHeight);
        }
      });
    };

    if (surfaceReady) {
      start();
    } else if (image) {
      image.addEventListener("load", start, { once: true });
    } else {
      // model3d: start() runs from startModelBackdrop once ready.
      pendingRipplesMount = start;
    }
  }

  function startModelBackdrop(): void {
    // Canvas lives on the viewport (fixed res). Stage keeps a slot for pin/CSS layout.
    void mountMapModelBackdrop(viewport, stage, () => modelBackdropDisposed)
      .then((backdrop) => {
        if (modelBackdropDisposed) {
          backdrop.dispose();
          return;
        }
        modelBackdrop = backdrop;
        surfaceAspectWidth = backdrop.aspectWidth;
        surfaceAspectHeight = backdrop.aspectHeight;
        surfaceReady = true;
        // Keep the in-stage slot as the layout/clamp surface (CSS-scaled with pins).
        if (modelSlot) surface = modelSlot;
        updateStageMetrics();
        pendingRipplesMount?.();
        pendingRipplesMount = null;
      })
      .catch(() => {
        if (modelBackdropDisposed) return;
        if (modelSlot) modelSlot.style.display = "none";
        missing.hidden = false;
      });
  }

  function updateStageMetrics(): void {
    measureStage();
    repositionAllPins();
    repositionImageOverlay();
    if (ripplesPreview && stageWidth > 0 && stageHeight > 0) {
      ripplesPreview.setSize(stageWidth, stageHeight);
    }
    applyTransform();
  }

  const resizeObserver = new ResizeObserver(() => {
    updateStageMetrics();
  });
  resizeObserver.observe(fitContainer);

  image?.addEventListener("load", updateStageMetrics);

  if (useModelBackdrop) {
    // Fit using crop aspect until the mesh AABB is known.
    updateStageMetrics();
    startModelBackdrop();
  }

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
    previewSafeBlurSvg = previewSafeBlur.querySelector("svg") as SVGSVGElement;
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
    previewDetailCardId = null;
    previewDetailFromEntryMenu = false;
    previewSafeBoundsLockedUntilHover = false;
    setPreviewPinHighlight(null);
    updatePreviewSafeBlur();
  }

  function wirePreviewNavigation(pinId: string): void {
    if (!previewPanel) return;

    previewPanel.querySelectorAll("[data-card-id]").forEach((node) => {
      const button = node as HTMLButtonElement;
      const cardId = button.dataset.cardId;
      if (!cardId) return;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        previewSafeBoundsLockedUntilHover = false;
        previewDetailCardId = cardId;
        previewDetailFromEntryMenu = true;
        const html = resolvePreviewHtml(pinId);
        if (!html || !previewPanel) return;
        previewPanel.innerHTML = html;
        wirePreviewNavigation(pinId);
        repositionActivePreview();
      });
    });

    previewPanel.querySelectorAll('[data-action="back-to-entries"]').forEach((node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Lock first so ResizeObserver / zoom compensation cannot race the layout.
        previewSafeBoundsLockedUntilHover = true;
        previewDetailCardId = null;
        previewDetailFromEntryMenu = false;
        const html = resolvePreviewHtml(pinId);
        if (!html || !previewPanel) {
          previewSafeBoundsLockedUntilHover = false;
          return;
        }
        previewPanel.innerHTML = html;
        wirePreviewNavigation(pinId);
        // Size safe area to the entry menu once; keep frozen until pointer re-enters it.
        const pin = pins.find((entry) => entry.id === pinId);
        if (pin) {
          const display = toDisplayCoords(pin.mapX, pin.mapY);
          positionPreviewHost(display.mapX, display.mapY);
          updatePreviewSafeBlur({ force: true });
        }
      });
    });
  }

  function isPointerOverPreviewPanel(event: PointerEvent): boolean {
    if (!previewPanel || !previewHost || previewHost.hidden) return false;
    const panelRect = getPreviewPanelRect();
    if (!panelRect) return false;
    return pointInRect(event.clientX, event.clientY, panelRect);
  }

  /** While locked after Back, keep preview open until the pointer enters the menu. */
  function releasePreviewSafeBoundsLockIfHovering(event: PointerEvent): boolean {
    if (!previewSafeBoundsLockedUntilHover) return false;
    if (!isPointerOverPreviewPanel(event)) return true;
    previewSafeBoundsLockedUntilHover = false;
    updatePreviewSafeBlur();
    return false;
  }

  function getPreviewPanelRect(): DOMRect | null {
    if (!previewPanel) return null;
    const rect = previewPanel.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  function getActivePreviewPlacement(): PreviewPlacement {
    const value = previewHost?.dataset.placement;
    if (
      value === "top" ||
      value === "right" ||
      value === "bottom" ||
      value === "left" ||
      value === "translated"
    ) {
      return value;
    }
    return "top";
  }

  function getPinFacingEdge(
    panelRect: DOMRect,
    pinCenter: Point2D,
    placement: PreviewPlacement
  ): PreviewFacingEdge {
    if (placement === "top") return "bottom";
    if (placement === "bottom") return "top";
    if (placement === "left") return "right";
    if (placement === "right") return "left";

    const cx = panelRect.left + panelRect.width / 2;
    const cy = panelRect.top + panelRect.height / 2;
    const dx = pinCenter.x - cx;
    const dy = pinCenter.y - cy;
    if (Math.abs(dy) >= Math.abs(dx)) {
      return dy >= 0 ? "bottom" : "top";
    }
    return dx >= 0 ? "right" : "left";
  }

  type PanelCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

  function getClosestPanelCorner(panelRect: DOMRect, pinCenter: Point2D): PanelCorner {
    const corners: Record<PanelCorner, Point2D> = {
      "top-left": { x: panelRect.left, y: panelRect.top },
      "top-right": { x: panelRect.right, y: panelRect.top },
      "bottom-left": { x: panelRect.left, y: panelRect.bottom },
      "bottom-right": { x: panelRect.right, y: panelRect.bottom },
    };
    let closest: PanelCorner = "top-left";
    let bestDist = Infinity;
    (Object.keys(corners) as PanelCorner[]).forEach((name) => {
      const corner = corners[name];
      const dist = Math.hypot(pinCenter.x - corner.x, pinCenter.y - corner.y);
      if (dist < bestDist) {
        bestDist = dist;
        closest = name;
      }
    });
    return closest;
  }

  /** Padded corner points of the popup panel. */
  function getPaddedPanelCorners(
    panelRect: DOMRect,
    pad: number
  ): Record<PanelCorner, Point2D> {
    return {
      "top-left": { x: panelRect.left - pad, y: panelRect.top - pad },
      "top-right": { x: panelRect.right + pad, y: panelRect.top - pad },
      "bottom-left": { x: panelRect.left - pad, y: panelRect.bottom + pad },
      "bottom-right": { x: panelRect.right + pad, y: panelRect.bottom + pad },
    };
  }

  /**
   * For dual-axis translation: cone to the two corners adjacent to the closest
   * corner (the diagonal that excludes the nearest corner).
   */
  function getTranslatedConeBases(
    panelRect: DOMRect,
    pinCenter: Point2D,
    pad: number
  ): { baseA: Point2D; baseB: Point2D; closest: PanelCorner } {
    const corners = getPaddedPanelCorners(panelRect, pad);
    const closest = getClosestPanelCorner(panelRect, pinCenter);
    switch (closest) {
      case "top-left":
        return { baseA: corners["top-right"], baseB: corners["bottom-left"], closest };
      case "top-right":
        return { baseA: corners["top-left"], baseB: corners["bottom-right"], closest };
      case "bottom-left":
        return { baseA: corners["top-left"], baseB: corners["bottom-right"], closest };
      case "bottom-right":
        return { baseA: corners["top-right"], baseB: corners["bottom-left"], closest };
    }
  }

  function getBlurRadiiForFacing(
    placement: PreviewPlacement,
    panelRect: DOMRect,
    pinCenter: Point2D,
    pad: number
  ): { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number } {
    if (placement === "translated" && isDualAxisTranslated(panelRect, pinCenter, pad)) {
      const closest = getClosestPanelCorner(panelRect, pinCenter);
      // Square both edges that meet at the closest corner so the diagonal cone is flush.
      switch (closest) {
        case "top-left":
          return { topLeft: 0, topRight: 0, bottomRight: pad, bottomLeft: 0 };
        case "top-right":
          return { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: pad };
        case "bottom-left":
          return { topLeft: 0, topRight: pad, bottomRight: 0, bottomLeft: 0 };
        case "bottom-right":
          return { topLeft: pad, topRight: 0, bottomRight: 0, bottomLeft: 0 };
      }
    }

    const facing = getPinFacingEdge(panelRect, pinCenter, placement);
    return {
      topLeft: facing === "top" || facing === "left" ? 0 : pad,
      topRight: facing === "top" || facing === "right" ? 0 : pad,
      bottomRight: facing === "bottom" || facing === "right" ? 0 : pad,
      bottomLeft: facing === "bottom" || facing === "left" ? 0 : pad,
    };
  }

  /** True when the pin sits outside the panel on both axes (needs a diagonal cone). */
  function isDualAxisTranslated(
    panelRect: DOMRect,
    pinCenter: Point2D,
    pad: number = SAFE_ZONE_PAD_SCREEN_PX
  ): boolean {
    const outsideX = pinCenter.x < panelRect.left - pad || pinCenter.x > panelRect.right + pad;
    const outsideY = pinCenter.y < panelRect.top - pad || pinCenter.y > panelRect.bottom + pad;
    return outsideX && outsideY;
  }

  function getEdgeFacingCone(
    facing: PreviewFacingEdge,
    panelRect: DOMRect,
    pinCenter: Point2D,
    past: number,
    pad: number
  ): PreviewCone {
    switch (facing) {
      case "bottom":
        return {
          apex: { x: pinCenter.x, y: pinCenter.y + past },
          baseA: { x: panelRect.left - pad, y: panelRect.bottom + pad },
          baseB: { x: panelRect.right + pad, y: panelRect.bottom + pad },
        };
      case "top":
        return {
          apex: { x: pinCenter.x, y: pinCenter.y - past },
          baseA: { x: panelRect.left - pad, y: panelRect.top - pad },
          baseB: { x: panelRect.right + pad, y: panelRect.top - pad },
        };
      case "left":
        return {
          apex: { x: pinCenter.x - past, y: pinCenter.y },
          baseA: { x: panelRect.left - pad, y: panelRect.top - pad },
          baseB: { x: panelRect.left - pad, y: panelRect.bottom + pad },
        };
      case "right":
        return {
          apex: { x: pinCenter.x + past, y: pinCenter.y },
          baseA: { x: panelRect.right + pad, y: panelRect.top - pad },
          baseB: { x: panelRect.right + pad, y: panelRect.bottom + pad },
        };
    }
  }

  /** Cone from slightly past the pin to the pin-facing popup edge(s). */
  function getPreviewCone(
    panelRect: DOMRect,
    pinGeometry: { center: Point2D; radius: number },
    placement: PreviewPlacement,
    pad: number = SAFE_ZONE_PAD_SCREEN_PX
  ): PreviewCone {
    const { center: pinCenter, radius: pinRadius } = pinGeometry;
    const past = pinRadius + PREVIEW_CONE_PAST_SCREEN_PX;

    if (placement === "translated") {
      // Only use the diagonal cone when the pin is outside on both axes.
      // Single-axis clamps should use a normal edge cone against the live panel rect.
      if (isDualAxisTranslated(panelRect, pinCenter, pad)) {
        const { baseA, baseB, closest } = getTranslatedConeBases(panelRect, pinCenter, pad);
        const closestPt = getPaddedPanelCorners(panelRect, pad)[closest];
        const dx = pinCenter.x - closestPt.x;
        const dy = pinCenter.y - closestPt.y;
        const len = Math.hypot(dx, dy) || 1;
        return {
          apex: {
            x: pinCenter.x + (dx / len) * past,
            y: pinCenter.y + (dy / len) * past,
          },
          baseA,
          baseB,
        };
      }

      return getEdgeFacingCone(
        getPinFacingEdge(panelRect, pinCenter, placement),
        panelRect,
        pinCenter,
        past,
        pad
      );
    }

    return getEdgeFacingCone(
      getPinFacingEdge(panelRect, pinCenter, placement),
      panelRect,
      pinCenter,
      past,
      pad
    );
  }

  /** Safe bounds for hover/blur: padded popup plus pin-facing cone. */
  function getPreviewSafeBounds(
    panelRect: DOMRect,
    pinGeometry: { center: Point2D; radius: number },
    placement: PreviewPlacement = getActivePreviewPlacement(),
    pad: number = SAFE_ZONE_PAD_SCREEN_PX
  ): { left: number; top: number; right: number; bottom: number; cone: PreviewCone } {
    const cone = getPreviewCone(panelRect, pinGeometry, placement, pad);
    return {
      left: Math.min(panelRect.left - pad, cone.apex.x, cone.baseA.x, cone.baseB.x),
      top: Math.min(panelRect.top - pad, cone.apex.y, cone.baseA.y, cone.baseB.y),
      right: Math.max(panelRect.right + pad, cone.apex.x, cone.baseA.x, cone.baseB.x),
      bottom: Math.max(panelRect.bottom + pad, cone.apex.y, cone.baseA.y, cone.baseB.y),
      cone,
    };
  }

  function getPinScreenCenter(mapX: number, mapY: number): { x: number; y: number } {
    if (previewCardId) {
      const pin = getPinElement(previewCardId);
      if (pin) {
        const rect = pin.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }
      }
    }

    const viewportRect = viewport.getBoundingClientRect();
    return {
      x: viewportRect.left + translateX + mapX * stageWidth * scale,
      y: viewportRect.top + translateY + mapY * stageHeight * scale,
    };
  }

  function popupRectForPlacement(
    placement: Exclude<PreviewPlacement, "translated">,
    pinX: number,
    pinY: number,
    width: number,
    height: number,
    gap: number,
    clearance: number
  ): { left: number; top: number; right: number; bottom: number } {
    switch (placement) {
      case "top":
        return {
          left: pinX - width / 2,
          top: pinY - clearance - gap - height,
          right: pinX + width / 2,
          bottom: pinY - clearance - gap,
        };
      case "right":
        return {
          left: pinX + clearance + gap,
          top: pinY - height / 2,
          right: pinX + clearance + gap + width,
          bottom: pinY + height / 2,
        };
      case "bottom":
        return {
          left: pinX - width / 2,
          top: pinY + clearance + gap,
          right: pinX + width / 2,
          bottom: pinY + clearance + gap + height,
        };
      case "left":
        return {
          left: pinX - clearance - gap - width,
          top: pinY - height / 2,
          right: pinX - clearance - gap,
          bottom: pinY + height / 2,
        };
    }
  }

  function rectFitsInContainer(
    rect: { left: number; top: number; right: number; bottom: number },
    container: DOMRect,
    margin: number
  ): boolean {
    return (
      rect.left >= container.left + margin &&
      rect.right <= container.right - margin &&
      rect.top >= container.top + margin &&
      rect.bottom <= container.bottom - margin
    );
  }

  function determinePopupDirection(
    pinX: number,
    pinY: number,
    width: number,
    height: number,
    container: DOMRect
  ): { placement: PreviewPlacement; translated: PopupTranslatedPosition } {
    const gap = PREVIEW_GAP_SCREEN_PX;
    const clearance = PREVIEW_PIN_CLEARANCE_SCREEN_PX;
    const margin = PREVIEW_EDGE_MARGIN_SCREEN_PX;
    const translated: PopupTranslatedPosition = { x: 0, y: 0 };

    const order: Array<Exclude<PreviewPlacement, "translated">> = [
      "top",
      "right",
      "bottom",
      "left",
    ];
    for (const placement of order) {
      const rect = popupRectForPlacement(placement, pinX, pinY, width, height, gap, clearance);
      if (rectFitsInContainer(rect, container, margin)) {
        return { placement, translated };
      }
    }

    const distanceToTop = pinY - container.top;
    const distanceToRight = container.right - pinX;
    const distanceToBottom = container.bottom - pinY;
    const distanceToLeft = pinX - container.left;

    let popupLeft =
      distanceToRight > distanceToLeft
        ? pinX + clearance + gap
        : pinX - clearance - gap - width;
    let popupTop =
      distanceToTop > distanceToBottom
        ? pinY - clearance - gap - height
        : pinY + clearance + gap;

    const maxLeft = Math.max(container.left + margin, container.right - margin - width);
    const maxTop = Math.max(container.top + margin, container.bottom - margin - height);
    popupLeft = clamp(popupLeft, container.left + margin, maxLeft);
    popupTop = clamp(popupTop, container.top + margin, maxTop);

    translated.x = popupLeft - pinX;
    translated.y = popupTop - pinY;
    return { placement: "translated", translated };
  }

  function positionPreviewHost(mapX: number, mapY: number): void {
    if (!previewHost) return;

    const comp = 1 / scale;
    const gapStage = PREVIEW_GAP_SCREEN_PX / scale;
    const pinClearanceStage = PREVIEW_PIN_CLEARANCE_SCREEN_PX / scale;
    const width = previewPanel?.offsetWidth ?? previewHost.offsetWidth;
    const height = previewPanel?.offsetHeight ?? previewHost.offsetHeight;
    const pin = getPinScreenCenter(mapX, mapY);
    const container = viewport.getBoundingClientRect();
    const { placement, translated } =
      width > 0 && height > 0
        ? determinePopupDirection(pin.x, pin.y, width, height, container)
        : { placement: "top" as PreviewPlacement, translated: { x: 0, y: 0 } };

    let transformOrigin = "50% 100%";
    let transform = `translate(-50%, ${-(Math.max(height, 0) + gapStage + pinClearanceStage)}px) scale(${comp})`;

    switch (placement) {
      case "top":
        transformOrigin = "50% 100%";
        transform = `translate(-50%, ${-(height + gapStage + pinClearanceStage)}px) scale(${comp})`;
        break;
      case "right":
        transformOrigin = "0% 50%";
        transform = `translate(${gapStage + pinClearanceStage}px, -50%) scale(${comp})`;
        break;
      case "bottom":
        transformOrigin = "50% 0%";
        transform = `translate(-50%, ${gapStage + pinClearanceStage}px) scale(${comp})`;
        break;
      case "left":
        transformOrigin = "100% 50%";
        transform = `translate(${-(width + gapStage + pinClearanceStage)}px, -50%) scale(${comp})`;
        break;
      case "translated":
        // Host at clamped popup origin in stage space; scale only (no translate).
        // Keeps getBoundingClientRect aligned with the painted card for safe-zone math.
        transformOrigin = "0 0";
        transform = `scale(${comp})`;
        break;
    }

    if (stageWidth > 0 && stageHeight > 0) {
      const pinStageX = mapX * stageWidth;
      const pinStageY = mapY * stageHeight;
      if (placement === "translated") {
        previewHost.style.left = `${pinStageX + translated.x / scale}px`;
        previewHost.style.top = `${pinStageY + translated.y / scale}px`;
      } else {
        previewHost.style.left = `${pinStageX}px`;
        previewHost.style.top = `${pinStageY}px`;
      }
    } else if (placement === "translated") {
      previewHost.style.left = `${mapX * 100}%`;
      previewHost.style.top = `${mapY * 100}%`;
      transform = `translate(${translated.x}px, ${translated.y}px) scale(${comp})`;
    } else {
      previewHost.style.left = `${mapX * 100}%`;
      previewHost.style.top = `${mapY * 100}%`;
    }

    previewHost.style.transformOrigin = transformOrigin;
    previewHost.style.transform = transform;
    previewHost.dataset.placement = placement;
  }

  function showPreviewHtml(
    html: string,
    pinId: string,
    displayMapX: number,
    displayMapY: number,
    options: { replaceContent?: boolean } = {}
  ): void {
    ensurePreviewLayer();
    const samePreview = previewCardId === pinId && previewHost !== null && !previewHost.hidden;
    if (!samePreview || options.replaceContent) {
      previewPanel!.innerHTML = html;
    }
    previewHost!.hidden = false;
    previewCardId = pinId;
    setPreviewPinHighlight(pinId);
    positionPreviewHost(displayMapX, displayMapY);
    updatePreviewSafeBlur();

    if (samePreview && !options.replaceContent) return;

    wirePreviewNavigation(pinId);

    previewPanel!.querySelectorAll("img").forEach((img) => {
      if (img.complete) return;
      const onImageReady = (): void => repositionActivePreview();
      img.addEventListener("load", onImageReady, { once: true });
      img.addEventListener("error", onImageReady, { once: true });
    });
  }

  function openPinPreview(
    pinId: string | null,
    options: {
      detailCardId?: string | null;
      replaceContent?: boolean;
      fromEntryMenu?: boolean;
    } = {}
  ): void {
    if (!pinId || !previewEnabled) {
      hidePreview();
      return;
    }

    if (options.detailCardId !== undefined) {
      previewDetailCardId = options.detailCardId;
      previewDetailFromEntryMenu = options.fromEntryMenu === true;
    }

    const pin = pins.find((entry) => entry.id === pinId);
    if (!pin) {
      hidePreview();
      return;
    }

    const html = resolvePreviewHtml(pinId);
    if (!html) {
      hidePreview();
      return;
    }

    const display = toDisplayCoords(pin.mapX, pin.mapY);
    showPreviewHtml(html, pinId, display.mapX, display.mapY, {
      replaceContent: options.replaceContent,
    });
  }

  function getPinElement(cardId: string): HTMLElement | null {
    return pinsLayer.querySelector(`.map-editor__pin[data-id="${CSS.escape(cardId)}"]`);
  }

  /** True when any part of the pin intersects the clipped map viewport. */
  function isPinVisibleInViewport(pinId: string): boolean {
    const pin = getPinElement(pinId);
    if (!pin) return false;

    const pinRect = pin.getBoundingClientRect();
    if (pinRect.width === 0 && pinRect.height === 0) return false;

    const viewportRect = viewport.getBoundingClientRect();
    return (
      pinRect.right > viewportRect.left &&
      pinRect.left < viewportRect.right &&
      pinRect.bottom > viewportRect.top &&
      pinRect.top < viewportRect.bottom
    );
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
    pinGeometry: { center: Point2D; radius: number }
  ): boolean {
    const pad = SAFE_ZONE_PAD_SCREEN_PX;
    if (
      x >= panelRect.left - pad &&
      x <= panelRect.right + pad &&
      y >= panelRect.top - pad &&
      y <= panelRect.bottom + pad
    ) {
      return true;
    }

    const cone = getPreviewCone(panelRect, pinGeometry, getActivePreviewPlacement(), pad);
    return pointInTriangle({ x, y }, cone.apex, cone.baseA, cone.baseB);
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

    return isPointInPreviewSafeBounds(x, y, panelRect, getPinScreenGeometry(pin));
  }

  function findPreviewToOpen(
    event: PointerEvent
  ): { pinId: string; html: string; displayMapX: number; displayMapY: number } | null {
    if (!hoverPreviewsActive()) return null;

    for (const pinDatum of pins) {
      if (!isPointerOnPinDot(event, pinDatum.id)) continue;

      const previousDetail = previewDetailCardId;
      const previousFromEntryMenu = previewDetailFromEntryMenu;
      // Fresh pin hover shows the entry menu (not a previously selected detail).
      if (previewCardId !== pinDatum.id) {
        previewDetailCardId = null;
        previewDetailFromEntryMenu = false;
      }
      const html = resolvePreviewHtml(pinDatum.id);
      if (!html) {
        previewDetailCardId = previousDetail;
        previewDetailFromEntryMenu = previousFromEntryMenu;
        continue;
      }

      const display = toDisplayCoords(pinDatum.mapX, pinDatum.mapY);
      return { pinId: pinDatum.id, html, displayMapX: display.mapX, displayMapY: display.mapY };
    }

    return null;
  }

  function updatePreviewFromPointer(event: PointerEvent): void {
    if (dragging || panning) return;
    if (!hoverPreviewsActive()) {
      hidePreview();
      return;
    }

    if (previewCardId && previewHost && !previewHost.hidden) {
      if (releasePreviewSafeBoundsLockIfHovering(event)) {
        return;
      }

      if (isPointerInPreviewSafeZone(event, previewCardId)) {
        return;
      }

      const next = findPreviewToOpen(event);
      if (next) {
        previewSafeBoundsLockedUntilHover = false;
        showPreviewHtml(next.html, next.pinId, next.displayMapX, next.displayMapY, {
          replaceContent: true,
        });
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

    previewSafeBoundsLockedUntilHover = false;
    showPreviewHtml(match.html, match.pinId, match.displayMapX, match.displayMapY, {
      replaceContent: true,
    });
  }

  function renderPins(): void {
    pinsLayer.innerHTML = "";
    previewHost = null;
    previewPanel = null;
    previewCardId = null;
    previewDetailCardId = null;
    previewDetailFromEntryMenu = false;
    previewSafeBoundsLockedUntilHover = false;
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

    renderImageOverlay();
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
    let mx = event.clientX - rect.left;
    let my = event.clientY - rect.top;

    // Zoom around the selected pin (live DOM position), else the open preview pin.
    let zoomDisplay: { mapX: number; mapY: number } | null = null;
    if (selectedPin && stageWidth > 0 && stageHeight > 0) {
      const left = parseFloat(selectedPin.style.left);
      const top = parseFloat(selectedPin.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        zoomDisplay = { mapX: left / stageWidth, mapY: top / stageHeight };
      }
    } else if (previewCardId && previewHost && !previewHost.hidden) {
      const pin = pins.find((entry) => entry.id === previewCardId);
      if (pin) zoomDisplay = toDisplayCoords(pin.mapX, pin.mapY);
    }

    if (zoomDisplay) {
      mx = translateX + zoomDisplay.mapX * stageWidth * scale;
      my = translateY + zoomDisplay.mapY * stageHeight * scale;
    }

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
    const ripplesTarget = (event.target as HTMLElement).closest(".map-editor__ripples-canvas");
    if (allowRipplesOriginDrag && ripplesTarget) {
      ripplesOriginDragging = true;
      ripplesPreview?.canvas.classList.add("map-editor__ripples-canvas--dragging");
      hidePreview();
      const coords = pointerToMapXY(event);
      if (coords) {
        const stored = fromDisplayCoords(coords.mapX, coords.mapY);
        ripplesOrigin = { mapX: stored.mapX, mapY: stored.mapY };
        ripplesPreview?.setOrigin(stored.mapX, stored.mapY);
        onOverlayMove?.(stored.mapX, stored.mapY);
      }
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const overlayTarget = (event.target as HTMLElement).closest(".map-editor__overlay-host");
    if (allowOverlayDrag && overlayTarget) {
      overlayDragging = true;
      hidePreview();
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const target = (event.target as HTMLElement).closest(".map-editor__pin") as HTMLButtonElement | null;
    if (allowSelectedPinDrag && target?.classList.contains("map-editor__pin--selected")) {
      dragging = true;
      hidePreview();
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const pinId = target?.dataset.id;
    if (
      pinId &&
      pinId !== "draft" &&
      isCompactPointerUi() &&
      onPinActivate
    ) {
      pendingPinActivateId = pinId;
      pendingPinActivateX = event.clientX;
      pendingPinActivateY = event.clientY;
      hidePreview();
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".map-editor__preview")) return;
    if ((event.target as HTMLElement).closest(".map-editor__overlay-host")) return;
    if ((event.target as HTMLElement).closest(".map-editor__ripples-canvas")) return;

    panning = true;
    panStartX = event.clientX;
    panStartY = event.clientY;
    panOriginX = translateX;
    panOriginY = translateY;
    viewport.classList.add("map-editor__viewport--panning");
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (ripplesOriginDragging && ripplesOrigin) {
      hidePreview();
      const coords = pointerToMapXY(event);
      if (!coords) return;
      const stored = fromDisplayCoords(coords.mapX, coords.mapY);
      ripplesOrigin = { mapX: stored.mapX, mapY: stored.mapY };
      ripplesPreview?.setOrigin(stored.mapX, stored.mapY);
      onOverlayMove?.(stored.mapX, stored.mapY);
      return;
    }

    if (overlayDragging && overlayState) {
      hidePreview();
      const coords = pointerToMapXY(event);
      if (!coords) return;
      const stored = fromDisplayCoords(coords.mapX, coords.mapY);
      overlayState = { ...overlayState, mapX: stored.mapX, mapY: stored.mapY };
      positionImageOverlay();
      onOverlayMove?.(stored.mapX, stored.mapY);
      return;
    }

    if (dragging && selectedPin) {
      hidePreview();
      const coords = pointerToMapXY(event);
      if (!coords) return;
      positionPin(selectedPin, coords.mapX, coords.mapY);
      const stored = fromDisplayCoords(coords.mapX, coords.mapY);
      onPinMove(stored.mapX, stored.mapY);
      return;
    }

    if (panning) {
      translateX = panOriginX + (event.clientX - panStartX);
      translateY = panOriginY + (event.clientY - panStartY);
      applyTransform();
      if (previewCardId) {
        repositionActivePreview();
      }
      return;
    }

    if (pendingPinActivateId) {
      const dx = event.clientX - pendingPinActivateX;
      const dy = event.clientY - pendingPinActivateY;
      if (Math.hypot(dx, dy) > PIN_ACTIVATE_MOVE_PX) {
        panning = true;
        panStartX = pendingPinActivateX;
        panStartY = pendingPinActivateY;
        panOriginX = translateX;
        panOriginY = translateY;
        pendingPinActivateId = null;
        viewport.classList.add("map-editor__viewport--panning");
        translateX = panOriginX + dx;
        translateY = panOriginY + dy;
        applyTransform();
      }
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
    pendingPinActivateId = null;
    dragging = false;
    overlayDragging = false;
    ripplesOriginDragging = false;
    ripplesPreview?.canvas.classList.remove("map-editor__ripples-canvas--dragging");
    panning = false;
    viewport.classList.remove("map-editor__viewport--panning");
  };

  const onPointerUp = (): void => {
    if (pendingPinActivateId && onPinActivate) {
      const pinId = pendingPinActivateId;
      pendingPinActivateId = null;
      stopPointerInteraction();
      onPinActivate(pinId);
      return;
    }
    stopPointerInteraction();
  };

  const onCompactPointerUiChange = (): void => {
    if (isCompactPointerUi()) {
      hidePreview();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!allowSelectedPinDrag || !selectedPin || stageWidth <= 0 || stageHeight <= 0) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    let dDisplayX = 0;
    let dDisplayY = 0;
    if (key === "ArrowLeft" || key === "a") dDisplayX = -1;
    else if (key === "ArrowRight" || key === "d") dDisplayX = 1;
    else if (key === "ArrowUp" || key === "w") dDisplayY = -1;
    else if (key === "ArrowDown" || key === "s") dDisplayY = 1;
    else return;

    event.preventDefault();
    hidePreview();

    const left = parseFloat(selectedPin.style.left);
    const top = parseFloat(selectedPin.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;

    const step = event.shiftKey ? PIN_NUDGE_STEP_FINE : PIN_NUDGE_STEP;
    const displayMapX = clamp(left / stageWidth + dDisplayX * step, 0, 1);
    const displayMapY = clamp(top / stageHeight + dDisplayY * step, 0, 1);
    positionPin(selectedPin, displayMapX, displayMapY);
    const stored = fromDisplayCoords(displayMapX, displayMapY);
    onPinMove(stored.mapX, stored.mapY);
  };

  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerleave", onPointerLeave);
  viewport.addEventListener("pointerup", onPointerUp);
  viewport.addEventListener("pointercancel", stopPointerInteraction);
  compactPointerMq.addEventListener("change", onCompactPointerUiChange);
  window.addEventListener("keydown", onKeyDown);

  renderPins();
  mountRipplesPreview();
  applyTransform();
  if (image?.complete) {
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
    getOverlayPosition(): { mapX: number; mapY: number } | null {
      if (ripplesOrigin) {
        return { mapX: ripplesOrigin.mapX, mapY: ripplesOrigin.mapY };
      }
      if (!overlayState) return null;
      return { mapX: overlayState.mapX, mapY: overlayState.mapY };
    },
    showCardPreview(cardId: string | null): void {
      if (!cardId) {
        openPinPreview(null);
        return;
      }

      if (!hoverPreviewsActive()) {
        return;
      }

      const card = previewCards?.find((entry) => entry.id === cardId);
      const pinId = card ? locationKey(card.mapX, card.mapY) : cardId;
      if (!isPinVisibleInViewport(pinId)) {
        return;
      }

      if (card) {
        openPinPreview(pinId, { detailCardId: cardId, replaceContent: true });
        return;
      }

      openPinPreview(cardId, { replaceContent: true });
    },
    destroy(): void {
      modelBackdropDisposed = true;
      modelBackdrop?.dispose();
      modelBackdrop = null;
      pendingRipplesMount = null;
      ripplesPreviewDisposed = true;
      ripplesPreview?.dispose();
      ripplesPreview = null;
      resizeObserver.disconnect();
      compactPointerMq.removeEventListener("change", onCompactPointerUiChange);
      window.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerleave", onPointerLeave);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", stopPointerInteraction);
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
