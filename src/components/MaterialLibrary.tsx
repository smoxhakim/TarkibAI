'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { MEASUREMENT_MODELS, MEASUREMENT_MODEL_LABELS, PRICE_UNIT_LABELS } from '@/lib/materials/schema';
import type { MeasurementModel } from '@/lib/materials/schema';
import { formatMoney, formatStockSize, formatThickness } from '@/lib/materials/format';
import { MaterialForm, emptyMaterialForm, type MaterialFormValues } from './MaterialForm';

export type LibraryMaterial = {
  id: string;
  name: string;
  category: string;
  customCategory: boolean;
  supplier: string | null;
  measurementModel: string;
  standardLengthMm: number | null;
  sheetWidthMm: number | null;
  sheetHeightMm: number | null;
  thicknessMm: number | null;
  unitPriceCents: number;
  notes: string | null;
  archivedAt: string | null;
};

/**
 * Money is entered in major units for the user but stored as integer minor
 * units (ARCHITECTURE §10). Rounding here is the single conversion point;
 * everything downstream stays integer.
 */
function toCents(major: string): number {
  const parsed = Number.parseFloat(major.replace(',', '.'));
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed * 100);
}

const optionalNumber = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

function toFormValues(material: LibraryMaterial): MaterialFormValues {
  return {
    id: material.id,
    name: material.name,
    category: material.category,
    customCategory: material.customCategory,
    supplier: material.supplier ?? '',
    measurementModel: material.measurementModel as MeasurementModel,
    standardLengthMm: material.standardLengthMm?.toString() ?? '',
    sheetWidthMm: material.sheetWidthMm?.toString() ?? '',
    sheetHeightMm: material.sheetHeightMm?.toString() ?? '',
    thicknessMm: material.thicknessMm?.toString() ?? '',
    priceMajor: (material.unitPriceCents / 100).toFixed(2),
    notes: material.notes ?? '',
  };
}

export function MaterialLibrary({
  materials,
  categories,
  currency,
  showArchived,
  filters,
}: {
  materials: LibraryMaterial[];
  categories: string[];
  currency: string;
  showArchived: boolean;
  filters: { search: string; category: string; measurementModel: string };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<MaterialFormValues | null>(null);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function updateQuery(next: Partial<Record<string, string>>) {
    const params = new URLSearchParams();
    const merged = { ...filters, archived: showArchived ? 'true' : '', ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    router.push(`/materials${params.toString() ? `?${params}` : ''}`);
  }

  async function save(values: MaterialFormValues) {
    const cents = toCents(values.priceMajor);
    if (Number.isNaN(cents)) {
      setError('Enter a valid purchase price.');
      return;
    }

    const body = {
      name: values.name,
      category: values.category,
      customCategory: values.customCategory,
      supplier: values.supplier.trim() || null,
      measurementModel: values.measurementModel,
      standardLengthMm:
        values.measurementModel === 'linear' ? optionalNumber(values.standardLengthMm) : null,
      sheetWidthMm: values.measurementModel === 'sheet' ? optionalNumber(values.sheetWidthMm) : null,
      sheetHeightMm:
        values.measurementModel === 'sheet' ? optionalNumber(values.sheetHeightMm) : null,
      thicknessMm: optionalNumber(values.thicknessMm),
      unitPriceCents: cents,
      notes: values.notes.trim() || null,
    };

    setPending(true);
    setError(null);
    try {
      const res = await fetch(values.id ? `/api/materials/${values.id}` : '/api/materials', {
        method: values.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Field-level validation messages are more useful than a generic failure.
        const detail = payload.issues?.map((i: { message: string }) => i.message).join(' ');
        setError(detail || payload.error || strings.materials.saveFailed);
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError(strings.materials.saveFailed);
    } finally {
      setPending(false);
    }
  }

  async function setArchived(id: string, archived: boolean) {
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/materials/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setRowError(payload.error ?? strings.materials.saveFailed);
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        // A material in use returns 409 with an explanation telling the user to
        // archive instead. Surfacing that message verbatim is the useful thing.
        setRowError(payload.error ?? strings.materials.deleteFailed);
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const hasFilters = Boolean(filters.search || filters.category || filters.measurementModel);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="m-search" className="sr-only">
            {strings.materials.search}
          </label>
          <input
            id="m-search"
            defaultValue={filters.search}
            placeholder={strings.materials.search}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateQuery({ search: (e.target as HTMLInputElement).value });
            }}
            onBlur={(e) => updateQuery({ search: e.target.value })}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <select
          value={filters.category}
          onChange={(e) => updateQuery({ category: e.target.value })}
          aria-label={strings.materials.allCategories}
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="">{strings.materials.allCategories}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          value={filters.measurementModel}
          onChange={(e) => updateQuery({ measurementModel: e.target.value })}
          aria-label={strings.materials.allModels}
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="">{strings.materials.allModels}</option>
          {MEASUREMENT_MODELS.map((model) => (
            <option key={model} value={model}>
              {MEASUREMENT_MODEL_LABELS[model]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => updateQuery({ archived: showArchived ? '' : 'true' })}
          className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {showArchived ? strings.materials.hideArchived : strings.materials.showArchived}
        </button>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(emptyMaterialForm())}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            {strings.materials.add}
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-4">
          <MaterialForm
            initial={editing}
            currency={currency}
            pending={pending}
            error={error}
            onSubmit={save}
            onCancel={() => {
              setEditing(null);
              setError(null);
            }}
          />
        </div>
      ) : null}

      {rowError ? (
        <p role="alert" className="mt-4 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-600">
          {rowError}
        </p>
      ) : null}

      {materials.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line px-6 py-12 text-center">
          <p className="font-medium">
            {hasFilters ? strings.materials.emptyFiltered : strings.materials.empty}
          </p>
          {!hasFilters ? (
            <p className="mt-1 text-sm text-ink-muted">{strings.materials.emptyHint}</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="py-2 pr-3 font-medium">{strings.materials.columns.material}</th>
                <th className="py-2 pr-3 font-medium">{strings.materials.columns.stockSize}</th>
                <th className="py-2 pr-3 font-medium">{strings.materials.columns.thickness}</th>
                <th className="py-2 pr-3 font-medium">{strings.materials.columns.price}</th>
                <th className="py-2 pr-3 font-medium">{strings.materials.columns.supplier}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {materials.map((material) => {
                const stockSize = formatStockSize(material);
                const thickness = formatThickness(material.thicknessMm);
                const model = material.measurementModel as MeasurementModel;
                return (
                  <tr key={material.id} className="border-b border-line last:border-b-0">
                    <td className="py-3 pr-3">
                      <div className="font-medium">
                        {material.name}
                        {material.archivedAt ? (
                          <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
                            {strings.materials.archived}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-ink-muted">{material.category}</div>
                    </td>
                    <td className="py-3 pr-3">{stockSize ?? <span className="text-ink-muted">—</span>}</td>
                    <td className="py-3 pr-3">{thickness ?? <span className="text-ink-muted">—</span>}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">
                      {formatMoney(material.unitPriceCents, currency)}
                      <span className="ml-1 text-xs text-ink-muted">{PRICE_UNIT_LABELS[model]}</span>
                    </td>
                    <td className="py-3 pr-3">
                      {material.supplier ?? <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap justify-end gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => setEditing(toFormValues(material))}
                          className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          {strings.materials.edit}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArchived(material.id, !material.archivedAt)}
                          disabled={busyId === material.id}
                          className="text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
                        >
                          {material.archivedAt ? strings.materials.restore : strings.materials.archive}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(material.id)}
                          disabled={busyId === material.id}
                          className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          {busyId === material.id ? strings.materials.deleting : strings.materials.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
