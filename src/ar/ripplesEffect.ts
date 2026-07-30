import * as THREE from "three";
import type { RipplesVariant } from "../shared/types";
import {
  getRipplesFadeOutAt,
  getRipplesMaskPath,
  getRipplesOriginMapXY,
  getRipplesSimDurationSec,
  RIPPLE_COLOR,
  RIPPLE_EXPANSION_DURATION_SEC,
  RIPPLE_MAX_RADIUS,
  RIPPLE_NUM,
  RIPPLE_SPAWN_DELAY_SEC,
  rippleLineWidthPx,
} from "../shared/ripplesSim";

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Procedural ripples matching Documents/Image Masking/ripples.py:
 * N expanding ellipses (circular in pixel space), masked by water mask.
 */
const fragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uMask;
uniform float uTime;
uniform vec2 uOrigin;
uniform vec2 uTexSize;
uniform float uFadeOutAt;
uniform float uLineWidthPx;
uniform vec3 uColor;

varying vec2 vUv;

float rippleRadius(float index, float t) {
  float spawnTime = index * ${RIPPLE_SPAWN_DELAY_SEC.toFixed(4)};
  if (t < spawnTime) return 0.0;
  float age = t - spawnTime;
  float progress = min(age / ${RIPPLE_EXPANSION_DURATION_SEC.toFixed(4)}, 1.0);
  return progress * ${RIPPLE_MAX_RADIUS.toFixed(4)};
}

float rippleAlpha(float index, float t) {
  float spawnTime = index * ${RIPPLE_SPAWN_DELAY_SEC.toFixed(4)};
  if (t < spawnTime) return 0.0;
  float age = t - spawnTime;
  float progress = min(age / ${RIPPLE_EXPANSION_DURATION_SEC.toFixed(4)}, 1.0);
  if (progress >= uFadeOutAt) return 0.0;
  return 1.0 - (progress / uFadeOutAt);
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
  // Geometry v=0 is bottom; mapY=0 is top of the reference image.
  vec2 mapUv = vec2(vUv.x, 1.0 - vUv.y);
  float mask = texture2D(uMask, vec2(mapUv.x, 1.0 - mapUv.y)).r;
  if (mask < 0.5) {
    discard;
  }

  vec2 pixel = mapUv * uTexSize;
  vec2 originPx = uOrigin * uTexSize;
  float dist = length(pixel - originPx);
  float maxR = maxRadiusPx();
  float halfW = uLineWidthPx * 0.5;
  float aa = 1.25;

  float alpha = 0.0;
  for (int i = 0; i < ${RIPPLE_NUM}; i++) {
    float idx = float(i);
    float radiusNorm = rippleRadius(idx, uTime);
    float a = rippleAlpha(idx, uTime);
    if (a <= 0.0 || radiusNorm <= 0.0) continue;

    float rPx = radiusNorm * maxR;
    float ring = smoothstep(halfW + aa, halfW - aa, abs(dist - rPx));
    alpha = max(alpha, ring * a);
  }

  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

export interface RipplesEffect {
  mesh: THREE.Mesh;
  setOrigin: (mapX: number, mapY: number) => void;
  setVariant: (variant: RipplesVariant) => void;
  /** When true, uTime wraps at the sim duration (admin preview). */
  setLooping: (enabled: boolean) => void;
  start: () => void;
  stop: () => void;
  /** Call each frame while playing (or always); advances uTime from start. */
  update: () => void;
  getElapsedSec: () => number | null;
  isPlaying: () => boolean;
  isReady: () => boolean;
  dispose: () => void;
}

function loadMaskTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.NoColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      reject
    );
  });
}

/**
 * Full-map transparent plane that draws procedural ripples, masked by water masks.
 * Add `mesh` as a child of the MindAR / sim map anchor group.
 */
export async function createRipplesEffect(
  aspectRatio: number,
  variant: RipplesVariant,
  originMapX?: number,
  originMapY?: number
): Promise<RipplesEffect> {
  const [loopMask, fadeMask] = await Promise.all([
    loadMaskTexture(getRipplesMaskPath("loop")),
    loadMaskTexture(getRipplesMaskPath("fade")),
  ]);

  const defaultOrigin = getRipplesOriginMapXY();
  const originX = originMapX ?? defaultOrigin.mapX;
  const originY = originMapY ?? defaultOrigin.mapY;

  const texSize = new THREE.Vector2(
    loopMask.image?.width ?? 4032,
    loopMask.image?.height ?? 3024
  );

  const uniforms = {
    uMask: { value: variant === "fade" ? fadeMask : loopMask },
    uTime: { value: 0 },
    uOrigin: { value: new THREE.Vector2(originX, originY) },
    uTexSize: { value: texSize.clone() },
    uFadeOutAt: { value: getRipplesFadeOutAt(variant) },
    uLineWidthPx: { value: rippleLineWidthPx(texSize.x) },
    uColor: { value: new THREE.Color(RIPPLE_COLOR.r, RIPPLE_COLOR.g, RIPPLE_COLOR.b) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
  });

  const mapHeight = 1 / (aspectRatio > 0 ? aspectRatio : 1);
  const geometry = new THREE.PlaneGeometry(1, mapHeight);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 0.002;
  mesh.renderOrder = -1;
  mesh.visible = false;
  mesh.frustumCulled = false;

  let playing = false;
  let looping = false;
  let startedAt: number | null = null;
  let ready = true;

  const applyVariant = (next: RipplesVariant): void => {
    uniforms.uMask.value = next === "fade" ? fadeMask : loopMask;
    uniforms.uFadeOutAt.value = getRipplesFadeOutAt(next);
    const img = uniforms.uMask.value.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) {
      texSize.set(img.width, img.height);
      uniforms.uTexSize.value.copy(texSize);
      uniforms.uLineWidthPx.value = rippleLineWidthPx(texSize.x);
    }
  };

  return {
    mesh,
    setOrigin(mapX: number, mapY: number) {
      uniforms.uOrigin.value.set(mapX, mapY);
    },
    setVariant(next: RipplesVariant) {
      applyVariant(next);
    },
    setLooping(enabled: boolean) {
      looping = enabled;
    },
    start() {
      playing = true;
      startedAt = performance.now();
      uniforms.uTime.value = 0;
      mesh.visible = true;
    },
    stop() {
      playing = false;
      startedAt = null;
      uniforms.uTime.value = 0;
      mesh.visible = false;
    },
    update() {
      if (!playing || startedAt == null) return;
      const elapsed = (performance.now() - startedAt) / 1000;
      if (looping) {
        const duration = getRipplesSimDurationSec();
        uniforms.uTime.value = duration > 0 ? elapsed % duration : 0;
        return;
      }
      uniforms.uTime.value = elapsed;
    },
    getElapsedSec() {
      if (!playing || startedAt == null) return null;
      return (performance.now() - startedAt) / 1000;
    },
    isPlaying() {
      return playing;
    },
    isReady() {
      return ready;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      loopMask.dispose();
      fadeMask.dispose();
    },
  };
}
