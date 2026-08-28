# Wavemakers

WebAR experience that tracks a physical wall world map with [MindAR](https://hiukim.github.io/mind-ar-js-doc/)
image tracking and overlays geo-addressed impact cards. Works on mobile browsers
over HTTPS — no app install, no WebXR.

## Routes

The app is a **single-page shell**. `index.html` is the only HTML entry; `src/main.ts`
picks a view from `location.pathname` and code-splits each one behind a dynamic import.
`public/_redirects` rewrites every unknown path to `/index.html` with a 200 so deep links work.

| Path | Renders |
|------|---------|
| `/` | Wavemakers landing. Share a story, or start the map in place (no extra page load). On a phone, Start opens Select a Mode (On Site or At Home). On a computer, Launch Map opens the 3D viewer. Viewer JS and the 3D model load only after that choice. |
| `/ar` | Live AR and the 3D map. Desktop opens the 3D map. A phone opens Select a Mode (On Site wall tracking, or At Home 8th Wall SLAM). Also opened from Start or Launch Map. Modes are history states inside the shell, not separate URLs. |
| `/legacy-ar-preview` | Admin-gated wall-map AR preview (no camera, no physical map) |
| `/legacy-landing` | Original simple landing, kept for reference |
| `/map-viewer` | Redirects to `/ar` |
| `/admin` | Admin-gated 3D dashboard for cards, map calibration, ripples, story review, and accounts |
| `/admin-manual.html` | [Admin user manual](public/admin-manual.html), a static page outside the shell (also linked from the admin menu) |

Any other path is replaced with `/`.

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vite + TypeScript (vanilla), single-page shell with client-side routing |
| On Site AR | MindAR 1.2.5 + Three.js image tracking (CSS2D overlays + procedural ripples) |
| At Home AR | 8th Wall engine binary (SLAM) + Three.js, places the GLTF map on a surface |
| Desktop 3D map | Three.js + OrbitControls on `src/map/TechNL_map_Textured.gltf` |
| Hosting | Netlify (auto HTTPS for camera) |
| API | Netlify Functions (single function at `/api/*`) |
| Data | Netlify Blobs (store `ar-map-cards`); local `data/*.json` fallback in Netlify Dev |
| Geocoding | OpenStreetMap Nominatim via server-side proxy |
| Auth | Per-account email + scrypt-hashed password; session bearer token, 24h TTL |

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
# create .env with ADMIN_EMAIL=... and ADMIN_PASSWORD=... (optional: NOMINATIM_EMAIL, GEOCODER_URL)
# ADMIN_PASSWORD must meet the admin password policy (12+ chars, upper, lower, digit, special).
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

`postinstall` / `predev` / `prebuild` copy `@8thwall/engine-binary` into `public/external/xr` (gitignored). Needed so Netlify Dev and ngrok serve `/external/xr/xr.js` as JS, not SPA HTML. Re-run with `npm run sync-xr` if that folder is missing.

Compile the tracking target once a reference image exists:

```bash
node scripts/compile-target.mjs   # writes public/map-target.mind
# needs puppeteer: npm i -D puppeteer
```

Type-check and build:

```bash
npm run typecheck
npm run build                 # outputs dist/ (index.html)
```

### Tests

Unit tests exist for the pure logic modules and are written for [Vitest](https://vitest.dev/),
but **Vitest is not a dependency and there is no `test` script**, so they do not run today.
`tsconfig.json` excludes `src/**/*.test.ts` from the build. To run them, add Vitest and a
`test` script.

| Area | Files |
|------|-------|
| Cards and content | `src/shared/cardContent.test.ts`, `src/shared/locationGroups.test.ts` |
| Submissions | `src/shared/sanitizeStorySubmission.test.ts` |
| Passwords | `src/shared/passwordPolicy.test.ts` |
| Map and geometry | `src/shared/mapCrop.test.ts`, `src/map/latLngPins.test.ts` |
| Ripples | `src/shared/ripplesSim.test.ts`, `src/shared/ripplesReveal.test.ts`, `src/shared/ripplesAnchor.test.ts` |
| Server sanitizing | `netlify/functions/_shared/sanitizeCard.test.ts` |

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import from Git**.
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions` (from `netlify.toml`)
3. Set the environment variables below.
4. Confirm `public/map-reference.jpg` and `public/map-target.mind` are committed (both are today). Re-run `node scripts/compile-target.mjs` if you replace the reference image.
5. Open the Netlify URL. On a phone tap **Start**, choose On Site or At Home, allow camera, then point at the wall map (On Site) or place the 3D map (At Home). On a computer use **Launch Map in Your Browser**.

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ADMIN_EMAIL` | yes | Email for the seeded first project admin |
| `ADMIN_PASSWORD` | yes | Its password; must meet the password policy or seeding fails |
| `NOMINATIM_EMAIL` | recommended | Contact address sent in the geocoder `User-Agent` |
| `GEOCODER_URL` | no | Swap the geocoder without a redeploy; defaults to public Nominatim |
| `NETLIFY_DEV` | set by CLI | When `"true"`, storage reads and writes local `data/*.json` instead of Blobs |

### Storage keys

Everything persists in the Netlify Blobs store `ar-map-cards`, mirrored to `data/` in Netlify
Dev (those files are gitignored):

`cards.json`, `calibration.json`, `ripples-anchor.json`, `submissions.json`,
`geocode-cache.json`, `admins.json`, `sessions.json`, `rate-limits.json`, and `uploads/{id}`.

If `cards.json` is absent on first read, the function writes and returns `SEED_CARDS` from
`src/shared/types.ts`.

## Data model

A card is either an **individual** or an **organization** (`cardType`). Everything after the
core block is optional and comes from the matching Get Noticed form. Cards stored before the
two-type split have no `cardType` and are treated as organizations (`resolveCardType`).

```ts
interface InfoCard {
  // Core — always present
  id: string;
  title: string;         // display name, derived from the form fields
  body: string;          // impact story, assembled from the form fields
  companyName?: string;
  address: string;
  lat: number;
  lng: number;
  mapX: number;          // 0–1 horizontal on reference image
  mapY: number;          // 0–1 vertical on reference image
  imageUrl?: string;
  linkUrl?: string;
  active: boolean;
  cardType?: "individual" | "organization";

  // Individual
  firstName?, lastName?, pronouns?: string;
  profession?: string[];
  currLocation?, origLocation?: string;
  linkedin?, email?: string;
  nlDescription?, whyDescription?, dreamJob?, story?: string;

  // Organization
  submitterName?, submitterEmail?, orgName?: string;
  industry?: string[];
  nlLocation?: string;
  locations?, exportLocations?: string[];
  websiteUrl?, linkedinUrl?, orgContactEmail?: string;
  yearEstablished?: number;
  mainDescription?, companyBio?, stakeholderDescription?, storyDescription?: string;
  mediaOneUrl?, mediaTwoUrl?, youtubeLink?: string;

  // Shared
  isTechNlMember?: string;
  logoUrl?: string;
  optInModeration?, optInNewsletter?: boolean;
}
```

`title`, `body`, `imageUrl`, and `linkUrl` are **derived** from the type-specific fields when a
card is saved (`deriveCardDisplayFields` in `src/admin/cardForm.ts`), so the viewers can read
one shape regardless of card type.

`GET /api/cards` is public and strips the contact fields before responding: `email`,
`submitterEmail`, `submitterName`, `optInModeration`, `optInNewsletter`. Use
`GET /api/cards/all` (session) to see them.

Other stored shapes live in `src/shared/types.ts`: `CalibrationPoint`, `RipplesAnchor`
(a `loop` and a `fade` placement plus the `activeVariant`), and `StorySubmission`
(a union of legacy, individual, and organization submissions).

Address flow: geocode → **calibrated** `(mapX, mapY)` when calibration is set → **drag the
pin** to fine-tune → save.

Cards that share a `(mapX, mapY)` are grouped into one pin. Dragging that pin moves every
card in the group, and visitors pick which entry to read.

Admin pin editing uses a cropped wall photo (`map-reference - cropped.jpg`). AR tracking
uses the full `map-reference.jpg`. Crop offsets live in `MAP_ADMIN_CROP`
(`src/shared/types.ts`); update them if you replace the crop.

### Map calibration (required for accurate geocoding)

The wall map is artistic and does **not** match a textbook equirectangular projection.
In `/admin`, use **Calibrate Map → Calibration points**:

1. Add at least **two** well-separated cities you can identify on the map (e.g. Tokyo + London).
2. Each point is geocoded, then you **drag the calibration pin** to its true spot (arrow keys or WASD nudge it, Shift for finer steps).
3. Click **Save** (stored as `calibration.json` in Blobs / local data).
4. Future card geocoding uses the fitted projection.

The fit scales with how many points you save:

| Points | Projection |
|--------|------------|
| 0 | Equirectangular, uncalibrated |
| 1 | Equirectangular shifted onto that point |
| 2 | Linear |
| 3 | Affine (with longitude unwrap) |
| 4+ | Thin-plate spline (with longitude unwrap) |

Until calibration is saved, geocoded pins are approximate — always drag to fine-tune.

### Ripples reveal

On `/ar` and `/legacy-ar-preview`, procedural water ripples expand from a St. John's origin and
progressively reveal location pins. The origin is edited in `/admin` under **Calibrate Map →
Ripples config** and stored as `ripples-anchor` config.

Because `/admin` now renders the 3D map instead of the wall photo, the ripples preview has two
sources. **3D model** plays the pulse baked into the GLTF. **Ripples shader** draws the same
procedural overlay the viewers use, masked to water by
`bakeLayer7RippleMasks` (`src/admin/modelRippleMasks.ts`), which rasterizes the model's
`Layer_01`–`Layer_07` water meshes minus land. The **Layer 7 cutoff** control picks the outer or
inner edge of that ring. The remaining sliders (rings, speed, color, softness, and so on) are
**live preview only** and are not saved; the AR viewers use the shared constants in
`src/shared/ripplesSim.ts`.

The viewer shader still loads its masks from `public/assets/` — see
[`public/README.md`](public/README.md).

### Story submissions

Public visitors submit from the landing page. There are two Get Noticed forms, Individual and
Organization (`src/copy/getNoticedForm.ts`), and both POST to `/api/submissions`, which stores
them in `submissions.json`. The old standalone `/share-story` page is gone; the forms are now
part of the landing shell.

In `/admin` → **Review Submissions**, **Approve** creates an inactive card ready for pin
placement and **Reject** deletes the submission.

Incoming text is sanitized server-side (`src/shared/sanitizeStorySubmission.ts`). Emails and
URLs are also checked for IDN homograph characters (`src/shared/homoglyphs.ts`); when a
lookalike glyph is replaced with Latin text the submission is flagged `hadHomograph` and the
admin list shows a **Homograph detected** label so you can verify before approving.

## API

| Method + path | Auth | Purpose |
|---------------|------|---------|
| `POST /api/auth/login` | public | Email + password; rate limited |
| `POST /api/auth/logout` | session | Revoke session |
| `POST /api/auth/change-password` | session | Set a new password |
| `GET /api/auth/me` | session | Current admin email and role |
| `GET /api/admins` | project admin | List accounts |
| `POST /api/admins` | project admin | Create a wavemaker admin |
| `DELETE /api/admins/:id` | project admin | Delete a wavemaker admin |
| `POST /api/admins/:id/reset-password` | project admin | Set a temporary password |
| `GET /api/cards` | public | Active cards for the AR viewer |
| `GET /api/cards/all` | session | All cards |
| `POST /api/cards` | session | Create |
| `PUT /api/cards/:id` | session | Update |
| `DELETE /api/cards/:id` | session | Delete |
| `GET /api/geocode?q=…` | session | Nominatim proxy |
| `GET /api/calibration` | session | Map calibration points |
| `PUT /api/calibration` | session | Save calibration points |
| `GET /api/ripples-anchor` | public | Ripples placement config |
| `PUT /api/ripples-anchor` | session | Save ripples placement |
| `POST /api/submissions` | public | Submit a story |
| `GET /api/submissions` | session | List pending submissions |
| `POST /api/submissions/:id/approve` | session | Approve → inactive card |
| `DELETE /api/submissions/:id` | session | Reject / delete |
| `POST /api/uploads` | public | Upload a base64 image (4 MB max) |
| `GET /api/uploads/:id` | public | Serve an uploaded image |

Auth header: `Authorization: Bearer <session token>` from `POST /api/auth/login`. The client
keeps the token in `sessionStorage` under `ar_admin_token`, so a session is per browser tab.
Sessions expire after 24 hours.

Accounts flagged `mustChangePassword` are blocked from every endpoint except
`GET /api/auth/me` and `POST /api/auth/change-password` until they set a new password.

### Accounts and passwords

On first boot, if the admin store is empty, the function seeds one project admin from `ADMIN_EMAIL` + `ADMIN_PASSWORD` (scrypt hashed and salted). After that, those env values are not accepted as bearer tokens. If seeding fails (missing values, or a password that fails the policy) login returns 503 with the reason.

The project admin can create wavemaker admins. New accounts are always created as `wavemaker_admin` with a temporary password and `mustChangePassword` set, so they must pick their own password at first sign-in. The project admin account cannot be deleted, and its password cannot be reset by another account.

Password policy (enforced on the server for seed, create, reset, and change): 12–128 characters, at least one lowercase, uppercase, digit, and special character, must not match the account email, and on change must differ from the current password.

### Rate limits

| Bucket | Limit | Window | Applies to |
|--------|-------|--------|------------|
| Failed login per email + IP | 5 | 15 min | `POST /api/auth/login` |
| Failed login per IP | 20 | 15 min | `POST /api/auth/login` |
| Change password per account | 10 | 15 min | `POST /api/auth/change-password` |
| Admin writes per account | 20 | 60 min | `POST`/`DELETE /api/admins*` |
| Submissions per IP | 10 | 60 min | `POST /api/submissions` |
| Uploads per IP | 30 | 15 min | `POST /api/uploads` |

Login buckets count failures only; the others count every request. Counters persist in Blobs (`rate-limits.json`), so they survive cold starts.

## Security headers

`public/_headers` sets `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, a `Permissions-Policy` that allows camera and geolocation only for
same-origin, and HSTS.

The Content-Security-Policy is **`Report-Only`**. MindAR/TensorFlow.js and the 8th Wall engine
binary need `wasm-unsafe-eval` and `blob:` workers, so check the browser console for
violations on `/ar` before promoting it to an enforcing header.

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
