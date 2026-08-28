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

## 4. Ripples masks (`assets/`)

Required for the water ripples reveal on `/ar` and `/legacy-ar-preview`. The viewer
shader (`src/ar/ripplesEffect.ts`) loads both at startup:

| File | Role |
|------|------|
| `assets/ripple_mask.png` | Water mask for the looping ripples variant |
| `assets/ripple_mask_fade.png` | Water mask for the fade-out ripples variant |

Masks are sized to the full reference image (4032×3024), matching `RIPPLE_MASK_WIDTH` /
`RIPPLE_MASK_HEIGHT` in `src/shared/ripplesSim.ts`. Keep them in sync when you replace
the map photo.

The admin previews no longer use GIFs. `/admin` renders the 3D map, and its ripples
overlay is generated at runtime from the model's water layers
(`src/admin/modelRippleMasks.ts`), so nothing extra needs to live here for it.

## 5. Netlify config files

These are plain text files served as-is by Netlify. They are not assets, but they must
stay in `public/` so Vite copies them into `dist/`.

| File | Role |
|------|------|
| `_redirects` | SPA fallback: rewrites unknown paths to `/index.html` with a 200 |
| `_headers` | Security headers, including a Report-Only CSP for the AR routes |

## 6. `external/` (generated, gitignored)

`npm run sync-xr` copies `@8thwall/engine-binary` here so `/external/xr/xr.js` is served
as JavaScript rather than the SPA fallback HTML. It runs automatically on `postinstall`,
`predev`, and `prebuild`. Re-run it manually if the folder is missing.
