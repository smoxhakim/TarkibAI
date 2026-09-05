import Link from 'next/link';
import { strings } from '@/lib/strings';

export default function ProjectNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-xl font-semibold">{strings.errors.projectNotFound}</h1>
      <Link
        href="/dashboard"
        className="mt-4 inline-block text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        {strings.workspace.backToProjects}
      </Link>
    </main>
  );
}
