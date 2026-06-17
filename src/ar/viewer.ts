import "./styles.css";
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { MindARThree } from "mind-ar/dist/mindar-image-three.prod.js";
import { fetchActiveCards } from "../shared/api";
import { loadMapAspectRatio, mapXYToAnchorPosition } from "../shared/geo";
import { DEFAULT_MAP_ASPECT_RATIO, MAP_REFERENCE_PATH, MAP_TARGET_PATH } from "../shared/types";
import type { InfoCard } from "../shared/types";

// How close (in normalized device coordinates) the screen-center crosshair must
// be to a card anchor for that card to expand. ~8% of the map width.
const POINT_THRESHOLD = 0.12;

interface CardOverlay {
  card: InfoCard;
  object: CSS2DObject;
  marker: HTMLDivElement;
  panel: HTMLDivElement;
}

export function initArViewer(root: HTMLElement): void {
  root.innerHTML = `
    <div class="ar-app">
      <div id="ar-container" class="ar-container"></div>
      <div class="ar-ui">
        <header class="ar-header">
          <h1>NL World Map AR</h1>
          <p class="ar-subtitle">Point your phone at the wall map</p>
        </header>
        <div id="ar-status" class="ar-status">Loading cards…</div>
        <button id="ar-start" class="ar-btn" disabled>Start AR</button>
        <div class="ar-crosshair" aria-hidden="true"></div>
        <div id="ar-hint" class="ar-hint">Aim the crosshair at a location on the map to reveal impact stories.</div>
      </div>
    </div>
  `;

  const container = root.querySelector("#ar-container") as HTMLElement;
  const startBtn = root.querySelector("#ar-start") as HTMLButtonElement;
  const statusEl = root.querySelector("#ar-status") as HTMLElement;

  let mindarThree: InstanceType<typeof MindARThree> | null = null;
  let cssRenderer: CSS2DRenderer | null = null;
  let overlays: CardOverlay[] = [];
  let aspectRatio = DEFAULT_MAP_ASPECT_RATIO;
  let tracking = false;

  void bootstrap();

  async function bootstrap(): Promise<void> {
    try {
      aspectRatio = await loadMapAspectRatio(MAP_REFERENCE_PATH, DEFAULT_MAP_ASPECT_RATIO);

      const mindResponse = await fetch(MAP_TARGET_PATH, { method: "HEAD" });
      if (!mindResponse.ok) {
        statusEl.textContent = "Missing map-target.mind. Run `npm run compile-target` first.";
        return;
      }

      await fetchActiveCards();
      statusEl.textContent = "Ready. Tap Start AR and point at the map.";
      startBtn.disabled = false;
    } catch {
      statusEl.textContent = "Could not load cards. Check your connection.";
    }

    startBtn.addEventListener("click", () => {
      void startAr();
    });
  }

  async function startAr(): Promise<void> {
    if (mindarThree) return;

    startBtn.disabled = true;
    statusEl.textContent = "Starting camera…";

    let cards: InfoCard[];
    try {
      cards = await fetchActiveCards();
    } catch {
      statusEl.textContent = "Could not load cards. Check your connection.";
      startBtn.disabled = false;
      return;
    }

    mindarThree = new MindARThree({
      container,
      imageTargetSrc: MAP_TARGET_PATH,
      uiScanning: false,
      uiLoading: false,
    });

    const { renderer, scene, camera } = mindarThree;
    const anchor = mindarThree.addAnchor(0);
    anchor.onTargetFound = () => {
      tracking = true;
    };
    anchor.onTargetLost = () => {
      tracking = false;
    };

    cssRenderer = new CSS2DRenderer();
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
    cssRenderer.domElement.className = "ar-css-renderer";
    container.appendChild(cssRenderer.domElement);

    overlays = cards.map((card) => createCardOverlay(card, aspectRatio));
    overlays.forEach(({ object }) => anchor.group.add(object));

    const resize = (): void => {
      cssRenderer?.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", resize);

    try {
      await mindarThree.start();
      root.querySelector(".ar-header")?.classList.add("ar-header--compact");
    } catch {
      statusEl.textContent = "Camera access denied or not supported.";
      startBtn.disabled = false;
      return;
    }

    renderer.setAnimationLoop(() => {
      updateTrackingUI(statusEl, tracking);
      updatePointing(overlays, camera);
      cssRenderer?.render(scene, camera);
      renderer.render(scene, camera);
    });
  }
}

function createCardOverlay(card: InfoCard, aspectRatio: number): CardOverlay {
  const pos = mapXYToAnchorPosition(card.mapX, card.mapY, aspectRatio);

  const wrapper = document.createElement("div");
  wrapper.className = "ar-card";

  const marker = document.createElement("div");
  marker.className = "ar-card__marker";

  const panel = document.createElement("div");
  panel.className = "ar-card__panel";
  panel.innerHTML = `
    <strong>${escapeHtml(card.title)}</strong>
    ${card.companyName ? `<span class="ar-card__company">${escapeHtml(card.companyName)}</span>` : ""}
    ${card.imageUrl ? `<img class="ar-card__image" src="${escapeAttr(card.imageUrl)}" alt="" />` : ""}
    <p>${escapeHtml(card.body)}</p>
    ${card.linkUrl ? `<a href="${escapeAttr(card.linkUrl)}" target="_blank" rel="noopener noreferrer">Learn more</a>` : ""}
  `;

  wrapper.append(marker, panel);

  const object = new CSS2DObject(wrapper);
  object.position.set(pos.x, pos.y, 0);

  return { card, object, marker, panel };
}

function updateTrackingUI(statusEl: HTMLElement, tracking: boolean): void {
  if (tracking) {
    statusEl.textContent = "Map detected. Aim at a location.";
    statusEl.classList.add("ar-status--tracking");
  } else {
    statusEl.textContent = "Point your camera at the map on the wall.";
    statusEl.classList.remove("ar-status--tracking");
  }
}

/** Project each card to screen space and expand the one nearest the crosshair. */
function updatePointing(overlays: CardOverlay[], camera: THREE.Camera): void {
  const center = new THREE.Vector2(0, 0);
  const projected = new THREE.Vector3();
  let closest: { id: string; distance: number } | null = null;

  for (const overlay of overlays) {
    overlay.object.getWorldPosition(projected);
    projected.project(camera);

    // Skip anchors behind the camera.
    if (projected.z > 1) continue;

    const distance = center.distanceTo(new THREE.Vector2(projected.x, projected.y));
    if (distance < POINT_THRESHOLD && (!closest || distance < closest.distance)) {
      closest = { id: overlay.card.id, distance };
    }
  }

  const nextActive = closest?.id ?? null;

  for (const overlay of overlays) {
    const isActive = overlay.card.id === nextActive;
    overlay.marker.classList.toggle("ar-card__marker--active", isActive);
    overlay.panel.classList.toggle("ar-card__panel--visible", isActive);
  }
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
