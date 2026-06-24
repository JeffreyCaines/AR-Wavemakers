import { describe, expect, it } from "vitest";
import { mapXYAdminToOriginal, mapXYOriginalToAdmin } from "./geo";
import { MAP_ADMIN_CROP } from "./types";

describe("map admin crop coordinate transforms", () => {
  it("maps original corners into the cropped image bounds", () => {
    const topLeft = mapXYOriginalToAdmin(
      MAP_ADMIN_CROP.x / MAP_ADMIN_CROP.originalWidth,
      MAP_ADMIN_CROP.y / MAP_ADMIN_CROP.originalHeight
    );
    expect(topLeft.mapX).toBeCloseTo(0, 5);
    expect(topLeft.mapY).toBeCloseTo(0, 5);

    const bottomRight = mapXYOriginalToAdmin(
      (MAP_ADMIN_CROP.x + MAP_ADMIN_CROP.width) / MAP_ADMIN_CROP.originalWidth,
      (MAP_ADMIN_CROP.y + MAP_ADMIN_CROP.height) / MAP_ADMIN_CROP.originalHeight
    );
    expect(bottomRight.mapX).toBeCloseTo(1, 5);
    expect(bottomRight.mapY).toBeCloseTo(1, 5);
  });

  it("round-trips stored calibration coordinates", () => {
    const original = { mapX: 0.3439119170984456, mapY: 0.5202648182607068 };
    const admin = mapXYOriginalToAdmin(original.mapX, original.mapY);
    const restored = mapXYAdminToOriginal(admin.mapX, admin.mapY);
    expect(restored.mapX).toBeCloseTo(original.mapX, 10);
    expect(restored.mapY).toBeCloseTo(original.mapY, 10);
  });
});
