# syntax=docker/dockerfile:1.7

# SUPPLY-04: Base images are digest-pinned so rebuilds across time are
# bit-identical. Dependabot (`.github/dependabot.yml`, `docker` ecosystem)
# watches these pins weekly and opens PRs when upstream publishes a new
# digest, so we get CVE patches without silent rebase drift.
# Human-readable tags are kept in the comment after the digest.
ARG NODE_VERSION=22-alpine
ARG NODE_DIGEST=sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
ARG PB_VERSION=0.37.1
ARG S6_OVERLAY_VERSION=3.2.2.0
ARG CADDY_VERSION=2.11.2
ARG CADDY_DIGEST=sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d

# Tier-3 canary — unique build fingerprint. Injected via
#   docker buildx build --build-arg HK_BUILD_ID=hk-<uuid>
# and by .github/workflows/release.yml (GITHUB_SHA). Unscripted local builds
# see the 'hk-dev-local' sentinel, which should NEVER appear on a real deploy.
ARG HK_BUILD_ID=hk-dev-local

############################################
# 1. deps
############################################
FROM node:${NODE_VERSION}@${NODE_DIGEST} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

############################################
# 2. builder
############################################
FROM node:${NODE_VERSION}@${NODE_DIGEST} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

############################################
# 3. runtime
############################################
FROM node:${NODE_VERSION}@${NODE_DIGEST} AS runtime
ARG TARGETARCH
ARG PB_VERSION
ARG S6_OVERLAY_VERSION
ARG HK_BUILD_ID

RUN apk add --no-cache xz ca-certificates tzdata curl unzip \
    && rm -rf /var/cache/apk/*

# s6-overlay v3 noarch
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz.sha256 /tmp/
RUN cd /tmp && sha256sum -c s6-overlay-noarch.tar.xz.sha256 \
    && tar -C / -Jxpf s6-overlay-noarch.tar.xz \
    && rm -f s6-overlay-noarch.tar.xz s6-overlay-noarch.tar.xz.sha256

# s6-overlay arch tarball (TARGETARCH -> S6_ARCH mapping).
# Save each download under its upstream filename so that sha256sum -c (which reads
# the filename from inside the .sha256 file) can locate it on disk.
RUN case "${TARGETARCH}" in \
      amd64) S6_ARCH=x86_64 ;; \
      arm64) S6_ARCH=aarch64 ;; \
      *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && cd /tmp \
    && curl -fsSL -O "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
    && curl -fsSL -O "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz.sha256" \
    && sha256sum -c "s6-overlay-${S6_ARCH}.tar.xz.sha256" \
    && tar -C / -Jxpf "s6-overlay-${S6_ARCH}.tar.xz" \
    && rm -f "/tmp/s6-overlay-${S6_ARCH}.tar.xz" "/tmp/s6-overlay-${S6_ARCH}.tar.xz.sha256"

# Caddy 2.11.2 static binary from official image (digest-pinned; see SUPPLY-04)
COPY --from=caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d /usr/bin/caddy /usr/bin/caddy

# PocketBase 0.37.1 (checksum-verified).
# Save the zip under its upstream filename so the checksum line from checksums.txt
# (format: `<sha>  pocketbase_<ver>_linux_<arch>.zip`) resolves via sha256sum -c -.
RUN case "${TARGETARCH}" in \
      amd64) PB_ARCH=amd64 ;; \
      arm64) PB_ARCH=arm64 ;; \
      *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && PB_ZIP="pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" \
    && cd /tmp \
    && curl -fsSL -O "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${PB_ZIP}" \
    && curl -fsSL -o pb-checksums.txt "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt" \
    && grep " ${PB_ZIP}\$" pb-checksums.txt | sha256sum -c - \
    && unzip -q "${PB_ZIP}" -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/pocketbase \
    && rm -f "/tmp/${PB_ZIP}" /tmp/pb-checksums.txt

# Next.js standalone output (Pitfall #2: explicit COPY of public/ and .next/static/)
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# PB migrations + hooks (schema-as-code + lifecycle handlers from Phase 2-6)
COPY pocketbase/pb_migrations /app/pb_migrations
COPY pocketbase/pb_hooks /app/pb_hooks

# Runtime configs
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/s6-rc.d /etc/s6-overlay/s6-rc.d

# Data dir (Pitfall #9: chown to node UID 1000)
RUN mkdir -p /app/data/pb_data \
    && chown -R node:node /app/data

ENV NODE_ENV=production \
    HOSTNAME=127.0.0.1 \
    PORT=3001 \
    S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_VERBOSITY=1 \
    HK_BUILD_ID=${HK_BUILD_ID}

# OCI label surfaces the build fingerprint via `docker inspect` even if the
# container is offline. Matches HOMEKEEP_BUILD at runtime.
LABEL org.opencontainers.image.revision="${HK_BUILD_ID}" \
      org.opencontainers.image.source="https://github.com/conroyke56/homekeep" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/init"]
