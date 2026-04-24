---
phase: 8
plan: 0
subsystem: ui / polish
tags: [ux, typography, serif, provenance, canary, docker]
requires: [07-01, 07-02]
provides: [lora-display-face, hk-build-canary, constants-module]
affects: [components, lib, public, docs/screenshots]
tech-stack:
  added: [next/font/google.Lora]
  patterns: [serif-display-hierarchy, tree-shake-resistant-constant, SPDX-header]
key-files:
  created:
    - lib/constants.ts
    - .planning/phases/08-ux-polish/08-SUMMARY.md
  modified:
    - app/layout.tsx
    - app/globals.css
    - app/(app)/h/[homeId]/page.tsx
    - components/coverage-ring.tsx
    - components/task-band.tsx
    - components/horizon-strip.tsx
    - components/band-view.tsx
    - components/most-neglected-card.tsx
    - lib/coverage.ts
    - lib/band-classification.ts
    - lib/task-scheduling.ts
    - lib/assignment.ts
    - lib/ntfy.ts
    - lib/scheduler.ts
    - public/manifest.webmanifest
    - public/offline.html
    - docs/screenshots/01-landing.png
    - docs/screenshots/02-signup.png
    - docs/screenshots/03-dashboard-three-band.png
    - docs/screenshots/04-by-area.png
    - docs/screenshots/05-person.png
    - docs/screenshots/06-history.png
    - docs/screenshots/07-settings.png
    - docs/screenshots/08-mobile-dashboard.png
decisions:
  - Keep CardTitle as <div>; add font-display + softer foreground at each
    call site rather than promoting to <h2>/<h3> globally (safer for
    existing E2E selectors and shadcn conventions).
  - HOMEKEEP_BUILD lives in a dedicated module (lib/constants.ts) and is
    imported by scheduler.ts — the import-and-log pattern survives
    webpack tree-shaking in production bundles.
  - Canary strings are passive (HTML comment, meta tag, manifest
    description, SPDX headers on pure fn modules) — zero telemetry,
    aligned with HomeKeep's self-hosted, no-phone-home principle.
metrics:
  duration_min: 28
  completed: 2026-04-20
---

# Phase 8: UX Polish Pass Summary

One-liner: Lora display serif + warm typography hierarchy + horizon scannability
+ canary provenance markers, ending with a Docker redeploy and fresh screenshots.

---

## Commit Log

| # | Step                          | Commit  | Type     |
| - | ----------------------------- | ------- | -------- |
| 1 | Lora font + theme nudge       | bebc83f | style    |
| 2 | Typography hierarchy          | 5f8a3a2 | style    |
| 3 | Mobile header density         | e06c712 | feat     |
| 4 | Horizon strip scannability    | 2f5010c | feat     |
| 5 | Empty-band / zero-task state  | 9f0a88a | fix      |
| 6 | Most-neglected polish         | 6901159 | style    |
| 7 | Canary SPDX + manifest + html | 1871a80 | docs     |
| 8 | Docker rebuild + redeploy     | 57fd7ea | chore    |
| 9 | Screenshot refresh            | 7d615ce | docs     |

All 9 commits landed on `master` and pushed (see Push section).

---

## Before / After Screenshots (all at `docs/screenshots/`)

| Screenshot                         | Delta after polish                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 01-landing.png                     | HomeKeep wordmark renders as serif (Lora), not sans                                                                        |
| 02-signup.png                      | Page headings use serif; form body stays Geist                                                                             |
| 03-dashboard-three-band.png        | 100% coverage number is serif; `ON SCHEDULE` label is tracking-[0.18em]; `This Week` / `Horizon` headers are serif medium  |
| 04-by-area.png                     | Area card titles inherit serif via base h1/h2/h3 CSS                                                                       |
| 05-person.png                      | Section headings serif; "You're on track" copy same tone                                                                   |
| 06-history.png                     | Filter chips and timeline labels unchanged (intentional)                                                                   |
| 07-settings.png                    | Section titles serif, Danger-zone text stays sans                                                                          |
| 08-mobile-dashboard.png            | `Smith Residence` is a proper h1 with font-display; streak pill sits beside it; ring has pb-6 breathing room above         |

---

## Canary Provenance Map

(The "is this a HomeKeep deploy?" probe points — all passive, never phoned
home.)

| Marker                              | File                                   | Format                                                            |
| ----------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `<meta name="hk-build">`            | app/layout.tsx (Phase 7 baseline)      | `hk-1b6f3c0e-homekeep-public`                                     |
| `<meta name="generator">`           | app/layout.tsx (Phase 7 baseline)      | `HomeKeep v1 (hk-1b6f3c0e-homekeep-public)`                       |
| Manifest `description`              | public/manifest.webmanifest            | Appended `hk-1b6f3c0e-homekeep-public — github.com/the-kizz/homekeep` |
| HTML comment                        | public/offline.html                    | `<!-- HomeKeep offline page — github.com/… — hk-1b6f3c0e… -->`    |
| Scheduler startup log               | lib/scheduler.ts (via lib/constants.ts)| `[scheduler] started (overdue + weekly ticks) — build=hk-1b6f3c0e-homekeep-public` |
| SPDX + repo header                  | lib/coverage.ts                        | Top-of-file comment                                               |
| SPDX + repo header                  | lib/band-classification.ts             | Top-of-file comment                                               |
| SPDX + repo header                  | lib/task-scheduling.ts                 | Top-of-file comment                                               |
| SPDX + repo header                  | lib/assignment.ts                      | Top-of-file comment                                               |
| SPDX + repo header                  | lib/ntfy.ts                            | Top-of-file comment                                               |
| SPDX + repo header                  | lib/constants.ts (new)                 | Top-of-file comment + constant export                             |
| CSS comment                         | app/globals.css (Phase 8 baseline)     | HomeKeep theme origin note                                        |

Any future contributor scanning a forked deployment has at least 12 distinct
provenance points; none involve outbound network traffic.

---

## Typography Changes

- **Serif face:** Lora (weights 500/600/700) via `next/font/google`, exposed
  as `var(--font-display)`. Applied globally to `h1/h2/h3` and the `.font-display`
  utility via `app/globals.css`.
- **Ring number:** `font-display text-2xl font-semibold tabular-nums`.
- **`ON SCHEDULE` label:** `text-[11px] tracking-[0.18em] text-muted-foreground/80`.
- **Band headers:** `font-display text-lg font-medium text-foreground/85`.
- **Horizon month labels:** `font-display`, opacity-100 when populated, opacity-55
  when empty. Current month cell has `border-primary/40`.
- **Dashboard h1:** `font-display text-xl font-medium tracking-tight` on mobile,
  lighter variant at sm+.

---

## Deviations from Plan

### Rule 3 (Blocking) — lint pre-existing `public/sw.js` error
`public/sw.js` is a Serwist-generated service worker bundle. It ships 1 lint
error (`no-this-alias` on a minified single line) plus 85 style-level warnings.
Not introduced by this polish; tracked as out-of-scope per executor
`<deferred-issues>` policy. Build + typecheck + 311/311 tests pass cleanly.

### Minor deviation — Task 4 "empty-overdue soft line"
TaskBand already returns `null` when `tasks.length === 0` (03-02 baseline), so
no hidden card ever renders. The "hard gap" the plan described did not exist;
the `space-y-6` outer container already produced a consistent gap. The task
was re-scoped to polishing the zero-task dashboard empty state (warmer panel,
two-line copy). Documented here so the plan-vs-reality diff is traceable.

---

## Known Stubs
None — all visual changes are wired to real state. No placeholder text
introduced.

---

## Self-Check

### Files created exist
- `lib/constants.ts` — FOUND
- `.planning/phases/08-ux-polish/08-SUMMARY.md` — FOUND

### Commits exist in git log
- `bebc83f` — FOUND (style: Lora wiring)
- `5f8a3a2` — FOUND (style: typography hierarchy)
- `e06c712` — FOUND (feat: mobile header)
- `2f5010c` — FOUND (feat: horizon)
- `9f0a88a` — FOUND (fix: empty state)
- `6901159` — FOUND (style: most-neglected)
- `1871a80` — FOUND (docs: canary)
- `57fd7ea` — FOUND (chore: docker)
- `7d615ce` — FOUND (docs: screenshots)

### Gate checks
- `npm test` — 311/311 pass
- `npm run build` — compiled + all routes generated
- `npm run typecheck` — clean
- `/api/health` live — `{"status":"ok","nextjs":"ok","pocketbase":"ok","pbCode":200}`
- Font verified live — `_next/static/media/*.woff2` served; `hk-build` meta present
- Manifest verified live — `hk-1b6f3c0e-homekeep-public` string returned

## Self-Check: PASSED
