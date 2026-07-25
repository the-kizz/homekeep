# Omada remote access — manage & query a home network from afar

Step-by-step setup for securely reaching and programmatically querying a
TP-Link Omada home network from a remote Mac. The end state:

1. A **stable hostname** for the site via DDNS on the ER605.
2. A **WireGuard VPN** terminating on the ER605, so your Mac joins the LAN.
3. **Read access to the Omada local API** over that tunnel.
4. A **Python script** ([`scripts/omada/omada_status.py`](../../scripts/omada/))
   that returns clients, device status, and alerts.

This is a self-contained ops runbook that happens to live in the HomeKeep
repo (alongside the existing `docs/vps-setup/` infra notes). It is unrelated
to the HomeKeep application itself.

## The network

| Device              | Role                          | Address           |
|---------------------|-------------------------------|-------------------|
| TP-Link ER605 v2    | Gateway / router (Omada 2.3.3)| `192.168.0.1`     |
| TP-Link OC200       | Hardware controller           | `192.168.0.101`   |
| TP-Link SG2206MP    | PoE switch                    | `192.168.0.102`   |
| 2× EAP615-Wall      | Access points                 | DHCP              |
| 1× EAP650-Outdoor   | Access point                  | DHCP              |

All devices are adopted by the OC200 and managed via the Omada cloud at
`omada.tplinkcloud.com`. The ER605 is the WireGuard endpoint; the OC200 is
the API target.

## Read these in order

| # | Guide | What it does |
|---|-------|--------------|
| 1 | [`01-ddns-er605.md`](./01-ddns-er605.md) | Stable hostname (`*.tplinkdns.com`) so the VPN endpoint survives IP changes |
| 2 | [`02-wireguard-er605.md`](./02-wireguard-er605.md) | WireGuard server on the ER605 + Mac client config |
| 3 | [`03-omada-local-api.md`](./03-omada-local-api.md) | The OC200 local API, auth flow, and the query script |

## Prerequisites & the one hard requirement

- Admin access to the Omada controller (cloud or local) — ✅ you have this.
- Temporary on-site/LAN access for initial setup — ✅ you have this.
- WireGuard installed on the Mac — ✅ (`brew install wireguard-tools` for the
  CLI, or the **WireGuard** app from the Mac App Store for a GUI).
- **A reachable public IP on the ER605's WAN.** This is the one thing you
  can't configure around. If the friend's ISP uses **CGNAT** (carrier-grade
  NAT — common on mobile/4G/5G and some fibre plans), inbound WireGuard will
  not reach the router and DDNS alone won't fix it. **Verify this first** —
  see the CGNAT check in [`02-wireguard-er605.md`](./02-wireguard-er605.md#0-before-you-start-confirm-you-have-a-public-ip).
  If they're behind CGNAT, the fallback is an outbound-only overlay
  (Tailscale on a LAN host, or a cheap VPS as a WireGuard relay) — noted at
  the end of guide 2.

## Security posture (read this once)

- **VPN in, nothing else.** The only thing exposed to the internet is the
  single WireGuard UDP port. The Omada web UI / API is **never**
  port-forwarded — you reach it only after the tunnel is up.
- **Split tunnel by default.** Only `192.168.0.0/24` is routed over the VPN,
  so your Mac's normal internet traffic is untouched. Easy to switch to
  full-tunnel if you want all traffic to egress via the home connection.
- **Least privilege for the API.** The query script uses a dedicated
  **Viewer**-role controller account, not your global admin.
- **Keys and creds stay local.** WireGuard private keys never leave the
  device that generated them; the script's `.env` is gitignored.

Since this is a friend's network, agree up front on what you're allowed to
access and change, and let them know the VPN exists.
