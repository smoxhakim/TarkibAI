import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/db';
import { unauthorized } from '@/lib/http/api';
import type { User } from '@/generated/prisma/client';

/**
 * Resolves the Clerk session to TARKIB's own User row, creating it on first
 * sight. The identity ALWAYS comes from the server-side Clerk session — never
 * from a request body, a query parameter, or an AI tool argument.
 *
 * A Clerk webhook-driven sync is added in a later phase; syncing lazily here
 * means T0 needs no publicly reachable webhook endpoint to function.
 */
export async function requireDbUser(): Promise<User> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw unauthorized();

  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) return existing;

  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress;
  if (!email) {
    // Clerk is configured to require an email address, so this indicates a
    // misconfigured instance rather than a normal user state.
    throw unauthorized();
  }

  const name = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') || null;

  // upsert (not create) guards against two concurrent first requests racing.
  return prisma.user.upsert({
    where: { clerkId },
    update: {},
    create: { clerkId, email, name },
  });
}

/** Returns the user row, or null when signed out. For pages that render both states. */
export async function getDbUser(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return requireDbUser();
}
