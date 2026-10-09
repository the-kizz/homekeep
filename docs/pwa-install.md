# Installing HomeKeep as a PWA

Once HomeKeep is served over HTTPS (Caddy or Tailscale variant — see [deployment.md](./deployment.md)), it can be installed as a Progressive Web App on phones, tablets, and desktops. Installing gives you:

- A home-screen or launcher icon with the warm house-and-checkmark logo
- A full-screen window without browser chrome
- A persistent service-worker cache so the shell loads instantly on slow networks
- An offline fallback page when connectivity drops

**Prerequisite:** HomeKeep must be reachable over HTTPS. On plain-HTTP deployments the dismissible banner inside the app (`InsecureContextBanner`) explains that install and offline support are unavailable and links back to [deployment.md](./deployment.md).

## iOS (Safari)

1. Open HomeKeep in **Safari** (not Chrome — on iOS, only Safari can install PWAs).
2. Tap the **Share** button (the square with an up arrow, bottom centre on iPhone / top right on iPad).
3. Scroll the share sheet and tap **Add to Home Screen**.
4. Confirm the name (defaults to "HomeKeep") and tap **Add**.

The app launches full-screen from the home-screen icon with the warm terracotta theme in the status bar. iOS treats installed PWAs as first-class apps — they appear in the app switcher with their own snapshot.

## Android (Chrome)

1. Open HomeKeep in **Chrome** (Firefox, Samsung Internet, and Edge for Android also work — the wording varies slightly).
2. Tap the three-dot menu in the top-right.
3. Tap **Install app** (or **Add to Home screen** on older Chrome builds).
4. Confirm. The icon lands on your home screen and in the app drawer.

Chrome usually also surfaces an automatic install prompt at the bottom of the page on second visit. Tap **Install** when it appears.

## Desktop (Chrome, Edge, Brave)

1. Open HomeKeep in the browser.
2. Look for the **install icon** in the address bar (a rectangle with a downward arrow, on the right side of the URL).
3. Click **Install**.

The app opens in its own window, pinnable to the taskbar (Windows), dock (macOS), or launcher (Linux). Chrome and Edge on Windows also add a Start-menu entry automatically.

### Firefox desktop

Firefox desktop does not implement the PWA install prompt. HomeKeep still works perfectly in a regular Firefox tab; just bookmark it.

## What works offline

Once installed (or just visited at least once online), HomeKeep caches the dashboard shell so it boots without a network round-trip. The service worker serves the cached shell plus a warm `offline.html` fallback when navigation fails.

**Read-only in v1.** Viewing tasks, areas, and the coverage ring you have already loaded works offline. Completing tasks requires network connectivity — writes do **not** queue in v1 (offline writes are planned for a v1.1 follow-up). If you tap complete offline, you will see a toast error; try again once connectivity is back.

## Uninstalling

- **iOS:** long-press the icon → Remove App → Delete from Home Screen.
- **Android:** long-press the icon → Uninstall (or drag to the Uninstall bin).
- **Desktop Chrome / Edge / Brave:** open the app, three-dot menu → Uninstall HomeKeep. You can also uninstall from `chrome://apps`.

Uninstalling only removes the launcher entry and the local cache. Your household data lives on the server in the `./data` volume and is unaffected.
