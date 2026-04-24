---
phase: 31
phase_name: Dead /deployment Link Fix
status: shipped
covered_reqs: [PATCH2-04]
---

# Phase 31 Summary — Dead `/deployment` Link Fix

## Trigger

Post-v1.2.0 404 profiler run against the VPS (46.62.151.57:3000) captured the remaining console 404s after Phase 30's Caddy routing fix:

```
9x  /deployment?...
     → GET /deployment?_rsc=o0g3f  (on /h/<id>/onboarding)
     → GET /deployment?_rsc=tte8w  (on /h/<id>/areas)
```

Next.js 16 auto-prefetches the RSC payload for any `<Link>` rendered above the fold. `/deployment` is not a route, so every HTTP visitor to any page that renders `InsecureContextBanner` saw a console 404 per prefetch.

## Root cause

`components/insecure-context-banner.tsx` rendered a "Learn more" link pointing at `/deployment` — a route that was never implemented. The banner itself was shipped in Phase 7 (07-01 D-07/D-08) along with the placeholder link, which was intended to eventually reach a deployment-hardening doc page but the page never landed.

## Fix

Dropped the `<Link>` from the banner. The informational copy remains — users still see "You're on HTTP — install-to-home-screen and offline support require HTTPS." The full deployment guidance now lives exclusively in `docs/deployment-hardening.md` which operators reach from the repo (not from a dismissible in-app banner that only appears on the user's browser).

`next/link` import also dropped since nothing else in the file used it.

## Files changed

- `components/insecure-context-banner.tsx` — removed `Link`, kept text copy
- `tests/unit/insecure-context-banner.test.tsx` — updated to assert the link is absent

## Verification

- Unit test: 5/5 passes (asserts no `role="link"` named "Learn more")
- Full unit suite: 678/678 green
- Post-deploy 404 profiler re-run will confirm 0 `/deployment` hits (scheduled after v1.2.1 ships)

## REQ-IDs

- **PATCH2-04** ✓ — Remove broken `/deployment` link
