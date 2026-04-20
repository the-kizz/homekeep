---
phase: 1
slug: scaffold-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit/integration) + Playwright 1.x (E2E) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` (Wave 0 installs) |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test && npm run test:e2e` |
| **Estimated runtime** | ~60 seconds (unit) / ~120 seconds (+e2e) |

---

## Sampling Rate

- **After every task commit:** Run `npm run lint && npm run type-check` (fast signal ~15s)
- **After every plan wave:** Run `npm run test`
- **Before `/gsd-verify-work`:** Full suite must be green; `docker compose up` must serve `/` and `/api/health`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 01-01-W0 | 01 | 0 | scaffold | integration | `npm install && npm run type-check` | ⬜ pending |
| 01-02-* | 02 | 1 | INFR-02 | integration | `docker build -t homekeep:test .` | ⬜ pending |
| 01-03-* | 03 | 1 | INFR-01 | integration | `curl -f http://localhost:3000/api/health` | ⬜ pending |
| 01-04-* | 04 | 2 | INFR-05 | e2e | `npx playwright test tests/e2e/health.spec.ts` | ⬜ pending |
| 01-05-* | 05 | 2 | INFR-06 | integration | `docker buildx build --platform linux/amd64,linux/arm64 .` | ⬜ pending |
| 01-06-* | 06 | 2 | INFR-10 | static | `grep -q '^PB_URL=' .env.example && grep -qE '^\* \[ \]' README.md` | ⬜ pending |
| 01-07-* | 07 | 2 | INFR-11,12 | ci | `act -j ci` or push PR and observe green | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — deps pinned per STACK.md (Next 16.2.4, React 19, Vitest 4, Playwright 1, Tailwind 4, Zod 4)
- [ ] `tsconfig.json` — strict mode
- [ ] `vitest.config.ts` — minimal config
- [ ] `playwright.config.ts` — launches against `http://localhost:3000`
- [ ] `next.config.ts` — `output: 'standalone'`
- [ ] `.env.example` — documents all env vars
- [ ] `tests/smoke.test.ts` — trivial green test to prove Vitest pipeline works
- [ ] `tests/e2e/health.spec.ts` — Playwright test hitting `/api/health`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PocketBase admin `/_/` serves the installer JWT on first boot | D-05 | First-boot UX — no API to test | Run container fresh, check logs for installer URL, open in browser |
| Branch protection on `main` | D-10 | GitHub API not in test scope | Configure via GitHub UI after repo creation; verify in repo settings |
| Multi-arch image actually runs on arm64 | INFR-06 | CI QEMU-only validates build, not runtime; requires real arm64 host or manual docker run with --platform | `docker run --platform linux/arm64 ghcr.io/owner/homekeep:latest` on arm64 host |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
