'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

type Props = {
  projectId: string;
  title: string;
  archived: boolean;
};

type Busy = 'rename' | 'archive' | 'delete' | null;

const linkClass = 'text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline disabled:opacity-50';

export function ProjectActions({ projectId, title, archived }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(action: Busy, request: () => Promise<Response>) {
    setBusy(action);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? strings.errors.generic);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(strings.errors.generic);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function rename() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(strings.errors.titleRequired);
      return;
    }
    if (trimmed === title) {
      setEditing(false);
      return;
    }
    const ok = await send('rename', () =>
      fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
    );
    if (ok) setEditing(false);
  }

  function setArchived(value: boolean) {
    return send('archive', () =>
      fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: value }),
      })
    );
  }

  async function destroy() {
    const ok = await send('delete', () => fetch(`/api/projects/${projectId}`, { method: 'DELETE' }));
    if (ok) setConfirmingDelete(false);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`rename-${projectId}`} className="sr-only">
            {strings.projects.titleLabel}
          </label>
          <input
            id={`rename-${projectId}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            autoFocus
            disabled={busy === 'rename'}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent disabled:opacity-60"
          />
          <button type="button" onClick={rename} disabled={busy === 'rename'} className={linkClass}>
            {busy === 'rename' ? strings.projects.renaming : strings.projects.save}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(title);
              setError(null);
            }}
            disabled={busy === 'rename'}
            className={linkClass}
          >
            {strings.projects.cancel}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (confirmingDelete) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3">
        <p className="text-sm font-medium">{strings.projects.deleteConfirmTitle}</p>
        <p className="mt-1 text-sm text-ink-muted">{strings.projects.deleteConfirmBody}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={destroy}
            disabled={busy === 'delete'}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy === 'delete' ? strings.projects.deleting : strings.projects.deleteConfirmAction}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            disabled={busy === 'delete'}
            className={linkClass}
          >
            {strings.projects.cancel}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={() => setEditing(true)} className={linkClass}>
          {strings.projects.rename}
        </button>
        {archived ? (
          <button
            type="button"
            onClick={() => setArchived(false)}
            disabled={busy === 'archive'}
            className={linkClass}
          >
            {busy === 'archive' ? strings.projects.restoring : strings.projects.restore}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setArchived(true)}
            disabled={busy === 'archive'}
            className={linkClass}
          >
            {busy === 'archive' ? strings.projects.archiving : strings.projects.archive}
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="text-red-600 underline-offset-2 transition-opacity hover:underline hover:opacity-80"
        >
          {strings.projects.delete}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
