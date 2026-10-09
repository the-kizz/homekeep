#!/bin/sh
set -eu
IMAGE="${1:-homekeep:test}"
BYTES=$(docker inspect "$IMAGE" --format '{{.Size}}')
MB=$((BYTES / 1024 / 1024))
LIMIT=320
echo "Image $IMAGE = ${MB}MB (limit ${LIMIT}MB)"
if [ "$MB" -gt "$LIMIT" ]; then
  echo "FAIL: image exceeds ${LIMIT}MB"
  exit 1
fi
echo "OK"
