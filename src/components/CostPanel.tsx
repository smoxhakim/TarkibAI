'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { formatMoney } from '@/lib/materials/format';

export type CostBreakdownView = {
  materialsCostCents: number;
  laborCostCents: number;
  transportCostCents: number;
  installCostCents: number;
  otherCostCents: number;
  internalTotalCents: number;
  marginCents: number;
  clientSubtotalCents: number;
  taxCents: number;
  clientTotalCents: number;
  computedAt: string;
};

export type ProjectExpenseView = {
  id: string;
  label: string;
  amountCents: number;
};

function Line({
  label,
  cents,
  currency,
  emphasis,
}: {
  label: string;
  cents: number;
  currency: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 py-1 text-sm ${
        emphasis ? 'border-t border-line pt-2 font-medium' : ''
      }`}
    >
      <dt className={emphasis ? '' : 'text-ink-muted'}>{label}</dt>
      <dd className="text-right tabular-nums">{formatMoney(cents, currency)}</dd>
    </div>
  );
}

export function CostPanel({
  projectId,
  cost,
  expenses,
  currency,
  stale,
  blockedReason,
}: {
  projectId: string;
  cost: CostBreakdownView | null;
  expenses: ProjectExpenseView[];
  currency: string;
  stale: boolean;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [expenseLabel, setExpenseLabel] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [addingExpense, setAddingExpense] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function calculate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/costs/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.cost.calculateFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.cost.calculateFailed);
    } finally {
      setPending(false);
    }
  }

  async function addExpense() {
    const amount = Math.round(Number(expenseAmount.replace(',', '.')) * 100);
    if (!expenseLabel.trim() || !Number.isFinite(amount) || amount < 0) return;

    setAddingExpense(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: expenseLabel.trim(), amountCents: amount }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.cost.calculateFailed);
        return;
      }
      setExpenseLabel('');
      setExpenseAmount('');
      router.refresh();
    } finally {
      setAddingExpense(false);
    }
  }

  async function removeExpense(expenseId: string) {
    await fetch(`/api/projects/${projectId}/expenses/${expenseId}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{strings.cost.title}</h2>
        <Link
          href="/settings/costing"
          className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {strings.cost.settingsLink}
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{strings.cost.subtitle}</p>

      {/* Expenses are internal inputs, editable before calculating. */}
      <div className="mt-4 rounded-md border border-line p-3">
        <p className="text-sm font-medium">{strings.cost.expenses}</p>
        {expenses.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">{strings.cost.noExpenses}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {expenses.map((expense) => (
              <li key={expense.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{expense.label}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMoney(expense.amountCents, currency)}</span>
                  <button
                    type="button"
                    onClick={() => removeExpense(expense.id)}
                    className="text-xs text-red-600 underline-offset-2 hover:underline"
                  >
                    {strings.cost.removeExpense}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={expenseLabel}
            onChange={(e) => setExpenseLabel(e.target.value)}
            placeholder={strings.cost.expenseLabel}
            maxLength={160}
            disabled={addingExpense}
            aria-label={strings.cost.expenseLabel}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <input
            type="number"
            step="0.01"
            min={0}
            value={expenseAmount}
            onChange={(e) => setExpenseAmount(e.target.value)}
            placeholder={strings.cost.expenseAmount}
            disabled={addingExpense}
            aria-label={strings.cost.expenseAmount}
            className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <button
            type="button"
            onClick={addExpense}
            disabled={addingExpense || !expenseLabel.trim() || !expenseAmount}
            className="rounded-md border border-line px-3 py-1 text-sm transition-colors hover:border-accent disabled:opacity-50"
          >
            {addingExpense ? strings.cost.addingExpense : strings.cost.addExpense}
          </button>
        </div>
      </div>

      {blockedReason ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-3 py-3">
          <p className="text-sm">{blockedReason}</p>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={calculate}
            disabled={pending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending
              ? strings.cost.calculating
              : cost
                ? strings.cost.recalculate
                : strings.cost.calculate}
          </button>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {cost ? (
        <div className="mt-4">
          {stale ? (
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
              <p className="text-sm font-medium">{strings.cost.staleTitle}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{strings.cost.staleBody}</p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Internal and client figures are visually separated so nobody
                screenshots the wrong half for a client. */}
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-sm font-medium">{strings.cost.internalHeading}</p>
              <p className="mt-0.5 text-xs text-red-600">{strings.cost.internalWarning}</p>
              <dl className="mt-2">
                <Line label={strings.cost.materials} cents={cost.materialsCostCents} currency={currency} />
                <Line label={strings.cost.labor} cents={cost.laborCostCents} currency={currency} />
                <Line label={strings.cost.transport} cents={cost.transportCostCents} currency={currency} />
                <Line label={strings.cost.install} cents={cost.installCostCents} currency={currency} />
                <Line label={strings.cost.other} cents={cost.otherCostCents} currency={currency} />
                <Line
                  label={strings.cost.internalTotal}
                  cents={cost.internalTotalCents}
                  currency={currency}
                  emphasis
                />
                <Line label={strings.cost.margin} cents={cost.marginCents} currency={currency} />
              </dl>
            </div>

            <div className="rounded-md border border-line p-3">
              <p className="text-sm font-medium">{strings.cost.clientHeading}</p>
              <dl className="mt-2">
                <Line
                  label={strings.cost.clientSubtotal}
                  cents={cost.clientSubtotalCents}
                  currency={currency}
                />
                <Line label={strings.cost.tax} cents={cost.taxCents} currency={currency} />
                <Line
                  label={strings.cost.clientTotal}
                  cents={cost.clientTotalCents}
                  currency={currency}
                  emphasis
                />
              </dl>
            </div>
          </div>
        </div>
      ) : blockedReason ? null : (
        <p className="mt-3 text-sm text-ink-muted">{strings.cost.empty}</p>
      )}
    </section>
  );
}
