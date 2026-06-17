# `public/` assets

Two files power the AR tracking. Drop them here:

## 1. `map-reference.jpg` (you provide)

A flat, straight-on photo or digital export of the wall map. Requirements:

- Camera **parallel to the wall** — no perspective/angle.
- The **full map** in frame, including all blue/purple border layers; nothing cropped.
- **Even, diffuse light**; no window glare or reflections on glossy layers.
- Minimum **1500px wide**; use the phone's standard lens (not ultrawide).

This image is shown in the admin pin editor and is compiled into the tracking target.

## 2. `map-target.mind` (generated)

Compiled from `map-reference.jpg`:

```bash
npm run compile-target
```

This launches a headless browser (Puppeteer) that runs MindAR's compiler and
writes `public/map-target.mind`. Re-run it whenever you replace the reference image.

Commit both files so Netlify serves them with the static build. If you prefer not
to commit binaries, set the Netlify build command to `npm run build:full`, which
compiles the target during deploy (the reference image must still be committed).
