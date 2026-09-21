'use client';

import { useState } from 'react';
import { strings } from '@/lib/strings';
import { PRICE_UNIT_LABELS, type MeasurementModel } from '@/lib/materials/schema';
import { UNIT_LABEL, formatMoney } from '@/lib/materials/format';
import type { SelectedMaterial } from './ProjectMaterialsPanel';

export function ProjectMaterialRow({
  row,
  currency,
  busy,
  canEdit,
  onSaveRequirement,
  onRemove,
}: {
  row: SelectedMaterial;
  currency: string;
  busy: boolean;
  /** Whether this reader holds `project.edit`. */
  canEdit: boolean;
  onSaveRequirement: (
    id: string,
    requiredQuantity: number | null,
    requiredDimensions: string | null
  ) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const model = row.measurementModel as MeasurementModel;
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(row.requiredQuantity ?? '');
  const [note, setNote] = useState(row.requiredDimensions ?? '');
  const [showWorking, setShowWorking] = useState(false);

  const calculated = row.calculatedAt !== null;
  const stale = row.staleReasons.length > 0;

  async function save() {
    const parsed = quantity.trim() === '' ? null : Number(quantity.replace(',', '.'));
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) return;
    await onSaveRequirement(row.id, parsed, note.trim() || null);
    setEditing(false);
  }

  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{row.name}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {row.category}
            {row.role ? ` · ${row.role}` : ''}
            {/* Withheld, not zeroed: a reader without cost.view gets no price
                from the server, and an invented "0.00 MAD" would read as one. */}
            {row.unitPriceCents === null
              ? ''
              : ` · ${formatMoney(row.unitPriceCents, currency)} ${PRICE_UNIT_LABELS[model]}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          disabled={busy || !canEdit}
          className="text-xs text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
        >
          {strings.projectMaterials.remove}
        </button>
      </div>

      {/* Requirement — the one number the engine does not derive. */}
      <div className="mt-3 border-t border-line pt-3">
        {editing ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor={`q-${row.id}`} className="block text-xs font-medium">
                  {strings.projectMaterials.requiredLabel}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id={`q-${row.id}`}
                    type="number"
                    step="0.001"
                    min={0}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    disabled={busy || !canEdit}
                    autoFocus
                    className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent disabled:opacity-60"
                  />
                  <span className="text-sm text-ink-muted">
                    {strings.projectMaterials.requiredHint[model]}
                  </span>
                </div>
              </div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={strings.projectMaterials.requiredNote}
                maxLength={300}
                disabled={busy || !canEdit}
                aria-label={strings.projectMaterials.requiredNote}
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-60"
              />
              <button
                type="button"
                onClick={save}
                disabled={busy || !canEdit}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? strings.projectMaterials.savingRequirement : strings.projectMaterials.saveRequirement}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy || !canEdit}
                className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {strings.materials.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {row.requiredQuantity ? (
              <p className="text-sm">
                <span className="text-ink-muted">{strings.projectMaterials.requiredLabel} </span>
                <span className="font-medium">
                  {Number(row.requiredQuantity)} {UNIT_LABEL[model]}
                </span>
                {row.requiredDimensions ? (
                  <span className="text-ink-muted"> — {row.requiredDimensions}</span>
                ) : null}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">{strings.projectMaterials.notCalculated}</p>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {row.requiredQuantity ? strings.materials.edit : strings.projectMaterials.setRequirement}
            </button>
          </div>
        )}
      </div>

      {row.unsupportedReason ? (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <p className="text-sm font-medium">{strings.projectMaterials.unsupported}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{row.unsupportedReason}</p>
        </div>
      ) : null}

      {calculated ? (
        <div className="mt-3 border-t border-line pt-3">
          {stale ? (
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
              <p className="text-sm font-medium">{strings.projectMaterials.staleTitle}</p>
              <ul className="mt-1 list-inside list-disc text-sm text-ink-muted">
                {row.staleReasons.map((reason) => (
                  <li key={reason}>{strings.projectMaterials.stale[reason]}</li>
                ))}
              </ul>
              <p className="mt-1 text-sm text-ink-muted">{strings.projectMaterials.staleAction}</p>
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {row.unitsToPurchase !== null ? (
              <div>
                <dt className="text-xs text-ink-muted">{strings.projectMaterials.resultUnits}</dt>
                <dd className="text-sm font-medium">{row.unitsToPurchase}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-ink-muted">{strings.projectMaterials.resultPurchased}</dt>
              <dd className="text-sm font-medium">
                {Number(row.totalPurchasedQuantity)} {UNIT_LABEL[model]}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{strings.projectMaterials.resultWaste}</dt>
              <dd className="text-sm font-medium">
                {Number(row.wasteQuantity)} {UNIT_LABEL[model]}
                <span className="ml-1 text-xs text-ink-muted">({Number(row.wastePercent)}%)</span>
              </dd>
            </div>
            {row.totalCostCents === null ? null : (
              <div>
                <dt className="text-xs text-ink-muted">{strings.projectMaterials.resultCost}</dt>
                <dd className="text-sm font-medium">
                  {formatMoney(row.totalCostCents, currency)}
                </dd>
              </div>
            )}
          </dl>

          {row.warnings.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1">
              {row.warnings.map((warning) => (
                <li
                  key={warning.code}
                  className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-ink-muted"
                >
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}

          {row.steps.length > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowWorking((prev) => !prev)}
                className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {showWorking ? strings.projectMaterials.hideWorking : strings.projectMaterials.showWorking}
              </button>
              {showWorking ? (
                <dl className="mt-2 rounded-md bg-surface-muted p-3">
                  {row.steps.map((step) => (
                    <div key={step.label} className="flex justify-between gap-4 py-0.5 text-sm">
                      <dt className="text-ink-muted">{step.label}</dt>
                      <dd className="text-right font-medium">{step.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
