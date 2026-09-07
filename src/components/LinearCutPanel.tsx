'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

export type LinearCutView = {
  id: string;
  materialId: string;
  label: string | null;
  lengthMm: number;
  quantity: number;
};

export type LinearPlanSummary = {
  materialId: string;
  stockSizeLabel: string;
  barsUsed: number;
  wastePercent: string;
  kerfMm: number;
  usableRemnantsMm: number[];
  totalRequiredMm: number;
  totalPurchasedMm: number;
  unplaced: { label: string | null; lengthMm: number; quantity: number; reason: string }[];
  svg: string;
};

export type LinearMaterialOption = { id: string; name: string; barLabel: string };

const formatMm = (mm: number) => (Math.abs(mm) >= 1000 ? `${Number((mm / 1000).toFixed(3))} m` : `${mm} mm`);

export function LinearCutPanel({
  projectId,
  materials,
  cuts,
  plans,
}: {
  projectId: string;
  materials: LinearMaterialOption[];
  cuts: LinearCutView[];
  plans: LinearPlanSummary[];
}) {
  const router = useRouter();
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? '');
  const [draft, setDraft] = useState({ label: '', lengthMm: '', quantity: '1' });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addCut() {
    const length = Number(draft.lengthMm);
    const quantity = Number(draft.quantity);
    if (!materialId || !length || !quantity) return;

    setPending('add');
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/linear-cuts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId,
          label: draft.label.trim() || null,
          lengthMm: Math.round(length),
          quantity: Math.round(quantity),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const detail = payload.issues?.map((i: { message: string }) => i.message).join(' ');
        setError(detail || payload.error || strings.linearCutting.addFailed);
        return;
      }
      setDraft({ label: '', lengthMm: '', quantity: '1' });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function removeCut(cutId: string) {
    setPending(cutId);
    try {
      await fetch(`/api/projects/${projectId}/linear-cuts/${cutId}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function calculate(target: string) {
    setPending(`calc-${target}`);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/linear-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materialId: target }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.linearCutting.calculateFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.linearCutting.calculateFailed);
    } finally {
      setPending(null);
    }
  }

  if (materials.length === 0) {
    return (
      <section className="rounded-lg border border-line p-4">
        <h2 className="font-medium">{strings.linearCutting.title}</h2>
        <div className="mt-3 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium">{strings.linearCutting.noMaterials}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.linearCutting.noMaterialsHint}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{strings.linearCutting.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{strings.linearCutting.subtitle}</p>

      <div className="mt-4 rounded-md border border-line p-3">
        <p className="text-sm font-medium">{strings.linearCutting.cutsTitle}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{strings.linearCutting.cutsHint}</p>

        {cuts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{strings.linearCutting.noCuts}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {cuts.map((cut) => (
              <li key={cut.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {cut.label ? `${cut.label} — ` : ''}
                  {cut.lengthMm} mm × {cut.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => removeCut(cut.id)}
                  disabled={pending === cut.id}
                  className="text-xs text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {strings.linearCutting.removeCut}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          <select
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            aria-label="Material"
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent sm:col-span-2"
          >
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.name} ({material.barLabel})
              </option>
            ))}
          </select>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder={strings.linearCutting.cutLabel}
            aria-label={strings.linearCutting.cutLabel}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <input
            type="number"
            value={draft.lengthMm}
            onChange={(e) => setDraft({ ...draft, lengthMm: e.target.value })}
            placeholder={strings.linearCutting.cutLength}
            aria-label={strings.linearCutting.cutLength}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <input
            type="number"
            min={1}
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
            placeholder={strings.linearCutting.cutQuantity}
            aria-label={strings.linearCutting.cutQuantity}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
        </div>

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={addCut}
            disabled={pending === 'add' || !draft.lengthMm}
            className="rounded-md border border-line px-3 py-1 text-sm transition-colors hover:border-accent disabled:opacity-50"
          >
            {pending === 'add' ? strings.linearCutting.adding : strings.linearCutting.addCut}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {materials.map((material) => {
          const plan = plans.find((p) => p.materialId === material.id);
          const materialCuts = cuts.filter((c) => c.materialId === material.id);

          return (
            <div key={material.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {material.name} <span className="text-ink-muted">({material.barLabel})</span>
                </p>
                <button
                  type="button"
                  onClick={() => calculate(material.id)}
                  disabled={pending === `calc-${material.id}` || materialCuts.length === 0}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {pending === `calc-${material.id}`
                    ? strings.linearCutting.calculating
                    : plan
                      ? strings.linearCutting.recalculate
                      : strings.linearCutting.calculate}
                </button>
              </div>

              {!plan ? (
                <p className="mt-2 text-sm text-ink-muted">{strings.linearCutting.noPlan}</p>
              ) : (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.linearCutting.barsUsed}</dt>
                      <dd className="text-sm font-medium">{plan.barsUsed}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.linearCutting.waste}</dt>
                      <dd className="text-sm font-medium">{Number(plan.wastePercent)}%</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.linearCutting.kerf}</dt>
                      <dd className="text-sm font-medium">{plan.kerfMm} mm</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.linearCutting.required}</dt>
                      <dd className="text-sm font-medium">{formatMm(plan.totalRequiredMm)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.linearCutting.usableRemnants}</dt>
                      <dd className="text-sm font-medium">
                        {plan.usableRemnantsMm.length === 0
                          ? '—'
                          : plan.usableRemnantsMm.map((mm) => formatMm(mm)).join(', ')}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-2 text-xs text-ink-muted">{strings.linearCutting.supersedes}</p>

                  {plan.unplaced.length > 0 ? (
                    <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                      <p className="text-sm font-medium">{strings.linearCutting.unplacedTitle}</p>
                      <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink-muted">
                        {plan.unplaced.map((row, index) => (
                          <li key={index}>
                            {row.label ? `${row.label} — ` : ''}
                            {formatMm(row.lengthMm)} × {row.quantity}: {row.reason}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-ink-muted">{strings.linearCutting.unplacedHint}</p>
                    </div>
                  ) : null}

                  {plan.svg ? (
                    <div className="mt-3">
                      <p className="text-xs text-ink-muted">{strings.linearCutting.remnantLegend}</p>
                      <div
                        className="mt-1 overflow-hidden rounded-md border border-line"
                        // Generated by our own renderer from validated plan data;
                        // labels are XML-escaped there.
                        dangerouslySetInnerHTML={{ __html: plan.svg }}
                      />
                    </div>
                  ) : null}

                  <p className="mt-2 text-xs text-ink-muted">{strings.linearCutting.settingsNote}</p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
