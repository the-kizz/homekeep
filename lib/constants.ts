// SPDX-License-Identifier: MIT
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
/**
 * Public provenance constant — re-exported from a dedicated module so
 * that tree-shaking does NOT elide it (scheduler.ts imports + logs this
 * on startup; the value also surfaces in `<meta name="hk-build">`).
 *
 * Keep the string stable across releases — CONTRIBUTORS rely on it for
 * the "is this a HomeKeep deploy?" probe documented in 07-CONTEXT.
 */
export const HOMEKEEP_BUILD = 'hk-1b6f3c0e-homekeep-public' as const;
