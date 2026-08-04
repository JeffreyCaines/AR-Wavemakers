# Wavemakers

WebAR experience that tracks a physical wall world map with [MindAR](https://hiukim.github.io/mind-ar-js-doc/)
image tracking and overlays geo-addressed impact cards. Works on mobile browsers
over HTTPS — no app install, no WebXR.

- `/` - landing: choose the real map or the browser simulator
- `/ar` - live AR viewer. Point the phone at the map; ripples reveal pins; aim the crosshair for a story
- `/ar-preview` - same UX without a camera or physical map
- `/admin` - password-gated dashboard for cards, map calibration, ripples placement, and story review
- `/share-story.html` - public form to submit an impact story for admin approval

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vite + TypeScript (vanilla) |
| AR | MindAR 1.2.5 + Three.js (CSS2D overlays + procedural ripples) |
| Hosting | Netlify (auto HTTPS for camera) |
| API | Netlify Functions (single function at `/api/*`) |
| Data | Netlify Blobs; local `data/*.json` fallback in Netlify Dev |
| Geocoding | OpenStreetMap Nominatim via server-side proxy |
| Auth | `ADMIN_PASSWORD` bearer token checked in the function |

## Prerequisites

- Node 18+ (Node 20/22 LTS recommended), npm.
- Map and ripples assets — see [`public/README.md`](public/README.md).
- For local Functions/Blobs: Netlify CLI via `npx netlify-cli` (or a global install).

> **`three` is pinned to `0.160.0`** (exact). `mind-ar` 1.2.5 is built against this
> version and imports the now-removed `sRGBEncoding` export; newer three (0.162+)
> breaks the bundle. Do not bump `three` unless `mind-ar` ships a release that
> supports modern three.
>
> **Dependency note:** `mind-ar` pulls in `canvas` (node-canvas) for its Node-side
> compiler. Tracking runs in the browser and target compilation uses Puppeteer, so
> `package.json` `overrides` redirects `canvas` → `@napi-rs/canvas` (prebuilt
> binaries, no C++ toolchain).

## Local development

```bash
npm install
# create .env with ADMIN_PASSWORD=... (optional: NOMINATIM_EMAIL, GEOCODER_URL)
```

There is no committed `.env.example`.

Two ways to run:

```bash
# Full stack (recommended) — app + Functions + Blobs on :8888
# netlify.toml runs Vite on :5173 behind the Netlify Dev gateway.
npx netlify-cli dev

# Frontend only — API calls proxy to a Netlify Dev instance on :8888
npm run dev                 # http://localhost:5173
```

Compile the tracking target once a reference image exists:

```bash
node scripts/compile-target.mjs   # writes public/map-target.mind
# needs puppeteer: npm i -D puppeteer
```

Type-check and build:

```bash
npm run typecheck
npm run build                 # outputs dist/ (index.html + share-story.html)
```

Shared unit tests live under `src/shared/*.test.ts` but are not wired in the current `package.json`.

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import from Git**.
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions` (from `netlify.toml`)
3. Set environment variables: `ADMIN_PASSWORD` (required), `NOMINATIM_EMAIL` (optional), `GEOCODER_URL` (optional).
4. Commit `public/map-reference.jpg` and `public/map-target.mind` (or run `node scripts/compile-target.mjs` before deploy).
5. Open the Netlify URL on a phone → choose the real map → tap **Start AR** → allow camera → point at the map.

## Data model

```ts
interface InfoCard {
  id: string;
  title: string;
  body: string;          // company impact story
  companyName?: string;
  address: string;
  lat: number;
  lng: number;
  mapX: number;          // 0–1 horizontal on reference image
  mapY: number;          // 0–1 vertical on reference image
  imageUrl?: string;
  linkUrl?: string;
  active: boolean;
}
```

Address flow: geocode → **calibrated** `(mapX, mapY)` when calibration is set → **drag the
pin** to fine-tune → save.

Admin pin editing uses a cropped wall photo (`map-reference - cropped.jpg`). AR tracking
uses the full `map-reference.jpg`. Crop offsets live in `MAP_ADMIN_CROP`
(`src/shared/types.ts`); update them if you replace the crop.

### Map calibration (required for accurate geocoding)

The wall map is artistic and does **not** match a textbook equirectangular projection.
In `/admin`, use **Map calibration**:

1. Add at least **two** well-separated cities you can identify on the map (e.g. Tokyo + London).
2. Each point is geocoded, then you **drag the orange pin** to its true spot on the reference image.
3. Click **Save calibration** (stored as `calibration.json` in Blobs / local data).
4. Future card geocoding uses the fitted projection (2 points = linear, 3+ = affine).

Until calibration is saved, geocoded pins are approximate — always drag to fine-tune.

### Ripples reveal

On `/ar` and `/ar-preview`, procedural water ripples expand from a St. John's origin and
progressively reveal location pins. Placement is edited in `/admin` (ripples anchor) and
stored as `ripples-anchor` config. Viewer masks live under `public/assets/` — see
[`public/README.md`](public/README.md).

### Story submissions

Public visitors submit via `/share-story.html` → stored in `submissions.json`.
In `/admin`, **approve** creates an inactive card ready for pin placement; **reject** deletes
the submission.

## API

| Method + path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/cards` | public | Active cards for the AR viewer |
| `GET /api/cards/all` | bearer | All cards |
| `POST /api/cards` | bearer | Create |
| `PUT /api/cards/:id` | bearer | Update |
| `DELETE /api/cards/:id` | bearer | Delete |
| `GET /api/geocode?q=…` | bearer | Nominatim proxy |
| `GET /api/calibration` | bearer | Map calibration points |
| `PUT /api/calibration` | bearer | Save calibration points |
| `GET /api/ripples-anchor` | public | Ripples placement config |
| `PUT /api/ripples-anchor` | bearer | Save ripples placement |
| `POST /api/submissions` | public | Submit a story |
| `GET /api/submissions` | bearer | List pending submissions |
| `POST /api/submissions/:id/approve` | bearer | Approve → inactive card |
| `DELETE /api/submissions/:id` | bearer | Reject / delete |

Auth header: `Authorization: Bearer <ADMIN_PASSWORD>`.

## Geocoding & the OSM Nominatim policy

Geocoding uses OpenStreetMap's public Nominatim service, which has a
[usage policy](https://operations.osmfoundation.org/policies/nominatim/). This app
is built to comply for moderate, admin-only use:

- **Proxied server-side** through the Netlify Function (not called from the browser).
- **Triggered only by the admin** clicking "Geocode address" — no autocomplete, no bulk/periodic queries.
- **Identifying User-Agent** including your `NOMINATIM_EMAIL` contact when set.
- **Rate-limited** to ≤1 request/second and **caches** repeated queries across cold starts (Netlify Blobs / local `data/geocode-cache.json`, plus an in-memory layer while warm).
- **Switchable without a redeploy** via `GEOCODER_URL`.
- **Attribution** ("© OpenStreetMap contributors") shown in the admin UI.

Set `NOMINATIM_EMAIL` in production. If usage grows beyond moderate, switch
`GEOCODER_URL` to a commercial provider or your own Nominatim instance.

## Troubleshooting tracking

Weak or jittery tracking is almost always the reference image, not the code. Retake
it flat-on, full-frame, glare-free, ≥1500px wide, then run `node scripts/compile-target.mjs`
again.
