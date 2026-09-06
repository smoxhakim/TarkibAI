'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { PRICE_UNIT_LABELS, type MeasurementModel } from '@/lib/materials/schema';
import { formatMoney } from '@/lib/materials/format';

export type SelectedMaterial = {
  id: string;
  materialId: string;
  name: string;
  category: string;
  measurementModel: string;
  role: string | null;
  unitPriceCents: number;
  requiredQuantity: string | null;
  unitsToPurchase: number | null;
  totalCostCents: number | null;
  calculatedAt: string | Date | null;
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
}: {
  projectId: string;
  selected: SelectedMaterial[];
  library: PickableMaterial[];
  currency: string;
}) {
  const router = useRouter();
  const [materialId, setMaterialId] = useState('');
  const [role, setRole] = useState('');
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
              <li
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{row.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {row.category}
                    {row.role ? ` · ${row.role}` : ''}
                    {' · '}
                    {formatMoney(row.unitPriceCents, currency)}{' '}
                    {PRICE_UNIT_LABELS[row.measurementModel as MeasurementModel]}
                  </p>
                  {/* No quantity, waste, or cost is shown until the calculation
                      engine has actually produced one. A zero here would be a
                      fabricated number (PRD §5.3). */}
                  <p className="mt-1 text-xs text-ink-muted">
                    {row.calculatedAt
                      ? `${row.requiredQuantity ?? ''} · ${row.unitsToPurchase ?? ''} to purchase`
                      : strings.projectMaterials.notCalculated}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  disabled={removingId === row.id}
                  className="text-xs text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {removingId === row.id
                    ? strings.projectMaterials.removing
                    : strings.projectMaterials.remove}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">{strings.projectMaterials.notCalculatedHint}</p>
        </>
      )}
    </section>
  );
}
