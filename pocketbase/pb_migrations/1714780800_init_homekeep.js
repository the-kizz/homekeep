/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // ========================================================================
  // 1. Create homes collection
  // ========================================================================
  const homes = new Collection({
    type: "base",
    name: "homes",
    fields: [
      new TextField({ name: "name", required: true, max: 100 }),
      new TextField({ name: "address", max: 200 }),
      new TextField({
        name: "timezone",
        required: true,
        // NOTE: default value for a text field is set via a separate form field
        // in PB dashboard; in migrations we use `autogeneratePattern` only for
        // auto-generated IDs. Default is enforced at app-code layer (server
        // action fills timezone from home-creator's locale or 'Australia/Perth').
      }),
      new RelationField({
        name: "owner_id",
        required: true,
        collectionId: app.findCollectionByNameOrId("users").id,
        cascadeDelete: false,  // block user delete while homes exist; UI-level confirm
        minSelect: 1,
        maxSelect: 1,
      }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE INDEX idx_homes_owner ON homes (owner_id)",
    ],
    // API rules — string expressions evaluated per-request
    listRule:   '@request.auth.id != "" && owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && owner_id = @request.auth.id',
    deleteRule: '@request.auth.id != "" && owner_id = @request.auth.id',
  });
  app.save(homes);

  // ========================================================================
  // 2. Create areas collection
  // ========================================================================
  const areas = new Collection({
    type: "base",
    name: "areas",
    fields: [
      new RelationField({
        name: "home_id",
        required: true,
        collectionId: homes.id,
        cascadeDelete: true,   // deleting a home deletes its areas
        minSelect: 1,
        maxSelect: 1,
      }),
      new TextField({ name: "name", required: true, max: 60 }),
      new TextField({ name: "icon", max: 40 }),               // default 'home' at app layer
      new TextField({ name: "color", max: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
      new NumberField({ name: "sort_order", onlyInt: true }),
      new SelectField({
        name: "scope",
        required: true,
        values: ["location", "whole_home"],
        maxSelect: 1,
      }),
      new RelationField({
        name: "default_assignee_id",
        collectionId: app.findCollectionByNameOrId("users").id,
        cascadeDelete: false,
        minSelect: 0,   // nullable
        maxSelect: 1,
      }),
      new BoolField({ name: "is_whole_home_system" }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE INDEX idx_areas_home ON areas (home_id)",
      "CREATE INDEX idx_areas_home_sort ON areas (home_id, sort_order)",
    ],
    // Access gated through the parent home's owner
    listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    // Schema-level guard prevents deletion of the auto-created Whole Home area
    // (open question #4 resolution: "both" — schema + UI guard).
    deleteRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id && is_whole_home_system = false',
  });
  app.save(areas);

  // ========================================================================
  // 3. Create tasks collection
  // ========================================================================
  const tasks = new Collection({
    type: "base",
    name: "tasks",
    fields: [
      new RelationField({
        name: "home_id",
        required: true,
        collectionId: homes.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new RelationField({
        name: "area_id",
        required: true,
        collectionId: areas.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new TextField({ name: "name", required: true, max: 120 }),
      new EditorField({ name: "description" }),
      new NumberField({ name: "frequency_days", required: true, min: 1, onlyInt: true }),
      new SelectField({
        name: "schedule_mode",
        required: true,
        values: ["cycle", "anchored"],
        maxSelect: 1,
      }),
      new DateField({ name: "anchor_date" }),
      new TextField({ name: "icon", max: 40 }),
      new TextField({ name: "color", max: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
      new RelationField({
        name: "assigned_to_id",
        collectionId: app.findCollectionByNameOrId("users").id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      }),
      new TextField({ name: "notes", max: 2000 }),
      new BoolField({ name: "archived" }),
      new DateField({ name: "archived_at" }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE INDEX idx_tasks_home ON tasks (home_id)",
      "CREATE INDEX idx_tasks_area ON tasks (area_id)",
      "CREATE INDEX idx_tasks_home_archived ON tasks (home_id, archived)",
    ],
    listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    updateRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    deleteRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
  });
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
