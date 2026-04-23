---
phase: 16-horizon-density-visualization
type: validation
scope: manual-visual-verification
automated_suite: tests/unit/horizon-density-integration.test.ts (port 18104)
---

# Phase 16 Validation Guide

Automated coverage locks the helpers, component contracts, and live-PB round-trips. This document records the **visual / UX checks that automation cannot perform** — the parts a human must eyeball before signing off.

## Manual visual checks

### VLD-01 — HorizonStrip density tint is visually distinct across 3 tiers (LVIZ-01)

**Prerequisite:** Seed a home with tasks distributed as: 1 task in month+1, 3 tasks in month+3, 7 tasks in month+6, 2 tasks in month+9.

**Check:**
1. Navigate to `/h/{homeId}` (dashboard).
2. Scroll to HorizonStrip.
3. Confirm: month+6 cell has the **darkest** tint (bg-primary/50), month+3 cell is **medium** tint (bg-primary/30), month+1 and month+9 cells are **lightest** tint (bg-primary/10), all other months are **untinted** (default cell background — D-03).
4. The tint difference should be visible at a glance without colour-picker software.

**Pass criteria:** Tiers visually separable in both light and dark mode. No tier collapses into another. The "you are here" current-month border (border-primary/40) is still visible on top of any tint.

### VLD-02 — ⚖️ emoji renders consistently across platforms (LVIZ-03)

**Prerequisite:** Create a task, complete it, ensure LOAD smoother populated `next_due_smoothed` with a ≥1d displacement.

**Check:**
1. Open the dashboard on: (a) desktop Chrome, (b) mobile Safari (iOS), (c) mobile Chrome (Android), (d) Firefox.
2. For each: the ⚖️ (U+2696 FE0F, BALANCE SCALE) emoji appears next to the task name — colour variant (emoji-presentation), NOT the monochrome text glyph.
3. On hover (desktop) or long-press (mobile): native tooltip shows `Shifted from {date} to {date} to smooth household load`.

**Pass criteria:** Emoji visible on all 4 platforms. On Android, if the system emoji font renders it flat-text, note that in the SUMMARY — the FE0F variation selector should force emoji-style but some older Android versions ignore it. Acceptable fallback is the monochrome glyph; no fallback text (e.g. "[shifted]") is required.

### VLD-03 — TaskDetailSheet Schedule section layout on mobile + desktop (LVIZ-05)

**Prerequisite:** Same shifted task as VLD-02.

**Check:**
1. Desktop (≥640px): open task detail sheet. Schedule section should render between notes and assignee (or between assignee and recent-completions, depending on final insertion point). The `<dl>` renders as a 2-column grid with labels (Ideal / Scheduled) left-aligned, dates right-adjacent. The "Shifted by N days to smooth household load" copy reads as a single line below the grid.
2. Mobile (<640px): same content, same grid — dates should NOT wrap onto multiple lines for typical date strings like "Apr 24, 2026".
3. For an un-shifted task (ideal === scheduled): the Schedule section is completely absent — no empty placeholder, no header, no spacing artifact (D-09).

**Pass criteria:** No visual regression against the Phase 15 baseline detail sheet layout when section is absent. When section is present, grid alignment is consistent with other detail-sheet sections (same typography, same margins).

### VLD-04 — Badge absent on anchored and dormant tasks (LVIZ-04 + Phase 14 compat)

**Prerequisite:** Seed two tasks:
- Anchored task with `anchor_date` in the future, `frequency_days: 30`.
- Seasonal dormant task (active_from_month=10, active_to_month=3) viewed in April (out-of-window).

**Check:**
1. Dashboard shows anchored task in its appropriate band — **no ⚖️ badge** next to the name.
2. Seasonal task appears in the "Sleeping" section (DormantTaskRow) — **no ⚖️ badge** next to the name.
3. Even if an admin manually forces a `next_due_smoothed` value on the anchored task via PB admin UI (simulating an erroneous write), the dashboard STILL shows no badge (read-side schedule_mode guard holds per LOAD-06).

**Pass criteria:** Zero false-positive badges across the two control task types. Covered by Scenario 2 of the integration suite, but human eyeball confirms the rendered DOM matches.

### VLD-05 — HorizonStrip Sheet drawer shows ⚖️ badge inline with task names (LVIZ-02 + LVIZ-03, D-02)

**Prerequisite:** At least one shifted task with its scheduled next-due falling in a future month.

**Check:**
1. Dashboard → tap the HorizonStrip month cell containing the shifted task.
2. Sheet drawer opens showing task list for that month.
3. The shifted task's `<li>` includes the ⚖️ emoji next to the task name.
4. The date displayed is the **scheduled** date (not the ideal) — matches the bucket key.

**Pass criteria:** Badge + date both render correctly in the drawer. No layout break on long task names.

## Cross-platform smoke matrix

| Platform | VLD-01 | VLD-02 | VLD-03 | VLD-04 | VLD-05 |
|----------|:------:|:------:|:------:|:------:|:------:|
| Desktop Chrome | ☐ | ☐ | ☐ | ☐ | ☐ |
| Desktop Firefox | ☐ | ☐ | ☐ | ☐ | ☐ |
| Desktop Safari | ☐ | ☐ | ☐ | ☐ | ☐ |
| iOS Safari | ☐ | ☐ | ☐ | ☐ | ☐ |
| Android Chrome | ☐ | ☐ | ☐ | ☐ | ☐ |

Mark each cell ✓ (pass), ✗ (fail — log issue), or N/A (not applicable). Phase 16 closes when every row has at least one ✓ per column OR documented fallback acceptance.

## Automated coverage cross-reference

| LVIZ REQ | Covered by automation | Additional manual check |
|----------|----------------------|------------------------|
| LVIZ-01 | horizon-strip-density.test.tsx + integration Scenario 3 | VLD-01 (visual tier separability) |
| LVIZ-02 | horizon-strip.test.tsx (Sheet open preserved) | VLD-05 (badge inline in drawer) |
| LVIZ-03 | shift-badge.test.tsx + integration Scenario 1 | VLD-02 (emoji rendering) |
| LVIZ-04 | horizon-density.test.ts + integration Scenario 2 | VLD-04 (anchored + dormant DOM) |
| LVIZ-05 | task-detail-sheet-schedule.test.tsx | VLD-03 (layout at breakpoints) |

## Sign-off

**Validator:** _______________
**Date:** _______________
**Result:** ☐ All pass / ☐ Pass with notes / ☐ Fail (reopen phase)

**Notes:** _______________
