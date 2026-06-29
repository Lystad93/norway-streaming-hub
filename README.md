# Norway Streaming Hub — Stremio addon

A configurable Stremio addon for Norway. Each user picks the streaming services
they have and whether to show **subscription**, **rent**, **buy**, and/or
**free** results. For every movie/series it shows where the title is available
and links out to the provider — best-effort opening the app on mobile.

This is the NORGE-HUB idea plus the per-user service selection and rent/buy
filtering it lacks. See `SPEC.md` for the full design rationale.

## How it works

```
Stremio → stream/movie/tt….json
  → resolve title via Cinemeta (IMDb id → name + year)   src/meta.js
  → query JustWatch GraphQL for offers in NO              src/justwatch.js
  → keep only the user's providers + chosen offer types   src/addon.js
  → one link per provider/offer (externalUrl)             src/deeplinks.js
```

Data comes from **JustWatch's public GraphQL** (the same dataset TMDB licenses),
because — unlike TMDB — it returns a per-title `standardWebURL` and the
`monetizationType` per provider. No API key required.

If JustWatch is unavailable or returns nothing, the addon falls back to **TMDB's
watch/providers** (also JustWatch-powered). TMDB only knows *which* providers
carry a title per bucket plus one redirect `link` — no per-provider URLs, prices,
or quality — so fallback results are coarser but keep the addon working. The TMDB
fallback is optional and activates only if a TMDB credential is set (see below).

## Files

| File | Purpose |
|---|---|
| `src/manifest.js` | Addon manifest + the configuration form (country, per-provider checkboxes, offer-type checkboxes). |
| `src/providers.js` | Norwegian provider registry + JustWatch matching + optional per-provider deep-link rewrite. |
| `src/justwatch.js` | **Isolated** JustWatch GraphQL client (search + offers). The only file to fix if JustWatch changes. |
| `src/tmdb.js` | TMDB fallback (IMDb→TMDB id, watch/providers), normalised to the JustWatch offer shape. |
| `src/meta.js` | IMDb id → title/year via Cinemeta, with an in-memory cache. |
| `src/deeplinks.js` | Best-effort "open the app" layer. |
| `src/addon.js` | Stream handler: resolve → fetch → filter by config → build streams. |
| `server.js` | Local / Beamup entry point (`serveHTTP`). |

## Configuration (.env)

```bash
cp .env.example .env
```

The TMDB fallback is optional. To enable it, set **one** of these in `.env`
(get them at https://www.themoviedb.org/settings/api):

- `TMDB_API_TOKEN` — v4 read access token (preferred, sent as Bearer), or
- `TMDB_API_KEY` — v3 api key.

`PORT` is optional (default `7000`). Leaving the TMDB values blank simply disables
the fallback — the addon still runs on JustWatch alone.

## Run locally

```bash
npm install
cp .env.example .env   # optional: add a TMDB key to enable fallback
npm start
# → http://127.0.0.1:7000/configure   (tick your services, click Install)
# → http://127.0.0.1:7000/manifest.json
```

## Deploying into the VPS stack (Traefik + Authelia, `apps/<name>/compose.yaml`)

This app follows the stack conventions: `compose.yaml` in its own app dir,
`expose` (no published port — Traefik reaches it on the shared network),
app-level `.env` via `env_file`, Traefik labels with `authelia@docker`, a data
volume, `profiles: [streaminghub, all]`, and a **pulled GHCR image** (`${STREAMINGHUB_IMAGE?}`)
built by GitHub Actions — so it pulls like every other service, no local build.

### One-time: publish the image to GHCR

1. Push this repo to GitHub. `.github/workflows/docker-publish.yml` builds on every
   push to `main` (and on `v*` tags) and pushes to `ghcr.io/<owner>/<repo>`.
2. After the first run, make the package pullable from the VPS: either set its
   visibility to **Public** (GitHub → your profile → Packages → the package →
   Package settings → Change visibility), or `docker login ghcr.io` on the VPS
   with a PAT that has `read:packages`.

### Deploy on the VPS

Put the app folder at `/opt/docker/apps/norway-streaming-hub/`, then:

1. **App secrets** — `cp .env.example .env` in this dir; add a TMDB key if you
   want the fallback (optional).
2. **Root `.env`** (`/opt/docker/.env`) — add, near the other entries:
   ```
   STREAMINGHUB_HOSTNAME=streaminghub.${DOMAIN}
   STREAMINGHUB_IMAGE=ghcr.io/<owner>/<repo>:latest
   ```
   and add `streaminghub` to `COMPOSE_PROFILES` (or use `--profile`).
3. **Root `compose.yaml`** — add to the `include:` list (keep alphabetical):
   ```
   - apps/norway-streaming-hub/compose.yaml
   ```
4. **DNS** — point `streaminghub.<domain>` at the VPS (Cloudflare or manual, per
   your DDNS setup).
5. **Pull + start** — exactly like your other services:
   ```bash
   cd /opt/docker
   docker compose --profile streaminghub pull
   docker compose --profile streaminghub up -d
   ```

To ship updates later: push to `main`, wait for the Action, then
`docker compose --profile streaminghub pull && … up -d` on the VPS.

Traefik serves `https://${STREAMINGHUB_HOSTNAME}` with a Let's Encrypt cert behind
Authelia. No Authelia ACL changes are needed for this PostersPlus-style setup
(full `authelia@docker` is fine — see the traffic split below). You'd only touch
`TEMPLATE_STREMIO_ADDON_HOSTNAMES` / `configuration.yml` if you wanted to install
the **public** URL directly into a bare Stremio client (partial bypass).

### Public + Authelia: how the traffic splits

Authelia 2FA only works for **browser** requests. Stremio/AIOStreams fetch addons
machine-to-machine and can't pass a login, so:

- **Internal** (AIOStreams → `http://streaminghub:7000/...` over the Docker
  network): no auth, this is what actually serves streams. Works.
- **Public** (`https://${STREAMINGHUB_HOSTNAME}/configure` in your browser):
  Authelia-gated, used only for remote configuring. Works.

Don't install the *public* URL straight into a bare Stremio client — that path is
auth-gated. When wiring into AIOStreams, take the config segment the configure
page generates and point it at the **internal** host:

```
configure page gives:  https://<STREAMINGHUB_HOSTNAME>/<config-blob>/manifest.json
use in AIOStreams:      http://streaminghub:7000/<config-blob>/manifest.json
```

This is the same split that works for your PostersPlus setup.

### Where config and state live (nowhere on the server)

The addon is **stateless** — no database, no data volume. Your choices (country,
providers, subscription/rent/buy) are encoded into the install URL's
`<config-blob>` segment; Stremio/AIOStreams hold that URL, and the server reads
the choices from each request. The only caches (Cinemeta lookups, etc.) sit in
memory and repopulate after a restart. So there's no volume to mount and nothing
to back up.

`PORT=7000` in `environment` is the single value that must match the Traefik
`loadbalancer.server.port=7000` label.

Open the `/configure` page, choose your services and offer types, and click
**Install** — Stremio opens with your personal configured install URL.

To install in the desktop app by URL, paste the configured manifest URL (the one
the configure page generates) into Stremio's *Addons → paste URL* box. For a quick
manual test, you can also use the `stremio://` deep link by replacing `https://`
with `stremio://` in the manifest URL.

## Deploy

- **Beamup** (Stremio's free hosting): `npm i -g stremio-addon-linter beamup` then
  `beamup` from this folder. Simplest path; `serveHTTP` works as-is.
- **Render / Railway / a VPS:** run `node server.js` behind HTTPS (Stremio requires
  HTTPS for remote addons). Set `PORT` via env.
- **Vercel** (like NORGE-HUB): serverless needs the SDK router exported from an
  `api/` handler rather than `serveHTTP`. Use `getRouter(addonInterface)` from the
  SDK and wrap it; the rest of the code is unchanged.

## Configuration

The configure page exposes:

- **Country** — `NO` (v1 is Norway-only).
- **One checkbox per provider** — Netflix, Viaplay, Max, Disney+, Prime Video,
  SkyShowtime, TV 2 Play, NRK TV, Apple TV, Strim, Rakuten. Tick the ones you have.
- **Offer types** — Subscription (default on), Rent, Buy, Free/ads.

Choices are encoded into your install URL; the server reads them per request, so
there is no database and no shared state between users.

## Known limitations / next steps

- **"Open the app" is best-effort.** `standardWebURL` reliably opens the correct
  title's web page and on mobile usually hands off to the installed app via
  universal links. On desktop Stremio it opens the browser. True native deep links
  (`viaplay://…`) are not exposed by JustWatch; add per-provider rewrites in
  `providers.js` (`deeplink`) only where you've tested them.
- **JustWatch is unofficial.** The endpoint can change without notice. It's
  isolated in `src/justwatch.js`; consider adding a TMDB fallback (key required)
  for resilience.
- **Confirm provider matching.** The `match` strings in `providers.js` should be
  verified against a live NO offers response and tightened if any provider is
  mis-matched.
- **Series episodes:** the addon resolves availability at the show level (Stremio
  passes `tt…:season:episode`; we look up the series). Per-season availability
  could be added later.

## Verification done

`src/addon.js` was exercised with mocked network responses covering: provider
filtering, subscription/rent/buy/free filtering, best-quality dedup (4K over HD),
rent price labels, the "no providers selected → show all" fallback, and the
**JustWatch-outage → TMDB fallback** path (verified the fetch order JustWatch →
TMDB find → watch/providers and correct stream output). Live data testing must be
run from your own machine (JustWatch, Cinemeta, and TMDB are reachable there).
