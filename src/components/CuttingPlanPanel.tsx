'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { formatMm } from '@/lib/canvas/render';

export type CuttingPieceView = {
  id: string;
  materialId: string;
  label: string | null;
  widthMm: number;
  heightMm: number;
  quantity: number;
  allowRotation: boolean;
};

export type CuttingPlanView = {
  materialId: string;
  sheetSizeLabel: string;
  sheetsUsed: number;
  wastePercent: string;
  kerfMm: number;
  edgeMarginMm: number;
  unplacedCount: number;
  svg: string;
  unplaced: { label: string | null; widthMm: number; heightMm: number; quantity: number; reason: string }[];
  offcutCount: number;
};

export type SheetMaterialOption = { id: string; name: string; sheetLabel: string };

export function CuttingPlanPanel({
  projectId,
  sheetMaterials,
  pieces,
  plans,
  canEdit,
}: {
  projectId: string;
  sheetMaterials: SheetMaterialOption[];
  pieces: CuttingPieceView[];
  plans: CuttingPlanView[];
  /** Whether this reader holds `project.edit`. The services refuse the write
   *  either way; this stops offering actions that would be refused. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [materialId, setMaterialId] = useState(sheetMaterials[0]?.id ?? '');
  const [draft, setDraft] = useState({ label: '', widthMm: '', heightMm: '', quantity: '1', allowRotation: true });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addPiece() {
    const width = Number(draft.widthMm);
    const height = Number(draft.heightMm);
    const quantity = Number(draft.quantity);
    if (!materialId || !width || !height || !quantity) return;

    setPending('add');
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/cutting-pieces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId,
          label: draft.label.trim() || null,
          widthMm: Math.round(width),
          heightMm: Math.round(height),
          quantity: Math.round(quantity),
          allowRotation: draft.allowRotation,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const detail = payload.issues?.map((i: { message: string }) => i.message).join(' ');
        setError(detail || payload.error || strings.cutting.addFailed);
        return;
      }
      setDraft({ label: '', widthMm: '', heightMm: '', quantity: '1', allowRotation: true });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function removePiece(pieceId: string) {
    setPending(pieceId);
    setError(null);
    try {
      // A refused delete used to be swallowed: the row vanished from the list
      // and came back on the next refresh with nothing said. Now that the
      // service can answer 403, the failure has to be shown.
      const res = await fetch(`/api/projects/${projectId}/cutting-pieces/${pieceId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.cutting.removeFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.cutting.removeFailed);
    } finally {
      setPending(null);
    }
  }

  async function calculate(target: string) {
    setPending(`calc-${target}`);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/cutting-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materialId: target }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.cutting.calculateFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.cutting.calculateFailed);
    } finally {
      setPending(null);
    }
  }

  if (sheetMaterials.length === 0) {
    return (
      <section className="rounded-lg border border-line p-4">
        <h2 className="font-medium">{strings.cutting.title}</h2>
        <div className="mt-3 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium">{strings.cutting.noSheetMaterials}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.cutting.noSheetMaterialsHint}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{strings.cutting.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{strings.cutting.subtitle}</p>

      <div className="mt-4 rounded-md border border-line p-3">
        <p className="text-sm font-medium">{strings.cutting.piecesTitle}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{strings.cutting.piecesHint}</p>

        {pieces.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{strings.cutting.noPieces}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {pieces.map((piece) => (
              <li key={piece.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {piece.label ? `${piece.label} — ` : ''}
                  {piece.widthMm} × {piece.heightMm} mm × {piece.quantity}
                  {!piece.allowRotation ? (
                    <span className="text-ink-muted"> · fixed direction</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => removePiece(piece.id)}
                  disabled={pending === piece.id || !canEdit}
                  className="text-xs text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {strings.cutting.removePiece}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-6">
          <select
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            aria-label="Material"
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent sm:col-span-2"
          >
            {sheetMaterials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.name} ({material.sheetLabel})
              </option>
            ))}
          </select>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder={strings.cutting.pieceLabel}
            aria-label={strings.cutting.pieceLabel}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <input
            type="number"
            value={draft.widthMm}
            onChange={(e) => setDraft({ ...draft, widthMm: e.target.value })}
            placeholder={strings.cutting.pieceWidth}
            aria-label={strings.cutting.pieceWidth}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <input
            type="number"
            value={draft.heightMm}
            onChange={(e) => setDraft({ ...draft, heightMm: e.target.value })}
            placeholder={strings.cutting.pieceHeight}
            aria-label={strings.cutting.pieceHeight}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <input
            type="number"
            min={1}
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
            placeholder={strings.cutting.pieceQuantity}
            aria-label={strings.cutting.pieceQuantity}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.allowRotation}
              onChange={(e) => setDraft({ ...draft, allowRotation: e.target.checked })}
            />
            {strings.cutting.allowRotation}
            <span className="text-xs text-ink-muted">{strings.cutting.allowRotationHint}</span>
          </label>
          <button
            type="button"
            onClick={addPiece}
            disabled={pending === 'add' || !draft.widthMm || !draft.heightMm || !canEdit}
            className="rounded-md border border-line px-3 py-1 text-sm transition-colors hover:border-accent disabled:opacity-50"
          >
            {pending === 'add' ? strings.cutting.adding : strings.cutting.addPiece}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {sheetMaterials.map((material) => {
          const plan = plans.find((p) => p.materialId === material.id);
          const materialPieces = pieces.filter((p) => p.materialId === material.id);

          return (
            <div key={material.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {material.name}{' '}
                  <span className="text-ink-muted">({material.sheetLabel})</span>
                </p>
                <button
                  type="button"
                  onClick={() => calculate(material.id)}
                  disabled={
                    pending === `calc-${material.id}` || materialPieces.length === 0 || !canEdit
                  }
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {pending === `calc-${material.id}`
                    ? strings.cutting.calculating
                    : plan
                      ? strings.cutting.recalculate
                      : strings.cutting.calculate}
                </button>
              </div>

              {!plan ? (
                <p className="mt-2 text-sm text-ink-muted">{strings.cutting.noPlan}</p>
              ) : (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.cutting.sheetsUsed}</dt>
                      <dd className="text-sm font-medium">{plan.sheetsUsed}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.cutting.waste}</dt>
                      <dd className="text-sm font-medium">{Number(plan.wastePercent)}%</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.cutting.kerf}</dt>
                      <dd className="text-sm font-medium">{plan.kerfMm} mm</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.cutting.edgeMargin}</dt>
                      <dd className="text-sm font-medium">{plan.edgeMarginMm} mm</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{strings.cutting.offcuts}</dt>
                      <dd className="text-sm font-medium">{plan.offcutCount}</dd>
                    </div>
                  </dl>

                  {plan.unplaced.length > 0 ? (
                    <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                      <p className="text-sm font-medium">{strings.cutting.unplacedTitle}</p>
                      <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink-muted">
                        {plan.unplaced.map((piece, index) => (
                          <li key={index}>
                            {piece.label ? `${piece.label} — ` : ''}
                            {formatMm(piece.widthMm)} × {formatMm(piece.heightMm)} × {piece.quantity}:{' '}
                            {piece.reason}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-ink-muted">{strings.cutting.unplacedHint}</p>
                    </div>
                  ) : null}

                  {plan.svg ? (
                    <div className="mt-3">
                      <p className="text-xs text-ink-muted">{strings.cutting.rotatedNote}</p>
                      <div
                        className="mt-1 overflow-hidden rounded-md border border-line"
                        // Generated by our own renderer from validated plan data;
                        // labels are XML-escaped there.
                        dangerouslySetInnerHTML={{ __html: plan.svg }}
                      />
                    </div>
                  ) : null}

                  <p className="mt-2 text-xs text-ink-muted">{strings.cutting.settingsNote}</p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
