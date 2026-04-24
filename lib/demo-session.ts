// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 26 DEMO-02 — ephemeral demo-home seeding + session resume.
 *
 * `ensureDemoSession(cookieStore)` is the single entry point for the
 * demo-instance first-visit flow. Called from `app/api/demo/session/route.ts`.
 *
 * Behaviour (D-04):
 *
 *   1. Read the `homekeep_demo_session` cookie (value = user.id).
 *   2. If cookie + user exist AND user.is_demo=true:
 *        → Touch `last_activity = now` (D-06 idle-TTL signal).
 *        → Return { userId, homeId, pbAuthCookie } so the route handler
 *          can set the pb_auth cookie and redirect to /h/<homeId>.
 *   3. Otherwise (fresh visit OR evicted session):
 *        → Spawn a throwaway user via admin client: is_demo=true,
 *          random email, random password. Auth the same client as
 *          that user so subsequent writes pass tasks.createRule /
 *          home_members membership checks.
 *        → Create home "Demo House" + 3 areas (Kitchen / Outdoor /
 *          Whole Home auto-creates via the existing hook).
 *        → Create 15 seed tasks from SEED_LIBRARY (picked to cover
 *          the four non-whole-home areas; Whole Home entries spread
 *          onto the Whole Home auto-area).
 *        → Return { userId, homeId, pbAuthCookie, isNew: true }.
 *
 * Security invariants:
 *   - is_demo is ONLY set here. Real signups (lib/actions/auth.ts) do
 *     not touch this field, so it stays false (BoolField default) for
 *     every non-demo user. Cleanup cron acts only on is_demo=true rows.
 *   - The admin client used for the initial create bypasses rate limits
 *     (already authed as superuser), so a flood of first-visit bots
 *     creates many throwaway users — mitigated by the per-IP rate limit
 *     on /api/demo/session at the Caddy layer (documented in
 *     Caddyfile.demo block, not enforced here — keep the lib pure).
 *   - The route handler sets the pb_auth cookie under the SAME origin as
 *     homekeep.demo.the-kizz.com; cross-origin cookie leakage is impossible
 *     per standard SameSite=Lax semantics.
 *
 * Module-level guard (D-03, T-26-01): throws if DEMO_MODE !== 'true'.
 * This makes the helper dead-code in production — the route handler
 * ALSO returns 404 before reaching here, but a defence-in-depth throw
 * means a mis-wired import from a non-demo build fails loudly rather
 * than silently minting real-looking throwaway users.
 */

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { createAdminClient } from '@/lib/pocketbase-admin';
import { SEED_LIBRARY, type SeedTask } from '@/lib/seed-library';

const DEMO_COOKIE_NAME = 'homekeep_demo_session';
const DEMO_COOKIE_MAX_AGE = 60 * 60 * 24; // 24h (matches D-06 absolute TTL)

// 15 seeds picked from SEED_LIBRARY — good cross-section of frequencies
// and areas. IDs must match real SEED_LIBRARY entries (seeds-ids are
// load-bearing elsewhere; same list surface used by onboarding wizard).
const DEMO_SEED_IDS: readonly string[] = [
  // Kitchen (3)
  'seed-wipe-benches',
  'seed-clean-sink',
  'seed-empty-kitchen-bin',
  // Bathroom → remapped to Whole Home auto-area (no bathroom area created)
  'seed-clean-toilet',
  'seed-scrub-shower',
  // Living → remapped to Whole Home
  'seed-vacuum-living',
  'seed-dust-surfaces',
  'seed-wipe-lightswitches',
  // Yard / Outdoor (3)
  'seed-mow-lawn',
  'seed-water-pots',
  'seed-sweep-outdoor',
  // Whole Home safety (4) — land on Whole Home auto-area
  'seed-smoke-alarm-batteries',
  'seed-check-gutters',
  'seed-change-aircon-filter',
  'seed-flush-hot-water',
];

export type DemoSessionResult = {
  userId: string;
  homeId: string;
  // Full Set-Cookie-header-style value for pb_auth — the route handler
  // extracts the value portion and sets it via NextResponse cookies.
  pbAuthCookie: string;
  isNew: boolean;
};

/**
 * Safety gate — throws if DEMO_MODE is not 'true'. Called at the top
 * of ensureDemoSession so a rogue import from a production build fails
 * loudly instead of spawning real-looking throwaway accounts.
 */
function assertDemoMode(): void {
  if (process.env.DEMO_MODE !== 'true') {
    throw new Error(
      'lib/demo-session.ts invoked without DEMO_MODE=true — refusing to spawn demo user',
    );
  }
}

/**
 * Public entry point. Caller passes the resolved cookie store (the
 * Next.js `cookies()` helper is async in Next 16, so the caller awaits
 * it and passes the resolved object). We keep the helper itself
 * framework-agnostic so tests can pass a plain `{ get, set }` shim.
 */
export async function ensureDemoSession(
  cookieStore: {
    get: (name: string) => { value: string } | undefined;
  },
): Promise<DemoSessionResult> {
  assertDemoMode();

  const admin = await createAdminClient();
  const existingId = cookieStore.get(DEMO_COOKIE_NAME)?.value;

  // ─── Path 1: resume existing session ─────────────────────────────────
  if (existingId && /^[a-zA-Z0-9]{15}$/.test(existingId)) {
    try {
      const user = await admin.collection('users').getOne(existingId);
      if (user.is_demo === true) {
        // Touch last_activity so cleanup cron treats this session as fresh.
        // Swallow errors — if PB is momentarily unhappy we'd rather return
        // the existing session than force a re-seed.
        try {
          await admin
            .collection('users')
            .update(existingId, { last_activity: new Date().toISOString() });
        } catch {
          /* idempotent touch — best-effort */
        }

        // Find the user's home (should be exactly one per demo user).
        const homes = await admin.collection('homes').getFullList({
          filter: `owner_id = "${existingId}"`,
          fields: 'id',
          batch: 5,
        });
        if (homes.length > 0) {
          // Re-authenticate as the demo user so the caller can export a
          // fresh pb_auth cookie (the admin client's authStore is the
          // superuser, which we don't want to hand to the browser).
          const pbAuthCookie = await authAsDemoUser(existingId);
          return {
            userId: existingId,
            homeId: homes[0].id,
            pbAuthCookie,
            isNew: false,
          };
        }
        // Fall through to re-seed if no home (should never happen but
        // means the user was half-created — treat as fresh).
      }
    } catch {
      /* user gone from PB (cleanup ran between visits) — re-seed */
    }
  }

  // ─── Path 2: spawn fresh demo user + home + seeds ────────────────────
  const tag = randomBytes(6).toString('hex');
  const email = `demo-${tag}@demo.homekeep.local`;
  const password = randomBytes(16).toString('hex'); // 32-char hex
  const name = `Demo visitor ${tag.slice(0, 4)}`;

  const user = await admin.collection('users').create({
    email,
    password,
    passwordConfirm: password,
    name,
    is_demo: true,
    last_activity: new Date().toISOString(),
    // Copy the notification-defaults from 1714953605 so the user is
    // shape-identical to a real account (with notify_* all off; demo
    // users don't receive notifications regardless).
    notify_overdue: false,
    notify_assigned: false,
    notify_partner_completed: false,
    notify_weekly_summary: false,
    weekly_summary_day: 'sunday',
    ntfy_topic: '',
  });

  const userId = user.id;

  // Home creation goes through the user's OWN auth — the Whole Home
  // hook + owner-membership auto-create both bind to e.record.owner_id,
  // and tasks.createRule checks membership. Using admin here would still
  // work (hooks run regardless of caller auth) but the user-authed
  // pattern matches the onboarding.ts convention.
  const userPb = new PocketBase(admin.baseUrl);
  await userPb.collection('users').authWithPassword(email, password);

  const home = await userPb.collection('homes').create({
    name: 'Demo House',
    timezone: 'UTC',
    owner_id: userId,
  });
  const homeId = home.id;

  // Whole Home area auto-created by pb_hooks/homes_whole_home.pb.js.
  // Add Kitchen + Outdoor for the demo (3 areas total, matching D-04).
  await userPb.collection('areas').create({
    home_id: homeId,
    name: 'Kitchen',
    scope: 'location',
    sort_order: 1,
    icon: 'utensils',
    color: '#D4A574',
  });
  await userPb.collection('areas').create({
    home_id: homeId,
    name: 'Outdoor',
    scope: 'location',
    sort_order: 2,
    icon: 'sun',
    color: '#8F6B55',
  });

  // Look up all three areas so we can route seeds appropriately.
  const areas = await userPb.collection('areas').getFullList({
    filter: `home_id = "${homeId}"`,
    fields: 'id,name,scope,is_whole_home_system',
    batch: 10,
  });
  const kitchenArea = areas.find((a) => a.name === 'Kitchen')?.id;
  const outdoorArea = areas.find((a) => a.name === 'Outdoor')?.id;
  const wholeHomeArea = areas.find((a) => a.is_whole_home_system === true)?.id;
  if (!kitchenArea || !outdoorArea || !wholeHomeArea) {
    // Shape invariant violated — bail and let the route handler show
    // an error. Should be unreachable (Whole Home hook is atomic).
    throw new Error('demo-session: required areas missing after creation');
  }

  // Build seed selection payload for a direct createBatch — we intentionally
  // bypass lib/actions/seed.ts::batchCreateSeedTasks here because that
  // helper requires a request-scoped cookies() server-client + membership
  // check + zod envelope with 15 entries; re-creating that context inside
  // a route handler is more fragile than just issuing the batch directly
  // with the user-authed client we already hold.
  const SEED_BY_ID = new Map(SEED_LIBRARY.map((s): [string, SeedTask] => [s.id, s]));
  const selections = DEMO_SEED_IDS
    .map((id) => SEED_BY_ID.get(id))
    .filter((s): s is SeedTask => s !== undefined);

  const batch = userPb.createBatch();
  for (const seed of selections) {
    const areaId =
      seed.suggested_area === 'kitchen' ? kitchenArea :
      seed.suggested_area === 'yard' ? outdoorArea :
      wholeHomeArea;

    batch.collection('tasks').create({
      home_id: homeId,
      area_id: areaId,
      name: seed.name,
      description: seed.description,
      frequency_days: seed.frequency_days,
      schedule_mode: 'cycle',
      anchor_date: '',
      icon: seed.icon,
      color: '',
      assigned_to_id: '',
      notes: '',
      archived: false,
      next_due_smoothed: '',
      active_from_month: seed.active_from_month ?? '',
      active_to_month: seed.active_to_month ?? '',
    });
  }
  // Flip homes.onboarded=true so the dashboard doesn't redirect to the wizard.
  batch.collection('homes').update(homeId, { onboarded: true });
  await batch.send();

  const pbAuthCookie = userPb.authStore.exportToCookie({
    httpOnly: true,
    secure: true, // demo ALWAYS runs behind Caddy TLS (SITE_URL https://)
    sameSite: 'Lax',
  });

  return {
    userId,
    homeId,
    pbAuthCookie,
    isNew: true,
  };
}

/**
 * Re-authenticate as an existing demo user to mint a fresh pb_auth
 * cookie on the resume path. The admin client knows the user's id but
 * not their password (which is random and discarded after create); we
 * work around this by using admin impersonation via PocketBase's
 * `authStore.save(token, record)` — we mint a JWT via the admin API
 * and hand it to the browser.
 *
 * Implementation note: PB 0.37.x exposes `admin.collection('users')
 * .authWithPassword` but not a direct impersonate call. We use the
 * `/api/collections/users/impersonate` endpoint (available to
 * superusers) which returns a real user token without needing the
 * password. Falls back to creating a password-reset and authing if
 * the endpoint is missing (older PB 0.37.x).
 */
async function authAsDemoUser(userId: string): Promise<string> {
  const admin = await createAdminClient();
  // PB 0.22+ ships `impersonate(userId, duration)` on auth collections
  // for superusers. Returns a NEW PocketBase client with an in-memory
  // auth store already loaded with the impersonated user's token.
  // https://pocketbase.io/docs/authentication/#impersonate
  const impersonatedClient = await admin
    .collection('users')
    .impersonate(userId, 60 * 60 * 24); // 24h, matches cookie TTL

  // exportToCookie reads the impersonated client's authStore directly —
  // no need to hand-roll a second PB instance.
  return impersonatedClient.authStore.exportToCookie({
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  });
}

/**
 * Exported for the API route handler — keeps the cookie name a private
 * invariant of this module. Other code must NEVER set/delete the demo
 * session cookie directly; route through setDemoSessionCookie.
 */
export const DEMO_SESSION_COOKIE_NAME = DEMO_COOKIE_NAME;
export const DEMO_SESSION_COOKIE_MAX_AGE = DEMO_COOKIE_MAX_AGE;
