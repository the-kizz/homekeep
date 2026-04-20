---
phase: 02-auth-core-data
plan: 01
subsystem: database
tags: [pocketbase, migration, jsvm, hooks, schema-as-code, rate-limits, smtp, integration-test, vitest]

# Dependency graph
requires:
  - phase: 01-scaffold-infrastructure
    provides: "PB 0.37.1 binary cached at ./.pb/pocketbase, dev-pb.js runner, Vitest config with jsdom + @/* alias, pocketbase JS SDK 0.26.8 installed"
provides:
  - "homes collection (owner-scoped, RelationField to users, API rules enforcing @request.auth.id = owner_id)"
  - "areas collection (home-scoped, scope enum location|whole_home, is_whole_home_system flag, schema-level deleteRule guard on system area)"
  - "tasks collection (home_id + area_id cascade relations, schedule_mode enum cycle|anchored, frequency_days, archived flag)"
  - "users extension field: last_viewed_home_id (RelationField to homes, nullable) for HOME-03"
  - "onRecordCreateExecute(homes) hook creating Whole Home area atomically in the same DB transaction as the home insert (AREA-02)"
  - "onBootstrap SMTP hook reading SMTP_* env vars into $app.settings().smtp with graceful no-op when unset"
  - "onBootstrap rate-limits hook enabling PB rate limiter with *:authWithPassword (5/60s @guest) + /api/ (300/60s @guest)"
  - "scripts/dev-pb.js now passes --hooksDir=./pocketbase/pb_hooks and mkdir's it if missing"
  - "Integration test pattern for disposable PB instances (port 18090, unique test data dir)"
affects: [02-02-ssr-cookie, 02-03-auth-ui, 02-04-homes-areas-crud, 02-05-tasks, 03-three-band-view, 04-collaboration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PB 0.37.1 schema-as-code: new Collection({type,name,*Rule}) then collection.fields.add(...) + collection.indexes = [...] post-construction"
    - "PB onRecordCreateExecute hook ordering: e.next() FIRST (to persist the parent record), THEN create child records that reference its ID — atomicity preserved via the enclosing DB transaction"
    - "PB JSVM rate-limit rules: splice existing Go slice to empty then push plain JS objects (coerces to RateLimitRule structs); lone `*` and `<tag>:<kebab-action>` labels are rejected by Go-side validator"
    - "Integration test boots disposable PB on port 18090 with unique --dir per test file to avoid cross-test contamination"
    - "Superuser must be created via CLI BEFORE starting serve on the same --dir — running create against a live serve races the WAL lock and auth then 400s"

key-files:
  created:
    - "pocketbase/pb_migrations/1714780800_init_homekeep.js"
    - "pocketbase/pb_hooks/homes_whole_home.pb.js"
    - "pocketbase/pb_hooks/bootstrap_smtp.pb.js"
    - "pocketbase/pb_hooks/bootstrap_ratelimits.pb.js"
    - "tests/unit/hooks-whole-home.test.ts"
  modified:
    - "scripts/dev-pb.js"
    - ".env.example"
    - ".gitignore"
    - "eslint.config.mjs"

key-decisions:
  - "02-01: PB 0.37.1 constructor ignores fields+indexes options — use collection.fields.add() post-construction"
  - "02-01: Whole Home hook calls e.next() before creating the area (fixes validation_missing_rel_records on home_id relation)"
  - "02-01: Rate-limit labels use camelCase (*:authWithPassword) and path prefixes (/api/) — Go validator rejects lone * and dashes in <tag>:<action>"
  - "02-01: Integration test creates superuser before serve start to avoid SQLite WAL contention"
  - "02-01: ESLint override disables @typescript-eslint/triple-slash-reference for pocketbase/pb_migrations + pb_hooks (PB's documented hint pattern; ESM import unsupported in goja)"

patterns-established:
  - "Pattern: schema-as-code migration with post-construction .fields.add() calls (will be replicated in 03-xx for completions collection)"
  - "Pattern: onRecordCreateExecute hook with e.next()-first ordering for auto-create of child records (applies to future invite→membership, task→completion auto-creates)"
  - "Pattern: disposable PB integration test on port 18090 (02-04/02-05 reuse this scaffold for CRUD flow tests)"

requirements-completed: [AUTH-01, AUTH-04, HOME-01, HOME-02, AREA-01, AREA-02, AREA-03, AREA-04, TASK-01, TASK-05, TASK-07, TASK-08]

# Metrics
duration: 14min
completed: 2026-04-20
---

# Phase 2 Plan 1: Schema + Hooks Foundation Summary

**PocketBase schema-as-code migration creating homes/areas/tasks collections, Whole Home auto-create hook firing atomically inside the home-insert transaction, env-driven SMTP config, and rate limiting on *:authWithPassword — all proven by a live-boot integration test.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-20T23:15:47Z
- **Completed:** 2026-04-20T23:29:32Z
- **Tasks:** 2
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments

- homes/areas/tasks collections exist on PB boot with correct API rules (`@request.auth.id != "" && owner_id = @request.auth.id` and the subquery variant `home_id.owner_id = @request.auth.id` for child collections)
- users collection extended with `last_viewed_home_id` RelationField (D-05, HOME-03 foundation)
- Whole Home area is auto-created inside the same DB transaction as the home insert — proven by the live-boot integration test asserting length===1, name==='Whole Home', scope==='whole_home', is_whole_home_system===true
- PB rate limiter enabled with 5 attempts / 60s guest on *:authWithPassword (T-02-01-03 brute-force mitigation) plus a 300 req/60s /api/ ceiling
- SMTP config is env-driven with graceful `[smtp] env not set — SMTP disabled` no-op when SMTP_HOST/PORT/USER/PASS are empty
- scripts/dev-pb.js now mounts --hooksDir, so local dev loads hooks just like the test and container environments

## Task Commits

1. **Task 1: PB init migration + Whole Home / SMTP / rate-limits hooks** — `ed7a459` (feat)
2. **Task 2 (TDD): dev-pb hooksDir + Whole Home integration test (with in-flight bug fixes to Task 1 files)** — `980c2d1` (feat)

_Note: the TDD RED → GREEN cycle was compressed into Task 2's single commit because the integration test could not run until the migration + hooks existed from Task 1, and the RED phase surfaced four latent bugs in Task 1's verbatim-research code. All four bugs were fixed in the same commit that added the test — the commit message and this SUMMARY document each deviation per Rule 1._

## Files Created/Modified

**Created:**
- `pocketbase/pb_migrations/1714780800_init_homekeep.js` — schema-as-code migration: homes (name, address, timezone, owner_id, created, updated), areas (home_id, name, icon, color, sort_order, scope, default_assignee_id, is_whole_home_system, created, updated), tasks (home_id, area_id, name, description, frequency_days, schedule_mode, anchor_date, icon, color, assigned_to_id, notes, archived, archived_at, created, updated), users extension (last_viewed_home_id). Indexes on (owner_id), (home_id), (home_id, sort_order), (home_id, archived). Down-migration drops in reverse-dependency order.
- `pocketbase/pb_hooks/homes_whole_home.pb.js` — `onRecordCreateExecute((e)=>{...}, "homes")`: recursion guard, `e.next()` to persist the home, then create an area record with `{home_id: e.record.id, name:"Whole Home", scope:"whole_home", sort_order:0, is_whole_home_system:true, icon:"home", color:"#D4A574"}`
- `pocketbase/pb_hooks/bootstrap_smtp.pb.js` — `onBootstrap((e)=>{...})`: reads SMTP_HOST/PORT/USER/PASS/FROM/FROM_NAME/TLS; if any of host/port/user/pass is missing, logs "[smtp] env not set" and returns; otherwise writes to `$app.settings().smtp.*` and `$app.save(settings)`
- `pocketbase/pb_hooks/bootstrap_ratelimits.pb.js` — `onBootstrap((e)=>{...})`: enables rate limits, splices existing rules to empty, pushes *:authWithPassword (5/60s @guest) and /api/ (300/60s @guest)
- `tests/unit/hooks-whole-home.test.ts` — `// @vitest-environment node` integration test that pre-creates a superuser, boots disposable PB on 127.0.0.1:18090 with --migrationsDir + --hooksDir, creates user → home, and asserts the Whole Home area was auto-created with the correct flags

**Modified:**
- `scripts/dev-pb.js` — adds `const HOOKS_DIR = './pocketbase/pb_hooks'`, mkdir's it if missing, passes `--hooksDir=./pocketbase/pb_hooks` to the serve subprocess argv
- `.env.example` — appends SMTP_HOST/PORT/USER/PASS/FROM/FROM_NAME/TLS block with no real credentials
- `.gitignore` — adds `/pocketbase/pb_data/` (PB generates types.d.ts + data.db there on first boot)
- `eslint.config.mjs` — per-file-pattern override disabling `@typescript-eslint/triple-slash-reference` and relaxing `no-unused-vars` catchErrors for pocketbase/pb_migrations and pocketbase/pb_hooks

## Decisions Made

- **Commit structure compromise:** the plan contemplated a pure TDD RED commit followed by a GREEN commit. In practice, Task 1's code was landed first (matching the plan's file ordering), which meant the test wrote in Task 2 would run immediately. Rather than synthesise a fake RED, the test was added alongside the four bug fixes it surfaced, all in commit `980c2d1`. The plan commit guidance explicitly allows this ("Alternatively combine as one commit").
- **Superuser created pre-serve (not in-test):** the research snippet called `pocketbase superuser create` inside the test body, AFTER serve was running. This racing SQLite-WAL pattern reliably 400s on authWithPassword. Moved the create into `beforeAll` before the serve spawn — the write lands uncontended, PB picks it up on its first read.
- **Rate-limit labels changed from plan:** `*:auth-with-password` and bare `*` are rejected by PB 0.37.1's validator (see deviation #3 below). Switched to `*:authWithPassword` and `/api/` — both validate cleanly and provide equivalent coverage for T-02-01-03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PB 0.37.1 Collection constructor ignores fields + indexes options**
- **Found during:** Task 2 (integration test first PB boot attempt)
- **Issue:** `new Collection({fields: [...], indexes: [...], ...})` as written in RESEARCH.md §Schema-as-Code silently dropped the fields array. `app.save(collection)` succeeded, but the collection only had its auto-generated `id` field; the rule validator then rejected the migration with `invalid left operand "owner_id" - unknown field "owner_id"`. Traced with a `console.log(homes.fields.length)` probe that printed `1`.
- **Fix:** Rewrote all three collection constructors to use `collection.fields.add(new XField({...}))` after instantiation, and set `collection.indexes = [...]` as a property assignment. Only `type`, `name`, and the *Rule fields remain in the constructor init-object (verified these DO apply).
- **Files modified:** pocketbase/pb_migrations/1714780800_init_homekeep.js
- **Verification:** Post-boot `GET /api/collections` returns homes(7 fields), areas(11 fields), tasks(16 fields), users(11 fields). Integration test passes.
- **Committed in:** 980c2d1

**2. [Rule 1 - Bug] Whole Home hook created area before e.next() — FK relation failed**
- **Found during:** Task 2 (integration test `homes.create` failure with `validation_missing_rel_records`)
- **Issue:** The verbatim-research hook called `e.app.save(wholeHome)` with `home_id: e.record.id` BEFORE `e.next()`. In PB 0.37.1, `e.next()` is what actually persists the home row — so at the time of the area save, the home was still in-memory only and the relation validator could not find it.
- **Fix:** Reordered: `e.next()` first (persists the home and surfaces its ID as an FK target), then create the area. Atomicity is preserved because onRecordCreateExecute runs the whole chain inside a single DB transaction — a later throw from `e.app.save(wholeHome)` still rolls the home insert back.
- **Files modified:** pocketbase/pb_hooks/homes_whole_home.pb.js
- **Verification:** Integration test asserts `areas.length === 1 && areas[0].is_whole_home_system === true` after a `homes.create`, which now passes cleanly.
- **Committed in:** 980c2d1

**3. [Rule 1 - Bug] Rate-limit labels `*:auth-with-password` and bare `*` rejected by validator**
- **Found during:** Task 2 (first PB boot attempt after Task 1 — PB exited before serving)
- **Issue:** PB 0.37.1's RateLimitRule.Validate() rejected both labels proposed by RESEARCH.md §Security Domain. Empirically tested via a probe hook: dashes in the `<tag>:<action>` action portion are invalid (`*:auth-with-password` and `users:auth-with-password` both fail); bare `*` is also invalid (despite PB's own docs listing `*:create` as accepted — and yes, `*:create` works, but `*` alone does not). Working alternatives: `*:authWithPassword` (camelCase action name) and `/api/` (path prefix).
- **Fix:** Swapped labels to `*:authWithPassword` and `/api/`. Also switched from the plan's `settings.rateLimits.rules = [...]` (which creates opaque `map[string]any` entries that never coerce to the Go RateLimitRule struct) to the plan-authorised fallback: `splice` the existing Go slice to empty, then `push` plain JS objects (these DO coerce properly).
- **Files modified:** pocketbase/pb_hooks/bootstrap_ratelimits.pb.js
- **Verification:** PB boots, `[ratelimits] enabled:` log line prints on startup, HTTP API confirms `settings.rateLimits.enabled === true` post-boot.
- **Committed in:** 980c2d1

**4. [Rule 3 - Blocking] ESLint rejected PB-documented triple-slash reference directives**
- **Found during:** Final `npm run lint` gate
- **Issue:** `@typescript-eslint/triple-slash-reference` flagged all four `.pb.js` / migration files because they start with `/// <reference path="../pb_data/types.d.ts" />` — which is PB's documented pattern for providing JSVM editor hints. Removing the directive is not an option (it breaks IDE autocompletion inside goja). ESM import is not supported by goja.
- **Fix:** Added a per-file-pattern ESLint override in `eslint.config.mjs` turning off `@typescript-eslint/triple-slash-reference` and relaxing `no-unused-vars` caughtErrors for `pocketbase/pb_migrations/**/*.js` and `pocketbase/pb_hooks/**/*.js`. Production TypeScript code remains strict.
- **Files modified:** eslint.config.mjs
- **Verification:** `npm run lint` returns zero errors / zero warnings.
- **Committed in:** 980c2d1

---

**Total deviations:** 4 auto-fixed (3 Rule 1 bugs, 1 Rule 3 blocking)
**Impact on plan:** All four deviations were mandatory for correctness — the migration, the auto-create hook, the rate-limits hook, and the lint gate each would have hard-failed without the fix. No scope creep. The integration test scaffold specified in the plan is what caught every one of them, which is the validation-first payoff in action.

### Assumptions Log resolution (from RESEARCH.md §Assumptions)

- **A1 ($app.save(settings) as the persistence call):** CONFIRMED — works for SMTP config; works for rate-limits config only when the rules slice is mutated via `splice`+`push` rather than reassigned.
- **A2 (AutodateField {name, onCreate, onUpdate} signature):** CONFIRMED — fields added via `fields.add(new AutodateField({name, onCreate, onUpdate}))` validate and persist correctly.
- **A3 (PB token TTL default 14 days):** not exercised in this plan (no login flow yet); defer to 02-03.
- **A4 (PB requestPasswordReset returns HTTP 400 when SMTP disabled):** not exercised in this plan; defer to 02-03.
- **A7 (cascadeDelete: true on RelationField with cascadeDelete semantics):** CONFIRMED via schema creation; actual cascade behavior under a real home delete is not exercised here — defer integration verification to 02-04.
- **A9 (Goja JS objects coerce to Go structs when pushed onto existing slices):** PARTIALLY CONFIRMED — works for RateLimitRule pushes with valid label formats; DOES NOT work when reassigning the slice wholesale (`settings.rateLimits.rules = [...]` creates opaque map entries).

## Issues Encountered

- **Stale PB process on port 18090:** a prior test run (before this plan) left a PB process bound to 127.0.0.1:18090 without our migrations. The integration test's port collision manifested as a cryptic 400 from `_superusers.authWithPassword` (the test was hitting a completely different PB instance). Diagnosed via `ss -tlnp`, killed the stale PID, test proceeded. **Mitigation for future plans:** the test's `beforeAll` could `EADDRINUSE` detect and fail fast with a clearer error; deferred to 02-05 when the test scaffold is generalized.

- **Label-format spelunking:** PB 0.37.1's rate-limit label validator is stricter than its own documentation (types.d.ts comments list `*:create` as an example, but lone `*` is rejected and `*:auth-with-password` is rejected even though PB's built-in action tags include the kebab spelling). Required ~10 minutes of empirical probing via throwaway hook files to find a working combo. Documented thoroughly so future plans can skip the spelunk.

## Threat Flags

None — this plan introduces exactly the collections, hooks, and rate-limit rules listed in the threat model frontmatter (T-02-01-01..07). No new attack surface was added outside the model.

## Known Stubs

None — no UI wired in this plan; all data model surfaces are fully implemented.

## Self-Check: PASSED

- `pocketbase/pb_migrations/1714780800_init_homekeep.js` — FOUND
- `pocketbase/pb_hooks/homes_whole_home.pb.js` — FOUND
- `pocketbase/pb_hooks/bootstrap_smtp.pb.js` — FOUND
- `pocketbase/pb_hooks/bootstrap_ratelimits.pb.js` — FOUND
- `tests/unit/hooks-whole-home.test.ts` — FOUND
- `scripts/dev-pb.js` (modified with HOOKS_DIR) — FOUND
- `.env.example` (SMTP block) — FOUND
- `.gitignore` (/pocketbase/pb_data/) — FOUND
- `eslint.config.mjs` (PB override) — FOUND
- Task 1 commit `ed7a459` — FOUND
- Task 2 commit `980c2d1` — FOUND
- Lint green, typecheck green, full suite 7/7 passing — VERIFIED

## User Setup Required

**SMTP is optional.** Password reset (AUTH-04) will only function end-to-end once the operator configures `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (and optionally `SMTP_FROM`, `SMTP_FROM_NAME`, `SMTP_TLS`) in the runtime environment. Until then, PB boots with `[smtp] env not set — SMTP disabled` in the logs and any `requestPasswordReset` call returns 400, which the 02-03 auth UI will surface as "Password reset unavailable — contact admin" per D-02. No blocker for Phase 2 sign-off — AUTH-04 is intentionally smoke-tested only, not E2E-asserted.

## Next Phase Readiness

- **Ready for 02-02 (SSR cookie bridge + shadcn init):** collections exist, API rules enforce owner-scoped access, users extension field is in place. The 02-02 plan can proceed to `lib/pocketbase-server.ts` / `lib/pocketbase-browser.ts` / `proxy.ts` knowing the data model it will be gating is live.
- **Ready for 02-03 (auth pages):** the users collection is unchanged from PB default (aside from the one added relation field), so `pb.collection('users').create()` and `authWithPassword()` work as documented.
- **Ready for 02-04 (homes + areas CRUD):** the Whole Home auto-create invariant is provable via the integration test scaffold; 02-04 can reuse the same disposable-PB pattern to assert create/update/delete + drag-reorder flows end-to-end.
- **Ready for 02-05 (tasks):** tasks collection schema is complete; `lib/task-scheduling.ts`'s `computeNextDue` (D-13) can consume the `frequency_days`, `schedule_mode`, `anchor_date`, `archived`, `created` fields directly.

**No blockers.** The only deferred items are the assumption verifications (A3, A4, A7) which naturally resolve in later plans when the relevant flows come online.

---
*Phase: 02-auth-core-data*
*Completed: 2026-04-20*
