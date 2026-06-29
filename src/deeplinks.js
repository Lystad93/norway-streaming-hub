'use strict';

/*
 * Best-effort "open the app" layer.
 *
 * The JustWatch `standardWebURL` is a web link to the exact title on the
 * provider. On mobile it usually hands off to the installed app via universal
 * links; on desktop it opens in the browser. That is the reliable baseline.
 *
 * Where a provider has a known, tested way to push harder toward the native
 * app, give it a `deeplink(webUrl)` function in providers.js. We call it here
 * and fall back to the web URL if it returns nothing or throws.
 */

/**
 * @param {object} provider  entry from providers.js (may be null)
 * @param {string} webUrl    offer.standardWebURL
 * @returns {string} the URL to put in stream.externalUrl
 */
function resolveLink(provider, webUrl) {
  if (provider && typeof provider.deeplink === 'function') {
    try {
      const deep = provider.deeplink(webUrl);
      if (deep) return deep;
    } catch (_) {
      /* fall through to web URL */
    }
  }
  return webUrl;
}

module.exports = { resolveLink };
