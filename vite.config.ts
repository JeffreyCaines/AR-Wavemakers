import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const XR_SRC = path.resolve(rootDir, "node_modules/@8thwall/engine-binary/dist");
const XR_URL_PREFIX = "/external/xr";

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * Dev fallback: serve /external/xr from node_modules if public/ copy is missing.
 * Prefer `npm run sync-xr` / predev so Netlify Dev static hosting also works.
 */
function eighthWallEngineAssets(): Plugin {
  return {
    name: "eighth-wall-engine-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith(`${XR_URL_PREFIX}/`)) {
          next();
          return;
        }
        const rel = decodeURIComponent(url.slice(XR_URL_PREFIX.length + 1));
        if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
          res.statusCode = 400;
          res.end("Bad request");
          return;
        }
        const filePath = path.resolve(XR_SRC, rel);
        const rootWithSep = XR_SRC.endsWith(path.sep) ? XR_SRC : XR_SRC + path.sep;
        if (filePath !== XR_SRC && !filePath.startsWith(rootWithSep)) {
          res.statusCode = 400;
          res.end("Bad request");
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          // Let Vite try public/external/xr or SPA — do not hard-404 here.
          next();
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const types: Record<string, string> = {
          ".js": "application/javascript",
          ".svg": "image/svg+xml",
          ".glb": "model/gltf-binary",
          ".tflite": "application/octet-stream",
        };
        res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=3600");
        fs.createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(XR_SRC)) {
        console.warn(
          "[eighth-wall-engine-assets] @8thwall/engine-binary dist missing; skip copy."
        );
        return;
      }
      const dest = path.join(rootDir, "dist/external/xr");
      copyDirSync(XR_SRC, dest);
    },
  };
}

export default defineConfig({
  plugins: [eighthWallEngineAssets()],
  optimizeDeps: {
    // mind-ar ships prebuilt bundles; let Vite serve them as-is.
    exclude: ["mind-ar"],
  },
  server: {
    proxy: {
      // During `vite dev`, forward API calls to `netlify dev` (port 8888).
      "/api": {
        target: "http://localhost:8888",
        changeOrigin: true,
      },
    },
    allowedHosts: [
      "skid-hypocrite-uphold.ngrok-free.dev",
    ],
  },
  build: {
    // The AR route legitimately ships MindAR (TensorFlow.js + Three.js), which is
    // large and cannot be meaningfully split further. Route-level dynamic imports
    // (see src/main.ts) already keep /admin light, so raise the warning threshold.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: {
        main: "index.html",
        shareStory: "share-story.html",
      },
    },
  },
});
