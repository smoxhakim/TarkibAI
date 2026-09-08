'use client';

import { strings } from '@/lib/strings';

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="rounded-lg border border-line p-6">
        <h1 className="font-medium">{strings.errors.loadProjects}</h1>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          {strings.errors.retry}
        </button>
      </div>
    </main>
  );
}
