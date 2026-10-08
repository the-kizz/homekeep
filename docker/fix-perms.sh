#!/bin/sh
# Runs once as root before PocketBase starts (s6 oneshot `fix-perms`).
#
# PocketBase and Next.js run as `node` (uid 1000). A bind mount such as
# `-v ./data:/app/data` keeps the host directory's owner, so if that is any
# other uid PocketBase cannot create /app/data/pb_data and the app runs
# "degraded" forever with only a log line to explain why. Repair ownership
# when we can; when we cannot, stop the container with a clear remedy
# instead of running half-broken.
set -u

DATA=/app/data
NODE_UID=1000
NODE_GID=1000

fail() {
  echo "[fix-perms] ERROR: $1" >&2
  echo "[fix-perms] HomeKeep needs $DATA writable by uid $NODE_UID (the 'node' user)." >&2
  echo "[fix-perms] Fix it on the host, then start the container again:" >&2
  echo "[fix-perms]   sudo chown -R $NODE_UID:$NODE_GID <your data folder>   (e.g. ./data)" >&2
  echo "[fix-perms] and make sure the volume is not mounted read-only." >&2
  exit 1
}

node_can_write() {
  s6-setuidgid node test -w "$DATA" \
    && { [ ! -e "$DATA/pb_data" ] || s6-setuidgid node test -w "$DATA/pb_data"; }
}

mkdir -p "$DATA" 2>/dev/null || true

# Anything not owned by uid 1000 (the directory itself, pb_data, data.db,
# backups) can break PocketBase later even if the top level is writable.
# `find -quit` stops at the first hit, so a correct volume costs one stat.
if [ -n "$(find "$DATA" ! -user "$NODE_UID" -print -quit 2>/dev/null)" ] || ! node_can_write; then
  if [ "$(id -u)" != "0" ]; then
    node_can_write || fail "$DATA is not writable and the container is not running as root, so it cannot repair ownership."
  elif chown -R "$NODE_UID:$NODE_GID" "$DATA" 2>/dev/null; then
    echo "[fix-perms] chowned $DATA to node (uid $NODE_UID)"
  else
    fail "could not chown $DATA (read-only mount, or a filesystem that refuses chown such as some NFS/SMB shares)."
  fi
fi

node_can_write || fail "$DATA is still not writable by uid $NODE_UID after repair."

s6-setuidgid node mkdir -p "$DATA/pb_data" || fail "could not create $DATA/pb_data."
exit 0
