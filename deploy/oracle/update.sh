#!/usr/bin/env bash
# Pulls the latest code and rebuilds and restarts Sednar. Accounts, projects and chats stay in the
# sednar-data volume. Run on the server: bash update.sh
set -euo pipefail
cd "$(dirname "$0")"
# The repository is kept as one commit that is amended, so take origin's version as it is.
git -C ../.. fetch -q origin main
git -C ../.. reset -q --hard origin/main
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
