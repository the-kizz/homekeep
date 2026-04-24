# Email setup for the-kizz.com

Goal: receive mail at `security@the-kizz.com`, `kizz@the-kizz.com`,
and per-project addresses, **and reply from those addresses so your
real email never leaks**.

Chosen solution: **Zoho Mail free tier + Gmail "Send mail as"**.

Why this combo (vs. pure forwarding, alias services, or paid):
- Forwarding-only (ForwardEmail, Cloudflare) can't reply as the alias
  without paid tiers — replies leak your real address.
- Alias services with reply-cloak (SimpleLogin, AnonAddy) are great
  but custom-domain support is paid on both as of 2026.
- Zoho Mail free: 5 mailboxes/aliases on custom domain, full IMAP +
  SMTP, API for automation, works with GoDaddy DNS.
- Gmail's "Send mail as" feature: when composing a reply in a
  `@the-kizz.com` thread, Gmail auto-picks the `@the-kizz.com`
  identity. **You cannot accidentally reply from your personal
  address** — Gmail picks From by thread context.

---

## One-time setup (operator, ~20 min)

### 1. Zoho account

1. Sign up at <https://www.zoho.com/mail/zohomail-pricing.html>
   (pick "Forever Free Plan", Mail Lite 5GB × 5 users).
2. Add `the-kizz.com` as a custom domain.
3. Zoho shows a verification TXT record → add it in GoDaddy
   (or via API — see section 2 below).
4. After verification, Zoho shows MX + SPF + DKIM records → add
   those too.

### 2. DNS records via GoDaddy API

All records go to `the-kizz.com`. We already have GoDaddy creds at
`/srv/homekeep/.env` (or `/etc/secrets/godaddy.creds` once root
centralizes them).

Zoho will give you exact values during signup. Shape:

| Type | Name | Value | TTL |
|---|---|---|---|
| MX | `@` | `mx.zoho.com` (priority 10) | 3600 |
| MX | `@` | `mx2.zoho.com` (priority 20) | 3600 |
| MX | `@` | `mx3.zoho.com` (priority 50) | 3600 |
| TXT | `@` | `v=spf1 include:zoho.com ~all` | 3600 |
| TXT | `zmail._domainkey` | (DKIM key from Zoho) | 3600 |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:admin@the-kizz.com` | 3600 |

**API automation (once Zoho gives you the TXT values):**
```bash
. /srv/homekeep/.env
DOMAIN=the-kizz.com

# MX records — 3 of them
curl -sS -X PUT \
  -H "Authorization: sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d '[
    {"data":"mx.zoho.com","priority":10,"ttl":3600},
    {"data":"mx2.zoho.com","priority":20,"ttl":3600},
    {"data":"mx3.zoho.com","priority":50,"ttl":3600}
  ]' \
  "https://api.godaddy.com/v1/domains/$DOMAIN/records/MX/%40"

# SPF TXT (replaces @ TXTs — double-check GoDaddy doesn't already have other TXTs at @ before running)
# Safer pattern: GET existing, merge, PUT back.
```

**Safer SPF/DKIM pattern** (adds to existing TXTs instead of replacing):
```bash
# Fetch existing TXT records at @
EXISTING=$(curl -sS -H "Authorization: sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}" \
  "https://api.godaddy.com/v1/domains/$DOMAIN/records/TXT/%40")
# Manually merge the Zoho SPF into the existing array, then PUT.
```

### 3. Zoho mailbox / alias layout

Option A — **one mailbox, multiple aliases** (simplest; 1 of 5
free-tier users used):
- Primary: `admin@the-kizz.com`
- Aliases (added to `admin` in Zoho console): `security@`, `kizz@`,
  `hello@`, `abuse@`, `homekeep@`
- All inbound to any alias lands in `admin`'s inbox

Option B — **distinct mailboxes** (better separation; uses multiple
of the 5 free users):
- `security@` — separate mailbox
- `kizz@` — separate mailbox
- `homekeep@` — separate mailbox
- Forwarding rules in each to your personal inbox

**Recommend Option A** unless you expect heavy traffic on any one
alias. Simpler to manage; Gmail's Send-As handles the identity
switching anyway.

### 4. Zoho → forward to your real inbox

In Zoho Mail settings:
- **Mail Forwarding** → `your-real@gmail.com`
- **Keep a copy** → yes (so Zoho has the audit trail if Gmail loses a
  message).

### 5. Gmail "Send mail as"

Gmail → Settings → See all settings → **Accounts and Import** →
**Send mail as** → **Add another email address**.

For each `@the-kizz.com` alias (or just `admin@the-kizz.com` if
you're using Option A):

1. Email address: `<alias>@the-kizz.com`
2. Uncheck "Treat as an alias" (so From-address stays literally
   `<alias>@the-kizz.com`, not rewritten).
3. SMTP server: `smtp.zoho.com`
4. Port: `587`
5. Username: your Zoho account email
6. Password: Zoho app-specific password (generate in Zoho → Security)
7. TLS: yes (Zoho recommends TLS on 587)
8. Gmail sends a verification email → click the link from within Zoho
   webmail (since it'll arrive at the alias, which Zoho delivers to
   your primary Zoho inbox).
9. Set the new identity as **Reply from the same address the message
   was sent to** (radio button, top of the Send-As section).

After that, **every reply you send from a `@the-kizz.com` thread goes
out with the `@the-kizz.com` From header automatically.** Gmail picks
the right identity based on the incoming message's To: address.

### 6. Update SECURITY.md

Replace the placeholder in `SECURITY.md`:
```diff
-security@homekeep.example
+security@the-kizz.com
```

---

## Verification

1. **From an external account**, send mail to `security@the-kizz.com`.
   Should land in your Gmail inbox within ~30 seconds.
2. **Reply from Gmail.** The External recipient should see the reply
   as-coming-from `security@the-kizz.com`, with SPF pass and DKIM pass
   on any modern mail client (Gmail recipient "show original" →
   SPF/DKIM both `pass`).
3. **Check mail-tester.com** (free): send to their generated address,
   check score. Should be 10/10 once DKIM + SPF + DMARC propagate.

---

## Per-project alias additions (future)

Once the setup is live, adding `projectfoo@the-kizz.com` is:
1. Zoho console → Settings → Mail Accounts → primary account →
   Email Aliases → add `projectfoo@the-kizz.com`
2. No DNS change needed — MX already covers all of `@the-kizz.com`
3. Optionally add to Gmail Send-As for reply-from-alias behavior

Zoho has a REST API (<https://www.zoho.com/mail/help/api/>) for
programmatic alias management. If we do more than a handful, wire up
a `scripts/add-email-alias.sh` that takes an alias name and creates
it via the API.

---

## Rotation / offboarding

- **Rotate Zoho app-specific password** quarterly — it's in Zoho's
  Security page. After rotation, update the Gmail Send-As SMTP
  password for each identity.
- **If you ever lose the Zoho account:** MX records still point at
  Zoho. You'd need to either re-sign-up Zoho (free tier will accept
  the domain again after deletion) or swap MX records to a different
  provider. Keep Gmail as the read inbox so mail isn't lost during
  a provider migration.
