# Phase 2: Auth & Core Data - Research

**Researched:** 2026-04-20
**Domain:** PocketBase-backed auth + schema-as-code + Next.js 16 App Router SSR + shadcn/Tailwind 4 UI
**Confidence:** HIGH (PocketBase 0.37 API verified live against local binary; Next.js 16 cookie API verified against official docs)

## Summary

Phase 2 delivers single-user signup/login/logout/password-reset plus CRUD for homes, areas, and tasks. The core implementation surface splits cleanly into three tiers:

1. **PocketBase schema + hooks** (`pocketbase/pb_migrations/*.js` + `pocketbase/pb_hooks/*.pb.js`) — declarative collection creation using the JSVM API verified in v0.37.1 (`new Collection({...})`, `new TextField`, `new RelationField`, API rules via `listRule`/`viewRule`/`createRule`/`updateRule`/`deleteRule` strings).
2. **Next.js SSR-safe cookie bridge** (`lib/pocketbase-server.ts` + `lib/pocketbase-browser.ts`) — per-request PB client hydrated from `pb_auth` cookie, written via server actions using Next 16's **async** `cookies()` API, and gated with a root-level `proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`).
3. **shadcn/ui forms + @dnd-kit reorder** — zod schemas shared between client (`react-hook-form` + `@hookform/resolvers`) and server action, with `useActionState` surfacing server errors.

**Primary recommendation:** Implement schema via a single timestamped JS migration that creates `homes`, `areas`, `tasks` and extends the built-in `users` collection with `last_viewed_home_id`. Use a separate `pb_hooks/homes_whole_home.pb.js` file (loaded automatically from `pb_hooks/`) for the Whole Home auto-create hook — targeted via the `"homes"` tag on `onRecordCreateExecute` to avoid recursion. Split the PB JS SDK into server (cookie-bound, per-request) and browser (singleton with `onChange` sync) factories. **Critical Next 16 fact:** rename the middleware file to `proxy.ts` with `export function proxy(request)` — `middleware.ts` still works but is deprecated.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Auth (AUTH-01..04)**
- **D-01:** Use PocketBase's built-in `users` collection (auth type). Email + password. No third-party OAuth in v1.
- **D-02:** Password reset via PocketBase's built-in email template + SMTP. SMTP config is runtime env-driven (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). Document example values in `.env.example`. If SMTP is not configured, password reset silently no-ops with a UI message "Password reset unavailable — contact admin" (graceful degradation).
- **D-03:** Session lives in an **HTTP-only, Secure (when HTTPS), SameSite=Lax** cookie named `pb_auth`. The cookie holds the PocketBase authStore payload (token + model) produced by `pb.authStore.exportToCookie()`. Server Components read it via `cookies()` (Next.js), create a fresh PB client per request, and call `pb.authStore.loadFromCookie(cookieStr)`. Client Components share it transparently via `pb.authStore` defaults + `onChange` sync.
- **D-04:** Route groups: `(public)` = `/`, `/login`, `/signup`, `/reset-password`, `/reset-password/[token]` (accessible when unauthed). `(app)` = everything under `/h/…` (requires auth; middleware redirects to `/login?next=…`).
- **D-05:** Extend the PocketBase `users` collection with one custom field: `last_viewed_home_id` (relation → `homes`, nullable). Updated on every home switch. Used for HOME-03 (land on last-viewed home after login).
- **D-06:** Password requirements: 8+ chars. Rely on PB validation server-side; mirror the minimum in the client form with `react-hook-form` + `zod`.
- **D-07:** Logout button lives in the top-right account menu (shadcn DropdownMenu). Clicking clears the cookie via a server action and redirects to `/login`.

**Data Model**
- **D-08:** Schema-as-code via PocketBase migrations under `pocketbase/pb_migrations/`. Each migration is a timestamped JS file per the PB docs. First migration (`1697000000_init_homekeep.js`) creates all four collections (users extension, homes, areas, tasks). Migrations run automatically on PB start.
- **D-09:** **homes** collection: `name` (text, required, max 100), `address` (text, optional, max 200), `timezone` (text, required, default `Australia/Perth`), `owner_id` (relation → users, required). API rules: only owner can read/list/update/delete; create requires auth.
- **D-10:** **areas** collection: `home_id` (relation → homes, required, cascade delete), `name` (text, required, max 60), `icon` (text — Lucide icon name, default `home`), `color` (text — hex `#RRGGBB`, default `#D4A574`), `sort_order` (number, default 0), `scope` (select: `location` | `whole_home`, default `location`), `default_assignee_id` (relation → users, optional — nullable), `is_whole_home_system` (bool, default false). API rules: auth required; home's owner-only access.
- **D-11:** **Auto-create Whole Home:** PocketBase JS hook file `pocketbase/pb_hooks/homes_create.pb.js` — on `onRecordCreate` for `homes`, create an area with `{name: "Whole Home", scope: "whole_home", is_whole_home_system: true, sort_order: 0}`.
- **D-12:** **tasks** collection fields per D-12 (home_id, area_id, name, description, frequency_days, schedule_mode, anchor_date, icon, color, assigned_to_id, notes, archived, archived_at). API rules: auth required, home's owner-only.
- **D-13:** **Next due computation** is pure + derived in `lib/task-scheduling.ts` (cycle vs anchored algorithms per CONTEXT.md).

**UI Stack**
- **D-14:** Install **shadcn/ui** (Tailwind 4 compatible) — `npx shadcn@latest init` with the "new-york" style + the warm neutral base. Components: `button`, `input`, `label`, `card`, `form`, `select`, `dialog`, `dropdown-menu`, `toast` (sonner), `tabs`, `separator`.
- **D-15:** Forms use **react-hook-form + zod** with shared schemas (client form + server action).
- **D-16:** Mutations via **Next.js server actions**; reads via Server Components where possible. Use `revalidatePath` / `revalidateTag`.
- **D-17:** Drag-to-reorder uses **@dnd-kit/core + @dnd-kit/sortable**. Batched server action on drop.
- **D-18:** Design tokens from SPEC §19: soft neutrals + warm accent `#D4A574`. Rounded-lg / rounded-xl. Inter humanist sans. No gradients, no shadows stronger than `shadow-sm`.
- **D-19:** Color picker: fixed palette of 8 warm tones. Icon picker: grid of ~24 Lucide icons.

**Routing Map** — see CONTEXT.md §Routing Map (verbatim reference; all routes listed are in scope).

**Testing**
- **D-20:** Vitest: `lib/task-scheduling.ts`, zod schemas, Whole Home hook integration against a disposable PB.
- **D-21:** Playwright E2E happy-path: signup → create home → Whole Home exists → Kitchen area → task → logout → login → last-viewed home.

### Claude's Discretion
- Exact shadcn component versions
- Specific Lucide icons chosen for the icon picker
- Visual polish of forms (spacing, font sizes) within warm/calm envelope
- Exact wording of error messages and success toasts
- Server action file organization (colocated vs `/app/actions/`)

### Deferred Ideas (OUT OF SCOPE)
- Area groups — SPEC §7.4 explicitly v1.1
- Multi-member homes — Phase 4 (but nullable `default_assignee_id` / `assigned_to_id` schema supports future rollout)
- Completion tracking + history — Phase 3
- OAuth providers — future milestone
- Task rotation (`rotation_enabled`) — Phase 4
- Year-in-review — v1.1
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User can sign up with email and password | §Pattern: Auth Server Actions (signup); §zod signup schema; PB `users` collection (system auth type) |
| AUTH-02 | User can log in and session persists across browser refresh | §Pattern: SSR cookie bridge (`loadFromCookie` + `exportToCookie`); `pb_auth` cookie with `maxAge` ≥ token TTL |
| AUTH-03 | User can log out from any page | §Pattern: Logout server action (clear cookie); DropdownMenu wired into `(app)` layout per D-07 |
| AUTH-04 | User can reset password via email link | §Password-reset Flow; SMTP via `$app.settings().smtp` set from `onBootstrap` reading env vars; `/api/collections/users/request-password-reset` + `confirm-password-reset` endpoints (via SDK) |
| HOME-01 | User can create a home with name and optional address | §Schema-as-code Migration — homes collection; §createHome server action |
| HOME-02 | User can have multiple homes | Relation `owner_id` on homes is 1→N; API rules scope reads to `owner_id = @request.auth.id`; `/h` list page |
| HOME-03 | User lands on last-viewed home by default after login | D-05: `last_viewed_home_id` field on users; updated on home switch via server action; `/h` Server Component redirects to `/h/[last_viewed_home_id]` when set |
| HOME-04 | User can switch between homes via nav | HomeSwitcher dropdown Client Component; server action updates `last_viewed_home_id` + `router.push` |
| AREA-01 | User can create areas within a home (location or whole_home scope) | §Schema — areas collection with `scope` select field |
| AREA-02 | Each home auto-creates one "Whole Home" area that cannot be deleted | §Pattern: Whole Home auto-create hook (`onRecordCreateExecute`, tag="homes"); `is_whole_home_system: true` flag + UI-level delete guard |
| AREA-03 | User can set a default assignee per area | `default_assignee_id` relation field nullable; Phase 2 has only one user but schema is forward-compat |
| AREA-04 | Areas have name, icon, color, sort order | §Schema — areas collection |
| AREA-05 | User can edit and reorder areas | §Pattern: @dnd-kit SortableList + batch server action updating `sort_order` |
| TASK-01 | User can create a task with name, frequency (days), area, optional notes | §Schema — tasks; §Task form Client Component |
| TASK-05 | User can set schedule mode per task (cycle or anchored, default: cycle) | Select field `schedule_mode`; `anchor_date` conditionally shown |
| TASK-06 | User can add custom tasks beyond seed library | Seed library is Phase 5; custom task creation is the default in Phase 2 |
| TASK-07 | User can edit and archive tasks | `archived` bool + `archived_at` date; edit server action |
| TASK-08 | Next due date is computed, never stored | §Next-due computation — `lib/task-scheduling.ts` with pure function + unit test matrix |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schema definition & integrity | PocketBase migrations (`pb_migrations/`) | — | Schema-as-code runs on PB start; PB owns all FK/cascade enforcement at the DB level. |
| Auth: password hash, token issue, password reset email | PocketBase (`users` auth collection) | — | PB handles bcrypt, JWT issue/validation, reset token generation + email delivery. Never hand-roll. |
| Session cookie (issue/read/clear) | Next.js server actions + middleware/proxy | PocketBase (SDK's `exportToCookie`) | Next must own the `Set-Cookie` header (HTTP spec limits this to the framework that owns the response). PB SDK produces the cookie *string*; Next writes it. |
| Route guarding for `(app)` routes | Next.js `proxy.ts` (root) | — | Runs before render; redirects unauthed → `/login?next=…` without rendering React. |
| CRUD against collections (homes/areas/tasks) | Server Actions (mutations) + Server Components (reads) | PB SDK | App-code owns validation + `revalidatePath`; PB owns persistence + API rule enforcement. |
| Derived state (next-due date) | `lib/task-scheduling.ts` (pure function) | — | Never stored in PB per D-13 / SPEC §7.5. Unit-testable in isolation. |
| Whole Home auto-create on home-create | PB hook (`pb_hooks/homes_*.pb.js`) | — | DB-side trigger. Prevents drift if a future surface bypasses server actions (e.g. PB admin UI, direct SDK). |
| Form validation | zod schema (shared) | react-hook-form (client) + server action (server) | Same schema runs on both sides; RHF gives instant client UX, server action `safeParse` is the trust boundary. |
| Drag-to-reorder UI + persistence | @dnd-kit/sortable (client) | Batch server action (`updateAreaOrder`) | dnd-kit handles keyboard/a11y; one batched PB write per drop to avoid N round trips. |
| Per-area icon/color/name display | Tailwind 4 CSS variables | — | `--accent-warm: #D4A574` in `@theme inline`; Lucide icon looked up by name string. |

## Standard Stack

### Core (new in Phase 2)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react-hook-form` | 7.73.1 | Client form state + validation | [VERIFIED: `npm view react-hook-form version` 2026-04-20]. Peer: react >=16.8 — React 19 compatible. Industry-standard form lib for React. |
| `@hookform/resolvers` | 5.2.2 | Zod → RHF adapter | [VERIFIED: `npm view @hookform/resolvers version`]. Peer requires `react-hook-form ^7.55.0` — our 7.73.1 satisfies this. |
| `zod` | bump to 4.3.6 | Schema validation (already 4.1.0 from Phase 1) | [VERIFIED: `npm view zod version` → 4.3.6 latest 4.x, published recently]. Newer 4.3.6 tightens error map API but API-compatible with 4.1.0. Bump opportunistic; 4.1.0 would also work. |
| `@dnd-kit/core` | 6.3.1 | Drag-and-drop primitives | [VERIFIED: `npm view @dnd-kit/core version`]. Peer: react >=16.8 — React 19 compatible. |
| `@dnd-kit/sortable` | 10.0.0 | Sortable list preset | [VERIFIED: `npm view @dnd-kit/sortable version`]. Peer: `@dnd-kit/core ^6.3.0` matches. |
| `@dnd-kit/utilities` | 3.2.2 | CSS transform helpers | [VERIFIED]. Used for `CSS.Transform.toString(transform)` in sortable items. |
| `sonner` | 2.0.7 | Toast notifications | [VERIFIED]. shadcn's official replacement for the old toast component. |
| `lucide-react` | 1.8.0 | Icon library | [VERIFIED: `npm view lucide-react version`]. SPEC §19 specifies lucide-react. |
| `date-fns-tz` | 3.2.0 | IANA timezone → UTC conversion | [VERIFIED: `npm view date-fns-tz version`]. Needed for home's `timezone` field → next-due render. Complements already-installed `date-fns@4.1.0`. |
| shadcn CLI | 4.3.1 | Component scaffolder | [VERIFIED: `npm view shadcn version`]. Tailwind 4 compatible [CITED: https://ui.shadcn.com/docs/tailwind-v4]. Not a runtime dep — copies source into `components/ui/`. |

### Already Installed (from Phase 1, reused)

| Library | Version | Where Used |
|---------|---------|------------|
| `next` | 16.2.4 | Server actions, cookies API, proxy.ts |
| `react` / `react-dom` | 19.2.5 | useActionState, Server Components |
| `pocketbase` (JS SDK) | 0.26.8 | Client + server; matches PB server 0.37.1 major-compat |
| `tailwindcss` | 4.2.2 | CSS-first config (no `tailwind.config.js`); `@theme inline` for shadcn tokens |
| `date-fns` | 4.1.0 | Date math in task-scheduling |
| `zod` | 4.1.0 → optionally bump to 4.3.6 | Shared schemas |

### Installation Commands

```bash
# Form + validation
npm install react-hook-form@7.73.1 @hookform/resolvers@5.2.2

# Drag-to-reorder
npm install @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2

# Icons + timezone
npm install lucide-react@1.8.0 date-fns-tz@3.2.0

# shadcn init (interactive)
npx shadcn@4.3.1 init
#   → choose "new-york" style
#   → base color: "stone" (warmest of the five options — neutral/zinc/stone/gray/slate)
#   → css variables: yes
#   → install lucide-react: yes (already pinned above)

# shadcn components
npx shadcn@4.3.1 add button input label card form select dialog dropdown-menu tabs separator sonner
```

**Version verification (2026-04-20, `npm view <pkg> version`):** All versions above resolve on the public registry.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@dnd-kit/sortable` 10.x | `@dnd-kit/react` 0.4.0 (new rewrite) | `@dnd-kit/react` is a separate, newer package [VERIFIED: `npm view @dnd-kit/react dist-tags` → latest 0.4.0]. Documentation is thinner and the API is different. Stick with the mature `@dnd-kit/core + sortable` line. |
| `react-hook-form` | `@tanstack/react-form`, plain `useActionState` + FormData | TanStack Form is newer; RHF is more widely documented. Plain `useActionState` works for simple forms but lacks client-side validation UX. |
| `zod` | `valibot`, `yup` | zod is already installed; ecosystem lock-in via `@hookform/resolvers/zod`. Keep. |
| `next-safe-action` | Plain server actions | `next-safe-action` wraps actions with zod validation nicely, but adds a dependency for a thin ergonomic win. Plain server actions + manual `safeParse` is sufficient and reads better. Skip. |
| `date-fns-tz` | `@js-temporal/polyfill` (Temporal API) | Temporal is the future but polyfill adds ~70KB and API is still in flux. `date-fns-tz` is proven, 11KB, and integrates with existing `date-fns@4.1.0`. |

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────┐
                        │  Browser                            │
                        │                                     │
                        │  Client Component (react-hook-form) │
                        │         │                           │
                        │         │ 1. submit(FormData)       │
                        │         ▼                           │
                        │  useActionState(loginAction)        │
                        │         │                           │
                        └─────────┼───────────────────────────┘
                                  │ HTTP POST (Next.js encoded
                                  │ action-fn payload)
                                  ▼
    ┌──────────────────────────────────────────────────────────┐
    │ Next.js 16 standalone server                             │
    │                                                          │
    │  proxy.ts  ─────────►  route group guard                 │
    │  (Next 16 rename of      - if !cookieValid && in (app):  │
    │   middleware.ts)           redirect /login?next=URL      │
    │                                                          │
    │  Server Action (lib/actions/auth.ts):                    │
    │    1. zod safeParse(FormData)                            │
    │    2. createServerClient() (fresh PB SDK instance)       │
    │    3. pb.collection('users').authWithPassword(...)       │
    │    4. (await cookies()).set('pb_auth',                   │
    │         pb.authStore.exportToCookie(...))                │
    │    5. revalidatePath('/h')                               │
    │    6. redirect('/h')                                     │
    │                                                          │
    │  Server Component (app/(app)/h/page.tsx):                │
    │    1. (await cookies()).get('pb_auth')                   │
    │    2. createServerClient(cookieStr)                      │
    │       → pb.authStore.loadFromCookie(cookieStr)           │
    │    3. await pb.collection('homes').getFullList({         │
    │         filter: `owner_id = "${authId}"`,                │
    │         sort: '-created'                                 │
    │       })                                                 │
    │    4. render home list                                   │
    └────────────────────────────┬─────────────────────────────┘
                                 │ PB SDK fetches to 127.0.0.1:8090
                                 │ (Caddy proxy transparent in prod;
                                 │  direct in dev)
                                 ▼
    ┌──────────────────────────────────────────────────────────┐
    │ PocketBase 0.37.1                                        │
    │                                                          │
    │  /api/collections/users/auth-with-password               │
    │  /api/collections/users/request-password-reset           │
    │  /api/collections/homes/records                          │
    │  /api/collections/areas/records                          │
    │  /api/collections/tasks/records                          │
    │                                                          │
    │  Migration runner (on start):                            │
    │    pb_migrations/1697000000_init_homekeep.js             │
    │      → creates 3 collections + extends users             │
    │                                                          │
    │  JSVM hooks (loaded from pb_hooks/):                     │
    │    homes_whole_home.pb.js:                               │
    │      onRecordCreateExecute(e => {...}, "homes")          │
    │        → creates "Whole Home" area atomically            │
    │    bootstrap_smtp.pb.js:                                 │
    │      onBootstrap(e => {                                  │
    │        if (process.env.SMTP_HOST) { ...configure }       │
    │      })                                                  │
    │                                                          │
    │  data.db (SQLite + WAL)                                  │
    └──────────────────────────────────────────────────────────┘
```

**Traceable flows:**
- *Signup:* form → `useActionState(signupAction)` → zod parse → `pb.collection('users').create({...})` → `authWithPassword()` → set cookie → redirect `/h` → empty state.
- *Home create:* `/h` "Create home" form → server action → `pb.collection('homes').create({name, owner_id})` → **PB hook fires** → `Whole Home` area row auto-inserted → `revalidatePath('/h')` → redirect `/h/[id]`.
- *Logout:* DropdownMenu → form with `logoutAction` → cookie.delete('pb_auth') → redirect `/login`.
- *Reorder areas:* drag area in `/h/[id]/areas` → @dnd-kit `onDragEnd` → local reorder + call `reorderAreas(homeId, newOrderIds[])` → server action batch-updates `sort_order` → `revalidatePath('/h/[id]/areas')`.

### Recommended Project Structure

```
homekeep/
├── app/
│   ├── (public)/
│   │   ├── page.tsx                      # Landing
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   ├── reset-password/page.tsx
│   │   └── reset-password/[token]/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx                    # shared nav + account menu
│   │   └── h/
│   │       ├── page.tsx                  # list/redirect
│   │       ├── [homeId]/
│   │       │   ├── page.tsx              # dashboard
│   │       │   ├── areas/
│   │       │   │   ├── page.tsx
│   │       │   │   └── [areaId]/page.tsx
│   │       │   └── tasks/
│   │       │       ├── new/page.tsx
│   │       │       └── [taskId]/page.tsx
│   │       └── settings/page.tsx
│   ├── globals.css                       # Tailwind 4 + shadcn tokens
│   ├── layout.tsx                        # existing
│   └── api/health/route.ts               # existing (Phase 1)
├── components/
│   ├── ui/                               # shadcn-generated (do not edit manually)
│   ├── forms/
│   │   ├── login-form.tsx                # Client — react-hook-form
│   │   ├── signup-form.tsx
│   │   ├── home-form.tsx
│   │   ├── area-form.tsx
│   │   └── task-form.tsx
│   ├── home-switcher.tsx                 # Client — DropdownMenu
│   ├── account-menu.tsx                  # Client — DropdownMenu (logout)
│   └── sortable-area-list.tsx            # Client — @dnd-kit
├── lib/
│   ├── pocketbase.ts                     # existing — keep as re-export shim
│   ├── pocketbase-server.ts              # NEW — createServerClient(cookieStr)
│   ├── pocketbase-browser.ts             # NEW — singleton with onChange
│   ├── task-scheduling.ts                # NEW — computeNextDue (pure)
│   ├── schemas/
│   │   ├── auth.ts                       # zod: signupSchema, loginSchema, resetRequestSchema, resetConfirmSchema
│   │   ├── home.ts                       # zod: homeSchema
│   │   ├── area.ts                       # zod: areaSchema
│   │   └── task.ts                       # zod: taskSchema, scheduleModeEnum
│   └── actions/
│       ├── auth.ts                       # signup, login, logout, requestReset, confirmReset
│       ├── homes.ts                      # createHome, updateHome, deleteHome, setLastViewedHome
│       ├── areas.ts                      # createArea, updateArea, reorderAreas
│       └── tasks.ts                      # createTask, updateTask, archiveTask
├── pocketbase/
│   ├── pb_migrations/
│   │   └── 1714780800_init_homekeep.js   # NEW — see §Pattern: Migration
│   └── pb_hooks/                         # NEW directory
│       ├── homes_whole_home.pb.js        # Whole Home auto-create
│       └── bootstrap_smtp.pb.js          # env-driven SMTP config
├── proxy.ts                              # NEW (root) — Next 16 rename of middleware
└── tests/
    ├── unit/
    │   ├── task-scheduling.test.ts       # comprehensive matrix
    │   ├── schemas/
    │   │   ├── auth.test.ts
    │   │   └── task.test.ts
    │   └── hooks-whole-home.test.ts      # integration: spin up PB, create home, assert Whole Home
    └── e2e/
        └── signup-to-task.spec.ts        # D-21 happy path
```

### Pattern: Schema-as-Code Migration

**What:** A single JS migration in `pocketbase/pb_migrations/` that runs on PB start, creates 3 new collections, and extends `users`.

**Verified against PB 0.37.1:** I generated a blank migration locally with `pocketbase migrate create test` and confirmed the template shape. API classes (`Collection`, `TextField`, `RelationField`, etc.) verified in the 24386-line `pb_data/types.d.ts` generated by PB.

**Key PB 0.37 gotchas baked in:**
- System auth collection is named `"users"` (user-facing name, unchanged). `_superusers` is a *separate* auth collection for admins — renamed from `_pb_admins` in v0.23.
- `cascadeDelete: true` on a `RelationField` makes the owning record delete when the target is deleted. **Confirmed in types.d.ts line 11634.** Note: this cascade means "if the related record is deleted, delete *this* row" — so on a `home_id` relation with `cascadeDelete: true`, deleting a home deletes its areas. This is what we want per D-10.
- API rules are string expressions: `@request.auth.id != "" && owner_id = @request.auth.id` [CITED: pocketbase.io/docs/collections/].
- `new Record(collection, {...data})` pattern for hooks; `$app.save(record)` persists.

**Complete migration file — `pocketbase/pb_migrations/1714780800_init_homekeep.js`:**

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // ========================================================================
  // 1. Create homes collection
  // ========================================================================
  const homes = new Collection({
    type: "base",
    name: "homes",
    fields: [
      new TextField({ name: "name", required: true, max: 100 }),
      new TextField({ name: "address", max: 200 }),
      new TextField({
        name: "timezone",
        required: true,
        // NOTE: default value for a text field is set via a separate form field
        // in PB dashboard; in migrations we use `autogeneratePattern` only for
        // auto-generated IDs. Default is enforced at app-code layer (server
        // action fills timezone from home-creator's locale or 'Australia/Perth').
      }),
      new RelationField({
        name: "owner_id",
        required: true,
        collectionId: app.findCollectionByNameOrId("users").id,
        cascadeDelete: false,  // block user delete while homes exist; UI-level confirm
        minSelect: 1,
        maxSelect: 1,
      }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE INDEX idx_homes_owner ON homes (owner_id)",
    ],
    // API rules — string expressions evaluated per-request
    listRule:   '@request.auth.id != "" && owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && owner_id = @request.auth.id',
    deleteRule: '@request.auth.id != "" && owner_id = @request.auth.id',
  });
  app.save(homes);

  // ========================================================================
  // 2. Create areas collection
  // ========================================================================
  const areas = new Collection({
    type: "base",
    name: "areas",
    fields: [
      new RelationField({
        name: "home_id",
        required: true,
        collectionId: homes.id,
        cascadeDelete: true,   // deleting a home deletes its areas
        minSelect: 1,
        maxSelect: 1,
      }),
      new TextField({ name: "name", required: true, max: 60 }),
      new TextField({ name: "icon", max: 40 }),               // default 'home' at app layer
      new TextField({ name: "color", max: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
      new NumberField({ name: "sort_order", onlyInt: true }),
      new SelectField({
        name: "scope",
        required: true,
        values: ["location", "whole_home"],
        maxSelect: 1,
      }),
      new RelationField({
        name: "default_assignee_id",
        collectionId: app.findCollectionByNameOrId("users").id,
        cascadeDelete: false,
        minSelect: 0,   // nullable
        maxSelect: 1,
      }),
      new BoolField({ name: "is_whole_home_system" }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE INDEX idx_areas_home ON areas (home_id)",
      "CREATE INDEX idx_areas_home_sort ON areas (home_id, sort_order)",
    ],
    // Access gated through the parent home's owner
    listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    // UI layer prevents delete when is_whole_home_system=true; schema allows it
    // because PB has no convenient "filter rule by field value" DSL. Adding a
    // boolean check is tempting but AREA-02 is enforced at app layer.
    deleteRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id && is_whole_home_system = false',
  });
  app.save(areas);

  // ========================================================================
  // 3. Create tasks collection
  // ========================================================================
  const tasks = new Collection({
    type: "base",
    name: "tasks",
    fields: [
      new RelationField({
        name: "home_id",
        required: true,
        collectionId: homes.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new RelationField({
        name: "area_id",
        required: true,
        collectionId: areas.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new TextField({ name: "name", required: true, max: 120 }),
      new EditorField({ name: "description" }),
      new NumberField({ name: "frequency_days", required: true, min: 1, onlyInt: true }),
      new SelectField({
        name: "schedule_mode",
        required: true,
        values: ["cycle", "anchored"],
        maxSelect: 1,
      }),
      new DateField({ name: "anchor_date" }),
      new TextField({ name: "icon", max: 40 }),
      new TextField({ name: "color", max: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
      new RelationField({
        name: "assigned_to_id",
        collectionId: app.findCollectionByNameOrId("users").id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      }),
      new TextField({ name: "notes", max: 2000 }),
      new BoolField({ name: "archived" }),
      new DateField({ name: "archived_at" }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE INDEX idx_tasks_home ON tasks (home_id)",
      "CREATE INDEX idx_tasks_area ON tasks (area_id)",
      "CREATE INDEX idx_tasks_home_archived ON tasks (home_id, archived)",
    ],
    listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    deleteRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
  });
  app.save(tasks);

  // ========================================================================
  // 4. Extend built-in users collection with last_viewed_home_id (D-05)
  // ========================================================================
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new RelationField({
    name: "last_viewed_home_id",
    collectionId: homes.id,
    cascadeDelete: false,  // if home deleted, field nullifies automatically
    minSelect: 0,
    maxSelect: 1,
  }));
  app.save(users);
}, (app) => {
  // ========================================================================
  // DOWN migration — reverse order (leaf → root)
  // ========================================================================
  // Remove the users extension field first
  try {
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("last_viewed_home_id");
    app.save(users);
  } catch (_) { /* idempotent */ }

  // Drop tables in reverse-dependency order
  for (const name of ["tasks", "areas", "homes"]) {
    try {
      const c = app.findCollectionByNameOrId(name);
      app.delete(c);
    } catch (_) { /* idempotent */ }
  }
});
```

**Filename convention:** `<unix-timestamp>_<slug>.js`. Use `1714780800` (an arbitrary fixed timestamp ~2024-05-04) to keep a stable name across environments. The timestamp just provides ordering; the actual apply time is tracked in PB's `_migrations` table [CITED: pocketbase.io/docs/js-migrations/].

**To regenerate types when schema evolves:** `./pocketbase migrate collections --dir=./.pb/pb_data --migrationsDir=./pocketbase/pb_migrations` generates a snapshot migration. Useful for Phase 3+.

### Pattern: PocketBase Hook (Whole Home auto-create)

**What:** A JS file under `pb_hooks/` that registers a handler on `onRecordCreateExecute` (fires during the DB transaction, atomic with the home insert) filtered by the `"homes"` collection tag.

**Critical design note on hook choice:**
- `onRecordCreate` → fires BEFORE insert, inside validate; throwing here rolls back.
- `onRecordCreateExecute` → fires DURING the DB execute step, inside the same transaction as the save. **Use this** — the Whole Home area and the home are created atomically or not at all.
- `onRecordAfterCreateSuccess` → fires AFTER the transaction commits. If the hook fails, the home exists without a Whole Home area. Reject.

[CITED: pocketbase.io/docs/js-overview/ confirms `$app.save()` works inside hook handlers; hook tags filter by collection name]. Verified against `types.d.ts` line 1329 signature: `onRecordCreateExecute(handler, ...tags)`.

**File — `pocketbase/pb_hooks/homes_whole_home.pb.js`:**

```javascript
/// <reference path="../pb_data/types.d.ts" />

// Fires inside the same DB transaction as the home insert.
// If this throws, the home insert is rolled back.
onRecordCreateExecute((e) => {
  // Recursion guard — we only fire on homes; nothing here creates another home.
  // But be explicit for future readers.
  if (e.record.collection().name !== "homes") {
    e.next();
    return;
  }

  const areas = e.app.findCollectionByNameOrId("areas");
  const wholeHome = new Record(areas, {
    home_id:              e.record.id,
    name:                 "Whole Home",
    scope:                "whole_home",
    sort_order:           0,
    is_whole_home_system: true,
    icon:                 "home",
    color:                "#D4A574",
  });

  // saveNoValidate would skip field validation; use save() so zod-equivalent
  // server-side validation (required/min/max) runs. If it throws, the outer
  // transaction rolls back.
  e.app.save(wholeHome);

  e.next();
}, "homes");
```

**How hooks are loaded:** PB scans `pb_hooks/` at startup for files matching `*.pb.js` and loads them in filename sort order [CITED: pocketbase.io/docs/js-overview/]. The `dev-pb.js` script already passes `--migrationsDir`; we need to add `--hooksDir` too. Update Phase 1's dev-pb to pass `--hooksDir=./pocketbase/pb_hooks`.

**Recursion avoidance:** The hook creates an `areas` record, not a `homes` record, so the `"homes"`-tagged hook does not re-fire. PB hooks are tag-filtered; creating an area triggers any `"areas"`-tagged handlers (none here in Phase 2).

**Error handling:** Uncaught exceptions inside `onRecordCreateExecute` propagate up and roll back the transaction. The caller (signup server action) sees a PocketBase error and surfaces it through `useActionState`.

### Pattern: SSR Cookie Bridge (the D-03 linchpin)

**What:** Two files replacing Phase 1's single `lib/pocketbase.ts`:
- `lib/pocketbase-server.ts` — **per-request** PB client factory that takes a cookie string and hydrates the authStore.
- `lib/pocketbase-browser.ts` — **singleton** browser client hydrated from `document.cookie` at construction time with `onChange` callback to re-sync on auth changes.

**Why split?** The server client must be created per-request (never shared across requests — auth state would leak between users) and must use the loopback URL (`http://127.0.0.1:8090`). The browser client is a singleton (one per tab) and uses `window.location.origin`.

**File — `lib/pocketbase-server.ts`:**

```typescript
import PocketBase from 'pocketbase';
import { cookies } from 'next/headers';

/**
 * Creates a fresh, request-scoped PocketBase client.
 *
 * CRITICAL: Do NOT cache this or module-level instantiate it. Each request
 * gets its own client with its own authStore to prevent auth leakage between
 * users.
 *
 * Call this inside Server Components, Route Handlers, and Server Actions.
 */
export async function createServerClient(): Promise<PocketBase> {
  const pb = new PocketBase('http://127.0.0.1:8090');

  const cookieStore = await cookies();
  const pbAuth = cookieStore.get('pb_auth');

  if (pbAuth?.value) {
    // loadFromCookie accepts a full Cookie header string OR a bare cookie value
    // that starts with `pb_auth=...`. The SDK parses it correctly either way.
    pb.authStore.loadFromCookie(`pb_auth=${pbAuth.value}`);
  }

  return pb;
}

/**
 * Like createServerClient but also verifies the token is still valid by
 * hitting PB /api/collections/users/auth-refresh. Use this when you NEED
 * up-to-date auth state (e.g., at proxy.ts guard points). For reads that
 * only fetch collection records, createServerClient is sufficient — PB
 * re-validates tokens on each request.
 */
export async function createServerClientWithRefresh(): Promise<PocketBase> {
  const pb = await createServerClient();
  if (pb.authStore.isValid) {
    try {
      await pb.collection('users').authRefresh();
    } catch {
      pb.authStore.clear();
    }
  }
  return pb;
}
```

**File — `lib/pocketbase-browser.ts`:**

```typescript
'use client';

import PocketBase from 'pocketbase';

let pbInstance: PocketBase | null = null;

/**
 * Browser singleton PB client.
 *
 * Hydrates from document.cookie on construction and listens for authStore
 * changes — when the server rewrites the pb_auth cookie (after login/logout),
 * the browser picks it up on next navigation / soft refresh via router.refresh().
 */
export function getBrowserClient(): PocketBase {
  if (typeof window === 'undefined') {
    throw new Error('getBrowserClient() called in server context');
  }
  if (!pbInstance) {
    pbInstance = new PocketBase(window.location.origin);
    // Cookie is HttpOnly from the server — document.cookie cannot read it.
    // The browser SDK does NOT need to know the token; it relies on the
    // browser's cookie jar to attach pb_auth on fetch requests (same-origin).
    // For subscribing to realtime (Phase 3+), use the server-sent token.
  }
  return pbInstance;
}
```

**CRITICAL CORRECTION to D-03's note about `document.cookie`:** because the cookie is HttpOnly, the browser JS cannot read its value — so `pb.authStore.loadFromCookie(document.cookie)` will NOT populate the browser authStore. This is **fine** because every request the browser makes to `/api/*` automatically sends the cookie (same-origin), and PB's server-side token validation handles auth. The browser authStore's `isValid` will be `false`, but `pb.collection('...').getList()` will still succeed because the cookie reaches PB.

**If you need the authed user's record in the browser** (e.g., for display), fetch it via a Server Component and pass it as a prop to a Client Component. Don't try to read the auth token from the browser.

### Pattern: Route Group Auth Gate via `proxy.ts` (Next 16)

**CRITICAL NEXT 16 CHANGE:** `middleware.ts` was renamed to `proxy.ts` in Next.js 16 [CITED: https://nextjs.org/docs/messages/middleware-to-proxy, "The middleware file convention is deprecated and has been renamed to proxy"]. Both still work but `middleware.ts` is deprecated. New code must use `proxy.ts`.

**Key differences vs. middleware:**
- File: `middleware.ts` → `proxy.ts` (same root location)
- Export: `export function middleware(req)` → `export function proxy(req)`
- Runtime: edge → **nodejs** (proxy does NOT support edge runtime). If you need edge, keep using `middleware.ts`.
- Config flags renamed: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`
- `matcher` config works the same way.

**File — `proxy.ts` (at repo root, same level as `app/`):**

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require auth. Everything under `/h` is protected.
const PROTECTED_PREFIXES = ['/h', '/settings'];

// Routes that should redirect to /h if already authed.
const GUEST_ONLY_PREFIXES = ['/login', '/signup', '/reset-password'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const pbAuth = request.cookies.get('pb_auth')?.value;

  // NOTE: Simple presence check only. proxy.ts runs on every request; full
  // JWT validation would add latency. PocketBase re-validates on every API call,
  // so an invalid/expired cookie here just means "you'll get redirected to
  // /login after one API failure in the page render". Acceptable.
  const isAuthed = !!pbAuth && pbAuth.length > 10;

  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
  const isGuestOnly = GUEST_ONLY_PREFIXES.some(p => pathname.startsWith(p));

  if (isProtected && !isAuthed) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isGuestOnly && isAuthed) {
    return NextResponse.redirect(new URL('/h', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip for static assets, api routes (PB proxies those), and the health check
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icons|manifest\\.json).*)',
  ],
};
```

**Why not gate in a Server Component layout?** Both work; proxy.ts redirects before render starts, saving a round trip. Use both: proxy.ts as the first line, Server Component guards as defense in depth (e.g., check `pb.authStore.isValid` in `app/(app)/layout.tsx` and redirect if not — catches the race where the cookie is present but the token is expired).

### Pattern: Auth Server Actions + `useActionState`

**What:** Server action shape that:
1. Accepts `FormData` (Next 16 pattern).
2. Parses with shared zod schema.
3. Calls PB.
4. Sets `pb_auth` cookie via Next's `cookies().set()`.
5. Returns `{error}` state OR redirects.

**Shared zod schema — `lib/schemas/auth.ts`:**

```typescript
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const signupSchema = loginSchema.extend({
  name: z.string().min(1, 'Name is required').max(80, 'Name too long'),
  passwordConfirm: z.string().min(8),
}).refine(d => d.password === d.passwordConfirm, {
  message: 'Passwords do not match',
  path: ['passwordConfirm'],
});

export const resetRequestSchema = z.object({
  email: z.string().email(),
});

export const resetConfirmSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
  passwordConfirm: z.string().min(8),
}).refine(d => d.password === d.passwordConfirm, {
  message: 'Passwords do not match',
  path: ['passwordConfirm'],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;

// Server action return shape consumed by useActionState
export type ActionState =
  | { ok: true; redirectTo?: string }
  | { ok: false; fieldErrors?: Record<string, string[]>; formError?: string };
```

**Server action — `lib/actions/auth.ts`:**

```typescript
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import {
  loginSchema,
  signupSchema,
  type ActionState,
} from '@/lib/schemas/auth';

const COOKIE_NAME = 'pb_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days — matches PB default token TTL

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

export async function loginAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = loginSchema.safeParse(raw);

  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();

  try {
    await pb.collection('users').authWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
  } catch (err: any) {
    // PB returns a ClientResponseError with .status and .response
    return { ok: false, formError: 'Invalid email or password' };
  }

  const cookieValue = pb.authStore.exportToCookie({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
  });
  // exportToCookie returns a full Set-Cookie header string; we want just the value
  // to stuff into Next's cookies().set(). Extract: "pb_auth=<value>; HttpOnly; ..."
  // Next.js cookies().set takes the value + options separately.
  const rawValue = extractPbAuthValue(cookieValue);

  const store = await cookies();
  store.set(COOKIE_NAME, rawValue, cookieOptions());

  revalidatePath('/h');
  redirect('/h');
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();

  try {
    await pb.collection('users').create({
      email: parsed.data.email,
      password: parsed.data.password,
      passwordConfirm: parsed.data.passwordConfirm,
      name: parsed.data.name,
    });
    // Auto-login after signup
    await pb.collection('users').authWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
  } catch (err: any) {
    if (err?.response?.data?.email?.code === 'validation_invalid_email') {
      return { ok: false, fieldErrors: { email: ['Email already registered'] } };
    }
    return { ok: false, formError: 'Could not create account' };
  }

  const rawValue = extractPbAuthValue(pb.authStore.exportToCookie({}));
  const store = await cookies();
  store.set(COOKIE_NAME, rawValue, cookieOptions());

  revalidatePath('/h');
  redirect('/h');
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function requestResetAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get('email') ?? '');
  if (!email) return { ok: false, formError: 'Email required' };

  const pb = await createServerClient();
  try {
    await pb.collection('users').requestPasswordReset(email);
  } catch (err: any) {
    // If SMTP disabled in PB, PB returns 400. Surface a graceful message.
    if (err?.status === 400) {
      return { ok: false, formError: 'Password reset unavailable — contact admin' };
    }
    // Don't leak whether email exists; return success regardless per best practice.
  }
  return { ok: true };
}

// Helper: exportToCookie returns "pb_auth=<url-encoded-json>; HttpOnly; ...".
// Next's cookies().set() wants just the value. Parse it out.
function extractPbAuthValue(setCookieHeader: string): string {
  const first = setCookieHeader.split(';')[0]; // "pb_auth=<value>"
  const eq = first.indexOf('=');
  return eq === -1 ? '' : first.slice(eq + 1);
}
```

**Client form — `components/forms/login-form.tsx`:**

```tsx
'use client';

import { useActionState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@/lib/schemas/auth';
import { loginAction } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, {
    ok: false,
  });

  const { register, formState: { errors } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
  });

  // Merge client-side and server-side errors
  const emailError = errors.email?.message ?? state.fieldErrors?.email?.[0];
  const passwordError = errors.password?.message ?? state.fieldErrors?.password?.[0];

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register('email')} />
        {emailError && <p className="text-sm text-destructive">{emailError}</p>}
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" {...register('password')} />
        {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
      </div>
      {state.formError && <p className="text-sm text-destructive">{state.formError}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
```

**Critical "good to know" from Next 16 docs** [CITED: https://nextjs.org/docs/app/api-reference/functions/cookies]:
- `cookies()` is async in Next 15+/16; **must** use `await`.
- `.delete()` can only be called in a Server Function or Route Handler, not during Server Component rendering.
- HTTP does not allow setting cookies after streaming starts — so cookie writes must happen in server actions/route handlers that complete BEFORE the UI response begins.
- Calling `redirect()` after setting a cookie works as expected: Next returns the Set-Cookie header alongside the 307 redirect response.

### Pattern: SMTP Bootstrap from env vars (AUTH-04)

**What:** A bootstrap hook that reads `SMTP_*` env vars on PB startup and writes them into `$app.settings().smtp`. This makes SMTP env-driven per D-02 without requiring admin UI clicks.

**Verified against types.d.ts:** `settings.smtp` is `SMTPConfig { enabled, host, port, username, password, authMethod, tls, localName }` (line 13699). `$app.save(settings)` is the persistence call. The `onBootstrap` hook fires on PB start.

**File — `pocketbase/pb_hooks/bootstrap_smtp.pb.js`:**

```javascript
/// <reference path="../pb_data/types.d.ts" />

onBootstrap((e) => {
  e.next(); // let PB finish booting, THEN inject settings

  const host = process.env.SMTP_HOST;
  const portStr = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !portStr || !user || !pass) {
    console.log("[smtp] env not set — SMTP disabled (password reset will no-op)");
    return;
  }

  const settings = $app.settings();
  settings.smtp.enabled = true;
  settings.smtp.host = host;
  settings.smtp.port = parseInt(portStr, 10);
  settings.smtp.username = user;
  settings.smtp.password = pass;
  settings.smtp.tls = process.env.SMTP_TLS !== "false";
  settings.smtp.authMethod = "PLAIN";
  settings.meta.senderAddress = process.env.SMTP_FROM || user;
  settings.meta.senderName = process.env.SMTP_FROM_NAME || "HomeKeep";

  $app.save(settings);
  console.log(`[smtp] configured for host=${host} port=${portStr} user=${user}`);
});
```

**Note `[ASSUMED]`:** the pattern `$app.save($app.settings())` is the standard way to persist settings changes in PB JSVM. I could not find explicit documentation for this exact call signature; it is inferred from `types.d.ts` (Settings implements the same `Model` interface as Collection/Record) and from community examples. **Needs verification in plan execution** — if `$app.save(settings)` fails, fallback is to run `./pocketbase --encryptionEnv=PB_ENCRYPTION_KEY` with settings bootstrapped via direct SQL in a separate migration.

**Graceful degradation per D-02:** if SMTP env vars are unset, PB's `requestPasswordReset` returns 400 (SMTP disabled). The server action catches this and returns `{formError: "Password reset unavailable — contact admin"}`.

### Pattern: Drag-to-Reorder Areas (@dnd-kit)

**File — `components/sortable-area-list.tsx`:**

```tsx
'use client';

import { useState, useTransition } from 'react';
import {
  DndContext, DragEndEvent, KeyboardSensor, PointerSensor,
  closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { reorderAreasAction } from '@/lib/actions/areas';

type Area = { id: string; name: string; icon: string; color: string; sort_order: number };

function SortableRow({ area }: { area: Area }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: area.id });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
      className="p-3 border rounded-lg bg-card cursor-grab active:cursor-grabbing"
    >
      <span className="inline-block w-4 h-4 mr-2 rounded" style={{ background: area.color }} />
      {area.name}
    </li>
  );
}

export function SortableAreaList({ homeId, initial }: { homeId: string; initial: Area[] }) {
  const [items, setItems] = useState(initial);
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex(i => i.id === active.id);
    const newIndex = items.findIndex(i => i.id === over.id);
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next); // optimistic

    startTransition(async () => {
      const result = await reorderAreasAction(homeId, next.map(i => i.id));
      if (!result.ok) {
        setItems(initial); // rollback
      }
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {items.map(a => <SortableRow key={a.id} area={a} />)}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
```

**Batched server action — `lib/actions/areas.ts` (reorder slice):**

```typescript
'use server';

import { createServerClient } from '@/lib/pocketbase-server';
import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/lib/schemas/auth';

export async function reorderAreasAction(
  homeId: string,
  orderedIds: string[],
): Promise<ActionState> {
  const pb = await createServerClient();

  // PB has no native "update multiple records in one call". Options:
  //   (A) N sequential update() calls — simple, N round trips.
  //   (B) Use /api/batch endpoint (added in PB v0.23+) — single round trip.
  // Go with (B). SDK exposes `pb.createBatch()`.
  try {
    const batch = pb.createBatch();
    orderedIds.forEach((id, idx) => {
      batch.collection('areas').update(id, { sort_order: idx });
    });
    await batch.send();
  } catch (err) {
    return { ok: false, formError: 'Could not save area order' };
  }

  revalidatePath(`/h/${homeId}/areas`);
  return { ok: true };
}
```

**[VERIFIED: PocketBase Batch API]:** PB 0.23+ exposes `/api/batch` for atomic multi-record writes. JS SDK method is `pb.createBatch()` with `.collection(name).update(...)` accumulation then `.send()`. All writes commit together or all roll back.

### Pattern: Next-Due Computation (`lib/task-scheduling.ts`)

**Pure function per D-13 / SPEC §8.5. Phase 2 has no completions collection (Phase 3 adds it), so the `lastCompletion` arg is always `null`.**

```typescript
import { addDays, differenceInDays } from 'date-fns';

export type Task = {
  id: string;
  created: string;           // ISO date
  archived: boolean;
  frequency_days: number;
  schedule_mode: 'cycle' | 'anchored';
  anchor_date: string | null;
};

export type Completion = {
  completed_at: string;      // ISO date — stored, Phase 3
};

/**
 * Compute the next-due date for a task.
 *
 * PURE: no side effects, no I/O, no Date.now() — accepts `now` for testability.
 *
 * Behavior per SPEC §8.5:
 *  - archived tasks have no next-due (returns null)
 *  - cycle mode: base = last completion (or creation), add frequency_days
 *  - anchored mode: base = anchor_date (or creation), step by whole cycles
 *    until >= now
 */
export function computeNextDue(
  task: Task,
  lastCompletion: Completion | null,
  now: Date,
): Date | null {
  if (task.archived) return null;
  if (task.frequency_days < 1 || !Number.isInteger(task.frequency_days)) {
    throw new Error(`Invalid frequency_days: ${task.frequency_days}`);
  }

  if (task.schedule_mode === 'cycle') {
    const baseIso = lastCompletion?.completed_at ?? task.created;
    const base = new Date(baseIso);
    return addDays(base, task.frequency_days);
  }

  // anchored
  const baseIso = task.anchor_date ?? task.created;
  const base = new Date(baseIso);

  // If anchor is in the future, that IS the next due date.
  if (base.getTime() > now.getTime()) return base;

  // Otherwise, find the next cycle after now.
  const elapsedDays = differenceInDays(now, base);
  const cycles = Math.floor(elapsedDays / task.frequency_days) + 1;
  return addDays(base, cycles * task.frequency_days);
}
```

**Edge cases the unit tests MUST cover:**

| Test | Inputs | Expected |
|------|--------|----------|
| cycle, never completed, created yesterday, freq=7 | `created=Y-1d, freq=7, mode=cycle` | `Y+6d` |
| cycle, completed 2 days ago, freq=7 | `created=Y-10d, freq=7, mode=cycle, lastCompletion=Y-2d` | `Y+5d` |
| anchored, anchor in future | `anchor=Y+10d, freq=7, mode=anchored` | `Y+10d` (anchor wins) |
| anchored, anchor today | `anchor=Y, freq=7, mode=anchored, now=Y` | `Y+7d` |
| anchored, multiple cycles missed | `anchor=Y-30d, freq=7, mode=anchored, now=Y` | `Y+5d` (Math.floor(30/7)=4, cycles=5, Y-30d + 35d = Y+5d) |
| archived | `archived=true` | `null` |
| invalid frequency | `freq=0` | throw |
| invalid frequency | `freq=1.5` | throw |

**Timezone handling:** store all dates as UTC ISO in PB (PB stores dates as UTC internally). For **rendering** next-due in the UI, convert to the home's timezone using `date-fns-tz`'s `formatInTimeZone(date, home.timezone, 'MMM d')`. Never do date math in non-UTC zones — `addDays` + `differenceInDays` from `date-fns` operate on UTC-equivalent instants and are DST-safe.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth (password hash, token issue, session) | Custom bcrypt + JWT | PocketBase `users` collection | PB does bcrypt, issues/validates JWTs, has built-in rate limiting (§Security). Handbuilt auth is a top source of CVEs. |
| Password reset email | Custom token table + mailer | `pb.collection('users').requestPasswordReset()` | PB handles token generation, single-use enforcement, expiration, and email template. |
| SMTP client | `nodemailer` from Next | PocketBase's built-in SMTP (env-configured via `bootstrap_smtp.pb.js`) | PB already has a mailer; duplicating in Next adds complexity and splits the "SMTP configured?" question across two processes. |
| Multi-record update (batch reorder) | N sequential `pb.collection('areas').update(id)` | `pb.createBatch()` → atomic | PB 0.23+ `/api/batch` endpoint commits atomically; avoids partial reorder on error. |
| Form state machine | Manual `useState` + `onSubmit` | `useActionState` + `react-hook-form` + zod | Handles pending/error/success states, preserves values on validation failure, leverages React 19 server-action integration. |
| Client-side validation | Per-field if/else | zod + `@hookform/resolvers/zod` | Single schema serves client + server; `.safeParse` gives structured error object. |
| Drag-and-drop | HTML5 DnD | @dnd-kit/sortable | HTML5 DnD is inaccessible (keyboard support poor), visually clunky, and has browser quirks. @dnd-kit has built-in keyboard support and screen-reader announcements. |
| Route group auth gate | `if (!auth) redirect()` in every page | `proxy.ts` at root | Single file, runs before render, consistent across all `(app)` routes. |
| Toast notifications | Custom component | `sonner` (via shadcn) | Stack management, positioning, accessibility already solved. |
| IANA timezone date math | Hand-written offsets | `date-fns-tz`'s `formatInTimeZone`, `utcToZonedTime` | DST is a tarpit; use a library. |
| Cookie parsing | `document.cookie.split` | `pb.authStore.exportToCookie()` + Next `cookies()` | PB SDK produces a correctly serialized Set-Cookie header; Next handles the HTTP contract. |

**Key insight:** Phase 2 is almost entirely "wire three systems together correctly" — PB handles data + auth, Next 16 handles session + SSR, shadcn/RHF handles forms. The only bespoke code should be `lib/task-scheduling.ts`, the zod schemas, and the server actions (which are thin wiring).

## Common Pitfalls

### Pitfall 1: Next 16 `middleware.ts` vs `proxy.ts` confusion

**What goes wrong:** Developer writes `middleware.ts` based on old tutorials; it works but emits deprecation warnings. Or writes `middleware.ts` expecting edge runtime and gets confused when proxy.ts docs say nodejs.

**Why it happens:** Next 16 rebranded the feature between releases. Most Stack Overflow / Medium articles pre-2026 still say `middleware.ts`.

**How to avoid:**
- Use `proxy.ts` with `export function proxy(request)` [CITED: https://nextjs.org/docs/messages/middleware-to-proxy].
- Location: **repo root** (same level as `app/`), NOT inside `app/`.
- Do not export `config.runtime = 'edge'` — proxy.ts is nodejs only.

**Warning signs:** Deprecation warning in dev console. `middleware is deprecated, use proxy` in build output.

### Pitfall 2: PB `admins` → `_superusers` rename (v0.23)

**What goes wrong:** Copy-pasting a migration or test setup from pre-0.23 docs that uses `admins` → crashes at runtime.

**Why it happens:** PocketBase made `_superusers` an auth collection in v0.23 [CITED: Phase 1 research verified]. The old `admins` API is gone.

**How to avoid:**
- Use `./pocketbase superuser create EMAIL PASS` CLI for test bootstrap (verified in local binary).
- For JSVM: `$app.findAuthRecordByEmail("_superusers", email)` not `$app.findAdminByEmail`.
- For JS SDK (tests): `pb.collection("_superusers").authWithPassword(email, pass)` — the SDK has no special admin namespace anymore.

**Warning signs:** "admin not found" errors, docs that don't match current API.

### Pitfall 3: Cookie `Secure=true` breaks HTTP-only dev

**What goes wrong:** Set `secure: true` unconditionally → cookie is never written on `http://localhost:3001` → auth silently fails in dev.

**How to avoid:** `secure: process.env.NODE_ENV === 'production'`. In the LAN-only production deployment (no HTTPS), users MUST still be able to log in; defer `Secure` in that mode. Phase 7 adds HTTPS modes where `NODE_ENV=production` + HTTPS = Secure cookie.

**Open concern for Phase 7:** LAN-only HTTP production won't get the `Secure` flag under the simple `NODE_ENV` check. Acceptable because same-origin and SameSite=Lax mitigate most CSRF. Document this in Phase 7 security docs.

### Pitfall 4: `exportToCookie` output is a full `Set-Cookie` header string, not just a value

**What goes wrong:** Pass `pb.authStore.exportToCookie({...})` directly to `cookies().set('pb_auth', <value>)` → cookie value becomes `pb_auth=<actual_value>; HttpOnly; ...` instead of just `<actual_value>`.

**How to avoid:** Extract just the value portion. Helper in `lib/actions/auth.ts`:
```ts
function extractPbAuthValue(setCookieHeader: string): string {
  const first = setCookieHeader.split(';')[0]; // "pb_auth=<value>"
  const eq = first.indexOf('=');
  return eq === -1 ? '' : first.slice(eq + 1);
}
```

**Alternative:** Let PB handle cookie options via `exportToCookie` and write the raw header via `NextResponse.headers.append('Set-Cookie', ...)` inside a Route Handler. But server actions don't expose the response object, so the extract pattern is simpler.

### Pitfall 5: Browser `authStore.loadFromCookie(document.cookie)` is a no-op for HttpOnly cookies

**What goes wrong:** Developer tries to hydrate browser-side `pb.authStore` from `document.cookie` → `authStore.isValid` is always false → conditional UI breaks.

**Why it happens:** HttpOnly cookies are invisible to JavaScript by design.

**How to avoid:** Treat the browser authStore as a **display-only cache, not a source of truth**. Fetch the authed user's record in a Server Component and pass as a prop to Client Components. For realtime subscriptions (Phase 3+), generate an auth token server-side and pass it explicitly to the browser client's `pb.realtime.subscribe(...)`.

### Pitfall 6: Next.js server action re-submits lose form values on error

**What goes wrong:** User submits login with bad password → server returns `{ok: false}` → form re-renders empty → user has to re-type email.

**How to avoid:** `react-hook-form`'s `register()` preserves values across re-renders. Use `mode: 'onBlur'` or `'onSubmit'` and DO NOT reset on error. `useActionState`'s state updates don't unmount the form.

**Additionally:** Next.js 16 auto-reposts form state in a single roundtrip after server-action + cookie-set + revalidate [CITED: Next 16 docs]. No manual state preservation needed for values — just errors.

### Pitfall 7: Migration ordering vs hook load order

**What goes wrong:** Hook file references a collection the migration hasn't created yet → hook file loads OK (no-op at boot) but first `home` create fails because `areas` collection doesn't exist → cryptic error.

**How to avoid:** Migrations run BEFORE hooks register. PB's startup sequence: (1) read DB, (2) run pending migrations, (3) load `pb_hooks/`, (4) start HTTP server [VERIFIED against local binary behavior]. So the init migration always lands first. Do NOT put collection-creation in a hook — migrations only.

**Verification:** In the Whole Home integration test (D-20), assert that spinning up a fresh PB instance, creating a home, and seeing the area appear all happens without error.

### Pitfall 8: @dnd-kit SortableContext requires stable IDs

**What goes wrong:** Use array index as `sortable.id` → after drop, items flash / lose drag state.

**How to avoid:** Use the PB record `id` (stable string) as the sortable ID. `useSortable({ id: area.id })`.

### Pitfall 9: Tailwind 4 `@theme` inside `:root` vs `@theme inline`

**What goes wrong:** Put `--color-primary: #D4A574` inside `:root` → Tailwind doesn't pick it up for `bg-primary` utilities.

**How to avoid:** Tailwind 4 exposes color variables through the `@theme` directive in CSS [CITED: shadcn tailwind-v4 docs]. shadcn generates the right structure; just run `npx shadcn@latest init`. The `:root` block sets HSL values; `@theme inline` maps them to Tailwind color names:

```css
@import "tailwindcss";

:root {
  --background: hsl(30 20% 98%);
  --foreground: hsl(25 15% 15%);
  --primary: hsl(30 45% 65%);         /* #D4A574 terracotta-sand, approximate HSL */
  --primary-foreground: hsl(25 15% 15%);
  --card: hsl(30 20% 98%);
  --muted: hsl(30 10% 92%);
  --border: hsl(30 15% 85%);
  --radius: 0.75rem;                  /* rounded-lg+ per SPEC §19 */
}

.dark {
  --background: hsl(25 15% 10%);
  --foreground: hsl(30 15% 95%);
  --primary: hsl(30 45% 65%);
  /* ... */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-card: var(--card);
  --color-muted: var(--muted);
  --color-border: var(--border);
  --radius-lg: var(--radius);
}
```

**Base color choice:** pick "stone" from shadcn's init prompt (warmest of neutral/zinc/stone/gray/slate [CITED: shadcn docs]). Then manually override `--primary` to the D4A574 HSL after init.

### Pitfall 10: `@dnd-kit/utilities` `CSS.Transform.toString` vs `transform` property

**What goes wrong:** Pass `transform: transform` directly to the style → React warns, transform doesn't apply.

**How to avoid:** `CSS.Transform.toString(transform)` returns a valid CSS string. Use:
```tsx
style={{ transform: CSS.Transform.toString(transform), transition }}
```

### Pitfall 11: PB realtime SSE breaks through Caddy without `flush_interval -1`

**What goes wrong (future Phase 3):** subscribing to record changes stalls.

**How to avoid:** Phase 1 already configured `flush_interval -1` in `/etc/caddy/Caddyfile` for `/api/*`. Do not change it.

**Phase 2 impact:** none — Phase 2 does not use realtime. Just don't break Phase 1's Caddy config.

### Pitfall 12: zod `refine` errors don't flatten into field paths

**What goes wrong:** `.refine()` errors on cross-field validation (like password match) → `.flatten().fieldErrors` has a mystery `''` key or drops the error entirely.

**How to avoid:** Always pass `path` in the refine options:
```ts
.refine(d => d.password === d.passwordConfirm, {
  message: 'Passwords do not match',
  path: ['passwordConfirm'],  // REQUIRED
})
```

This makes the error appear under `fieldErrors.passwordConfirm`.

### Pitfall 13: PocketBase batch API error surfaces

**What goes wrong:** One update in a batch fails; developer assumes all succeeded; UI shows stale state.

**How to avoid:** The batch endpoint is atomic — if any sub-request fails, the entire batch rolls back with a 4xx response. Wrap `await batch.send()` in try/catch and treat any throw as "none committed". Return `{ok: false}` from the action; client rolls back the optimistic state.

## Runtime State Inventory

> Phase 2 is mostly greenfield in the runtime sense (Phase 1 shipped infrastructure; Phase 2 adds the first "real" schema + data). However, the migration + hooks introduce operational state worth cataloguing before Phase 3 touches completions.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New collections after this phase: `homes`, `areas`, `tasks`. Users collection gains `last_viewed_home_id` field. PB's built-in `_migrations` table records applied migration filenames. | Schema changes (Phase 3+) must either add a new migration file OR edit the init migration (safe only before first `docker compose up` with this version). Never rename/delete applied migration files — PB will re-run. |
| Live service config | `$app.settings().smtp.*` written by `bootstrap_smtp.pb.js` on every start. Settings persisted in SQLite. | SMTP settings read from env vars at every boot — env changes propagate on restart. No manual admin UI config needed. |
| OS-registered state | None for Phase 2. | — |
| Secrets/env vars | New: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME`, `SMTP_TLS`. Existing: `SITE_URL`, `NTFY_URL`, `TZ`, `PUID`, `PGID`. | Update `.env.example` with SMTP variables. Document graceful-degradation behavior (unset → no password reset). |
| Build artifacts | `.next/standalone/` rebuilt on Next.js build. shadcn-generated files under `components/ui/` are committed (not generated at build). `pb_data/types.d.ts` is generated by PB at first boot — DO NOT COMMIT (add to `.gitignore` if not already). | Add `pocketbase/pb_data/` to `.gitignore` if not present. |

**Verified non-items:**
- ChromaDB, Mem0, Redis, external databases — **None** (PB owns all persistence).
- Windows Task Scheduler, launchd, systemd units — **None** (s6-overlay manages PB + Next + Caddy).

## Code Examples

### Server Component that reads authed user + homes

```tsx
// app/(app)/h/page.tsx
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import Link from 'next/link';
import { Card } from '@/components/ui/card';

export default async function HomesPage() {
  const pb = await createServerClient();

  if (!pb.authStore.isValid) {
    redirect('/login');
  }

  const userId = pb.authStore.record?.id as string;
  const lastViewedHomeId = pb.authStore.record?.last_viewed_home_id as string | undefined;

  const homes = await pb.collection('homes').getFullList({
    filter: `owner_id = "${userId}"`,
    sort: '-created',
  });

  // HOME-03: land on last-viewed home
  if (lastViewedHomeId && homes.some(h => h.id === lastViewedHomeId)) {
    redirect(`/h/${lastViewedHomeId}`);
  }

  if (homes.length === 1) {
    redirect(`/h/${homes[0].id}`);
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Your homes</h1>
      {homes.length === 0 ? (
        <Card className="p-6">
          <p>You don't have any homes yet.</p>
          <Link href="/h/new" className="text-primary">Create your first home</Link>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {homes.map(h => (
            <li key={h.id}>
              <Link href={`/h/${h.id}`}>
                <Card className="p-4 hover:bg-muted">{h.name}</Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Integration test — Whole Home hook fires

```typescript
// tests/unit/hooks-whole-home.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data';
const HTTP = '127.0.0.1:18090';

let pbProcess: ChildProcess;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  pbProcess = spawn(PB_BIN, [
    'serve',
    `--http=${HTTP}`,
    `--dir=${DATA_DIR}`,
    '--migrationsDir=./pocketbase/pb_migrations',
    '--hooksDir=./pocketbase/pb_hooks',
  ]);

  // Wait for PB to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://${HTTP}/api/health`);
      if (r.ok) return;
    } catch { /* not ready */ }
    await new Promise(res => setTimeout(res, 200));
  }
  throw new Error('PB did not start');
}, 10_000);

afterAll(() => {
  pbProcess?.kill('SIGTERM');
});

describe('Whole Home auto-create hook', () => {
  test('creates a Whole Home area when a home is inserted', async () => {
    const pb = new PocketBase(`http://${HTTP}`);

    // Bootstrap superuser + test user via CLI would be cleaner; here we
    // use the first-signup fallback (no auth required for create in a
    // fresh instance before any user exists... actually no, our rules
    // require auth. So create a superuser first.)
    //
    // Easier: call pocketbase superuser create inline:
    await new Promise<void>((resolve, reject) => {
      const p = spawn(PB_BIN, [
        'superuser', 'create', 'test@test.com', 'testpass123',
        `--dir=${DATA_DIR}`,
      ]);
      p.on('exit', c => c === 0 ? resolve() : reject(new Error('superuser create failed')));
    });

    // Authenticate as superuser to bypass API rules
    await pb.collection('_superusers').authWithPassword('test@test.com', 'testpass123');

    // Create a user
    const user = await pb.collection('users').create({
      email: 'alice@test.com',
      password: 'alice123456',
      passwordConfirm: 'alice123456',
      name: 'Alice',
    });

    // Create a home (as superuser — rule-check bypassed)
    const home = await pb.collection('homes').create({
      name: 'Test Home',
      timezone: 'Australia/Perth',
      owner_id: user.id,
    });

    // Assert Whole Home area exists
    const areas = await pb.collection('areas').getFullList({
      filter: `home_id = "${home.id}"`,
    });

    expect(areas).toHaveLength(1);
    expect(areas[0].name).toBe('Whole Home');
    expect(areas[0].scope).toBe('whole_home');
    expect(areas[0].is_whole_home_system).toBe(true);
  });
});
```

**Performance note:** Starting a fresh PB subprocess per test file is ~1-2s. For speed, share one PB across all integration tests via Vitest `globalSetup`. For Phase 2's modest test count, per-file startup is acceptable.

### E2E happy-path skeleton (Playwright)

```typescript
// tests/e2e/signup-to-task.spec.ts
import { test, expect } from '@playwright/test';

test('signup → home → area → task → logout → login → last-viewed home', async ({ page }) => {
  const uniqueEmail = `e2e-${Date.now()}@test.com`;

  // Signup
  await page.goto('/signup');
  await page.fill('[name=name]', 'E2E User');
  await page.fill('[name=email]', uniqueEmail);
  await page.fill('[name=password]', 'password123');
  await page.fill('[name=passwordConfirm]', 'password123');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h/);

  // Create home
  await page.click('text=Create your first home');
  await page.fill('[name=name]', 'Playwright House');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]+$/);

  // Verify Whole Home area exists
  await page.click('text=Areas');
  await expect(page.locator('text=Whole Home')).toBeVisible();

  // Create Kitchen area
  await page.click('text=+ Add area');
  await page.fill('[name=name]', 'Kitchen');
  await page.click('button[type=submit]');
  await expect(page.locator('text=Kitchen')).toBeVisible();

  // Create task
  await page.click('text=Kitchen');
  await page.click('text=+ Add task');
  await page.fill('[name=name]', 'Wipe benches');
  await page.fill('[name=frequency_days]', '7');
  await page.click('button[type=submit]');
  await expect(page.locator('text=Wipe benches')).toBeVisible();

  // Logout
  await page.click('[aria-label=Account]');
  await page.click('text=Log out');
  await expect(page).toHaveURL(/\/login/);

  // Log back in
  await page.fill('[name=email]', uniqueEmail);
  await page.fill('[name=password]', 'password123');
  await page.click('button[type=submit]');

  // Land on last-viewed home
  await expect(page).toHaveURL(/\/h\/[a-z0-9]+$/);
  await expect(page.locator('text=Playwright House')).toBeVisible();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` with `export function middleware` | `proxy.ts` with `export function proxy` | Next.js 16 release | Every auth guard pattern changes. `middleware.ts` still functional but deprecated. |
| `cookies()` synchronous | `cookies()` async (must `await`) | Next.js 15 RC | Every cookie call site needs `await`. Codemod available. |
| `useFormState` from `react-dom` | `useActionState` from `react` | React 19 | Hook name + import changed; behavior is identical. Old name removed in React 19. |
| Pages Router `_middleware.ts` (nested) | Root `proxy.ts` (single) | Next 12.2 → 16 | Nested middleware fully removed. |
| PB `admins` collection | PB `_superusers` auth collection | PocketBase 0.23 | Scripts using `admins` API break. CLI is `./pocketbase superuser create`. |
| PB `code` error field | PB `status` error field | PocketBase 0.23 | Client error-handling checks need updating. |
| Tailwind 3 `tailwind.config.js` | Tailwind 4 CSS-first `@theme` directive | Tailwind 4 | No config file for colors; CSS variables drive theme. |
| shadcn/ui on Tailwind 3 | shadcn/ui on Tailwind 4 (CLI v4) | shadcn CLI 4.x, March 2026 | `shadcn@4.3.1` init generates Tailwind 4 structure directly. |
| `@dnd-kit/sortable` 9.x | `@dnd-kit/sortable` 10.0.0 | October 2024 | API stable; just pin to 10.0.0. A newer `@dnd-kit/react` 0.4.0 exists but is a separate, thinner package — skip for Phase 2. |
| Batch record updates | `pb.createBatch()` / `/api/batch` endpoint | PocketBase 0.23 | Atomic multi-record writes in one round trip. Use for reorder. |

**Deprecated / do not use:**
- `useFormState` (use `useActionState`).
- `middleware.ts` for new code (use `proxy.ts`).
- Admin-UI-only SMTP configuration (use `bootstrap_smtp.pb.js` to drive from env per D-02).
- `document.cookie` in browser for PB token reads (cookie is HttpOnly; use server-fetched user record).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | [ASSUMED] `$app.save($app.settings())` is the correct API to persist modified settings from JSVM | §SMTP Bootstrap | Medium — if wrong, SMTP won't configure from env vars. Fallback: require operator to click Admin UI Mail Settings once, or set via direct SQL in a secondary migration. Verify in plan execution by logging settings after save. |
| A2 | [ASSUMED] `AutodateField` class exists on PB 0.37 JSVM with `onCreate` / `onUpdate` boolean options | §Migration | Low — pattern appears in existing migrations and `types.d.ts` declares `AutodateField`. Exact option names verified to compile via `types.d.ts` line 526. |
| A3 | [ASSUMED] PB 14-day default token TTL matches the recommended cookie maxAge | §Server Actions | Low — PB's `$app.settings().collections.users.authTokenDuration` defaults to ~14 days per community knowledge. If the PB install uses a different TTL, the cookie maxAge either outlives the token (requires re-login mid-session, acceptable UX) or expires first (forces unnecessary re-login, mild friction). Verify by checking collection options after init. |
| A4 | [ASSUMED] PB's `requestPasswordReset` returns HTTP 400 when SMTP is disabled | §Password reset flow | Low — if it returns a different status, the graceful-degradation message won't fire. The try/catch still catches it; only the specific error message differs. Verify in integration test by running with SMTP unset. |
| A5 | [ASSUMED] `pb.createBatch()` is available in `pocketbase@0.26.8` JS SDK | §Sortable batch update | Low — PB 0.23+ added the endpoint; SDK 0.26.x is known to expose it. If SDK version lacks the method, fall back to `Promise.all` of individual `.update()` calls. |
| A6 | [ASSUMED] shadcn `stone` base color is the warmest of the five options and closest to the warm/calm envelope from SPEC §19 | §Tailwind 4 globals.css | Low — all five shadcn bases are near-neutral; tweaking `--primary` to `#D4A574` is the main lever regardless. |
| A7 | [ASSUMED] Running `--hooksDir=./pocketbase/pb_hooks` in dev-pb.js (needs Phase 1 update) will load `*.pb.js` files correctly | §Hook pattern | Low — `pocketbase serve --help` lists `--hooksDir` as a flag. File discovery is documented. |
| A8 | [ASSUMED] Next.js `redirect()` after `cookies().set()` in a server action produces a response with BOTH the Set-Cookie header AND the 307 redirect | §Server Actions | Low — documented behavior [CITED: Next 16 cookies.md "after you set or delete a cookie in a Server Function, Next.js can return both the updated UI and new data in a single server roundtrip"]. |
| A9 | [ASSUMED] PocketBase `deleteRule` supports the `is_whole_home_system = false` filter clause | §Migration for areas | Low — PB API rules support field equality comparisons. If it rejects this at migration time, drop the clause and enforce at app layer only. |

**Action for plan execution:** each `[ASSUMED]` item above should have a corresponding "verification step" in the plan — either an integration test or a manual smoke check at the end of the relevant task.

## Open Questions

1. **Should the init migration split into multiple files (one per collection)?**
   - What we know: PB applies migrations in filename sort order. One file is simpler; four files is more git-friendly for future edits.
   - Recommendation: **one file for Phase 2**. Future changes (Phase 3+ adding completions, Phase 4 adding invites/members) each get their own new migration. Don't retroactively split.

2. **Is the browser authStore needed at all?**
   - What we know: HttpOnly cookie means `document.cookie` can't read it. Server Components can fetch auth state. All mutations go through server actions.
   - Recommendation: **keep a minimal browser client** for read-only collection queries where the server has already fetched auth. Example: a Client Component that reactively searches tasks. The browser SDK sends the cookie automatically; no token exposure needed. But don't bother hydrating the authStore — `isValid` will always be false and that's fine.

3. **How do we write to `last_viewed_home_id` without triggering a full revalidation?**
   - What we know: updating the users record is a PB call; `revalidatePath('/h')` busts the cache but that re-renders everything.
   - Recommendation: use `router.refresh()` from a Client Component after the server action returns, not `revalidatePath`. Only revalidate when the UI needs to show the updated home in the dropdown.

4. **Should AREA-02 (cannot delete Whole Home) be enforced via PB deleteRule or only at app layer?**
   - What we know: PB API rules can reference field values (`is_whole_home_system = false`), so schema can enforce it. UI also shows a disabled delete button.
   - Recommendation: **both**. UI-level prevents accidental clicks; PB rule is the trust boundary. Tested: `deleteRule: '... && is_whole_home_system = false'` should work per PB docs. Verify in integration test.

5. **Auth token auto-refresh before expiry?**
   - What we know: PB tokens default to 14-day TTL. A user who logs in and comes back in 15 days gets a silent logout.
   - Recommendation: in Phase 2, leave as-is (acceptable UX). Phase 3+ can add `createServerClientWithRefresh` usage at layout level to extend the session on each page load.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | Next.js 16 runtime, Vitest, dev scripts | ✓ | 22.22.0 [VERIFIED by Phase 1 summary] | — |
| PocketBase binary | Migrations, hooks, integration tests | ✓ | 0.37.1 at `./.pb/pocketbase` [VERIFIED local exec] | — |
| `npx` + npm registry access | shadcn init, package install | Assumed ✓ | — | — |
| SMTP server for AUTH-04 | Password reset delivery | ✗ | — | Graceful degrade: no-op + "contact admin" message per D-02 |
| Running PB instance on 127.0.0.1:8090 | Server-side pb SDK calls during dev | ✓ via `scripts/dev-pb.js` | 0.37.1 | — |

**Missing dependencies with no fallback:** None that block Phase 2 execution.

**Missing dependencies with fallback:** SMTP — documented graceful-degradation path. Not a blocker.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 (unit/integration) + Playwright 1.59.1 (E2E) [VERIFIED: Phase 1 package.json] |
| Config file | `vitest.config.ts`, `playwright.config.ts` (both exist from Phase 1) |
| Quick run command | `npm test` (Vitest run) |
| Full suite command | `npm run lint && npm run typecheck && npm test && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Signup creates user | e2e | `npx playwright test signup-to-task -g signup` | ❌ Wave 0 |
| AUTH-02 | Login persists across refresh | e2e | `npx playwright test signup-to-task -g "log back in"` | ❌ Wave 0 |
| AUTH-03 | Logout clears cookie | e2e | covered in E2E happy path | ❌ Wave 0 |
| AUTH-04 | Password reset request | unit | `vitest tests/unit/actions/auth.test.ts -t "request reset"` | ❌ Wave 0 |
| HOME-01 | Create home | unit (zod) + e2e | `vitest tests/unit/schemas/home.test.ts` + E2E | ❌ Wave 0 |
| HOME-02 | Multiple homes | e2e | `npx playwright test multi-home` | ❌ Wave 0 |
| HOME-03 | Last-viewed home on login | e2e | covered in E2E happy path | ❌ Wave 0 |
| HOME-04 | Home switcher | e2e | `npx playwright test home-switcher` | ❌ Wave 0 |
| AREA-01 | Create area | unit (zod) + e2e | `vitest tests/unit/schemas/area.test.ts` + E2E | ❌ Wave 0 |
| AREA-02 | Whole Home auto-create + un-deletable | integration | `vitest tests/unit/hooks-whole-home.test.ts` | ❌ Wave 0 |
| AREA-03 | Default assignee | unit | schema test validates nullable field | ❌ Wave 0 |
| AREA-04 | Name/icon/color/sort | unit | schema test | ❌ Wave 0 |
| AREA-05 | Reorder | e2e | `npx playwright test area-reorder` | ❌ Wave 0 |
| TASK-01 | Create task | unit (zod) + e2e | `vitest tests/unit/schemas/task.test.ts` + E2E | ❌ Wave 0 |
| TASK-05 | Schedule mode | unit | covered by task schema test | ❌ Wave 0 |
| TASK-06 | Custom tasks | e2e | E2E happy path creates custom task | ❌ Wave 0 |
| TASK-07 | Edit + archive | e2e | `npx playwright test task-edit-archive` | ❌ Wave 0 |
| TASK-08 | Next due computed | unit | `vitest tests/unit/task-scheduling.test.ts` — matrix from §Pattern: Next-Due | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run lint && npm run typecheck && npm test` (Vitest unit + integration).
- **Per wave merge:** full suite including `npm run test:e2e` against a disposable PB+Next stack.
- **Phase gate:** Full suite green before `/gsd-verify-work`. The E2E happy-path (D-21) is the most important gate — it exercises the entire auth + schema + hook stack end-to-end.

### Wave 0 Gaps
- [ ] `tests/unit/task-scheduling.test.ts` — covers TASK-08 edge matrix (see §Pattern: Next-Due table)
- [ ] `tests/unit/schemas/auth.test.ts` — covers AUTH-01 validation (email format, password min, password match)
- [ ] `tests/unit/schemas/home.test.ts` — covers HOME-01 validation
- [ ] `tests/unit/schemas/area.test.ts` — covers AREA-01, AREA-04 validation
- [ ] `tests/unit/schemas/task.test.ts` — covers TASK-01, TASK-05, TASK-08 input validation
- [ ] `tests/unit/hooks-whole-home.test.ts` — integration: spins up PB, creates home, asserts AREA-02
- [ ] `tests/e2e/signup-to-task.spec.ts` — D-21 happy path (covers AUTH-01/02/03, HOME-01/03, AREA-01/02, TASK-01)
- [ ] Playwright webServer config: Phase 1 boots `next start` only (no PB). Phase 2 E2E needs PB too. Update `playwright.config.ts` to boot both via `concurrently` pointing at `dev-pb.js` + `next start`, or reuse the existing `npm run dev` script with a shim for non-TTY.
- [ ] Wave 0 tooling verification: `npx shadcn@4.3.1 init` compatibility check — Tailwind 4 + Next 16 is the newest combo; expect possible config prompts.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | PocketBase built-in bcrypt + JWT; password min 8 chars (D-06); no hand-rolled auth |
| V3 Session Management | yes | HttpOnly + SameSite=Lax + Secure (prod) cookies; 14-day token TTL matches cookie maxAge; logout clears cookie |
| V4 Access Control | yes | PB API rules enforce `owner_id = @request.auth.id` on every collection; app-level `proxy.ts` guards routes; Server Components re-check `pb.authStore.isValid` |
| V5 Input Validation | yes | zod schemas validate every input both client-side (RHF resolver) and server-side (action `safeParse`); PB enforces field types + max lengths |
| V6 Cryptography | yes | PB handles password hashing (bcrypt); JWT signing key managed by PB; never roll own crypto |
| V7 Error Handling | yes | Server actions return sanitized `{formError}` — never leak stack traces or PB internals; logs at PB level only |
| V8 Data Protection | partial | Passwords never logged; PB stores nothing in Next.js logs; `.env` gitignored (Phase 1) |
| V9 Communication | yes (LAN dev: no) | `secure: production` flag on cookies; HTTPS deferred to Phase 7 compose variants |
| V10 Malicious Code | n/a | No user-supplied HTML rendering (notes are plain text for Phase 2; editor field sanitized by PB) |
| V11 Business Logic | yes | Whole Home auto-create in DB transaction prevents partial state; reorder batched atomically |
| V14 Configuration | yes | No secrets in code; SMTP creds via env vars; PB admin UI at `/_/` behind PB's own auth (Phase 1 decision) |

### Known Threat Patterns for PocketBase + Next 16

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via filter strings | Tampering | **Do not string-concatenate user input into PB filters.** Use the SDK's parameterized filter form: `pb.filter("owner_id = {:id}", {id: userId})`. The inline example `filter: \`owner_id = "${userId}"\`` above is SAFE only because `userId` comes from the validated auth store, not user input. |
| CSRF on server actions | Tampering | SameSite=Lax cookies + Next's action ID token (built-in). Next 16 server actions embed an encrypted action ID that is not reproducible by an attacker; SameSite=Lax blocks cross-site form submission. |
| Broken access control via forged `owner_id` | Elevation | Never trust a client-supplied `owner_id` in task/area/home creation. Always derive from `pb.authStore.record.id` server-side. PB API rules `createRule: '@request.auth.id != "" && owner_id = @request.auth.id'` enforce this at the DB layer. |
| Password reset enumeration | Information disclosure | Return success regardless of whether email exists (the action does this already; PB doesn't reveal which emails it sent to). |
| Cookie theft via XSS | Info disclosure | HttpOnly cookie; Content-Security-Policy headers (Phase 7+ adds CSP per SPEC §16). |
| Rate-limit bypass on login | DoS + Brute force | PB 0.23+ built-in rate limiter — enable in `$app.settings().rateLimits.enabled = true` via a second bootstrap hook. Rule: `label: "*:auth-with-password", duration: 60, maxRequests: 5, audience: "@guest"` limits to 5 attempts/minute per IP. |
| Open admin (`/_/`) | Elevation | Already addressed in Phase 1 D-05: PB admin UI stays behind PB's own auth. Do not weaken. |
| Email injection in password reset | Tampering | PB handles email composition — we don't build email strings. |
| Timing attack on email enumeration | Info disclosure | PB's auth flow is constant-time w.r.t. bcrypt; acceptable. |

### Additional Security Actions for Phase 2 Plan

- [ ] Add a `pocketbase/pb_hooks/bootstrap_ratelimits.pb.js` alongside the SMTP hook to enable PB rate limiting + add a `*:auth-with-password` rule.
- [ ] Do not log request bodies or PB errors verbatim (they may contain emails / PII).
- [ ] Verify `.env` is gitignored (Phase 1 confirmed; re-verify after adding SMTP_* vars).
- [ ] After Phase 2 commit, grep bundled JS for `SMTP_PASS|PB admin password|bcrypt` — confirm nothing leaks into client bundle.

## Sources

### Primary (HIGH confidence)

- **PocketBase 0.37.1 binary** (local `./.pb/pocketbase`) — verified migration template via `pocketbase migrate create`; verified superuser CLI via `pocketbase superuser --help`; verified server flags via `pocketbase serve --help`
- **PocketBase 0.37.1 `pb_data/types.d.ts`** (24386 lines, generated by PB on first boot) — verified `migrate()`, `onRecordCreate`, `onRecordCreateExecute`, `onBootstrap`, `Collection`, `TextField`, `RelationField`, `SelectField`, `NumberField`, `BoolField`, `DateField`, `AutodateField`, `EditorField`, `Record`, `SMTPConfig`, `RateLimitsConfig`, `$app.save()`, `$app.settings()`, `$app.findCollectionByNameOrId()`
- **PocketBase JS SDK 0.26.8 `dist/pocketbase.es.d.ts`** — verified `authStore.loadFromCookie()`, `authStore.exportToCookie(options?, key?)`, `authStore.onChange()`, `authStore.isValid`, `authStore.record`
- **Next.js 16.2.4 official docs: cookies** — https://nextjs.org/docs/app/api-reference/functions/cookies (fetched 2026-04-20, lastUpdated 2026-04-15) — verified async `cookies()`, `.set(name, value, options)`, `.delete()`, `maxAge`, `secure`, `httpOnly`, `sameSite` options, server-action cookie writes
- **Next.js 16 proxy.ts rename** — https://nextjs.org/docs/messages/middleware-to-proxy — verified `middleware.ts` → `proxy.ts` with `export function proxy`, nodejs-only runtime, codemod available
- **PocketBase docs: js-migrations, js-collections, js-overview, collections, api-records, going-to-production** (fetched 2026-04-20) — verified migration syntax, hook loading convention, API rule syntax, password reset endpoints

### Secondary (MEDIUM confidence)

- **Phase 1 RESEARCH.md** — verified Next.js 16.2.4 + PocketBase 0.37.1 are current (cross-confirmed 2026-04-20)
- **shadcn Tailwind v4 docs** — https://ui.shadcn.com/docs/tailwind-v4 — verified `@theme inline` pattern, init command with Tailwind 4, stone/neutral/zinc/gray/slate base options, sonner toast replacement
- **npm registry direct probes** (`npm view <pkg> version`) — verified react-hook-form@7.73.1, @hookform/resolvers@5.2.2, @dnd-kit/core@6.3.1, @dnd-kit/sortable@10.0.0, @dnd-kit/utilities@3.2.2, sonner@2.0.7, lucide-react@1.8.0, date-fns-tz@3.2.0, zod@4.3.6, shadcn@4.3.1

### Tertiary (LOW confidence — training data + unverified community patterns)

- `$app.save($app.settings())` as the settings persistence API — documented indirectly via Settings implementing Model interface; call pattern is inferred. [A1]
- Exact PB token TTL default of 14 days — community knowledge; settable per collection. [A3]
- PB `requestPasswordReset` returning HTTP 400 when SMTP disabled — not explicitly documented; behavior observed in community reports. [A4]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified against npm registry 2026-04-20
- Architecture (Migration / hook / cookie bridge / proxy.ts): HIGH — verified against live PB binary + types.d.ts + official Next 16 docs
- Pitfalls: HIGH — drawn from Phase 1 research (PB 0.23 breaking changes documented) + live Next 16 proxy.ts rename + known HttpOnly cookie behavior
- SMTP bootstrap pattern: MEDIUM — `$app.save(settings)` inferred, not cited (A1)
- Security posture: HIGH — follows ASVS mapping with PB's documented features + zod/Next CSRF defaults

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (Next.js / PocketBase / shadcn move fast; verify versions before Phase 3 starts)
