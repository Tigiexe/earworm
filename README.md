# Earworm — a Spotify song guessing game

A small Node.js server plus a plain-JavaScript front end (no build step).

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:8000>. `npm run dev` re-reads files on every page load, so edits show up after a refresh.
For Spotify login, copy `.env.example` to `.env` and set `SPOTIFY_CLIENT_ID` (or paste a Client ID in the browser),
and register `http://127.0.0.1:8000/callback` as a Redirect URI in the Spotify dashboard.

`npm run check` runs a few logic tests for the song picker.

To put it online on your own Linux machine, see **[DEPLOY.md](DEPLOY.md)**.

## Layout

| Path | What it is |
|---|---|
| `server/index.js` | Web server: pages, static files, security headers, the `/api` endpoints |
| `server/deezer.js` | Deezer/iTunes proxy with caching and rate limits; finds previews and checks they really play |
| `server/rooms.js` | Multiplayer relay over WebSockets (`/ws`) |
| `server/pages.js` | The HTML layout and the list of pages |
| `server/config.js` | Settings from `.env` |
| `public/assets/js/` | Browser code: `core.js` (login, Spotify API, storage), `library.js` (song sources), `audio.js`, `engine.js` (questions, song picking), `quiz.js`, `settings-ui.js`, `stats-data.js`, one script per page in `pages/` |
| `deploy/` | systemd service, Caddy and nginx configs, install script |

Pages: `/` (login), `/play`, `/game?mode=classic`, `/results`, `/settings`, `/stats`, `/multiplayer`, `/join/ABCDE`, `/callback`.
Old `*.html` addresses redirect to these.

## Where the music comes from

- **Your songs:** Spotify Web API, straight from the browser (PKCE login; tokens stay in the browser).
- **Full songs:** Spotify Web Playback SDK, for Spotify Premium accounts.
- **Previews, charts, similar songs, answer search:** Deezer's public API, through this server (cached). iTunes Search is the backup for previews.
- **Multiplayer:** this server relays messages between players; the host's browser runs the game.

## How songs are picked

- Every source (liked songs, most played, each playlist, each chart, similar songs) can be switched on or off on the Play page — charts only, one playlist only, or any mix.
- **Balance** (Settings → Which songs): *Even* gives each switched-on source the same share of questions; *By number of songs* picks from everything evenly.
- A song never repeats within a game until every song has been used. Songs from your last few games are kept out while there are others (toggle and number of games in Settings). A small song list still works — it just repeats sooner.
- Before a song is used, the server checks its preview file really loads. If a song still fails to play, the game drops it and picks another without using up a round.
