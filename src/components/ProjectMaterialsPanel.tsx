'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { formatMoney } from '@/lib/materials/format';
import { ProjectMaterialRow } from './ProjectMaterialRow';

export type SelectedMaterial = {
  id: string;
  materialId: string;
  name: string;
  category: string;
  measurementModel: string;
  role: string | null;
  /** Null when the reader's role may not see internal prices. */
  unitPriceCents: number | null;
  requiredQuantity: string | null;
  requiredDimensions: string | null;
  unitsToPurchase: number | null;
  totalPurchasedQuantity: string | null;
  wasteQuantity: string | null;
  wastePercent: string | null;
  unitPriceCentsSnapshot: number | null;
  totalCostCents: number | null;
  calculatedAt: string | Date | null;
  unsupportedReason: string | null;
  steps: { label: string; value: string }[];
  warnings: { code: string; message: string }[];
  staleReasons: ('spec_changed' | 'material_changed' | 'requirement_changed')[];
};

export type PickableMaterial = {
  id: string;
  name: string;
  category: string;
};

export function ProjectMaterialsPanel({
  projectId,
  selected,
  library,
  currency,
  specApproved,
  showsPrices,
}: {
  projectId: string;
  selected: SelectedMaterial[];
  library: PickableMaterial[];
  currency: string;
  specApproved: boolean;
  /** Whether this reader holds `cost.view`. The server has already withheld
   *  the figures if not; this decides what the panel says in their place. */
  showsPrices: boolean;
}) {
  const router = useRouter();
  const [materialId, setMaterialId] = useState('');
  const [role, setRole] = useState('');
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anyCalculated = selected.some((row) => row.calculatedAt !== null);
  const anyRequirement = selected.some((row) => row.requiredQuantity !== null);
  // Only lines that actually produced a cost contribute to the total. For a
  // reader without cost.view every line arrives with a null cost, so this is
  // zero and is never rendered — the guard below is what decides that, not the
  // sum coming out at zero.
  const totalCostCents = selected.reduce((sum, row) => sum + (row.totalCostCents ?? 0), 0);

  async function saveRequirement(
    id: string,
    requiredQuantity: number | null,
    requiredDimensions: string | null
  ) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/materials/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requiredQuantity, requiredDimensions }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.projectMaterials.addFailed);
        return;
      }
      router.refresh();
    } finally {
      setSavingId(null);
    }
  }

  async function calculate() {
    setCalculating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/calculate-materials`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.projectMaterials.calculateFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.projectMaterials.calculateFailed);
    } finally {
      setCalculating(false);
    }
  }

  const selectedIds = new Set(selected.map((row) => row.materialId));
  const available = library.filter((material) => !selectedIds.has(material.id));

  async function add() {
    if (!materialId || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materialId, role: role.trim() || null }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.projectMaterials.addFailed);
        return;
      }
      setMaterialId('');
      setRole('');
      router.refresh();
    } catch {
      setError(strings.projectMaterials.addFailed);
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/materials/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.projectMaterials.removeFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.projectMaterials.removeFailed);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{strings.projectMaterials.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{strings.projectMaterials.subtitle}</p>

      {library.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium">{strings.projectMaterials.emptyLibrary}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.projectMaterials.emptyLibraryHint}</p>
          <Link
            href="/materials"
            className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            {strings.projectMaterials.goToLibrary}
          </Link>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="pm-material" className="sr-only">
            {strings.projectMaterials.add}
          </label>
          <select
            id="pm-material"
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            disabled={pending || available.length === 0}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
          >
            <option value="">
              {available.length === 0 ? '—' : strings.projectMaterials.add}
            </option>
            {available.map((material) => (
              <option key={material.id} value={material.id}>
                {material.name} · {material.category}
              </option>
            ))}
          </select>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={strings.projectMaterials.rolePlaceholder}
            maxLength={160}
            disabled={pending}
            aria-label={strings.projectMaterials.rolePlaceholder}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-60"
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || !materialId}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? strings.projectMaterials.adding : strings.projectMaterials.add}
          </button>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {selected.length === 0 ? (
        library.length > 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-line px-4 py-8 text-center">
            <p className="text-sm font-medium">{strings.projectMaterials.empty}</p>
            <p className="mt-1 text-sm text-ink-muted">{strings.projectMaterials.emptyHint}</p>
          </div>
        ) : null
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-2">
            {selected.map((row) => (
              <ProjectMaterialRow
                key={row.id}
                row={row}
                currency={currency}
                busy={savingId === row.id || removingId === row.id}
                onSaveRequirement={saveRequirement}
                onRemove={remove}
              />
            ))}
          </ul>

          <div className="mt-4 border-t border-line pt-4">
            {!specApproved ? (
              <div className="rounded-md border border-dashed border-line px-3 py-3">
                <p className="text-sm font-medium">
                  {strings.projectMaterials.calculateBlockedTitle}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  Quantities are only calculated against an approved specification.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={calculate}
                  disabled={calculating || !anyRequirement}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {calculating
                    ? strings.projectMaterials.calculating
                    : anyCalculated
                      ? strings.projectMaterials.recalculate
                      : strings.projectMaterials.calculate}
                </button>

                {anyCalculated && showsPrices ? (
                  <div className="text-right">
                    <p className="text-sm">
                      <span className="text-ink-muted">
                        {strings.projectMaterials.totalMaterialCost}{' '}
                      </span>
                      <span className="font-medium">{formatMoney(totalCostCents, currency)}</span>
                    </p>
                    {/* Purchase prices are private business data and must never
                        reach a client document (PRD §22, ARCHITECTURE §15). */}
                    <p className="text-xs text-ink-muted">
                      {strings.projectMaterials.internalOnly}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              {showsPrices
                ? strings.projectMaterials.notCalculatedHint
                : strings.projectMaterials.noPrices}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
