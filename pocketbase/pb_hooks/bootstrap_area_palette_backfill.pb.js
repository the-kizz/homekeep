/// <reference path="../pb_data/types.d.ts" />

// Idempotent palette backfill: the area palette was tightened to
// warm-only tones in the Phase 9 UX audit. Any area row whose color
// is not in the current warm palette gets migrated to the nearest
// warm analogue. Covers:
//   - the two explicitly retired hexes (#6B8E5A sage, #4F6D7A slate)
//   - any ad-hoc green/blue that drifted in via earlier demo fixtures
//     or admin dashboard edits (#A8B5A0, #8FA68E, etc.).
//
// Mapping strategy: a tiny explicit lookup for the known legacy
// values; anything else outside the warm palette defaults to the
// primary terracotta #D4A574 so the card at least reads as warm.
onBootstrap((e) => {
  e.next();

  // Current warm palette (must match lib/area-palette.ts). Rows whose
  // color already sits in this set are left alone — the backfill is
  // strictly a one-way warm-ify.
  const WARM_PALETTE = new Set([
    "#D4A574",
    "#C87E5C",
    "#9B6B3E",
    "#B88A6A",
    "#8F6B55",
    "#A67C52",
    "#BF8F4C",
    "#8A6F5C",
  ]);

  // Known legacy cool/ad-hoc hexes → their warm replacement. Tuned to
  // keep the swap visually close (users' mental map of "that's my
  // Bathroom color" stays roughly intact).
  const LEGACY_MAP = {
    "#6B8E5A": "#B88A6A", // retired sage → warm sand
    "#4F6D7A": "#8F6B55", // retired slate → warm cocoa
    "#A8B5A0": "#B88A6A", // ad-hoc sage-gray → warm sand
    "#8FA68E": "#8F6B55", // ad-hoc muted green → warm cocoa
  };

  try {
    // PB's findRecordsByFilter signature (0.37.x):
    //   (collection, filter, sort, limit, offset). Zero limit returns
    // zero rows, so we pass a high ceiling (10_000) and a stable sort.
    const rows = e.app.findRecordsByFilter("areas", "", "id", 10000, 0);
    if (!rows || rows.length === 0) {
      console.log("[area-palette-backfill] no area rows — skipping");
      return;
    }
    let migrated = 0;
    for (const r of rows) {
      const current = r.getString("color");
      if (!current || WARM_PALETTE.has(current)) continue;
      const next = LEGACY_MAP[current] || "#D4A574";
      r.set("color", next);
      e.app.save(r);
      migrated++;
    }
    if (migrated > 0) {
      console.log(
        `[area-palette-backfill] migrated ${migrated} area row(s) to warm palette`,
      );
    } else {
      console.log(
        "[area-palette-backfill] all rows already warm — no-op",
      );
    }
  } catch (err) {
    console.log(
      `[area-palette-backfill] skipped: ${err && (err.message || err)}`,
    );
  }
});
