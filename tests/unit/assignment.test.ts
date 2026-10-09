import { describe, it, expect } from 'vitest';
import {
  resolveAssignee,
  type Member,
  type AreaLite,
  type TaskLite,
} from '@/lib/assignment';

/**
 * Cascading assignment resolver — 6-case matrix (04-03 D-18, TASK-03).
 *
 * Pure function, no I/O. Matches RESEARCH §Pattern 10:
 *   Case 1: both null → anyone
 *   Case 2: area default only → area
 *   Case 3: task-level assignee only → task
 *   Case 4: task + area both set → task wins (override)
 *   Case 5: task assignee removed from home, area default present → area fallthrough
 *   Case 6: both assignees removed from home → anyone fallthrough
 */

const alice: Member = { id: 'u_alice', name: 'Alice', role: 'owner' };
const bob: Member = { id: 'u_bob', name: 'Bob', role: 'member' };
const members: Member[] = [alice, bob];

function task(overrides: Partial<TaskLite>): TaskLite {
  return { id: 't1', assigned_to_id: null, area_id: 'a1', ...overrides };
}
function area(overrides: Partial<AreaLite>): AreaLite {
  return { id: 'a1', default_assignee_id: null, ...overrides };
}

describe('resolveAssignee', () => {
  it('case 1: no task assignee, no area default → anyone', () => {
    const r = resolveAssignee(task({}), area({}), members);
    expect(r).toEqual({ kind: 'anyone' });
  });

  it('case 2: area default when task unassigned', () => {
    const r = resolveAssignee(
      task({}),
      area({ default_assignee_id: 'u_bob' }),
      members,
    );
    expect(r).toEqual({ kind: 'area', user: bob });
  });

  it('case 3: task-level assignee wins over unset area default', () => {
    const r = resolveAssignee(
      task({ assigned_to_id: 'u_alice' }),
      area({}),
      members,
    );
    expect(r).toEqual({ kind: 'task', user: alice });
  });

  it('case 4: task wins over area default (both set)', () => {
    const r = resolveAssignee(
      task({ assigned_to_id: 'u_alice' }),
      area({ default_assignee_id: 'u_bob' }),
      members,
    );
    expect(r).toEqual({ kind: 'task', user: alice });
  });

  it('case 5: removed task assignee falls through to area default', () => {
    const r = resolveAssignee(
      task({ assigned_to_id: 'u_removed' }),
      area({ default_assignee_id: 'u_bob' }),
      members,
    );
    expect(r).toEqual({ kind: 'area', user: bob });
  });

  it('case 6: both removed → anyone fallthrough', () => {
    const r = resolveAssignee(
      task({ assigned_to_id: 'u_removed' }),
      area({ default_assignee_id: 'u_also-removed' }),
      members,
    );
    expect(r).toEqual({ kind: 'anyone' });
  });
});
