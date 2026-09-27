'use client';

import Link from 'next/link';
import { strings } from '@/lib/strings';

/**
 * The project page reads from some thirty services in one render. Without this
 * boundary a failure in any of them replaced the whole page with the framework's
 * generic error screen, which offers neither a retry nor a way back.
 */
export default function ProjectError({ retry }: { error: Error; retry: () => void }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="rounded-lg border border-line p-6">
        <h1 className="font-medium">{strings.errors.generic}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={retry}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            {strings.errors.retry}
          </button>
          <Link
            href="/dashboard"
            className="text-sm text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            {strings.workspace.backToProjects}
          </Link>
        </div>
      </div>
    </main>
  );
}
