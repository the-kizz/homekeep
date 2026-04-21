# Contributing to HomeKeep

First — thanks. This is a small weekend-ish project, but it's open and public and I'd love for it to be useful.

## Before opening a PR

1. **Open an issue first** if it's more than a typo fix. It's faster to agree on the approach than to redo a big change.
2. **Read `.planning/PROJECT.md`** — it has the guiding principles (calm over urgent, shared not competitive, forgiveness built in). Features that push against those principles will probably not land.
3. **Run the test suite.** `npm test && npm run test:e2e` should stay green.
4. **Keep commits atomic.** One logical change per commit. Follow the existing conventional-commit style (`feat(scope):`, `fix(scope):`, `docs(scope):`, `test(scope):`).

## Setting up

```bash
git clone https://github.com/conroyke56/homekeep.git
cd homekeep
npm install
npm run dev
```

The dev stack boots both Next.js and a local PocketBase binary side-by-side. First run downloads the PB binary to `./.pb/`.

## Scope

**In scope for v1:**
- Bugfixes
- UX polish (keep it warm, calm, domestic — soft neutrals + one accent, rounded corners, not pill-shaped)
- Accessibility improvements
- Docs and deployment guides
- Self-hosted niceties (backup scripts, data export, etc.)

**Out of scope for v1** (some may land in v1.1+):
- Web push / Firebase / APNs — we intentionally use ntfy only
- Paid cloud integrations
- Multi-tenancy / SaaS features
- Offline writes / conflict resolution
- AI features that require outbound API calls

## Architecture reminders

- **Single Docker image.** Caddy + PocketBase + Next.js under s6-overlay. Do not introduce extra runtime services.
- **PocketBase migrations** live in `pocketbase/pb_migrations/` and run automatically on container start. Never edit a past migration — add a new one.
- **No secrets in code.** Env vars only. `.env` is gitignored; only `.env.example` gets committed.
- **Server-side ownership/membership preflights** on every mutation action. Don't trust client input for auth.
- **Append-only completions.** Completion history is never deleted — SPEC §7.5.

## Filing a bug

Please include:

- What you did
- What you expected
- What happened instead
- Docker image tag (`docker inspect homekeep --format '{{index .Config.Labels "org.opencontainers.image.version"}}'`)
- Relevant logs (`docker logs homekeep --tail 100`)

## Code style

- TypeScript strict mode, already configured.
- ESLint + Next.js rules; `npm run lint` must pass.
- Prefer Server Components for reads, Server Actions for writes. Only reach for Client Components when you need interactivity.
- Name things warmly. The codebase tries to read like notes from someone who likes living in houses.
