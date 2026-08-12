import type { XR8Api } from "./xr8";

const XR_SCRIPT_SRC = "/external/xr/xr.js";

/**
 * Load the 8th Wall engine binary (with SLAM chunk) once per page.
 * Expects artifacts at /external/xr (Vite serves from node_modules in dev;
 * build copies them into dist).
 */
export function loadXr8Engine(): Promise<XR8Api> {
  if (window.XR8) {
    return Promise.resolve(window.XR8);
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const succeed = (api: XR8Api) => {
      if (settled) return;
      settled = true;
      resolve(api);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const onLoaded = () => {
      if (!window.XR8) {
        fail(new Error("XR8 loaded event fired but window.XR8 is missing."));
        return;
      }
      succeed(window.XR8);
    };

    window.addEventListener("xrloaded", onLoaded, { once: true });

    // Script may already be injecting; poll in case xrloaded fired before we listened.
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-eighth-wall-engine="true"]'
    );
    if (existing) {
      const poll = window.setInterval(() => {
        if (window.XR8) {
          window.clearInterval(poll);
          window.removeEventListener("xrloaded", onLoaded);
          succeed(window.XR8);
        }
      }, 50);
      window.setTimeout(() => {
        window.clearInterval(poll);
        if (!window.XR8) {
          window.removeEventListener("xrloaded", onLoaded);
          fail(new Error("Timed out waiting for 8th Wall engine."));
        }
      }, 30000);
      return;
    }

    const script = document.createElement("script");
    script.src = XR_SCRIPT_SRC;
    script.async = true;
    // Same-origin; avoid crossOrigin so Vite/static hosts without CORS headers still run.
    script.dataset.eighthWallEngine = "true";
    script.dataset.preloadChunks = "slam";
    script.onerror = () => {
      window.removeEventListener("xrloaded", onLoaded);
      fail(new Error("Failed to load 8th Wall engine from /external/xr/xr.js."));
    };
    document.head.appendChild(script);
  });
}
