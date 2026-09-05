'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { strings } from '@/lib/strings';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string | Date;
};

type Props = {
  projectId: string;
  initialMessages: ChatMessage[];
  aiConfigured: boolean;
};

export function ChatPanel({ projectId, initialMessages, aiConfigured }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || pending) return;

    // Optimistic echo so the user sees their own message immediately; a turn
    // can take several seconds. Rolled back if the request fails.
    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setPending(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(content);
        setError(body.error ?? strings.chat.failed);
        return;
      }

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        body.userMessage,
        body.assistantMessage,
      ]);
      // Refresh the server components so the specification panel reflects any
      // tool calls the agent made during this turn.
      router.refresh();
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(content);
      setError(strings.chat.failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col rounded-lg border border-line">
      <div className="border-b border-line p-4">
        <h2 className="font-medium">{strings.chat.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{strings.chat.subtitle}</p>
      </div>

      <div className="flex max-h-[28rem] min-h-56 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && !pending ? (
          <div className="my-auto text-center">
            <p className="text-sm font-medium">{strings.chat.empty}</p>
            <p className="mt-1 text-sm text-ink-muted">{strings.chat.emptyHint}</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  message.role === 'user'
                    ? 'bg-accent text-accent-ink'
                    : 'bg-surface-muted text-ink'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))
        )}

        {pending ? (
          <div className="flex justify-start">
            <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-muted">
              <span className="inline-block animate-pulse">{strings.chat.sending}</span>
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line p-4">
        {aiConfigured ? (
          <>
            <form onSubmit={send} className="flex gap-2">
              <label htmlFor="chat-input" className="sr-only">
                {strings.chat.title}
              </label>
              <input
                id="chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={strings.chat.placeholder}
                maxLength={4000}
                disabled={pending}
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={pending || draft.trim().length === 0}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {pending ? strings.chat.sending : strings.chat.send}
              </button>
            </form>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </>
        ) : (
          <div className="rounded-md border border-dashed border-line px-3 py-3">
            <p className="text-sm font-medium">{strings.chat.notConfigured}</p>
            <p className="mt-1 text-sm text-ink-muted">{strings.chat.notConfiguredHint}</p>
          </div>
        )}
      </div>
    </section>
  );
}
