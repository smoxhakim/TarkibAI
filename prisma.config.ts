import { existsSync } from 'node:fs';
import { defineConfig } from '@prisma/config';
import { normalizeSslMode } from './src/lib/db-url';

// Prisma 7 no longer reads .env automatically and no longer accepts connection
// URLs inside schema.prisma. Node's built-in loader is used here so we don't
// need a dotenv dependency just for the CLI.
//
// Guarded on the file EXISTING, not just on the loader existing. A hosting
// platform puts the variables straight into the environment and ships no .env,
// and `loadEnvFile` throws ENOENT rather than shrugging — which failed the
// first Vercel build inside `postinstall: prisma generate`, before any of the
// application code ran.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Migrations MUST use the non-pooled Neon endpoint: the pooler runs in
    // transaction mode and cannot hold the advisory locks migrate requires.
    // Runtime traffic uses the pooled DATABASE_URL via the driver adapter in src/lib/db.ts.
    url: normalizeSslMode(process.env.DIRECT_URL as string),
  },
});
