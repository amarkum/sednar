#!/usr/bin/env bash
# Run by the sednar-update timer every minute: when origin/main has moved on, runs update.sh. Its output
# goes to the journal: journalctl -u sednar-update
set -euo pipefail
cd "$(dirname "$0")"
exec 9>/tmp/sednar-update.lock
flock -n 9 || exit 0
git -C ../.. fetch -q origin main
[ "$(git -C ../.. rev-parse HEAD)" = "$(git -C ../.. rev-parse origin/main)" ] && exit 0
echo "Deploying $(git -C ../.. log -1 --format='%h %s' origin/main)"
bash update.sh
