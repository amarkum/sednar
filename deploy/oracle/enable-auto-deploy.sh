#!/usr/bin/env bash
# Deploys every push to main on its own: a systemd timer checks GitHub every minute and runs update.sh
# when there is something new. It uses the server's read-only deploy key, so GitHub needs no secrets.
# Run once on the server from this folder: bash enable-auto-deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
dir=$(pwd)
sudo tee /etc/systemd/system/sednar-update.service >/dev/null <<UNIT
[Unit]
Description=Deploy Sednar when main has new commits
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=$USER
Group=docker
ExecStart=/usr/bin/bash $dir/auto-update.sh
TimeoutStartSec=30min
UNIT
sudo tee /etc/systemd/system/sednar-update.timer >/dev/null <<UNIT
[Unit]
Description=Check for new Sednar commits every minute

[Timer]
OnBootSec=2min
OnUnitInactiveSec=1min

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now sednar-update.timer
systemctl list-timers sednar-update.timer --no-pager
echo "Auto-deploy is on. Watch it with: journalctl -u sednar-update -f"
