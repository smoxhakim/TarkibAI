import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests only: no database, no network, no credentials. Integration tests
// live in *.integration.test.ts and run via `npm run test:integration`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
