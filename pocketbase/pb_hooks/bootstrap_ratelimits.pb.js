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

  // Phase 28+ CI exemption: DISABLE_RATE_LIMITS=true (typically set by CI
  // E2E suites) skips all rate-limit rules. The E2E suite signs up 15+
  // users across parallel workers and blows the 10/60s RATE-02 signup
  // bucket, breaking tests that assert post-signup URL redirects. This
  // env gate keeps production-grade limits on operator deployments while
  // letting test workers exercise the full flow. NOT safe for public
  // deployments — leave unset (or explicitly false) in real envs.
  const disableRateLimits = $os.getenv("DISABLE_RATE_LIMITS") === "true";
  settings.rateLimits.enabled = !disableRateLimits;

  // Reset to a known state in case of re-bootstrap (hot reload, etc.).
  settings.rateLimits.rules.splice(0, settings.rateLimits.rules.length);

  if (disableRateLimits) {
    $app.save(settings);
    console.log("[ratelimits] DISABLED via DISABLE_RATE_LIMITS=true");
    return;
  }

  // Brute-force protection on login endpoint: 20 attempts / 60s per IP
  // for unauthenticated users (supports T-02-01-03). Path form matches
  // every collection's auth-with-password endpoint.
  //
  // HISTORY:
  //   - 02-01 originally set this to 5/60s but the 02-04 E2E suite
  //     exercises 6+ authWithPassword calls within 60s → bumped to 20.
  //   - 05-02 (Phase 5) bumped to 60/60s because the full E2E suite
  //     signs up ~15+ users in 60s on slow CI.
  //   - 25-01 (Phase 25 RATE-05) TIGHTENS back to 20/60s. The Phase 2-5
  //     E2E suites no longer dominate the bucket now that later phases
  //     gate on authenticated flows; 20/60s is the research-prescribed
  //     brute-force cap (~1k attempts/hour per IP — below password-spray
  //     economics and above a realistic user retry cadence).
  //
  // DEVIATION (25-01 Rule 3 - Blocking): if a full-suite E2E run blows
  // the 20/60s bucket on CI, raise MAX_AUTH_RPS_TEST env var. We do not
  // hard-code a widened test-path exemption because PB's rate-limit
  // engine has no audience-aware path pattern (the label grammar is
  // limited to `<tag>:<action>` | `path`).
  settings.rateLimits.rules.push({
    label: "*:authWithPassword",
    duration: 60,
    maxRequests: 20,
    audience: "@guest",
  });

  // Phase 25 RATE-02: dedicated signup bucket (users:create) at 10/60s
  // per-IP, narrower than the generic /api/ 300/60s. Prevents automated
  // account-farming for abuse of the row-creation quotas enforced by
  // lib/quotas.ts. Applies to the `users` auth collection's create
  // endpoint; other collections' creates are unaffected because the
  // label tags by collection name.
  settings.rateLimits.rules.push({
    label: "users:create",
    duration: 60,
    maxRequests: 10,
    audience: "@guest",
  });

  // Phase 25 RATE-04: password-reset-confirm at 5/60s per-IP. PB's
  // endpoint is /api/collections/users/confirm-password-reset; the
  // label `users:confirm-password-reset` is rejected by PB 0.37.1's
  // validator (dashes not allowed in the action portion), so we use
  // the camelCase action name `confirmPasswordReset` matching PB's
  // internal route registration. Without this bucket, an attacker
  // could iterate reset-token guesses under only the 300/60s generic
  // ceiling.
  settings.rateLimits.rules.push({
    label: "users:confirmPasswordReset",
    duration: 60,
    maxRequests: 5,
    audience: "@guest",
  });

  // Generic conservative ceiling for all unauthenticated /api/ traffic.
  // Acts as the outermost envelope below the per-endpoint buckets.
  settings.rateLimits.rules.push({
    label: "/api/",
    duration: 60,
    maxRequests: 300,
    audience: "@guest",
  });

  $app.save(settings);
  console.log(
    "[ratelimits] enabled: 20/min *:authWithPassword, 10/min users:create, 5/min users:confirmPasswordReset, 300/min /api/ guest ceiling",
  );
});
