import { defineConfig } from '@prisma/config';

// Prisma 7 no longer reads .env automatically and no longer accepts connection
// URLs inside schema.prisma. Node's built-in loader is used here so we don't
// need a dotenv dependency just for the CLI.
process.loadEnvFile?.('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Migrations MUST use the non-pooled Neon endpoint: the pooler runs in
    // transaction mode and cannot hold the advisory locks migrate requires.
    // Runtime traffic uses the pooled DATABASE_URL via the driver adapter in src/lib/db.ts.
    url: process.env.DIRECT_URL as string,
  },
});
