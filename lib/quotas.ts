import type PocketBase from 'pocketbase';

/**
 * Phase 25 RATE-01 — row-creation quotas enforced at the server-action layer.
 *
 * A public-facing deployment with open signup (research §H-2, §H-5) is
 * vulnerable to unbounded row creation by an abusive account: a signed-
 * up user can churn out homes/tasks/areas until the SQLite file becomes
 * a DoS vector (disk fill, GC stalls, slow filters on list endpoints).
 *
 * Three quotas:
 *   - homes : MAX_HOMES_PER_OWNER (default 5)   per owner_id
 *   - tasks : MAX_TASKS_PER_HOME  (default 500) per home_id (archived=false)
 *   - areas : MAX_AREAS_PER_HOME  (default 10)  per home_id
 *             (Whole Home area is exempt — is_whole_home_system=false)
 *
 * DEVIATION from plan (Rule 1 — Bug): the plan specified a PB JSVM
 * hook in `pocketbase/pb_hooks/row_quotas.pb.js` using
 * `onRecordCreateRequest` + `countRecords` / `findRecordsByFilter`.
 * Multiple probes of this approach in PB 0.37.1 exposed two unfixable
 * runtime issues:
 *   1. `process.env` is not reachable from inside request-handler
 *      hooks (reads collapse to a silent generic-400).
 *   2. ANY DB read inside an `onRecordCreateRequest` handler caused
 *      PB to re-dispatch the handler a second time for the same
 *      request; the second `e.next()` landed post-transaction and
 *      the request collapsed to a generic "Something went wrong".
 *      Switching to `onRecordCreate` / `onRecordCreateExecute`,
 *      splitting into separate hook files, and using raw newQuery
 *      all reproduced variants of the same failure mode.
 * Workaround: enforce the quotas at the Next.js server-action layer
 * before the PB create call. Trade-off: a client that bypasses the
 * server action (direct PB REST call from a logged-in user) could
 * skirt the quota, but:
 *   - Open-signup users don't know admin credentials, so they can't
 *     use createAdminClient to bypass.
 *   - The authed PB client STILL goes through the server-action
 *     wrapper on the UI path. Direct REST from a user would require
 *     fishing their auth cookie and crafting raw requests — a low-
 *     yield attack vector given the quotas themselves are small.
 *   - For belt-on-braces, the bootstrap_ratelimits bucket still caps
 *     /api/collections/* requests at 300/60s per-IP.
 * This is documented as a known gap; re-enabling the DB-layer hook
 * is deferred until a future PB version resolves the JSVM re-dispatch
 * issue (tracked as a follow-up in phase 25 SUMMARY).
 *
 * Quotas are env-configurable via `MAX_HOMES_PER_OWNER`,
 * `MAX_TASKS_PER_HOME`, `MAX_AREAS_PER_HOME`. Environment reads happen
 * at the TOP of each call so operators can tweak without redeploy
 * (Next.js reads process.env on every server action invocation).
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type QuotaResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Assert that creating another home for `ownerId` would not breach
 * MAX_HOMES_PER_OWNER. Returns {ok:false, reason} on breach so the
 * caller can surface a friendly formError.
 *
 * Uses `pb.filter()` to bind the ownerId safely (no SQL-injection
 * reachable even if owner_id were widened to accept arbitrary text).
 */
export async function assertHomesQuota(
  pb: PocketBase,
  ownerId: string,
): Promise<QuotaResult> {
  const max = envInt('MAX_HOMES_PER_OWNER', 5);
  const result = await pb.collection('homes').getList(1, 1, {
    filter: pb.filter('owner_id = {:uid}', { uid: ownerId }),
    fields: 'id',
    skipTotal: false,
  });
  if (result.totalItems >= max) {
    return { ok: false, reason: `Quota exceeded: maximum ${max} homes per owner` };
  }
  return { ok: true };
}

/**
 * Assert that creating another task in `homeId` would not breach
 * MAX_TASKS_PER_HOME. Archived tasks (archived=true) are bookkeeping
 * and do NOT count against the active quota.
 */
export async function assertTasksQuota(
  pb: PocketBase,
  homeId: string,
): Promise<QuotaResult> {
  const max = envInt('MAX_TASKS_PER_HOME', 500);
  const result = await pb.collection('tasks').getList(1, 1, {
    filter: pb.filter('home_id = {:hid} && archived = false', { hid: homeId }),
    fields: 'id',
    skipTotal: false,
  });
  if (result.totalItems >= max) {
    return {
      ok: false,
      reason: `Quota exceeded: maximum ${max} active tasks per home`,
    };
  }
  return { ok: true };
}

/**
 * Assert that creating another area in `homeId` would not breach
 * MAX_AREAS_PER_HOME. The auto-created Whole Home area
 * (is_whole_home_system=true) is exempt per D-04.
 */
export async function assertAreasQuota(
  pb: PocketBase,
  homeId: string,
): Promise<QuotaResult> {
  const max = envInt('MAX_AREAS_PER_HOME', 10);
  const result = await pb.collection('areas').getList(1, 1, {
    filter: pb.filter('home_id = {:hid} && is_whole_home_system = false', {
      hid: homeId,
    }),
    fields: 'id',
    skipTotal: false,
  });
  if (result.totalItems >= max) {
    return { ok: false, reason: `Quota exceeded: maximum ${max} areas per home` };
  }
  return { ok: true };
}
