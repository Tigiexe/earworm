'use strict';
/* HTML pages: one shared layout, one entry per page. */

const GAME_HUD = `
  <div class="hud">
    <div class="hud-l"><span id="hudRound"></span><span id="hudExtra"></span></div>
    <div class="hud-score num"><span id="hudScore">0</span><small id="hudStreak"></small></div>
    <button class="btn ghost sm" data-act="quit">Quit</button>
  </div>
  <div class="game-wrap" id="gameWrap">
    <div><div id="qArea" class="q-area"></div><div id="revealBox"></div></div>
    <aside id="mpBoard" class="mp-board panel hidden"></aside>
  </div>`;

const FULL = ['core', 'library', 'audio', 'engine', 'stats-data', 'quiz', 'settings-ui'];
const LOADING = '<div class="loading">Loading…</div>';

const PAGES = {
  '/':            { title: 'Guess the song — Earworm', js: ['core', 'pages/index'], body: '' },
  '/callback':    { title: 'Logging in — Earworm', js: ['core', 'pages/callback'], body: '<div class="loading">Finishing Spotify login…</div>', noindex: true },
  '/play':        { title: 'Play — Earworm', js: [...FULL, 'pages/play'], body: LOADING },
  '/game':        { title: 'Game — Earworm', js: [...FULL, 'pages/game'], body: GAME_HUD.replace('class="hud"', 'class="hud hidden"'), noindex: true },
  '/results':     { title: 'Results — Earworm', js: [...FULL, 'pages/results'], body: LOADING, noindex: true },
  '/settings':    { title: 'Settings — Earworm', js: [...FULL, 'pages/settings'], body: LOADING },
  '/stats':       { title: 'Your stats — Earworm', js: [...FULL, 'pages/stats'], body: LOADING },
  '/multiplayer': { title: 'Play with friends — Earworm', js: [...FULL, 'pages/multiplayer'],
    body: `<section id="scr-mp" class="screen active">${LOADING}</section><section id="scr-game" class="screen">${GAME_HUD}</section><section id="scr-results" class="screen"></section>` }
};

function render(page, asset) {
  const scripts = ['/config.js', ...page.js.map(n => asset(`/assets/js/${n}.js`))];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${page.title}</title>
<meta name="description" content="Earworm: a song guessing game built on your Spotify library and the charts.">
<meta name="theme-color" content="#170f2e">
${page.noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="icon" href="${asset('/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${asset('/assets/css/style.css')}">
</head>
<body>
<header class="top" id="hdr"></header>
<main id="main">${page.body}</main>
<div id="toasts" aria-live="polite"></div>
${scripts.map(s => `<script src="${s}" defer></script>`).join('\n')}
</body>
</html>
`;
}

module.exports = { PAGES, render };
