'use strict';

const { PROVIDERS } = require('./providers');

// One checkbox per provider so users can tick the services they have.
const providerConfig = PROVIDERS.map((p) => ({
  key: `p_${p.key}`,
  type: 'checkbox',
  title: p.name,
  default: 'checked', // shown by default; user unticks services they lack
}));

// Monetization (offer type) toggles.
const monetizationConfig = [
  { key: 'm_flatrate', type: 'checkbox', title: 'Subscription (streaming)', default: 'checked' },
  { key: 'm_rent', type: 'checkbox', title: 'Rent', default: '' },
  { key: 'm_buy', type: 'checkbox', title: 'Buy', default: '' },
  { key: 'm_free', type: 'checkbox', title: 'Free / ad-supported', default: '' },
];

const manifest = {
  id: 'com.streaminghub.norway',
  version: '1.0.0',
  name: 'Norway Streaming Hub',
  description:
    'Pick your Norwegian streaming services and choose subscription, rent or buy. ' +
    'Shows where each movie or series is available and links out to the provider (best-effort app deep links).',
  logo: 'https://www.stremio.com/website/stremio-logo-small.png',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'], // IMDb ids, as supplied by Cinemeta
  catalogs: [],
  behaviorHints: {
    configurable: true,
    configurationRequired: true, // results are meaningless until services are chosen
  },
  config: [
    {
      key: 'country',
      type: 'select',
      title: 'Country',
      options: ['NO'],
      default: 'NO',
    },
    ...providerConfig,
    ...monetizationConfig,
  ],
};

module.exports = manifest;
