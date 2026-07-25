# `omada_status.py` — Omada local-API query tool

A small, dependency-light Python script that authenticates to a TP-Link
Omada SDN controller (the **OC200** at `192.168.0.101` in this network) over
its LAN-local HTTPS API and prints:

- **Connected clients** — name, IP, MAC, connection (SSID or wired), traffic
- **Managed devices** — gateway / switch / APs with model, IP, and status
- **Active alerts** — the controller's unarchived notifications

It is meant to be run **after** you are on the home network — either on-site
or, remotely, over the WireGuard VPN set up in
[`docs/omada-remote-access/`](../../docs/omada-remote-access/).

## Quick start

```bash
cd scripts/omada
python3 -m venv .venv && source .venv/bin/activate   # optional but tidy
pip install -r requirements.txt

cp .env.example .env          # then edit with your controller details
./omada_status.py             # full summary
```

Example output:

```
Controller: https://192.168.0.101:8043  site='Default'

=== Managed devices (4) ===
Name            Type     Model            IP             Status     Uptime
--------------  -------  ---------------  -------------  ---------  --------
Gateway         gateway  ER605 v2         192.168.0.1    CONNECTED  12d 4h
Core Switch     switch   SG2206MP         192.168.0.102  CONNECTED  12d 4h
Living Room AP  ap       EAP615-Wall      192.168.0.110  CONNECTED  9d 1h
Backyard AP     ap       EAP650-Outdoor   192.168.0.111  CONNECTED  9d 1h

=== Connected clients (18) ===
...

=== Active alerts (0) ===
  (none)
```

## Flags

| Flag         | Effect                                             |
|--------------|----------------------------------------------------|
| *(none)*     | Print devices, clients, and alerts                 |
| `--clients`  | Only connected clients                             |
| `--devices`  | Only managed devices                               |
| `--alerts`   | Only active alerts                                 |
| `--json`     | Emit raw structured JSON (pipe to `jq`)            |

```bash
# How many clients are on the guest SSID right now?
./omada_status.py --json | jq '[.clients[] | select(.ssid=="Guest")] | length'

# Are any managed devices not in a healthy CONNECTED state?
./omada_status.py --devices
```

## Configuration

All config is read from the environment; a sibling `.env` is auto-loaded if
[`python-dotenv`](https://pypi.org/project/python-dotenv/) is installed. See
[`.env.example`](./.env.example) for every variable. The important ones:

| Var               | Default           | Notes                                    |
|-------------------|-------------------|------------------------------------------|
| `OMADA_HOST`      | `192.168.0.101`   | OC200 LAN IP                             |
| `OMADA_PORT`      | `8043`            | Controller HTTPS port (some use `443`)  |
| `OMADA_USERNAME`  | —                 | **required**                            |
| `OMADA_PASSWORD`  | —                 | **required**                            |
| `OMADA_SITE`      | `Default`         | Site name from the controller UI         |
| `OMADA_VERIFY_TLS`| `false`           | `true`, `false`, or a path to a CA PEM   |

> **Use a least-privilege account.** Create a controller user with the
> **Viewer** role for this script rather than reusing your global/cloud
> admin. The script only reads.

## How it works (and the alternative)

This script uses the controller's built-in **v2 login API**
(`POST /{id}/api/v2/login` → session token in the `Csrf-Token` header). It
works on any OC200 firmware with just your admin credentials and needs no
provisioning. The flow and the official **Open API** alternative (OAuth-style
`client_id`/`client_secret`, more stable across upgrades) are documented in
[`docs/omada-remote-access/03-omada-local-api.md`](../../docs/omada-remote-access/03-omada-local-api.md).

## Security notes

- `.env`, `*.conf`, and key files in this folder are gitignored — keep it
  that way. Don't paste real credentials into commits or issues.
- TLS verification is **off by default** because the OC200 ships a
  self-signed cert. For anything beyond ad-hoc use, export the controller
  certificate and point `OMADA_VERIFY_TLS` at it.
- The API is only reachable on the LAN/VPN. Do **not** port-forward the
  controller's web UI to the internet to make this work — that's what the
  VPN is for.
