#!/usr/bin/env bash
# On the server: get the latest version from GitHub and reinstall it.
# Run from the cloned folder:  sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OWNER="$(stat -c %U .)"
# pull as the folder's owner, so root never owns files in the clone
sudo -u "$OWNER" git pull --ff-only
exec bash deploy/install.sh
