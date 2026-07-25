# 1. DDNS on the ER605

**Goal:** a stable hostname (e.g. `keiron-home.tplinkdns.com`) that always
points at the friend's current WAN IP, so the WireGuard client has a fixed
endpoint even when the ISP changes the IP.

Because the ER605 is adopted by the OC200, you configure DDNS **in the Omada
controller**, not on the router's standalone web page. You can do this from
the Omada cloud (`omada.tplinkcloud.com`) or the local controller
(`https://192.168.0.101`). The steps are identical.

> Menu paths differ slightly across Omada controller versions. The labels
> below match Omada SDN controller 5.x driving an ER605 on firmware 2.3.3.
> If a path is named differently, the keyword to look for is **"Dynamic
> DNS"**.

## Why DDNS first

WireGuard's client config needs an `Endpoint = host:port`. Residential WAN
IPs are dynamic, so hard-coding the current IP will break the tunnel the next
time the ISP renews the lease. DDNS gives you a name that auto-updates.

## Steps

### 1. Sign in to the controller

Cloud: <https://omada.tplinkcloud.com> → select this site.
Local: `https://192.168.0.101` (accept the self-signed cert warning).

### 2. Open Dynamic DNS settings

**Settings → Services → Dynamic DNS** → **Create New Dynamic DNS Entry**.

(On some 5.x builds it's **Settings → Wired Networks → Internet** with a
"Dynamic DNS" sub-section, or **Settings → Transmission → Dynamic DNS**.)

### 3. Choose a provider

Easiest is **TP-Link DDNS**, which is free and integrated:

| Field        | Value                                                       |
|--------------|-------------------------------------------------------------|
| Service      | **TP-Link** (a.k.a. TP-Link DDNS / `tplinkdns.com`)         |
| WAN          | The active WAN port (usually **WAN/LAN1** on the ER605)      |
| Domain Name  | Pick a label → becomes `yourlabel.tplinkdns.com`            |
| Status       | **Enable**                                                  |

TP-Link DDNS requires the controller be bound to a **TP-Link ID** (it is, if
the site is managed via Omada cloud — which it is here). Click **Register /
Get** to claim the hostname, then **Save**.

> Prefer not to use TP-Link's service? The ER605 also supports **No-IP**,
> **DynDNS**, and **Comexe**. Pick one, create the host on that provider's
> site, then enter the username/password/hostname here. Functionally
> identical for our purposes.

### 4. Verify it resolves

Give it a minute, then from your Mac:

```bash
# Should return the friend's current public WAN IP
dig +short keiron-home.tplinkdns.com

# Cross-check what the router actually sees as its public IP:
# (in the controller) Settings → ... or just compare to:
curl -s https://api.ipify.org   # run this ON the home network, on-site
```

The two should match. If `dig` returns nothing, the DDNS entry hasn't
updated yet — re-open the entry, confirm status is **Enabled** and bound to
the correct (active) WAN, and **Save** again to force an update.

### 5. Sanity-check it's not a private/CGNAT IP

Look at the resolved address. If it's in `10.0.0.0/8`, `100.64.0.0/10`
(CGNAT range), `172.16.0.0/12`, or `192.168.0.0/16`, the router does **not**
have a real public IP and inbound WireGuard will not work no matter what
DDNS says. Jump to the CGNAT section in
[`02-wireguard-er605.md`](./02-wireguard-er605.md#0-before-you-start-confirm-you-have-a-public-ip)
before going further.

## Result

You now have a stable name — `keiron-home.tplinkdns.com` in the examples —
that tracks the home's WAN IP. That name becomes the WireGuard `Endpoint` in
the next guide.

➡️ Continue to [2. WireGuard on the ER605](./02-wireguard-er605.md).
