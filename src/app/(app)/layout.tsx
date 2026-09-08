import type { ReactNode } from 'react';
import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { strings } from '@/lib/strings';
import { NotificationsBell } from '@/components/NotificationsBell';
import { getDbUser } from '@/lib/auth/current-user';
import { listNotifications } from '@/lib/collaboration/service';

/**
 * Notifications for the header.
 *
 * Returns nothing when signed out — the header renders for both states, and a
 * database read behind a signed-out visitor would be work nobody asked for.
 */
async function notificationsForNav() {
  const user = await getDbUser();
  if (!user) return [];
  return listNotifications(user.id, { limit: 20 });
}

/** The product's own chrome. Deliberately absent from client-facing pages. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                {strings.app.name}
              </Link>
              <nav className="flex items-center gap-3 text-sm">
                <Show when="signed-in">
                  <Link href="/dashboard" className="text-ink-muted transition-colors hover:text-ink">
                    {strings.nav.dashboard}
                  </Link>
                  <Link href="/materials" className="text-ink-muted transition-colors hover:text-ink">
                    {strings.materials.navLink}
                  </Link>
                  <Link href="/suppliers" className="text-ink-muted transition-colors hover:text-ink">
                    {strings.suppliers.navLink}
                  </Link>
                  <Link href="/analytics" className="text-ink-muted transition-colors hover:text-ink">
                    {strings.analytics.navLink}
                  </Link>
                  <Link
                    href="/workspace"
                    className="text-ink-muted transition-colors hover:text-ink"
                  >
                    {strings.workspaces.navLink}
                  </Link>
                  <Link
                    href="/settings/costing"
                    className="text-ink-muted transition-colors hover:text-ink"
                  >
                    {strings.costSettings.navLink}
                  </Link>
                  <Link
                    href="/settings/quotes"
                    className="text-ink-muted transition-colors hover:text-ink"
                  >
                    {strings.quoteSettings.navLink}
                  </Link>
                  <NotificationsBell
                    notifications={(await notificationsForNav()).map((entry) => ({
                      id: entry.id,
                      projectId: entry.projectId,
                      summary: entry.summary,
                      read: entry.readAt !== null,
                      createdAt: entry.createdAt.toISOString(),
                    }))}
                  />
                  <UserButton />
                </Show>
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <button type="button" className="text-ink-muted transition-colors hover:text-ink">
                      {strings.nav.signIn}
                    </button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button
                      type="button"
                      className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-ink transition-opacity hover:opacity-90"
                    >
                      {strings.nav.signUp}
                    </button>
                  </SignUpButton>
                </Show>
              </nav>
            </div>
          </header>
      {children}
    </>
  );
}
