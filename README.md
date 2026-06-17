# AR World Map

WebAR experience that tracks a physical wall world map with [MindAR](https://hiukim.github.io/mind-ar-js-doc/)
image tracking and overlays geo-addressed info cards. Works in **iOS Safari** and
**Android Chrome** over HTTPS — no app install, no WebXR.

- `/` — AR viewer. Point the phone at the map; aim the crosshair at a location to
  reveal its impact story.
- `/admin` — password-gated dashboard to create/edit cards, geocode addresses, and
  drag pins on the reference image.

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vite + TypeScript |
| AR | MindAR 1.2.5 + Three.js (CSS2DRenderer overlays) |
| Hosting | Netlify (auto HTTPS for camera) |
| API | Netlify Functions (single function at `/api/*`) |
| Data | Netlify Blobs (`cards.json`); local file fallback in dev |
| Geocoding | OpenStreetMap Nominatim via server-side proxy |
| Auth | `ADMIN_PASSWORD` bearer token checked in the function |

## Prerequisites

- Node 18+ (Node 20/22 LTS recommended), npm.
- A flat reference image of the map — see [`public/README.md`](public/README.md).
- For local Functions/Blobs testing: the Netlify CLI, installed globally
  (`npm i -g netlify-cli`) or run on demand with `npx netlify-cli`.

> **`three` is pinned to `0.160.0`** (exact). `mind-ar` 1.2.5 is built against this
> version and imports the now-removed `sRGBEncoding` export; newer three (0.162+)
> breaks the bundle. This matches MindAR's official install docs. Do not bump `three`
> unless `mind-ar` ships a release that supports modern three.
>
> **Dependency note:** `mind-ar` pulls in `canvas` (node-canvas) for its Node-side
> compiler, which needs a C++ toolchain and has no prebuilt binary on the newest
> Node releases. We never use Node `canvas` (tracking runs in the browser; target
> compilation runs in Puppeteer's browser), so `package.json` `overrides` redirects
> `canvas` → `@napi-rs/canvas`, a drop-in that ships prebuilt binaries and needs no
> compiler. This keeps `npm install` working on any Node version / Windows without
> Visual Studio Build Tools.

## Local development

```bash
npm install
cp .env.example .env        # set ADMIN_PASSWORD
```

Two ways to run:

```bash
# Full stack (recommended) — serves the app + Functions + Blobs emulation.
# Requires the Netlify CLI (global or npx).
npm run netlify:dev         # http://localhost:8888
#   or: npx netlify-cli dev

# Frontend only — API calls are proxied to a separate `netlify dev` on :8888.
npm run dev                 # http://localhost:5173
```

Compile the tracking target once a reference image exists:

```bash
npm run compile-target      # writes public/map-target.mind
```

Type-check everything (front-end + functions):

```bash
npm run typecheck
```

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import from Git**.
   - Build command: `npm run build` (or `npm run build:full` to compile the target on deploy).
   - Publish directory: `dist`.
   - Functions directory: `netlify/functions` (auto-detected from `netlify.toml`).
3. Set environment variables: `ADMIN_PASSWORD` (required), `NOMINATIM_EMAIL` (optional).
4. Commit `public/map-reference.jpg` and `public/map-target.mind` (or use `build:full`).
5. Open the Netlify URL on a phone, tap **Start AR**, allow camera, point at the map.

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

Address flow: geocode → equirectangular lat/lng → initial `(mapX, mapY)` → **drag the
pin** to fine-tune (the artwork is stylized and won't align perfectly to geography) → save.

## API

| Method + path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/cards` | public | Active cards for the AR viewer |
| `GET /api/cards/all` | bearer | All cards |
| `POST /api/cards` | bearer | Create |
| `PUT /api/cards/:id` | bearer | Update |
| `DELETE /api/cards/:id` | bearer | Delete |
| `GET /api/geocode?q=…` | bearer | Nominatim proxy |

Auth header: `Authorization: Bearer <ADMIN_PASSWORD>`.

## Geocoding & the OSM Nominatim policy

Geocoding uses OpenStreetMap's public Nominatim service, which has a
[usage policy](https://operations.osmfoundation.org/policies/nominatim/). This app
is built to comply for moderate, admin-only use:

- **Proxied server-side** through the Netlify Function (not called from the browser).
- **Triggered only by the admin** clicking "Geocode address" — no autocomplete, no bulk/periodic queries.
- **Identifying User-Agent** including your `NOMINATIM_EMAIL` contact when set.
- **Rate-limited** to ≤1 request/second and **caches** repeated queries within a warm instance.
- **Switchable without a redeploy** via `GEOCODER_URL` (point at another provider or your own Nominatim instance).
- **Attribution** ("© OpenStreetMap contributors") shown in the admin UI.

Set `NOMINATIM_EMAIL` in production. If usage grows beyond moderate, switch
`GEOCODER_URL` to a commercial provider or your own Nominatim instance.

## Troubleshooting tracking

Weak or jittery tracking is almost always the reference image, not the code. Retake
it flat-on, full-frame, glare-free, ≥1500px wide, then `npm run compile-target` again.
