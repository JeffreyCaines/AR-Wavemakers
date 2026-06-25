import { buildCardContentHtml } from "../shared/cardContent";
import { MAP_ADMIN_REFERENCE_PATH, type InfoCard } from "../shared/types";

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
  /** When false, the selected pin is not draggable (e.g. cards list is showing). */
  allowSelectedPinDrag?: boolean;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_FACTOR = 1.1;
const PREVIEW_GAP_SCREEN_PX = 12;
const SAFE_ZONE_PAD_SCREEN_PX = 10;

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
    const gap = 16;

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

    const cardsWidth = cardsPanel.getBoundingClientRect().width || 320;
    return {
      width: Math.max(1, innerWidth - cardsWidth - gap),
      height: innerHeight,
    };
  }
  let selectedPin: HTMLButtonElement | null = null;
  let previewHost: HTMLElement | null = null;
  let previewPanel: HTMLElement | null = null;
  let previewCardId: string | null = null;
  let previewPlacement: "above" | "below" = "above";
  const previewEnabled = Boolean(previewCards?.length);

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
    if (previewHost && previewCardId && !previewHost.hidden) {
      const pin = pins.find((entry) => entry.id === previewCardId);
      if (pin) {
        const display = toDisplayCoords(pin.mapX, pin.mapY);
        positionPreviewHost(display.mapX, display.mapY);
      }
    }
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
    previewPlacement = "above";
    setPreviewPinHighlight(null);
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
    const height = previewHost.offsetHeight;

    previewPlacement = "above";
    previewHost.style.transformOrigin = "50% 100%";
    const offsetAbove = height > 0 ? -(height + gapStage) : -gapStage;
    previewHost.style.transform = `translate(-50%, ${offsetAbove}px) scale(${comp})`;

    const viewportRect = viewport.getBoundingClientRect();
    let hostRect = previewHost.getBoundingClientRect();
    if (hostRect.top < viewportRect.top + SAFE_ZONE_PAD_SCREEN_PX) {
      previewPlacement = "below";
      previewHost.style.transformOrigin = "50% 0%";
      const offsetBelow = gapStage + pinClearanceStage;
      previewHost.style.transform = `translate(-50%, ${offsetBelow}px) scale(${comp})`;
    }

    previewHost.dataset.placement = previewPlacement;
  }

  function showPreview(card: InfoCard, displayMapX: number, displayMapY: number): void {
    ensurePreviewLayer();
    previewPanel!.innerHTML = buildCardContentHtml(card);
    previewHost!.hidden = false;
    positionPreviewHost(displayMapX, displayMapY);
    previewCardId = card.id;
    setPreviewPinHighlight(card.id);
  }

  function openCardPreview(cardId: string | null): void {
    if (!cardId || !previewCards?.length) {
      hidePreview();
      return;
    }

    const card = previewCards.find((entry) => entry.id === cardId);
    const pin = pins.find((entry) => entry.id === cardId);
    if (!card || !pin) {
      hidePreview();
      return;
    }

    const display = toDisplayCoords(pin.mapX, pin.mapY);
    showPreview(card, display.mapX, display.mapY);
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

  function isPointerInPreviewSafeZone(event: PointerEvent, cardId: string): boolean {
    const { clientX: x, clientY: y } = event;
    const pin = getPinElement(cardId);

    if (pin && pointInRect(x, y, pin.getBoundingClientRect(), SAFE_ZONE_PAD_SCREEN_PX)) {
      return true;
    }

    if (!previewHost || previewHost.hidden) return false;

    const hostRect = previewHost.getBoundingClientRect();
    if (pointInRect(x, y, hostRect, SAFE_ZONE_PAD_SCREEN_PX)) return true;
    if (!pin) return false;

    const pinRect = pin.getBoundingClientRect();
    const pad = SAFE_ZONE_PAD_SCREEN_PX;
    const bridge =
      previewPlacement === "below"
        ? {
            left: Math.min(hostRect.left, pinRect.left) - pad,
            right: Math.max(hostRect.right, pinRect.right) + pad,
            top: pinRect.top - pad,
            bottom: hostRect.top + pad,
          }
        : {
            left: Math.min(hostRect.left, pinRect.left) - pad,
            right: Math.max(hostRect.right, pinRect.right) + pad,
            top: Math.min(hostRect.top, pinRect.top) - pad,
            bottom: Math.max(hostRect.bottom, pinRect.bottom) + pad,
          };

    return x >= bridge.left && x <= bridge.right && y >= bridge.top && y <= bridge.bottom;
  }

  function findPreviewCardToOpen(event: PointerEvent): { card: InfoCard; displayMapX: number; displayMapY: number } | null {
    if (!previewCards?.length) return null;

    for (const card of previewCards) {
      if (!isPointerOnPinDot(event, card.id)) continue;

      const pin = pins.find((entry) => entry.id === card.id);
      if (!pin) continue;

      const display = toDisplayCoords(pin.mapX, pin.mapY);
      return { card, displayMapX: display.mapX, displayMapY: display.mapY };
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

      const next = findPreviewCardToOpen(event);
      if (next) {
        showPreview(next.card, next.displayMapX, next.displayMapY);
        return;
      }

      hidePreview();
      return;
    }

    const match = findPreviewCardToOpen(event);
    if (!match) {
      hidePreview();
      return;
    }

    showPreview(match.card, match.displayMapX, match.displayMapY);
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
      openCardPreview(cardId);
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
