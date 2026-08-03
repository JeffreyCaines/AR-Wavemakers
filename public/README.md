# `public/` assets

Assets required for AR tracking, admin pin editing, and the ripples reveal.

## 1. `map-reference.jpg` (you provide)

Full-frame, straight-on photo or digital export of the wall map. Used for MindAR
tracking and compiled into the `.mind` target.

Requirements:

- Camera **parallel to the wall** — no perspective/angle.
- The **full map** in frame, including all blue/purple border layers; nothing cropped.
- **Even, diffuse light**; no window glare or reflections on glossy layers.
- Minimum **1500px wide**; use the phone's standard lens (not ultrawide).

## 2. `map-reference - cropped.jpg` (you provide)

Tighter crop of the wall photo used by the **admin pin editor** (not for tracking).
Pixel offsets relative to `map-reference.jpg` are defined as `MAP_ADMIN_CROP` in
`src/shared/types.ts`. If you replace this crop, update those values so admin pins
align with AR positions.

## 3. `map-target.mind` (generated)

Compiled from `map-reference.jpg`:

```bash
node scripts/compile-target.mjs
# needs puppeteer: npm i -D puppeteer
```

This launches a headless browser that runs MindAR's compiler and writes
`public/map-target.mind`. Re-run whenever you replace the reference image.

Commit both `map-reference.jpg` and `map-target.mind` so Netlify serves them with
the static build. Or compile the target before deploy with the command above (the
reference image must still be committed).

## 4. Ripples assets (`assets/`)

Required for the water ripples reveal on `/ar` and `/ar-preview`, plus admin previews:

| File | Role |
|------|------|
| `assets/ripples.gif` | Normal ripples preview (admin) |
| `assets/ripples-fade.gif` | Fade-out ripples preview (admin) |
| `assets/ripple_mask.png` | Water mask for normal ripples (viewer shader) |
| `assets/ripple_mask_fade.png` | Water mask for fade-out ripples (viewer shader) |

Masks are sized to the full reference image (4032×3024). Keep them in sync when you
replace the map photo.
