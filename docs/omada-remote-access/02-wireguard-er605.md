# 2. WireGuard VPN on the ER605

**Goal:** a WireGuard server on the ER605 that your Mac dials into, putting
your Mac on the home LAN so you can reach `192.168.0.0/24` — including the
OC200 at `192.168.0.101` — as if you were on-site.

We use **split tunnel**: only `192.168.0.0/24` (and the tunnel subnet) is
routed over the VPN. Your Mac's normal browsing keeps using its own
internet. To send *all* traffic through the home connection instead, see
[Full tunnel](#optional-full-tunnel) at the end.

---

## 0. Before you start: confirm you have a public IP

WireGuard needs an **inbound** UDP connection to the router, which requires
a real public IP on the WAN. Check it:

1. On-site (or over any existing remote access), find the router's WAN IP in
   the controller: **Settings → Internet** (or the dashboard's WAN tile).
2. Compare it to the address seen from the public internet:
   ```bash
   dig +short keiron-home.tplinkdns.com     # from guide 1
   ```
3. **They must match and must be a public IP.** If the WAN IP is in a private
   or CGNAT range (`10.x`, `100.64–100.127.x`, `172.16–31.x`, `192.168.x`)
   while the public lookup shows something different, the friend is behind
   **CGNAT** and inbound WireGuard cannot work.

**If behind CGNAT:** ask the ISP for a public/static IP (often free on
request, sometimes a small fee), or use an outbound-only fallback — see
[CGNAT fallback](#cgnat-fallback) at the bottom. Don't continue with the
ER605 server config until you have a public IP.

---

## 1. Confirm WireGuard is available on this firmware

WireGuard VPN on Omada gateways requires a recent enough **controller** and
**gateway firmware**. In the controller, go to **Settings → VPN** and look
for a **WireGuard VPN** type/tab.

- **Present?** Great, continue.
- **Missing?** Update the OC200 controller (**Settings → Maintenance →
  Firmware Update** / via Omada cloud) and the ER605 firmware to the latest,
  then re-check. WireGuard appeared in Omada SDN controller 5.12+ with
  matching gateway firmware. If you can't update right now, the ER605 also
  supports **OpenVPN** and **L2TP/IPsec** servers under the same VPN menu —
  the rest of this repo (DDNS, the API script) works identically over any of
  them; only this guide's tunnel config differs.

---

## 2. Generate the Mac's keypair

WireGuard is peer-to-peer: each side has a private key it never shares and a
public key it hands to the other side. Generate the Mac's pair locally so the
**private key never leaves your Mac**:

```bash
# CLI tools: brew install wireguard-tools
umask 077
wg genkey | tee mac_private.key | wg pubkey > mac_public.key

cat mac_private.key   # -> goes in the Mac's [Interface] PrivateKey (local)
cat mac_public.key    # -> give THIS to the router as the peer's public key
```

Keep `mac_private.key` on the Mac only. You'll paste `mac_public.key` into
the controller.

The **router's** keypair is generated for you by the controller in the next
step — you'll copy the router's *public* key back into the Mac config.

---

## 3. Create the WireGuard server in the controller

**Settings → VPN → Create New VPN Policy** (or the **WireGuard VPN** tab) →
**WireGuard VPN**. Fill in:

| Field                   | Value                              | Notes                                                       |
|-------------------------|------------------------------------|-------------------------------------------------------------|
| Status                  | **Enable**                         |                                                             |
| Name                    | `wg-remote`                        | Anything memorable                                          |
| WAN / Interface         | Active WAN port                    | Same WAN the DDNS entry tracks                              |
| Listen Port             | `51820`                            | UDP. Note it — it's the `:port` in the client endpoint      |
| Local IP Address        | `10.13.13.1/24`                    | The router's address **inside** the tunnel subnet           |
| Local Public Key        | *click Generate*                   | Controller creates the router keypair; **copy this value**  |

Save the **Local Public Key** — call it `ROUTER_PUBLIC_KEY`. You'll need it
for the Mac config.

> Pick a tunnel subnet (`10.13.13.0/24` here) that does **not** overlap the
> LAN (`192.168.0.0/24`) or your Mac's own networks.

### Add your Mac as a peer

In the same policy, **Add Peer**:

| Peer field        | Value                  | Notes                                                          |
|-------------------|------------------------|---------------------------------------------------------------|
| Name              | `keiron-mac`           |                                                               |
| Public Key        | *paste* `mac_public.key` | The Mac's **public** key from step 2                        |
| Allowed Address   | `10.13.13.2/32`        | The single tunnel IP this peer may use                        |
| (Pre-shared key)  | *optional*             | Adds a symmetric layer; if set, also add it to the Mac config |

**Save** / **Apply**. Note the peer's tunnel address (`10.13.13.2`).

### Make the LAN reachable over the tunnel

Confirm the policy advertises/permits the LAN subnet `192.168.0.0/24` to VPN
peers (often a "Remote Networks" / "Allowed local networks" field on the
policy, or it's implied by the gateway routing). The Mac side requests it via
`AllowedIPs` in the next step; the router must be willing to route it back.
With Omada's default gateway firewall this works once the WireGuard policy is
enabled, but if you've tightened LAN-in rules, allow the tunnel subnet
`10.13.13.0/24 → 192.168.0.0/24`.

---

## 4. Build the Mac client config

Create `homekeep-wg.conf` on the Mac:

```ini
[Interface]
# The Mac's PRIVATE key (contents of mac_private.key)
PrivateKey = <MAC_PRIVATE_KEY>
# This peer's tunnel address, matching the Allowed Address in the controller
Address = 10.13.13.2/32
# Resolve home hostnames via the router's DNS while connected (optional).
# Omit this line to keep using your Mac's normal DNS.
DNS = 192.168.0.1

[Peer]
# The router's PUBLIC key (ROUTER_PUBLIC_KEY from step 3)
PublicKey = <ROUTER_PUBLIC_KEY>
# Stable hostname from guide 1, plus the Listen Port from step 3
Endpoint = keiron-home.tplinkdns.com:51820
# SPLIT TUNNEL: only the home LAN + tunnel subnet go over WireGuard.
AllowedIPs = 192.168.0.0/24, 10.13.13.0/24
# Keep the NAT mapping alive so the router can reach back / reconnect.
PersistentKeepalive = 25
# If you set a pre-shared key on the peer, add it here too:
# PresharedKey = <PSK>
```

Load it:

- **GUI:** WireGuard app → **Import tunnel(s) from file** → select the
  `.conf` → toggle **Activate**.
- **CLI:**
  ```bash
  sudo cp homekeep-wg.conf /etc/wireguard/
  sudo wg-quick up homekeep-wg     # 'down' to disconnect
  ```

---

## 5. Verify the tunnel

With the tunnel active, from the Mac:

```bash
# Handshake should be recent and bytes should be flowing
sudo wg show          # CLI; or the app shows "latest handshake"

# Can you reach the controller and the gateway across the tunnel?
ping -c2 192.168.0.1        # ER605
ping -c2 192.168.0.101      # OC200

# Is the Omada API answering over the tunnel?
curl -sk https://192.168.0.101:8043/api/info | head -c 300; echo
```

A recent handshake + successful pings + a JSON blob from `/api/info` means
you're done — you're effectively on the home LAN. Proceed to the API script.

### If the handshake never completes

- **No handshake at all:** almost always the inbound port isn't reaching the
  router — re-check the [public-IP/CGNAT](#0-before-you-start-confirm-you-have-a-public-ip)
  test, and confirm Listen Port `51820/udp` matches on both sides. The Omada
  WireGuard policy opens the WAN port itself; you should **not** need a
  manual port-forward, but double-check no upstream modem is also NATing.
- **Handshake OK but can't reach `192.168.0.x`:** `AllowedIPs` on the Mac
  must include `192.168.0.0/24`, and the router must route the tunnel subnet
  to the LAN (step 3, "Make the LAN reachable"). Check the gateway ACL.
- **Works on-site only:** you probably tested while still on the home Wi-Fi.
  Disconnect from home Wi-Fi (use cellular/hotspot) to prove remote reach.

---

## Optional: full tunnel

To route **all** the Mac's traffic through the home connection (e.g. to
appear as if browsing from home), change the Mac config:

```ini
AllowedIPs = 0.0.0.0/0, ::/0
```

and ensure the controller's WireGuard policy NATs VPN traffic out the WAN
(usually automatic). Trade-off: all your browsing now depends on the home
uplink being up, and adds latency. For "manage the network," split tunnel is
better.

---

## CGNAT fallback

If the friend is behind CGNAT and can't get a public IP, flip the model from
*inbound to the router* to *outbound from inside the LAN*:

- **Tailscale (simplest):** install Tailscale on any always-on host on the
  LAN (a Pi, NAS, or even the friend's desktop) and enable it as a **subnet
  router** advertising `192.168.0.0/24`. Your Mac joins the same tailnet and
  reaches the OC200 with zero inbound ports. Tailscale's coordination handles
  NAT traversal.
- **VPS relay:** stand up WireGuard on a cheap public VPS; have a LAN host
  dial *out* to the VPS and your Mac dial *in* to the VPS, with the VPS
  routing between them.

Either way, the [API script](./03-omada-local-api.md) is unchanged — it just
needs IP reachability to `192.168.0.101`.

➡️ Continue to [3. Omada local API + query script](./03-omada-local-api.md).
