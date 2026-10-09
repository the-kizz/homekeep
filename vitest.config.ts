import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Scheduling math is asserted as UTC instants. The Docker image sets no TZ, so
// production runs in UTC too; the code itself must still be host-tz safe, so an
// explicit TZ in the environment is respected to let that be exercised.
process.env.TZ ||= 'UTC';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // The first import of a server action or a large component transforms
    // its whole module graph, which can take well over 5 s on a busy host.
    // Generous budgets here replace per-file warm-up hooks; integration
    // suites that boot PocketBase in beforeAll need the larger hook budget.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
  },
});
