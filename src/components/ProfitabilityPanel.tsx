'use client';

import { strings } from '@/lib/strings';
import { formatMoney } from '@/lib/quotes/format';

export type ProfitabilityView = {
  projectedMarginCents: number | null;
  projectedMarginBp: number | null;
  internalTotalCents: number | null;
  quotedSubtotalCents: number | null;
  recordedExpensesCents: number;
  missing: string[];
};

const t = strings.profitability;

export function ProfitabilityPanel({
  data,
  currency,
}: {
  data: ProfitabilityView;
  currency: string;
}) {
  const money = (cents: number | null) => (cents === null ? '—' : formatMoney(cents, currency));

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{t.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

      <dl className="mt-3 flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">{t.quoted}</dt>
          <dd className="tabular-nums">{money(data.quotedSubtotalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">{t.estimated}</dt>
          <dd className="tabular-nums">{money(data.internalTotalCents)}</dd>
        </div>
        {data.recordedExpensesCents > 0 ? (
          <div className="flex justify-between">
            <dt className="text-ink-muted">{t.expenses}</dt>
            <dd className="tabular-nums">{money(data.recordedExpensesCents)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-line pt-1 font-medium">
          <dt>{t.margin}</dt>
          <dd
            className={`tabular-nums ${
              data.projectedMarginCents !== null && data.projectedMarginCents < 0
                ? 'text-danger'
                : ''
            }`}
          >
            {money(data.projectedMarginCents)}
            {data.projectedMarginBp !== null ? (
              <span className="ml-2 text-xs text-ink-muted">
                {(data.projectedMarginBp / 100).toFixed(1)}%
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {data.missing.length > 0 ? (
        <ul className="mt-3 list-disc pl-4 text-xs text-ink-muted">
          {data.missing.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {/* Said on the panel, not only in the docs: this is an estimate. */}
      <p className="mt-3 text-xs text-ink-muted">{t.projectionNote}</p>
    </section>
  );
}
