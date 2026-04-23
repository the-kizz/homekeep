# Attack Surface — Static Analysis (HomeKeep)

Audit date: 2026-04-22 · Target: HomeKeep v1.1 master (Next.js 16 + PB 0.37 + Caddy, self-hosted PWA).

## Executive Summary

Overall posture is strong for a self-hosted hobby app. Sensitive writes are gated by PB collection rules (owner/member scoping via `home_members`), passwords go through PB auth (bcrypt), invite tokens are 192-bit `randomBytes`, cookies are HttpOnly/SameSite=Lax, `safeNext()` closes the obvious open-redirect vector, and filter injection has been largely neutralised via `pb.filter()` param binding. The remaining risks cluster around (1) residual template-literal PB filters in Server Components and a few server actions, (2) missing HTTP security headers (no CSP, HSTS, X-Frame-Options, Permissions-Policy — both internal Caddyfile and `next.config.ts` ship zero headers), (3) PB admin UI `/_/` exposed on the public port by default, and (4) some soft-mass-assignment edges around `home_members` and `schedule_overrides` create paths.

Severity breakdown: **0 critical · 4 high · 6 medium · 5 low · 6 informational/hardening**. No exploitable remote code execution, auth bypass, or IDOR found in this pass; everything below is either defence-in-depth gaps or hardening items.

## Scope

Read in full: `app/` routes (public + `(app)` + `api/`), `lib/actions/*.ts`, `lib/membership.ts`, `lib/pocketbase-server.ts`, `lib/pocketbase-admin.ts`, `lib/invite-tokens.ts`, `lib/notifications.ts`, `lib/ntfy.ts`, `lib/schedule-overrides.ts`, `lib/scheduler.ts` (through line 260), all `pocketbase/pb_migrations/*.js`, all `pocketbase/pb_hooks/*.js`, `docker/Dockerfile`, `docker/Caddyfile`, `docker/Caddyfile.prod`, `docker/docker-compose*.yml`, `proxy.ts`, `next.config.ts`, `.gitignore`, `.env.example`. Spot-checked `components/*.tsx` via `dangerouslySetInnerHTML`/`innerHTML` grep + `invite-link-card`, `task-detail-sheet` read. Not read in full: every `components/` file (React auto-escape coverage assumed and spot-verified), `tests/*` (out of scope), `lib/*` pure compute modules, third-party dependency tree.

## Findings (severity-ordered)

### CRITICAL

_None identified in static review._ (Caveat: see MEDIUM findings flagged "needs manual pentest" — e.g. `home_members.createRule` could produce an unauthorised self-join if an attacker convinces PB that `home_id.owner_id = @request.auth.id` holds for a crafted path; needs live probe.)

---

### HIGH

#### F-01: No HTTP security headers anywhere (no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- **Location:** `docker/Caddyfile`, `docker/Caddyfile.prod`, `next.config.ts`
- **Evidence:** Grep across the repo returns zero `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Permissions-Policy`, or `X-Content-Type-Options` response headers. `next.config.ts` has no `headers()` export. The internal `Caddyfile` is purely a reverse-proxy without a `header` directive. `Caddyfile.prod` likewise. The only referrer defence is a JSDoc comment claiming a global `<meta name="referrer" content="no-referrer">` is set in app layout — **but grep confirms it is NOT actually set in `app/layout.tsx`**, contradicting the comment at `app/(public)/invite/[token]/page.tsx:27-30`.
- **Impact:** Full XSS blast radius (no CSP to blunt a stray reflected injection); clickjacking (no frame-ancestors / X-Frame-Options so `/h/*` routes can be iframed and DoubleClick'd); MIME-sniffing; and invite URLs leak via `Referer` to any outbound link clicked from `/invite/TOKEN` (T-04-02-04 is unmitigated in practice).
- **CVSS-ish:** ~6.5 (AV:N/AC:L/PR:N). Material for the LAN-okay/public-risky split below.
- **Fix:** Add a `headers()` export in `next.config.ts` that sets at minimum: `Content-Security-Policy` (script-src 'self' + nonce, object-src 'none', frame-ancestors 'none'), `Strict-Transport-Security: max-age=63072000; includeSubDomains` (conditional on the Caddy-with-HTTPS variant), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (globally, not just on `/invite/*`), `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Also actually add the `<meta name="referrer">` tag the comment promises — or drop the comment.

#### F-02: PB Admin UI `/_/` proxied to public port 3000 with no gate
- **Location:** `docker/Caddyfile:17-21`
- **Evidence:**
  ```
  handle /_/* {
      reverse_proxy localhost:8090 { flush_interval -1 }
  }
  ```
  The `(app)` route guard in `proxy.ts:50-52` explicitly excludes `api` prefix but not `_`; the Caddyfile matches `/_/*` and proxies straight to PB's admin. That admin UI presents a superuser login at `http://46.62.151.57:3000/_/` on the production VPS noted in the user's memory.
- **Impact:** Attackers can brute-force the superuser credentials against a public endpoint. PB's bootstrap rate limiter (`bootstrap_ratelimits.pb.js:44-56`) caps `*:authWithPassword` at 60/60s — meaningful for password sprays but not fatal for a targeted credential-stuffing run with breach lists. If `PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD` are weak or reused, full database takeover + arbitrary cross-home reads/writes.
- **CVSS-ish:** ~7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L), assuming public IP deploy.
- **Fix:** Either (a) bind `/_/*` behind Caddy basic auth (`basicauth` directive) in `Caddyfile.prod`, (b) restrict by client IP (Caddy `@trusted` matcher + `remote_ip`), or (c) drop the `/_/*` route entirely on the public Caddyfile and require operators to use `tailscale` or SSH tunnel. The docs should make this explicit. At minimum, document the exposure in SPEC/README.

#### F-03: Template-literal PB filters still pervade Server Components and two server actions
- **Location:** 
  - Server Components (many): `app/(app)/layout.tsx:68`, `app/(app)/h/page.tsx:44`, `app/(app)/h/[homeId]/page.tsx:67,90,104`, `app/(app)/h/[homeId]/members/page.tsx:33`, `app/(app)/h/[homeId]/history/page.tsx:78,100,117`, `app/(app)/h/[homeId]/by-area/page.tsx:66,72`, `app/(app)/h/[homeId]/person/page.tsx:77,101,123`, `app/(app)/h/[homeId]/areas/page.tsx:38`, `app/(app)/h/[homeId]/areas/[areaId]/page.tsx:56`, `app/(app)/h/[homeId]/onboarding/page.tsx:50`, `app/(app)/h/[homeId]/tasks/new/page.tsx:44,57`, `app/(app)/h/[homeId]/tasks/[taskId]/page.tsx:49,60`.
  - Server actions: `lib/actions/seed.ts:79`, `lib/actions/areas.ts:82`.
  - Library: `lib/scheduler.ts:166,210,313,319`.
- **Evidence:** e.g. `filter: \`home_id = "${homeId}"\`` — `homeId` is a Next.js route param. The codebase has a project-wide convention (enforced in newer phases per `.planning/phases/*/REVIEW.md`) to use `pb.filter('home_id = {:hid}', { hid: homeId })` instead.
- **Impact:** `homeId`, `userId`, `areaId`, and `taskId` reach the filter via Next.js routing or the trusted authStore — so today this is NOT exploitable (route params for 15-char PB IDs don't survive a `"` or `\` unless Next.js lets them through). HOWEVER: (a) any refactor that pipes user input into these paths (e.g. a future search or filter UI on history/areas) will plant an injection foothold next to known-safe siblings, and reviewers have already missed this twice (`17-REVIEW.md:49-59` caught it once; others slipped by); (b) `lib/scheduler.ts` runs under a **superuser admin client** (`createAdminClient()`), which means ANY filter injection from the scheduler side bypasses PB's rules entirely — severity here is amplified. `homeId` in `fetchHomeMembers` and the main loop comes from the admin-read homes list, so still trusted, but the blast radius on a future bug is cross-tenant.
- **CVSS-ish:** ~4.5 today (defence-in-depth gap, not currently exploitable). Would promote to CRITICAL if user-controlled strings get added.
- **Fix:** Mechanical refactor — replace every remaining template-literal `filter:` with `pb.filter('... = {:k}', {k:v})`. Add an ESLint rule (custom or via `no-restricted-syntax`) that flags `filter:` property values containing a template literal in files under `app/` and `lib/`. The convention already exists (`lib/schemas/home.ts:36`, `lib/membership.ts:37`, etc.) — mechanically extend it. Priority on `lib/scheduler.ts` since it runs as superuser.

#### F-04: `schedule_overrides.createRule` does not enforce `@request.body.created_by_id = @request.auth.id`
- **Location:** `pocketbase/pb_migrations/1745280000_schedule_overrides.js:62`
- **Evidence:**
  ```js
  createRule: memberRule, // D-04: NO body-check
  ```
  — any member of the home can create an override attributing `created_by_id` to any user id of their choosing. Compare the `completions` collection (`1714867200_completions.js:38`) which explicitly adds `&& @request.body.completed_by_id = @request.auth.id`.
- **Impact:** Audit-trail forgery. A household member can create a snooze override and attribute it to another member, or to a deleted user. Since `snoozeTaskAction` (`lib/actions/reschedule.ts:112`) always sets `created_by_id: userId` (server-derived), the happy path is safe — but a direct PB REST POST from a member's auth token can forge. For a household-trust-boundary app this is low-severity repudiation, not EoP; still, the stated convention at completions migration line 38 is broken here.
- **CVSS-ish:** ~3.5 (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N).
- **Fix:** Add `&& @request.body.created_by_id = @request.auth.id` to the `createRule` (migration change). Add a negative integration test: authed PB client tries to POST an override with mismatched `created_by_id` → expect 403.

---

### MEDIUM

#### F-05: `home_members` creation is "owner of the referenced home" — not defense-in-depth for self-join via acceptInvite path
- **Location:** `pocketbase/pb_migrations/1714953600_home_members.js:41`
- **Evidence:**
  ```
  createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id'
  ```
  The `acceptInvite` server action uses `createAdminClient()` (superuser) to bypass this rule, which is correct per the invite flow. But this means: a regular authed PB client with an invitee's token **cannot** self-join even in a valid invite-accept flow without the admin escalation — the admin escalation is load-bearing. If `PB_ADMIN_EMAIL/PASSWORD` is ever misconfigured, `acceptInvite` errors out cleanly (`lib/actions/invites.ts:127`). But the module-level cached admin client (`lib/pocketbase-admin.ts:29-51`) lives in the Next.js process memory for 30 minutes — if a request handler bug ever leaks `admin` into a client response body (it currently doesn't), full superuser takeover. No leak found today; flag for future review.
- **Impact:** Needs manual pentest. Per static read, the admin client is not exposed; but any future `return { ok: true, pb: admin }` style mistake would be catastrophic.
- **CVSS-ish:** ~4.0 conditional on future bug.
- **Fix:** Add a process-memory scrub pass to admin-client lifecycle: never return `admin` directly from a server action, wrap in a `using` / narrow scope. Document the rule prominently in `lib/pocketbase-admin.ts` (it already says "NEVER expose through a client component" at line 11 — expand to cover return-value leakage).

#### F-06: `invites.updateRule = null` plus admin-client update path bypasses all row-level checks on accept
- **Location:** `pocketbase/pb_migrations/1714953601_invites.js:30`, `lib/actions/invites.ts:178-202`
- **Evidence:** The invite is marked `accepted_at` / `accepted_by_id` through the admin client. The server action correctly sets `accepted_by_id: authId` from the authed session. If a future author adds an alternative update path (e.g. "cancel my pending accept"), the lack of an `updateRule` expression means there's nothing in the DB layer to catch a mistake — full reliance on server-action discipline.
- **Impact:** Defence-in-depth gap. Not exploitable today.
- **CVSS-ish:** ~3.0.
- **Fix:** Even though the happy path runs under admin, tighten `updateRule` to `home_id.owner_id = @request.auth.id` so regular authed clients get 403 and superuser (admin client) is the only write path.

#### F-07: `proxy.ts` auth gate is a cookie-presence check only; forged cookie >10 chars passes the middleware
- **Location:** `proxy.ts:28`
- **Evidence:**
  ```
  const isAuthed = !!pbAuth && pbAuth.length > 10;
  ```
  No signature verification. A malformed cookie longer than 10 chars passes the proxy and triggers `(app)/layout.tsx:30` which does `pb.authStore.isValid` — which itself just decodes the cookie locally and checks the token's JWT signature claim **without** round-tripping to PB. `createServerClient()` does not call `authRefresh` (only `createServerClientWithRefresh()` does, and per grep nothing in the active codebase calls it). Server Components thus render trusting a JWT payload whose signature has never been verified server-side.
- **Impact:** An attacker who obtains a legitimate user's cookie value (XSS being defused by HttpOnly, but network sniffing on HTTP-LAN, logs, browser debug, etc.) gets a window until expiry where every PB call is made with the stolen token. This is standard bearer-token semantics — not a HomeKeep bug per se, but the documentation (`proxy.ts` JSDoc) oversells: "forged or expired cookie that reaches a Server Component will fail the first pb.collection().getList()". That's only true if the token's signature is invalid — an expired-but-correctly-signed token does fail PB, but a correctly-signed still-live token from any compromised cookie is indistinguishable from the real user.
- **CVSS-ish:** ~4.0 (AV:N/AC:H). Matches the general risk of pre-Secure-cookie HTTP deploys.
- **Fix:** On the `(app)` layout, call `createServerClientWithRefresh()` instead of `createServerClient()` so every authed page render performs a lightweight `authRefresh()` against PB — this collapses stolen-token windows when tokens are revoked server-side. Cost is one extra PB round-trip per navigation; for a self-hosted app this is trivial. Also: bump `Secure` to always-on (not just `NODE_ENV === 'production'`) and document the LAN-HTTP caveat plainly.

#### F-08: Next.js 16 Server Actions — CSRF posture not verified
- **Location:** All `'use server'` functions (35+ files matched).
- **Evidence:** Next.js 15+ Server Actions include a built-in Origin/Host check and (in 14.1+) a random encoded action ID per build. Next 16 retains this but the protection is behind the `serverActions.allowedOrigins` config and `experimental.serverActions.allowedForwardedHosts` — neither is set in `next.config.ts`. Default Next 16 behaviour rejects cross-origin Server Action POSTs (Origin !== Host), but this relies on Caddy not rewriting Host. The baseline `docker/Caddyfile:6-26` uses `reverse_proxy` without `header_up Host {host}` — Caddy's default DOES pass through the client Host header, so the check works. The Caddy sidecar variant `Caddyfile.prod:12` does the same. OK today. Fragile under operator misconfig.
- **Impact:** If an operator adds a proxy that mangles Host (e.g. fronts HomeKeep behind Cloudflare without proper host forwarding), Server Action CSRF protection silently regresses.
- **CVSS-ish:** ~3.5 conditional.
- **Fix:** Pin `serverActions.allowedOrigins` in `next.config.ts` to the `SITE_URL` domain. Add a doc line to README's deploy section about preserving Host headers.

#### F-09: Scheduler fetch paths run as superuser and emit task names in ntfy notifications — cross-household leak possible via topic collision
- **Location:** `lib/scheduler.ts:195-248`, `lib/ntfy.ts:60-85`
- **Evidence:** Scheduler loops every home, every task, builds body lines like `Your {homeName} {taskName} is overdue...` and POSTs them to the user-configured `ntfy_topic`. Topic is validated `^[A-Za-z0-9_-]{4,64}$` (`lib/ntfy.ts:47`) which is correct URL-safety, but — crucially — ntfy topics are **globally unique across ntfy.sh** and anyone who knows or guesses a topic can subscribe. Short topics (4 chars — e.g. `alex`) are trivially enumerable; longer ones still risk collision with an unrelated user.
- **Impact:** Household maintenance data (task names, home names) leaks to anyone subscribed to the same topic. A user who picks `alice` as a topic will broadcast their "vacuum bedroom" to every subscriber of that topic. No PII leaves the server if the user picks a strong topic, but the UI/docs don't warn.
- **CVSS-ish:** ~4.0 (information disclosure).
- **Fix:** (a) Bump the minimum topic length to 16 chars in `lib/ntfy.ts:47` and the Zod schema in `lib/schemas/notification-prefs.ts`; (b) Add an inline help text on the Person notification form reading "Use a unique, unguessable string — ntfy topics are public-by-default"; (c) Document the self-host ntfy option in README for privacy-conscious operators.

#### F-10: Admin API `/api/admin/run-scheduler` is length-checked but not constant-time compared
- **Location:** `app/api/admin/run-scheduler/route.ts:40-45`
- **Evidence:**
  ```ts
  if (provided !== token) { ... unauthorized ... }
  ```
  Plain `!==` on the string — timing oracle. With a 32+ char token over the internet, exploiting is hard but not impossible (see the Rails `secure_compare` history).
- **Impact:** Theoretical byte-at-a-time token disclosure. Low practical probability against a modern Node runtime over the internet.
- **CVSS-ish:** ~2.5.
- **Fix:** Use `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token))` with length preamble, OR hash both sides with SHA-256 and compare the hashes.

---

### LOW

#### F-11: `safeNext()` allows any path starting with `/` (no path-prefix allowlist), so a future route rename could make it less safe
- **Location:** `lib/actions/auth.ts:62-69`
- **Evidence:** `safeNext` rejects `//evil.com`, `http://x`, and empties. But `/@elsewhere.com/` or a Next.js catch-all route that reflects params could bounce auth'd users anywhere inside the app.
- **Impact:** Not exploitable today; defence-in-depth gap.
- **Fix:** Replace `startsWith('/')` + `!startsWith('//')` + `!includes('://')` with a positive allow-list of path prefixes (`/h`, `/invite`, `/settings`). Document why.

#### F-12: Fetching `/h` uses owner-only homes list — Phase 4 multi-member swap left it behind
- **Location:** `app/(app)/h/page.tsx:43-47`
- **Evidence:** `filter: \`owner_id = "${userId}"\`` — the Phase-2 owner query. `(app)/layout.tsx:67` correctly uses the `home_members` join. The `/h` landing page will redirect to a home via last-viewed logic, but if `last_viewed_home_id` is null and the user is a member (not owner) of any home, that home won't appear here — UX bug rather than security issue today, but because the filter still uses the template-literal pattern it slid into F-03's list too.
- **Impact:** UX + F-03 propagation.
- **Fix:** Swap to the `home_members`-by-user query used in `(app)/layout.tsx`, with `pb.filter()`. Phase-4 alignment.

#### F-13: `scheduler.ts:195` admin-reads ALL homes with no filter — if the admin cache leaks, full tenant enumeration
- **Location:** `lib/scheduler.ts:195-213`
- **Evidence:** `pb.collection('homes').getFullList({ fields: 'id,name,timezone' })` — enumerates every household in the database. Required for the scheduler's design, but compounds the admin-client risk per F-05.
- **Impact:** Conditional on admin-client exposure.
- **Fix:** Leave as-is but add the scrub-pass discipline noted in F-05.

#### F-14: Completion `notes`, task `name`/`description`/`notes`, area `name`, home `name`/`address` — no output sanitisation, only React auto-escape
- **Location:** Rendering in `components/task-detail-sheet.tsx:189`, `app/(app)/h/[homeId]/page.tsx`, etc.
- **Evidence:** Grep confirmed **zero** uses of `dangerouslySetInnerHTML` outside JSDoc comments and `.planning/` docs. React's default text-node escape is doing all the work. Task `description` is defined as `EditorField` in PB (migration `1714780800_init_homekeep.js:125`) which PB typically serialises as HTML — if the description is ever rendered via `dangerouslySetInnerHTML` in a future UI (e.g. a rich-text viewer), XSS reappears.
- **Impact:** Not exploitable today.
- **Fix:** When Phase N adds rich-text rendering, use a sanitiser like `DOMPurify` server-side before storage or at render. Do NOT rely on PB's editor-field output being safe.

#### F-15: Build artefact `.next/standalone/.env` exists in the working tree
- **Location:** `.next/standalone/.env`
- **Evidence:** `Glob: .env*` returned this. The file is inside `.next/` which is `.gitignore`d (`/.next/`), so it's not committed — but it's a copy of the real `.env` that Next.js standalone mode inlines into the build output for runtime reading. If a Dockerfile ever `COPY .next` without excluding `.env`, the production image ships real secrets. The current `docker/Dockerfile:87` copies `.next/standalone` which **may** include this file — worth verifying at build time.
- **Impact:** Secret leak if Dockerfile grows wrong.
- **Fix:** Add `.env` and `.env.*` to `.dockerignore` (already exists at repo root — verify it covers these). Add a CI check that `docker build` output does not contain `/app/.env`.

---

### INFORMATIONAL / HARDENING

#### H-01: ADMIN_SCHEDULER_TOKEN enforced minimum is 32 chars — OK. Good pattern.
Keep as-is. Consider adding a hex/base64 format check to block whitespace-only tokens.

#### H-02: PB rate-limit coverage
`bootstrap_ratelimits.pb.js:44-56` covers `*:authWithPassword` (60/60s) and `/api/` (300/60s, `@guest`). **Missing:** `/_/` (admin), `*:requestPasswordReset` (currently falls into the 300/60s bucket — which is too lax for password-reset spam if SMTP is configured), invite-accept (no specific rule; depends on general `/api/` bucket). Add targeted rules once F-02 is closed so admin-UI brute force is specifically rate-limited.

#### H-03: Invite token strength is excellent (192 bits, UNIQUE index, 20-64 char schema enforcement at action + page + migration levels). No change.

#### H-04: PB auth cookie is HttpOnly + SameSite=Lax. Missing `Secure` on non-prod — LAN-HTTP intentional per code comments. When an operator deploys behind Caddy-HTTPS the cookie will be transmitted over HTTP if `NODE_ENV` isn't `production` (rare). Enforce `Secure: true` unconditionally when `SITE_URL` starts with `https://`.

#### H-05: `createAdminClient()` caches the authed superuser for 30 minutes in module memory. Good for rate-limits, bad for blast radius on process compromise. Consider rotating on a shorter TTL or on every fresh import. Low priority.

#### H-06: `components/forms/*` (login, signup, reset-request, reset-confirm) — I did not read each; spot-check the RHF wiring relies on zodResolver. The actions re-parse server-side. No XSS vectors via form errors (messages are literal strings).

---

## Top concerns for public-facing deployment

If this app goes public-Internet (beyond LAN + Tailscale), the **must-fix-first** list in order is:

1. **F-02 PB admin UI exposure** — the single biggest target on the public port. Fix before announcing a URL.
2. **F-01 security headers** — add CSP (script-src 'self' + nonce, frame-ancestors 'none'), HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Matters more on public deploys.
3. **F-07 cookie validation** — move to `createServerClientWithRefresh()` in the authed layout so stolen-token windows shrink to PB's refresh rate.
4. **F-09 ntfy topic collision** — add a 16-char minimum and public-topic warning in the UI before households broadcast to `alice`.
5. **F-08 CSRF Origin pinning** — explicitly set `serverActions.allowedOrigins` once SITE_URL is known, so misconfigured reverse proxies can't regress.
6. **F-15 dockerignore** — belt-and-braces verify that `.next/standalone/.env` never leaks into an image or GHCR push.

Items acceptable for LAN-only or Tailscale-only: F-01 (partially), F-02 (admin UI behind tailnet is fine), F-07 (shorter stolen-token window matters less when only family has LAN access), F-09 (same).

## Next steps

Red-team pentester probe list (ordered by expected ROI):

1. Hit `http://<host>:3000/_/` and confirm the PB admin login page is reachable; run hydra/medusa against `PB_ADMIN_EMAIL` with a breached-password list.
2. POST a forged `schedule_overrides` row directly via PB REST with `created_by_id` set to another household member's id (F-04). Expect this to SUCCEED today; fix validates as failure.
3. Manually forge a PB filter injection payload in any route param that flows into `app/(app)/h/[homeId]/*` pages — today the 15-char Next.js validator likely blocks, but worth confirming with a path-traversal or quote-injection probe.
4. Subscribe to `ntfy.sh/alice` in the browser and wait for a real user to set that as their topic (F-09 evidence).
5. Time-attack `/api/admin/run-scheduler` with a known-length wrong token vs. a prefix-matching wrong token — observe nanosecond differences in response latency (F-10).
6. Try to iframe `/h/{homeId}` from an external origin — currently allowed (F-01 frame-ancestors missing). Chain with a social-engineering UI-redress to trigger a completion via clickjacking.
7. Send a Server Action POST from an external Origin with a spoofed `Host` header (F-08) — Next 16 should block by default; verify under the real Caddy deployment (baseline + caddy-sidecar + tailscale variants all).
8. Review whether a compromised member of Home A can enumerate Home B's task names via the scheduler's admin-client reads if any error path leaks them into a response (F-05/F-13 combined).

End of report.
