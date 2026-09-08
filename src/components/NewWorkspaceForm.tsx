'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

const t = strings.workspaces;

export function NewWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (name.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? t.createFailed);
        return;
      }
      setName('');
      router.push(`/workspace?workspace=${body.workspace.id}`);
      router.refresh();
    } catch {
      setError(t.createFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{t.create}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          placeholder={t.createPlaceholder}
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          disabled={busy || name.trim() === ''}
          onClick={create}
          className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          {busy ? t.creating : t.create}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
