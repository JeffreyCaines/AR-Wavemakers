import * as THREE from "three";
import { mapXYOriginalToAdmin } from "../shared/geo";
import type { RipplesVariant } from "../shared/types";
import type { Layer7Edge, Layer7RippleMasks } from "./modelRippleMasks";
import type { RipplesMapPreview } from "./ripplesMapPreview";
import {
  DEFAULT_MODEL_RIPPLES_VISUALS,
  modelRipplesLoopDurationSec,
  type ModelRipplesVisuals,
} from "./modelRipplesVisuals";

const MAX_RIPPLES = 8;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Same ring math as the wall-map photo shader, with live visual uniforms. Masked by water layers minus land. */
const fragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uMask;
uniform float uTime;
uniform vec2 uOrigin;
uniform vec2 uTexSize;
uniform float uFadeOutAt;
uniform float uLineWidthPx;
uniform vec3 uColor;
uniform float uMaxRadius;
uniform float uExpansionSec;
uniform float uSpawnDelaySec;
uniform float uRippleNum;
uniform float uSoftness;
uniform float uOpacity;

varying vec2 vUv;

float rippleRadius(float index, float t) {
  float spawnTime = index * uSpawnDelaySec;
  if (t < spawnTime) return 0.0;
  float age = t - spawnTime;
  float progress = min(age / max(uExpansionSec, 0.001), 1.0);
  return progress * uMaxRadius;
}

float rippleAlpha(float index, float t) {
  float spawnTime = index * uSpawnDelaySec;
  if (t < spawnTime) return 0.0;
  float age = t - spawnTime;
  float progress = min(age / max(uExpansionSec, 0.001), 1.0);
  float fadeAt = max(uFadeOutAt, 0.001);
  if (progress >= fadeAt) return 0.0;
  return 1.0 - (progress / fadeAt);
}

float maxRadiusPx() {
  vec2 o = uOrigin * uTexSize;
  float d0 = length(o - vec2(0.0, 0.0));
  float d1 = length(o - vec2(uTexSize.x, 0.0));
  float d2 = length(o - vec2(0.0, uTexSize.y));
  float d3 = length(o - vec2(uTexSize.x, uTexSize.y));
  return max(max(d0, d1), max(d2, d3));
}

void main() {
  vec2 mapUv = vec2(vUv.x, 1.0 - vUv.y);
  float mask = texture2D(uMask, mapUv).r;
  if (mask < 0.5) discard;

  vec2 pixel = mapUv * uTexSize;
  vec2 originPx = uOrigin * uTexSize;
  float dist = length(pixel - originPx);
  float maxR = maxRadiusPx();
  float halfW = uLineWidthPx * 0.5;
  float aa = max(uSoftness, 0.01);

  float alpha = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    float idx = float(i);
    if (idx >= uRippleNum) continue;
    float radiusNorm = rippleRadius(idx, uTime);
    float a = rippleAlpha(idx, uTime);
    if (a <= 0.0 || radiusNorm <= 0.0) continue;
    float rPx = radiusNorm * maxR;
    float ring = smoothstep(halfW + aa, halfW - aa, abs(dist - rPx));
    alpha = max(alpha, ring * a);
  }

  alpha *= uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

function originToAdmin(mapX: number, mapY: number): THREE.Vector2 {
  const admin = mapXYOriginalToAdmin(mapX, mapY);
  return new THREE.Vector2(admin.mapX, admin.mapY);
}

/**
 * /admin ripples overlay. Uses water-layer + land masks, not wall-photo masks.
 */
export async function createModelRipplesMapPreview(
  host: HTMLElement,
  options: {
    originMapX: number;
    originMapY: number;
    masks: Layer7RippleMasks;
    edge?: Layer7Edge;
    visuals?: ModelRipplesVisuals;
  }
): Promise<RipplesMapPreview> {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const canvas = renderer.domElement;
  canvas.className = "map-editor__ripples-canvas";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);

  const mountW = Math.max(1, Math.round(host.clientWidth || 4));
  const mountH = Math.max(1, Math.round(host.clientHeight || 4));
  renderer.setSize(mountW, mountH, false);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  camera.position.z = 1;

  let edge: Layer7Edge = options.edge ?? "outer";
  let visuals: ModelRipplesVisuals = { ...DEFAULT_MODEL_RIPPLES_VISUALS, ...options.visuals };
  const texSize = new THREE.Vector2(options.masks.width, options.masks.height);
  const uniforms = {
    uMask: { value: edge === "inner" ? options.masks.inner : options.masks.outer },
    uTime: { value: 0 },
    uOrigin: { value: originToAdmin(options.originMapX, options.originMapY) },
    uTexSize: { value: texSize.clone() },
    uFadeOutAt: { value: visuals.fadeOutAt },
    uLineWidthPx: { value: visuals.lineWidthPx },
    uColor: { value: new THREE.Color(visuals.color) },
    uMaxRadius: { value: visuals.maxRadius },
    uExpansionSec: { value: visuals.expansionSec },
    uSpawnDelaySec: { value: visuals.spawnDelaySec },
    uRippleNum: { value: visuals.ringCount },
    uSoftness: { value: visuals.softness },
    uOpacity: { value: visuals.opacity },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const applyVisuals = (next: ModelRipplesVisuals): void => {
    visuals = { ...DEFAULT_MODEL_RIPPLES_VISUALS, ...next };
    uniforms.uFadeOutAt.value = visuals.fadeOutAt;
    uniforms.uLineWidthPx.value = visuals.lineWidthPx;
    uniforms.uColor.value.set(visuals.color);
    uniforms.uMaxRadius.value = visuals.maxRadius;
    uniforms.uExpansionSec.value = visuals.expansionSec;
    uniforms.uSpawnDelaySec.value = visuals.spawnDelaySec;
    uniforms.uRippleNum.value = visuals.ringCount;
    uniforms.uSoftness.value = visuals.softness;
    uniforms.uOpacity.value = visuals.opacity;
  };

  let disposed = false;
  let enabled = true;
  let rafId = 0;
  let startedAt = performance.now();

  const renderFrame = (): void => {
    if (disposed || !enabled) return;
    const elapsed = ((performance.now() - startedAt) / 1000) * visuals.speed;
    const duration = modelRipplesLoopDurationSec(visuals);
    uniforms.uTime.value = duration > 0 ? elapsed % duration : 0;
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(renderFrame);
  };
  rafId = requestAnimationFrame(renderFrame);

  return {
    canvas,
    setOrigin(mapX: number, mapY: number) {
      uniforms.uOrigin.value.copy(originToAdmin(mapX, mapY));
    },
    setVariant(_variant: RipplesVariant) {
      uniforms.uFadeOutAt.value = visuals.fadeOutAt;
    },
    setLayer7Edge(next: Layer7Edge) {
      edge = next;
      uniforms.uMask.value = edge === "inner" ? options.masks.inner : options.masks.outer;
    },
    setVisuals(next: ModelRipplesVisuals) {
      applyVisuals(next);
    },
    setEnabled(next: boolean) {
      enabled = next;
      canvas.style.display = next ? "" : "none";
      canvas.style.pointerEvents = next ? "auto" : "none";
      if (!next) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        return;
      }
      if (!rafId && !disposed) rafId = requestAnimationFrame(renderFrame);
    },
    setSize(width: number, height: number) {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
