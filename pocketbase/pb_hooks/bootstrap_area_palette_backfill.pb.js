/// <reference path="../pb_data/types.d.ts" />

// One-shot idempotent backfill: the area palette was tightened to
// warm-only tones in the Phase 9 UX audit. Existing rows that had been
// assigned the (removed) sage #6B8E5A or slate #4F6D7A get migrated to
// their nearest warm analogues so the By Area cards all render in the
// intended warm palette.
//
// Runs every bootstrap. The WHERE clause ensures only the two retired
// hexes get touched — repeated bootstraps are no-ops once the backfill
// has converged.
onBootstrap((e) => {
  e.next();
  try {
    const rows = e.app.findRecordsByFilter(
      "areas",
      'color = "#6B8E5A" || color = "#4F6D7A"',
      "",
      0,
      0,
    );
    if (!rows || rows.length === 0) return;
    for (const r of rows) {
      const current = r.getString("color");
      // Sage → warm sand, slate → warm cocoa. Keeps the swap visually
      // close to the retired tone so existing users' mental map of
      // "that's my Bathroom color" isn't jarringly broken.
      const next = current === "#6B8E5A" ? "#B88A6A" : "#8F6B55";
      r.set("color", next);
      e.app.save(r);
    }
    console.log(
      `[area-palette-backfill] migrated ${rows.length} area row(s) to warm palette`,
    );
  } catch (err) {
    console.log(`[area-palette-backfill] skipped: ${err && err.message}`);
  }
});
