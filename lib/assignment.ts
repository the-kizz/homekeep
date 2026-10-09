// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep
/**
 * Cascading assignment resolver (04-03 Plan, D-09 + RESEARCH Pattern 10).
 *
 * Pure function, no I/O, no side effects. Called from Server Components
 * (dashboard) and Client Components (TaskForm preview) alike — see the
 * one-sentence contract per return variant below.
 *
 * Cases (see tests/unit/assignment.test.ts for the canonical matrix):
 *   1. task.assigned_to_id set AND user still in home_members → 'task'
 *   2. task.assigned_to_id set BUT user no longer in home_members →
 *      fall through to area default (edge: assignee was removed; PB does
 *      not cascade-null the relation until the user record is deleted,
 *      and the user record may persist beyond their membership).
 *   3. task.assigned_to_id unset, area.default_assignee_id set AND
 *      member-of-home → 'area'
 *   4. neither set → 'anyone'
 *   5. both set → 'task' wins (task-level override)
 *   6. both assignees no longer members → 'anyone'
 *
 * Edge cases:
 *   - Archived task: still resolves (caller decides whether to render).
 *   - Deleted assignee user: tasks.assigned_to_id points at a user
 *     record. Even if the user is deleted, resolveAssignee's member
 *     lookup falls through — no throw, no crash.
 *   - Multiple overlapping assignees: the cascade is strict, not
 *     "most specific wins". Task wins over area; removed assignee
 *     falls through deterministically.
 */

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

export function resolveAssignee(
  task: TaskLite,
  area: AreaLite,
  members: Member[],
): EffectiveAssignee {
  const byId = new Map(members.map((m) => [m.id, m]));

  // Cases 1 + 4: task-level assignee wins when the assignee is still a member.
  if (task.assigned_to_id) {
    const user = byId.get(task.assigned_to_id);
    if (user) return { kind: 'task', user };
    // Case 5: fall through — assignee is no longer a member.
  }

  // Case 2: fall back to area default when member-valid.
  if (area.default_assignee_id) {
    const user = byId.get(area.default_assignee_id);
    if (user) return { kind: 'area', user };
    // Case 6: fall through — area default is no longer a member.
  }

  // Cases 3 + 6: Anyone.
  return { kind: 'anyone' };
}
