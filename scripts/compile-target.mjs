import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const imagePath = path.join(root, "public", "map-reference.jpg");
const outputPath = path.join(root, "public", "map-target.mind");
const pagePath = path.join(__dirname, "compile-page.html");

async function main() {
  try {
    await fs.access(imagePath);
  } catch {
    console.error(
      "Missing public/map-reference.jpg.\n" +
        "Add a flat, straight-on photo (>=1500px wide) of the wall map first.\n" +
        "See public/README.md for capture instructions."
    );
    process.exit(1);
  }

  console.log("Compiling MindAR target from public/map-reference.jpg…");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    page.on("console", (msg) => console.log(`[compiler] ${msg.text()}`));
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "networkidle0" });

    // Pass the image as a data: URL. A file:// page (origin "null") cannot load a
    // file:// image without tripping CORS, and a tainted canvas can't be read.
    const mime = MIME_BY_EXT[path.extname(imagePath).toLowerCase()] ?? "image/jpeg";
    const imageBuffer = await fs.readFile(imagePath);
    const dataUrl = `data:${mime};base64,${imageBuffer.toString("base64")}`;

    const bytes = await page.evaluate(async (url) => {
      // @ts-expect-error runCompile is injected by compile-page.html
      return window.runCompile(url);
    }, dataUrl);

    await fs.writeFile(outputPath, Buffer.from(bytes));
    console.log(`Wrote ${outputPath} (${bytes.length} bytes).`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
