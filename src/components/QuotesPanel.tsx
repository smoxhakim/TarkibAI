'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { calculateQuoteTotals } from '@/lib/quotes/engine';
import { formatMoney, formatQuantity, parseMoney, parseQuantity } from '@/lib/quotes/format';

export type QuoteLineView = {
  description: string;
  quantityMilli: number;
  unitLabel: string | null;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type ActiveQuote = {
  id: string;
  number: string;
  status: string;
  clientName: string;
  clientAddress: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  mockupId: string | null;
  currency: string;
  lines: QuoteLineView[];
  subtotalCents: number;
  taxBp: number;
  taxCents: number;
  totalCents: number;
  issuedAt: string | null;
  validUntil: string | null;
};

export type QuoteSummary = {
  id: string;
  number: string;
  status: string;
  clientName: string;
  totalCents: number;
  currency: string;
};

export type MockupOption = { id: string; label: string };

const t = strings.quotes;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const inputClass =
  'w-full rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent';

/** A line being edited. Quantity and price stay as typed until they are parsed. */
type DraftLine = { description: string; quantity: string; unitLabel: string; unitPrice: string };

function toDraft(line: QuoteLineView): DraftLine {
  return {
    description: line.description,
    quantity: formatQuantity(line.quantityMilli),
    unitLabel: line.unitLabel ?? '',
    unitPrice: (line.unitPriceCents / 100).toFixed(2),
  };
}

export function QuotesPanel({
  projectId,
  active,
  history,
  calculatedSubtotalCents,
  divergence,
  blockers,
  warnings,
  costBlockedReason,
  mockups,
  currency,
  canWrite,
}: {
  projectId: string;
  active: ActiveQuote | null;
  history: QuoteSummary[];
  calculatedSubtotalCents: number | null;
  divergence: { differenceCents: number; direction: 'above' | 'below' } | null;
  blockers: string[];
  warnings: string[];
  costBlockedReason: string | null;
  mockups: MockupOption[];
  currency: string;
  /**
   * Whether this reader holds `quote.create`. Secondary to the service, which
   * refuses the write regardless — this only stops offering an action that
   * would be refused.
   */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState({ name: '', address: '', phone: '', email: '' });
  const [lines, setLines] = useState<DraftLine[]>(() => (active?.lines ?? []).map(toDraft));
  const [lineKey, setLineKey] = useState(active?.id ?? '');

  // The panel re-renders with a different quote after a create or an issue.
  // Re-seeding here rather than in an effect keeps the edited state and the
  // quote it belongs to from drifting apart for a render.
  if (active && lineKey !== active.id) {
    setLineKey(active.id);
    setLines(active.lines.map(toDraft));
  }

  const editable = active !== null && active.status === 'draft';

  /** Parsed lines, or null when something the user typed is not a number. */
  const parsed = (() => {
    const out = [];
    for (const line of lines) {
      const quantityMilli = parseQuantity(line.quantity);
      const unitPriceCents = parseMoney(line.unitPrice);
      if (quantityMilli === null || unitPriceCents === null || line.description.trim() === '') {
        return null;
      }
      out.push({
        description: line.description.trim(),
        quantityMilli,
        unitLabel: line.unitLabel.trim() === '' ? null : line.unitLabel.trim(),
        unitPriceCents,
      });
    }
    return out;
  })();

  // Computed with the same engine the server uses, so the figures on screen and
  // the figures on the PDF cannot disagree.
  const preview =
    parsed !== null && active !== null ? calculateQuoteTotals(parsed, active.taxBp) : null;

  async function call(action: string, path: string, init: RequestInit, fallback: string) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(path, init);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? fallback);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    call(
      'create',
      `/api/projects/${projectId}/quotes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: client.name,
          clientAddress: client.address || null,
          clientPhone: client.phone || null,
          clientEmail: client.email || null,
        }),
      },
      t.createFailed
    );

  const saveLines = () => {
    if (!active || parsed === null) {
      setError(t.invalidNumbers);
      return;
    }
    return call(
      'lines',
      `/api/projects/${projectId}/quotes/${active.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: parsed }),
      },
      t.linesFailed
    );
  };

  const setMockup = (mockupId: string) =>
    active &&
    call(
      'mockup',
      `/api/projects/${projectId}/quotes/${active.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mockupId: mockupId === '' ? null : mockupId }),
      },
      t.linesFailed
    );

  const issue = () =>
    active &&
    call('issue', `/api/projects/${projectId}/quotes/${active.id}/issue`, { method: 'POST' }, t.issueFailed);

  const remove = () =>
    active &&
    call(
      'delete',
      `/api/projects/${projectId}/quotes/${active.id}`,
      { method: 'DELETE' },
      t.deleteFailed
    );

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{t.title}</h2>
        <Link
          href="/settings/quotes"
          className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {t.settingsLink}
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

      {costBlockedReason && !active ? (
        <p className="mt-3 rounded-md border border-line bg-surface-muted p-3 text-sm text-ink-muted">
          {costBlockedReason}
        </p>
      ) : null}

      {/* ---- Create ---- */}
      {!active ? (
        <div className="mt-4">
          <p className="text-sm text-ink-muted">{t.none}</p>
          {!costBlockedReason ? (
            <div className="mt-3 rounded-md border border-line p-3">
              <p className="text-sm font-medium">{t.createHeading}</p>
              <p className="mt-1 text-xs text-ink-muted">{t.seedNote}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input
                  className={inputClass}
                  placeholder={t.clientName}
                  value={client.name}
                  onChange={(e) => setClient({ ...client, name: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder={t.clientPhone}
                  value={client.phone}
                  onChange={(e) => setClient({ ...client, phone: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder={t.clientAddress}
                  value={client.address}
                  onChange={(e) => setClient({ ...client, address: e.target.value })}
                />
                <input
                  className={inputClass}
                  type="email"
                  placeholder={t.clientEmail}
                  value={client.email}
                  onChange={(e) => setClient({ ...client, email: e.target.value })}
                />
              </div>
              <button
                type="button"
                disabled={busy !== null || client.name.trim() === ''}
                onClick={create}
                {...(canWrite ? {} : { disabled: true })}
                className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy === 'create' ? t.creating : t.create}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Active quote ---- */}
      {active ? (
        <div className="mt-4 rounded-md border border-line p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium tabular-nums">{active.number}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                active.status === 'issued'
                  ? 'bg-accent/10 text-accent'
                  : 'bg-surface-muted text-ink-muted'
              }`}
            >
              {active.status === 'issued' ? t.statusIssued : t.statusDraft}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{active.clientName}</p>
          {active.issuedAt ? (
            <p className="mt-1 text-xs text-ink-muted">
              {t.issuedOn} {dateFormat.format(new Date(active.issuedAt))}
              {active.validUntil
                ? ` · ${t.validUntil} ${dateFormat.format(new Date(active.validUntil))}`
                : ''}
            </p>
          ) : null}

          {/* ---- Lines ---- */}
          <p className="mt-4 text-sm font-medium">{t.linesHeading}</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="pb-1 font-medium">{t.description}</th>
                  <th className="w-20 pb-1 text-right font-medium">{t.quantity}</th>
                  <th className="w-16 pb-1 font-medium">{t.unit}</th>
                  <th className="w-28 pb-1 text-right font-medium">{t.unitPrice}</th>
                  <th className="w-28 pb-1 text-right font-medium">{t.lineTotal}</th>
                  {editable ? <th className="w-8 pb-1" /> : null}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const total = preview?.lines[index]?.lineTotalCents ?? null;
                  return (
                    <tr key={index} className="border-b border-line/60">
                      <td className="py-1.5 pr-2">
                        {editable ? (
                          <input
                            className={inputClass}
                            value={line.description}
                            onChange={(e) =>
                              setLines(
                                lines.map((l, i) =>
                                  i === index ? { ...l, description: e.target.value } : l
                                )
                              )
                            }
                          />
                        ) : (
                          line.description
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {editable ? (
                          <input
                            className={`${inputClass} text-right`}
                            value={line.quantity}
                            onChange={(e) =>
                              setLines(
                                lines.map((l, i) =>
                                  i === index ? { ...l, quantity: e.target.value } : l
                                )
                              )
                            }
                          />
                        ) : (
                          line.quantity
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        {editable ? (
                          <input
                            className={inputClass}
                            value={line.unitLabel}
                            onChange={(e) =>
                              setLines(
                                lines.map((l, i) =>
                                  i === index ? { ...l, unitLabel: e.target.value } : l
                                )
                              )
                            }
                          />
                        ) : (
                          line.unitLabel
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {editable ? (
                          <input
                            className={`${inputClass} text-right`}
                            value={line.unitPrice}
                            onChange={(e) =>
                              setLines(
                                lines.map((l, i) =>
                                  i === index ? { ...l, unitPrice: e.target.value } : l
                                )
                              )
                            }
                          />
                        ) : (
                          formatMoney(Math.round(Number(line.unitPrice) * 100), active.currency)
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {total === null ? '—' : formatMoney(total, active.currency)}
                      </td>
                      {editable ? (
                        <td className="py-1.5 text-right">
                          <button
                            type="button"
                            aria-label={t.removeLine}
                            onClick={() => setLines(lines.filter((_, i) => i !== index))}
                            className="text-ink-muted transition-colors hover:text-danger"
                          >
                            ×
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editable ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setLines([...lines, { description: '', quantity: '1', unitLabel: '', unitPrice: '0.00' }])
                }
                className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {t.addLine}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={saveLines}
                {...(canWrite ? {} : { disabled: true })}
                className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
              >
                {busy === 'lines' ? t.savingLines : t.saveLines}
              </button>
            </div>
          ) : null}

          {/* ---- Totals ---- */}
          <dl className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">{t.subtotal}</dt>
              <dd className="tabular-nums">
                {formatMoney(preview?.subtotalCents ?? active.subtotalCents, active.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">
                {t.tax} ({(active.taxBp / 100).toFixed(active.taxBp % 100 === 0 ? 0 : 2)}%)
              </dt>
              <dd className="tabular-nums">
                {formatMoney(preview?.taxCents ?? active.taxCents, active.currency)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-1 font-medium">
              <dt>{t.total}</dt>
              <dd className="tabular-nums">
                {formatMoney(preview?.totalCents ?? active.totalCents, active.currency)}
              </dd>
            </div>
          </dl>

          {calculatedSubtotalCents !== null ? (
            <p className="mt-2 text-xs text-ink-muted">
              {t.calculatedSubtotal}: {formatMoney(calculatedSubtotalCents, currency)}
            </p>
          ) : null}

          {/* A deviation from the calculated price is legitimate. Making it
              silent would not be. */}
          {divergence ? (
            <p className="mt-2 rounded-md border border-line bg-surface-muted p-2 text-xs text-ink-muted">
              {(divergence.direction === 'above' ? t.divergenceAbove : t.divergenceBelow).replace(
                '{amount}',
                formatMoney(divergence.differenceCents, active.currency)
              )}{' '}
              {t.divergenceNote}
            </p>
          ) : null}

          {/* ---- Mockup ---- */}
          {editable ? (
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.mockupHeading}</span>
              {mockups.length === 0 ? (
                <span className="text-xs text-ink-muted">{t.mockupNoneAvailable}</span>
              ) : (
                <select
                  className={inputClass}
                  value={active.mockupId ?? ''}
                  onChange={(e) => setMockup(e.target.value)}
                  {...(canWrite ? {} : { disabled: true })}
                >
                  <option value="">{t.mockupNone}</option>
                  {mockups.map((mockup) => (
                    <option key={mockup.id} value={mockup.id}>
                      {mockup.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ) : null}

          {warnings.map((warning) => (
            <p
              key={warning}
              className="mt-3 rounded-md border border-line bg-surface-muted p-2 text-xs text-ink-muted"
            >
              {warning}
            </p>
          ))}

          {blockers.length > 0 ? (
            <div className="mt-3 rounded-md border border-line bg-surface-muted p-3 text-xs text-ink-muted">
              <p className="font-medium">{t.blockedHeading}</p>
              <ul className="mt-1 list-disc pl-4">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

          {/* ---- Actions ---- */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={`/api/projects/${projectId}/quotes/${active.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
            >
              {active.status === 'issued' ? t.download : t.preview}
            </a>
            {editable ? (
              <>
                <button
                  type="button"
                  disabled={busy !== null || blockers.length > 0}
                  onClick={issue}
                  {...(canWrite ? {} : { disabled: true })}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy === 'issue' ? t.issuing : t.issue}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={remove}
                  {...(canWrite ? {} : { disabled: true })}
                  className="text-sm text-ink-muted underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
                >
                  {t.delete}
                </button>
              </>
            ) : (
              <span className="text-xs text-ink-muted">{t.issuedLocked}</span>
            )}
          </div>

          {editable ? <p className="mt-2 text-xs text-ink-muted">{t.issueNote}</p> : null}
        </div>
      ) : null}

      {/* ---- Earlier quotes ---- */}
      {history.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {history.map((quote) => (
            <li key={quote.id} className="flex items-center justify-between gap-3 text-ink-muted">
              <span className="tabular-nums">
                {quote.number} · {quote.clientName}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{formatMoney(quote.totalCents, quote.currency)}</span>
                <a
                  href={`/api/projects/${projectId}/quotes/${quote.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:text-ink hover:underline"
                >
                  {quote.status === 'issued' ? t.download : t.preview}
                </a>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
