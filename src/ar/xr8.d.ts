/** Minimal typings for the 8th Wall engine binary (XR8). */

export interface Xr8SceneHandle {
  scene: import("three").Scene;
  camera: import("three").Camera;
  renderer: import("three").WebGLRenderer;
}

export interface Xr8ImageTargetPose {
  name: string;
  type: string | number;
  position: { x: number; y: number; z: number };
  rotation: { w: number; x: number; y: number; z: number };
  scale: number;
  scaledWidth?: number;
  scaledHeight?: number;
}

export interface Xr8PipelineListener {
  event: string;
  process: (args: { name?: string; detail: Xr8ImageTargetPose }) => void;
}

export interface Xr8PipelineModule {
  name: string;
  onAttach?: (args?: unknown) => void;
  onDetach?: () => void;
  onStart?: (args: {
    canvas: HTMLCanvasElement;
    canvasWidth: number;
    canvasHeight: number;
  }) => void;
  onUpdate?: (args?: {
    processCpuResult?: {
      reality?: {
        detectedImages?: Xr8ImageTargetPose[];
        cameraProjectionMatrix?: number[];
      };
    };
  }) => void;
  onRender?: () => void;
  onDeviceOrientationChange?: (args?: unknown) => void;
  onCanvasSizeChange?: (args?: unknown) => void;
  listeners?: Xr8PipelineListener[];
}

export interface Xr8ImageTargetData {
  imagePath: string;
  name: string;
  type: string;
  metadata?: Record<string, unknown>;
  properties: Record<string, unknown>;
}

export interface XR8Api {
  addCameraPipelineModules: (modules: Xr8PipelineModule[]) => void;
  run: (opts: {
    canvas: HTMLCanvasElement;
    allowedDevices?: unknown;
    webgl2?: boolean;
  }) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  loadChunk: (chunk: "slam" | "face") => Promise<void>;
  GlTextureRenderer: {
    pipelineModule: () => Xr8PipelineModule;
  };
  Threejs: {
    pipelineModule: () => Xr8PipelineModule;
    xrScene: () => Xr8SceneHandle;
  };
  XrController: {
    pipelineModule: () => Xr8PipelineModule;
    updateCameraProjectionMatrix: (opts: {
      origin: import("three").Vector3;
      facing: import("three").Quaternion;
    }) => void;
    recenter: () => void;
    configure: (opts: {
      disableWorldTracking?: boolean;
      enableLighting?: boolean;
      enableWorldPoints?: boolean;
      imageTargetData?: Xr8ImageTargetData[];
      scale?: "responsive" | "absolute";
      [key: string]: unknown;
    }) => void;
  };
  XrConfig: {
    device: () => {
      ANY: unknown;
      MOBILE: unknown;
      MOBILE_AND_HEADSETS: unknown;
    };
  };
}

declare global {
  interface Window {
    XR8?: XR8Api;
    THREE?: typeof import("three");
  }
}

export {};
