'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { strings } from '@/lib/strings';

export type DomainOption = { id: string; label: string; description: string };

export function NewProjectForm({
  domains,
  workspaceId,
}: {
  domains: DomainOption[];
  /** The workspace being viewed. A project is created where you are looking. */
  workspaceId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState(domains[0]?.id ?? 'signage');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const trimmed = title.trim();
    if (!trimmed) {
      setError(strings.errors.titleRequired);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, domain }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? strings.errors.generic);
        return;
      }
      setTitle('');
      router.refresh();
    } catch {
      setError(strings.errors.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="project-title" className="sr-only">
        {strings.projects.titleLabel}
      </label>
      <input
        id="project-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={strings.projects.titlePlaceholder}
        maxLength={200}
        disabled={pending}
        className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-60"
      />
      <label htmlFor="project-domain" className="sr-only">
        {strings.projects.domainLabel}
      </label>
      <select
        id="project-domain"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        disabled={pending}
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
      >
        {domains.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? strings.projects.creating : strings.projects.create}
      </button>
      </form>
      {/* The trade decides which questions the project must answer before it
          can be approved, so it is chosen up front rather than changed later. */}
      <p className="mt-2 text-xs text-ink-muted">
        {domains.find((option) => option.id === domain)?.description}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
