'use strict';

/*
 * JustWatch data module (ISOLATED on purpose).
 *
 * Uses JustWatch's public GraphQL endpoint — the same dataset TMDB licenses,
 * but here we also get the per-offer `standardWebURL` (the title link that
 * hands off to the app on mobile) and `monetizationType`.
 *
 * This endpoint is UNOFFICIAL and undocumented. If the query shape ever breaks,
 * this is the only file that needs repair; callers should treat a thrown error
 * or empty array as "no data" and fall back gracefully.
 */

const ENDPOINT = 'https://apis.justwatch.com/graphql';

const SEARCH_QUERY = `
query GetSearchTitles($filter: TitleFilter, $country: Country!, $language: Language!, $first: Int!) {
  popularTitles(country: $country, filter: $filter, first: $first) {
    edges {
      node {
        id
        objectType
        content(country: $country, language: $language) {
          title
          originalReleaseYear
          externalIds { imdbId }
        }
        offers(country: $country, platform: WEB) {
          monetizationType
          presentationType
          standardWebURL
          retailPrice(language: $language)
          currency
          package { id clearName technicalName }
        }
      }
    }
  }
}`;

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

/**
 * Search JustWatch and return the offers for the best-matching title.
 * @param {object} p
 * @param {string} p.title
 * @param {number} [p.year]
 * @param {'movie'|'series'} p.type
 * @param {string} [p.imdbId]   e.g. "tt0133093" (used for an exact match)
 * @param {string} [p.country]  ISO country, default "NO"
 * @param {string} [p.language] default "nb"
 * @returns {Promise<Array>} raw offers array (possibly empty)
 */
async function searchOffers({ title, year, type, imdbId, country = 'NO', language = 'nb' }) {
  if (!title) return [];
  const objectType = type === 'series' ? 'SHOW' : 'MOVIE';

  const variables = {
    country,
    language,
    first: 10,
    filter: { searchQuery: title, objectTypes: [objectType] },
  };

  const { signal, clear } = withTimeout(8000);
  let json;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // A real-looking UA reduces the chance of being blocked.
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables }),
      signal,
    });
    if (!res.ok) throw new Error(`JustWatch HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clear();
  }

  const edges = json?.data?.popularTitles?.edges || [];
  if (!edges.length) return [];

  const nodes = edges.map((e) => e.node).filter(Boolean);
  const node = pickBestNode(nodes, { imdbId, year });
  return node?.offers || [];
}

function pickBestNode(nodes, { imdbId, year }) {
  // 1. Exact IMDb id match (most reliable).
  if (imdbId) {
    const exact = nodes.find((n) => n.content?.externalIds?.imdbId === imdbId);
    if (exact) return exact;
  }
  // 2. Same release year.
  if (year) {
    const byYear = nodes.find((n) => n.content?.originalReleaseYear === Number(year));
    if (byYear) return byYear;
  }
  // 3. First result.
  return nodes[0];
}

/** Normalise JustWatch presentationType to a short quality label. */
function qualityLabel(presentationType) {
  switch (presentationType) {
    case '_4K':
      return '4K';
    case 'HD':
      return 'HD';
    case 'SD':
      return 'SD';
    default:
      return '';
  }
}

module.exports = { searchOffers, qualityLabel };
