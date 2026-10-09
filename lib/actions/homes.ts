'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership, assertOwnership } from '@/lib/membership';
import { assertHomesQuota } from '@/lib/quotas';
import { homeSchema } from '@/lib/schemas/home';
import type { ActionState } from '@/lib/schemas/auth';

/**
 * Home server actions (02-04 Plan).
 *
 * Four exports:
 *   - createHome      → HOME-01 (user creates a home)
 *   - updateHome      → HOME-02 rename/edit path
 *   - switchHome      → HOME-03 (last-viewed) + HOME-04 (switch between homes)
 *   - deleteHome      → plumbed for completeness but NOT UI-wired this plan
 *                       (CONTEXT §Specifics: Danger Zone lives in Settings,
 *                       deferred to Phase 2+ or Phase 5)
 *
 * Security posture (threat_model T-02-04-01..08):
 *   - owner_id is *always* derived from pb.authStore.record.id on the
 *     server. formData's owner_id is ignored — clients cannot forge
 *     another owner. (T-02-04-02)
 *   - Filter strings only embed authStore-derived ids via template
 *     literal; any future user-input filter MUST use pb.filter(). See
 *     RESEARCH §Security Domain line 1766. (T-02-04-01)
 *   - PB errors never re-thrown or exposed in formError — actions return
 *     a generic "Could not save" string. (T-02-04-07)
 */

export async function createHome(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Empty-string address → omit so zod's optional() + PB's max=200 don't
  // produce a misleading error and so PB stores null rather than "".
  const rawAddress = String(formData.get('address') ?? '').trim();
  const raw = {
    name: String(formData.get('name') ?? '').trim(),
    address: rawAddress.length ? rawAddress : undefined,
    timezone: String(formData.get('timezone') ?? '').trim(),
  };

  const parsed = homeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }
  const authId = pb.authStore.record.id;

  // Phase 25 RATE-01: per-owner home quota. See lib/quotas.ts for the
  // full deviation note on why this lives at the action layer rather
  // than a PB JSVM hook.
  const quota = await assertHomesQuota(pb, authId);
  if (!quota.ok) {
    return { ok: false, formError: quota.reason };
  }

  let homeId: string;
  try {
    // owner_id comes from the trusted authStore — never from formData.
    // 05-03: new homes enter the onboarding wizard; seed or skip flips
    //        this to true (backfilled rows already have onboarded=true
    //        from migration 1714953604, so existing homes skip the wizard).
    const home = await pb.collection('homes').create({
      name: parsed.data.name,
      address: parsed.data.address ?? '',
      timezone: parsed.data.timezone,
      owner_id: authId,
      onboarded: false,
    });
    homeId = home.id;

    // HOME-03: set this newly-created home as last-viewed so the next /h
    // visit (or logout/login) lands the user back here.
    await pb.collection('users').update(authId, {
      last_viewed_home_id: homeId,
    });
  } catch {
    return { ok: false, formError: 'Could not create home' };
  }

  // Revalidate the /h listing + the new home route so nav caches update.
  revalidatePath('/h', 'layout');
  redirect(`/h/${homeId}`);
}

export async function updateHome(
  homeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawAddress = String(formData.get('address') ?? '').trim();
  const raw = {
    name: String(formData.get('name') ?? '').trim(),
    address: rawAddress.length ? rawAddress : undefined,
    timezone: String(formData.get('timezone') ?? '').trim(),
  };

  const parsed = homeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  // 04-02 D-13: updateHome is owner-only. assertOwnership throws for
  // non-owner members; we translate to a friendly error.
  try {
    await assertOwnership(pb, homeId);
  } catch {
    return { ok: false, formError: 'Only the home owner can edit this home' };
  }

  try {
    // PB's updateRule (`owner_id = @request.auth.id`) still blocks
    // cross-owner writes as defense-in-depth beneath the action guard.
    await pb.collection('homes').update(homeId, {
      name: parsed.data.name,
      address: parsed.data.address ?? '',
      timezone: parsed.data.timezone,
    });
  } catch {
    return { ok: false, formError: 'Could not save home' };
  }

  revalidatePath('/h', 'layout');
  revalidatePath(`/h/${homeId}`);
  return { ok: true };
}

/**
 * Switch the user's current home. Not a useActionState-shape action —
 * called directly from HomeSwitcher (client component) inside a
 * useTransition scope. Updates users.last_viewed_home_id so HOME-03's
 * "land on last-viewed" post-login behaviour works.
 *
 * Per Open Q #3 (CONTEXT): we call revalidatePath('/h','layout') so the
 * authed layout refetches the homes list with the new current selection,
 * but let the client handle the router.push to the target home URL. This
 * avoids a full-tree invalidation on every switch.
 */
export async function switchHome(homeId: string): Promise<void> {
  if (typeof homeId !== 'string' || homeId.length === 0) return;

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) return;
  const authId = pb.authStore.record.id;

  // 04-02 D-13 defense-in-depth: silently no-op if the user is not a
  // member of this home. Prevents setting last_viewed_home_id to a home
  // the user cannot access (which would cause the (app)/layout redirect
  // to land on a 404 after login). Best-effort, no formError surface.
  try {
    await assertMembership(pb, homeId);
  } catch {
    return;
  }

  try {
    await pb.collection('users').update(authId, {
      last_viewed_home_id: homeId,
    });
  } catch {
    // Swallow — the client will still navigate; worst case the next /h
    // visit doesn't land here. Logging would be nice when Phase 7 adds
    // structured logging.
    return;
  }

  revalidatePath('/h', 'layout');
}

/**
 * Destructive home delete. Plumbed but NOT UI-wired in 02-04 — the
 * Settings → Danger Zone flow is deferred per CONTEXT §Specifics. Exposed
 * as an internal action so a future Settings plan can import it without a
 * schema rewrite.
 *
 * TODO(02-06+ or Phase 5 Settings): build a <Dialog> with typed-name
 * confirmation per CONTEXT ("requires typing the home name to confirm");
 * wire this action from the confirmation form submit. PB cascadeDelete
 * cleans up areas + tasks automatically (see 02-01 migration).
 */
export async function deleteHome(homeId: string): Promise<ActionState> {
  if (typeof homeId !== 'string' || homeId.length === 0) {
    return { ok: false, formError: 'Missing home id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  // 04-02 D-13: deleteHome is owner-only.
  try {
    await assertOwnership(pb, homeId);
  } catch {
    return { ok: false, formError: 'Only the home owner can delete this home' };
  }

  try {
    await pb.collection('homes').delete(homeId);
  } catch {
    return { ok: false, formError: 'Could not delete home' };
  }

  revalidatePath('/h', 'layout');
  return { ok: true };
}
