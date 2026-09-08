'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

export type CommentRow = {
  id: string;
  author: string;
  fromClient: boolean;
  kind: string;
  body: string;
  createdAt: string;
};

const t = strings.collaboration;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function CommentsPanel({
  projectId,
  comments,
  canPost,
}: {
  projectId: string;
  comments: CommentRow[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    if (body.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.postFailed);
        return;
      }
      setBody('');
      router.refresh();
    } catch {
      setError(t.postFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{t.threadTitle}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.threadSubtitle}</p>

      {comments.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t.noComments}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{comment.author}</span>
                {comment.fromClient ? (
                  <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                    {t.fromClient}
                  </span>
                ) : null}
                {comment.kind !== 'comment' ? (
                  <span className="text-xs text-ink-muted">
                    {comment.kind === 'approval' ? t.approved : t.requestedChanges}
                  </span>
                ) : null}
                <span className="text-xs text-ink-muted">
                  {dateFormat.format(new Date(comment.createdAt))}
                </span>
              </div>
              {comment.body ? <p className="mt-0.5 whitespace-pre-wrap">{comment.body}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {canPost ? (
        <div className="mt-4 border-t border-line pt-3">
          <textarea
            className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            rows={2}
            maxLength={4000}
            placeholder={t.commentPlaceholder}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
          <button
            type="button"
            disabled={busy || body.trim() === ''}
            onClick={post}
            className="mt-2 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            {busy ? t.posting : t.post}
          </button>
        </div>
      ) : null}
    </section>
  );
}
