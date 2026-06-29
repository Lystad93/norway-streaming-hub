# Streaming Hub — Stremio Addon Technical Spec & Build Plan

**Goal:** A configurable Stremio addon for Norway that lets each user pick (1) which streaming services they subscribe to and (2) whether to show subscription-only results or also include rent/buy options. For each movie or series, it shows links that — best-effort — open the streaming app on the requested title.

This is what NORGE-HUB does, plus the per-user service selection and rent/buy filtering it lacks.

---

## 1. Why build new instead of patching norge-hub

norge-hub's source is not public — its manifest only exposes a `stream` resource for `movie`/`series` with IMDb (`tt`) IDs and no catalogs, and the rest is a closed Vercel deployment. There is nothing to fork. Rebuilding from scratch is straightforward because everything we need is supported by the official Stremio SDK plus one data source, and it lets us add configuration cleanly from day one.

---

## 2. Architecture overview

```
Stremio client
   │  GET /<config>/manifest.json        (per-user, config baked into URL)
   │  GET /<config>/stream/movie/tt123.json
   ▼
Addon server (Node + stremio-addon-sdk)
   │  1. parse user config from URL (country=NO, providers[], monetization[])
   │  2. map IMDb id ──► title + type  (TMDB /find, or via Cinemeta)
   │  3. query JustWatch GraphQL for that title in NO
   │  4. filter offers by user's providers + monetization types
   │  5. build one stream entry per matching offer (externalUrl = deep link)
   ▼
Returns Stream[] → Stremio shows them as clickable sources
```

Two HTTP endpoints do all the work: the **manifest** (describes the addon + its config form) and the **stream handler** (returns the links for a given title). A `/configure` page renders the settings UI.

---

## 3. Data source decision — JustWatch GraphQL (primary)

| | TMDB `watch/providers` | **JustWatch GraphQL (chosen)** |
|---|---|---|
| Country filtering | ✅ `watch_region` | ✅ per-country query |
| Monetization buckets (sub/rent/buy) | ✅ flatrate/rent/buy/free/ads | ✅ `monetizationType` per offer |
| **Per-title link that opens the app** | ❌ only a JustWatch redirect page, no per-provider title URL | ✅ `standardWebURL` per offer |
| Auth / key | Free API key required | No key (unofficial public GraphQL endpoint) |
| Price/quality (HD/4K) | ❌ | ✅ |

Because the user wants **best-effort app deep links**, JustWatch is the engine: its `Offer` fragment returns `standardWebURL` (the canonical title URL on each provider, which triggers universal-link app handoff on mobile) and `monetizationType`. TMDB alone can't open the app — it only confirms a provider carries the title.

**Caveat (be realistic):** `standardWebURL` is a *web* URL. On iOS/Android these often open the installed app via universal links; on desktop Stremio they open the browser. True custom-scheme deep links (`nflx://`, `viaplay://…`) are not exposed by JustWatch and would have to be hand-built per provider with no guarantee of stability. So "best-effort" = JustWatch web URL first, optional per-provider scheme rewriting second (section 7).

**Risk note:** JustWatch's GraphQL endpoint is unofficial and undocumented; queries can change without notice. Isolate it behind one module so it can be swapped/repaired or fall back to TMDB. (TMDB is the recommended fallback for ID→title mapping regardless.)

---

## 4. ID resolution

Stremio passes IMDb IDs (`tt…`). JustWatch keys on its own node IDs and title/year. Resolution chain:

1. Take `tt<imdb>` from the stream request.
2. Get title + year + type from **Cinemeta** (`https://v3-cinemeta.strem.io/meta/<type>/<id>.json`) — already available to every addon, no key — or from TMDB `/find/{imdb}?external_source=imdb_id`.
3. Run a JustWatch `GetSearchTitles` query (country `NO`, locale `nb_NO`) with the title; match on year + type to pick the right node.
4. Fetch that node's `offers` for `NO`.

Cache the IMDb→JustWatch-node mapping (e.g. 7–30 days) to keep latency and request volume down.

---

## 5. Stremio configuration mechanism

This is the part norge-hub omits. Stremio supports it natively:

- `manifest.behaviorHints.configurable = true` → adds a **Configure** button next to Install.
- `manifest.behaviorHints.configurationRequired = true` → forces configuration before install (recommended here, since results are meaningless without picked services).
- `manifest.config = [ … ]` → declarative form fields (`select`, `checkbox`, `multiselect`-style).
- A `/configure` route serves the settings page; the chosen values are encoded into the install URL path (e.g. `/NO|netflix,viaplay,max|flatrate,rent/manifest.json`). Each user thus installs their *own* configured instance — the server reads config straight from the URL on every request (stateless, no database).

### Proposed config schema

| Key | Type | Options / default | Purpose |
|---|---|---|---|
| `country` | select | `NO` (fixed for v1) | Region for JustWatch query |
| `providers` | checkbox group | NRK TV, TV 2 Play, Max, Viaplay, SkyShowtime, Prime Video, Netflix, Disney+, Apple TV, Strim, … | The services the user subscribes to / cares about |
| `monetization` | checkbox group | Subscription (default on), Rent, Buy, Free | Which offer types to display |
| `sortBy` | select | provider order / price / quality | Result ordering (optional) |

A custom `/configure` HTML page (checkboxes with provider logos) is friendlier than the raw SDK form and gives full control over encoding; both are viable.

---

## 6. Norwegian providers (initial set)

Seed list mirroring norge-hub plus common additions. Each maps to a JustWatch `package` `technicalName`/`id` (to be confirmed during build by inspecting a live NO query):

NRK TV, TV 2 Play, Max, Viaplay, SkyShowtime, Amazon Prime Video, Netflix, Disney+, Apple TV+/iTunes, Strim, Rakuten/Viaplay rentals.

Maintain this as a single mapping table (JustWatch package id ↔ display name ↔ logo ↔ optional app-scheme template). Adding a provider = one row.

---

## 7. Deep-link / "open the app" strategy (best-effort, layered)

1. **Default:** use the offer's `standardWebURL` as the stream's `externalUrl`. On mobile this is the most reliable path to opening the app via universal links; on desktop it opens the provider site to the title.
2. **Per-provider enhancement (optional):** for providers with known, stable custom schemes or web→app patterns, rewrite `standardWebURL` into a deep link via a per-provider template in the mapping table. Apply only where tested; otherwise fall back to step 1.
3. **Label each stream** clearly so the user can choose: e.g. `Netflix · Subscription`, `Apple TV · Rent 49 kr`, `Viaplay · Subscription · 4K`. Put provider + monetization (+ price/quality if available) in `stream.name`/`stream.description`.

Stream object shape (per matching offer):
```js
{
  name: "Viaplay",                       // provider, shows as the source "badge"
  description: "Subscription · HD",      // monetization + quality/price
  externalUrl: offer.standardWebURL      // (optionally rewritten to a deep link)
}
```

---

## 8. Tech stack & deployment

- **Runtime:** Node.js + `stremio-addon-sdk` (official; handles manifest, routing, CORS, landing page).
- **Data:** JustWatch GraphQL (primary), Cinemeta or TMDB for ID/title resolution (fallback + metadata).
- **Cache:** in-memory LRU + optional Redis/Upstash for the IMDb→node map and offer responses.
- **Hosting:** Vercel (serverless, same as norge-hub) or Stremio Beamup. Serverless fits the stateless per-URL-config design well; mind cold-start latency and add caching.
- **Config delivery:** config encoded in URL path; no user database needed.

---

## 9. Step-by-step build plan

1. **Scaffold** — `npm init`, add `stremio-addon-sdk`; minimal manifest (`resources:["stream"]`, `types:["movie","series"]`, `idPrefixes:["tt"]`). Verify it installs in Stremio.
2. **JustWatch module** — isolate one module: `searchTitle(name, year, type, country)` and `getOffers(nodeId, country)`. Confirm the live GraphQL query + the NO provider `package` ids. Unit-test against a few known titles.
3. **ID resolution** — IMDb → title/year via Cinemeta; match to JustWatch node; cache the mapping.
4. **Stream handler** — wire resolution → offers → filter by config → build `Stream[]` with `externalUrl` + clear labels.
5. **Config system** — set `behaviorHints.configurable`/`configurationRequired`, define `manifest.config`, build the `/configure` page, implement URL encode/decode of config, read config per request.
6. **Deep-link layer** — start with `standardWebURL`; add per-provider rewrite templates only where verified.
7. **Caching & resilience** — add caches; graceful fallback if JustWatch errors (return TMDB-based "available on X" links).
8. **Deploy** — Vercel/Beamup; test install + configure flow on desktop and mobile.
9. **Verification** — pick ~10 titles spanning sub/rent/buy and several providers; confirm correct providers, correct monetization filtering, and that links open the right title (and the app on mobile where expected).

---

## 10. Open questions to resolve during build

- Exact JustWatch `package` ids for each NO provider (inspect a live query).
- Whether NRK TV / free-broadcaster content surfaces as `FREE`/`ADS` offers in JustWatch for NO.
- Which providers (if any) have stable enough schemes to justify the step-2 deep-link rewrite vs. relying on `standardWebURL`.
- Stremio version behavior: how reliably the target client follows `externalUrl` into a native app.

---

## Sources

- [Stremio addon SDK — Manifest format](https://stremio.github.io/stremio-addon-sdk/api/responses/manifest.html)
- [Stremio addon SDK — Advanced usage (config / configurable / configurationRequired)](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md)
- [Stremio addon SDK — Stream responses (externalUrl)](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md)
- [Stremio addon SDK — Deep links](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deep-links.md)
- [NORGE-HUB manifest](https://norsk-stream-hub.vercel.app/manifest.json)
- [stremio-watchhub (Guidebox-based predecessor)](https://github.com/macressler/stremio-watchhub)
- [TMDB watch providers / monetization types](https://tmdbapis.kometa.wiki/en/latest/objapi.html)
- [simple-justwatch-python-api (documents JustWatch GraphQL offers / standardWebURL)](https://github.com/Electronic-Mango/simple-justwatch-python-api)
- [JustWatch API documentation](https://apis.justwatch.com/docs/api/)
