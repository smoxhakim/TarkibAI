import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Live model evaluations. Network- and cost-bearing, so they are never part of
// `npm test`; they self-skip when OPENAI_API_KEY is absent.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.eval.test.ts'],
    setupFiles: ['./vitest.integration.setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    // Setting a project up for an evaluation means a dozen round trips to a
    // hosted database — approve a spec, seed a canvas, calculate materials,
    // compute a cost. The 10s default is a limit on network latency rather than
    // on anything under test, and silently SKIPS the whole file when it bites.
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
