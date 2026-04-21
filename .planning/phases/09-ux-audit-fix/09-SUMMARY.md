---
phase: 9
plan: ux-audit-fix
subsystem: ui
tags: [ux, audit, palette, accessibility]
tech-stack:
  added: []
  patterns:
    - "area.color inline style (Tailwind can't take dynamic hex at build time)"
    - "warm-only AREA_COLORS palette + idempotent bootstrap backfill"
    - "soft avatar variant (bg-primary/15) for identity vs solid for signal"
    - "tailwind grid-cols-N for equal-width segmented controls"
    - "CSS @supports color-mix fallback graceful-degrade"
key-files:
  created:
    - pocketbase/pb_hooks/bootstrap_area_palette_backfill.pb.js
    - .planning/phases/09-ux-audit-fix/09-SUMMARY.md
  modified:
    - app/page.tsx
    - app/globals.css
    - app/(app)/layout.tsx
    - app/(app)/h/[homeId]/settings/page.tsx
    - app/(public)/signup/page.tsx
    - app/(public)/login/page.tsx
    - components/area-card.tsx
    - components/home-switcher.tsx
    - components/personal-stats.tsx
    - components/history-filters.tsx
    - components/avatar-circle.tsx
    - components/avatar-stack.tsx
    - components/members-list.tsx
    - components/horizon-strip.tsx
    - lib/area-palette.ts
    - eslint.config.mjs
    - docs/screenshots/*.png (all 8)
decisions:
  - "Palette tightened to warm-only: dropped sage #6B8E5A and slate #4F6D7A; added #B88A6A warm sand and #8F6B55 warm cocoa."
  - "Introduced 'soft' AvatarCircle variant (bg-primary/15) so identity avatars don't compete with the solid-warm streak pill."
  - "Danger zone tone: hsl(0 65% 50%) pure red → hsl(12 55% 48%) warm brick — shares hue family with terracotta accent."
  - "Single-home users: HomeSwitcher renders null (in-page h1 identifies the home)."
  - "Link identifiability: persistent underline on auth cross-links since primary (hsl 30 45% 65%) sits on the 4.5:1 edge vs cream bg."
  - "Generated public/sw.js added to ESLint ignore (Serwist re-emits on every build)."
metrics:
  duration: ~1h20
  completed: 2026-04-20
  commits: 14
  tests: 311 passing (no change)
  build_id: hk-11d485d7-6609-4066-9e1b-ae82ead435c0
  docker_image: homekeep:phase-9-ux (also tagged latest)
---

# Phase 9 UX Audit Fix Summary

Post-launch UX audit fix pass driven by screenshot review. 11 discrete
issues identified, fixed atomically (one commit per issue), rebuilt
the image with a fresh tier-3 UUID, redeployed, re-captured all 8
screenshots, and pushed to `github.com/conroyke56/homekeep`. Warm-
palette-only render across every surface; no sage green, no pure red,
no mid-phrase wrap, no sprawling whitespace on the landing page.

## Fixes (in commit order)

| #   | Commit    | Fix                                                              |
| --- | --------- | ---------------------------------------------------------------- |
| 1   | `1a76c83` | Stop mid-phrase wraps in area card counters                      |
| 2   | `9039f07` | Use area.color for card accent + tighten palette to warm-only    |
| 3   | `c207012` | Drop redundant WHOLE HOME label                                  |
| 4   | `0b16625` | Auto-hide HomeSwitcher for single-home users                     |
| 5   | `396db7b` | Warm brick tone for Danger zone instead of pure red              |
| 6   | `5c58639` | Warmer landing with presence + subtle pattern                    |
| 7   | `7c2bf0b` | Equalize Person view stat card heights                           |
| 8   | `466077b` | Equal-width History range segments                               |
| 9   | `c12c7a3` | Soften avatar background so it doesn't compete with streak pill  |
| 10  | `6c8c51c` | Consistent button hierarchy on Settings page                     |
| 11  | `9e0b1ba` | Horizon empty-month opacity + auth link contrast                 |
| 12  | n/a       | Rebuild + redeploy with fresh tier-3 UUID (docker/.env rotated)  |
| 13  | `147b200` | Extend palette backfill hook to cover ad-hoc cool hexes          |
| 14  | `b9b5662` | Ignore generated public/sw.js for ESLint                         |
| 15  | `4931755` | Refresh docs/screenshots/* after all fixes                       |

## Before / after observations

### Fix 1 — area card counter wrap
**Before:** On narrow cards (≥2-col grid), the counter row `0 overdue ·
1 this week · 2 upcoming` would wrap the middle pill as `1 this` on
one line and `week` on the next, producing an ugly orphan.
**After:** Each counter is `whitespace-nowrap`; on narrow cards they
stack vertically, on `≥sm` they render as a single horizontal row.
Dot separators hidden in the stacked layout.

### Fix 2 — By Area card accent
**Before:** Bathroom + Backyard cards rendered with sage-green
left-border and matching teal coverage bar (the palette contained
`#6B8E5A` sage and the demo DB had ad-hoc `#A8B5A0` / `#8FA68E`).
**After:** Palette is warm-only (sand, terracotta, cocoa, walnut,
etc.). Both left-border AND coverage-bar fill derive from the same
`area.color` inline style, so each card reads as one unified warm
block. A bootstrap hook + one-shot PB admin API patch migrated the
live demo data.

### Fix 3 — WHOLE HOME pill
**Before:** The Whole Home card had both "Whole Home" as its title
AND a small outlined "WHOLE HOME" pill in the top-right — redundant.
**After:** Pill removed. The `data-is-whole-home` attribute on the
card wrapper is preserved for E2E (views.spec.ts L238).

### Fix 4 — HomeSwitcher
**Before:** Single-home users saw a "Select home ↓" dropdown that was
useless noise (the home name was already in the h1 below).
**After:** HomeSwitcher returns null when `homes.length === 1`. For
multi-home users the trigger shows the current home's name (truncated
with `max-w-[12rem]`) instead of a generic label. On `<sm` the
wordmark + switcher container are both hidden.

### Fix 5 — Danger zone tone
**Before:** `--destructive` at `hsl(0 65% 50%)` pure red siren
clashed with the rest of the warm palette.
**After:** `hsl(12 55% 48%)` warm brick (dark mode `hsl(12 55% 55%)`)
— still clearly red-family "danger" but shares the warm hue with the
terracotta primary. Settings danger card now has tinted background
(`bg-destructive/5`) and softer border (`border-destructive/30`).

### Fix 6 — landing presence
**Before:** Wordmark + tagline + CTAs floated alone in ~90%
whitespace on desktop. The page looked broken.
**After:** Subtle warm ring behind the wordmark (echoes the
CoverageRing motif), font-display promoted to text-4xl, value strip
(`self-hosted · AGPL-3.0-or-later · no telemetry`), GitHub footer
link. Restrained — no marketing copy.

### Fix 7 — Person stat cards
**Before:** Streak zero-state card towered over the two numeric
tiles because its multi-line copy made it taller.
**After:** `items-stretch` + `h-full` + `min-h-[120px]` floor the
height across all three tiles; zero-state copy downshifts to
`text-sm leading-snug` so it fits inside the fixed height.

### Fix 8 — History range segments
**Before:** Today/Week/Month/All was `inline-flex`, so the active
pill (bg-primary) grew to its text width and nudged its neighbours
sideways on switch.
**After:** `grid-cols-4` equal-width cells, `min-w-[4rem]` floor,
`w-fit` on the outer grid, `divide-x` for internal separators.

### Fix 9 — avatar vs streak pill
**Before:** Dashboard header AvatarStack used `solid` warm-primary
filled circles, which put two loud warm dots (stack on left,
streak pill on right) competing.
**After:** New `soft` AvatarCircle variant (`bg-primary/15
text-foreground border-primary/25`) still in the warm family but
quieter. AvatarStack + MembersList switched to `soft`;
AssigneeDisplay keeps `solid` for semantic override signal.

### Fix 10 — Settings button hierarchy
**Before:** "Create invite link" (solid warm) and "View members"
(outline full-width) read as roughly equal weight.
**After:** "View members" is `size="sm"` outline, left-aligned in a
flex wrapper, natural width — obviously secondary.

### Fix 11 — horizon + auth link
**Before:** Empty months on horizon at 55% opacity felt ghosted;
auth cross-links relied on `text-primary` color alone.
**After:** Empty months at 65% (still subordinate, legible).
Signup + Login cross-links have `underline underline-offset-2`
persistent, hover swaps to `text-primary/80` for state.

## Deviations from original plan

### [Rule 1 - Bug] Backfill hook findRecordsByFilter limit

**Found during:** Fix 2 verification (first re-screenshot).
**Issue:** The initial hook passed `limit=0` to
`e.app.findRecordsByFilter`, which PB 0.37.x interprets as "return
zero rows" — so the bootstrap backfill silently no-op'd and the
demo areas stayed sage.
**Fix:** Pass `10_000` (realistic ceiling) + stable `'id'` sort.
**Commit:** `147b200`

### [Rule 1 - Bug] Demo data had ad-hoc cool hexes outside palette

**Found during:** Fix 2 verification.
**Issue:** The live PB DB had `#A8B5A0` (Bathroom) and `#8FA68E`
(Backyard) — neither were in the official palette nor in the
retired list the first backfill targeted.
**Fix:** Extended the hook to scan ALL area rows and migrate
anything outside the current warm palette (explicit legacy-map for
the four known cool hexes, primary fallback for unknowns). Also
patched the two live rows via PB admin API so the live deployment
converged immediately without waiting for the next bootstrap.
**Commit:** `147b200`

### [Rule 3 - Blocking] public/sw.js lint error

**Found during:** Pre-push lint gate.
**Issue:** Pre-existing `@typescript-eslint/no-this-alias` error in
the Serwist-generated `public/sw.js` bundle blocked `npm run lint`
clean. Discovered via diff-comparison: the error was already on
master before this phase, it just wasn't on the success criteria.
**Fix:** Added `public/sw.js` to ESLint ignores (it's generated
output, not hand-maintained source — `app/sw.ts` remains linted).
**Commit:** `b9b5662`

### [Deviation] docker/.env gitignored

**Issue:** Plan says commit `chore(deploy): redeploy with UX fixes`
bumping HK_BUILD_ID in docker/.env; that file is `.gitignore`d.
**Action:** The UUID rotation still happened in the running
container (new build arg → new .well-known output verified), but
no git commit was made for it. Noted here so the provenance chain
is still auditable via `.well-known/homekeep.json`.

## Authentication gates

None encountered. The GitHub PAT at `/root/projects/homekeep/.env`
was used for the final `git push` without interactive auth. PAT
never leaked to git remote URLs (verified post-push:
`git remote -v` still shows the bare `https://github.com/...`).

## Tests / Gates

| Gate                                              | Status                  |
| ------------------------------------------------- | ----------------------- |
| `npm test` (Vitest unit)                          | 311/311 passing         |
| `npm run typecheck`                               | Clean                   |
| `npm run lint`                                    | 0 errors, 2 warnings\*  |
| `npm run build`                                   | Clean                   |
| `docker buildx build`                             | `homekeep:phase-9-ux`   |
| `/api/health`                                     | `{"status":"ok",...}`   |
| `/.well-known/homekeep.json`                      | Fresh UUID visible      |
| `git push`                                        | `d72e775..4931755`      |

\* Pre-existing React Compiler / react-hook-form `watch()` warnings
on task-form.tsx + notification-prefs-form.tsx. Unchanged from
prior phases; out of Phase 9 scope.

## Live deployment

- **Image:** `homekeep:phase-9-ux` (also tagged `homekeep:latest`)
- **Tier-3 UUID:** `hk-11d485d7-6609-4066-9e1b-ae82ead435c0`
- **Repo:** https://github.com/conroyke56/homekeep
- **License:** AGPL-3.0-or-later (untouched per constraint)
- **Container:** `homekeep` — healthy, port 3000, force-recreated

## Self-Check: PASSED

- AreaCard, HomeSwitcher, PersonalStats, HistoryFilters,
  AvatarCircle/Stack, MembersList, HorizonStrip, DeleteHomeButton
  context all re-rendered and visually verified via screenshot
  scan.
- `.well-known/homekeep.json` returns the new UUID.
- `git log` contains all 14 fix commits; HEAD `4931755` on remote.
- `docs/screenshots/*` regenerated (all 8 files timestamped
  post-deploy).
- `.planning/phases/09-ux-audit-fix/09-SUMMARY.md` (this file) at
  the expected path.
