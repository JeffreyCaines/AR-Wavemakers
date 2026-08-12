/**
 * Copy @8thwall/engine-binary dist → public/external/xr
 * so Vite / Netlify Dev serve XR assets as static files (not SPA HTML).
 *
 * public/external/ is gitignored; run via postinstall / predev / prebuild.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "@8thwall", "engine-binary", "dist");
const dest = path.join(root, "public", "external", "xr");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

if (!fs.existsSync(src)) {
  console.warn(`[sync-xr-assets] missing ${src}; skip`);
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);
console.log(`[sync-xr-assets] copied → ${path.relative(root, dest)}`);
