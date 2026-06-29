'use strict';

const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest');
const { PROVIDERS, BY_KEY, matchProvider } = require('./providers');
const { searchOffers, qualityLabel } = require('./justwatch');
const tmdb = require('./tmdb');
const { resolveTitle } = require('./meta');
const { resolveLink } = require('./deeplinks');

const builder = new addonBuilder(manifest);

// ---- config helpers --------------------------------------------------------

const TRUTHY = new Set([true, 'true', 'on', 'checked', '1', 'yes']);
const truthy = (v) => TRUTHY.has(v);

// Map a JustWatch monetizationType to one of our display buckets.
function bucketOf(monetizationType) {
  switch (monetizationType) {
    case 'FLATRATE':
    case 'FLATRATE_AND_BUY':
      return 'flatrate';
    case 'RENT':
      return 'rent';
    case 'BUY':
      return 'buy';
    case 'FREE':
    case 'ADS':
      return 'free';
    default:
      return null; // e.g. CINEMA — ignored
  }
}

const BUCKET_LABEL = { flatrate: 'Subscription', rent: 'Rent', buy: 'Buy', free: 'Free' };
const QUALITY_RANK = { '4K': 3, HD: 2, SD: 1, '': 0 };

// Read enabled providers/buckets from the per-user config.
function readConfig(config = {}) {
  const enabledProviders = new Set(
    PROVIDERS.filter((p) => truthy(config[`p_${p.key}`])).map((p) => p.key)
  );
  // If the user somehow enabled none, fall back to all known providers.
  if (enabledProviders.size === 0) PROVIDERS.forEach((p) => enabledProviders.add(p.key));

  const buckets = new Set();
  if (truthy(config.m_flatrate)) buckets.add('flatrate');
  if (truthy(config.m_rent)) buckets.add('rent');
  if (truthy(config.m_buy)) buckets.add('buy');
  if (truthy(config.m_free)) buckets.add('free');
  if (buckets.size === 0) buckets.add('flatrate'); // sensible default

  const country = config.country || 'NO';
  return { enabledProviders, buckets, country };
}

// Fetch offers from JustWatch (primary); fall back to TMDB on error/empty.
async function getOffers({ type, id, imdbId, country }) {
  // Primary: JustWatch needs a title, so resolve via Cinemeta first.
  try {
    const meta = await resolveTitle(type, id);
    if (meta) {
      const offers = await searchOffers({
        title: meta.title,
        year: meta.year,
        type,
        imdbId: meta.imdbId,
        country,
      });
      if (offers.length) return offers;
    }
  } catch (err) {
    console.error('[justwatch]', err.message);
  }

  // Fallback: TMDB works straight from the IMDb id (no Cinemeta needed).
  if (tmdb.isConfigured()) {
    try {
      const offers = await tmdb.searchOffers({ type, imdbId, country });
      if (offers.length) {
        console.error('[fallback] served from TMDB for', imdbId);
        return offers;
      }
    } catch (err) {
      console.error('[tmdb]', err.message);
    }
  }
  return [];
}

// ---- stream handler --------------------------------------------------------

builder.defineStreamHandler(async ({ type, id, config }) => {
  try {
    const { enabledProviders, buckets, country } = readConfig(config);

    const imdbId = String(id).split(':')[0];
    const offers = await getOffers({ type, id, imdbId, country });
    if (!offers.length) return { streams: [] };

    // Collapse to the best offer per (provider, bucket).
    const best = new Map();
    for (const offer of offers) {
      const provider = matchProvider(offer.package || {});
      if (!provider || !enabledProviders.has(provider.key)) continue;

      const bucket = bucketOf(offer.monetizationType);
      if (!bucket || !buckets.has(bucket)) continue;

      const quality = qualityLabel(offer.presentationType);
      const key = `${provider.key}|${bucket}`;
      const prev = best.get(key);

      const candidate = { provider, bucket, quality, offer };
      if (!prev || isBetter(candidate, prev)) best.set(key, candidate);
    }

    const streams = [...best.values()]
      .sort(sortStreams)
      .map(({ provider, bucket, quality, offer }) => {
        const parts = [BUCKET_LABEL[bucket]];
        if (quality) parts.push(quality);
        if ((bucket === 'rent' || bucket === 'buy') && offer.retailPrice) {
          parts.push(`${offer.retailPrice} ${offer.currency || ''}`.trim());
        }
        return {
          name: `🇳🇴 ${provider.name}`,
          description: parts.join(' · '),
          externalUrl: resolveLink(provider, offer.standardWebURL),
          behaviorHints: { notWebReady: true },
        };
      });

    return { streams };
  } catch (err) {
    console.error('[stream handler]', err.message);
    return { streams: [] }; // never break Stremio on our error
  }
});

// Prefer higher quality; for paid tiers prefer the cheaper offer.
function isBetter(a, b) {
  if (a.bucket === 'rent' || a.bucket === 'buy') {
    const pa = a.offer.retailPrice ?? Infinity;
    const pb = b.offer.retailPrice ?? Infinity;
    if (pa !== pb) return pa < pb;
  }
  return (QUALITY_RANK[a.quality] || 0) > (QUALITY_RANK[b.quality] || 0);
}

// Display order: subscription first, then free, rent, buy; provider name within.
const BUCKET_ORDER = { flatrate: 0, free: 1, rent: 2, buy: 3 };
function sortStreams(a, b) {
  const bo = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
  if (bo !== 0) return bo;
  return a.provider.name.localeCompare(b.provider.name);
}

module.exports = builder.getInterface();
