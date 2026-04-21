# Phase 4: Collaboration - Research

**Researched:** 2026-04-21
**Domain:** Multi-user collaboration (membership, invites, rule-level access migration, cascading assignment resolution)
**Confidence:** HIGH on PB migration + hook patterns, HIGH on server-action patterns, HIGH on token generation, MEDIUM on PB `_via_` back-relation in `@request.auth.*` (verified via official docs discussion but will be exercised live for the first time in this phase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 — D-20)

**Collections (PB migrations):**

- **D-01:** Migration `1714953600_home_members.js` creates `home_members` collection: `home_id` (relation → homes, required, cascade), `user_id` (relation → users, required, cascade), `role` (select: `owner` | `member`, default `member`), `joined_at` (date, auto = created). Unique index on `(home_id, user_id)`. API: listRule/viewRule = "user is a member of this home"; createRule/updateRule = "user is owner of this home"; deleteRule = "user is owner OR user is the target (self-leave)".

- **D-02:** Migration `1714953601_invites.js` creates `invites` collection: `home_id` (relation → homes, required, cascade), `token` (text, required, unique, 32-char URL-safe random), `expires_at` (date, required, default now + 14 days), `accepted_at` (date, optional), `created_by_id` (relation → users, required), `accepted_by_id` (relation → users, optional). API: listRule/viewRule = owner-of-home only; createRule = owner-of-home; deleteRule = owner-of-home; **no updateRule is needed** — acceptance happens via a server action that runs as PB admin context (server-side only). Public invite-acceptance read happens through a dedicated server action, not direct PB API.

- **D-03:** **Backfill owner into home_members** on home creation. Extend the existing `pocketbase/pb_hooks/homes_whole_home.pb.js` hook (or add a new `homes_owner_member.pb.js`) — on `onRecordCreateExecute` for `homes`, also insert a `home_members` record `{home_id, user_id: owner_id, role: 'owner'}`. Atomic with the Whole Home creation (same transaction). Migration backfills any existing home records with their owner.

**Invite flow:**

- **D-04:** Owner clicks "Invite member" in home settings → server action `createInvite(homeId)` generates a 32-char URL-safe token, inserts invite record (expires_at = now + 14 days), returns invite URL `{SITE_URL}/invite/{token}`. The UI shows the URL + a "Copy link" button (shadcn Button + clipboard API) + "Expires in 14 days" tag.

- **D-05:** Public route `/invite/[token]` accepts the invite:
  - If not authenticated → redirect to `/login?next=/invite/[token]` (or `/signup?next=...`)
  - If authenticated → server action `acceptInvite(token)` validates (exists, not expired, not accepted), creates a `home_members` record for the current user with role=`member`, marks invite as accepted (sets `accepted_at` + `accepted_by_id`), redirects to `/h/[homeId]`.
  - Failure modes return friendly error pages: invalid token, expired, already accepted (by current user → redirect to /h/[homeId]; by someone else → "This invite was already used").

- **D-06:** Invite tokens are single-use. Once `accepted_at` is set, re-visiting the link shows "Already accepted" + link to /h/[homeId].

**Member management:**

- **D-07:** New page `/h/[homeId]/members` — owner-only. Lists all members with name + email + role + join date. Each row has a "Remove" button (except self). Confirm dialog on remove ("Remove {name} from {home.name}?"). Server action `removeMember(homeId, memberId)` deletes the `home_members` record; cascading effects documented below.

- **D-08:** **When a member is removed**, their task assignments in that home are set to NULL (cascade via PB relation on `tasks.assigned_to_id`). The task falls back to area default / "Anyone" per TASK-03. This is automatic because the `assigned_to_id` relation has `cascadeDelete=false` + (optional: `minSelect=0, maxSelect=1`) — PB auto-nullifies non-required relations on target delete.

**Cascading assignment:**

- **D-09:** **`lib/assignment.ts`** exports pure `resolveAssignee(task, area, homeMembers)` returning:
  ```ts
  type EffectiveAssignee =
    | { kind: 'task'; user: Member }     // task.assigned_to_id set + resolvable
    | { kind: 'area'; user: Member }     // area.default_assignee_id set (fallback)
    | { kind: 'anyone' }                 // neither set (third fallback)
  ```
  Task-level assignee wins; if unset, area-default-assignee; if unset, "Anyone".

- **D-10:** **Display in TaskRow + TaskDetailSheet:** effective assignee shown as small avatar + name with subtle icon: inherited (wire-frame avatar) vs overridden (solid avatar). "Anyone" shown as a dashed-border neutral placeholder icon. Tooltip: "Assigned via {kind}" (task / area / default).

**API access pattern change:**

- **D-11:** **PB collection API rules updated Phase 4:** homes/areas/tasks/completions rules change from "owner-only" to "**any home member**". The ownership-based filters in Phase 2 migration are replaced or augmented with `@request.auth.home_members_via_user_id.home_id ?= id` (or the `@collection` pattern) — see Pattern 1 below.
  - Supplemental migration: `1714953602_update_rules_multi_member.js` alters existing collections' rules to use the new membership-based filter.

- **D-12:** **Server-side ownership checks in actions** (`lib/actions/*`) updated: instead of "user.id === home.owner_id" preflight, use "user.id IN home_members WHERE home_id=X". Add helper `assertMembership(pb, homeId)` used by every mutation action.

- **D-13:** **Owner-only actions** remain owner-gated: createInvite, removeMember, deleteHome, updateHome (settings changes). Member-permitted: createArea, updateArea, createTask, updateTask, archiveTask, completeTask, reorderAreas.

**UI surfaces:**

- **D-14:** HomeSwitcher (already from Phase 2) now lists homes the user is a **member** of (via home_members query) instead of homes they own.

- **D-15:** Account menu (top-right) gains a "Leave home" action in a secondary menu when viewing a home you don't own. Confirms with "Leave {home.name}? Your task assignments will fall back to the area default." Server action `leaveHome(homeId)` deletes self's home_members record (only if not owner).

- **D-16:** **New settings route `/h/[homeId]/settings`** (owner-only): shows home name, address, timezone (editable), plus Invite Member section + Members list link. Danger zone: Delete home.

- **D-17:** **Home dashboard displays who's in the home** via a small avatar stack in the header (next to HomeSwitcher). Click the stack → navigate to `/h/[homeId]/members`.

**Testing:**

- **D-18:** Unit:
  - `lib/assignment.ts` — resolveAssignee matrix (task set, area set, neither set, task set AND area set → task wins, archived task → still resolves but typically not shown)
  - Invite token generation (32 char, URL-safe, cryptographically random — use `crypto.randomBytes(24).toString('base64url')` OR `crypto.randomUUID()` + base64url replacement)

- **D-19:** Integration:
  - PB hook: home creation inserts owner into home_members (same tx)
  - Migration rule update: non-member cannot read tasks of a home they're not in (403)

- **D-20:** E2E:
  - Owner creates invite → copies URL → logs out → opens URL in fresh session → signup/login → accept → lands in shared home → both users can see each other in `/h/[id]/members`
  - Cascade test: owner creates task assigned to member → member sees "assigned to Me" → owner removes member → task shows "Anyone"
  - Non-owner cannot access /settings or /members when role=member (redirected)

### Claude's Discretion

1. **Filter syntax for rule updates** — choose between `@request.auth.home_members_via_user_id.home_id ?= id` (back-relation on auth record) vs `@collection.home_members.user_id ?= @request.auth.id && @collection.home_members.home_id ?= id` (explicit cross-join). Recommend primary + document fallback. See §Architecture Pattern 1.

2. **Invite token generation implementation** — choose between `crypto.randomUUID()` + base64url-compatible replacement vs `crypto.randomBytes(N).toString('base64url')`. Recommend one.

3. **Avatar component** — shadcn does not ship an Avatar in components/ui yet. Choose between adding shadcn Avatar now (adds `@radix-ui/react-avatar`) vs rolling a minimal inline `<AvatarCircle initials color>` primitive. Avatars are used in 5 places (Members list, avatar stack, TaskRow assignee, TaskDetailSheet assignee, accept-invite success toast). Recommend the minimal primitive — bundle already has radix-ui dep but no avatar subcomponent, and the design brief (SPEC §19) explicitly wants initials-in-circles with warm-accent theming.

4. **Transfer ownership** — CONTEXT marks this as "optional scope for Phase 4". Recommend: **defer to Phase 5+** unless requirements surface. Adding `transferOwnership` multiplies edge cases (role swap inside a single batch, making sure old owner retains membership as member, UI flow for picking target member). HOME-07 ("manage members") is satisfied without it; v1 success criteria (SPEC §18) do not require it.

### Deferred Ideas (OUT OF SCOPE)

- Email invites (SMTP path) — documented as post-v1
- Role granularity beyond owner/member — post-v1
- Task rotation — v1.1
- Person view route — Phase 5
- Notifications on new-member, task-assigned — Phase 6
- Transfer ownership — recommended Phase 5+ (see Discretion #4)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOME-05 | User can share a home via shareable invite link | §Pattern 4 (invite token generation), §Pattern 5 (createInvite action), §UI Surfaces (invite-link-card) |
| HOME-06 | Invited user can accept invite and join a home | §Pattern 6 (acceptInvite action), §Pitfall 4 (race on concurrent accept), §Pitfall 5 (signup-then-accept UX) |
| HOME-07 | Home owner can manage members (view, remove) | §Pattern 7 (removeMember action), §Don't Hand-Roll (avatar stack) |
| TASK-02 | User can assign a task to a specific member (overrides area default) | §Pattern 2 (TaskForm assignee picker), taskSchema already has `assigned_to_id` from 02-05 |
| TASK-03 | Cascading assignment resolves: task assignee → area default → "Anyone" | §Pattern 3 (`lib/assignment.ts` pure fn), §Code Examples |
| TASK-04 | UI shows effective assignee with icon distinguishing inherited vs overridden | §Pattern 8 (AssigneeDisplay component), §Don't Hand-Roll #3 |
</phase_requirements>

## Summary

Phase 4 converts HomeKeep from single-user to multi-user. The mechanical work splits into four buckets:

1. **Schema + hook updates**: two new collections (`home_members`, `invites`), a rule-migration pass on existing collections, and a one-line extension to the existing Whole Home hook so owner-membership is inserted atomically with home creation.
2. **Server actions**: four new actions (`createInvite`, `acceptInvite`, `removeMember`, `leaveHome`), one helper (`assertMembership`), and a light update to every existing mutation action to swap ownership preflight for membership preflight.
3. **UI**: three new routes (`/invite/[token]`, `/h/[id]/settings`, `/h/[id]/members`), one new pure function (`lib/assignment.ts`), one new Client Component (`AssigneeDisplay`), and a HomeSwitcher query change.
4. **Invariants**: every existing home must gain an owner `home_members` row on deploy (backfill migration), the token generator must be CSPRNG-sourced + unique-indexed, and the "what happens to task assignments when a member is removed" invariant must be automatic (relies on PB 0.37 `cascadeDelete: false` on an optional relation auto-nullifying the reference).

**Primary recommendation:** Use `@request.auth.home_members_via_user_id.home_id ?= id` as the primary rule filter (back-relation on the authenticated user's `home_members` records — Pitfall-resistant, performs well per PB 0.22+ backing index). Keep the `@collection.home_members.*` cross-join form documented as a fallback in case the `_via_` form misbehaves at runtime — the rule-update migration can be adjusted without a full PB reboot because collection rules are data rows, not code.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Membership gating (is user X allowed to read home Y?) | PB API rules | Server action `assertMembership` | PB rules are the source of ownership truth; server action provides friendly error + preflight (defence-in-depth, matches 02-04 pattern). |
| Invite token generation | Next.js server action (`'use server'`) | — | Token must come from Node `crypto` module — Web Crypto also available but keep parity with Next 16 conventions. Runs server-side only; client never sees token secret before redirect. |
| Invite acceptance | Next.js server action | PB `createBatch` for atomicity | Uses the authenticated user's PB client (cookie auth) so acceptance attribution is trusted; the batch wraps "create home_members + update invite" in a single read+write txn. |
| Home-member list read | Server Component | PB listRule | /h/[id]/members page fetches via PB's viewRule-gated list; rule enforces owner-only access (D-07). |
| Effective assignee resolution | Pure function (`lib/assignment.ts`) | — | Stateless; takes {task, area, members[]} and returns discriminated union. Rendered in RSC or Client Component — same input, same output. |
| Effective assignee display | Client Component (`AssigneeDisplay`) | — | Reads resolved effective-assignee from props. No client-side PB reads. |
| HomeSwitcher membership query | Server Component (layout.tsx) | PB listRule | Query swaps from `owner_id = authId` to `home_members_via_home_id.user_id ?= authId` — see Pattern 10. |
| Task assignment-override mutation | Server action (updateTask) | PB updateRule | Adds `assigned_to_id` to the accepted fields; updateRule gates via membership (D-11). |
| Cascading nullify on member removal | PB relation field semantics | — | `tasks.assigned_to_id` is already `cascadeDelete: false` + `minSelect: 0` from 02-01. Deleting the referenced user auto-nullifies the field. No code path needed. |

## Standard Stack

### Core (all installed, no additions needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pocketbase | 0.26.8 | JS SDK for PB 0.37 server | Already installed; `pb.createBatch()` available for atomic invite-accept [VERIFIED: package.json] |
| node:crypto | built-in (Node 22) | CSPRNG invite token generation | `crypto.randomBytes(24).toString('base64url')` → 32-char URL-safe string [CITED: nodejs.org/api/crypto.html] |
| zod | 4.1.0 | Invite / member schema validation | Pattern established in 02-03, 02-04, 02-05 [VERIFIED: package.json] |
| react-hook-form | 7.73.1 | Settings form + task-assignee picker | Already used by 02-04 IconPicker / 02-05 TaskForm — Controller + zodResolver [VERIFIED: package.json] |
| lucide-react | 1.8.0 | UserPlus, UserX, Crown, UserCircle2 icons for member UI | Established in 02-04; no new install needed [VERIFIED: package.json] |
| sonner | 2.0.7 | Toast "Invite link copied" + "Member removed" | Already wired in 02-03 AccountMenu logout toast [VERIFIED: package.json] |

### Supporting (installed but newly-applied in this phase)

| Library | Purpose | When to Use |
|---------|---------|-------------|
| @radix-ui/react-* (via `radix-ui` 1.4.3) | Underlying primitives for shadcn Dialog (confirm-remove) and Tooltip (assigned-via-hint) | Already present; Dialog used from 02-04; Tooltip NOT yet imported from shadcn — add `components/ui/tooltip.tsx` via shadcn CLI if needed for D-10 hover-explanation. Alternative: plain `<span title>` on the AvatarCircle is acceptable (matches minimalist aesthetic SPEC §19). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.randomBytes(24).toString('base64url')` | `crypto.randomUUID()` + base64url escape | UUID is 128 bits, base64-encoded = 22 chars after dash-strip. `randomBytes(24)` = 192 bits, base64url = 32 chars — matches D-02 spec "32-char URL-safe" exactly. UUID path works but the 22-char result doesn't hit spec. **Use randomBytes.** |
| PB back-relation `@request.auth.home_members_via_user_id.home_id ?= id` | `@collection.home_members.user_id ?= @request.auth.id && @collection.home_members.home_id ?= id` | Back-relation form is idiomatic since PB 0.22+ and compiles to the same SQL join [CITED: pocketbase discussions #4417]. `@collection` form requires two explicit joins but is more portable if `_via_` ever changes. **Use back-relation; keep `@collection` form documented as fallback.** |
| `pb.createBatch()` for invite accept | Two sequential calls (create home_members, update invite) | Batch is atomic per PB docs [CITED: pocketbase docs]. Sequential has a window where home_members exists but invite is still open — second tab could double-accept. **Use batch.** |
| Rolling a new `homes_owner_member.pb.js` hook | Extending the existing `homes_whole_home.pb.js` hook | Two hooks on the same `onRecordCreateExecute("homes")` event fire in registration order; splitting keeps each hook single-purpose but adds a second e.next() subtlety. Extending the existing hook is safer — one transaction, one e.next(), Whole Home + owner-member creates both sit after it. **Extend existing hook.** |

**Installation: none — all deps already present.** Migration files only.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────┐
                         │    Owner creates invite     │
                         │       (home settings)       │
                         └──────────────┬──────────────┘
                                        │ POST invite (server action)
                                        ▼
                         ┌─────────────────────────────┐
                         │  createInvite(homeId)       │
                         │  ───────────────────────    │
                         │  • assertOwnership(pb, h)   │
                         │  • token = randomBytes(24)  │
                         │      .toString('base64url') │
                         │  • pb.invites.create({      │
                         │      home_id, token,        │
                         │      expires_at, by })      │
                         │  • return {url, expires_at} │
                         └──────────────┬──────────────┘
                                        │ returns URL
                                        ▼
                         ┌─────────────────────────────┐
                         │  UI: InviteLinkCard         │
                         │  • "Copy link" → clipboard  │
                         │  • toast "Copied"           │
                         │  • "Expires Apr 30" tag     │
                         └──────────────┬──────────────┘
                                        │ URL shared out-of-band
                                        ▼
                         ┌─────────────────────────────┐
                         │  Invitee visits /invite/T   │
                         └──────────────┬──────────────┘
                                        │
                      ┌─────────────────┴──────────────────┐
                      │                                    │
                      ▼ unauthed                           ▼ authed
         ┌─────────────────────────┐       ┌────────────────────────────┐
         │ Redirect to             │       │ acceptInvite(token)        │
         │  /signup?next=/invite/T │       │ ───────────────────────    │
         │  (or /login?next=…)     │       │ • validate not-expired     │
         └───────────┬─────────────┘       │ • validate not-accepted    │
                     │ after signup        │ • pb.createBatch():        │
                     │ proxy.ts redirects  │    - home_members.create   │
                     │ to next=/invite/T   │    - invites.update({      │
                     └────────────────────▶│        accepted_at,        │
                                           │        accepted_by_id })   │
                                           │ • revalidatePath /h        │
                                           │ • redirect /h/[homeId]     │
                                           └──────────────┬─────────────┘
                                                          ▼
                                           ┌────────────────────────────┐
                                           │  Member now sees the home  │
                                           │  in HomeSwitcher           │
                                           │  (home_members_via         │
                                           │   back-relation query)     │
                                           └──────────────┬─────────────┘
                                                          ▼
                         ┌─────────────────────────────────────────────────────┐
                         │          Any member mutation (createTask etc.)       │
                         │  ────────────────────────────────────────────────    │
                         │  • Server action: assertMembership(pb, homeId)       │
                         │  • PB rule: @request.auth.home_members_via_user_id   │
                         │      .home_id ?= home_id                             │
                         │  (double-gate: action returns friendly error,        │
                         │   PB rule is final source of truth)                  │
                         └─────────────────────────────────────────────────────┘

   Cascade: when owner removes member (deletes home_members row)
     ↓ PB relation target-delete logic
     • tasks.assigned_to_id references the removed user? ─▶ auto-null (cascadeDelete:false + optional relation)
     • completions.completed_by_id (cascadeDelete:false, REQUIRED) ─▶ delete blocks. OK — completions are audit trail.
     • home_members itself: cascadeDelete:true on user_id ─▶ row removed (redundant with explicit delete)
```

### Recommended Project Structure (additions only — existing files untouched unless noted)

```
pocketbase/
├── pb_migrations/
│   ├── 1714780800_init_homekeep.js       # (unchanged — Phase 2)
│   ├── 1714867200_completions.js         # (unchanged — Phase 3)
│   ├── 1714953600_home_members.js        # NEW — D-01
│   ├── 1714953601_invites.js             # NEW — D-02
│   └── 1714953602_update_rules_multi_member.js  # NEW — D-11 rule migration
└── pb_hooks/
    └── homes_whole_home.pb.js            # MODIFIED — add owner-member insert (D-03)

lib/
├── assignment.ts                         # NEW — pure resolveAssignee (D-09)
├── invite-tokens.ts                      # NEW — generateInviteToken() helper
├── actions/
│   ├── invites.ts                        # NEW — createInvite, acceptInvite
│   ├── members.ts                        # NEW — removeMember, leaveHome
│   ├── homes.ts                          # MODIFIED — HomeSwitcher-source query swap (D-14) via layout.tsx; deleteHome stays owner-only
│   ├── areas.ts                          # MODIFIED — swap ownership preflight → assertMembership
│   └── tasks.ts                          # MODIFIED — swap ownership preflight → assertMembership; accept assigned_to_id
├── membership.ts                         # NEW — assertMembership(pb, homeId), assertOwnership(pb, homeId)
└── schemas/
    ├── invite.ts                         # NEW — createInviteSchema, acceptInviteSchema
    └── member.ts                         # NEW — removeMemberSchema

components/
├── invite-link-card.tsx                  # NEW — URL display + Copy button + expires tag
├── members-list.tsx                      # NEW — rows with Remove button
├── assignee-display.tsx                  # NEW — avatar + kind icon (D-10)
├── avatar-circle.tsx                     # NEW — minimal initials-in-circle primitive
├── avatar-stack.tsx                      # NEW — header avatar stack (D-17)
├── leave-home-menu-item.tsx              # NEW — AccountMenu extension (D-15)
├── home-switcher.tsx                     # MODIFIED — no code change; source data swap in layout.tsx
├── task-row.tsx                          # MODIFIED — thread effective-assignee prop into row
└── task-detail-sheet.tsx                 # MODIFIED — show effective-assignee section + kind pill

app/(app)/h/[homeId]/
├── page.tsx                              # MODIFIED — fetch members + resolve effective assignee per task
├── settings/page.tsx                     # NEW — owner-only settings (D-16)
├── members/page.tsx                      # NEW — owner-only members list (D-07)
└── leave/page.tsx                        # NEW — leave-home confirmation (D-15)

app/(public)/
├── invite/[token]/page.tsx               # NEW — D-05 public accept surface
└── signup/page.tsx                       # MODIFIED — thread ?next= param through to post-signup redirect

app/(app)/
└── layout.tsx                            # MODIFIED — HomeSwitcher data source swap to home_members back-relation (D-14)
```

### Pattern 1: PB Rule Filter for Membership Gating

**What:** Every collection that previously gated on `home_id.owner_id = @request.auth.id` migrates to gate on "authenticated user has a home_members row for this home".

**When to use:** `homes` (list/view rules), `areas` (list/view/create/update/delete), `tasks` (list/view/create/update), `completions` (list/view/create). Owner-only paths keep the `owner_id = @request.auth.id` clause.

**Primary form (recommended):** back-relation on the auth user record:

```
@request.auth.home_members_via_user_id.home_id ?= id
```

For child collections (areas/tasks/completions), we need to reach the home_id through the child's relation:

```
// areas rule: user is a member of the home this area belongs to
@request.auth.home_members_via_user_id.home_id ?= home_id

// tasks rule: same, via tasks.home_id
@request.auth.home_members_via_user_id.home_id ?= home_id

// completions rule: double-hop — completion.task_id.home_id must be in user's homes
@request.auth.home_members_via_user_id.home_id ?= task_id.home_id
```

**Fallback form (if back-relation misbehaves):**

```
@collection.home_members.user_id ?= @request.auth.id && @collection.home_members.home_id ?= id
```

**Why `?=` not `=`:** `home_members_via_user_id` resolves to a **set** of home_members rows for this user (one per joined home). `?=` is PB's "any-match" operator — at least one row in the set must satisfy the right-hand side. Plain `=` would require ALL rows to match, which only works if the user is in exactly one home [CITED: pocketbase.io/docs/api-rules-and-filters/].

**Example — areas collection rule migration:**

```javascript
// Before (Phase 2):
listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',

// After (Phase 4 — member-of-home):
listRule:   '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= home_id',
```

**Owner-only preserved:**

```javascript
// homes.updateRule stays owner-only for settings changes (D-13):
updateRule: '@request.auth.id != "" && owner_id = @request.auth.id',
// homes.deleteRule also owner-only:
deleteRule: '@request.auth.id != "" && owner_id = @request.auth.id',
```

**Source:** [Pocketbase Discussion #4417 — "Notes about the upcoming back relation support"](https://github.com/pocketbase/pocketbase/discussions/4417) [CITED]; [pocketbase.io/docs/working-with-relations](https://pocketbase.io/docs/working-with-relations/) [CITED].

### Pattern 2: Complete rule-update migration (paste-ready)

```javascript
/// <reference path="../pb_data/types.d.ts" />
// 1714953602_update_rules_multi_member.js — D-11.
// Switches homes/areas/tasks/completions rules from owner-only read to
// member-of-home read. Owner-only stays for mutations that change
// structure (home update/delete, invites, member management).
migrate((app) => {
  const homes       = app.findCollectionByNameOrId("homes");
  const areas       = app.findCollectionByNameOrId("areas");
  const tasks       = app.findCollectionByNameOrId("tasks");
  const completions = app.findCollectionByNameOrId("completions");

  // ─── homes ────────────────────────────────────────────────────────
  // READ = any member. WRITE (update/delete) = owner only.
  homes.listRule = '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= id';
  homes.viewRule = '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= id';
  homes.createRule = '@request.auth.id != "" && owner_id = @request.auth.id';
  homes.updateRule = '@request.auth.id != "" && owner_id = @request.auth.id';
  homes.deleteRule = '@request.auth.id != "" && owner_id = @request.auth.id';
  app.save(homes);

  // ─── areas ────────────────────────────────────────────────────────
  // READ + WRITE = any member. Whole Home deletion still blocked by
  // schema flag is_whole_home_system = false.
  const memberRule = '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= home_id';
  areas.listRule   = memberRule;
  areas.viewRule   = memberRule;
  areas.createRule = memberRule;
  areas.updateRule = memberRule;
  areas.deleteRule = memberRule + ' && is_whole_home_system = false';
  app.save(areas);

  // ─── tasks ────────────────────────────────────────────────────────
  tasks.listRule   = memberRule;
  tasks.viewRule   = memberRule;
  tasks.createRule = memberRule;
  tasks.updateRule = memberRule;
  tasks.deleteRule = memberRule;  // hard delete; archive via updateTask
  app.save(tasks);

  // ─── completions (double-hop) ─────────────────────────────────────
  const memberRuleViaTask = '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= task_id.home_id';
  completions.listRule   = memberRuleViaTask;
  completions.viewRule   = memberRuleViaTask;
  // createRule keeps the body-check from 03-01 so no-one can forge
  // completions as another user.
  completions.createRule = memberRuleViaTask + ' && @request.body.completed_by_id = @request.auth.id';
  // updateRule/deleteRule remain null (superuser only) per 03-01 D-10.
  app.save(completions);
}, (app) => {
  // DOWN: restore Phase 2/3 owner-only rules.
  const homes       = app.findCollectionByNameOrId("homes");
  const areas       = app.findCollectionByNameOrId("areas");
  const tasks       = app.findCollectionByNameOrId("tasks");
  const completions = app.findCollectionByNameOrId("completions");

  const ownerHomes = '@request.auth.id != "" && owner_id = @request.auth.id';
  homes.listRule = ownerHomes; homes.viewRule = ownerHomes;
  homes.createRule = ownerHomes; homes.updateRule = ownerHomes; homes.deleteRule = ownerHomes;
  app.save(homes);

  const ownerChild = '@request.auth.id != "" && home_id.owner_id = @request.auth.id';
  areas.listRule = ownerChild; areas.viewRule = ownerChild;
  areas.createRule = ownerChild; areas.updateRule = ownerChild;
  areas.deleteRule = ownerChild + ' && is_whole_home_system = false';
  app.save(areas);

  tasks.listRule = ownerChild; tasks.viewRule = ownerChild;
  tasks.createRule = ownerChild; tasks.updateRule = ownerChild; tasks.deleteRule = ownerChild;
  app.save(tasks);

  const ownerCompletion = '@request.auth.id != "" && task_id.home_id.owner_id = @request.auth.id';
  completions.listRule = ownerCompletion; completions.viewRule = ownerCompletion;
  completions.createRule = ownerCompletion + ' && @request.body.completed_by_id = @request.auth.id';
  app.save(completions);
});
```

### Pattern 3: home_members migration (paste-ready)

```javascript
/// <reference path="../pb_data/types.d.ts" />
// 1714953600_home_members.js — D-01 + D-03 backfill.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const homes = app.findCollectionByNameOrId("homes");

  const members = new Collection({
    type: "base",
    name: "home_members",
    // READ: any member of this home can see the full member list.
    listRule: '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= home_id',
    viewRule: '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= home_id',
    // CREATE: only owner-of-home can add a member (server action uses
    // PB admin context for acceptInvite; owner path can use this rule).
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    // UPDATE: owner-of-home (role changes, future). Not wired in Phase 4 UI.
    updateRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    // DELETE: owner-of-home OR the target member themselves (self-leave).
    deleteRule: '@request.auth.id != "" && (home_id.owner_id = @request.auth.id || user_id = @request.auth.id)',
  });

  members.fields.add(new RelationField({
    name: "home_id",
    required: true,
    collectionId: homes.id,
    cascadeDelete: true,      // delete home → delete all member rows
    minSelect: 1, maxSelect: 1,
  }));
  members.fields.add(new RelationField({
    name: "user_id",
    required: true,
    collectionId: users.id,
    cascadeDelete: true,      // delete user → delete their memberships + cascade task.assigned_to_id nullification
    minSelect: 1, maxSelect: 1,
  }));
  members.fields.add(new SelectField({
    name: "role",
    required: true,
    values: ["owner", "member"],
    maxSelect: 1,
  }));
  members.fields.add(new AutodateField({ name: "joined_at", onCreate: true }));
  members.fields.add(new AutodateField({ name: "created", onCreate: true }));
  members.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));

  members.indexes = [
    "CREATE UNIQUE INDEX idx_home_members_home_user ON home_members (home_id, user_id)",
    "CREATE INDEX idx_home_members_user ON home_members (user_id)",  // back-relation lookup accelerant
  ];
  app.save(members);

  // ─── Backfill existing homes with their owners as home_members ────
  // Phase 2 + 2.1 deployed homes exist without membership rows; every
  // one must get one before rule-update migration lands.
  const homesRows = app.findRecordsByFilter("homes", "", "", 0, 0);
  for (const home of homesRows) {
    // Idempotent: skip if owner already has a row (e.g., replay).
    try {
      const existing = app.findFirstRecordByFilter(
        "home_members",
        "home_id = {:hid} && user_id = {:uid}",
        { hid: home.id, uid: home.get("owner_id") },
      );
      if (existing) continue;
    } catch (_) { /* no match is OK */ }

    const row = new Record(members, {
      home_id: home.id,
      user_id: home.get("owner_id"),
      role: "owner",
    });
    app.save(row);
  }
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("home_members");
    app.delete(c);
  } catch (_) { /* idempotent */ }
});
```

### Pattern 4: invites migration (paste-ready)

```javascript
/// <reference path="../pb_data/types.d.ts" />
// 1714953601_invites.js — D-02.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const homes = app.findCollectionByNameOrId("homes");

  const invites = new Collection({
    type: "base",
    name: "invites",
    // Only owner-of-home can list/view/create/delete invites. updateRule is
    // null (superuser only) — acceptance happens via a server action that
    // bypasses the public API for that one write. No public read: token
    // is validated server-side only.
    listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    updateRule: null,  // acceptInvite runs with admin client or via impersonate()
    deleteRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
  });

  invites.fields.add(new RelationField({
    name: "home_id",
    required: true,
    collectionId: homes.id,
    cascadeDelete: true,
    minSelect: 1, maxSelect: 1,
  }));
  invites.fields.add(new TextField({
    name: "token",
    required: true,
    min: 20,    // ensure no truncation; 32-char expected but allow margin
    max: 64,
    pattern: "^[A-Za-z0-9_-]+$",  // base64url alphabet
  }));
  invites.fields.add(new DateField({ name: "expires_at", required: true }));
  invites.fields.add(new DateField({ name: "accepted_at" }));
  invites.fields.add(new RelationField({
    name: "created_by_id",
    required: true,
    collectionId: users.id,
    cascadeDelete: false,  // preserve audit trail even if user deleted
    minSelect: 1, maxSelect: 1,
  }));
  invites.fields.add(new RelationField({
    name: "accepted_by_id",
    collectionId: users.id,
    cascadeDelete: false,
    minSelect: 0, maxSelect: 1,
  }));
  invites.fields.add(new AutodateField({ name: "created", onCreate: true }));
  invites.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));

  invites.indexes = [
    "CREATE UNIQUE INDEX idx_invites_token ON invites (token)",   // collision safety
    "CREATE INDEX idx_invites_home ON invites (home_id)",
  ];
  app.save(invites);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("invites");
    app.delete(c);
  } catch (_) { /* idempotent */ }
});
```

### Pattern 5: Hook extension — homes_whole_home.pb.js modification

**What:** Add a single `new Record(home_members, {...})` + `e.app.save(...)` after the Whole Home creation. The existing `e.next()`-first order is preserved — it persists the home so both the Whole Home area AND the owner-member row have a valid `home_id` FK target.

**Exact edit (unified diff style):**

```javascript
onRecordCreateExecute((e) => {
  if (e.record.collection().name !== "homes") {
    e.next();
    return;
  }

  // Persist the home first so its ID becomes a valid relation target.
  e.next();

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
  e.app.save(wholeHome);

  // ─── ADDED in Phase 4 (D-03) ──────────────────────────────────────
  // Auto-create the owner's home_members row in the same DB transaction.
  // If this throws, the whole transaction rolls back — no orphan home,
  // no home without a Whole Home, no home without its owner membership.
  const members = e.app.findCollectionByNameOrId("home_members");
  const ownerMember = new Record(members, {
    home_id: e.record.id,
    user_id: e.record.get("owner_id"),
    role:    "owner",
  });
  e.app.save(ownerMember);
  // ─── END ADDED ────────────────────────────────────────────────────
}, "homes");
```

**Note on hook ordering:** a separate file `homes_owner_member.pb.js` would also work, but two hooks on the same event each call `e.next()` independently — the second's `e.next()` becomes a no-op, but it's still a subtle pattern. Consolidating into one hook keeps it obvious that "home creation = home + whole home area + owner membership" is a single atomic unit. [ASSUMED based on PB JSVM hook chain semantics in 02-01 SUMMARY.]

### Pattern 6: Invite token generation

```typescript
// lib/invite-tokens.ts
import { randomBytes } from 'node:crypto';

/**
 * Generate a URL-safe, cryptographically random invite token.
 *
 * randomBytes(24) = 192 bits of entropy → 32-char base64url string.
 * Birthday-collision probability crosses 1e-9 only after ~9e13 tokens
 * (far beyond any realistic HomeKeep household count), and the `token`
 * column has a UNIQUE index as belt-and-braces (Pattern 4).
 *
 * base64url encoding (Node 16+):
 *   - replaces + with -, / with _, strips padding
 *   - matches D-02's "URL-safe" requirement; no encodeURIComponent needed
 *
 * Matches D-18 Unit test expectations: length === 32, regex /^[A-Za-z0-9_-]+$/.
 */
export function generateInviteToken(): string {
  return randomBytes(24).toString('base64url');
}
```

**Why Node `crypto.randomBytes` over Web Crypto (`crypto.getRandomValues`):** both are CSPRNG-backed [CITED: nodejs.org/api/crypto.html]. `randomBytes` is the canonical Node server-side primitive, already the one Next.js docs recommend for server actions, and it returns a Buffer with `.toString('base64url')` support built in since Node 16.

**Why not `crypto.randomUUID()`:** UUID v4 = 128 bits, base64 = 22 chars. D-02 spec says 32 chars. `randomBytes(24)` = 192 bits → 32 chars exactly. Better entropy per D-02 letter of the law.

### Pattern 7: createInvite server action (paste-ready)

```typescript
// lib/actions/invites.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import { generateInviteToken } from '@/lib/invite-tokens';
import { assertOwnership } from '@/lib/membership';
import type { ActionState } from '@/lib/schemas/auth';

const INVITE_TTL_DAYS = 14;

export type CreateInviteResult =
  | { ok: true; token: string; url: string; expiresAt: string }
  | { ok: false; formError: string };

export async function createInvite(homeId: string): Promise<CreateInviteResult> {
  if (typeof homeId !== 'string' || homeId.length === 0) {
    return { ok: false, formError: 'Missing home id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }
  const authId = pb.authStore.record.id;

  // D-13: createInvite is owner-only. assertOwnership throws on mismatch;
  // we translate to a friendly error without leaking the reason.
  try {
    await assertOwnership(pb, homeId);
  } catch {
    return { ok: false, formError: 'Only the home owner can create invites' };
  }

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();

  try {
    await pb.collection('invites').create({
      home_id: homeId,
      token,
      expires_at: expiresAt,
      created_by_id: authId,
    });
  } catch {
    return { ok: false, formError: 'Could not create invite' };
  }

  // SITE_URL is runtime env (Phase 1 .env.example); falls back to empty
  // string → relative URL still works when opened from a browser tab on
  // the same host. Next.js `headers()` could also reflect host; prefer
  // env for consistency with email-invite future (Phase 6).
  const baseUrl = process.env.SITE_URL?.replace(/\/+$/, '') ?? '';
  const url = `${baseUrl}/invite/${token}`;

  revalidatePath(`/h/${homeId}/settings`);
  revalidatePath(`/h/${homeId}/members`);
  return { ok: true, token, url, expiresAt };
}
```

### Pattern 8: acceptInvite server action (paste-ready, with atomicity)

```typescript
// lib/actions/invites.ts (continued)
export type AcceptInviteResult =
  | { ok: true; homeId: string }
  | { ok: false; reason: 'not-authed' | 'invalid' | 'expired' | 'already-accepted' | 'self-already-member' | 'error' };

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'invalid' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, reason: 'not-authed' };
  }
  const authId = pb.authStore.record.id;

  // The invite record has listRule=owner-only, so the invitee (not yet
  // the owner) CANNOT directly `pb.collection('invites').getFirstListItem`
  // — they'd get 404. We solve this by reading with an admin client.
  // createPbAdminClient uses PB_ADMIN_EMAIL/PASS from env (Phase 1 sets
  // these during container bootstrap); fallback is to use PB impersonate
  // API with the invite's created_by_id.
  //
  // HOMEKEEP PATTERN: let the server action run as superuser ONLY for
  // the invite read + invite update; the home_members.create happens
  // through the authed user's client so attribution is correct.
  const admin = await createAdminClient();  // see Pattern 12

  let invite;
  try {
    invite = await admin.collection('invites').getFirstListItem(
      admin.filter('token = {:t}', { t: token }),
    );
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  const expiresAt = new Date(invite.expires_at as string);
  if (Date.now() > expiresAt.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  if (invite.accepted_at) {
    // If accepted by the current user already, treat as success-redirect.
    if (invite.accepted_by_id === authId) {
      return { ok: true, homeId: invite.home_id as string };
    }
    return { ok: false, reason: 'already-accepted' };
  }

  // Defence: if current user is already a member (e.g., owner re-uses
  // their own invite), short-circuit to success.
  try {
    await admin.collection('home_members').getFirstListItem(
      admin.filter('home_id = {:h} && user_id = {:u}', {
        h: invite.home_id, u: authId,
      }),
    );
    // Already a member; mark invite consumed + redirect.
    await admin.collection('invites').update(invite.id, {
      accepted_at: new Date().toISOString(),
      accepted_by_id: authId,
    });
    return { ok: true, homeId: invite.home_id as string };
  } catch { /* not a member yet — proceed */ }

  // Atomic batch: create the membership + mark invite accepted in one tx.
  // If either fails, both roll back — no orphan membership, no re-usable
  // invite. pb.createBatch is a PB 0.22+ feature; this project uses 0.37
  // so it's available.
  try {
    const batch = admin.createBatch();
    batch.collection('home_members').create({
      home_id: invite.home_id,
      user_id: authId,
      role: 'member',
    });
    batch.collection('invites').update(invite.id, {
      accepted_at: new Date().toISOString(),
      accepted_by_id: authId,
    });
    await batch.send();
  } catch {
    return { ok: false, reason: 'error' };
  }

  // HOME-03: set the joined home as last-viewed so the post-accept
  // redirect lands exactly on the shared home dashboard.
  try {
    await pb.collection('users').update(authId, {
      last_viewed_home_id: invite.home_id,
    });
  } catch { /* non-fatal */ }

  revalidatePath('/h', 'layout');
  return { ok: true, homeId: invite.home_id as string };
}
```

**Alternative without admin client:** if the operator hasn't configured PB admin creds, the invites `viewRule` can be relaxed to `"@request.auth.id != ''"` (any authed user can view an invite row if they know its id) — but this leaks tokens to arbitrary authed users via `pb.collection('invites').getList()`. **Not acceptable.** Sticking with admin-client pattern.

### Pattern 9: `lib/membership.ts` helper (paste-ready)

```typescript
// lib/membership.ts
import type PocketBase from 'pocketbase';

/**
 * Throws if the authenticated user is not a member of `homeId`.
 *
 * Used by every mutation action in lib/actions/* (areas.ts, tasks.ts,
 * completions.ts) that was previously gating on owner-only access.
 *
 * Rationale: the PB API rule is the source of truth (every PB write goes
 * through @request.auth.home_members_via_user_id.home_id ?= home_id rule
 * evaluation), but surfacing the authorization failure as a friendly
 * action-level error beats a cryptic 404 from the collection layer.
 *
 * Performance: a single lookup on (home_id, user_id) — we have a UNIQUE
 * index on that pair per Pattern 3.
 */
export async function assertMembership(
  pb: PocketBase,
  homeId: string,
): Promise<{ role: 'owner' | 'member' }> {
  const authId = pb.authStore.record?.id;
  if (!authId) throw new Error('Not authenticated');

  const row = await pb.collection('home_members').getFirstListItem(
    pb.filter('home_id = {:h} && user_id = {:u}', { h: homeId, u: authId }),
  );
  return { role: row.role as 'owner' | 'member' };
}

/**
 * Throws if the authenticated user is not the owner of `homeId`.
 * Used by createInvite, removeMember, leaveHome's owner-check, and
 * updateHome / deleteHome settings actions.
 */
export async function assertOwnership(
  pb: PocketBase,
  homeId: string,
): Promise<void> {
  const { role } = await assertMembership(pb, homeId);
  if (role !== 'owner') throw new Error('Not home owner');
}
```

### Pattern 10: Cascading assignment resolver (pure fn, paste-ready signature)

```typescript
// lib/assignment.ts
import type { TaskRecord } from '@/lib/task-scheduling';

export type Member = {
  id: string;
  name: string;
  email?: string;
  role: 'owner' | 'member';
};

export type AreaLite = {
  id: string;
  default_assignee_id: string | null;
};

export type TaskLite = {
  id: string;
  assigned_to_id: string | null;
  area_id: string;
};

export type EffectiveAssignee =
  | { kind: 'task'; user: Member }
  | { kind: 'area'; user: Member }
  | { kind: 'anyone' };

/**
 * Pure cascading-assignment resolver (D-09, TASK-03).
 *
 * Cases:
 *   1. task.assigned_to_id set AND user still in home_members → 'task'
 *   2. task.assigned_to_id set BUT user no longer in home_members
 *      (edge: assignee was removed, cascadeDelete nullified the ref —
 *      but if race: fallback to area default)
 *   3. task.assigned_to_id unset, area.default_assignee_id set AND
 *      member-of-home → 'area'
 *   4. neither set → 'anyone'
 *   5. both set → 'task' wins (task-level override)
 *
 * Edge cases:
 *   - Archived task: still resolves (caller decides whether to render)
 *   - Deleted assignee user: cascadeDelete:false + optional relation →
 *     assigned_to_id is auto-nullified; handled by case 4 falling through
 *   - Multiple overlapping rules: the cascade is strict, not "most specific
 *     wins" — if the member is removed and area_default is also a non-member,
 *     we fall to 'anyone' regardless of any historical pairing.
 */
export function resolveAssignee(
  task: TaskLite,
  area: AreaLite,
  members: Member[],
): EffectiveAssignee {
  const byId = new Map(members.map((m) => [m.id, m]));

  // Case 1 + 5: task-level assignee wins when the assignee is still a member.
  if (task.assigned_to_id) {
    const user = byId.get(task.assigned_to_id);
    if (user) return { kind: 'task', user };
    // Fall through — assignee is no longer a member.
  }

  // Case 3: fall back to area default when member-valid.
  if (area.default_assignee_id) {
    const user = byId.get(area.default_assignee_id);
    if (user) return { kind: 'area', user };
    // Fall through — area default is no longer a member.
  }

  // Case 4: Anyone.
  return { kind: 'anyone' };
}
```

**Test matrix (D-18):** 6 cases — (task:none, area:none), (task:none, area:A), (task:A, area:none), (task:A, area:B) → task wins, (task:removed-user, area:A) → area falls through, (task:removed-user, area:removed-user) → anyone.

### Pattern 11: HomeSwitcher source-data migration (layout.tsx edit)

**Where:** `app/(app)/layout.tsx` — the `homesRaw` query.

**Current (Phase 2 — lines 66-74):**
```typescript
const homesRaw = await pb.collection('homes').getFullList({
  filter: `owner_id = "${userId}"`,
  sort: 'name',
  fields: 'id,name',
});
```

**Phase 4 replacement:** query home_members for the user, expand the home:

```typescript
// SAFE filter — userId is authStore-derived, not client input.
// expand pulls home.owner_id so we can label "Owner" badges.
const membershipRows = await pb.collection('home_members').getFullList({
  filter: `user_id = "${userId}"`,
  sort: 'home_id.name',  // sort by expanded home name
  fields: 'id,role,home_id,expand.home_id.id,expand.home_id.name,expand.home_id.owner_id',
  expand: 'home_id',
});

type HomeEntry = { id: string; name: string; role: 'owner' | 'member' };
const homes: HomeEntry[] = membershipRows
  .map((r) => {
    const home = (r.expand as Record<string, { id?: string; name?: string }> | undefined)?.home_id;
    if (!home?.id) return null;
    return {
      id: home.id,
      name: (home.name as string) ?? '',
      role: r.role as 'owner' | 'member',
    };
  })
  .filter((h): h is HomeEntry => h !== null);
```

**HomeSwitcher component:** accepts the enriched `HomeEntry[]` and renders a `<Badge>Owner</Badge>` next to homes where `role === 'owner'`. No rewrite needed — just thread the prop shape change.

**Sort order:** PB supports sort via expanded field since 0.22 (same family as filter support). `sort: 'home_id.name'` sorts by the expanded home's name. [CITED: pocketbase.io/docs/working-with-relations/ — expand documentation.]

### Pattern 12: PB admin client factory (new `lib/pocketbase-admin.ts`)

```typescript
// lib/pocketbase-admin.ts
import PocketBase from 'pocketbase';

/**
 * PB client authenticated as a superuser, used by server actions that
 * need to bypass listRule/viewRule — specifically `acceptInvite`, where
 * the invitee cannot read invites (rule is owner-only) but we need to
 * validate the token server-side.
 *
 * NEVER expose this client through a client component. NEVER pass its
 * auth token through to the browser. It is server-action-only.
 *
 * Requires PB_ADMIN_EMAIL + PB_ADMIN_PASSWORD env vars (Phase 1
 * .env.example already documents superuser bootstrap).
 *
 * The factory authenticates per-call (not cached) to keep the security
 * posture simple — PB's rate limiter treats superuser auth calls the
 * same as guest auth per bootstrap_ratelimits.pb.js's *:authWithPassword
 * label. For invite volume in a household app, this is cheap.
 */
export async function createAdminClient(): Promise<PocketBase> {
  const email = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not configured');
  }
  const pb = new PocketBase('http://127.0.0.1:8090');
  await pb.collection('_superusers').authWithPassword(email, password);
  return pb;
}
```

### Pattern 13: removeMember + leaveHome server actions (paste-ready)

```typescript
// lib/actions/members.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertOwnership, assertMembership } from '@/lib/membership';

export type RemoveMemberResult = { ok: true } | { ok: false; formError: string };

export async function removeMember(
  homeId: string,
  memberUserId: string,
): Promise<RemoveMemberResult> {
  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }
  const authId = pb.authStore.record.id;
  if (authId === memberUserId) {
    return { ok: false, formError: 'Use Leave Home instead of Remove' };
  }
  try {
    await assertOwnership(pb, homeId);
  } catch {
    return { ok: false, formError: 'Only the home owner can remove members' };
  }

  // Safety: never let an owner remove themselves via this path. The
  // owner-member row has role=owner; only deleteHome is the owner's exit.
  try {
    const row = await pb.collection('home_members').getFirstListItem(
      pb.filter('home_id = {:h} && user_id = {:u}', { h: homeId, u: memberUserId }),
    );
    if (row.role === 'owner') {
      return { ok: false, formError: 'Cannot remove the home owner' };
    }
    await pb.collection('home_members').delete(row.id);
  } catch {
    return { ok: false, formError: 'Could not remove member' };
  }

  // PB relation cascade handles tasks.assigned_to_id nullification
  // (cascadeDelete:false + optional → auto-null on user delete).
  // But the user itself is NOT deleted — just their membership row.
  // Outstanding question: do task assignments point at user records
  // of removed members? They'd still evaluate via resolveAssignee,
  // but resolveAssignee's member-lookup falls through to 'area' or
  // 'anyone' because the user is no longer in `members[]`. No DB
  // mutation needed — the UI updates organically on next read.

  revalidatePath(`/h/${homeId}`, 'layout');
  revalidatePath(`/h/${homeId}/members`);
  return { ok: true };
}

export type LeaveHomeResult = { ok: true; redirectTo: string } | { ok: false; formError: string };

export async function leaveHome(homeId: string): Promise<LeaveHomeResult> {
  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }
  const authId = pb.authStore.record.id;

  let role: 'owner' | 'member';
  try {
    const m = await assertMembership(pb, homeId);
    role = m.role;
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }
  if (role === 'owner') {
    return {
      ok: false,
      formError: 'Home owners must delete the home or transfer ownership before leaving',
    };
  }

  try {
    const row = await pb.collection('home_members').getFirstListItem(
      pb.filter('home_id = {:h} && user_id = {:u}', { h: homeId, u: authId }),
    );
    await pb.collection('home_members').delete(row.id);
  } catch {
    return { ok: false, formError: 'Could not leave home' };
  }

  // Clear last_viewed_home_id if it was pointing here.
  try {
    const me = await pb.collection('users').getOne(authId);
    if (me.last_viewed_home_id === homeId) {
      await pb.collection('users').update(authId, { last_viewed_home_id: null });
    }
  } catch { /* non-fatal */ }

  revalidatePath('/h', 'layout');
  return { ok: true, redirectTo: '/h' };
}
```

### Anti-Patterns to Avoid

- **Do NOT let the client pass `owner_id` or `role` in formData.** Owner semantics are derived server-side (from `home.owner_id` read via assertOwnership). Role in home_members is always `'member'` for invite-accept, always `'owner'` for hook-backfill, never client-controlled.
- **Do NOT use `=` (all-match) where `?=` (any-match) is needed.** `@request.auth.home_members_via_user_id.home_id = id` only matches when the user has exactly one home_members row AND it matches. `?=` is the correct operator.
- **Do NOT read invites via the public PB API from the invite-accept route.** listRule is owner-only. Use the admin client. If the operator refuses to configure admin creds, the fallback is to put invite-token lookups into a route handler that runs under PB impersonate — but that adds complexity without real security benefit.
- **Do NOT create two separate hooks for home creation (Whole Home + owner membership).** Each hook's `e.next()` is a contract; chaining hooks on the same event makes the e.next() sequence implicit and fragile. Extend the existing hook.
- **Do NOT use `encodeURIComponent(token)` in the invite URL.** base64url characters (A-Z a-z 0-9 _ -) are URL-safe by definition; extra encoding corrupts the `?` state of `/invite/{token}?next=...` patterns.
- **Do NOT bypass the unique index on `home_members (home_id, user_id)`.** The index is a last-line defence against double-accept races. If the insert fails with a unique-constraint error, treat as "already a member" and return success — don't surface the DB error.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Invite token generation | Custom PRNG, Math.random-based IDs, timestamp+rand hybrids | `crypto.randomBytes(24).toString('base64url')` | Math.random is NOT cryptographically secure — SpiderMonkey & V8 PRNGs are predictable given enough outputs. CSPRNG-backed token with UNIQUE index is the standard Web-API pattern. |
| Atomic "create membership + mark invite accepted" | Sequential `pb.collection().create()` + `pb.collection().update()` with try/finally | `pb.createBatch()` | PB batch is a single read+write transaction [CITED: pocketbase batch docs]. Sequential leaves a ~10-50ms window where a second accept attempt can succeed — the unique index backstop catches it, but returning a clean error is worth the atomic wrapper. |
| Avatar stack layering + overflow ("+3 more") | CSS grid, manual positioning, z-index juggling | Minimal `<AvatarCircle>` primitive + flex row with negative margins (e.g., `-ml-2`); "+N" pill when >3 | Shadcn's Avatar is available but adds `@radix-ui/react-avatar` subcomponent. Household max scale is ~4 members; a 20-line inline primitive covers it. If the design later needs image-fallback + grouping, swap to shadcn without breaking consumers. |
| Clipboard copy UI | Manual execCommand('copy') + document.createElement('textarea') fallback | `navigator.clipboard.writeText()` + sonner toast | Modern browsers (2020+) support the async clipboard API in secure contexts. In HTTP-only LAN mode (SPEC §5), clipboard WILL fail — RESEARCH §INFR-07 is deferred to Phase 7. In Phase 4, surface "Copy failed — select the URL manually" fallback rather than building an execCommand polyfill. |
| Race-free "accept this invite" without a unique index | Check-then-insert with optimistic locking | `CREATE UNIQUE INDEX ... ON home_members (home_id, user_id)` + `UNIQUE INDEX ... ON invites (token)` | SQL unique indexes are atomic at the storage layer. Two parallel accepts both pass the `.getFirstListItem` check; the second's INSERT fails at the DB with ErrConstraintUnique, which the server action translates to "already-accepted". No locking framework needed. |
| Re-implementing a members list Dialog + confirm-remove | Custom modal state + Escape handler + backdrop click | shadcn `Dialog` (installed at 02-04) | Dialog already ships with focus-trap + Escape + backdrop click + ARIA. Existing consumers: task-detail-sheet (03-03), area-form dialog (02-04). |
| Re-implementing signup-with-next flow | Custom redirect gymnastics after signup | existing 02-03 `proxy.ts` + `?next=` parameter + `safeNext()` helper | The 02-03 STATE.md decision records `safeNext()` as same-origin/-prefix enforced. /signup?next=/invite/T passes through naturally — one extra line in `lib/actions/auth.ts` signup action to consume `next` from the form data. |

**Key insight:** in Phase 4, nearly every "new" capability is a composition of Phase 1-3 primitives. The one truly new cryptographic requirement (invite token) is a one-liner on top of Node's built-in CSPRNG. The auth invariant (membership check) is a one-row DB query against a well-indexed table. No wheel-reinventing required.

## Runtime State Inventory

**Category breakdown:**

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **PB `homes` records from Phase 2 + 2.1 deploys** — these have `owner_id` set but no `home_members` row. After 1714953600 migrates, backfill loop iterates existing homes and inserts owner-membership rows. Also: `tasks.assigned_to_id` fields set in Phase 2 point at the owner — these remain valid because the owner is now a member. | **Data migration in 1714953600**: backfill loop (included in Pattern 3). Verified via integration test that reads existing home rows post-migration and confirms each has a matching home_members row. |
| Live service config | None. PB superuser creds (PB_ADMIN_*) may need provisioning if not already in .env — see User Setup. | Document required env vars in .env.example update. |
| OS-registered state | None. HomeKeep has no Task Scheduler / launchd / systemd integrations in Phase 1-3. | None. |
| Secrets/env vars | `PB_ADMIN_EMAIL` + `PB_ADMIN_PASSWORD` — required for `acceptInvite` admin-client path. Not present in Phase 1 `.env.example`. Also: `SITE_URL` is referenced by `createInvite` for URL construction; check if already in .env.example. | **Extend `.env.example`** with PB_ADMIN_* block; **verify SITE_URL** is documented (if not, add). No existing `.env` values to migrate since keys are new. |
| Build artifacts / installed packages | None — no new npm installs. `pocketbase` SDK 0.26.8 already supports `createBatch()` and the rules semantics Phase 4 uses. | None. |

**Rename canonical question:** After every file is updated, what runtime systems still have the old "owner-only" state cached? Answer: PB's **API rules are stored in the collections table**, not in code. The 1714953602 rule-update migration mutates those rows. After `pb serve` restart (or a hot reload — PB polls its migrations directory), the new rules are live. No other cache layer holds stale rules.

## Common Pitfalls

### Pitfall 1: Forgetting to backfill existing homes before rule-update migration

**What goes wrong:** Migration 1714953602 swaps rules to "any member". If 1714953600 ran without the backfill loop, owners of existing Phase 2 homes suddenly can't read their own homes because they have no home_members row.

**Why it happens:** The three migrations are independent files; order matters. The migration runner processes them in filename order (timestamp prefix), but a developer running `pb serve --dev` can get them out of order during local testing if they edit file timestamps.

**How to avoid:**
- 1714953600 MUST include the backfill loop (Pattern 3 above).
- 1714953602 MUST come AFTER 1714953600 (timestamp ordering enforces).
- Integration test: boot disposable PB, apply Phase 2 migration → create a home (owner = Alice) → apply Phase 4 migrations → assert Alice can still read the home.

**Warning signs:** First request after migration deploy returns `@request.auth.home_members_via_user_id` filters → empty set → user sees zero homes.

### Pitfall 2: `?=` vs `=` confusion in rule filters

**What goes wrong:** `@request.auth.home_members_via_user_id.home_id = id` silently always returns empty (for users in 2+ homes) because "all elements of the home_members set must equal this id", which is impossible for multi-home users.

**Why it happens:** PB's documentation uses `=` throughout for back-relations because most examples are one-to-one. The `_via_` back-relation returns a set; set-equality requires any-match operators.

**How to avoid:** use `?=` throughout. `?!=`, `?~`, `?!~` also exist for the negative variants. [CITED: pocketbase.io/docs/api-rules-and-filters/]

**Warning signs:** "I can see the home I own but not the home I was invited to" — classic symptom of the second home's rule evaluating against a 2-element membership set with plain `=`.

### Pitfall 3: PB admin-client authentication rate-limiting

**What goes wrong:** `acceptInvite` calls `createAdminClient()` on every request. Bootstrap-ratelimits.pb.js sets 20/60s on `*:authWithPassword`. 21st invite-accept in a minute hits 429.

**Why it happens:** The admin-client factory authenticates per-call (Pattern 12 commentary).

**How to avoid:**
- Cache the admin PB client in a module-level variable with a TTL < the 1-hour token lifetime (PB default). First call authenticates; subsequent calls reuse.
- OR: increase the `*:authWithPassword` rate limit to exclude admin-client — but that weakens the brute-force mitigation from T-02-01-03.
- OR: split the rate limiter to `users:authWithPassword` (user login, still 20/60s) vs `_superusers:authWithPassword` (admin, higher limit). This requires updating `bootstrap_ratelimits.pb.js`.

**Recommended:** cache in Pattern 12 with a 30-min TTL. If token expires, refresh on next call.

**Warning signs:** Playwright E2E spams invite-accepts → 3rd or 4th consecutive 429. Local dev probably passes since 20/60s is generous for a single tester.

### Pitfall 4: Race condition on concurrent invite acceptance

**What goes wrong:** Two tabs open `/invite/TOKEN` simultaneously. Both pass the `accepted_at === null` check. Both reach `batch.send()`. One succeeds, the second hits the UNIQUE INDEX constraint on `home_members (home_id, user_id)` — PB returns 400.

**Why it happens:** The check-then-insert path has a ~10ms window between read and write.

**How to avoid:**
- The UNIQUE INDEX is the real backstop. The acceptInvite action wraps `batch.send()` in try/catch; on failure, it re-reads the invite to see if `accepted_at` is now set — if yes (and by the current user), return ok with the homeId; otherwise return `{ok:false, reason:'error'}`.
- `pb.createBatch()` is single-transaction; its failure IS atomic — no partial success.

**Warning signs:** A user reports "I clicked accept twice, now I see an error but I'm in the home" — self-correcting, but surface a gentler error.

### Pitfall 5: Signup-via-invite loses the next= parameter

**What goes wrong:** User visits /invite/TOKEN while unauthed → redirect to /signup?next=/invite/TOKEN → signup succeeds → redirect to / (default post-signup) → user has joined the home BUT they didn't, because nobody called `acceptInvite`.

**Why it happens:** The 02-03 `signupAction` uses `safeNext()` for post-signup redirect, but if the form-submit omits the `next` input, it defaults to `/`.

**How to avoid:**
- `/signup` page reads `searchParams.next` server-side and renders a `<input type="hidden" name="next" value={next}>` in the form.
- `signupAction` consumes `formData.get('next')` and passes through `safeNext()`.
- 02-03's safeNext already forbids `//` and `:` to prevent open-redirects, and the `/invite/{token}` path is same-origin same-prefix safe.

**Warning signs:** Playwright E2E test for D-20 E2E scenario steps through: log-out → visit /invite/TOKEN → redirected to /signup?next=/invite/TOKEN → signup → check URL is /invite/TOKEN → check acceptInvite fires → check redirect to /h/[homeId]. If any step silently drops `next`, the test fails at the final URL assertion.

### Pitfall 6: Task assignment stays valid after member removal — BUT

**What goes wrong:** Owner Alice creates task T assigned to Bob. Alice removes Bob. The `home_members` row is deleted, but `tasks.assigned_to_id` still points at Bob's USER record (Bob isn't deleted — just his membership). `resolveAssignee` returns 'task' with user=Bob, because Bob still exists in the users table. BUT Bob can no longer read the task (not a member). UI shows "assigned to Bob" to Alice, who then thinks Bob will do it.

**Why it happens:** `cascadeDelete` on `home_members.user_id` deletes the membership row only. It does not reach into `tasks.assigned_to_id` — that cascade is from `users` deletion, not membership deletion.

**How to avoid:**
- `resolveAssignee` (Pattern 10) takes `members: Member[]` — the current home's members only. Bob is NOT in that array, so the member-lookup fails; cascade falls through to area default or 'anyone'. Case 2 in the docstring.
- Surface: UI correctly shows cascaded assignee (area default or Anyone), not the stale Bob reference.
- Belt-and-braces: `removeMember` could nullify `tasks.assigned_to_id = Bob.id AND task.home_id = homeId` in a follow-up write. Optional — not required for correctness because the resolver handles it.

**Warning signs:** TaskRow shows "assigned to removed-user" — symptom of resolveAssignee being called without the filtered members array (or called from a stale server render).

### Pitfall 7: `_via_` back-relation in rules requires an index on the FK

**What goes wrong:** `@request.auth.home_members_via_user_id.home_id ?= home_id` compiles to a subquery that joins home_members on user_id. Without an index on `home_members.user_id`, the query is O(N) per request per authenticated user.

**Why it happens:** PocketBase auto-creates single-column indexes on relation fields since 0.22 [ASSUMED — to verify in integration test by `EXPLAIN QUERY PLAN` on the generated SQL]. The unique composite index `(home_id, user_id)` also helps but the query planner may pick single-column lookup by `user_id` first.

**How to avoid:** Pattern 3 explicitly adds `CREATE INDEX idx_home_members_user ON home_members (user_id)` as a belt-and-braces accelerant. SQLite's query planner will use either index as appropriate.

**Warning signs:** E2E suite slows down as home/task count grows past ~100; Playwright timeouts on the three-band view. For v1 households (<50 tasks, <5 members), unlikely to manifest.

### Pitfall 8: Forgetting to revoke PB data caches on deploy

**What goes wrong:** Phase 4 deploy lands on the VPS — `docker compose up -d --pull always`. The `./data/pb_data/data.db` is preserved (bind-mounted per 2.1). Migrations run on boot. But Next.js's ISR cache might still serve the pre-migration `/h/[id]` payload for a brief window.

**Why it happens:** Next 16 app-router SSR doesn't cache Server-Component outputs by default, but the 02-04 architecture uses `revalidatePath` on mutations — post-migration there are no mutations yet to trigger a cache flush.

**How to avoid:**
- Phase 4 deploy process: `docker compose restart` (not just `up`) — a clean SIGTERM + boot re-runs migrations and re-initializes Next's in-memory state.
- Alternative: post-deploy, touch a marker file that triggers `revalidatePath('/h', 'layout')` — overkill for Phase 4.

**Warning signs:** Owner sees correct member list; member sees "this home doesn't exist" for the first page-load after deploy, then correct view on refresh.

### Pitfall 9: Invite URL built with trailing slash in SITE_URL

**What goes wrong:** `SITE_URL=http://46.62.151.57:80/` → invite URL is `http://46.62.151.57:80//invite/TOKEN` (double slash). Most browsers normalize, but some proxies don't.

**Why it happens:** Copy-paste into .env with a trailing slash is a classic gotcha.

**How to avoid:** `createInvite` uses `process.env.SITE_URL?.replace(/\/+$/, '') ?? ''` (Pattern 7). Also: document the no-trailing-slash convention in .env.example comment.

**Warning signs:** Invited user clicks link → "page not found" on the proxy but works when they re-paste without the double slash.

## Code Examples

### Verified — PB Record creation in JSVM hook (from 02-01)

```javascript
// Source: existing pocketbase/pb_hooks/homes_whole_home.pb.js
const members = e.app.findCollectionByNameOrId("home_members");
const row = new Record(members, {
  home_id: e.record.id,
  user_id: e.record.get("owner_id"),
  role: "owner",
});
e.app.save(row);
```

### Verified — pb.createBatch atomic multi-collection write

```typescript
// Source: pocketbase js-sdk docs (verified pattern)
const batch = pb.createBatch();
batch.collection('home_members').create({ home_id, user_id, role: 'member' });
batch.collection('invites').update(inviteId, {
  accepted_at: new Date().toISOString(),
  accepted_by_id: userId,
});
await batch.send();  // atomic: either both succeed or both roll back
```

[CITED: https://github.com/pocketbase/pocketbase/discussions/6040]

### Verified — pb.filter() safe parameter binding (existing 03-01 pattern)

```typescript
// Source: PB docs + lib/completions.ts 03-01 pattern
const filter = pb.filter('home_id = {:h} && user_id = {:u}', {
  h: homeId,
  u: userId,
});
const row = await pb.collection('home_members').getFirstListItem(filter);
```

### Verified — Node `crypto.randomBytes` → base64url

```typescript
// Source: nodejs.org/api/crypto.html (built-in, no external deps)
import { randomBytes } from 'node:crypto';
const token = randomBytes(24).toString('base64url');
// → e.g., 'aB3-cD4_eF5gH6iJ7kL8mN9oP0qR1sT_' (32 chars, URL-safe)
```

### Verified — PB Record.get() for relation lookups in hooks

```javascript
// Source: PB JSVM docs — e.record.get(fieldName) returns the stored value,
// including relation field IDs as strings.
const ownerId = e.record.get("owner_id");  // returns the users record id
```

### Verified — sort by expanded relation (PB 0.22+)

```typescript
// Source: pocketbase.io/docs/working-with-relations/
const homes = await pb.collection('home_members').getFullList({
  filter: `user_id = "${userId}"`,
  expand: 'home_id',
  sort: 'home_id.name',  // sorts by the expanded home's name
  fields: 'id,role,home_id,expand.home_id.id,expand.home_id.name',
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Two-level nested relation rule `home_id.owner_id.something` | Back-relation `X_via_Y` syntax for set-returning joins | PB 0.22 (Feb 2024) | Cleaner, faster, and directly supported in rule expressions. [CITED: pocketbase discussion #4417] |
| Math.random / crypto-js for invite tokens | `crypto.randomBytes().toString('base64url')` (Node built-in) | Node 16 (2021) added `base64url` encoding | No external deps, CSPRNG-grade, URL-safe by construction. [CITED: nodejs.org/api/crypto.html] |
| Check-then-insert for unique constraints | `createBatch()` + UNIQUE INDEX backstop | PB 0.22+ (batch) | Single-tx atomicity inside the batch; DB-level uniqueness as last-line defence. [CITED: pocketbase batch docs] |
| Custom email-invite flow (SMTP) | Link-only invites (copy+share) | HomeKeep Decision Log — SPEC §16 | No SMTP dependency for v1; user shares link out-of-band. SMTP-invite deferred to post-v1. |

**Deprecated/outdated:**
- `pb.admins.authWithPassword()` in PB < 0.23 → replaced with `pb.collection('_superusers').authWithPassword()` in 0.23+. [CITED: PB 0.23 migration guide] Pattern 12 uses the new form.
- PB pre-0.22 `@collection` was the only way to cross-join — still supported and listed as fallback in Pattern 1, but `_via_` is the idiomatic current approach.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@request.auth.home_members_via_user_id.home_id ?= id` evaluates correctly in PB 0.37 rule filters | Pattern 1, Pattern 2 | MEDIUM — fallback `@collection.home_members.*` pattern (also in Pattern 1) is known-working from PB discussions. Phase 4 integration test must cover this case. If `_via_` fails, swap the rule-update migration to the `@collection` form and re-run. |
| A2 | PB `cascadeDelete: false` + `minSelect: 0` on an optional relation auto-nullifies the referring field when the target is deleted (established in 02-01 for `tasks.assigned_to_id`) | Architectural Responsibility Map, Pitfall 6 | LOW — documented in PB relation behavior search [CITED]; 02-01 SUMMARY assumption A7 was marked "partially confirmed via schema creation"; exercising in this phase WILL fully verify when a member is removed. |
| A3 | Two `onRecordCreateExecute` hooks on `"homes"` in the same JSVM context chain cleanly (if we choose to split owner-membership into a separate file) | Pattern 5 anti-pattern note | LOW — we avoid this by consolidating into one hook. No risk if recommendation followed. |
| A4 | `pb.createBatch()` in JS SDK 0.26.8 correctly rolls back all operations on any single failure (true atomicity, not just "sent together") | Pattern 8 | MEDIUM — web-search finding noted "not guaranteed to be fully atomic" in some sources. The unique-index backstop means even non-atomic batch doesn't produce corruption; only the error surface changes. Integration test: create batch that deliberately fails the second op, confirm first op is rolled back. |
| A5 | PB admin authentication per-request cost is acceptable for invite-accept traffic (no need for connection pool or token cache) | Pitfall 3 | LOW — household invite volume is measured in single-digits per home per year. Even 10/day < 20/60s cap. Caching recommended but not critical for Phase 4. |
| A6 | `process.env.SITE_URL` is already populated in the Phase 2.1 deploy environment | Pattern 7 | LOW-MEDIUM — to verify. If not, it's a one-line .env.example addition. |
| A7 | Sorting by an expanded relation field (`sort: 'home_id.name'`) works in PB 0.37 JS SDK | Pattern 11 | LOW — supported since PB 0.22 per docs [CITED: pocketbase.io working-with-relations]. 02-04 already uses nested field reads via `fields: 'expand.area_id.name'`; sort should use the same path resolution. |
| A8 | PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD env vars will be provisioned by the operator before Phase 4 deploy | Pattern 12, User Setup Required | LOW — Phase 1 INFR-10 requires env-driven config; .env.example extension will document. No secret commits. |

**If this table shows up in discuss-phase:** A1 and A4 are the two warrant user confirmation. If the user wants to trade a less-idiomatic filter syntax for higher confidence, switch to the `@collection.home_members.*` form. If atomicity guarantees of createBatch are a concern, the check-after-fail logic in Pattern 8 is the mitigation.

## Open Questions

1. **Should invited users see the home's name on the /invite/[token] page before accepting?**
   - What we know: D-05 specifies redirect to /login/signup + then acceptInvite; it doesn't require showing the home name first.
   - What's unclear: UX benefit of "You're joining the Smith Residence" before clicking Accept vs. direct-redirect-on-authed.
   - Recommendation: Phase 4 implements direct-redirect per D-05. If UX feedback requests a preview card, trivial to add in a follow-up (read invite + home name via admin client, render before redirect).

2. **What happens to `users.last_viewed_home_id` when the user is removed from a home that was their last-viewed?**
   - What we know: `users.last_viewed_home_id` has `cascadeDelete: false` (02-01 decision — "if home deleted, field nullifies automatically"). That IS nullification.
   - What's unclear: if member Bob is removed but the home still exists, `last_viewed_home_id` still points at it. On next login, `(app)/layout.tsx` redirects Bob to /h/{home} → he gets a 404 (not a member).
   - Recommendation: `removeMember` + `leaveHome` actions MUST clear `last_viewed_home_id` if it matches the departed home. Pattern 13 already does this for `leaveHome`; extend `removeMember` to do the same for the target user. Implemented as a post-delete step, non-fatal.

3. **Should invite creation be rate-limited per home?**
   - What we know: PB has a global rate limiter (Phase 1). No per-home limit.
   - What's unclear: Could a compromised owner session generate 1000 invites? Yes, but only 1000 rows — no external side-effect (no email sent).
   - Recommendation: not in scope for Phase 4. Document as a deferred hardening item for Phase 7. A UI limit of "max 5 pending invites per home" at the action layer would be 3 lines — acceptable addition if the plan permits.

4. **Do we need a UI affordance to revoke (delete) an unaccepted invite?**
   - What we know: D-07 doesn't specify. Owner can always delete invite rows (deleteRule owner-only per D-02).
   - Recommendation: Phase 4 settings page SHOULD show pending invites + a "Revoke" button per row. Small addition: server action `revokeInvite(inviteId)`, ~20 lines. Include in Phase 4 plan.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `crypto` module | Invite token generation | ✓ | Node 22 (runtime min) | — (built-in) |
| PocketBase 0.37.x | Rule filters, createBatch, back-relations | ✓ | 0.37.1 (from Phase 1) | — |
| pocketbase JS SDK | createBatch, filter helpers | ✓ | 0.26.8 (package.json) | — |
| PB admin creds (PB_ADMIN_EMAIL/PASSWORD) | acceptInvite's invite-read path | ✗ | — | Relax invites.viewRule to authed-users-only (NOT acceptable — leaks tokens). Must be provisioned. |
| SITE_URL env var | createInvite URL construction | ? | — | Fall back to empty string + relative URL (works in-browser from same host) |
| navigator.clipboard | InviteLinkCard copy button | ? (browser-dependent) | — | Show URL as plain text user can select + copy manually. HTTP-only LAN mode (Phase 2.1 deployment) lacks secure context — clipboard API is unavailable. Flag for Phase 7 INFR-07. |

**Missing dependencies with no fallback:**
- `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`. Operator must provision before Phase 4 deploy.

**Missing dependencies with fallback:**
- Clipboard API in HTTP LAN mode: degrade gracefully (select-to-copy). Phase 4 plan should include the fallback render path.
- SITE_URL: default to empty → relative URL still works, but absolute is preferable for email sharing (out-of-band).

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`. Section is REQUIRED.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 + jsdom 29.0.2 (unit) + Playwright 1.59.1 (E2E) |
| Config file | `vitest.config.ts` (present since 01-01); `playwright.config.ts` (since 02-03) |
| Quick run command | `npm test` (Vitest) |
| Full suite command | `npm test && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOME-05 | Owner can create shareable invite link | unit + E2E | `vitest run tests/unit/actions/invites.test.ts` + Playwright flow | ❌ Wave 0 |
| HOME-06 | Invitee can accept invite, becomes member | integration (disposable PB) + E2E | `vitest run tests/unit/hooks-home-members.test.ts` + Playwright multi-user | ❌ Wave 0 |
| HOME-07 | Owner can view + remove members | unit + E2E | `vitest run tests/unit/actions/members.test.ts` + Playwright | ❌ Wave 0 |
| TASK-02 | Task can be assigned to specific member | unit (schema) + integration (update) | `vitest run tests/unit/schemas/task.test.ts` (extend) | partial (02-05 task schema test exists) |
| TASK-03 | Cascading assignment resolves via pure fn | unit (matrix) | `vitest run tests/unit/assignment.test.ts` | ❌ Wave 0 |
| TASK-04 | UI shows effective assignee w/ kind indicator | E2E (visual-like assertion via data-attrs) | Playwright + `data-assignee-kind` attribute check | ❌ Wave 0 |
| D-03 | Owner gets home_members row on home create (atomic) | integration (disposable PB) | `vitest run tests/unit/hooks-home-members.test.ts` | ❌ Wave 0 |
| D-11 | Non-member cannot read tasks of foreign home (403) | integration (disposable PB) | `vitest run tests/unit/rules-member-isolation.test.ts` | ❌ Wave 0 |
| D-18 invite token | 32-char URL-safe CSPRNG generation | unit | `vitest run tests/unit/invite-tokens.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- {changed-file-pattern}` (Vitest `--run` + filter)
- **Per wave merge:** `npm test` + `npm run test:e2e -- --project=chromium`
- **Phase gate:** full suite green before `/gsd-verify-work` — `npm test && npm run test:e2e`

### Wave 0 Gaps

- [ ] `tests/unit/assignment.test.ts` — resolveAssignee 6-case matrix (TASK-03)
- [ ] `tests/unit/invite-tokens.test.ts` — format + uniqueness + entropy (D-18)
- [ ] `tests/unit/schemas/invite.test.ts` — zod validation (createInviteSchema, acceptInviteSchema)
- [ ] `tests/unit/schemas/member.test.ts` — removeMemberSchema, leaveHomeSchema
- [ ] `tests/unit/hooks-home-members.test.ts` — disposable PB on port 18092 (02-01/03-01 used 18090/18091 — follow the port-per-test pattern): asserts owner-member row created atomically with home (D-03), backfill loop adds rows for pre-existing homes, rule-update migration surfaces non-members as 403 (D-11)
- [ ] `tests/unit/rules-member-isolation.test.ts` — integration: Alice's task is 403 for Bob (non-member), 200 after Bob accepts invite
- [ ] `tests/unit/actions/invites.test.ts` — createInvite owner-gate, acceptInvite happy path, acceptInvite already-accepted, acceptInvite expired
- [ ] `tests/unit/actions/members.test.ts` — removeMember owner-gate, removeMember prevents self, leaveHome owner-blocked, leaveHome clears last_viewed_home_id
- [ ] `tests/e2e/collaboration.spec.ts` — Playwright D-20 multi-user flow (create invite → second user signs up via /invite/TOKEN → both see each other in members list)
- [ ] `tests/e2e/task-assignment.spec.ts` — Playwright TASK-02/04 flow (owner assigns task to member, member sees "assigned to Me", owner removes member, task shows "Anyone")

*Framework install: none — Vitest + Playwright already present.*

## Security Domain

`security_enforcement` is the default (enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | PocketBase auth (02-01, 02-03); acceptInvite requires authed user (no anonymous joins) |
| V3 Session Management | yes | HttpOnly pb_auth cookie (02-03); invite-accept re-validates session before membership creation |
| V4 Access Control | **yes — primary focus** | PB rules (Pattern 1-2) + server-action assertMembership/assertOwnership (Pattern 9); owner-only for invites/members/settings, member-for-any for areas/tasks/completions |
| V5 Input Validation | yes | zod schemas for createInvite (homeId), acceptInvite (token pattern), removeMember (ids); PB `token` field pattern ^[A-Za-z0-9_-]+$ at schema level |
| V6 Cryptography | yes | `crypto.randomBytes` (Node CSPRNG) for invite tokens — never hand-rolled, never Math.random |
| V7 Error Handling | yes | Server actions return generic `formError: 'Could not …'` (no PB internals leaked); invite-accept distinguishes reasons only for UX (expired/already-accepted shown to user — not secrets) |
| V13 API | yes | No public unauthenticated API surface in Phase 4; invite-accept route is same-origin Server Action |

### Known Threat Patterns for Phase 4

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Brute-force invite token guessing | Tampering / EoP | 192-bit entropy (randomBytes 24 bytes); PB rate limiter `/api/` 300/60s guest; UNIQUE index on `token` |
| Replay of accepted invite | Repudiation | `accepted_at` sentinel; Pattern 8 action returns `already-accepted` for non-self replays |
| Two-tab double-accept race | Tampering | `createBatch` atomicity + UNIQUE INDEX on `home_members (home_id, user_id)` — second accept fails cleanly |
| Owner-session compromise creates 1000 invites | DoS (quota) | Accepted risk in Phase 4; deferred Phase 7. Max-pending-invites-per-home UI limit is a 3-line addition if plan permits. |
| Non-member reads foreign home/tasks (EoP) | EoP | PB rule filter `?=` on back-relation — integration test REQUIRED (D-19) |
| Removed member retains API access via stale session | Spoofing | PB rules are evaluated per-request — membership revocation takes effect on the very next call. No grace period. |
| Leaked token via referrer header | Info Disclosure | `/invite/[token]` page sets `Referrer-Policy: no-referrer` in a route-group `layout.tsx` (or via Next config `headers()`) |
| Stolen clipboard contents (shared-device attack) | Info Disclosure | Acceptable risk for v1 — operator can revoke invite via `/settings` page |
| `encodeURIComponent`-induced URL corruption | Tampering | Tokens are base64url (URL-safe by spec); NEVER wrap with encodeURIComponent |
| `@request.body.X = @request.auth.id` body-check bypass | Tampering | Pattern 2 preserves completions createRule body-check from 03-01; no other body-checks needed for Phase 4 collections because server actions control every field (role, accepted_by_id). |
| Invite URL prefix open-redirect via `?next=` | EoP | Phase 2.1 deployed `safeNext()` — same-origin, forbids `//`, `:`. Confirm it handles `/invite/TOKEN` correctly (it does — single leading slash, same-origin path). |
| Superuser credential leak via admin client | EoP | PB_ADMIN_* read from `process.env` only; never logged; admin-client never passed to the browser. |

**Threat-model carry-ins from prior phases:**
- T-02-04-01 (filter string injection) — Pattern 9 uses `pb.filter()` with bound params; no template-literal filter concatenation in this phase's code.
- T-03-01-02 (body spoofing on completion) — Pattern 2 preserves the `@request.body.completed_by_id = @request.auth.id` createRule.
- T-02-05-08 (archived state from client) — unchanged from 02-05; assigned_to_id is now accepted from client but `archived` remains server-controlled.

## Sources

### Primary (HIGH confidence)

- **PocketBase back-relation `_via_` syntax** — [Discussion #4417: Notes about the upcoming back relation support](https://github.com/pocketbase/pocketbase/discussions/4417) — `@request.auth.yourCollection_via_yourRelField.*` is the documented pattern
- **PocketBase API rules and filters** — [pocketbase.io/docs/api-rules-and-filters/](https://pocketbase.io/docs/api-rules-and-filters/) — `?=` any-match operator; `@collection.*` cross-join pattern
- **PocketBase working with relations** — [pocketbase.io/docs/working-with-relations/](https://pocketbase.io/docs/working-with-relations/) — `_via_` syntax verified; expand + sort on nested fields
- **PocketBase relation field JSVM reference** — [pocketbase.io/jsvm/classes/RelationField.html](https://pocketbase.io/jsvm/classes/RelationField.html) — cascadeDelete, minSelect, maxSelect, required options (no unsetOnDeletedTarget; null-on-delete is implicit when cascadeDelete:false + not required)
- **Node `crypto.randomBytes`** — [nodejs.org/api/crypto.html](https://nodejs.org/api/crypto.html) — CSPRNG guarantees; `base64url` encoding support since Node 16
- **PB batch operations** — [Discussion #6040: Batch operations (nodeJS)](https://github.com/pocketbase/pocketbase/discussions/6040) — `pb.createBatch()` JavaScript API example
- **Existing 02-01 SUMMARY** — `.planning/phases/02-auth-core-data/02-01-SUMMARY.md` — PB migration + hook patterns, integration test port convention
- **Existing 03-01 SUMMARY** — `.planning/phases/03-core-loop/03-01-SUMMARY.md` — append-only rule pattern, disposable PB test on port 18091
- **Existing migration/hook/action files** — `pocketbase/pb_migrations/*.js`, `pocketbase/pb_hooks/homes_whole_home.pb.js`, `lib/actions/{areas,homes,tasks,completions}.ts` — verbatim reference for the patterns extended in Phase 4

### Secondary (MEDIUM confidence)

- **PB cascadeDelete behavior on optional relations** — [Discussion #1220 + #286](https://github.com/pocketbase/pocketbase/discussions/1220) — confirms auto-nullify for non-required relations; required relations block delete
- **PB deep filter performance** — 02-01 Pitfall 11 carry-over — indexes on join columns required for rule-filter performance
- **PB 0.22+ feature changelog** — back-relation support, batch API, nested sort all landed in 0.22; Phase 4 uses 0.37 which has all three

### Tertiary (LOW confidence — flagged in Assumptions Log)

- **pb.createBatch atomicity guarantees** — some web sources note "not guaranteed to be fully atomic"; official discussions describe single-tx semantics. Mitigation: UNIQUE INDEX backstop + integration test covering batch-abort.
- **Admin client rate-limit impact on invite-accept** — A3 in Assumptions Log; rate-limit cap is 20/60s on `*:authWithPassword`; caching recommended but not critical for v1 household volume.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps already installed and exercised in Phase 2/3
- Architecture (rule filters, hook extension, server actions): HIGH — patterns verified against official docs + 02-01/03-01 precedent
- Pitfalls: HIGH — pitfall 1, 2, 4, 6, 7 are directly derived from known PB semantics and existing hook-test outcomes; pitfall 3 (admin client rate-limit) is MEDIUM without concrete measurement; pitfall 5 (signup-next flow) is HIGH because 02-03's safeNext behavior is documented
- Migration safety: HIGH on backfill pattern; MEDIUM on rule-update rollback (down migration is written but untested at scale)

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 — PB 0.37.x is stable; PB 0.38 release (unknown date) could add/deprecate back-relation syntax. Re-validate if the PB binary is upgraded before Phase 4 deploy.

---

*Phase: 04-collaboration*
*Research date: 2026-04-21*
