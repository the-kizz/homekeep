# Authentication & Access Control — Security Audit

Audit date: 2026-04-22 · Branch: master · Build target: v1.2 security hardening

## Executive Summary

HomeKeep's auth surface is **fundamentally sound**: PB rules are the source of truth, the session cookie is HttpOnly/SameSite=Lax/Secure-when-prod, server actions consistently call `createServerClient()` + `authStore.isValid` + `assertMembership/Ownership`, and the invite token is a 192-bit CSPRNG value with a UNIQUE index. The completion-attribution rule (`@request.body.completed_by_id = @request.auth.id`) defends against cross-member forgery.

That said, the audit surfaced **1 HIGH-severity filter-injection pattern** that is pervasive across RSC pages and two server actions (template-literal `"${homeId}"` inside PB filter strings), **3 MEDIUM** findings (open signup with no allow-list on a public VPS, missing Referrer-Policy despite in-code claim, schedule_overrides.created_by_id forgery), plus several LOW/INFO hardening opportunities (password length 8, no rate-limit on invite-accept / password-reset confirm, task area_id not cross-checked to home_id, user's `last_viewed_home_id` writable to arbitrary home ids).

No critical finding. No account-takeover path was identified.

## Scope

Files audited end-to-end:

- `lib/actions/auth.ts` — login/signup/logout/reset (5 actions)
- `lib/actions/invites.ts` — createInvite/acceptInvite/revokeInvite (3)
- `lib/actions/homes.ts` — createHome/updateHome/switchHome/deleteHome (4)
- `lib/actions/areas.ts` — createArea/updateArea/reorderAreas/deleteArea (4)
- `lib/actions/tasks.ts` — createTask/updateTask/archiveTask (3)
- `lib/actions/completions.ts` — completeTaskAction (1)
- `lib/actions/reschedule.ts` — snoozeTaskAction/rescheduleTaskAction (2)
- `lib/actions/rebalance.ts` — rebalancePreviewAction/rebalanceApplyAction (2)
- `lib/actions/members.ts` — removeMember/leaveHome (2)
- `lib/actions/onboarding.ts` — skipOnboarding (1)
- `lib/actions/notification-prefs.ts` — updateNotificationPrefsAction (1)
- `lib/actions/seed.ts` — batchCreateSeedTasks (1)
- `lib/membership.ts`, `lib/pocketbase-server.ts`, `lib/pocketbase-admin.ts`, `lib/pocketbase-browser.ts`, `lib/invite-tokens.ts`, `lib/schedule-overrides.ts`
- `proxy.ts` (Next 16 middleware)
- `app/(public)/invite/[token]/page.tsx`, `app/(public)/login/page.tsx`, `app/(public)/signup/page.tsx`, `app/(public)/reset-password/{page,[token]/page}.tsx`
- `app/api/admin/run-scheduler/route.ts`, `app/api/health/route.ts`
- `app/(app)/layout.tsx`, `app/(app)/h/[homeId]/layout.tsx`, all `app/(app)/h/[homeId]/**/page.tsx`
- `app/layout.tsx` (for Referrer-Policy)
- `pocketbase/pb_migrations/*.js` (13 migrations) — every collection's 5 rules
- `pocketbase/pb_hooks/*.pb.js` (5 hooks)
- `lib/schemas/*.ts` (shared zod)

## Trust boundaries

| Boundary | Trusted | Untrusted |
|---|---|---|
| `pb.authStore.record.id` (after cookie-hydrate) | YES — cookie is HttpOnly + opaque value signed by PB | — |
| `pb_auth` cookie value | NO — PB re-validates on every API call | YES on the wire (HttpOnly, Secure in prod, SameSite=Lax) |
| Next.js URL dynamic params (`homeId`, `taskId`, `areaId`, `token`) | NO | YES — enforced shape only at token regex (`/^[A-Za-z0-9_-]{20,64}$/`); other ids accept any string |
| FormData fields | NO — every action re-parses via zod | — |
| PB rule expressions | YES — final ownership authority; defense-in-depth under assertMembership/assertOwnership | — |
| `createAdminClient()` auth token | YES — server-only, 30-min TTL cache | — |
| `process.env.PB_ADMIN_*`, `ADMIN_SCHEDULER_TOKEN` | YES | — (must be in `.env` 600, never logged) |

## Findings (severity-ordered)

### HIGH

#### A-01: PB-filter injection via template-literal URL params
- **Location:** 20+ sites; the pattern is ``` filter: `home_id = "${homeId}"` ```
  - `app/(app)/h/[homeId]/page.tsx:67,90,104`
  - `app/(app)/h/[homeId]/members/page.tsx:33`
  - `app/(app)/h/[homeId]/settings/page.tsx` — FIXED (uses `pb.filter`)
  - `app/(app)/h/[homeId]/areas/page.tsx:38`
  - `app/(app)/h/[homeId]/areas/[areaId]/page.tsx:56`
  - `app/(app)/h/[homeId]/by-area/page.tsx:66,72`
  - `app/(app)/h/[homeId]/person/page.tsx:77,101,123`
  - `app/(app)/h/[homeId]/history/page.tsx:78,100,117`
  - `app/(app)/h/[homeId]/onboarding/page.tsx:50`
  - `app/(app)/h/[homeId]/tasks/new/page.tsx:44,57`
  - `app/(app)/h/[homeId]/tasks/[taskId]/page.tsx:49,60`
  - `lib/actions/areas.ts:82` (createArea — `parsed.data.home_id` from form)
  - `lib/actions/seed.ts:79` (batchCreateSeedTasks — `parsed.data.home_id` from form)
  - `lib/scheduler.ts:166,210,313,319` (admin-client path — `homeId` comes from PB, not user, so not exploitable here)
- **Attack scenario:**
  1. Alice is a member of two homes, A and B. Bob (attacker) has a user account and is a member of home X.
  2. Alice's URL `/h/A` renders via `filter: "home_id = \"A\""`. A crafted request with URL-decoded `homeId` = `A" || 1==1 || "` becomes `home_id = "A" || 1==1 || ""`.
  3. PocketBase filter syntax supports both `'` (auto-escaped by `pb.filter()`) and `"` delimiters. Template literals bypass the escape and permit break-out.
  4. The collection rule still ANDs against `@request.auth.home_members_via_user_id.home_id ?= home_id`, so a user CANNOT see homes they do not belong to — the rule is the final gate.
  5. **But** when the user is a member of multiple homes, the crafted filter widens the result set beyond the URL-targeted home to include all their other homes' data on a page scoped to a single home. This breaks UI isolation (tasks, members, invites, completions from home B surface on `/h/A`).
  6. Worse: `history/page.tsx` and `by-area/page.tsx` use the same pattern with `archived = false` — a crafted value like `A" || home_id != "` could flip logic. On single-home users this is a no-op; on multi-home users, it discloses the user's other homes' data under a wrong URL.
- **Evidence:**
  ```ts
  // app/(app)/h/[homeId]/page.tsx:67
  const memberRows = await pb.collection('home_members').getFullList({
    filter: `home_id = "${homeId}"`,   // <-- homeId comes from URL, unescaped
    expand: 'user_id',
    ...
  });
  ```
  `pb.filter()` would auto-escape; the template-literal path does not.
- **Impact:** Cross-home information disclosure within one attacker's own session. **Not** cross-tenant to a foreign user's homes — PB's rule is the authoritative isolation boundary. Still a filter-logic-bypass class.
- **Fix:** Replace every `filter: \`home_id = "${x}"\`` with `filter: pb.filter('home_id = {:hid}', { hid: x })`. Pattern is already used in `lib/membership.ts`, `lib/schedule-overrides.ts`, `lib/actions/rebalance.ts`, `lib/notifications.ts`, and `settings/page.tsx`. The plan-file comments in `settings/page.tsx` ("Phase 17 WR-01: … pb.filter() parameter-binding pattern matches the rest of the codebase") claim this is the house convention but the convention wasn't applied retroactively. Single PR can sweep.

### MEDIUM

#### A-02: Open signup on a public-IP deployment (`users.createRule = ""`)
- **Location:** No migration sets `users.createRule`. PB default for auth collections is `""` (anyone can signup).
- **Attack scenario:** The operator deploys to `46.62.151.57:3000` (see MEMORY). Any internet user can register an account. Unless the `PB_ADMIN_PASSWORD` is reused or weak, account creation gets the attacker a logged-in session but with no access to any existing home (rules gate). However:
  - Attacker can create their own home, burn PB disk, and generate real load.
  - Attacker can receive an invite token (via social engineering / ntfy topic guessing / referrer leak — see A-04) and join.
  - If the operator used `PB_ADMIN_PASSWORD` as their regular account password, classic credential-stuffing becomes trivial because the login endpoint is trivially discoverable.
  - Account enumeration is already suppressed (login always returns "Invalid email or password"; `requestResetAction` swallows SMTP 400 and account-not-found silently — good).
- **Evidence:** `pocketbase/pb_migrations/1714780800_init_homekeep.js` extends the users collection with `last_viewed_home_id` but does not restrict `createRule`. No later migration locks it down.
- **Impact:** Spam accounts, invite-acceptance DoS (192-bit tokens still safe, but flooding `acceptInvite` is uncapped at PB rate-limit — see A-07), ntfy topic enumeration risk via joined homes.
- **Fix:** Decide SPEC posture. Options:
  1. Ship as-is (public-signup is intentional for a multi-tenant PaaS).
  2. For single-household deploys, add a migration that flips `users.createRule` to `null` (superuser-only) and require invites for new members. Owners already gate invite creation.
  3. Add an env `HOMEKEEP_ALLOW_SIGNUP=false` honoured by `signupAction` at the server-action layer (still leaves the PB endpoint open).

#### A-03: `schedule_overrides.created_by_id` forgery via direct PB API
- **Location:** `pocketbase/pb_migrations/1745280000_schedule_overrides.js:62` — `createRule: memberRule` with no body-check on `created_by_id`.
- **Attack scenario:** Alice and Bob share home A. Alice makes a direct POST to `/api/collections/schedule_overrides/records` with `task_id: <taskInA>, snooze_until: <iso>, created_by_id: <bob.id>`. Because PB's `createRule` only validates membership (not the body), the row writes with Bob listed as the creator. The `snoozeTaskAction` always sets `created_by_id` correctly, but nothing prevents a crafted raw PB call.
- **Evidence:** Migration comments acknowledge this intentionally: `D-04: NO body-check … task_id membership is sufficient and keeps Phase 15 UX flexible (members can inspect + modify each other's snoozes)`. The audit-trail impact was accepted.
- **Impact:** Audit trail corruption — a member can blame a snooze on a housemate. No access-control consequence; no data-exfil path. The field is used for display/debug, not authorisation.
- **Fix:** Add `&& @request.body.created_by_id = @request.auth.id` to the createRule string (mirrors completions createRule). One-line migration.

#### A-04: Missing Referrer-Policy despite code comment asserting it
- **Location:** `app/(public)/invite/[token]/page.tsx:27-29` comment claims `<meta name="referrer" content="no-referrer" />` is set in `app/layout.tsx`. **It is not.** `app/layout.tsx` (1-67) contains no referrer meta and no `headers` nextconfig rule.
- **Attack scenario:** User clicks an invite link in email → lands on `/invite/TOKEN`. The user clicks the GitHub footer or any outbound link (e.g., on the landing page after redirect). The default `strict-origin-when-cross-origin` sends `https://app/invite/TOKEN` as the Referer; hosts like `github.com` log Referer headers. Invite tokens have 14-day TTL.
- **Evidence:** `grep -rn "no-referrer" /root/projects/homekeep` → zero matches.
- **Impact:** A valid, unconsumed invite token could leak to GitHub/ntfy/any outbound hop. If the outbound host is cooperative (or if attacker controls a link the victim clicks from the invite page), the token can be replayed by the attacker. Mitigated by: (a) 192-bit entropy (useless if leaked), (b) single-use `accepted_at` flip, (c) need to be signed in to accept. But a freshly-registered attacker account would pass the authed gate.
- **Fix:** Add `referrer: 'no-referrer'` to Next.js `metadata` in `app/layout.tsx`, or set it only on the invite page. Already listed as a threat (`T-04-02-04`) — implementation simply didn't happen.

### LOW

#### A-05: Weak minimum password policy (8 chars, no complexity)
- **Location:** `lib/schemas/auth.ts:21,27,42,43` — `z.string().min(8)`.
- **Evidence:** `password: z.string().min(8, 'Password must be at least 8 characters')`.
- **Impact:** An 8-char password (lowercase) is brute-forceable offline if the PB hash DB ever leaks. Online, the rate limit of 60/60s on `authWithPassword` (`bootstrap_ratelimits.pb.js:44-49`) protects against live spraying within reasonable scales.
- **Fix:** Raise `.min()` to 12 (NIST SP 800-63B modern guidance) or add a HIBP breach check at signup. Not urgent; self-hosted posture.

#### A-06: `updateTask` does not cross-verify `area_id` belongs to `home_id`
- **Location:** `lib/actions/tasks.ts:468-495` — the UPDATE path writes `area_id: parsed.data.area_id` directly without checking the area belongs to `home_id`. Contrast with `createTask:163-170` which DOES verify.
- **Attack scenario:** A member of multi-home user could forge `area_id` = area in a different home they also belong to; the update succeeds. The PB `tasks.updateRule` only gates the task's current `home_id`, not the new `area_id`.
- **Impact:** Data-integrity corruption; task appears in the wrong area list. No cross-tenant path.
- **Fix:** Port the createTask preflight to updateTask.

#### A-07: No rate limit on invite-acceptance, password-reset-confirm, or authenticated writes
- **Location:** `pocketbase/pb_hooks/bootstrap_ratelimits.pb.js`. Only two labels: `*:authWithPassword` (60/60s @guest) and `/api/` (300/60s @guest).
- **Impact:** A logged-in user can spam `acceptInvite` or any server action essentially without ceiling (the Next.js server action → PB call doesn't hit the @guest /api/ ceiling once authed). Password-reset confirm via `confirmResetAction` → `pb.users.confirmPasswordReset(token, …)` — a token has 30-min TTL and is single-use, but there's no brute-force ceiling if the attacker got a leaked token prefix.
- **Fix:** Add PB rate-limit rules for `users:confirmPasswordReset` (e.g. 10/60s @guest), `users:requestPasswordReset` (5/hr @guest). Invite-accept is already bounded by token uniqueness + single-use flag.

#### A-08: `users.last_viewed_home_id` field accepts any home id on self-update
- **Location:** Default PB `users.updateRule` = `id = @request.auth.id` (self-only). Field is relation-typed but PB does not validate cross-home membership on write.
- **Attack scenario:** A user directly POSTs to `/api/collections/users/records/<self>` with `last_viewed_home_id: <homeIdNotAMemberOf>`. Write succeeds; on next `/h` visit, `(app)/layout.tsx` fetches homes by `user_id = self` and the switcher no-ops for the forged value, but the root-of-`/h` auto-redirect in similar code may 404. `switchHome` action defensively checks, but the raw PB route does not.
- **Impact:** Self-DoS / UX-break. No exfil; the forged home id is not loaded (PB viewRule on homes gates reads).
- **Fix:** Migration — set `users.updateRule` to block writes where the new `last_viewed_home_id` is not in the user's `home_members`. Or simply stop relying on this field for redirect logic and compute current-home from `home_members`.

#### A-09: `removeMember` reads target user via `pb.collection('users').getOne(memberUserId)` after PB rule swap — info disclosure by design
- **Location:** `lib/actions/members.ts:89`, `invites.ts:210-212`, `(app)/layout.tsx` expand.
- **Note:** Migration `1714953603_users_view_rule_shared_home.js` widens `users.viewRule` to `id = @request.auth.id || <shared-home ?=>`. A user's email is visible to any co-member. The migration's comment acknowledges the trade-off. Operator should decide whether this is acceptable; for a household app it matches user mental model.
- **Fix:** Not a defect per SPEC intent; noted for completeness.

### INFO

#### A-10: `proxy.ts` presence-only cookie check — correct posture
- The proxy intentionally does NOT cryptographically validate the cookie. PB re-validates every API call. Comment at `proxy.ts:13-15` explains this explicitly. Defense-in-depth layer is `(app)/layout.tsx:29-31` `if (!pb.authStore.isValid) redirect('/login')`.

#### A-11: `safeNext()` correctly blocks open-redirects
- `lib/actions/auth.ts:62-69`: rejects null, non-string, non-`/`-prefix, `//*` protocol-relative, and any `://`. Covers URL-encoded variants because the value is passed through Next.js form-data deserialization already decoded. Verified present at login + signup paths.

#### A-12: Invite token generator — 192-bit CSPRNG, URL-safe
- `lib/invite-tokens.ts` uses `randomBytes(24).toString('base64url')` → 32-char token. UNIQUE INDEX on `invites.token` is belt-and-braces. Token TTL 14 days (`INVITE_TTL_DAYS = 14`). Single-use via `accepted_at` flip inside `pb.createBatch()` transaction alongside the `home_members.create` — atomic.

#### A-13: Completion attribution enforced at PB rule
- `pocketbase/pb_migrations/1714867200_completions.js:38` + `1714953602_update_rules_multi_member.js:68`: `createRule` includes `@request.body.completed_by_id = @request.auth.id`. A member of home A CANNOT create a completion attributed to another member. `updateRule`/`deleteRule` = `null` → completions are append-only.

#### A-14: `createAdminClient()` correctly scoped
- `lib/pocketbase-admin.ts`: 3 callers — `invites.ts` (acceptInvite — needed because invitee cannot read own invite row); `scheduler.ts` (cron path — fine); `completions.ts:441` + `tasks.ts:507` (firing ntfys via `notifications.createRule = null`). All server-only, none reachable from a client route.

#### A-15: PB admin endpoint only via loopback
- `lib/pocketbase-admin.ts:43` — `new PocketBase('http://127.0.0.1:8090')`. Caddy overlay and docker compose front only port 3000. Direct PB superuser console on 8090 is not exposed externally (per VPS_ENVIRONMENT). Verify with `ss -tlnp` on the VPS.

## Cross-home isolation matrix

Rule strings (after migration chain `1714953600` → `1714953602` → `1745280000`):

Let `M` = `@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= home_id` (member-any).
Let `Mt` = same but via `task_id.home_id` (for completions / schedule_overrides).
Let `O(home)` = `@request.auth.id != "" && home_id.owner_id = @request.auth.id`.
Let `Oh` = `@request.auth.id != "" && owner_id = @request.auth.id` (for homes collection itself).

| Collection | listRule | viewRule | createRule | updateRule | deleteRule | Cross-home leak? |
|---|---|---|---|---|---|---|
| `homes` | member `?= id` | member `?= id` | `Oh` + self-insert | `Oh` owner-only | `Oh` owner-only | None — member-reads bounded; owner-writes bounded |
| `areas` | M | M | M | M | M + `is_whole_home_system=false` | None |
| `tasks` | M | M | M | M | M | None at DB; **see A-06** (area_id integrity) |
| `completions` | Mt | Mt | Mt + body-check `completed_by_id=auth.id` | `null` | `null` | None — append-only + attribution locked |
| `schedule_overrides` | Mt | Mt | Mt (NO body-check on created_by_id) | Mt | Mt | **See A-03** (creator forgery) |
| `home_members` | any co-member `?= home_id` | same | owner-of-home | owner-of-home | owner-of-home OR self (leave) | None |
| `invites` | owner-only | owner-only | owner-only | `null` (admin-only) | owner-only | None — token consumption via admin client |
| `notifications` | self (`user_id = @request.auth.id`) | self | `null` | `null` | `null` | None — superuser scheduler writes only |
| `users` | self OR shared-home | self OR shared-home | **default "" (open signup)** | default self-only | default self-only | **See A-02, A-08** |

Notes:
- All rules include `@request.auth.id != ""` to block anonymous access. Confirmed present at every rule string.
- Double-hop (`task_id.home_id`) uses `?=` (any-match) correctly; single-hop uses plain `=`. No `?=` vs `=` inversion found (the documented Pitfall 2).

## Invite flow threat model

### Token generation
- `lib/invite-tokens.ts` — `randomBytes(24)` → 192 bits → 32 chars base64url. UNIQUE INDEX `idx_invites_token`. Collision probability far below sub-nanogram dust.

### Expiry
- `createInvite` writes `expires_at: now + 14 days` (`invites.ts:84-86`).
- `acceptInvite` checks `Date.now() > expiresAt.getTime()` (`invites.ts:144-147`).

### Single-use
- `invites.ts:150-156`: if `accepted_at` present + `accepted_by_id === authId` → self-replay returns ok; else → `already-accepted`.
- The accept-path is `pb.createBatch()` containing `home_members.create` + `invites.update({accepted_at, accepted_by_id})`. Atomic: both succeed or both roll back. UNIQUE INDEX on `home_members (home_id, user_id)` is the anti-double-join backstop.

### Token exposure / logging
- `generateInviteToken` does not log.
- `createInvite` returns `{token, url}` to the owner; no server-side log.
- `revokeInvite` deletes the invite row; the token no longer resolves.
- **`acceptInvite` does not log the token on failure paths** — `return { ok: false, reason: ... }` with no console.* → good.
- ntfy payloads (`lib/scheduler.ts`) never include invite tokens.
- **BUT** invite URL is `${SITE_URL}/invite/${token}`. Referer-Policy is missing (see A-04) — token could leak via outbound navigation.

### Rate limiting on acceptance
- No PB rate-limit label covers `acceptInvite` path. The endpoint invoked is `admin.collection('invites').getFirstListItem(...)` with the admin client, so PB's `@guest` bucket doesn't apply.
- Impact: token brute-force. With 32-char base64url entropy, guessing a valid token is infeasible. But rapid accept-calls from a compromised account could snowball across stale invites.

### Replay after use
- Post-accept: `invite.accepted_at` is set. If the same user re-hits the link → returns `ok: true, homeId` (self-replay idempotent). If a different user hits it → `already-accepted`. Re-joining the same home is further blocked by `UNIQUE INDEX (home_id, user_id)` in the batch.

### Information disclosure on failure
- `acceptInviteSchema` regex runs BEFORE any PB call: `/^[A-Za-z0-9_-]{20,64}$/`. Malformed → `invalid`.
- Expired vs invalid vs already-accepted are distinguished in the response — a modest enumeration oracle, but not one that leaks tokens. Acceptable for UX.

## Server action gate matrix

| Action | File:line | Auth gate | Membership check | Notes |
|---|---|---|---|---|
| `loginAction` | auth.ts:71 | — (creates auth) | — | PB rate-limited 60/60s on authWithPassword |
| `signupAction` | auth.ts:108 | — (creates account) | — | `users.createRule = ""` (see A-02) |
| `logoutAction` | auth.ts:170 | — | — | Only deletes cookie; PB token remains valid server-side until natural expiry — see note |
| `requestResetAction` | auth.ts:177 | — | — | Account-nonexistence hidden |
| `confirmResetAction` | auth.ts:207 | — (token-based) | — | PB token validity enforced; no app-level rate limit |
| `createHome` | homes.ts:32 | `isValid && record` | n/a (creates) | owner_id from authStore |
| `updateHome` | homes.ts:85 | isValid | `assertOwnership` | |
| `switchHome` | homes.ts:143 | isValid && record | `assertMembership` | Silent no-op on failure |
| `deleteHome` | homes.ts:185 | isValid | `assertOwnership` | |
| `createArea` | areas.ts:41 | isValid | `assertMembership` | Template-literal filter — A-01 |
| `updateArea` | areas.ts:113 | isValid | `assertMembership` | |
| `reorderAreas` | areas.ts:180 | isValid | `assertMembership` | Batch atomicity |
| `deleteArea` | areas.ts:222 | isValid | `assertMembership` | Whole-Home guard at action + rule |
| `createTask` | tasks.ts:56 | isValid | `assertMembership` | area_id cross-checked to home_id |
| `updateTask` | tasks.ts:367 | isValid | `assertMembership` | area_id NOT cross-checked — A-06 |
| `archiveTask` | tasks.ts:540 | isValid | `assertMembership` | archive flags server-set |
| `completeTaskAction` | completions.ts:99 | isValid && record | `assertMembership` | Atomic batch |
| `snoozeTaskAction` | reschedule.ts:68 | isValid | `assertMembership` via task.home_id | created_by_id server-set |
| `rescheduleTaskAction` | reschedule.ts:156 | isValid | `assertMembership` via task.home_id | marker server-set |
| `rebalancePreviewAction` | rebalance.ts:195 | isValid (via preamble) | `assertMembership` | Read-only |
| `rebalanceApplyAction` | rebalance.ts:251 | isValid | `assertMembership` | Atomic batch |
| `removeMember` | members.ts:37 | isValid && record | `assertOwnership` + self-short-circuit + role-owner guard | |
| `leaveHome` | members.ts:108 | isValid && record | `assertMembership` + role !== 'owner' | |
| `skipOnboarding` | onboarding.ts:27 | isValid | `assertMembership` | Length==15 homeId check (the only action with this) |
| `updateNotificationPrefsAction` | notification-prefs.ts:36 | isValid && record | n/a (self) | users.updateRule gates |
| `batchCreateSeedTasks` | seed.ts:49 | isValid | `assertMembership` | seed_id + area_id allow-lists |
| `createInvite` | invites.ts:63 | isValid && record | `assertOwnership` | created_by_id server-set |
| `acceptInvite` | invites.ts:109 | isValid && record | n/a — invitee isn't member yet | Admin-client for invite read/update; user pb for users.update |
| `revokeInvite` | invites.ts:227 | isValid && record | `assertOwnership` | Pre-read invite to get home_id |

Every `'use server'` file audited imports `createServerClient()` and dereferences `pb.authStore.isValid` + `pb.authStore.record` before membership checks. No action bypasses the gate.

**Logout gap (A-16 INFO):** `logoutAction` only deletes the cookie (`lib/actions/auth.ts:170-175`). The PB token is not explicitly invalidated via `pb.authStore.clear()` server-side or by calling PB's `authRefresh` with a forced revoke. If an attacker captured the cookie value pre-logout, they could replay it until natural token expiry (14 days). Mitigation: HttpOnly makes in-browser capture hard; Secure-in-prod stops wire sniffing on HTTPS. Still, a server-side token revocation option would be cleaner — PB does not offer explicit revoke per SDK, so this is a PB limitation not a code defect.

## Public-facing risks (VPS `46.62.151.57:3000`)

The MEMORY records this as the deployment target on HTTP port 3000. Specific risks:

1. **HTTP-only traffic**: `pb_auth` cookie is HttpOnly but NOT Secure (dev/prod flag keyed on NODE_ENV — correct once prod build is shipped, since compose `NODE_ENV=production`). On the HTTP URL, cookies are readable on the wire by any on-path observer until TLS is fronted. An `InsecureContextBanner` already warns the user (`lib/secure-context.ts` + `(app)/h/[homeId]/layout.tsx:35`) — INFO only.
2. **Open signup (A-02)**: any internet user can register.
3. **Admin PB UI on 8090**: only exposed via Caddy overlay if `/_/*` is proxied. Default compose exposes port 3000 only, with PB bound to loopback — verify with `ss -tlnp` before going public.
4. **`ADMIN_SCHEDULER_TOKEN`**: fail-closed if unset or <32 chars. Correct design. Token comparison uses `!==` which is not timing-constant. For 32+ char tokens this isn't a practical oracle, but `crypto.timingSafeEqual` would be canonical. (LOW)
5. **`/api/admin/run-scheduler`** accepts `POST` from any IP (no allow-list). Token is the only gate. Consider binding to `127.0.0.1` or behind a reverse-proxy IP allow-list if this endpoint is public.
6. **Referrer leak of invite tokens (A-04)** becomes more material on public HTTP — any link click from an authed page sends the URL in the Referer to the outbound host.

## Next steps (where to probe deeper)

1. **Filter-injection PoC**: spin up a disposable PB + create a multi-home Alice, craft a URL `homeId` with PB filter metacharacters, confirm whether the extra rows appear or PB parses the filter as invalid (which would downgrade the finding to "denial of render" rather than "info-disclosure"). Script: `tests/unit/rules-member-isolation.test.ts` is the canonical scaffold.
2. **Password-reset token TTL & replay**: Confirm PB 0.37.1 reset-token is single-use by design (code path doesn't demonstrate it). Check `pocketbase` source or run a PoC — request 2 resets, use the first, then try to use the second; if the first token is still valid, that's a finding.
3. **Session rotation on password reset**: after `confirmPasswordReset`, existing `pb_auth` cookies should be invalidated server-side. PB's default behaviour here is worth confirming via the `tokenKey` field on the users collection (rotating it kills all old tokens).
4. **Signup rate-limit**: no PB rule covers `users:create` guest calls. Add one (`20/60s @guest`) in `bootstrap_ratelimits.pb.js`.
5. **CSRF audit**: server actions rely on Next's built-in origin check + SameSite=Lax. Confirm no action reads `Origin`/`Referer` for its own CSRF check (which would duplicate or confuse). Nothing found in audit — Next 16 handles this natively, but calling it out is worthwhile.
6. **Security headers**: no `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` set in `next.config.ts` or `app/layout.tsx`. v1.2 PWA + HTTPS deploy should layer these via Next `headers()` config.
7. **Email-verification**: PB users.requireVerify is not configured. New signups are immediately authed without email confirmation. For public deploy, enable `verified_only` flag on sensitive actions, or require verification before invite acceptance.
