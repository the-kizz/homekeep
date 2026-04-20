---
phase: 2
slug: auth-core-data
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 2 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit) + Playwright 1.x (E2E) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` (already in place from Phase 1) |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test && npm run test:e2e` |
| **Estimated runtime** | ~90s (unit) / ~180s (+e2e) |

## Sampling Rate

- **After every task commit:** `npm run lint && npm run type-check`
- **After every plan wave:** `npm run test`
- **Before `/gsd-verify-work`:** Full suite green; signup→task E2E passes against live-booted PB
- **Max feedback latency:** 90s

## Per-Plan Verification Map (preliminary — will evolve during planning)

| Plan | Requirement | Test Type | Automated Command |
|------|-------------|-----------|-------------------|
| 02-01 (migrations + hooks) | AUTH-01, HOME-01, AREA-02 | integration | Boot PB → verify collections exist + Whole Home auto-creates on home insert |
| 02-02 (SSR cookie + shadcn) | AUTH-02 (session) | unit | mock cookies(), assert pb client reads correct token |
| 02-03 (auth pages) | AUTH-01..04 | e2e | Playwright: signup → redirect → reload → still logged in → logout |
| 02-04 (homes + areas CRUD) | HOME-01..04, AREA-01..05 | e2e | Playwright: create home → Whole Home visible → add Kitchen → drag-reorder → edit |
| 02-05 (tasks + next-due) | TASK-01, 05, 06, 07, 08 | unit + e2e | Vitest: next-due matrix (cycle/anchored, edge cases) + Playwright create-task flow |

## Wave 0 Requirements

- [ ] shadcn/ui `init` + required components installed (button, input, label, card, form, select, dialog, dropdown-menu, sonner, tabs, separator)
- [ ] @dnd-kit/core + @dnd-kit/sortable installed
- [ ] react-hook-form + @hookform/resolvers + zod installed (zod already present)
- [ ] date-fns-tz or Temporal polyfill installed for timezone-safe next-due
- [ ] `lib/pocketbase-server.ts` + `lib/pocketbase-browser.ts` scaffolded
- [ ] `proxy.ts` (Next 16 middleware) at repo root with auth gating for `(app)` group
- [ ] `pocketbase/pb_hooks/` directory with at least one loaded hook
- [ ] `scripts/dev-pb.js` updated to pass `--hooksDir ./pocketbase/pb_hooks` to PB

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Password reset email arrives | AUTH-04 | Requires real SMTP config (not in CI) | Configure SMTP env vars, trigger reset, check inbox |
| Visual polish (shadcn tokens) | D-18 | Subjective | Open each page at mobile + desktop, check warm accent, rounded corners |
| Persistence across deploys | HOME-03 | Docker volume survival | Docker restart container, log in, verify last-viewed home |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
