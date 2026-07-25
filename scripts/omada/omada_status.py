#!/usr/bin/env python3
"""omada_status.py — query a TP-Link Omada controller's local API.

Authenticates to an Omada SDN controller (e.g. an OC200 hardware
controller) over its LAN-local HTTPS API and prints connected clients,
managed-device status, and unarchived alerts. Designed to be run from a
machine that already has network reach to the controller — in this repo's
context, that means *after* you are connected to the home network over the
WireGuard VPN documented in docs/omada-remote-access/.

It uses the controller's built-in "v2" login API (username + password ->
session token), which works on any OC200 firmware without provisioning an
Open-API client. See docs/omada-remote-access/03-omada-local-api.md for the
trade-offs versus the official Open API.

Usage
-----
    pip install -r requirements.txt
    cp .env.example .env          # then edit .env with your details
    ./omada_status.py             # summary tables
    ./omada_status.py --json      # raw structured JSON (for piping to jq)
    ./omada_status.py --clients   # only the client list

Configuration is read from the environment (a local .env is auto-loaded if
python-dotenv is installed). Command-line flags override env vars.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any

import requests

try:  # optional convenience: load a sibling .env if present
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # python-dotenv is optional; env vars still work
    pass


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
@dataclass
class Config:
    base_url: str
    username: str
    password: str
    site_name: str = "Default"
    verify_tls: bool | str = False  # False, True, or a path to a CA bundle
    timeout: int = 15

    @classmethod
    def from_env(cls) -> "Config":
        host = os.environ.get("OMADA_HOST", "192.168.0.101")
        port = os.environ.get("OMADA_PORT", "8043")
        scheme = os.environ.get("OMADA_SCHEME", "https")
        base_url = os.environ.get("OMADA_BASE_URL") or f"{scheme}://{host}:{port}"

        username = os.environ.get("OMADA_USERNAME", "")
        password = os.environ.get("OMADA_PASSWORD", "")
        if not username or not password:
            sys.exit(
                "error: OMADA_USERNAME and OMADA_PASSWORD must be set "
                "(see .env.example)."
            )

        verify_raw = os.environ.get("OMADA_VERIFY_TLS", "false").strip()
        verify: bool | str
        if verify_raw.lower() in {"false", "0", "no", ""}:
            verify = False
        elif verify_raw.lower() in {"true", "1", "yes"}:
            verify = True
        else:
            verify = verify_raw  # treat as a path to a CA/cert bundle

        return cls(
            base_url=base_url.rstrip("/"),
            username=username,
            password=password,
            site_name=os.environ.get("OMADA_SITE", "Default"),
            verify_tls=verify,
            timeout=int(os.environ.get("OMADA_TIMEOUT", "15")),
        )


class OmadaError(RuntimeError):
    """Raised when the controller returns a non-zero errorCode."""


# --------------------------------------------------------------------------
# API client
# --------------------------------------------------------------------------
@dataclass
class OmadaClient:
    cfg: Config
    session: requests.Session = field(default_factory=requests.Session)
    controller_id: str = ""
    csrf_token: str = ""
    site_id: str = ""

    # -- low-level helpers --------------------------------------------------
    def _url(self, path: str) -> str:
        return f"{self.cfg.base_url}{path}"

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        headers = kwargs.pop("headers", {})
        if self.csrf_token:
            headers["Csrf-Token"] = self.csrf_token
        resp = self.session.request(
            method,
            self._url(path),
            headers=headers,
            verify=self.cfg.verify_tls,
            timeout=self.cfg.timeout,
            **kwargs,
        )
        resp.raise_for_status()
        body = resp.json()
        if body.get("errorCode", 0) != 0:
            raise OmadaError(
                f"{method} {path} -> errorCode={body.get('errorCode')} "
                f"msg={body.get('msg')!r}"
            )
        return body.get("result", {})

    # -- session lifecycle --------------------------------------------------
    def discover(self) -> None:
        """Fetch the controller id (omadacId), required to prefix v2 paths."""
        # /api/info is unauthenticated and returns controllerVer + omadacId.
        resp = self.session.get(
            self._url("/api/info"),
            verify=self.cfg.verify_tls,
            timeout=self.cfg.timeout,
        )
        resp.raise_for_status()
        result = resp.json().get("result", {})
        self.controller_id = result.get("omadacId", "")
        if not self.controller_id:
            raise OmadaError(
                "could not read 'omadacId' from /api/info — is this an "
                "Omada SDN controller (v5.x)? Response: " + json.dumps(result)
            )

    def login(self) -> None:
        if not self.controller_id:
            self.discover()
        result = self._request(
            "POST",
            f"/{self.controller_id}/api/v2/login",
            json={"username": self.cfg.username, "password": self.cfg.password},
        )
        self.csrf_token = result.get("token", "")
        if not self.csrf_token:
            raise OmadaError("login succeeded but no token was returned")
        self._resolve_site()

    def logout(self) -> None:
        if self.csrf_token:
            try:
                self._request("POST", f"/{self.controller_id}/api/v2/logout")
            except (OmadaError, requests.RequestException):
                pass  # best-effort; we're tearing down anyway

    def _resolve_site(self) -> None:
        """Map the human site name (e.g. 'Default') to its internal id."""
        result = self._request(
            "GET",
            f"/{self.controller_id}/api/v2/sites"
            "?currentPage=1&currentPageSize=1000",
        )
        for site in result.get("data", []):
            if site.get("name") == self.cfg.site_name:
                self.site_id = site.get("id", "")
                return
        names = [s.get("name") for s in result.get("data", [])]
        raise OmadaError(
            f"site {self.cfg.site_name!r} not found. Available: {names}"
        )

    # -- data endpoints -----------------------------------------------------
    def _site_path(self, suffix: str) -> str:
        return f"/{self.controller_id}/api/v2/sites/{self.site_id}{suffix}"

    def _paged(self, suffix: str, extra: str = "") -> list[dict[str, Any]]:
        """Walk a paginated endpoint and return all rows."""
        rows: list[dict[str, Any]] = []
        page = 1
        size = 100
        while True:
            sep = "&" if extra else ""
            q = f"?currentPage={page}&currentPageSize={size}{sep}{extra}"
            result = self._request("GET", self._site_path(suffix + q))
            data = result.get("data", [])
            rows.extend(data)
            total = result.get("totalRows", len(rows))
            if len(rows) >= total or not data:
                break
            page += 1
        return rows

    def clients(self) -> list[dict[str, Any]]:
        """Active (connected) clients on the site."""
        return self._paged("/clients", extra="filters.active=true")

    def devices(self) -> list[dict[str, Any]]:
        """Managed devices (gateway, switches, APs) and their status."""
        # /devices is not paginated on most firmwares; returns a flat list.
        result = self._request("GET", self._site_path("/devices"))
        if isinstance(result, list):
            return result
        return result.get("data", [])

    def alerts(self) -> list[dict[str, Any]]:
        """Unarchived alerts (the controller's 'Alerts' notifications)."""
        return self._paged("/alerts", extra="filters.archived=false")

    def __enter__(self) -> "OmadaClient":
        self.login()
        return self

    def __exit__(self, *exc: object) -> None:
        self.logout()


# --------------------------------------------------------------------------
# Presentation
# --------------------------------------------------------------------------
# Omada device status codes (subset). See the controller API for the full map.
_DEVICE_STATUS = {
    0: "DISCONNECTED",
    1: "DISCONNECTED (migrating)",
    10: "CONNECTED",
    11: "CONNECTED (wireless)",
    12: "PENDING",
    14: "HEARTBEAT MISSED",
    20: "ADOPTING",
    22: "PROVISIONING",
    24: "CONFIGURING",
    40: "ISOLATED",
    41: "ISOLATED (migrating)",
}


def _fmt_status(code: Any) -> str:
    try:
        return _DEVICE_STATUS.get(int(code), f"STATUS_{code}")
    except (TypeError, ValueError):
        return str(code)


def _bytes(n: Any) -> str:
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "-"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def _table(rows: list[list[str]], headers: list[str]) -> str:
    cols = list(zip(*([headers] + rows))) if rows else [[h] for h in headers]
    widths = [max(len(str(c)) for c in col) for col in cols]
    line = "  ".join(h.ljust(w) for h, w in zip(headers, widths))
    sep = "  ".join("-" * w for w in widths)
    out = [line, sep]
    for row in rows:
        out.append("  ".join(str(c).ljust(w) for c, w in zip(row, widths)))
    return "\n".join(out)


def print_devices(devices: list[dict[str, Any]]) -> None:
    print(f"\n=== Managed devices ({len(devices)}) ===")
    rows = [
        [
            d.get("name", "?"),
            d.get("type", "?"),
            d.get("model", "?"),
            d.get("ip", "-"),
            _fmt_status(d.get("status")),
            f"{d.get('uptimeLong', d.get('uptime', '-'))}",
        ]
        for d in devices
    ]
    print(_table(rows, ["Name", "Type", "Model", "IP", "Status", "Uptime"]))


def print_clients(clients: list[dict[str, Any]]) -> None:
    print(f"\n=== Connected clients ({len(clients)}) ===")
    rows = []
    for c in clients:
        conn = "wired" if c.get("wireless") is False else c.get("ssid", "wifi")
        rows.append(
            [
                c.get("name") or c.get("hostName") or "(unknown)",
                c.get("ip", "-"),
                c.get("mac", "-"),
                str(conn),
                _bytes(c.get("trafficDown")),
                _bytes(c.get("trafficUp")),
            ]
        )
    print(_table(rows, ["Name", "IP", "MAC", "Conn", "Down", "Up"]))


def print_alerts(alerts: list[dict[str, Any]]) -> None:
    print(f"\n=== Active alerts ({len(alerts)}) ===")
    if not alerts:
        print("  (none)")
        return
    rows = [
        [
            str(a.get("level", "-")),
            a.get("name", a.get("description", "?"))[:60],
            str(a.get("time", a.get("timestamp", "-"))),
        ]
        for a in alerts
    ]
    print(_table(rows, ["Level", "Message", "Time"]))


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--json", action="store_true", help="emit raw JSON")
    parser.add_argument("--clients", action="store_true", help="clients only")
    parser.add_argument("--devices", action="store_true", help="devices only")
    parser.add_argument("--alerts", action="store_true", help="alerts only")
    args = parser.parse_args(argv)

    cfg = Config.from_env()

    if cfg.verify_tls is False:
        # Quiet the (expected) self-signed-cert warning for LAN controllers.
        requests.packages.urllib3.disable_warnings(  # type: ignore[attr-defined]
            requests.packages.urllib3.exceptions.InsecureRequestWarning  # type: ignore[attr-defined]
        )

    # If no specific section is requested, show everything.
    show_all = not (args.clients or args.devices or args.alerts)

    try:
        with OmadaClient(cfg) as oc:
            payload: dict[str, Any] = {}
            if show_all or args.clients:
                payload["clients"] = oc.clients()
            if show_all or args.devices:
                payload["devices"] = oc.devices()
            if show_all or args.alerts:
                payload["alerts"] = oc.alerts()
    except OmadaError as e:
        print(f"Omada API error: {e}", file=sys.stderr)
        return 2
    except requests.RequestException as e:
        print(f"Network error talking to {cfg.base_url}: {e}", file=sys.stderr)
        print(
            "  Hint: are you connected to the VPN? Is OMADA_HOST/PORT right?",
            file=sys.stderr,
        )
        return 1

    if args.json:
        print(json.dumps(payload, indent=2, default=str))
        return 0

    print(f"Controller: {cfg.base_url}  site={cfg.site_name!r}")
    if "devices" in payload:
        print_devices(payload["devices"])
    if "clients" in payload:
        print_clients(payload["clients"])
    if "alerts" in payload:
        print_alerts(payload["alerts"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
