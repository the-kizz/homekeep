# Phase 4: Collaboration - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Source:** Autonomous yolo-mode synthesis from SPEC.md §6, §7.2, §7.3, §8.

<domain>
## Phase Boundary
Single-user homes become multi-user. Phase 4 adds home_members + invites collections, invite-link signup flow, member management UI, and cascading task assignment resolution.

**Scope:**
- `home_members` collection (owner + member roles)
- `invites` collection (token, expires_at, accepted_at)
- Invite link generation (HOME-05)
- Invite acceptance flow (HOME-06)
- Member list + remove member UI (HOME-07)
- Task assignee field + area default_assignee_id (already exists from Phase 2 schema) (TASK-02)
- Cascading assignment resolver (TASK-03)
- Effective assignee display on task rows + bands (TASK-04)

**NOT in Phase 4:**
- Invite email sending (user shares link manually; SMTP-dependent mail path documented as future)
- Role permissions beyond owner/member (deferred)
- Task rotation (SPEC calls out as v1.1)
- Secondary views (Phase 5)
- Notifications (Phase 6)
</domain>

<decisions>
## Implementation Decisions

### Collections (PB migrations)

- **D-01:** Migration `1714953600_home_members.js` creates `home_members` collection: `home_id` (relation → homes, required, cascade), `user_id` (relation → users, required, cascade), `role` (select: `owner` | `member`, default `member`), `joined_at` (date, auto = created). Unique index on `(home_id, user_id)`. API: listRule/viewRule = "user is a member of this home"; createRule/updateRule = "user is owner of this home"; deleteRule = "user is owner OR user is the target (self-leave)".

- **D-02:** Migration `1714953601_invites.js` creates `invites` collection: `home_id` (relation → homes, required, cascade), `token` (text, required, unique, 32-char URL-safe random), `expires_at` (date, required, default now + 14 days), `accepted_at` (date, optional), `created_by_id` (relation → users, required), `accepted_by_id` (relation → users, optional). API: listRule/viewRule = owner-of-home only; createRule = owner-of-home; deleteRule = owner-of-home; **no updateRule is needed** — acceptance happens via a server action that runs as PB admin context (server-side only). Public invite-acceptance read happens through a dedicated server action, not direct PB API.

- **D-03:** **Backfill owner into home_members** on home creation. Extend the existing `pocketbase/pb_hooks/homes_whole_home.pb.js` hook (or add a new `homes_owner_member.pb.js`) — on `onRecordCreateExecute` for `homes`, also insert a `home_members` record `{home_id, user_id: owner_id, role: 'owner'}`. Atomic with the Whole Home creation (same transaction). Migration backfills any existing home records with their owner.

### Invite flow

- **D-04:** Owner clicks "Invite member" in home settings → server action `createInvite(homeId)` generates a 32-char URL-safe token, inserts invite record (expires_at = now + 14 days), returns invite URL `{SITE_URL}/invite/{token}`. The UI shows the URL + a "Copy link" button (shadcn Button + clipboard API) + "Expires in 14 days" tag.
- **D-05:** Public route `/invite/[token]` accepts the invite:
  - If not authenticated → redirect to `/login?next=/invite/[token]` (or `/signup?next=...`)
  - If authenticated → server action `acceptInvite(token)` validates (exists, not expired, not accepted), creates a `home_members` record for the current user with role=`member`, marks invite as accepted (sets `accepted_at` + `accepted_by_id`), redirects to `/h/[homeId]`.
  - Failure modes return friendly error pages: invalid token, expired, already accepted (by current user → redirect to /h/[homeId]; by someone else → "This invite was already used").
- **D-06:** Invite tokens are single-use. Once `accepted_at` is set, re-visiting the link shows "Already accepted" + link to /h/[homeId].

### Member management

- **D-07:** New page `/h/[homeId]/members` — owner-only. Lists all members with name + email + role + join date. Each row has a "Remove" button (except self). Confirm dialog on remove ("Remove {name} from {home.name}?"). Server action `removeMember(homeId, memberId)` deletes the `home_members` record; cascading effects documented below.
- **D-08:** **When a member is removed**, their task assignments in that home are set to NULL (cascade via PB relation on `tasks.assigned_to_id`). The task falls back to area default / "Anyone" per TASK-03. This is automatic because the `assigned_to_id` relation has `cascadeDelete=false` + `unsetOnDeletedTarget=true` (behavior matches PocketBase's default for optional relations).

### Cascading assignment

- **D-09:** **`lib/assignment.ts`** exports pure `resolveAssignee(task, area, homeMembers)` returning:
  ```ts
  type EffectiveAssignee =
    | { kind: 'task', user: User }        // task.assigned_to_id set
    | { kind: 'area', user: User }        // area.default_assignee_id set (fallback)
    | { kind: 'anyone' }                   // neither set (third fallback)
  ```
  Task-level assignee wins; if unset, area-default-assignee; if unset, "Anyone".
- **D-10:** **Display in TaskRow + TaskDetailSheet:** effective assignee shown as small avatar + name with subtle icon: inherited (wire-frame avatar) vs overridden (solid avatar). "Anyone" shown as a dashed-border neutral placeholder icon. Tooltip: "Assigned via {kind}" (task / area / default).

### API access pattern change

- **D-11:** **PB collection API rules updated Phase 4:** homes/areas/tasks/completions rules change from "owner-only" to "**any home member**". The ownership-based filters in Phase 2 migration are replaced or augmented with `home_id.@collection.home_members.user_id = @request.auth.id` patterns (or equivalent). This is the biggest mechanical change in Phase 4.
  - Supplemental migration: `1714953602_update_rules_multi_member.js` alters existing collections' rules to use the new membership-based filter.
- **D-12:** **Server-side ownership checks in actions** (`lib/actions/*`) updated: instead of "user.id === home.owner_id" preflight, use "user.id IN home_members WHERE home_id=X". Add helper `assertMembership(pb, homeId)` used by every mutation action.
- **D-13:** **Owner-only actions** remain owner-gated: createInvite, removeMember, deleteHome, updateHome (settings changes). Member-permitted: createArea, updateArea, createTask, updateTask, archiveTask, completeTask, reorderAreas. (Essentially, members can do "day-to-day work" but cannot change home structure/ownership.)

### UI surfaces

- **D-14:** HomeSwitcher (already from Phase 2) now lists homes the user is a member of (via home_members query) instead of homes they own.
- **D-15:** Account menu (top-right) gains a "Leave home" action in a secondary menu when viewing a home you don't own. Confirms with "Leave {home.name}? Your task assignments will fall back to the area default." Server action `leaveHome(homeId)` deletes self's home_members record (only if not owner).
- **D-16:** **New settings route `/h/[homeId]/settings`** (owner-only): shows home name, address, timezone (editable), plus Invite Member section + Members list link. Danger zone: Delete home.
- **D-17:** **Home dashboard displays who's in the home** via a small avatar stack in the header (next to HomeSwitcher). Click the stack → navigate to `/h/[homeId]/members`.

### Testing

- **D-18:** Unit:
  - `lib/assignment.ts` — resolveAssignee matrix (task set, area set, neither set, task set AND area set → task wins, archived task → still resolves but typically not shown)
  - Invite token generation (32 char, URL-safe, cryptographically random — use `crypto.randomUUID()` + base64url replacement, OR `crypto.getRandomValues` + hex)
- **D-19:** Integration:
  - PB hook: home creation inserts owner into home_members (same tx)
  - Migration rule update: non-member cannot read tasks of a home they're not in (403)
- **D-20:** E2E:
  - Owner creates invite → copies URL → logs out → opens URL in fresh session → signup/login → accept → lands in shared home → both users can see each other in `/h/[id]/members`
  - Cascade test: owner creates task assigned to member → member sees "assigned to Me" → owner removes member → task shows "Anyone"
  - Non-owner cannot access /settings or /members when role=member (redirected)
</decisions>

<canonical_refs>
- `SPEC.md` §7.2 (areas scope — unchanged)
- `SPEC.md` §7.3 (cascading assignment — THIS is phase 4)
- `SPEC.md` §7.5 (design decisions)
- `SPEC.md` §8.3 Person view (DEFERRED to Phase 5 — don't add in 4)
- `.planning/phases/02-auth-core-data/02-01-SUMMARY.md` (migration pattern, hooks)
- `.planning/phases/02-auth-core-data/02-04-SUMMARY.md` (server action + ownership preflight patterns)
- `.planning/phases/03-core-loop/03-01-SUMMARY.md` (completions lifecycle — unaffected)
- `lib/actions/tasks.ts` (mutation pattern to update for member-gated auth)
</canonical_refs>

<code_context>
Reusable:
- migration class pattern (02-01)
- pb hooks pattern (02-01)
- server action + zod schema pattern (02-03..05)
- shadcn Dialog + Sheet (02-04, 03-02)
- HomeSwitcher (02-04) — extend query to home_members
- TaskRow, TaskDetailSheet (03-02, 03-03) — extend display with effective assignee

New:
- lib/assignment.ts (pure)
- lib/actions/invites.ts, lib/actions/members.ts
- lib/schemas/invite.ts
- components/invite-link-card.tsx, components/members-list.tsx, components/assignee-display.tsx
- pages: /h/[id]/settings, /h/[id]/members, /invite/[token], /h/[id]/leave
- PB migrations: home_members, invites, rule updates
- PB hook update: homes_owner_member
</code_context>

<specifics>
- Avatar icons: initials in a circle (shadcn "Avatar" if available, otherwise a small inline SVG with CSS). Warm accent as bg for self, muted for others.
- Invite URL copy: show a brief toast "Copied" on click (sonner).
- Expiry visible: "Expires April 30" in the invite card.
- Remove member confirm: type-to-confirm not required for members (only for delete home). A single confirm dialog is fine.
</specifics>

<deferred>
- Email invites (SMTP path) — documented as post-v1
- Role granularity beyond owner/member — post-v1
- Task rotation — v1.1
- Person view route — Phase 5
- Notifications on new-member, task-assigned — Phase 6
</deferred>

---

*Phase: 04-collaboration*
*Context gathered: 2026-04-21 via autonomous yolo-mode synthesis*
