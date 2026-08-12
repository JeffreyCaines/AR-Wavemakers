import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { latLngToLandLocal, type LatLongDistortionMap } from "./loadArMapModel";

/** Land AABB from TechNL_map_Textured.gltf `techNL_map_land`. */
const LAND_BOX = new THREE.Box3(
  new THREE.Vector3(-0.7078657, -0.421892762, 0.0285749044),
  new THREE.Vector3(0.6843769, 0.2882257, 0.03175014)
);

/** NFLD island local XY from the same glTF. */
const NFLD = {
  minX: -0.332621336,
  maxX: -0.2666631,
  minY: -0.0117949294,
  maxY: 0.0854697,
};

/** Solid RG matching the real JPEG sample at St. John's mercator UV. */
function stJohnsSampleDistortion(): LatLongDistortionMap {
  const width = 8;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 182;
    data[i * 4 + 1] = 176;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe("latLngToLandLocal", () => {
  it("places St. John's on the Newfoundland plate with production distortion math", () => {
    const pos = latLngToLandLocal(47.5615, -52.7126, LAND_BOX, stJohnsSampleDistortion());

    expect(pos.x).toBeGreaterThan(NFLD.minX - 0.02);
    expect(pos.x).toBeLessThan(NFLD.maxX + 0.02);
    expect(pos.y).toBeGreaterThan(NFLD.minY - 0.05);
    expect(pos.y).toBeLessThan(NFLD.maxY + 0.05);
  });

  it("moves Rome east of the Atlantic relative to St. John's", () => {
    const posSj = latLngToLandLocal(47.5615, -52.7126, LAND_BOX, null);
    const posRome = latLngToLandLocal(41.9028, 12.4964, LAND_BOX, null);
    expect(posRome.x).toBeGreaterThan(posSj.x);
  });

  it("moves Reykjavik north of Rome on the land Y axis", () => {
    const posRome = latLngToLandLocal(41.9028, 12.4964, LAND_BOX, null);
    const posReyk = latLngToLandLocal(64.1466, -21.9426, LAND_BOX, null);
    expect(posReyk.y).toBeGreaterThan(posRome.y);
  });

  it("keeps Montreal west of St. John's", () => {
    const posSj = latLngToLandLocal(47.5615, -52.7126, LAND_BOX, null);
    const posMtl = latLngToLandLocal(45.5017, -73.5673, LAND_BOX, null);
    expect(posMtl.x).toBeLessThan(posSj.x);
  });
});
