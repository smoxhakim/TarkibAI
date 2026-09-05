import Link from 'next/link';
import { Show, SignUpButton } from '@clerk/nextjs';
import { strings } from '@/lib/strings';

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <p className="text-sm font-medium text-accent">{strings.app.tagline}</p>
      <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {strings.landing.heading}
      </h1>
      <p className="mt-5 text-pretty leading-relaxed text-ink-muted">{strings.landing.body}</p>
      <div className="mt-8">
        <Show when="signed-in">
          <Link
            href="/dashboard"
            className="inline-block rounded-md bg-accent px-4 py-2 font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            {strings.landing.ctaSignedIn}
          </Link>
        </Show>
        <Show when="signed-out">
          <SignUpButton mode="modal">
            <button
              type="button"
              className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink transition-opacity hover:opacity-90"
            >
              {strings.landing.cta}
            </button>
          </SignUpButton>
        </Show>
      </div>
    </main>
  );
}
