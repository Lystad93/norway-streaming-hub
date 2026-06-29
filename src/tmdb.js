'use strict';

/*
 * TMDB fallback data module.
 *
 * Used when JustWatch is unavailable or returns nothing. TMDB's watch/providers
 * data is also powered by JustWatch, but it only tells you WHICH providers carry
 * a title per bucket (flatrate/rent/buy/free/ads) plus a single per-title
 * JustWatch redirect `link` — there are no per-provider title URLs and no
 * price/quality. So fallback streams all share that one `link`.
 *
 * Output is normalised to the SAME shape as src/justwatch.js offers, so the
 * stream handler treats both sources identically.
 *
 * Auth (via environment / .env):
 *   TMDB_API_TOKEN  — v4 read access token (preferred; sent as Bearer), OR
 *   TMDB_API_KEY    — v3 api key (sent as ?api_key=)
 */

const BASE = 'https://api.themoviedb.org/3';

function isConfigured() {
  return Boolean(process.env.TMDB_API_TOKEN || process.env.TMDB_API_KEY);
}

function authFor(url) {
  const headers = { accept: 'application/json' };
  let finalUrl = url;
  if (process.env.TMDB_API_TOKEN) {
    headers.authorization = `Bearer ${process.env.TMDB_API_TOKEN}`;
  } else if (process.env.TMDB_API_KEY) {
    finalUrl += (url.includes('?') ? '&' : '?') + `api_key=${encodeURIComponent(process.env.TMDB_API_KEY)}`;
  }
  return { finalUrl, headers };
}

async function getJson(url, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const { finalUrl, headers } = authFor(url);
    const res = await fetch(finalUrl, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** IMDb id -> TMDB id for the given type. */
async function findTmdbId(imdbId, type) {
  const json = await getJson(`${BASE}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`);
  const list = type === 'series' ? json?.tv_results : json?.movie_results;
  return list && list.length ? list[0].id : null;
}

const BUCKET_TO_MONETIZATION = {
  flatrate: 'FLATRATE',
  rent: 'RENT',
  buy: 'BUY',
  free: 'FREE',
  ads: 'ADS',
};

/**
 * @returns {Promise<Array>} normalised offers (same shape as justwatch.js), or []
 */
async function searchOffers({ type, imdbId, country = 'NO' }) {
  if (!isConfigured() || !imdbId) return [];
  const tmdbId = await findTmdbId(imdbId, type);
  if (!tmdbId) return [];

  const kind = type === 'series' ? 'tv' : 'movie';
  const json = await getJson(`${BASE}/${kind}/${tmdbId}/watch/providers`);
  const region = json?.results?.[country];
  if (!region) return [];

  const link = region.link || null; // single JustWatch redirect page for this title
  const offers = [];
  for (const [bucket, monetizationType] of Object.entries(BUCKET_TO_MONETIZATION)) {
    const arr = region[bucket];
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      offers.push({
        monetizationType,
        presentationType: null, // TMDB gives no quality
        standardWebURL: link, // no per-provider URL available from TMDB
        retailPrice: null,
        currency: null,
        package: { id: String(p.provider_id), clearName: p.provider_name, technicalName: '' },
      });
    }
  }
  return offers;
}

module.exports = { searchOffers, isConfigured };
