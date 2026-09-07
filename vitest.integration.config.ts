import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./vitest.integration.setup.ts'],
    // These tests share one database; running files in parallel would let them
    // observe each other's rows.
    fileParallelism: false,
    // A single test can make a dozen round trips to a hosted database, and the
    // quote tests also render a PDF and upload it. The default 5s is a limit on
    // network latency rather than on the code under test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
