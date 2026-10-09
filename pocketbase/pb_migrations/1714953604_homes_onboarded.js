/// <reference path="../pb_data/types.d.ts" />

/**
 * 05-01 Task 1 — homes.onboarded boolean field + backfill (D-15).
 *
 * Phase 5 introduces a first-run seed-library wizard at `/h/[homeId]/onboarding`.
 * The dashboard decides whether to redirect a fresh home there by consulting
 * `homes.onboarded`. New homes should start `false` so the wizard runs once;
 * after the user adds seed tasks OR clicks "Skip", createHome / wizardAction
 * flips the flag to `true`.
 *
 * Backfill semantics (D-15):
 *   Existing Phase 2/3/4 homes predate the `onboarded` column and already
 *   have hand-curated tasks/areas. Forcing them into the wizard would be
 *   disruptive, so we backfill `onboarded = true` for every pre-existing
 *   record. Only homes created AFTER this migration runs will default to
 *   `false` and thus see the wizard (PB stores `false` for an unset
 *   BoolField in a new record — confirmed via pb 0.37.1 behaviour).
 *
 * Threat model (T-05-01-01):
 *   `homes.updateRule` already pins writes to owner_id = @request.auth.id
 *   (see 1714953602_update_rules_multi_member.js). The onboarded flag is
 *   a per-owner UX toggle, not a security boundary — an owner flipping
 *   their own home's `onboarded` is acceptable. No rule swap needed.
 *
 * Repudiation note (T-05-01-03): the silent backfill is intentional per
 * D-15; it preserves the invariant "existing households never see the
 * wizard". Documented inline here as the audit trail.
 *
 * DOWN: remove the `onboarded` field from the collection. PB discards the
 * stored values on field removal; a subsequent re-up of this migration
 * will re-backfill whatever rows exist at that time.
 */

migrate(
  (app) => {
    const homes = app.findCollectionByNameOrId('homes');
    homes.fields.add(new BoolField({ name: 'onboarded' }));
    app.save(homes);

    // Backfill pre-existing rows. `findRecordsByFilter('homes', '')` with an
    // empty filter returns every row in the collection — idiomatic per PB
    // JSVM docs and matches the home_members backfill pattern in
    // 1714953600_home_members.js.
    const rows = app.findRecordsByFilter('homes', '');
    for (const r of rows) {
      r.set('onboarded', true);
      app.save(r);
    }
  },
  (app) => {
    const homes = app.findCollectionByNameOrId('homes');
    const field = homes.fields.getByName('onboarded');
    if (field) {
      homes.fields.removeById(field.id);
      app.save(homes);
    }
  },
);
