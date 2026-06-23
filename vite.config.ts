import { defineConfig } from "vite";

export default defineConfig({
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
  },
  build: {
    // The AR route legitimately ships MindAR (TensorFlow.js + Three.js), which is
    // large and cannot be meaningfully split further. Route-level dynamic imports
    // (see src/main.ts) already keep /admin light, so raise the warning threshold.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: {
        main: "index.html",
        // shareStory: "share-story.html",
      },
    },
  },
});
