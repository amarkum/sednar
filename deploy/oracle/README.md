# Sednar on Oracle Cloud (or any Ubuntu server)

The app and Caddy run with Docker Compose. Caddy gets the HTTPS certificate for sednar.com, and all
state (accounts, projects, chats) lives in the `sednar-data` volume.

1. Create an Ubuntu 24.04 VM (Oracle Always Free: `VM.Standard.A1.Flex`, 2 OCPUs, 12 GB) with a public IP.
   When the console says "Out of capacity", run `oci-launch.sh` in Oracle Cloud Shell (with the SSH public key in
   `~/sednar.pub`): it creates the network and retries every minute until Oracle has a free server.
2. In its subnet's security list, allow TCP 80 and 443 (and UDP 443) from `0.0.0.0/0`.
3. Point `sednar.com` (A record) at the VM's IP and `www` (CNAME) at `sednar.com`.
4. On the VM: clone the repository, then run `bash deploy/oracle/setup.sh`, log out and in, and run
   `bash deploy/oracle/update.sh`.
5. For "Continue with GitHub", run `bash deploy/oracle/set-github.sh` on the VM and paste the OAuth app's
   client ID and secret (callback URL `https://sednar.com/auth/github/callback`).
6. For deploys on every push to `main`, run `bash deploy/oracle/enable-auto-deploy.sh` once. A systemd timer
   checks GitHub every minute and runs `update.sh` when `main` has moved; it uses the VM's read-only deploy
   key, so GitHub needs no secrets. Watch it with `journalctl -u sednar-update -f`.

`update.sh` deploys a new version by hand: it pulls, rebuilds and restarts.
