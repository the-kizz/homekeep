# Phase 2: Auth & Core Data - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning
**Source:** Autonomous yolo-mode context synthesis from SPEC.md §6, §7, §8.5, §13, §19 and ROADMAP phase 2.

<domain>
## Phase Boundary

Enable a **single user** (authenticated) to create an account, log in/out, manage one or more homes, manage areas within each home, and define tasks (with frequency + schedule mode) under those areas. The core data model for the maintenance app is stood up end-to-end: PocketBase collections, PocketBase migrations as schema-as-code, authenticated UI pages, and the next-due computation function (SPEC §8.5).

**Explicitly NOT in Phase 2:**
- Three-band main view (Phase 3)
- Task completion, coverage ring, early-completion guard (Phase 3)
- Collaboration / multiple members on a home (Phase 4)
- Views (By Area, Person, History), seed library wizard (Phase 5)
- Notifications, streaks, celebrations (Phase 6)
- PWA manifest, HTTPS modes (Phase 7)
- OAuth providers beyond email/password (deferred to later milestone)
- Area groups (§7.4 explicitly v1.1)

</domain>

<decisions>
## Implementation Decisions

### Auth (AUTH-01..04)

- **D-01:** Use PocketBase's built-in `users` collection (auth type). Email + password. No third-party OAuth in v1.
- **D-02:** Password reset via PocketBase's built-in email template + SMTP. SMTP config is runtime env-driven (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). Document example values in `.env.example`. If SMTP is not configured, password reset silently no-ops with a UI message "Password reset unavailable — contact admin" (graceful degradation).
- **D-03:** Session lives in an **HTTP-only, Secure (when HTTPS), SameSite=Lax** cookie named `pb_auth`. The cookie holds the PocketBase authStore payload (token + model) produced by `pb.authStore.exportToCookie()`. Server Components read it via `cookies()` (Next.js), create a fresh PB client per request, and call `pb.authStore.loadFromCookie(cookieStr)`. Client Components share it transparently via `pb.authStore` defaults + `onChange` sync.
- **D-04:** Route groups: `(public)` = `/`, `/login`, `/signup`, `/reset-password`, `/reset-password/[token]` (accessible when unauthed). `(app)` = everything under `/h/…` (requires auth; middleware redirects to `/login?next=…`).
- **D-05:** Extend the PocketBase `users` collection with one custom field: `last_viewed_home_id` (relation → `homes`, nullable). Updated on every home switch. Used for HOME-03 (land on last-viewed home after login).
- **D-06:** Password requirements: 8+ chars. Rely on PB validation server-side; mirror the minimum in the client form with `react-hook-form` + `zod`.
- **D-07:** Logout button lives in the top-right account menu (shadcn DropdownMenu). Clicking clears the cookie via a server action and redirects to `/login`. Works from every `/h/*` route (AUTH-03).

### Data Model (homes, areas, tasks — HOME-01..04, AREA-01..05, TASK-01, 05-08)

- **D-08:** Schema-as-code via PocketBase migrations under `pocketbase/pb_migrations/`. Each migration is a timestamped JS file per the PB docs. First migration (`1697000000_init_homekeep.js`) creates all four collections (users extension, homes, areas, tasks). Migrations run automatically on PB start.
- **D-09:** **homes** collection: `name` (text, required, max 100), `address` (text, optional, max 200), `timezone` (text, required, default `Australia/Perth`), `owner_id` (relation → users, required, cascade delete: set to null on user delete — but we actually want to block deleting a user who owns a home; enforce via collection rule). `created` / `updated` auto. API rules: only owner can read/list/update/delete; create requires auth.
- **D-10:** **areas** collection: `home_id` (relation → homes, required, cascade delete), `name` (text, required, max 60), `icon` (text — Lucide icon name, default `home`), `color` (text — hex `#RRGGBB`, default `#D4A574` warm accent from §19), `sort_order` (number, default 0), `scope` (select: `location` | `whole_home`, default `location`), `default_assignee_id` (relation → users, optional — nullable even though single-user in phase 2, schema supports it for Phase 4), `is_whole_home_system` (bool, default false — set true for the auto-created Whole Home, prevents deletion). API rules: auth required; home's owner-only access.
- **D-11:** **Auto-create Whole Home:** implemented inside the same init migration via a PocketBase JS hook file: `pocketbase/pb_hooks/homes_create.pb.js` — on `onRecordCreate` for `homes`, create an area with `{name: "Whole Home", scope: "whole_home", is_whole_home_system: true, sort_order: 0}`. PB hooks are automatically loaded from `pb_hooks/`.
- **D-12:** **tasks** collection: `home_id` (relation → homes, required, cascade), `area_id` (relation → areas, required, cascade), `name` (text, required, max 120), `description` (editor/text, optional), `frequency_days` (number, required, min 1), `schedule_mode` (select: `cycle` | `anchored`, default `cycle`), `anchor_date` (date, nullable — only used when `schedule_mode=anchored`), `icon` (text, optional), `color` (text, optional), `assigned_to_id` (relation → users, nullable), `notes` (text, optional), `archived` (bool, default false), `archived_at` (date, nullable). API rules: auth required, home's owner-only.
- **D-13:** **Next due computation is pure + derived**, never stored. Lives in `lib/task-scheduling.ts`:
  ```
  computeNextDue(task, lastCompletion, now) →
    if task.archived: return null
    if schedule_mode === 'cycle':
      base = lastCompletion?.completed_at ?? task.created
      return addDays(base, task.frequency_days)
    if schedule_mode === 'anchored':
      base = task.anchor_date ?? task.created
      elapsed = daysBetween(base, now)
      cycles = Math.ceil(elapsed / task.frequency_days)
      return addDays(base, cycles * task.frequency_days)
  ```
  Completions collection doesn't exist in Phase 2 (added in Phase 3); for phase 2 `lastCompletion` is always null, so next_due is always `created + frequency_days` for cycle mode. This is acceptable: the tasks are createable and next_due is correctly computed off `created`; Phase 3 will attach completions and retest.

### UI Stack

- **D-14:** Install **shadcn/ui** (Tailwind 4 compatible) — `npx shadcn@latest init` with the "new-york" style + the warm neutral base. Install these components: `button`, `input`, `label`, `card`, `form`, `select`, `dialog`, `dropdown-menu`, `toast` (sonner), `tabs`, `separator`. New components pulled in later phases as needed.
- **D-15:** Forms use **react-hook-form + zod** for validation. One zod schema per resource (signup, login, home, area, task); shared between client form and server action.
- **D-16:** Mutations use **Next.js server actions** (no separate API routes unless PB needs to be hit via authed cookie + revalidate). Reads use Server Components where possible; Client Components only for forms + interactive widgets. Use `revalidatePath` / `revalidateTag` appropriately.
- **D-17:** Drag-to-reorder areas (AREA-05): use **@dnd-kit/core + @dnd-kit/sortable** (modern, accessible, works with server actions). Saves `sort_order` via batched server action on drop.
- **D-18:** Design tokens from SPEC §19: soft neutrals + one warm accent color (#D4A574 terracotta-sand). Rounded corners (rounded-lg / rounded-xl, not pill). Humanist sans for UI (Inter via next/font — already Phase 1). Add serif for headings later (Phase 3+). No gradients, no shadows stronger than `shadow-sm`.
- **D-19:** Color picker for areas: fixed palette of 8 warm tones (not a color wheel). Icon picker: grid of ~24 Lucide icons common to homes (Home, Trees, Bed, UtensilsCrossed, Bath, Car, Wrench, etc.).

### Routing Map

- `/` — public landing (minimal; sign-up CTA + redirect-to-app if authed)
- `/signup` — email + password + name
- `/login` — email + password
- `/logout` — server action only
- `/reset-password` — request reset email
- `/reset-password/[token]` — set new password
- `/h` — list of homes (user picks or creates)
- `/h/[homeId]` — home dashboard (areas list + task count per area; Phase 3 adds bands)
- `/h/[homeId]/areas` — full area management (list, create, edit, reorder)
- `/h/[homeId]/areas/[areaId]` — area detail page (tasks in that area)
- `/h/[homeId]/tasks/new` — create task (area pre-selected via query param from area page)
- `/h/[homeId]/tasks/[taskId]` — view/edit/archive task
- `/settings` — basic account (email change, password change, logout)

### Testing

- **D-20:** Unit tests (Vitest): `lib/task-scheduling.ts` (cycle + anchored + edge cases), zod schemas (valid + invalid inputs), the Whole Home auto-create hook (assert the migration + hook run against a fresh PB in an integration test using `dev-pb.js` to boot an isolated instance).
- **D-21:** E2E (Playwright): one happy-path suite: sign up → create home → verify Whole Home exists → create a Kitchen area → create a task → see task in area detail → log out → log back in → land on last-viewed home. Runs against the built standalone app against dev-mode PocketBase (same infra as Phase 1 tests).

### Claude's Discretion
- Exact shadcn component versions
- Specific Lucide icons chosen for the icon picker
- Visual polish of forms (spacing, font sizes) within the warm/calm envelope
- Exact wording of error messages and success toasts
- Server action file organization (colocated vs `/app/actions/`)

</decisions>

<canonical_refs>
## Canonical References

### Project Specification
- `SPEC.md` §6 — Feature scope (auth, homes, areas, tasks in v1)
- `SPEC.md` §7 — Data model (homes/areas/tasks fields)
- `SPEC.md` §7.2 — Areas scope (location vs whole_home) + auto-created Whole Home
- `SPEC.md` §7.5 — Integer frequency, derived next-due, append-only completions
- `SPEC.md` §8.5 — Completion model (cycle vs anchored)
- `SPEC.md` §13 — Tech stack (Next.js, PocketBase, Tailwind, shadcn/ui)
- `SPEC.md` §16 — Security (env vars, no telemetry, MIT)
- `SPEC.md` §19 — Design direction (warm/calm/domestic; soft neutrals + warm accent; humanist sans)

### Prior Phase Artifacts
- `.planning/phases/01-scaffold-infrastructure/01-CONTEXT.md` — baseline decisions (Tailwind 4, Vitest, Playwright, Next.js 16 App Router)
- `.planning/phases/01-scaffold-infrastructure/01-01-SUMMARY.md` — installed stack + version pins
- `.planning/phases/01-scaffold-infrastructure/01-RESEARCH.md` — PocketBase JS SDK usage, same-origin cookie pattern

### Requirements (phase 2)
- AUTH-01..04 · HOME-01..04 · AREA-01..05 · TASK-01, 05, 06, 07, 08

</canonical_refs>

<code_context>
## Existing Code (from Phase 1)

### Reusable Assets
- `lib/pocketbase.ts` — `createPocketBaseClient()` factory: server-side reads env, returns a fresh PB client per call (same-origin safe). Phase 2 extends with `createServerClientFromCookie(cookieString)`.
- `app/api/health/route.ts` — baseline API route pattern
- `tests/unit/pocketbase.test.ts` — mocking pattern for PB client
- `tests/setup.ts` — Vitest setup
- `playwright.config.ts` — E2E boot pattern

### PocketBase assets
- `pocketbase/pb_migrations/.gitkeep` — phase 2 drops migrations here
- `pocketbase/pb_hooks/` — does NOT exist yet; phase 2 creates it
- dev-pb runner in `scripts/dev-pb.js` boots a local PB with migrations + hooks loaded from `pocketbase/`

### Patterns established
- Server actions over API routes for mutations
- Zod for validation
- Grep-verifiable acceptance criteria on every task
- Commit-per-task discipline

</code_context>

<specifics>
## Specific Ideas

- **Warm accent color:** `#D4A574` (terracotta-sand) as the primary accent — used for CTAs and one dot of visual warmth per screen. NOT a loud red.
- **First-run UX:** after signup → redirect to `/h`, which shows "Create your first home" empty state with a single form card.
- **Home switcher:** top-left dropdown showing current home name. Click opens list of the user's homes + "Create another home" link. On select, updates `users.last_viewed_home_id` and navigates to `/h/[id]`.
- **Area default on empty:** a brand-new home shows just the "Whole Home" area with zero tasks + a subtle "+ Add area" card. No clutter.
- **"Delete home" path:** in Settings → Danger Zone. Requires typing the home name to confirm. Cascades to areas + tasks.
- **Task creation form:** single screen. Fields: name, area (dropdown, pre-selected if navigated from an area), frequency (days input OR a "Weekly/Monthly/Quarterly/Yearly" quick-select that fills 7/30/90/365), schedule mode (radio: Cycle (default) / Anchored), optional anchor date (only shown if anchored), optional notes.
</specifics>

<deferred>
## Deferred Ideas

- Area groups — SPEC §7.4 explicitly v1.1
- Multi-member homes — Phase 4
- Completion tracking + history — Phase 3 (completions collection created in Phase 3)
- OAuth providers — future milestone (can be added via PB admin UI later without code change)
- Task rotation (`rotation_enabled`) — Phase 4 (depends on members)
- Year-in-review — v1.1

</deferred>

---

*Phase: 02-auth-core-data*
*Context gathered: 2026-04-20 via autonomous yolo-mode synthesis (user asleep)*
