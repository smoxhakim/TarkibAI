import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

// Prisma 7 requires an explicit driver adapter. Runtime traffic uses Neon's
// POOLED endpoint (DATABASE_URL); migrations use the direct endpoint and are
// configured separately in prisma.config.ts.
function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure Neon.');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Next.js dev server hot-reloads modules; without a global singleton every
// reload would open a new connection pool and exhaust Neon's connection limit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
