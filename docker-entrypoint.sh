#!/bin/sh
# Starts the Sednar public demo. Everything that must survive a restart (accounts, user folders, chats)
# is under /data, so a host's persistent disk mounted there keeps it. Disks are often mounted as root:
# this makes /data writable for the sednar user, then runs the server as that user.
set -e
mkdir -p "$HOME" "$SEDNAR_PUBLIC_ROOT"
if [ "$(id -u)" = "0" ]; then
  chown sednar:sednar /data "$HOME" "$SEDNAR_PUBLIC_ROOT"
  exec setpriv --reuid=sednar --regid=sednar --init-groups "$@"
fi
exec "$@"
