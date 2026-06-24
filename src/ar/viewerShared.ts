import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { buildCardContentHtml } from "../shared/cardContent";
import { mapXYToAnchorPosition } from "../shared/geo";
import type { InfoCard } from "../shared/types";

export const POINT_THRESHOLD = 0.12;
export const SHEET_OPEN_DELAY_MS = 1500;
const SHEET_SWIPE_DISMISS_PX = 72;
const SHEET_DRAG_START_PX = 8;

export interface CardOverlay {
  card: InfoCard;
  markerObject: CSS2DObject;
  panelObject: CSS2DObject;
  marker: HTMLDivElement;
  panel: HTMLDivElement;
}

export interface ActiveCardTracker {
  handleActiveCard: (activeCard: InfoCard | null) => void;
  resetSheetTimer: () => void;
}

export interface CardDetailSheet {
  show: (card: InfoCard) => void;
  dismiss: () => void;
  dismissFromHistory: () => void;
  isOpen: () => boolean;
  getCardId: () => string | null;
}

export function createCardOverlay(card: InfoCard, aspectRatio: number): CardOverlay {
  const pos = mapXYToAnchorPosition(card.mapX, card.mapY, aspectRatio);

  const markerHost = document.createElement("div");
  markerHost.className = "ar-card-marker-host";

  const marker = document.createElement("div");
  marker.className = "ar-card__marker";
  markerHost.append(marker);

  const panelHost = document.createElement("div");
  panelHost.className = "ar-card-panel-host";

  const panel = document.createElement("div");
  panel.className = "ar-card__panel";
  panel.innerHTML = buildCardContentHtml(card);
  panelHost.append(panel);

  const markerObject = new CSS2DObject(markerHost);
  markerObject.position.set(pos.x, pos.y, 0);
  markerObject.renderOrder = 0;

  const panelObject = new CSS2DObject(panelHost);
  panelObject.position.set(pos.x, pos.y, 0);
  panelObject.renderOrder = 1;

  return { card, markerObject, panelObject, marker, panel };
}

export function updateTrackingUI(statusEl: HTMLElement, tracking: boolean): void {
  if (tracking) {
    statusEl.textContent = "Map detected. Aim at a location.";
    statusEl.classList.add("ar-status--tracking");
  } else {
    statusEl.textContent = "Point your camera at the map on the wall.";
    statusEl.classList.remove("ar-status--tracking");
  }
}

export interface PointingOptions {
  /** Max crosshair-to-marker distance in CSS pixels (sim preview). */
  thresholdPx?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export function updatePointing(
  overlays: CardOverlay[],
  camera: THREE.Camera,
  sheetOpen: boolean,
  options?: PointingOptions
): InfoCard | null {
  const center = new THREE.Vector2(0, 0);
  const projected = new THREE.Vector3();
  let closest: { id: string; distance: number } | null = null;
  const usePixelThreshold =
    options?.thresholdPx !== undefined &&
    options.viewportWidth !== undefined &&
    options.viewportHeight !== undefined &&
    options.viewportWidth > 0 &&
    options.viewportHeight > 0;
  const threshold = usePixelThreshold ? options!.thresholdPx! : POINT_THRESHOLD;

  for (const overlay of overlays) {
    overlay.markerObject.getWorldPosition(projected);
    projected.project(camera);

    if (projected.z > 1) continue;

    const distance = usePixelThreshold
      ? Math.hypot(
          projected.x * (options!.viewportWidth! / 2),
          projected.y * (options!.viewportHeight! / 2)
        )
      : center.distanceTo(new THREE.Vector2(projected.x, projected.y));
    if (distance < threshold && (!closest || distance < closest.distance)) {
      closest = { id: overlay.card.id, distance };
    }
  }

  const nextActive = closest?.id ?? null;

  for (const overlay of overlays) {
    const isActive = overlay.card.id === nextActive;
    overlay.markerObject.visible = !sheetOpen;
    overlay.marker.classList.toggle("ar-card__marker--active", isActive && !sheetOpen);
    overlay.panel.classList.toggle("ar-card__panel--visible", isActive && !sheetOpen);
  }

  return overlays.find((overlay) => overlay.card.id === nextActive)?.card ?? null;
}

export function createActiveCardTracker(sheet: CardDetailSheet): ActiveCardTracker {
  let sheetTimer: ReturnType<typeof setTimeout> | null = null;
  let loseTargetTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSheetCardId: string | null = null;

  const clearSheetTimers = (): void => {
    if (sheetTimer !== null) {
      clearTimeout(sheetTimer);
      sheetTimer = null;
    }
    if (loseTargetTimer !== null) {
      clearTimeout(loseTargetTimer);
      loseTargetTimer = null;
    }
  };

  return {
    handleActiveCard(activeCard: InfoCard | null): void {
      if (sheet.isOpen()) {
        return;
      }

      if (!activeCard) {
        if (pendingSheetCardId && loseTargetTimer === null) {
          loseTargetTimer = setTimeout(() => {
            loseTargetTimer = null;
            clearSheetTimers();
            pendingSheetCardId = null;
          }, 500);
        }
        return;
      }

      if (loseTargetTimer !== null) {
        clearTimeout(loseTargetTimer);
        loseTargetTimer = null;
      }

      if (pendingSheetCardId !== activeCard.id) {
        if (sheetTimer !== null) {
          clearTimeout(sheetTimer);
          sheetTimer = null;
        }
        pendingSheetCardId = activeCard.id;
        sheetTimer = setTimeout(() => {
          sheetTimer = null;
          if (pendingSheetCardId === activeCard.id && !sheet.isOpen()) {
            sheet.show(activeCard);
          }
        }, SHEET_OPEN_DELAY_MS);
      }
    },
    resetSheetTimer(): void {
      clearSheetTimers();
      pendingSheetCardId = null;
    },
  };
}

export function createCardDetailSheet(
  backdrop: HTMLElement,
  sheet: HTMLElement,
  content: HTMLElement,
  callbacks: { onOpen: () => void; onDismiss: () => void }
): CardDetailSheet {
  let open = false;
  let cardId: string | null = null;
  let historyPushed = false;
  let dragStartY = 0;
  let dragOffset = 0;
  let dragPointerId: number | null = null;
  let dragMode: "pending" | "sheet" | "scroll" = "pending";

  const clearSheetTransform = (): void => {
    sheet.style.removeProperty("transform");
  };

  const setSheetDragOffset = (offsetPx: number): void => {
    sheet.style.transform = `translateY(${offsetPx}px)`;
  };

  const resetDrag = (): void => {
    dragPointerId = null;
    dragOffset = 0;
    dragMode = "pending";
  };

  const showSheet = (): void => {
    backdrop.hidden = false;
    sheet.hidden = false;
    backdrop.setAttribute("aria-hidden", "false");
    sheet.setAttribute("aria-hidden", "false");
    clearSheetTransform();
    requestAnimationFrame(() => {
      backdrop.classList.add("ar-sheet-backdrop--visible");
      sheet.classList.add("ar-sheet--visible");
      sheet.classList.remove("ar-sheet--dragging");
    });
  };

  const hideSheet = (): void => {
    backdrop.classList.remove("ar-sheet-backdrop--visible");
    sheet.classList.remove("ar-sheet--visible", "ar-sheet--dragging");
    clearSheetTransform();
    backdrop.setAttribute("aria-hidden", "true");
    sheet.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
      if (!open) {
        backdrop.hidden = true;
        sheet.hidden = true;
      }
    }, 300);
  };

  const dismissInternal = (fromHistory: boolean): void => {
    if (!open) return;
    open = false;
    cardId = null;
    hideSheet();
    if (!fromHistory && historyPushed) {
      historyPushed = false;
      history.back();
    } else if (fromHistory) {
      historyPushed = false;
    }
    callbacks.onDismiss();
  };

  backdrop.addEventListener("click", () => dismissInternal(false));

  const onPointerDown = (event: PointerEvent): void => {
    if (!open) return;
    if (event.target instanceof Element && event.target.closest("a")) return;

    dragPointerId = event.pointerId;
    dragStartY = event.clientY;
    dragOffset = 0;
    dragMode = "pending";
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!open || dragPointerId !== event.pointerId) return;

    const dy = event.clientY - dragStartY;

    if (dragMode === "pending") {
      if (Math.abs(dy) < SHEET_DRAG_START_PX) return;
      if (dy > 0 && content.scrollTop <= 0) {
        dragMode = "sheet";
        sheet.classList.add("ar-sheet--dragging");
        sheet.setPointerCapture(event.pointerId);
      } else {
        dragMode = "scroll";
        resetDrag();
        return;
      }
    }

    if (dragMode === "sheet") {
      event.preventDefault();
      dragOffset = Math.max(0, dy);
      setSheetDragOffset(dragOffset);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (dragPointerId !== event.pointerId) return;

    if (dragMode === "sheet") {
      sheet.releasePointerCapture(event.pointerId);
      if (dragOffset >= SHEET_SWIPE_DISMISS_PX) {
        resetDrag();
        sheet.classList.remove("ar-sheet--dragging");
        dismissInternal(false);
        return;
      }
      sheet.classList.remove("ar-sheet--dragging");
      clearSheetTransform();
    }

    resetDrag();
  };

  sheet.addEventListener("pointerdown", onPointerDown);
  sheet.addEventListener("pointermove", onPointerMove, { passive: false });
  sheet.addEventListener("pointerup", onPointerUp);
  sheet.addEventListener("pointercancel", onPointerUp);

  return {
    show(card: InfoCard): void {
      if (open && cardId === card.id) return;
      cardId = card.id;
      open = true;
      content.innerHTML = buildCardContentHtml(card);
      if (!historyPushed) {
        history.pushState({ arSheet: true }, "");
        historyPushed = true;
      }
      callbacks.onOpen();
      showSheet();
    },
    dismiss(): void {
      dismissInternal(false);
    },
    dismissFromHistory(): void {
      dismissInternal(true);
    },
    isOpen(): boolean {
      return open;
    },
    getCardId(): string | null {
      return cardId;
    },
  };
}
