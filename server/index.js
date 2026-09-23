'use strict';
/* Earworm web server: pages, static files, the music-data API and the multiplayer relay. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const cfg = require('./config');
const { Buckets, log } = require('./util');
const music = require('./deezer');
const { PAGES, render } = require('./pages');

/* ---------------- static files (kept in memory, pre-compressed) ---------------- */
const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json'
};
function entry(body, type) {
  const hash = crypto.createHash('sha256').update(body).digest('base64url').slice(0, 12);
  const squeeze = /text|javascript|json|svg|manifest/.test(type) && body.length > 800;
  return {
    body, type, hash, etag: `"${hash}"`,
    gz: squeeze ? zlib.gzipSync(body, { level: 9 }) : null,
    br: squeeze ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }) : null
  };
}
function loadFiles() {
  const out = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set('/' + path.relative(cfg.PUBLIC_DIR, p).split(path.sep).join('/'), entry(fs.readFileSync(p), TYPES[path.extname(p)] || 'application/octet-stream'));
    }
  })(cfg.PUBLIC_DIR);
  return out;
}
let files, pages;
function build() {
  files = loadFiles();
  const asset = p => files.has(p) ? `${p}?v=${files.get(p).hash}` : p;
  pages = new Map(Object.entries(PAGES).map(([route, page]) => [route, entry(Buffer.from(render(page, asset)), TYPES['.html'])]));
}
build();

/* ---------------- request helpers ---------------- */
/* judge each request by how it actually arrived: a visit straight to http://<lan-ip>:port must not be told to upgrade to https */
const isHttps = req => !!req.socket.encrypted || (cfg.trustProxy && /^https/i.test(String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()));
function clientIp(req) {
  if (cfg.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress || '?';
}
function allowedOrigin(req) {
  const origin = req.headers.origin; if (!origin) return false;
  if (cfg.publicUrl && origin === cfg.publicUrl) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function baseHeaders(req) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}
function csp(req) {
  const secure = isHttps(req);
  const host = String(req.headers.host || (cfg.publicUrl && new URL(cfg.publicUrl).host) || '').replace(/[^\w.:[\]-]/g, '');
  return [
    "default-src 'self'",
    "script-src 'self' https://sdk.scdn.co",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    `connect-src 'self' ${secure ? 'wss' : 'ws'}://${host} https://api.spotify.com https://accounts.spotify.com https://*.spotify.com`,
    'frame-src https://sdk.scdn.co https://*.spotify.com',
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
    ...(secure ? ['upgrade-insecure-requests'] : [])
  ].join('; ');
}

function sendEntry(req, res, e, headers) {
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, { ...headers, ETag: e.etag }); return res.end(); }
  const ae = String(req.headers['accept-encoding'] || '');
  let body = e.body, enc = null;
  if (e.br && /\bbr\b/.test(ae)) { body = e.br; enc = 'br'; } else if (e.gz && /\bgzip\b/.test(ae)) { body = e.gz; enc = 'gzip'; }
  res.writeHead(200, { ...headers, 'Content-Type': e.type, 'Content-Length': body.length, ETag: e.etag, Vary: 'Accept-Encoding', ...(enc ? { 'Content-Encoding': enc } : {}) });
  res.end(req.method === 'HEAD' ? undefined : body);
}
function sendJSON(req, res, status, obj, extra = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { ...baseHeaders(req), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...extra });
  res.end(req.method === 'HEAD' ? undefined : body);
}
function sendText(req, res, status, text, extra = {}) {
  res.writeHead(status, { ...baseHeaders(req), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}
function redirect(req, res, to, code = 301) { res.writeHead(code, { ...baseHeaders(req), Location: to, 'Cache-Control': code === 301 ? 'public, max-age=3600' : 'no-store' }); res.end(); }

/* ---------------- API ---------------- */
const apiRate = new Buckets(90, 15);      // per IP: autocomplete, similar-song builds, charts
const previewRate = new Buckets(60, 5);   // per IP: preview lookups (each can mean several upstream calls)

async function api(req, res, url) {
  const ip = clientIp(req);
  const p = url.pathname;
  try {
    if (p === '/api/preview') {
      if (!previewRate.take(ip)) return sendJSON(req, res, 429, { error: 'Slow down a little.' }, { 'Retry-After': '2' });
      const q = url.searchParams, dz = q.get('dz'), isrc = q.get('isrc');
      const args = {
        dz: /^\d{1,15}$/.test(dz || '') ? dz : null,
        isrc: /^[A-Za-z0-9]{12}$/.test(isrc || '') ? isrc.toUpperCase() : null,
        title: (q.get('t') || '').slice(0, 200), artist: (q.get('a') || '').slice(0, 200)
      };
      if (!args.dz && !args.isrc && !args.title) return sendJSON(req, res, 400, { error: 'Nothing to look up.' });
      const r = await music.preview(args);
      return r ? sendJSON(req, res, 200, r, { 'Cache-Control': 'private, max-age=300' }) : sendJSON(req, res, 404, { error: 'No preview for this song.' }, { 'Cache-Control': 'private, max-age=600' });
    }
    if (!apiRate.take(ip)) return sendJSON(req, res, 429, { error: 'Slow down a little.' }, { 'Retry-After': '2' });
    if (p === '/api/chart') {
      const j = await music.chart({ country: url.searchParams.get('country'), genre: url.searchParams.get('genre') });
      return sendJSON(req, res, 200, j, { 'Cache-Control': 'private, max-age=120' });
    }
    if (p.startsWith('/api/dz/')) {
      const j = await music.proxy(decodeURIComponent(p.slice(8)), url.searchParams);
      return sendJSON(req, res, 200, j, { 'Cache-Control': 'private, max-age=300' });
    }
    return sendJSON(req, res, 404, { error: 'Not found' });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status >= 500) log('api error', p, e.message);
    return sendJSON(req, res, status, { error: status === 500 ? 'Server error' : e.message });
  }
}

/* ---------------- routes ---------------- */
function configJS() {
  const c = { CLIENT_ID: cfg.clientId, ALLOW_CLIENT_ID_SETUP: cfg.allowClientIdSetup, DEFAULT_CHART: cfg.defaultChart };
  return Buffer.from(`window.EARWORM_CONFIG=${JSON.stringify(c)};\n`);
}
const LEGACY = { '/index.html': '/', '/play.html': '/play', '/game.html': '/game', '/results.html': '/results', '/settings.html': '/settings', '/stats.html': '/stats', '/multiplayer.html': '/multiplayer', '/callback.html': '/callback' };
const NOT_FOUND = Buffer.from('<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Not found — Earworm</title><body style="background:#170f2e;color:#fbeee0;font:18px system-ui;display:grid;place-items:center;min-height:90vh;margin:0"><div style="text-align:center"><h1>Nothing here</h1><p><a style="color:#ffb547" href="/">Back to Earworm</a></p></div>');

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return sendText(req, res, 400, 'Bad request'); }
  let p = url.pathname;
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
  if (cfg.dev && (pages.has(p) || p.startsWith('/assets/'))) build();

  if (p.startsWith('/api/')) return api(req, res, url);
  if (p === '/healthz') return sendText(req, res, 200, 'ok');
  if (p === '/config.js') {
    const body = configJS();
    res.writeHead(200, { ...baseHeaders(req), 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (LEGACY[p]) return redirect(req, res, LEGACY[p] + url.search);
  const join = p.match(/^\/join\/([A-Za-z]{5})$/);
  if (join) return redirect(req, res, '/multiplayer?join=' + join[1].toUpperCase(), 302);

  const page = pages.get(p);
  if (page) return sendEntry(req, res, page, { ...baseHeaders(req), 'Content-Security-Policy': csp(req), 'Cache-Control': 'no-cache' });

  const f = files.get(p);
  if (f) {
    const v = url.searchParams.get('v');
    const cache = v && v === f.hash ? 'public, max-age=31536000, immutable' : 'public, max-age=600';
    return sendEntry(req, res, f, { ...baseHeaders(req), 'Cache-Control': cache });
  }
  res.writeHead(404, { ...baseHeaders(req), 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : NOT_FOUND);
}

/* ---------------- start ---------------- */
const server = http.createServer((req, res) => {
  handle(req, res).catch(e => { log('request failed', req.url, e); if (!res.headersSent) sendText(req, res, 500, 'Server error'); else res.destroy(); });
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000;

let relay = null;
try { relay = require('./rooms').attach(server, cfg, { allowedOrigin, clientIp }); }
catch (e) { log('Multiplayer is off: run "npm install" to add the ws package.', e.code || e.message); }

server.listen(cfg.port, cfg.host, () => {
  const local = `http://${cfg.host.includes(':') ? `[${cfg.host}]` : cfg.host}:${cfg.port}`;
  log(`Earworm listening on ${local}${cfg.publicUrl ? ` (public address ${cfg.publicUrl})` : ''}${cfg.dev ? ' [dev mode]' : ''}`);
  log(cfg.clientId ? 'Spotify Client ID is set.' : 'No SPOTIFY_CLIENT_ID set — visitors will be asked to paste one.');
  log(`Spotify Redirect URI to register: ${cfg.publicUrl || local.replace('localhost', '127.0.0.1')}/callback`);
});

function shutdown(sig) {
  log(`${sig} received, shutting down`);
  relay?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
