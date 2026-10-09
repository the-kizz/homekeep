#!/bin/sh
set -eu
IMAGE="${1:-ghcr.io/OWNER/homekeep:latest}"
echo "Inspecting manifest for $IMAGE..."
MANIFEST=$(docker buildx imagetools inspect "$IMAGE" 2>&1)
echo "$MANIFEST"

if ! echo "$MANIFEST" | grep -q 'linux/amd64'; then
  echo "FAIL: manifest missing linux/amd64"
  exit 1
fi
if ! echo "$MANIFEST" | grep -q 'linux/arm64'; then
  echo "FAIL: manifest missing linux/arm64"
  exit 1
fi
echo "OK: manifest contains linux/amd64 and linux/arm64"
