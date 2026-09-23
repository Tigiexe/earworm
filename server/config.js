'use strict';
/* Reads settings from environment variables, plus an optional .env file next to package.json. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadDotEnv(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const env = (k, d = '') => (process.env[k] ?? d).trim();
const bool = (k, d) => { const v = env(k).toLowerCase(); return v ? ['1', 'true', 'yes', 'on'].includes(v) : d; };
const int = (k, d) => { const n = parseInt(env(k), 10); return Number.isFinite(n) ? n : d; };

const publicUrl = env('PUBLIC_URL').replace(/\/+$/, '');
const clientId = env('SPOTIFY_CLIENT_ID');
if (clientId && !/^[0-9a-f]{32}$/i.test(clientId)) {
  console.error('SPOTIFY_CLIENT_ID must be the 32-character Client ID from the Spotify dashboard.');
  process.exit(1);
}
if (publicUrl && !/^https?:\/\/[^/]+$/.test(publicUrl)) {
  console.error('PUBLIC_URL must look like https://earworm.example.com (no path, no trailing slash).');
  process.exit(1);
}

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  dev: process.argv.includes('--dev') || env('NODE_ENV') === 'development',
  host: env('HOST', '127.0.0.1'),
  port: int('PORT', 8000),
  publicUrl,                                   // e.g. https://earworm.example.com
  trustProxy: bool('TRUST_PROXY', !!publicUrl),  // read X-Forwarded-* from the reverse proxy
  clientId,
  // with no Client ID configured, visitors may paste their own (handy for testing)
  allowClientIdSetup: bool('ALLOW_CLIENT_ID_SETUP', !clientId),
  defaultChart: env('DEFAULT_CHART', 'Worldwide'),
  maxRooms: int('MAX_ROOMS', 200),
  maxPlayers: int('MAX_PLAYERS', 16)
};
