'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { formatMoney } from '@/lib/materials/format';

type OutcomeView = {
  materialId: string;
  name: string;
  stockUnits: number;
  wastePercent: number;
  /** Null when the reader's role may not see internal cost. */
  totalCostCents: number | null;
};

export type RecommendationView = {
  kind: 'sheet_alternative' | 'bar_alternative' | 'allow_rotation';
  current: OutcomeView;
  alternative: OutcomeView;
  /** Null when the reader's role may not see internal cost. */
  savingCents: number | null;
  savingUnits: number;
  wasteReductionPercent: number;
  summary: string;
};

export function EfficiencyPanel({
  projectId,
  recommendations,
  emptyReason,
  currency,
  showsPrices,
  canApply,
}: {
  projectId: string;
  recommendations: RecommendationView[];
  emptyReason: string | null;
  currency: string;
  /** Whether this reader holds `cost.view`. The server has already withheld the
   *  figures if not; this decides what is said in their place. */
  showsPrices: boolean;
  /** Whether this reader holds `project.edit`. Applying a recommendation
   *  rewrites the project's materials and deletes its cutting plan. */
  canApply: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(fromMaterialId: string, toMaterialId: string) {
    setPending(`${fromMaterialId}->${toMaterialId}`);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/recommendations/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromMaterialId, toMaterialId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.efficiency.applyFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.efficiency.applyFailed);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{strings.efficiency.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{strings.efficiency.subtitle}</p>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {recommendations.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium">{strings.efficiency.none}</p>
          {emptyReason ? <p className="mt-1 text-sm text-ink-muted">{emptyReason}</p> : null}
          <p className="mt-1 text-xs text-ink-muted">{strings.efficiency.libraryOnly}</p>
        </div>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-3">
            {recommendations.map((recommendation, index) => (
              <li
                key={`${recommendation.kind}-${index}`}
                className="rounded-md border border-accent/40 bg-accent/5 p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {recommendation.savingCents === null ? null : (
                      <>
                        {strings.efficiency.saving}{' '}
                        <span className="text-accent">
                          {formatMoney(recommendation.savingCents, currency)}
                        </span>
                      </>
                    )}
                    {recommendation.savingUnits > 0 ? (
                      <span className="text-ink-muted">
                        {' · '}
                        {recommendation.savingUnits} {strings.efficiency.fewerUnits}
                      </span>
                    ) : null}
                    {recommendation.wasteReductionPercent > 0 ? (
                      <span className="text-ink-muted">
                        {' · '}
                        {recommendation.wasteReductionPercent}% {strings.efficiency.lessWaste}
                      </span>
                    ) : null}
                  </p>
                  {recommendation.kind === 'allow_rotation' ? (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
                      {strings.efficiency.rotationTitle}
                    </span>
                  ) : null}
                </div>

                <p className="mt-1 text-sm text-ink-muted">{recommendation.summary}</p>

                <dl className="mt-2 grid grid-cols-2 gap-x-4 text-xs">
                  <div>
                    <dt className="text-ink-muted">{strings.efficiency.currentLabel}</dt>
                    <dd>
                      {recommendation.current.name} · {recommendation.current.stockUnits}{' '}
                      {strings.efficiency.unitsSuffix}
                      {recommendation.current.totalCostCents === null
                        ? ''
                        : ` · ${formatMoney(recommendation.current.totalCostCents, currency)}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">{strings.efficiency.alternativeLabel}</dt>
                    <dd>
                      {recommendation.alternative.name} · {recommendation.alternative.stockUnits}{' '}
                      {strings.efficiency.unitsSuffix}
                      {recommendation.alternative.totalCostCents === null
                        ? ''
                        : ` · ${formatMoney(recommendation.alternative.totalCostCents, currency)}`}
                    </dd>
                  </div>
                </dl>

                {/* Rotation is a property of the piece, not a material swap, so
                    it is reported without an apply action — the user decides
                    whether the material really has no grain. */}
                {recommendation.kind !== 'allow_rotation' ? (
                  <button
                    type="button"
                    onClick={() =>
                      apply(recommendation.current.materialId, recommendation.alternative.materialId)
                    }
                    disabled={
                      !canApply ||
                      pending ===
                        `${recommendation.current.materialId}->${recommendation.alternative.materialId}`
                    }
                    className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {pending ===
                    `${recommendation.current.materialId}->${recommendation.alternative.materialId}`
                      ? strings.efficiency.applying
                      : strings.efficiency.apply}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">{strings.efficiency.computedNote}</p>
          <p className="mt-1 text-xs text-ink-muted">{strings.efficiency.applyNote}</p>
          {showsPrices ? null : (
            <p className="mt-1 text-xs text-ink-muted">{strings.efficiency.noPrices}</p>
          )}
        </>
      )}
    </section>
  );
}
