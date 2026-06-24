import { MAP_ADMIN_REFERENCE_PATH } from "../shared/types";

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
}

export function createMapEditor(
  container: HTMLElement,
  options: MapEditorOptions,
  callbacks: MapEditorCallbacks
): {
  setSelectedPin: (mapX: number, mapY: number) => void;
  getSelectedPinPosition: () => { mapX: number; mapY: number } | null;
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
  } = options;

  container.innerHTML = `
    <div class="map-editor">
      <img src="${imagePath}" alt="Map reference" class="map-editor__image" draggable="false" />
      <div class="map-editor__missing" hidden>
        Add <code>public/map-reference - cropped.jpg</code> to place pins visually.
      </div>
      <div class="map-editor__pins"></div>
    </div>
  `;

  const image = container.querySelector(".map-editor__image") as HTMLImageElement;
  const missing = container.querySelector(".map-editor__missing") as HTMLElement;
  const pinsLayer = container.querySelector(".map-editor__pins") as HTMLElement;
  let selectedPin: HTMLButtonElement | null = null;

  image.addEventListener("error", () => {
    image.style.display = "none";
    missing.hidden = false;
  });

  function renderPins(): void {
    pinsLayer.innerHTML = "";
    selectedPin = null;

    for (const pinDatum of pins) {
      const pin = createPin(pinDatum.id, pinDatum.label, pinDatum.id === selectedId);
      const display = toDisplayCoords(pinDatum.mapX, pinDatum.mapY);
      positionPin(pin, display.mapX, display.mapY);
      pinsLayer.appendChild(pin);
    }

    if (!selectedId && draftPosition) {
      selectedPin = createPin("draft", "New location", true);
      const display = toDisplayCoords(draftPosition.mapX, draftPosition.mapY);
      positionPin(selectedPin, display.mapX, display.mapY);
      pinsLayer.appendChild(selectedPin);
    }
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
    pin.style.left = `${mapX * 100}%`;
    pin.style.top = `${mapY * 100}%`;
  }

  function pointerToMapXY(event: PointerEvent): { mapX: number; mapY: number } | null {
    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      mapX: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      mapY: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  let dragging = false;

  const onPointerDown = (event: PointerEvent): void => {
    const target = (event.target as HTMLElement).closest(".map-editor__pin") as HTMLButtonElement | null;
    if (!target?.classList.contains("map-editor__pin--selected")) return;
    dragging = true;
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || !selectedPin) return;
    const coords = pointerToMapXY(event);
    if (!coords) return;
    positionPin(selectedPin, coords.mapX, coords.mapY);
    const stored = fromDisplayCoords(coords.mapX, coords.mapY);
    callbacks.onPinMove(stored.mapX, stored.mapY);
  };

  const stopDrag = (): void => {
    dragging = false;
  };

  pinsLayer.addEventListener("pointerdown", onPointerDown);
  pinsLayer.addEventListener("pointermove", onPointerMove);
  pinsLayer.addEventListener("pointerup", stopDrag);
  pinsLayer.addEventListener("pointercancel", stopDrag);

  renderPins();

  return {
    setSelectedPin(mapX: number, mapY: number): void {
      if (!selectedPin) return;
      const display = toDisplayCoords(mapX, mapY);
      positionPin(selectedPin, display.mapX, display.mapY);
    },
    getSelectedPinPosition(): { mapX: number; mapY: number } | null {
      if (!selectedPin) return null;
      const displayX = parseFloat(selectedPin.style.left) / 100;
      const displayY = parseFloat(selectedPin.style.top) / 100;
      if (!Number.isFinite(displayX) || !Number.isFinite(displayY)) return null;
      return fromDisplayCoords(displayX, displayY);
    },
    destroy(): void {
      pinsLayer.removeEventListener("pointerdown", onPointerDown);
      pinsLayer.removeEventListener("pointermove", onPointerMove);
      pinsLayer.removeEventListener("pointerup", stopDrag);
      pinsLayer.removeEventListener("pointercancel", stopDrag);
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
