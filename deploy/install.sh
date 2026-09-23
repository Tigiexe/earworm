#!/usr/bin/env bash
# Installs or updates Earworm in /opt/earworm and runs it as a systemd service.
# Run from the project folder:  sudo bash deploy/install.sh
set -euo pipefail
APP_DIR=/opt/earworm
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
command -v node >/dev/null || { echo "Node.js is missing. Install Node 20 or newer first (see DEPLOY.md)."; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node $NODE_MAJOR is too old; Earworm needs Node 20 or newer."; exit 1; }

id earworm >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin earworm
mkdir -p "$APP_DIR"
# copy the app, but never overwrite the live .env
tar -C "$SRC_DIR" --exclude=node_modules --exclude=.env --exclude=.git -cf - . | tar -C "$APP_DIR" -xf -
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund
if [ ! -f .env ]; then cp .env.example .env; echo ">>> Created $APP_DIR/.env — edit it (PUBLIC_URL, SPOTIFY_CLIENT_ID), then run: sudo systemctl restart earworm"; fi
chown -R root:earworm "$APP_DIR"; chmod -R go-w "$APP_DIR"; chmod 640 .env

# systemd needs the real node path; the service cannot see /home or /root, so node must live elsewhere
NODE_BIN="$(readlink -f "$(command -v node)")"
case "$NODE_BIN" in /home/*|/root/*) echo "Node is installed under $NODE_BIN (nvm?). The service can't read home folders — install Node system-wide (see DEPLOY.md)."; exit 1;; esac
sed "s#ExecStart=/usr/bin/env node#ExecStart=$NODE_BIN#" deploy/earworm.service > /etc/systemd/system/earworm.service
systemctl daemon-reload
systemctl enable earworm >/dev/null
systemctl restart earworm
sleep 1
systemctl --no-pager --lines=5 status earworm || true
echo "Earworm is running on $(grep -E '^(HOST|PORT)=' .env | tr '\n' ' ')— now point Caddy/nginx or Cloudflare Tunnel at it."
