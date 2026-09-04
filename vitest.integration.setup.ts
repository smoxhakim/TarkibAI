// Integration tests talk to the real Neon database, so the CLI env must be
// loaded before the Prisma client module is imported.
process.loadEnvFile('.env');
