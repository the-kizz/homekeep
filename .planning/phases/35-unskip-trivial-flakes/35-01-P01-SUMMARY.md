<!-- gitleaks:allow (test file references, no secrets) -->
---
phase: 35
phase_name: Unskip Trivial E2E Flakes
status: shipped
parent_milestone: v1.3-test-stabilization
covered_reqs: [TESTFIX-01, TESTFIX-02]
---

# Phase 35 Summary — Unskip Trivial E2E Flakes

## TESTFIX-01 — `tests/e2e/homes-areas.spec.ts:41` un-skipped

**Test:** `'create home → Whole Home auto-created → add Kitchen →
edit → delete guard'`

**Root cause:** race on edit-form Save → `page.goto('/h/<id>/areas')`.
The click fired the Server Action POST; the immediate `goto` fired
before the POST response returned, so the re-query on `/areas`
missed the in-flight DB write. Test's final `toBeVisible()` timed
out because the row was still named "Kitchen," not "Kitchen & Dining."

**Fix (minimal):** before `goto`, `await` a
`page.waitForResponse()` matching any 2xx/3xx POST — gates the
navigation until the Server Action has committed. Bumped the final
`toBeVisible` timeout from the default 5s to 10s as a belt-and-
braces margin.

**Code:**
```ts
const saved = page.waitForResponse(
  (r) => r.request().method() === 'POST' && r.status() >= 200 && r.status() < 400,
);
await page.click('button:has-text("Save changes")');
await saved;
```

## TESTFIX-02 — `tests/e2e/notifications.spec.ts:150` un-skipped

**Test:** `'Part 1: /person shows real notification prefs form;
save + reload persists topic and weekly_summary_day'`

**Root cause:** RHF `Controller`-wrapped checkbox triggers a
`useWatch` → conditional render of `[data-field=weekly-summary-day]`
on a subsequent React tick. CI headless Chromium doesn't pause for
the tick, so `toBeVisible()` (5s default) polled too aggressively
early and gave up.

**Fix (minimal):** confirm the checkbox took state first with
`toBeChecked({timeout: 5_000})`, then give the conditional render
up to 10s to land.

**Code:**
```ts
await weeklyBox.check();
await expect(weeklyBox).toBeChecked({ timeout: 5_000 });
await expect(
  page.locator('[data-field=weekly-summary-day]'),
).toBeVisible({ timeout: 10_000 });
```

## Verification

- Unit tests still 678/678 green (post-change)
- Both tests un-skipped (`test.skip()` → `test()`)
- TESTFIX-03 fix bundled in same commit — without it, these two
  tests would still hit the upstream signup → `/h` redirect race
  on signup (both call the `signup()` helper first)
- Green confirmation lives in CI run on the commit's `c<sha>`

## What was NOT changed

- No new shared test helpers (deferred to Phase 37)
- No Server Action order changes beyond what TESTFIX-03 covers
- No bumps to default Playwright timeouts globally (only
  per-assertion explicit bumps)
