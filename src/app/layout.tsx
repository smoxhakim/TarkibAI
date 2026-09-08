import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { strings } from '@/lib/strings';
import './globals.css';

export const metadata = {
  title: strings.app.name,
  description: strings.app.tagline,
};

/**
 * The document shell, and nothing else.
 *
 * The product header lives in the `(app)` route group rather than here, because
 * `/share/*` is a page a CLIENT sees. Showing them TARKIB's own name and a
 * "Get started" button turns a business's proposal into somebody else's
 * marketing surface — and the client is not our user, they are our user's
 * customer.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-dvh bg-surface text-ink">{children}</body>
      </html>
    </ClerkProvider>
  );
}
