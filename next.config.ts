import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

/**
 * 07-01 (D-04, D-05) — wrap Next.js config with @serwist/next so
 * `npm run build` emits public/sw.js from app/sw.ts. Dev-mode SW
 * generation is disabled per D-04 to avoid stale precache during
 * hot-reload; service workers only ship in production builds.
 *
 * `output: 'standalone'` stays intact so the Phase 1 Dockerfile still
 * copies the minimal server tree.
 */
const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  register: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
});

/**
 * Phase 24 HDR-01: Security headers applied to every response by Next.js.
 * This is the app-layer half of the defense-in-depth pair — docker/Caddyfile
 * + docker/Caddyfile.prod mirror the same set at the reverse-proxy layer so
 * headers survive even if upstream (Next) is ever replaced (HDR-02, D-08/D-09).
 *
 * Design decisions:
 *   - D-02: CSP ships as `Report-Only` for ≥30-day soak. Phase 28 flips to
 *     enforced after violation data shows zero legit-path triggers.
 *   - D-03: HSTS applied only when SITE_URL starts with `https://` so LAN-HTTP
 *     deploys are not locked out. Caddy TLS terminator also emits this.
 *   - CSP sources: Google Fonts (fonts.googleapis.com, fonts.gstatic.com) from
 *     app/layout.tsx next/font import; ntfy.sh outbound from lib/ntfy.ts.
 *   - `unsafe-inline` on script/style is accepted during soak; nonce/hash
 *     upgrade deferred per CONTEXT §deferred.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://ntfy.sh https://*.ntfy.sh",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'report-uri /api/csp-report',
].join('; ');

const SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  },
];

// D-03: HSTS only on HTTPS origins to avoid bricking plain-HTTP LAN deploys.
if (process.env.SITE_URL?.startsWith('https://')) {
  SECURITY_HEADERS.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  });
}

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default withSerwist(nextConfig);
