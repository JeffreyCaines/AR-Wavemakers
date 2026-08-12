import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import {
  buildCardContentHtml,
  buildCardDetailWithBackHtml,
  buildCardPreviewHtml,
  buildCardPreviewWithBackHtml,
  buildLocationEntryMenuHtml,
} from "../shared/cardContent";
import { mapXYToAnchorPosition } from "../shared/geo";
import type { LocationGroup } from "../shared/locationGroups";
import { groupCardsByLocation } from "../shared/locationGroups";
import type { CardType, InfoCard, RipplesAnchorPlacement } from "../shared/types";
import { playArSound } from "./sounds";

export const POINT_THRESHOLD = 0.12;
export const SHEET_OPEN_DELAY_MS = 2000;
export const RIPPLES_REVEAL_DELAY_MS = 1000;
/**
 * Ms offset for pin targeting unlock relative to “all pins visible”.
 * Positive = unlock later; negative = unlock earlier (by evaluating reveal ahead of time).
 */
export const pinUnlockTimingOffset = 500;
/** Ignore brief tracking loss after a phone rotate so revealed pins are not wiped. */
export const ORIENTATION_TRACKING_GRACE_MS = 2000;
const SHEET_SWIPE_DISMISS_PX = 72;
const SHEET_DRAG_START_PX = 8;

export const AR_CARD_TYPE_TOGGLE_HTML = `
  <div class="ar-type-toggle" role="tablist" aria-label="Card type">
    <button type="button" class="ar-type-toggle__btn" role="tab" aria-selected="false" data-ar-card-type="individual">
      Individuals
    </button>
    <button type="button" class="ar-type-toggle__btn ar-type-toggle__btn--active" role="tab" aria-selected="true" data-ar-card-type="organization">
      Organizations
    </button>
  </div>
`;

export function wireArCardTypeToggle(
  root: ParentNode,
  onChange: (type: CardType) => void
): void {
  const buttons = root.querySelectorAll<HTMLButtonElement>("[data-ar-card-type]");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.arCardType;
      if (type !== "individual" && type !== "organization") return;
      buttons.forEach((entry) => {
        const selected = entry.dataset.arCardType === type;
        entry.classList.toggle("ar-type-toggle__btn--active", selected);
        entry.setAttribute("aria-selected", String(selected));
      });
      onChange(type);
    });
  });
}

export function removeOverlaysFromParent(overlays: CardOverlay[], parent: THREE.Object3D): void {
  for (const overlay of overlays) {
    parent.remove(overlay.markerObject);
    parent.remove(overlay.panelObject);
  }
}

const measureCornerA = new THREE.Vector3();
const measureCornerB = new THREE.Vector3();
const measureCornerC = new THREE.Vector3();
const measureProjected = new THREE.Vector3();
const measureScreenA = new THREE.Vector2();
const measureScreenB = new THREE.Vector2();
const measureScreenC = new THREE.Vector2();

export interface CardOverlay {
  group: LocationGroup;
  /** First card in the group; used for reveal checks that key off coords. */
  card: InfoCard;
  selectedCardId: string | null;
  markerObject: CSS2DObject;
  panelObject: CSS2DObject;
  marker: HTMLDivElement;
  panel: HTMLDivElement;
}

export interface RipplesOverlay {
  object: CSS2DObject;
  host: HTMLDivElement;
  img: HTMLImageElement;
  imageUrl: string;
  /** Active object URL for the playing GIF; revoked on hide. */
  objectUrl: string | null;
}

export function createRipplesOverlay(
  placement: RipplesAnchorPlacement,
  aspectRatio: number,
  imageUrl: string
): RipplesOverlay {
  const pos = mapXYToAnchorPosition(placement.mapX, placement.mapY, aspectRatio);

  const host = document.createElement("div");
  host.className = "ar-ripples-host";

  const img = document.createElement("img");
  img.alt = "";
  img.className = "ar-ripples";
  img.draggable = false;
  applyRipplesOriginOffset(img, placement.originX, placement.originY);
  host.append(img);

  const object = new CSS2DObject(host);
  object.position.set(pos.x, pos.y, 0);
  object.renderOrder = -1;
  object.visible = false;

  return { object, host, img, imageUrl, objectUrl: null };
}

export function measureAnchorMapViewportSize(
  anchorGroup: THREE.Object3D,
  camera: THREE.Camera,
  aspectRatio: number,
  viewportWidth: number,
  viewportHeight: number
): { widthPx: number; heightPx: number } | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;

  const mapHeight = 1 / (aspectRatio > 0 ? aspectRatio : 1);
  measureCornerA.set(-0.5, mapHeight / 2, 0);
  measureCornerB.set(0.5, mapHeight / 2, 0);
  measureCornerC.set(-0.5, -mapHeight / 2, 0);

  const halfWidth = viewportWidth / 2;
  const halfHeight = viewportHeight / 2;

  measureProjected.copy(measureCornerA);
  anchorGroup.localToWorld(measureProjected);
  measureProjected.project(camera);
  if (measureProjected.z > 1) return null;
  measureScreenA.set(measureProjected.x * halfWidth, measureProjected.y * halfHeight);

  measureProjected.copy(measureCornerB);
  anchorGroup.localToWorld(measureProjected);
  measureProjected.project(camera);
  if (measureProjected.z > 1) return null;
  measureScreenB.set(measureProjected.x * halfWidth, measureProjected.y * halfHeight);

  measureProjected.copy(measureCornerC);
  anchorGroup.localToWorld(measureProjected);
  measureProjected.project(camera);
  if (measureProjected.z > 1) return null;
  measureScreenC.set(measureProjected.x * halfWidth, measureProjected.y * halfHeight);

  return {
    widthPx: measureScreenA.distanceTo(measureScreenB),
    heightPx: measureScreenA.distanceTo(measureScreenC),
  };
}

export function updateRipplesOverlayScale(
  overlay: RipplesOverlay,
  anchorGroup: THREE.Object3D,
  camera: THREE.Camera,
  aspectRatio: number,
  viewportWidth: number,
  viewportHeight: number,
  widthRatio: number
): void {
  const mapSize = measureAnchorMapViewportSize(
    anchorGroup,
    camera,
    aspectRatio,
    viewportWidth,
    viewportHeight
  );
  if (!mapSize) return;

  const widthPx = Math.max(1, Math.round(mapSize.widthPx * widthRatio));
  overlay.img.style.width = `${widthPx}px`;
}

function applyRipplesOriginOffset(img: HTMLImageElement, originX: number, originY: number): void {
  const offsetX = (0.5 - originX) * 100;
  const offsetY = (0.5 - originY) * 100;
  img.style.transform = `translate(${offsetX}%, ${offsetY}%)`;
}

function revokeRipplesObjectUrl(overlay: RipplesOverlay): void {
  if (overlay.objectUrl) {
    URL.revokeObjectURL(overlay.objectUrl);
    overlay.objectUrl = null;
  }
}

/**
 * Fetch GIF bytes without decoding into an <img>.
 * Avoids starting the browser GIF timeline before we are ready to show frame 0.
 */
export async function preloadRipplesBlob(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ripples gif (${response.status})`);
  }
  return response.blob();
}

/**
 * Start the ripples GIF from frame 0 via a fresh object URL.
 * `onReady` runs in the same turn the GIF becomes visible (first frame loaded).
 * Start the pin-reveal clock inside `onReady` only.
 */
export function startRipplesFromBlob(
  overlay: RipplesOverlay,
  blob: Blob,
  onReady: () => void
): void {
  const img = overlay.img;
  img.style.transition = "none";
  overlay.object.visible = false;
  overlay.host.classList.remove("ar-ripples-host--visible");
  img.removeAttribute("src");
  revokeRipplesObjectUrl(overlay);

  const objectUrl = URL.createObjectURL(blob);
  overlay.objectUrl = objectUrl;

  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    img.removeEventListener("load", finish);
    img.removeEventListener("error", finish);
    // Fresh object URL load ≈ frame 0. Show + clock in this turn — do not reassign src.
    overlay.object.visible = true;
    overlay.host.classList.add("ar-ripples-host--visible");
    onReady();
  };

  img.addEventListener("load", finish);
  img.addEventListener("error", finish);
  img.src = objectUrl;

  if (img.complete && img.naturalWidth > 0) {
    finish();
  }
}

export function hideRipplesOverlay(overlay: RipplesOverlay): void {
  overlay.object.visible = false;
  overlay.host.classList.remove("ar-ripples-host--visible");
  overlay.img.style.removeProperty("transition");
  overlay.img.removeAttribute("src");
  revokeRipplesObjectUrl(overlay);
}

export interface ActiveCardTracker {
  handleActiveOverlay: (overlay: CardOverlay | null) => void;
  resetSheetTimer: () => void;
}

export interface CardDetailSheet {
  show: (card: InfoCard) => void;
  showLocationGroup: (group: LocationGroup, selectedCardId?: string | null) => void;
  dismiss: () => void;
  dismissFromHistory: () => void;
  isOpen: () => boolean;
  getCardId: () => string | null;
  getGroupKey: () => string | null;
}

function renderOverlayPanel(overlay: CardOverlay): void {
  const { group, panel, selectedCardId } = overlay;
  if (group.cards.length === 1) {
    panel.innerHTML = buildCardPreviewHtml(group.cards[0]);
    return;
  }
  if (selectedCardId) {
    const detail = group.cards.find((entry) => entry.id === selectedCardId);
    if (detail) {
      panel.innerHTML = buildCardPreviewWithBackHtml(detail);
      return;
    }
  }
  panel.innerHTML = buildLocationEntryMenuHtml(group.cards);
}

export function createLocationOverlay(group: LocationGroup, aspectRatio: number): CardOverlay {
  const card = group.cards[0];
  const pos = mapXYToAnchorPosition(group.mapX, group.mapY, aspectRatio);

  const markerHost = document.createElement("div");
  markerHost.className = "ar-card-marker-host";

  const marker = document.createElement("div");
  marker.className = "ar-card__marker";
  markerHost.append(marker);

  const panelHost = document.createElement("div");
  panelHost.className = "ar-card-panel-host";

  const panel = document.createElement("div");
  panel.className = "ar-card__panel";
  panelHost.append(panel);

  const markerObject = new CSS2DObject(markerHost);
  markerObject.position.set(pos.x, pos.y, 0);
  markerObject.renderOrder = 0;

  const panelObject = new CSS2DObject(panelHost);
  panelObject.position.set(pos.x, pos.y, 0);
  panelObject.renderOrder = 1;

  const overlay: CardOverlay = {
    group,
    card,
    selectedCardId: null,
    markerObject,
    panelObject,
    marker,
    panel,
  };
  renderOverlayPanel(overlay);
  return overlay;
}

/** @deprecated Prefer createLocationOverlay; kept for single-card call sites. */
export function createCardOverlay(card: InfoCard, aspectRatio: number): CardOverlay {
  return createLocationOverlay(
    {
      key: `${card.mapX.toFixed(6)}|${card.mapY.toFixed(6)}`,
      mapX: card.mapX,
      mapY: card.mapY,
      cards: [card],
    },
    aspectRatio
  );
}

export function createOverlaysFromCards(cards: InfoCard[], aspectRatio: number): CardOverlay[] {
  return groupCardsByLocation(cards).map((group) => createLocationOverlay(group, aspectRatio));
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
  /** When set, only revealed pins can be targeted / shown. */
  isRevealed?: (card: InfoCard) => boolean;
}

function overlayIsRevealed(
  overlay: CardOverlay,
  isRevealed?: (card: InfoCard) => boolean
): boolean {
  if (!isRevealed) return true;
  return overlay.group.cards.some((card) => isRevealed(card));
}

/** Apply marker visibility from sheet state + optional ripple reveal gate. */
export function applyPinVisibility(
  overlays: CardOverlay[],
  sheetOpen: boolean,
  isRevealed?: (card: InfoCard) => boolean
): void {
  for (const overlay of overlays) {
    const revealed = overlayIsRevealed(overlay, isRevealed);
    const visible = !sheetOpen && revealed;
    overlay.markerObject.visible = visible;
    if (!visible) {
      overlay.marker.classList.remove("ar-card__marker--active", "ar-card__marker--revealed");
      overlay.panel.classList.remove("ar-card__panel--visible");
      continue;
    }
    if (!overlay.marker.classList.contains("ar-card__marker--revealed")) {
      overlay.marker.classList.add("ar-card__marker--revealed");
    }
  }
}

export function updatePointing(
  overlays: CardOverlay[],
  camera: THREE.Camera,
  sheetOpen: boolean,
  options?: PointingOptions
): CardOverlay | null {
  const center = new THREE.Vector2(0, 0);
  const projected = new THREE.Vector3();
  let closest: { key: string; distance: number } | null = null;
  const usePixelThreshold =
    options?.thresholdPx !== undefined &&
    options.viewportWidth !== undefined &&
    options.viewportHeight !== undefined &&
    options.viewportWidth > 0 &&
    options.viewportHeight > 0;
  const threshold = usePixelThreshold ? options!.thresholdPx! : POINT_THRESHOLD;
  const isRevealed = options?.isRevealed;

  for (const overlay of overlays) {
    if (!overlayIsRevealed(overlay, isRevealed)) continue;

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
      closest = { key: overlay.group.key, distance };
    }
  }

  const nextActive = closest?.key ?? null;

  applyPinVisibility(overlays, sheetOpen, isRevealed);

  for (const overlay of overlays) {
    const isActive = overlay.group.key === nextActive;
    const wasActive = overlay.marker.classList.contains("ar-card__marker--active");
    overlay.marker.classList.toggle("ar-card__marker--active", isActive && !sheetOpen);
    overlay.panel.classList.toggle("ar-card__panel--visible", isActive && !sheetOpen);
    if (!isActive && wasActive) {
      overlay.selectedCardId = null;
      renderOverlayPanel(overlay);
    }
  }

  return overlays.find((overlay) => overlay.group.key === nextActive) ?? null;
}

function wirePanelEntrySelection(
  overlay: CardOverlay,
  sheet: CardDetailSheet,
  onSelect: () => void
): void {
  overlay.panel.querySelectorAll("[data-card-id]").forEach((node) => {
    const button = node as HTMLButtonElement;
    const cardId = button.dataset.cardId;
    if (!cardId) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      overlay.selectedCardId = cardId;
      renderOverlayPanel(overlay);
      wirePanelEntrySelection(overlay, sheet, onSelect);
      const card = overlay.group.cards.find((entry) => entry.id === cardId);
      if (card) {
        sheet.showLocationGroup(overlay.group, cardId);
        onSelect();
      }
    });
  });

  overlay.panel.querySelectorAll('[data-action="back-to-entries"]').forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      overlay.selectedCardId = null;
      renderOverlayPanel(overlay);
      wirePanelEntrySelection(overlay, sheet, onSelect);
    });
  });
}

export function createActiveCardTracker(sheet: CardDetailSheet): ActiveCardTracker {
  let sheetTimer: ReturnType<typeof setTimeout> | null = null;
  let loseTargetTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingGroupKey: string | null = null;
  let activeOverlay: CardOverlay | null = null;

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

  const openSheetForOverlay = (overlay: CardOverlay): void => {
    if (overlay.selectedCardId) {
      sheet.showLocationGroup(overlay.group, overlay.selectedCardId);
      return;
    }
    if (overlay.group.cards.length > 1) {
      sheet.showLocationGroup(overlay.group, null);
      return;
    }
    sheet.show(overlay.group.cards[0]);
  };

  return {
    handleActiveOverlay(overlay: CardOverlay | null): void {
      if (sheet.isOpen()) {
        return;
      }

      if (!overlay) {
        if (pendingGroupKey && loseTargetTimer === null) {
          loseTargetTimer = setTimeout(() => {
            loseTargetTimer = null;
            clearSheetTimers();
            pendingGroupKey = null;
            activeOverlay = null;
          }, 500);
        }
        return;
      }

      if (loseTargetTimer !== null) {
        clearTimeout(loseTargetTimer);
        loseTargetTimer = null;
      }

      if (activeOverlay !== overlay) {
        activeOverlay = overlay;
        wirePanelEntrySelection(overlay, sheet, () => {
          clearSheetTimers();
          pendingGroupKey = null;
        });
      }

      if (pendingGroupKey !== overlay.group.key) {
        if (sheetTimer !== null) {
          clearTimeout(sheetTimer);
          sheetTimer = null;
        }
        pendingGroupKey = overlay.group.key;
        sheetTimer = setTimeout(() => {
          sheetTimer = null;
          if (pendingGroupKey === overlay.group.key && !sheet.isOpen()) {
            openSheetForOverlay(overlay);
          }
        }, SHEET_OPEN_DELAY_MS);
      }
    },
    resetSheetTimer(): void {
      clearSheetTimers();
      pendingGroupKey = null;
      activeOverlay = null;
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
  let groupKey: string | null = null;
  let activeGroup: LocationGroup | null = null;
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
    groupKey = null;
    activeGroup = null;
    playArSound("back");
    hideSheet();
    if (!fromHistory && historyPushed) {
      historyPushed = false;
      history.back();
    } else if (fromHistory) {
      historyPushed = false;
    }
    callbacks.onDismiss();
  };

  const renderGroupMenu = (group: LocationGroup): void => {
    content.innerHTML = buildLocationEntryMenuHtml(group.cards);
    content.querySelectorAll("[data-card-id]").forEach((node) => {
      const button = node as HTMLButtonElement;
      const id = button.dataset.cardId;
      if (!id) return;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const card = group.cards.find((entry) => entry.id === id);
        if (!card) return;
        playArSound("pin");
        cardId = card.id;
        content.innerHTML = buildCardDetailWithBackHtml(card);
        content.querySelector('[data-action="back-to-entries"]')?.addEventListener("click", (backEvent) => {
          backEvent.preventDefault();
          cardId = null;
          renderGroupMenu(group);
        });
      });
    });
  };

  const renderGroupDetail = (group: LocationGroup, selectedId: string): void => {
    const card = group.cards.find((entry) => entry.id === selectedId);
    if (!card) {
      renderGroupMenu(group);
      return;
    }
    cardId = card.id;
    content.innerHTML = buildCardDetailWithBackHtml(card);
    content.querySelector('[data-action="back-to-entries"]')?.addEventListener("click", (event) => {
      event.preventDefault();
      cardId = null;
      renderGroupMenu(group);
    });
  };

  const ensureHistory = (): void => {
    if (!historyPushed) {
      history.pushState({ arSheet: true }, "");
      historyPushed = true;
    }
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
      if (open && cardId === card.id && !activeGroup) return;
      cardId = card.id;
      groupKey = null;
      activeGroup = null;
      open = true;
      content.innerHTML = buildCardContentHtml(card);
      ensureHistory();
      playArSound("pin");
      callbacks.onOpen();
      showSheet();
    },
    showLocationGroup(group: LocationGroup, selectedCardId: string | null = null): void {
      const sameGroup = open && groupKey === group.key;
      groupKey = group.key;
      activeGroup = group;
      open = true;
      if (selectedCardId) {
        renderGroupDetail(group, selectedCardId);
      } else if (group.cards.length === 1) {
        cardId = group.cards[0].id;
        content.innerHTML = buildCardContentHtml(group.cards[0]);
      } else {
        cardId = null;
        renderGroupMenu(group);
      }
      if (!sameGroup) {
        ensureHistory();
        playArSound("pin");
        callbacks.onOpen();
        showSheet();
      }
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
    getGroupKey(): string | null {
      return groupKey;
    },
  };
}
