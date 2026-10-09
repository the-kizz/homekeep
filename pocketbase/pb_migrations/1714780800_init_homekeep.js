/// <reference path="../pb_data/types.d.ts" />

// DEVIATION from plan (Rule 1 — Bug): PB 0.37.1's JSVM `new Collection({...})`
// constructor ignores the `fields` and `indexes` options passed via the
// init-object form. Only `type`, `name`, and the *Rule fields survive. We must
// add fields and indexes post-construction via `collection.fields.add(...)`
// and `collection.indexes = [...]`. Without this rewrite, PB rejects the
// migration at save-time because the rule expressions reference fields
// (`owner_id`, `home_id`) that never made it onto the collection.

migrate((app) => {
  // ========================================================================
  // 1. Create homes collection
  // ========================================================================
  const homes = new Collection({
    type: "base",
    name: "homes",
    // API rules — string expressions evaluated per-request
    listRule:   '@request.auth.id != "" && owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && owner_id = @request.auth.id',
    deleteRule: '@request.auth.id != "" && owner_id = @request.auth.id',
  });
  homes.fields.add(new TextField({ name: "name", required: true, max: 100 }));
  homes.fields.add(new TextField({ name: "address", max: 200 }));
  // NOTE: default value for a text field is set via a separate form field
  // in PB dashboard; in migrations we use `autogeneratePattern` only for
  // auto-generated IDs. Default is enforced at app-code layer (server
  // action fills timezone from home-creator's locale or 'Australia/Perth').
  homes.fields.add(new TextField({ name: "timezone", required: true }));
  homes.fields.add(new RelationField({
    name: "owner_id",
    required: true,
    collectionId: app.findCollectionByNameOrId("users").id,
    cascadeDelete: false,  // block user delete while homes exist; UI-level confirm
    minSelect: 1,
    maxSelect: 1,
  }));
  homes.fields.add(new AutodateField({ name: "created", onCreate: true }));
  homes.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  homes.indexes = [
    "CREATE INDEX idx_homes_owner ON homes (owner_id)",
  ];
  app.save(homes);

  // ========================================================================
  // 2. Create areas collection
  // ========================================================================
  const areas = new Collection({
    type: "base",
    name: "areas",
    // Access gated through the parent home's owner
    listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    // Schema-level guard prevents deletion of the auto-created Whole Home area
    // (open question #4 resolution: "both" — schema + UI guard).
    deleteRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id && is_whole_home_system = false',
  });
  areas.fields.add(new RelationField({
    name: "home_id",
    required: true,
    collectionId: homes.id,
    cascadeDelete: true,   // deleting a home deletes its areas
    minSelect: 1,
    maxSelect: 1,
  }));
  areas.fields.add(new TextField({ name: "name", required: true, max: 60 }));
  areas.fields.add(new TextField({ name: "icon", max: 40 }));               // default 'home' at app layer
  areas.fields.add(new TextField({ name: "color", max: 7, pattern: "^#[0-9A-Fa-f]{6}$" }));
  areas.fields.add(new NumberField({ name: "sort_order", onlyInt: true }));
  areas.fields.add(new SelectField({
    name: "scope",
    required: true,
    values: ["location", "whole_home"],
    maxSelect: 1,
  }));
  areas.fields.add(new RelationField({
    name: "default_assignee_id",
    collectionId: app.findCollectionByNameOrId("users").id,
    cascadeDelete: false,
    minSelect: 0,   // nullable
    maxSelect: 1,
  }));
  areas.fields.add(new BoolField({ name: "is_whole_home_system" }));
  areas.fields.add(new AutodateField({ name: "created", onCreate: true }));
  areas.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  areas.indexes = [
    "CREATE INDEX idx_areas_home ON areas (home_id)",
    "CREATE INDEX idx_areas_home_sort ON areas (home_id, sort_order)",
  ];
  app.save(areas);

  // ========================================================================
  // 3. Create tasks collection
  // ========================================================================
  const tasks = new Collection({
    type: "base",
    name: "tasks",
    listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    deleteRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
  });
  tasks.fields.add(new RelationField({
    name: "home_id",
    required: true,
    collectionId: homes.id,
    cascadeDelete: true,
    minSelect: 1,
    maxSelect: 1,
  }));
  tasks.fields.add(new RelationField({
    name: "area_id",
    required: true,
    collectionId: areas.id,
    cascadeDelete: true,
    minSelect: 1,
    maxSelect: 1,
  }));
  tasks.fields.add(new TextField({ name: "name", required: true, max: 120 }));
  tasks.fields.add(new EditorField({ name: "description" }));
  tasks.fields.add(new NumberField({ name: "frequency_days", required: true, min: 1, onlyInt: true }));
  tasks.fields.add(new SelectField({
    name: "schedule_mode",
    required: true,
    values: ["cycle", "anchored"],
    maxSelect: 1,
  }));
  tasks.fields.add(new DateField({ name: "anchor_date" }));
  tasks.fields.add(new TextField({ name: "icon", max: 40 }));
  tasks.fields.add(new TextField({ name: "color", max: 7, pattern: "^#[0-9A-Fa-f]{6}$" }));
  tasks.fields.add(new RelationField({
    name: "assigned_to_id",
    collectionId: app.findCollectionByNameOrId("users").id,
    cascadeDelete: false,
    minSelect: 0,
    maxSelect: 1,
  }));
  tasks.fields.add(new TextField({ name: "notes", max: 2000 }));
  tasks.fields.add(new BoolField({ name: "archived" }));
  tasks.fields.add(new DateField({ name: "archived_at" }));
  tasks.fields.add(new AutodateField({ name: "created", onCreate: true }));
  tasks.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  tasks.indexes = [
    "CREATE INDEX idx_tasks_home ON tasks (home_id)",
    "CREATE INDEX idx_tasks_area ON tasks (area_id)",
    "CREATE INDEX idx_tasks_home_archived ON tasks (home_id, archived)",
  ];
  app.save(tasks);

  // ========================================================================
  // 4. Extend built-in users collection with last_viewed_home_id (D-05)
  // ========================================================================
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new RelationField({
    name: "last_viewed_home_id",
    collectionId: homes.id,
    cascadeDelete: false,  // if home deleted, field nullifies automatically
    minSelect: 0,
    maxSelect: 1,
  }));
  app.save(users);
}, (app) => {
  // ========================================================================
  // DOWN migration — reverse order (leaf → root)
  // ========================================================================
  // Remove the users extension field first
  try {
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("last_viewed_home_id");
    app.save(users);
  } catch (_) { /* idempotent */ }

  // Drop tables in reverse-dependency order
  for (const name of ["tasks", "areas", "homes"]) {
    try {
      const c = app.findCollectionByNameOrId(name);
      app.delete(c);
    } catch (_) { /* idempotent */ }
  }
});
