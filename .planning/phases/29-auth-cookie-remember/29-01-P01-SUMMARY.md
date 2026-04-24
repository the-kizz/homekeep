---
phase: 29
phase_name: Auth Cookie + Remember Me
status: shipped
mode: retroactive
commit: 3215ca8
covered_reqs: [PATCH2-01, PATCH2-02]
---

# Phase 29 Summary — Auth Cookie + Remember Me *(retroactive)*

## Trigger

v1.2 live-smoke Playwright run against `http://46.62.151.57:3000` on 2026-04-24. The test signed up a fresh user, landed on `/h`, then clicked "Create your first home" — and got bounced to `/login?next=/h/new`. The auth cookie from signup was not being sent back on the subsequent navigation.

## Root cause

`lib/actions/auth.ts::cookieOptions` set the `Secure` attribute from `process.env.NODE_ENV === 'production'`:

```ts
// Before
secure: process.env.NODE_ENV === 'production'
```

On the VPS, `NODE_ENV=production` but `SITE_URL=http://46.62.151.57:3000`. Browsers drop cookies marked `Secure` over plain HTTP. Signup's `Set-Cookie` header was accepted by the response but the cookie never attached to subsequent requests → every authed page redirected to `/login`. Unit tests didn't catch it because they mock request cycles; E2E tests run against `http://localhost:3000` where `NODE_ENV` defaults to `development` (so `Secure` was `false` during test runs).

## Fix

Derive `Secure` from the scheme of `SITE_URL`:

```ts
function isSecureSite(): boolean {
  const siteUrl = process.env.SITE_URL ?? '';
  return siteUrl.startsWith('https://');
}
```

This is correct for all three deployment shapes:
- Localhost dev: `SITE_URL=http://localhost:3000` → `Secure=false` ✓
- LAN/VPS HTTP prod: `SITE_URL=http://...` → `Secure=false` ✓
- Public HTTPS prod: `SITE_URL=https://homekeep.example` → `Secure=true` ✓

## Bundled: Remember-me checkbox

Same commit adds a `rememberMe` checkbox to the login form (default checked). Plumbing:

- `cookieOptions(rememberMe: boolean = true)` — when false, omits `maxAge` so the browser drops the cookie on tab close (session cookie).
- `loginAction` reads `formData.get('rememberMe')`. `null` (absent, e.g. SDK/API login) or `'on'` (checkbox checked) → persistent. Any other value → session.
- `LoginForm` renders `<input type="checkbox" name="rememberMe" defaultChecked>` with a "Keep me signed in for 14 days" label.

Both fixes touch `cookieOptions()`, so shipping them together avoided two consecutive cookie-shape changes.

## Files changed

- `lib/actions/auth.ts` — `isSecureSite()` helper; `cookieOptions(rememberMe)` signature; `loginAction` reads `rememberMe`
- `components/forms/login-form.tsx` — `rememberMe` checkbox

## Verification

- `tests/e2e/v1.2-live-smoke.spec.ts` — full journey passes on `http://46.62.151.57:3000`
- Session persistence assertion: `/login` → `/h` redirect while cookie present (proves cookie survives a fresh page load)
- Hard logout via `ctx.clearCookies()` + re-login restores identical home + tasks
- Unit tests green: 672/672

## Commit

```
3215ca8  fix(auth): Secure cookie from SITE_URL + Remember Me
```

## REQ-IDs

- **PATCH2-01** ✓ — Auth cookie `Secure` derived from `SITE_URL` protocol
- **PATCH2-02** ✓ — Remember-me checkbox on login
