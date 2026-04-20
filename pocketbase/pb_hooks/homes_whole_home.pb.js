/// <reference path="../pb_data/types.d.ts" />

// Fires inside the same DB transaction as the home insert.
// If this throws, the home insert is rolled back.
onRecordCreateExecute((e) => {
  // Recursion guard — we only fire on homes; nothing here creates another home.
  // But be explicit for future readers.
  if (e.record.collection().name !== "homes") {
    e.next();
    return;
  }

  const areas = e.app.findCollectionByNameOrId("areas");
  const wholeHome = new Record(areas, {
    home_id:              e.record.id,
    name:                 "Whole Home",
    scope:                "whole_home",
    sort_order:           0,
    is_whole_home_system: true,
    icon:                 "home",
    color:                "#D4A574",
  });

  // saveNoValidate would skip field validation; use save() so zod-equivalent
  // server-side validation (required/min/max) runs. If it throws, the outer
  // transaction rolls back.
  e.app.save(wholeHome);

  e.next();
}, "homes");
