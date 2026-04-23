# Phase 25: Rate Limits + Abuse Prevention — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** Autonomous

<domain>
## Phase Boundary

Tighten rate limits + add row-creation quotas so the open-signup model can't be weaponized on a public deployment. Pure PB rule + migration work + minor schema tweaks.

**In scope (6 REQ-IDs):**
- RATE-01 row quotas: max 5 homes per owner, max 500 tasks per home, max 10 areas (excl Whole Home) per home
- RATE-02 signup rate limit dedicated bucket — 10/60s per-IP (not shared with 300/60s generic)
- RATE-03 invite-accept rate limit — 5/60s per-IP; 3-strike lockout per-token
- RATE-04 password-reset-confirm rate limit — 5/60s per-IP
- RATE-05 auth-with-password rate limit tightened 60/60s → 20/60s
- RATE-06 ntfy topic min length 4 → 12 + must contain digit (prevents topic enumeration)

**Out of scope:**
- CAPTCHA (v1.3+ if signup abuse continues)
- Row quotas beyond the 3 chosen (users, completions, overrides — low-abuse-risk)
- Per-user API key auth (v1.3+)

**Deliverables:**
1. Migration `1745280005_rate_quotas_rules.js` — rule updates on homes, tasks, areas enforcing creation limits via subquery count
2. Migration `1745280006_rate_limits_tighten.js` — rate-limit label values updated (PB supports per-endpoint rate limits via labels)
3. `lib/schemas/notification-prefs.ts` (or similar) — ntfy topic min length + digit regex
4. `lib/actions/invites.ts` — per-token failed-attempt counter + lockout (new `invite_attempts` collection or in-memory)
5. Integration tests for each quota + rate limit
</domain>

<decisions>
## Implementation Decisions

### RATE-01: Row quotas

- **D-01 (PB rule subquery pattern):** PB 0.37 supports subqueries in rules. New `homes.createRule` appends `&& (@collection.homes.owner_id = @request.auth.id).length < 5`. Similarly for tasks/areas.
  - Actually — PB rule engine uses `@collection.X.field:length` or `@collection.X.count`? Need to check syntax. Alternative: use PB hook on `create` that counts + rejects.
- **D-02 (fallback — PB hook):** If subquery syntax doesn't work cleanly, use a JS hook in `pocketbase/pb_hooks/quotas.pb.js` that runs on `collections/homes.records.create` and counts owner's homes pre-insert. Reject with 400 if over limit.
- **D-03 (env-configurable):** quotas read from env vars with sensible defaults: `MAX_HOMES_PER_OWNER=5`, `MAX_TASKS_PER_HOME=500`, `MAX_AREAS_PER_HOME=10`.
- **D-04 (Whole Home exemption):** area quota excludes the auto-created whole-home area (is_whole_home_system=true). Count only `is_whole_home_system=false` areas.

### RATE-02..05: PB rate-limit buckets

- **D-05 (PB rate-limit labels):** PB 0.37 configures rate limits via collection-level settings. Each has a label + max + duration. Phase 2+ already uses `*:authWithPassword` = 60/60s (widened from 20/60s in 05-02 for E2E).
- **D-06 (new buckets):**
  - `users:create` → 10/60s (signup)
  - `invites:accept` → 5/60s (custom server action — may need app-layer limiter since it's not a PB endpoint)
  - `users:confirm-password-reset` → 5/60s
  - `*:authWithPassword` → 20/60s (tighten; E2E tests updated to wait between signups)
- **D-07 (app-layer rate limiter for invite-accept):** because invite-accept flows through Next server action not PB REST, rate limit lives in `lib/rate-limit.ts` helper (in-memory Map with IP key, window cleanup).

### RATE-03: Per-token invite lockout

- **D-08 (in-memory counter):** `invites:accept` failed attempts tracked by token + IP. 3 failures → token locked for 15 min. After lockout, new invite must be generated (regardless of TTL remaining).
- **D-09 (storage):** in-memory Map keyed by token, cleared on server restart. No DB state (invites are rare enough; restart resets is OK tradeoff).

### RATE-06: ntfy topic

- **D-10 (zod refine):** `lib/schemas/notification-prefs.ts` min length → 12, add `.regex(/\d/, "Must contain at least one digit")`. Existing users grandfathered; new updates must satisfy.
- **D-11 (migration):** no PB migration — this is app-layer only. Existing `ntfy_topic` values stay as-is.

### Test scope

- **D-12 (~10 tests):**
  - 3 quota tests (homes, tasks, areas — each hits limit + one more rejected)
  - 1 signup rate-limit test (fire 11 rapid signups → 11th fails)
  - 1 invite-accept rate-limit test
  - 1 invite-accept 3-strike lockout test
  - 1 password-reset rate-limit test
  - 1 auth-password rate-limit test (fire 21 rapid auth → 21st fails)
  - 1 ntfy topic regex test (reject "alice", accept "alice-7k3q2m9")

### Migration + ports

- **D-13 (2 migrations):** 1745280005 + 1745280006
- **D-14 (test port):** use existing 18090 or allocate 18101 for quota/rate-limit integration (next free)

### Claude's Discretion
- Whether to put invite lockout in PB (new collection) vs in-memory — recommend in-memory for v1.2 simplicity
- Whether quotas use env defaults or hardcoded — recommend env-configurable (hardcoded feels too prescriptive for self-hosters)
</decisions>

<canonical_refs>
- `.planning/v1.2-security/research/public-facing-hardening.md` §Rate-limit map + H-2 open signup + H-5 unbounded row creation
- `.planning/v1.2-security/research/auth-access-control.md` §A-02, A-07
- `pocketbase/pb_migrations/*` — existing rate-limit migrations (04-02 bumped from 5→20; 05-02 bumped to 60)
- `lib/schemas/*` — zod schema location
- `lib/actions/invites.ts` — invite-accept flow
</canonical_refs>

<deferred>
- CAPTCHA on signup
- Per-user API keys
- Quota UI / error messages (UX polish — v1.3)
</deferred>

---

*Phase: 25-rate-limits-abuse-prevention*
