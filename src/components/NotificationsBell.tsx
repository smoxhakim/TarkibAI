'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { strings } from '@/lib/strings';

export type NotificationRow = {
  id: string;
  projectId: string | null;
  summary: string;
  read: boolean;
  createdAt: string;
};

const t = strings.collaboration;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function NotificationsBell({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((entry) => !entry.read).length;

  async function markAll() {
    await fetch('/api/notifications', { method: 'POST' });
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-ink-muted transition-colors hover:text-ink"
      >
        {t.notifications}
        {unread > 0 ? (
          <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-xs text-accent-ink">
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-lg border border-line bg-surface p-3 shadow-lg">
          {notifications.length === 0 ? (
            <p className="text-sm text-ink-muted">{t.noNotifications}</p>
          ) : (
            <>
              <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {notifications.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    {entry.projectId ? (
                      <Link
                        href={`/projects/${entry.projectId}`}
                        onClick={() => setOpen(false)}
                        className={entry.read ? 'text-ink-muted' : ''}
                      >
                        {entry.summary}
                      </Link>
                    ) : (
                      <span className={entry.read ? 'text-ink-muted' : ''}>{entry.summary}</span>
                    )}
                    <span className="block text-xs text-ink-muted">
                      {dateFormat.format(new Date(entry.createdAt))}
                    </span>
                  </li>
                ))}
              </ul>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={markAll}
                  className="mt-3 text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {t.markAllRead}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
