'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

export type ShareRow = {
  id: string;
  path: string;
  label: string | null;
  active: boolean;
  revoked: boolean;
  expiresAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  includeQuote: boolean;
  includeMockups: boolean;
  includeDrawings: boolean;
  allowResponses: boolean;
};

const t = strings.collaboration;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function SharePanel({
  projectId,
  shares,
  canShare,
}: {
  projectId: string;
  shares: ShareRow[];
  canShare: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState({
    includeQuote: true,
    includeMockups: true,
    includeDrawings: false,
    allowResponses: true,
  });
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function create() {
    setBusy('create');
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || null, ...scope, expiresInDays }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.createFailed);
        return;
      }
      setLabel('');
      router.refresh();
    } catch {
      setError(t.createFailed);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(shareId: string) {
    setBusy(shareId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/shares/${shareId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(t.revokeFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(t.revokeFailed);
    } finally {
      setBusy(null);
    }
  }

  const toggle = (key: keyof typeof scope) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={scope[key]}
        onChange={(event) => setScope({ ...scope, [key]: event.target.checked })}
      />
      <span>
        {key === 'includeQuote'
          ? t.includeQuote
          : key === 'includeMockups'
            ? t.includeMockups
            : key === 'includeDrawings'
              ? t.includeDrawings
              : t.allowResponses}
      </span>
    </label>
  );

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{t.sharesTitle}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.sharesSubtitle}</p>

      {shares.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t.noShares}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {shares.map((share) => (
            <li key={share.id} className="rounded-md border border-line p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{share.label ?? 'Client link'}</span>
                <span className="text-xs text-ink-muted">
                  {share.active
                    ? share.viewCount > 0
                      ? `${t.viewed} ${share.viewCount} ${t.times}`
                      : t.neverViewed
                    : share.revoked
                      ? t.revoked
                      : t.expired}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {[
                  share.includeQuote ? 'quote' : null,
                  share.includeMockups ? 'mockups' : null,
                  share.includeDrawings ? 'drawing' : null,
                  share.allowResponses ? 'can reply' : 'read-only',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {share.expiresAt
                  ? ` · expires ${dateFormat.format(new Date(share.expiresAt))}`
                  : ''}
              </p>

              {share.active ? (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(`${window.location.origin}${share.path}`)
                        .then(() => setCopied(share.id))
                        .catch(() => setError(t.createFailed));
                    }}
                    className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    {copied === share.id ? t.copied : t.copy}
                  </button>
                  {canShare ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => revoke(share.id)}
                      className="text-ink-muted underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
                    >
                      {t.revoke}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canShare ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-medium">{t.createHeading}</p>
          {/* Said plainly: nothing is delivered. */}
          <p className="mt-1 text-xs text-ink-muted">{t.noEmail}</p>

          <input
            className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            placeholder={t.labelPlaceholder}
            maxLength={160}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />

          <div className="mt-2 flex flex-col gap-1">
            {toggle('includeQuote')}
            {toggle('includeMockups')}
            {toggle('includeDrawings')}
            {toggle('allowResponses')}
          </div>

          <label className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-ink-muted">{t.expiresIn}</span>
            <select
              value={expiresInDays ?? ''}
              onChange={(event) =>
                setExpiresInDays(event.target.value === '' ? null : Number(event.target.value))
              }
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
            >
              <option value="">{t.never}</option>
              {[7, 14, 30, 90].map((days) => (
                <option key={days} value={days}>
                  {days} {t.days}
                </option>
              ))}
            </select>
          </label>

          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

          <button
            type="button"
            disabled={busy !== null}
            onClick={create}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'create' ? t.creating : t.create}
          </button>
        </div>
      ) : null}
    </section>
  );
}
