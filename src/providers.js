'use strict';

/*
 * Norwegian streaming provider registry.
 *
 * Each entry maps a stable internal `key` (used in the addon config) to:
 *   - name:      display name shown in Stremio
 *   - match:     lowercase substrings to match against JustWatch package
 *                technicalName / clearName (JustWatch naming is inconsistent,
 *                so we match loosely and confirm against a live NO query).
 *   - deeplink:  OPTIONAL best-effort rewrite of the JustWatch standardWebURL
 *                into something more likely to open the native app. Return a
 *                string, or null/undefined to keep the original web URL.
 *
 * To add a provider: add one row. Confirm `match` values by inspecting a live
 * NO offers response (see scripts note in README).
 */

const PROVIDERS = [
  {
    key: 'netflix',
    name: 'Netflix',
    match: ['netflix'],
    // Netflix web URLs (netflix.com/title/<id> or /watch/<id>) hand off to the
    // app via universal links on mobile; no reliable custom scheme per title.
    deeplink: null,
  },
  {
    key: 'viaplay',
    name: 'Viaplay',
    match: ['viaplay'],
    deeplink: null,
  },
  {
    key: 'max',
    name: 'Max',
    match: ['max', 'hbo'],
    deeplink: null,
  },
  {
    key: 'disneyplus',
    name: 'Disney+',
    match: ['disney'],
    deeplink: null,
  },
  {
    key: 'primevideo',
    name: 'Prime Video',
    match: ['amazonprime', 'amazon prime', 'prime video', 'amazon'],
    deeplink: null,
  },
  {
    key: 'skyshowtime',
    name: 'SkyShowtime',
    match: ['skyshowtime', 'sky showtime'],
    deeplink: null,
  },
  {
    key: 'tv2play',
    name: 'TV 2 Play',
    match: ['tv2play', 'tv 2 play', 'tv2 play', 'tv 2', 'tv2'],
    deeplink: null,
  },
  {
    key: 'nrktv',
    name: 'NRK TV',
    match: ['nrk'],
    deeplink: null,
  },
  {
    key: 'appletv',
    name: 'Apple TV',
    match: ['apple tv', 'appletv', 'itunes'],
    deeplink: null,
  },
  {
    key: 'strim',
    name: 'Strim',
    match: ['strim'],
    deeplink: null,
  },
  {
    key: 'rakuten',
    name: 'Rakuten TV',
    match: ['rakuten'],
    deeplink: null,
  },
];

// key -> provider, for quick lookup
const BY_KEY = Object.fromEntries(PROVIDERS.map((p) => [p.key, p]));

/**
 * Resolve a JustWatch package to one of our known providers.
 * @param {{clearName?: string, technicalName?: string}} pkg
 * @returns {object|null} provider entry or null if not in our registry
 */
function matchProvider(pkg) {
  const hay = `${pkg.clearName || ''} ${pkg.technicalName || ''}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const p of PROVIDERS) {
    if (p.match.some((m) => hay.includes(m))) return p;
  }
  return null;
}

module.exports = { PROVIDERS, BY_KEY, matchProvider };
