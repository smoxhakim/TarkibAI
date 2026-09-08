'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

export type SupplierRow = {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  leadTimeDays: number | null;
  notes: string | null;
};

const t = strings.suppliers;

const empty = { name: '', contact: '', phone: '', email: '', leadTimeDays: '', notes: '' };

export function SuppliersManager({
  suppliers,
  canManage,
}: {
  suppliers: SupplierRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input =
    'w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent';

  async function add() {
    if (draft.name.trim() === '') return;
    setBusy('add');
    setError(null);
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          contact: draft.contact || null,
          phone: draft.phone || null,
          email: draft.email || null,
          notes: draft.notes || null,
          leadTimeDays: draft.leadTimeDays === '' ? null : Number(draft.leadTimeDays),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.addFailed);
        return;
      }
      setDraft(empty);
      router.refresh();
    } catch {
      setError(t.addFailed);
    } finally {
      setBusy(null);
    }
  }

  async function archive(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(t.archiveFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(t.archiveFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-lg border border-line p-4">
        <h2 className="font-medium">{t.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

        {suppliers.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">{t.none}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {suppliers.map((supplier) => (
              <li
                key={supplier.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 text-sm"
              >
                <span>
                  <span className="font-medium">{supplier.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {[
                      supplier.contact,
                      supplier.phone,
                      supplier.email,
                      supplier.leadTimeDays !== null
                        ? `${supplier.leadTimeDays} ${t.leadTime.toLowerCase().replace(' (days)', '')} days`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {canManage ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => archive(supplier.id)}
                    className="text-xs text-ink-muted underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
                  >
                    {t.archive}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="rounded-lg border border-line p-4">
          <h2 className="font-medium">{t.add}</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              className={input}
              placeholder={t.name}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <input
              className={input}
              placeholder={t.contact}
              value={draft.contact}
              onChange={(event) => setDraft({ ...draft, contact: event.target.value })}
            />
            <input
              className={input}
              placeholder={t.phone}
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
            <input
              className={input}
              type="email"
              placeholder={t.email}
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <label className="flex flex-col gap-1 text-sm">
              <input
                className={input}
                type="number"
                min={0}
                max={365}
                placeholder={t.leadTime}
                value={draft.leadTimeDays}
                onChange={(event) => setDraft({ ...draft, leadTimeDays: event.target.value })}
              />
              <span className="text-xs text-ink-muted">{t.leadTimeNote}</span>
            </label>
            <input
              className={input}
              placeholder={t.notes}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>

          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

          <button
            type="button"
            disabled={busy !== null || draft.name.trim() === ''}
            onClick={add}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'add' ? t.adding : t.add}
          </button>
        </section>
      ) : null}
    </div>
  );
}
