import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import jpeg from "jpeg-js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadJpeg(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  return jpeg.decode(buffer, { useTArray: true });
}

function sample(data, width, x, y) {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function matchAt(orig, crop, ox, oy, step) {
  let mism = 0;
  let total = 0;
  for (let y = 0; y < crop.height; y += step) {
    for (let x = 0; x < crop.width; x += step) {
      const oc = sample(crop.data, crop.width, x, y);
      const oo = sample(orig.data, orig.width, ox + x, oy + y);
      total++;
      if (Math.abs(oc[0] - oo[0]) + Math.abs(oc[1] - oo[1]) + Math.abs(oc[2] - oo[2]) > 30) {
        mism++;
      }
    }
  }
  return mism / total;
}

function searchRange(orig, crop, step, sampleStep, xMin, xMax, yMin, yMax) {
  let best = { x: xMin, y: yMin, score: 1 };
  for (let y = yMin; y <= yMax; y += step) {
    for (let x = xMin; x <= xMax; x += step) {
      const score = matchAt(orig, crop, x, y, sampleStep);
      if (score < best.score) best = { x, y, score };
    }
  }
  return best;
}

const orig = loadJpeg("public/map-reference.jpg");
const crop = loadJpeg("public/map-reference - cropped.jpg");

const maxX = orig.width - crop.width;
const maxY = orig.height - crop.height;

let best = searchRange(orig, crop, 32, 32, 0, maxX, 0, maxY);
best = searchRange(
  orig,
  crop,
  8,
  16,
  Math.max(0, best.x - 64),
  Math.min(maxX, best.x + 64),
  Math.max(0, best.y - 64),
  Math.min(maxY, best.y + 64)
);
best = searchRange(
  orig,
  crop,
  1,
  8,
  Math.max(0, best.x - 8),
  Math.min(maxX, best.x + 8),
  Math.max(0, best.y - 8),
  Math.min(maxY, best.y + 8)
);

console.log(
  JSON.stringify(
    {
      original: { width: orig.width, height: orig.height },
      cropped: { width: crop.width, height: crop.height },
      cropOffset: { x: best.x, y: best.y },
      matchErrorRate: best.score,
    },
    null,
    2
  )
);
