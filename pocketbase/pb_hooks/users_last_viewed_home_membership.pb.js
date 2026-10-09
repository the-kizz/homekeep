/// <reference path="../pb_data/types.d.ts" />

/**
 * Phase 23 SEC-05 — last_viewed_home_id IDOR hardening hook.
 *
 * The `users.last_viewed_home_id` relation is self-writable under PB's
 * default users.updateRule (users can update their own record). The
 * action-layer switchHome() already calls assertMembership before
 * writing, but that guard is bypassed if a client talks directly to
 * /api/collections/users/records/:id via the SDK.
 *
 * This hook is the DB-layer backstop: on users.update, if the caller
 * is setting last_viewed_home_id to a non-empty value, verify the
 * authed user is a member of the target home (home_members row
 * exists where home_id = target AND user_id = auth.id). If not, throw
 * a BadRequestError — PB surfaces this as a 400/403 on the response.
 *
 * The check only runs on user-initiated writes (e.auth != null). The
 * owner-auto-created flow in `homes_whole_home.pb.js` does NOT touch
 * last_viewed_home_id; lib/actions/homes.ts:74 sets it in a separate
 * users.update call after the home + member rows exist, so by the
 * time that update lands, the membership row is already present.
 *
 * Clearing (setting to null/empty) is always allowed — it's the
 * "reset to none" path (e.g. user leaves the home, we clear the
 * pointer in lib/actions/members.ts:92).
 *
 * We intentionally use onRecordUpdateRequest (request-level, pre-save)
 * rather than onRecordUpdateExecute (inside the tx) so the rejection
 * is visible to the client via the standard error surface and the
 * persistence hasn't started yet. Matches the "validate then persist"
 * convention over "let the tx decide".
 */

onRecordUpdateRequest((e) => {
  // Only guard user-scoped writes. Admin/superuser writes pass through
  // (backup / ops flows sometimes need to reset last_viewed_home_id).
  if (!e.auth) {
    e.next();
    return;
  }

  // Only guard writes that actually touch last_viewed_home_id. PB's
  // e.record.getString handles "field not in request body" as ""
  // so we have to distinguish "untouched" from "cleared". Use the
  // ORIGINAL copy comparison: if the stored value differs from the
  // incoming value, the field is being written. If both match, skip.
  const incoming = e.record.getString("last_viewed_home_id");
  const original = e.record.original().getString("last_viewed_home_id");

  if (incoming === original) {
    // Field unchanged — either not in the payload or same value. Skip.
    e.next();
    return;
  }

  // Clearing to empty is always allowed (the "I left the home" path).
  if (incoming === "") {
    e.next();
    return;
  }

  // Incoming value is a home id — verify the authed user is a member.
  // findFirstRecordByFilter with parameterised filter (SEC-01 pattern).
  try {
    $app.findFirstRecordByFilter(
      "home_members",
      "home_id = {:hid} && user_id = {:uid}",
      { hid: incoming, uid: e.auth.id },
    );
  } catch (_) {
    // No membership row -> reject the write.
    throw new BadRequestError(
      "Cannot set last_viewed_home_id to a home you are not a member of",
    );
  }

  e.next();
}, "users");
