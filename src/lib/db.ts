import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { normalizeSslMode } from './db-url';

/**
 * The database client, constructed on FIRST USE rather than on import.
 *
 * Next's build imports every route module to read its config exports —
 * `maxDuration`, `dynamic`, and so on. With an eagerly constructed client that
 * import reaches all the way through the service layer into here, so the build
 * itself needed a working DATABASE_URL just to READ the routes. It failed on
 * Vercel at "Collecting page data" before a single request existed.
 *
 * Building and running are different things. Nothing about compiling this app
 * requires a database, so nothing about compiling it should demand one.
 *
 * Prisma 7 requires an explicit driver adapter. Runtime traffic uses Neon's
 * POOLED endpoint (DATABASE_URL); migrations use the direct endpoint and are
 * configured separately in prisma.config.ts.
 */

// Next.js dev server hot-reloads modules; without a global singleton every
// reload would open a new connection pool and exhaust Neon's connection limit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (client) return client;
  if (globalForPrisma.prisma) return (client = globalForPrisma.prisma);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure Neon.');
  }

  client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: normalizeSslMode(connectionString) }),
  });
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
  return client;
}

/**
 * Behaves exactly like a PrismaClient, but touches the environment only when a
 * property is actually read. Methods are bound so `prisma.$transaction(...)`
 * and the model delegates keep their receiver.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = getClient();
    const value = Reflect.get(instance, property);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in getClient();
  },
});
