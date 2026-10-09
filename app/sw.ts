/// <reference lib="webworker" />
/// <reference types="@types/serviceworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

/**
 * 07-01 (D-04, D-05) — Serwist service worker entry.
 *
 * Compiled by @serwist/next at build time into public/sw.js (gitignored).
 * Registered automatically by the webpack plugin on the client; browsers
 * enforce that SW registration only succeeds on HTTPS or localhost, so
 * the HTTP graceful-degradation path (INFR-07) is handled implicitly.
 *
 * Runtime strategy is Serwist's `defaultCache` (NetworkFirst for pages +
 * JSON, StaleWhileRevalidate for assets, CacheFirst for immutable
 * /_next/static/*). We deliberately DO NOT widen the precache list to
 * include /h/** — navigations there are user-scoped; NetworkFirst with
 * navigation preload keeps stale auth'd pages from ever being returned
 * after a logout (T-07-01-02 + T-07-01-06 mitigations).
 *
 * Offline fallback: any failed navigation (document) request falls
 * through to the static /offline.html — a warm, zero-JS card saying
 * "You're offline — reconnect to see updates."
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: '/offline.html',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();
