import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(__dirname, "..", "public", "map-target.mind");

try {
  await fs.access(outputPath);
  console.log("public/map-target.mind found.");
} catch {
  console.warn(
    "Warning: public/map-target.mind is missing. Run `npm run compile-target` before testing AR."
  );
}
