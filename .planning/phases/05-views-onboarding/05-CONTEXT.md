# Phase 5: Views & Onboarding - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Source:** Autonomous yolo-mode synthesis from SPEC.md §8.2-§8.4, §11, Phase 4 artifacts.

<domain>
## Phase Boundary

Phase 5 adds **three secondary views** (By Area, Person, History) and a **seed task library wizard** for new-home onboarding. The three-band main view (Phase 3) remains the default landing; these new views are reached via a bottom nav.

**Scope:**
- By Area view: grid/list of area cards with coverage % + counts (AREA-V-01/02/03)
- Person view: tasks assigned to me + my history + my personal stats (PERS-01/02/03)
- Person view nav target also surfaces notification prefs (PERS-04) — but the actual notification infra lands in Phase 6; Phase 5 renders a stub/placeholder for the prefs section
- History view: filterable timeline of household completions (HIST-01/02/03)
- First-run wizard: when a new home has zero tasks, offer seed library with accept/reject/customize (ONBD-01..04)
- Bottom nav (or top tabs on desktop): Home / By Area / Person / History

**NOT in Phase 5:**
- Actual ntfy notifications (Phase 6 — PERS-04 is just UI stub for prefs)
- Streaks + celebrations (Phase 6)
- Year-in-review (v1.1)
- Seed library UX for existing homes (Phase 5 only shows wizard on first home, not on subsequent home creation)
- PWA install prompt (Phase 7)
</domain>

<decisions>
## Implementation Decisions

### Routing & Nav

- **D-01:** Routes under `(app)` add:
  - `/h/[homeId]/by-area` — By Area view
  - `/h/[homeId]/person` — Person view (current user's subset)
  - `/h/[homeId]/history` — History view
  - `/h/[homeId]/onboarding` — Seed library wizard (only redirected to on first home with zero tasks)
- **D-02:** **Bottom nav** (mobile) / **top tabs** (desktop): Home (/h/[id]), By Area, Person, History. Settings/Members still reachable from account menu. Use shadcn Tabs on desktop, a sticky bottom bar with icons+labels on mobile.
- **D-03:** After any user creates their first home (detected in layout via `tasks.filter(home_id=X).length === 0` on the home dashboard load), redirect `/h/[id]` → `/h/[id]/onboarding` UNLESS the user has previously declined (store a flag in users.onboarding_declined_for_home_ids string array OR per-home `onboarded_at` date). Simpler: add a boolean `homes.onboarded` (default false). After any seed action, set true. User can also "Skip" to set it true without adding tasks.

### By Area view (AREA-V-01..03)

- **D-04:** `/h/[homeId]/by-area` — grid of area cards (responsive: 1 column mobile, 2-3 tablet, 3-4 desktop). Each card shows: area icon, name, coverage % (using `computeCoverage` scoped to area tasks only), overdue count, due-this-week count, upcoming count.
- **D-05:** Whole Home card pinned to top by rendering it separately above a `<Separator />` and then the rest of the areas in sort_order.
- **D-06:** Tap area card → navigate to existing `/h/[homeId]/areas/[areaId]` detail page (created in Phase 2).

### Person view (PERS-01..04)

- **D-07:** `/h/[homeId]/person` — shows the currently-authenticated user's slice:
  - Section 1 "Your tasks" — tasks where `resolveAssignee(task, area, members)` resolves to current user (via task-level OR area-default). Render using existing TaskRow component. Empty state: "Nothing assigned to you specifically."
  - Section 2 "Your history" — current user's completions (last 30 days by default, with "Show more" paginator). Uses existing completions collection filtered `completed_by_id = auth.id` for this home.
  - Section 3 "Your stats" — simple numbers: completions this week, completions this month, personal streak (weeks with ≥1 completion — count consecutive weeks backward from current week where the user logged ≥1 completion).
  - Section 4 "Notifications" — PLACEHOLDER section with disabled form fields: "Configure your ntfy topic (coming in Phase 6)". Set Phase 6 up to land a full form here.
- **D-08:** Personal streak formula: iterate backward by week from `now`; weeks the user had ≥1 completion. Stop at first week with 0. Pure function `computePersonalStreak(completions, now, timezone)`.

### History view (HIST-01..03)

- **D-09:** `/h/[homeId]/history` — reverse-chronological timeline of ALL household completions (not just current user's). Each row: avatar + "{person} completed {task_name} · {relative time}" + area chip. Group by day, with sticky day headers. Infinite-scroll (or "Load more" button for Phase 5 simplicity) showing 50 items per page.
- **D-10:** Filters: person (dropdown with home members + "Anyone"), area (dropdown with all areas + "All areas"), time range (segmented: Today / Week / Month / All). URL params persist filter state.
- **D-11:** "Who completed what" — "{person}" is rendered as the `completions.completed_by_id`'s name, "{task}" is the task's name at time of completion (tasks may have been edited; render current name — acceptable limitation for v1 per SPEC §7.5 append-only is about completions, not task names).

### First-run onboarding (ONBD-01..04)

- **D-12:** **Seed library** lives as static data in `lib/seed-library.ts` — a typed array of `{ name, frequency_days, suggested_area, icon, description }` entries covering Kitchen, Bathroom, Living areas, Yards, and Whole Home per ONBD-04. Examples:
  - Kitchen: Wipe benches (3d), Clean sink (7d), Mop floor (14d), Clean oven (90d), Deep-clean fridge (90d)
  - Bathroom: Wipe vanity (7d), Clean toilet (7d), Scrub shower (14d), Wash bath mat (30d)
  - Living areas: Vacuum (7d), Dust surfaces (14d), Wash cushions/throws (90d)
  - Yards: Mow lawn (14d, seasonal — always 14d for now), Weed flowerbeds (30d), Prune shrubs (90d)
  - Whole Home: Change smoke-alarm batteries (365d), Test RCD (180d), Check gutters (180d), Pest control (365d), Fire-extinguisher check (365d)
  
  Total ~30 seed tasks. All frequencies default to `cycle` mode.

- **D-13:** `/h/[homeId]/onboarding` — multi-step wizard:
  1. Greeting: "Welcome to {home.name}. Let's seed some starter tasks — you can skip anything that doesn't fit."
  2. For each area in the seed library, show a section: "Kitchen (7 tasks)" with each task as a card: [✓ Add] [Edit] [Skip]. Default all to "Add".
  3. Edit action opens inline expand: user can change frequency, rename, pick different area, change mode.
  4. Skip action excludes that seed from the batch.
  5. Floating "Add {N} tasks" button at bottom. Click → batch create all non-skipped tasks via server action → redirect to `/h/[homeId]` → `homes.onboarded` set true.
  6. "Skip all" link in header also sets `homes.onboarded=true` and redirects.

- **D-14:** On home creation in Phase 2/4, `homes.onboarded=false` by default. When user navigates to `/h/[homeId]` and `homes.onboarded === false`, redirect to `/onboarding`.

### Schema additions

- **D-15:** Migration `1714953604_homes_onboarded.js` — add `onboarded` boolean field (default false) to `homes` collection. Migrate existing records to `onboarded=true` (Phase 2/3/4 existing homes already have hand-created tasks; don't force them through onboarding retroactively).

### Nav component

- **D-16:** `components/bottom-nav.tsx` — 4 icons (Home, Grid, User, Clock) as a sticky bottom bar (mobile-first; hides on md+ in favor of top tabs). Uses existing Lucide icons. Active route highlighted with warm accent underline/bg.
- **D-17:** `components/top-tabs.tsx` — shadcn Tabs for md+ breakpoint, placed at the top of the home dashboard's layout (or global layout for `(app)`). Same 4 sections.

### Testing

- **D-18:** Unit: 
  - `lib/personal-streak.ts` matrix (0 weeks / 1 week / gap / long run)
  - `lib/area-coverage.ts` (scoped coverage — reuse `computeCoverage` with task-filter or extract a helper)
  - `lib/history-filter.ts` (person / area / time range filter predicate)
  - `lib/seed-library.ts` (type assertions only)
- **D-19:** E2E:
  - Suite A (onboarding): new user → signup → create home → redirected to /onboarding → accept 3, edit 1, skip the rest → redirected to dashboard → three bands have those 3 tasks
  - Suite B (by-area): dashboard → bottom-nav By Area → cards show correct counts → tap Kitchen → see Kitchen tasks
  - Suite C (person): dashboard → Person → see tasks assigned to me (after setting up cascade tasks)
  - Suite D (history): complete a task in suite context → History → see it in timeline → filter by person/area → results narrow

### UI polish

- **D-20:** Bottom nav styling: use warm-accent for active, muted for inactive. Height 56px. Safe-area-inset-bottom padding for iOS.
- **D-21:** By Area cards: shadcn Card with area color as a left accent border (4px, home.icon color muted). Hover:lift (subtle).
- **D-22:** Empty states on each view:
  - By Area empty (no areas beyond Whole Home): "Add an area to organize tasks"
  - Person empty: "Nothing is assigned to you right now"
  - History empty: "No completions yet — your history starts with the first check ✓"

### Claude's Discretion
- Exact icon choices per seed task (use Lucide names)
- Exact wording of wizard copy (stays calm + warm)
- Sub-pagination size for history (default 50)
- Whether to include seed-library re-invocation button in Settings (defer if time-tight)

</decisions>

<canonical_refs>
- `SPEC.md` §8.2 By Area view
- `SPEC.md` §8.3 Person view
- `SPEC.md` §8.4 History view
- `SPEC.md` §11 Seed task library
- Phase 4 summaries for cascading assignee (resolveAssignee)
- Phase 3 summaries for band classification + coverage computation
- lib/assignment.ts — Phase 4 cascade resolver
- lib/coverage.ts, lib/band-classification.ts — Phase 3 pure fns (extend for per-area filtering)
- components/task-row.tsx, components/task-band.tsx — reusable UI
- components/home-switcher.tsx + account-menu.tsx — nav pattern
</canonical_refs>

<specifics>
- Bottom nav: 4 icons Home / Grid (by-area) / User (person) / Clock (history). Labels visible on small screens too (not just icons).
- Onboarding wizard: 5-10 minutes to complete. Default-on all seeds so the user just has to click "Add 30 tasks" (with the option to skip). Warm greeting.
- History grouping: "Today", "Yesterday", then dates. Sticky headers.
- Personal streak: never show "0 weeks" with a sad face — show "New week — let's go!" copy.
</specifics>

<deferred>
- Re-invoke wizard for existing homes — Settings action, post-v1
- Seed tasks with photos / guides — v1.1
- Year-in-review — v1.1
- Actual notification prefs form (Phase 6 owns)
</deferred>

---

*Phase: 05-views-onboarding*
*Context gathered: 2026-04-21 via autonomous yolo-mode synthesis*
