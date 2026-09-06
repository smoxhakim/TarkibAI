'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { strings } from '@/lib/strings';
import { bpToPercent, percentToBp } from '@/lib/calc/costs/schema';

export type CostSettingsValues = {
  laborType: string;
  laborBp: number;
  laborCents: number;
  transportType: string;
  transportBp: number;
  transportCents: number;
  installType: string;
  installBp: number;
  installCents: number;
  marginBp: number;
  taxBp: number;
  currency: string;
};

const inputClass =
  'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60';

const toMajor = (cents: number) => (cents / 100).toFixed(2);
const toCents = (major: string) => Math.round(Number(major.replace(',', '.')) * 100);

/** One configurable component: a type selector plus the field that type needs. */
function Component({
  id,
  label,
  type,
  percent,
  amount,
  currency,
  allowManual,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  type: string;
  percent: string;
  amount: string;
  currency: string;
  allowManual: boolean;
  disabled: boolean;
  onChange: (next: { type?: string; percent?: string; amount?: string }) => void;
}) {
  return (
    <div className="rounded-md border border-line p-3">
      <p className="text-sm font-medium">{label}</p>
      <label htmlFor={`${id}-type`} className="sr-only">
        {label}
      </label>
      <select
        id={`${id}-type`}
        value={type}
        onChange={(e) => onChange({ type: e.target.value })}
        disabled={disabled}
        className={inputClass}
      >
        <option value="percent">{strings.costSettings.typePercent}</option>
        <option value="fixed">{strings.costSettings.typeFixed}</option>
        {allowManual ? <option value="manual">{strings.costSettings.typeManual}</option> : null}
      </select>

      {/* Only the field the selected type actually uses is shown, so a stale
          value in the other field cannot look like it is in effect. */}
      {type === 'percent' ? (
        <div className="mt-2">
          <label htmlFor={`${id}-percent`} className="text-xs text-ink-muted">
            {strings.costSettings.percentSuffix}
          </label>
          <input
            id={`${id}-percent`}
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => onChange({ percent: e.target.value })}
            disabled={disabled}
            className={inputClass}
          />
        </div>
      ) : null}

      {type === 'fixed' ? (
        <div className="mt-2">
          <label htmlFor={`${id}-amount`} className="text-xs text-ink-muted">
            {currency}
          </label>
          <input
            id={`${id}-amount`}
            type="number"
            step="0.01"
            min={0}
            value={amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            disabled={disabled}
            className={inputClass}
          />
        </div>
      ) : null}

      {type === 'manual' ? (
        <p className="mt-2 text-xs text-ink-muted">{strings.costSettings.typeManual}</p>
      ) : null}
    </div>
  );
}

export function CostSettingsForm({ initial }: { initial: CostSettingsValues }) {
  const router = useRouter();
  const [values, setValues] = useState({
    laborType: initial.laborType,
    laborPercent: String(bpToPercent(initial.laborBp)),
    laborAmount: toMajor(initial.laborCents),
    transportType: initial.transportType,
    transportPercent: String(bpToPercent(initial.transportBp)),
    transportAmount: toMajor(initial.transportCents),
    installType: initial.installType,
    installPercent: String(bpToPercent(initial.installBp)),
    installAmount: toMajor(initial.installCents),
    marginPercent: String(bpToPercent(initial.marginBp)),
    taxPercent: String(bpToPercent(initial.taxBp)),
    currency: initial.currency,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<typeof values>) => {
    setValues((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const numeric = (raw: string) => {
      const parsed = Number(raw.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    try {
      const res = await fetch('/api/cost-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          laborType: values.laborType,
          laborBp: percentToBp(numeric(values.laborPercent)),
          laborCents: toCents(values.laborAmount),
          transportType: values.transportType,
          transportBp: percentToBp(numeric(values.transportPercent)),
          transportCents: toCents(values.transportAmount),
          installType: values.installType,
          installBp: percentToBp(numeric(values.installPercent)),
          installCents: toCents(values.installAmount),
          marginBp: percentToBp(numeric(values.marginPercent)),
          taxBp: percentToBp(numeric(values.taxPercent)),
          currency: values.currency.trim() || 'MAD',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload.issues?.map((i: { message: string }) => i.message).join(' ');
        setError(detail || payload.error || strings.costSettings.saveFailed);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError(strings.costSettings.saveFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-sm text-ink-muted">{strings.costSettings.percentBase}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Component
          id="labor"
          label={strings.costSettings.labor}
          type={values.laborType}
          percent={values.laborPercent}
          amount={values.laborAmount}
          currency={values.currency}
          allowManual
          disabled={pending}
          onChange={(next) =>
            set({
              ...(next.type ? { laborType: next.type } : {}),
              ...(next.percent !== undefined ? { laborPercent: next.percent } : {}),
              ...(next.amount !== undefined ? { laborAmount: next.amount } : {}),
            })
          }
        />
        <Component
          id="transport"
          label={strings.costSettings.transport}
          type={values.transportType}
          percent={values.transportPercent}
          amount={values.transportAmount}
          currency={values.currency}
          allowManual
          disabled={pending}
          onChange={(next) =>
            set({
              ...(next.type ? { transportType: next.type } : {}),
              ...(next.percent !== undefined ? { transportPercent: next.percent } : {}),
              ...(next.amount !== undefined ? { transportAmount: next.amount } : {}),
            })
          }
        />
        <Component
          id="install"
          label={strings.costSettings.install}
          type={values.installType}
          percent={values.installPercent}
          amount={values.installAmount}
          currency={values.currency}
          allowManual
          disabled={pending}
          onChange={(next) =>
            set({
              ...(next.type ? { installType: next.type } : {}),
              ...(next.percent !== undefined ? { installPercent: next.percent } : {}),
              ...(next.amount !== undefined ? { installAmount: next.amount } : {}),
            })
          }
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-line p-3">
          <label htmlFor="margin" className="text-sm font-medium">
            {strings.costSettings.margin} ({strings.costSettings.percentSuffix})
          </label>
          <input
            id="margin"
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={values.marginPercent}
            onChange={(e) => set({ marginPercent: e.target.value })}
            disabled={pending}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-muted">{strings.costSettings.marginNote}</p>
        </div>

        <div className="rounded-md border border-line p-3">
          <label htmlFor="tax" className="text-sm font-medium">
            {strings.costSettings.tax} ({strings.costSettings.percentSuffix})
          </label>
          <input
            id="tax"
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={values.taxPercent}
            onChange={(e) => set({ taxPercent: e.target.value })}
            disabled={pending}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-muted">{strings.costSettings.taxNote}</p>
        </div>

        <div className="rounded-md border border-line p-3">
          <label htmlFor="currency" className="text-sm font-medium">
            {strings.costSettings.currency}
          </label>
          <input
            id="currency"
            value={values.currency}
            onChange={(e) => set({ currency: e.target.value })}
            maxLength={8}
            disabled={pending}
            className={inputClass}
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="mt-3 text-sm text-accent">{strings.costSettings.saved}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? strings.costSettings.saving : strings.costSettings.save}
      </button>
    </form>
  );
}
