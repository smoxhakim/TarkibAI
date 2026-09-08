'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The client's reply.
 *
 * Approving asks for a name and nothing else beyond an optional note: the
 * record is meant to say who approved and when, so a nameless approval is not
 * worth having.
 */
export function ClientResponseForm({ token, accent }: { token: string; accent: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(kind: 'approval' | 'revision_request' | 'comment') {
    if (name.trim() === '') {
      setError('Please give your name so we know who replied.');
      return;
    }
    if (kind !== 'approval' && body.trim() === '') {
      setError('Write a short message first.');
      return;
    }

    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/share/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name, body }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? 'Could not send your reply.');
        return;
      }
      setBody('');
      router.refresh();
    } catch {
      setError('Could not send your reply.');
    } finally {
      setBusy(null);
    }
  }

  const input =
    'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent';

  return (
    <div>
      <h2 className="text-xs font-medium uppercase tracking-widest text-ink-muted">Your reply</h2>

      <div className="mt-3 flex flex-col gap-2">
        <input
          className={input}
          placeholder="Your name"
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <textarea
          className={input}
          rows={3}
          maxLength={4000}
          placeholder="Anything you would like to change?"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => send('approval')}
          style={{ backgroundColor: accent }}
          className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'approval' ? 'Sending…' : 'Approve this project'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => send('revision_request')}
          className="rounded-md border border-line px-4 py-2 text-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          {busy === 'revision_request' ? 'Sending…' : 'Ask for changes'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => send('comment')}
          className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
        >
          {busy === 'comment' ? 'Sending…' : 'Just send a message'}
        </button>
      </div>
    </div>
  );
}
