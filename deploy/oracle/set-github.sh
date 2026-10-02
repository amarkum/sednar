#!/usr/bin/env bash
# Turns on "Continue with GitHub": saves the OAuth app's client ID and secret in .env and restarts Sednar.
# The secret is typed here, on the server, so it is not shown on screen or kept anywhere else.
# Run on the server: bash set-github.sh
set -euo pipefail
cd "$(dirname "$0")"
read -rp "GitHub OAuth app client ID: " client_id
read -rsp "GitHub OAuth app client secret (not shown): " client_secret
echo
if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
  echo "Both the client ID and the secret are needed." >&2
  exit 1
fi
touch .env
grep -v -e '^SEDNAR_GITHUB_CLIENT_ID=' -e '^SEDNAR_GITHUB_CLIENT_SECRET=' .env > .env.tmp || true
printf 'SEDNAR_GITHUB_CLIENT_ID=%s\nSEDNAR_GITHUB_CLIENT_SECRET=%s\n' "$client_id" "$client_secret" >> .env.tmp
chmod 600 .env.tmp
mv .env.tmp .env
docker compose up -d
echo "Saved. \"Continue with GitHub\" is on."
