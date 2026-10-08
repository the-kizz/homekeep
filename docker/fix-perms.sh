#!/bin/sh
# Runs once as root before PocketBase starts (s6 oneshot `fix-perms`).
#
# PocketBase and Next.js run as `node` (uid 1000). A bind mount such as
# `-v ./data:/app/data` keeps the host directory's owner, so if that is any
# other uid PocketBase cannot create /app/data/pb_data and the app runs
# "degraded" forever with only a log line to explain why. Repair ownership
# when we can. If chown is refused (root-squashed NFS/SMB) but node can
# still write, carry on with a warning: such mounts worked before this
# check existed. Only when node truly cannot write, stop the container
# with a clear remedy instead of running half-broken.
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

# A real write, not `test -w`: on network filesystems the permission bits
# the client sees need not match what the server will allow.
can_write_dir() {
  s6-setuidgid node sh -c 'f="$1/.hk-write-test.$$" && touch "$f" && rm -f "$f"' sh "$1" 2>/dev/null
}

node_can_write() {
  can_write_dir "$DATA" \
    && { [ ! -e "$DATA/pb_data" ] || can_write_dir "$DATA/pb_data"; }
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
  elif node_can_write; then
    echo "[fix-perms] WARN: could not chown $DATA, but node (uid $NODE_UID) can write to it; continuing." >&2
    echo "[fix-perms] WARN: files owned by other users inside it may still cause trouble later." >&2
  else
    fail "could not chown $DATA (read-only mount, or a filesystem that refuses chown such as some NFS/SMB shares)."
  fi
fi

node_can_write || fail "$DATA is still not writable by uid $NODE_UID after repair."

s6-setuidgid node mkdir -p "$DATA/pb_data" || fail "could not create $DATA/pb_data."
exit 0
