'use strict';

require('dotenv').config(); // load .env (TMDB key, PORT) for local runs

const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./src/addon');

const port = Number(process.env.PORT) || 7000;

serveHTTP(addonInterface, { port });

console.log(`Norway Streaming Hub running.`);
console.log(`  Install / configure:  http://127.0.0.1:${port}/configure`);
console.log(`  Manifest:             http://127.0.0.1:${port}/manifest.json`);
