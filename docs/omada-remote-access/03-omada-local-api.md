# 3. Omada local API + query script

**Goal:** once the [WireGuard tunnel](./02-wireguard-er605.md) is up, pull
connected clients, device status, and alerts from the OC200 at
`192.168.0.101` — interactively and from a script.

The deliverable script lives at
[`scripts/omada/omada_status.py`](../../scripts/omada/). This guide explains
the API it talks to, how auth works, and how to run it.

---

## Two APIs, and why we use the login API

The OC200 exposes two ways in:

| | **v2 login API** (this script) | **Open API** (official) |
|---|---|---|
| Auth | Username + password → session token | `client_id` + `client_secret` → OAuth token |
| Setup | None — just an account | Provision an app under Platform Integration |
| Stability | Endpoints can shift across major controller versions | Versioned, documented, upgrade-stable |
| Best for | Quick/local scripting with existing creds | Long-lived integrations |

We default to the **v2 login API** because it works on any OC200 firmware
with the credentials you already have. If you're building something durable,
switch to the Open API (see [below](#alternative-official-open-api)).

---

## The v2 login API flow

Base URL is the controller: `https://192.168.0.101:8043` (self-signed cert →
we skip TLS verification for LAN use; the script's `OMADA_VERIFY_TLS` lets
you pin a real cert).

1. **Discover the controller ID.** Omada 5.x prefixes every path with the
   controller's `omadacId`:
   ```bash
   curl -sk https://192.168.0.101:8043/api/info
   # -> {"result":{"controllerVer":"5.x.x","omadacId":"<CID>"}, "errorCode":0}
   ```
2. **Log in** and capture the CSRF token + session cookie:
   ```bash
   curl -sk -c cookies.txt \
     -H 'Content-Type: application/json' \
     -d '{"username":"apiviewer","password":"••••••"}' \
     https://192.168.0.101:8043/<CID>/api/v2/login
   # -> {"result":{"token":"<CSRF>"}, "errorCode":0}
   ```
   Subsequent calls send `Csrf-Token: <CSRF>` **and** the session cookie.
3. **Resolve the site id** (the UI shows the *name*, the API wants the *id*):
   ```
   GET /<CID>/api/v2/sites?currentPage=1&currentPageSize=1000
   ```
4. **Read data** (all under the site):
   | Data | Endpoint |
   |------|----------|
   | Clients | `/<CID>/api/v2/sites/<SITE>/clients?...&filters.active=true` |
   | Devices | `/<CID>/api/v2/sites/<SITE>/devices` |
   | Alerts  | `/<CID>/api/v2/sites/<SITE>/alerts?...&filters.archived=false` |
5. **Log out:** `POST /<CID>/api/v2/logout`.

Every response is `{"errorCode": 0, "msg": "...", "result": {...}}` — a
non-zero `errorCode` means failure. The script wraps all of this.

---

## Create a least-privilege account

Don't script with your global/cloud admin. In the controller:

**Settings → Admin / Roles → Add** a new account, e.g. `apiviewer`, with the
**Viewer** role scoped to this site. The script only reads, so Viewer is
enough. Put those credentials in the script's `.env`.

---

## Run the script

```bash
cd scripts/omada
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env: OMADA_HOST=192.168.0.101, OMADA_USERNAME=apiviewer, OMADA_PASSWORD=...

./omada_status.py            # devices + clients + alerts
./omada_status.py --clients  # just clients
./omada_status.py --json | jq '.devices[] | {name, status}'
```

The tunnel must be active first — the script talks to `192.168.0.101`, which
is only reachable over the VPN (or on-site). If you see a network error, its
hint reminds you to check the VPN. Full flag/config reference is in
[`scripts/omada/README.md`](../../scripts/omada/README.md).

### Example: alert on any unhealthy device

```bash
# Non-zero exit / output if any managed device isn't CONNECTED — drop into
# cron on a machine that stays connected to the tunnel.
./omada_status.py --json \
  | jq -e '[.devices[] | select(.status != 10 and .status != 11)] | length == 0' \
  > /dev/null || echo "⚠️  A device is offline — run omada_status.py --devices"
```

---

## Alternative: official Open API

For a durable integration, enable the Open API instead:

1. **Settings → Platform Integration → Open API** → **Add** an app. Choose
   **Client Credentials** (Viewer scope) and copy the `client_id` +
   `client_secret`.
2. Get a token:
   ```
   POST /openapi/authorize/token?grant_type=client_credentials
        { "omadacId": "<CID>", "client_id": "...", "client_secret": "..." }
   ```
3. Call versioned endpoints with `Authorization: AccessToken=<token>`, e.g.
   ```
   GET /openapi/v1/<CID>/sites/<SITE>/clients
   GET /openapi/v1/<CID>/sites/<SITE>/devices
   ```

The response envelope and data shapes mirror the v2 API, so adapting
`omada_status.py` is mostly swapping the `login()`/auth-header logic — the
`clients()` / `devices()` / `alerts()` parsing carries over. TP-Link
publishes the full Open API schema in the controller under the same Platform
Integration page.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `Network error talking to https://192.168.0.101:8043` | VPN not up, or wrong `OMADA_HOST`/`OMADA_PORT`. Try `curl -sk .../api/info`. |
| `could not read 'omadacId'` | Not a v5 controller, or hitting the wrong port. OC200 default is `8043`; some setups use `443`. |
| `errorCode=-1200` / login fails | Bad credentials, or the account lacks access to the site. |
| `site 'Default' not found` | Your site has a different name — set `OMADA_SITE` to the exact name in the controller's site picker. |
| TLS/cert error | Expected with the self-signed cert; leave `OMADA_VERIFY_TLS=false`, or pin the exported cert. |
| Works on-site, fails remote | You're testing on home Wi-Fi — the tunnel isn't actually carrying the traffic. Test from cellular. |

---

That's the full chain: **DDNS → WireGuard → local API → script.** From your
Mac, connect the tunnel and run `./omada_status.py` to see the friend's
network at a glance.
