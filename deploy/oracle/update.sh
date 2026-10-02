#!/usr/bin/env bash
# Pulls the latest code and rebuilds and restarts Sednar. Accounts, projects and chats stay in the
# sednar-data volume. Run on the server: bash update.sh
set -euo pipefail
cd "$(dirname "$0")"
# The repository is kept as one commit that is amended, so take origin's version as it is.
git -C ../.. fetch -q origin main
git -C ../.. reset -q --hard origin/main
# The terminal's sandbox needs unprivileged user namespaces (setup.sh sets this; reapplied here in case
# setup.sh was skipped or the setting was lost). sudo -n never prompts, so a timer run cannot hang on it.
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" != "0" ]; then
  echo "kernel.apparmor_restrict_unprivileged_userns=0" | sudo -n tee /etc/sysctl.d/60-sednar-userns.conf >/dev/null \
    && sudo -n sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0 \
    || echo "Could not allow user namespaces; the terminal stays off. Run setup.sh once." >&2
fi
docker compose up -d --build --force-recreate sednar
docker compose up -d
docker image prune -f >/dev/null
docker compose ps
