# HomeKeep

[![CI](https://github.com/OWNER/homekeep/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/homekeep/actions/workflows/ci.yml)
[![Release](https://github.com/OWNER/homekeep/actions/workflows/release.yml/badge.svg)](https://github.com/OWNER/homekeep/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Household maintenance that is visible, evenly distributed, and nothing falls through the cracks -- without anxiety or guilt.

Self-hosted. One Docker container. One folder to back up.

## Status

**Phase 1 of 7 -- Scaffold & Infrastructure.** The container builds, boots, and answers `/api/health`. No application features yet. See [ROADMAP](./.planning/ROADMAP.md) for the full plan.

## Quickstart

### With `docker run` (standalone)

One-liner form: `docker run -d -p 80:3000 -v ./data:/app/data --env-file .env ghcr.io/OWNER/homekeep:latest`

Or with readable line-continuations:

```bash
# On any host with Docker:
cp .env.example .env
docker run -d \
  --name homekeep \
  -p 80:3000 \
  -v "$(pwd)/data:/app/data" \
  --env-file .env \
  ghcr.io/OWNER/homekeep:latest
```

Replace `OWNER` with the GitHub user or org that published the image. Map `80:3000` to any host port you like (the app listens on 3000 inside the container).

### With Docker Compose

```bash
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
```

Compose reads `HOST_PORT`, `GHCR_OWNER`, `TAG`, and `TZ` from `.env` (see `.env.example`). Defaults: `HOST_PORT=3000`, `TAG=latest`.

> **Compose-dir footgun.** Compose resolves `env_file: .env` and `./data` relative to the compose file's directory (`docker/`), not your current working directory. From the project root, either run with `--project-directory .` (so paths resolve to the repo root) or copy/symlink `.env` to `docker/.env`. The `docker run` flow above sidesteps this entirely.

### First boot: create the PocketBase admin

After the container starts, PocketBase prints a one-time installer link to its logs. Open it to set up the superuser:

```bash
# Tail the logs for the installer URL
docker compose -f docker/docker-compose.yml logs homekeep | grep -i installer
# or for docker run:
docker logs homekeep | grep -i installer
```

Open the URL in a browser (replace `127.0.0.1:8090` with your host's address and port, e.g. `http://192.168.1.10/_/`). Pick an email and password. You are now the PocketBase admin; the admin UI lives at `/_/`.

## Configuration

All runtime configuration is env-driven. Copy `.env.example` to `.env` and edit:

| Variable | Purpose | Default |
|----------|---------|---------|
| `SITE_URL` | Public URL users reach the app at; used for PWA manifest and ntfy notification links | `http://localhost:3000` |
| `NTFY_URL` | ntfy server base URL (push notifications, Phase 6+) | `https://ntfy.sh` |
| `TZ` | IANA timezone for scheduler and date display | `Etc/UTC` |
| `PUID` | Host UID that owns the `./data` volume | `1000` |
| `PGID` | Host GID that owns the `./data` volume | `1000` |

No secrets are hardcoded anywhere in the image. `.env.example` is committed; real `.env` is gitignored.

### If your host UID is not 1000

The default `node` user inside the container is UID 1000. If your host user has a different UID, use **either** of the following one-time fixes (future versions will honor `PUID`/`PGID` at runtime -- Phase 7):

**Option A -- chown from inside the container** (explicitly overrides the s6 `/init` entrypoint with `sh` so the chown can actually run -- `/init` alone would just start the services and never execute the trailing command):

```bash
docker run --rm --entrypoint sh -u 0 \
  -v ./data:/app/data \
  ghcr.io/OWNER/homekeep:latest \
  -c "chown -R 1000:1000 /app/data"
```

**Option B -- chown from the host** (no container involved):

```bash
mkdir -p data && sudo chown -R 1000:1000 data
```

Either option leaves `./data/` owned by UID 1000, which matches the `node` user inside the container.

## Backup

The entire application state lives in `./data/`. Back it up by stopping the container and copying the folder:

```bash
docker compose -f docker/docker-compose.yml down
cp -a data/ backups/data-$(date +%Y%m%d)/
docker compose -f docker/docker-compose.yml up -d
```

**Important:** `./data/` must live on a local filesystem. NFS, SMB, and most NAS-mounted paths will silently corrupt the SQLite WAL. If your host is a Synology or Unraid, use a local docker volume rather than a bind mount to a shared path.

## Development

Day-to-day development runs natively (no Docker). Docker is only for building the production image.

```bash
# Requirements: Node 22+, unzip (for PocketBase download)
npm install
npm run dev
```

`npm run dev` uses `concurrently` to run two processes:
- **Next.js** on `http://localhost:3001` (dev server)
- **PocketBase** on `http://127.0.0.1:8090` (via `scripts/dev-pb.js`, which downloads the binary into `./.pb/` on first run)

Other scripts:

| Command | Purpose |
|---------|---------|
| `npm run dev:next` | Just Next.js |
| `npm run dev:pb` | Just PocketBase |
| `npm run lint` | ESLint via `eslint .` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit + integration tests |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run build` | Next.js production build |
| `npm run docker:build` | Build the Docker image locally (amd64) |
| `npm run docker:run` | Run the locally built image |

To build and run the image locally end-to-end:

```bash
npm run docker:build
npm run docker:run
# or with compose (expects .env + ./data to resolve correctly -- see Quickstart note above):
docker compose -f docker/docker-compose.yml up -d
```

## Releases

Tagged commits on `main` trigger a multi-arch (linux/amd64 + linux/arm64) image build and push to GHCR:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Images are published as:
- `ghcr.io/OWNER/homekeep:v0.1.0` (exact)
- `ghcr.io/OWNER/homekeep:0.1` (major.minor)
- `ghcr.io/OWNER/homekeep:latest` (default branch)

## Architecture

One container, two (plus one) processes managed by [s6-overlay v3](https://github.com/just-containers/s6-overlay):

- **Caddy** (port 3000, exposed) -- internal reverse proxy. Routes `/api/health` to Next.js, `/api/*` and `/_/*` to PocketBase with SSE-safe flushing, everything else to Next.js.
- **Next.js** (port 3001, loopback) -- UI and the combined `/api/health` endpoint.
- **PocketBase** (port 8090, loopback) -- SQLite database, auth, REST API, realtime, admin UI.

Only port 3000 is exposed. The browser talks to both Next.js and PocketBase via the same origin.

See [`SPEC.md`](./SPEC.md) for the full architectural spec.

## Verifying your deployment

After `up -d`, check the health endpoint:

```bash
curl -s http://localhost:3000/api/health
# { "status": "ok", "nextjs": "ok", "pocketbase": "ok", "pbCode": 200 }
```

If `pocketbase` is anything other than `"ok"`, check container logs.

## Maintainer setup (forking the repo)

If you are forking HomeKeep into your own GitHub account or org and want the release pipeline to publish to your own GHCR namespace, apply these one-time settings in the GitHub web UI after pushing your first commit. None of these are scriptable from the repo itself -- they require an admin token.

1. **Allow Actions to write packages.**
   `Settings -> Actions -> General -> Workflow permissions` -> select **Read and write permissions**.
   The release workflow needs `packages: write` on `GITHUB_TOKEN` to push images to `ghcr.io/<you>/homekeep`.

2. **Protect `main`.**
   `Settings -> Branches -> Add rule` with pattern `main`:
   - Require a pull request before merging
   - Require status checks to pass before merging -> select the `lint-test-build` check from `ci.yml`
   - Require branches to be up to date before merging (recommended)
   - Do not allow bypassing the above settings (recommended for public repos)

3. **Make the GHCR package public** (after the first `v*` tag push publishes it).
   `GitHub profile or org -> Packages -> homekeep -> Package settings -> Danger Zone -> Change visibility -> Public`.
   GHCR defaults new packages to private; this flips it so `docker pull ghcr.io/<you>/homekeep:latest` works without credentials.

Once done, tag a release (`git tag v0.1.0 && git push origin v0.1.0`) and the multi-arch image will publish to GHCR automatically.

## Notifications (Phase 6)

HomeKeep pushes via [ntfy](https://ntfy.sh) — no account required.

1. Pick a hard-to-guess topic string (e.g. `homekeep-alice-a7b3c9`).
2. Subscribe on your phone/desktop: install the ntfy app and enter the same topic.
3. In HomeKeep, open `/h/<home>/person` → Notifications, paste the topic, save.
4. Test manually: `curl -d "hi from HomeKeep" https://ntfy.sh/<your-topic>`.

Self-host ntfy (optional): set `NTFY_URL=https://ntfy.your-domain.com` in `.env`.

## License

MIT -- see [LICENSE](./LICENSE).

## Contributing

This is an early-stage project. Check the [ROADMAP](./.planning/ROADMAP.md) and open an issue before sending PRs.
