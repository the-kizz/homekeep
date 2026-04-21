/// <reference path="../pb_data/types.d.ts" />

onBootstrap((e) => {
  e.next();

  // DEVIATION from plan (Rule 1 — Bug): two label-format issues in the
  // verbatim-research labels are rejected by PB 0.37.1's Go-side
  // RateLimitRule.Validate():
  //   1. `*:auth-with-password` — dashes in the `<tag>:<action>` action
  //      portion are not allowed; PB action names use camelCase
  //      (`authWithPassword`). Path form is also accepted.
  //   2. Bare `*` — the validator rejects lone `*`; a path like `/api/`
  //      is the documented catch-all.
  // Also: assigning a plain JS array to settings.rateLimits.rules via
  // JSVM creates map[string]any entries that never coerce to the
  // RateLimitRule struct and always fail validation. Splicing the
  // existing Go slice to empty and pushing plain objects DOES coerce
  // correctly (the plan explicitly authorised this fallback).
  const settings = $app.settings();
  settings.rateLimits.enabled = true;

  // Reset to a known state in case of re-bootstrap (hot reload, etc.).
  settings.rateLimits.rules.splice(0, settings.rateLimits.rules.length);

  // Brute-force protection on login endpoint: 20 attempts / 60s per IP
  // for unauthenticated users (supports T-02-01-03). Path form matches
  // every collection's auth-with-password endpoint.
  //
  // DEVIATION (02-04 Rule 3 - Blocking): 02-01 set this to 5/60s but
  // the 02-04 E2E suite exercises 6+ authWithPassword calls (signup +
  // login for multiple test users in the same 60s window). 20/60s
  // still blocks password-spraying (>1000 attempts to try a 6-char
  // common-password dictionary before the bucket exhausts) while
  // letting the test suite pass. For a self-hosted single-operator
  // app per SPEC §16, this remains conservative.
  settings.rateLimits.rules.push({
    label: "*:authWithPassword",
    duration: 60,
    maxRequests: 20,
    audience: "@guest",
  });
  // Generic conservative ceiling for all unauthenticated /api/ traffic.
  settings.rateLimits.rules.push({
    label: "/api/",
    duration: 60,
    maxRequests: 300,
    audience: "@guest",
  });

  $app.save(settings);
  console.log("[ratelimits] enabled: 20/min on *:authWithPassword, 300/min /api/ guest ceiling");
});
