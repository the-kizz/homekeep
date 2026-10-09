/// <reference path="../pb_data/types.d.ts" />

/**
 * 04-03 Rule 2 deviation — users.viewRule relaxation.
 *
 * After Phase 4's rule swap, home_members queries with `expand: 'user_id'`
 * need to resolve target user records. The default `users.viewRule` is
 * `id = @request.auth.id` (self-only read), which blocks the expand and
 * surfaces as empty name/email in members / assignee / avatar UIs.
 *
 * The relaxed rule permits a user to view OTHER user records when they
 * share a home — i.e. when there exists a home_members row whose
 * `user_id` is the target user AND a sibling home_members row for
 * the same home_id whose `user_id` is @request.auth.id. The @collection
 * pattern handles this cleanly without back-relation chaining.
 *
 * Threat model (T-04-03-08, new):
 *   - Info disclosure (email). Mitigation: household members already
 *     have social-level visibility of each other (they're invited into
 *     the same home by the owner). Exposing name/email to co-members
 *     matches the SPEC user expectation ("see who's in the home").
 *     Non-members still cannot read any foreign user record.
 *   - Self-read still works via the `id = @request.auth.id` disjunct.
 *
 * DOWN: restore the PB default self-only rule.
 */

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.viewRule =
      'id = @request.auth.id || home_members_via_user_id.home_id.home_members_via_home_id.user_id ?= @request.auth.id';
    users.listRule =
      'id = @request.auth.id || home_members_via_user_id.home_id.home_members_via_home_id.user_id ?= @request.auth.id';
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.viewRule = 'id = @request.auth.id';
    users.listRule = 'id = @request.auth.id';
    app.save(users);
  },
);
