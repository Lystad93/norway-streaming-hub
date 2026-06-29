'use strict';

/*
 * Resolves a Stremio IMDb id into { title, year, imdbId } using Cinemeta —
 * the metadata addon present in every Stremio install (no API key needed).
 * Results are cached in memory with a TTL to keep latency and request volume low.
 */

const CINEMETA = 'https://v3-cinemeta.strem.io/meta';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const cache = new Map(); // key -> { value, expires }

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) cache.delete(key);
  return undefined;
}

function cacheSet(key, value) {
  cache.set(key, { value, expires: Date.now() + TTL_MS });
}

/**
 * @param {'movie'|'series'} type
 * @param {string} fullId  Stremio id, e.g. "tt0133093" or "tt0944947:1:2"
 * @returns {Promise<{title:string, year:number|undefined, imdbId:string}|null>}
 */
async function resolveTitle(type, fullId) {
  const imdbId = String(fullId).split(':')[0]; // drop season:episode for series
  const key = `${type}:${imdbId}`;

  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${CINEMETA}/${type}/${imdbId}.json`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Cinemeta HTTP ${res.status}`);
    const json = await res.json();
    const meta = json?.meta;
    if (!meta?.name) {
      cacheSet(key, null);
      return null;
    }
    const value = {
      title: meta.name,
      year: parseYear(meta.year || meta.releaseInfo),
      imdbId,
    };
    cacheSet(key, value);
    return value;
  } catch (err) {
    // Don't cache transient failures.
    return null;
  } finally {
    clearTimeout(t);
  }
}

function parseYear(raw) {
  if (!raw) return undefined;
  const m = String(raw).match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
}

module.exports = { resolveTitle };
