declare module "mind-ar/dist/mindar-image-three.prod.js" {
  import type * as THREE from "three";

  export interface MindARAnchor {
    group: THREE.Group;
    onTargetFound?: () => void;
    onTargetLost?: () => void;
  }

  export class MindARThree {
    constructor(options: {
      container: HTMLElement;
      imageTargetSrc: string;
      uiLoading?: string | boolean;
      uiScanning?: string | boolean;
      uiError?: string | boolean;
      filterMinCF?: number;
      filterBeta?: number;
      missTolerance?: number;
      warmupTolerance?: number;
    });
    addAnchor(index: number): MindARAnchor;
    start(): Promise<void>;
    stop(): void;
    resize(): void;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
  }
}
