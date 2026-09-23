# Putting Earworm online from your own Linux machine

The setup: Earworm (Node) runs as a background service on your machine and only listens on `127.0.0.1:8000`.
Something in front of it handles HTTPS and the internet — **Caddy** (simplest when you can open ports on your router)
or **Cloudflare Tunnel** (no router changes, hides your home IP, works behind CGNAT).

Commands below are for Debian/Ubuntu; other distros are similar.

## 1. Install Node.js 20+ system-wide

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

Don't use `nvm` for the server: the service is locked out of home folders and won't find it.

## 2. Install Earworm from GitHub

```bash
sudo apt-get install -y git
git clone https://github.com/<you>/earworm.git ~/earworm
cd ~/earworm
sudo bash deploy/install.sh
```

(Private repo? See *Private repository* below.)

This copies the app to `/opt/earworm`, installs its one dependency, creates a locked-down `earworm` system user and
starts the `earworm` service. `~/earworm` is just the download; the live copy is `/opt/earworm`, and its `.env` is never overwritten.

### Updating

On your PC: commit and `git push`. On the server:

```bash
cd ~/earworm && sudo bash deploy/update.sh
```

That pulls from GitHub and reinstalls. Visitors get the new files right away (file names carry a version, so no stale cache).

### Private repository

The server needs read access. Easiest is a deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/earworm_deploy -N ""
cat ~/.ssh/earworm_deploy.pub
```

On GitHub: repo → **Settings → Deploy keys → Add deploy key**, paste it, leave write access off. Then add to `~/.ssh/config`:

```
Host github.com
  IdentityFile ~/.ssh/earworm_deploy
```

and clone with `git clone git@github.com:<you>/earworm.git ~/earworm`.

## 3. Configure

```bash
sudo nano /opt/earworm/.env
```

Set at least:

```ini
PUBLIC_URL=https://earworm.yourdomain.com
SPOTIFY_CLIENT_ID=0123456789abcdef0123456789abcdef
```

Then `sudo systemctl restart earworm`. Check it with `curl http://127.0.0.1:8000/healthz` (prints `ok`).

## 4. Spotify dashboard

In <https://developer.spotify.com/dashboard> → your app → **Settings**:

- **Redirect URIs:** add `https://earworm.yourdomain.com/callback` (exactly your `PUBLIC_URL` + `/callback`) and click **Save**.
  The old `…/callback.html` address is no longer used.
- **User Management:** add the Spotify email of everyone who will log in. Apps in development mode only accept listed accounts.
  Everyone else can still play the charts and join multiplayer games without logging in.

## 5a. Make it public with Caddy (needs open ports)

1. Point your domain's **A record** at your home's public IP (use your registrar's dynamic DNS, or a DDNS updater, if your IP changes).
2. On your router, forward TCP ports **80** and **443** to this machine.
3. Install Caddy and use the included config:

   ```bash
   sudo apt install -y caddy
   sudo cp /opt/earworm/deploy/Caddyfile /etc/caddy/Caddyfile
   sudo nano /etc/caddy/Caddyfile      # replace earworm.example.com with your domain
   sudo systemctl reload caddy
   ```

Caddy gets the HTTPS certificate by itself. Prefer nginx? Use `deploy/nginx.conf` with `certbot --nginx`.

## 5b. …or with Cloudflare Tunnel (no open ports)

Needs the domain's DNS on Cloudflare (free plan is fine).

```bash
# install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel login
cloudflared tunnel create earworm
cloudflared tunnel route dns earworm earworm.yourdomain.com
```

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: earworm
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: earworm.yourdomain.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

Then `sudo cloudflared service install` and `sudo systemctl start cloudflared`. WebSockets (multiplayer) work through the tunnel.

## 6. Firewall

Only the proxy should be reachable. With `ufw`:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp      # skip this line with Cloudflare Tunnel
sudo ufw enable
```

Port 8000 stays private because Earworm listens on `127.0.0.1` only. Keep it that way: with `PUBLIC_URL` set, the server
trusts the proxy's `X-Forwarded-For` header for rate limiting.

## Day-to-day

| Task | Command |
|---|---|
| Logs | `journalctl -u earworm -f` |
| Restart after editing `.env` | `sudo systemctl restart earworm` |
| Update | `cd ~/earworm && sudo bash deploy/update.sh` |
| Stop | `sudo systemctl stop earworm` |

## What the server does for security

- Strict Content-Security-Policy: scripts only from the site itself and Spotify's player; no inline scripts, no frames of the site elsewhere.
- Deezer and iTunes are reached through the server (whitelisted paths only, cached, rate-limited per visitor) instead of loading their scripts into the page.
- HSTS, `nosniff`, `X-Frame-Options`, a tight `Permissions-Policy`, and a same-origin check on multiplayer connections.
- Multiplayer limits: message size, messages per second, connections per IP, players per room, total rooms. Songs a guest sends are validated before use.
- The service runs as an unprivileged user with a read-only filesystem (systemd hardening in `deploy/earworm.service`).
- Spotify login uses PKCE — no client secret exists anywhere. Tokens live only in each visitor's browser, and logging out also deletes the songs that were read from that account.

## Troubleshooting

| What you see | Fix |
|---|---|
| `redirect_uri: Not matching configuration` | The Redirect URI must be exactly `PUBLIC_URL` + `/callback`. The error page shows the address it used. |
| Login works but “Spotify refused this account” | Add that person's email under **User Management**. |
| Only 30-second previews play | Full songs need the player's own account to have Premium. |
| Multiplayer says it can't reach the server | Your proxy must pass WebSockets (the included Caddy/nginx/tunnel configs do). Check `journalctl -u earworm`. |
| “Slow down a little” | Per-visitor rate limit. Wait a few seconds. |
| Songs from before the update are gone | The song storage changed; add your sources again on the Play page. |
