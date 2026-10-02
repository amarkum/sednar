#!/usr/bin/env bash
# One-time setup of an Ubuntu server for Sednar: the firewall ports for HTTP and HTTPS, Docker, and the
# .env file. Run it on the server from this folder, as the default user: bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"

sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git iptables-persistent

# Oracle's Ubuntu images let in only SSH; open HTTP and HTTPS ahead of the image's REJECT rule. This is
# saved before Docker is installed, so Docker's own rules (it adds them at every start) are not saved too.
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
  sudo iptables -C INPUT $rule -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 $rule -j ACCEPT
done
sudo netfilter-persistent save

sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"

# The terminal's sandbox (bubblewrap, in the container) needs user namespaces, which Ubuntu 24.04 limits
# to programs with an AppArmor profile that allows them.
echo "kernel.apparmor_restrict_unprivileged_userns=0" | sudo tee /etc/sysctl.d/60-sednar-userns.conf >/dev/null
sudo sysctl --system >/dev/null

if [ ! -f .env ]; then
  sed "s/^SEDNAR_SECRET_KEY=.*/SEDNAR_SECRET_KEY=$(openssl rand -hex 32)/" .env.example > .env
  chmod 600 .env
fi
echo "Setup done. Log out and back in once (for the docker group), then: bash update.sh"
