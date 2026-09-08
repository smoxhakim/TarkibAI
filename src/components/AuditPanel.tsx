'use client';

import { useState } from 'react';
import { strings } from '@/lib/strings';

export type AuditRow = {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
};

const t = strings.audit;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function AuditPanel({ events }: { events: AuditRow[] }) {
  // Collapsed by default: it is a record to consult, not something to read on
  // the way past.
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{t.title}</h2>
        {events.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {open ? t.hide : `${t.show} (${events.length})`}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

      {events.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t.none}</p>
      ) : open ? (
        <ol className="mt-3 flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>{event.summary}</span>
              <span className="text-xs text-ink-muted">
                {dateFormat.format(new Date(event.createdAt))}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
