import type { ReactNode } from 'react';
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { strings } from '@/lib/strings';
import './globals.css';

export const metadata = {
  title: strings.app.name,
  description: strings.app.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-dvh bg-surface text-ink">
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
                  <Link
                    href="/settings/costing"
                    className="text-ink-muted transition-colors hover:text-ink"
                  >
                    {strings.costSettings.navLink}
                  </Link>
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
        </body>
      </html>
    </ClerkProvider>
  );
}
