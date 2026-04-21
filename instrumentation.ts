/**
 * Next.js 16 server-boot hook (06-02 Task 1, D-04, D-08, D-09).
 *
 * Next 16.2.4 auto-detects `instrumentation.ts` at the project root (the
 * old `experimental.instrumentationHook` flag is now on by default).
 * Runs once per server process start — perfect home for boot-time
 * singletons like our node-cron scheduler.
 *
 * Critical guards:
 *
 *   1. NEXT_RUNTIME check: the middleware / edge runtime imports this
 *      file too, but neither supports Node APIs (setTimeout semantics,
 *      child_process, fs). We short-circuit on non-'nodejs' runtimes so
 *      cron / admin-client creation never loads in those bundles.
 *
 *   2. DISABLE_SCHEDULER gate (D-09): tests, CI, and dev runs set this to
 *      'true' to silence the scheduler. Production leaves it unset.
 *
 *   3. Dynamic import of lib/scheduler: keeps node-cron out of the edge
 *      bundle regardless of any downstream tree-shake decisions. Runs only
 *      when we're SURE we're on nodejs + enabled.
 *
 * The register() function MUST remain side-effect-free at module-load
 * time; Next.js calls it explicitly after the server is ready.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.DISABLE_SCHEDULER === 'true') return;
  const { start } = await import('./lib/scheduler');
  start();
}
