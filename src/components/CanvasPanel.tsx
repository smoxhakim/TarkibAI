'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { strings } from '@/lib/strings';
import { OBJECT_TYPE_LABELS, type ObjectType, type SceneObject } from '@/lib/canvas/schema';
import { formatMm, renderScene } from '@/lib/canvas/render';

export type CanvasView = {
  objects: SceneObject[];
  diverged: boolean;
  seedBlockedReason: string | null;
};

type MaterialOption = { id: string; name: string };

const inputClass =
  'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent disabled:opacity-60';

type Draft = {
  type: ObjectType;
  label: string;
  x: string;
  y: string;
  widthMm: string;
  heightMm: string;
  rotationDeg: string;
  materialId: string;
  showDimensions: boolean;
  notes: string;
};

const emptyDraft = (type: ObjectType = 'panel'): Draft => ({
  type,
  label: '',
  x: '0',
  y: '0',
  widthMm: '1000',
  heightMm: '1000',
  rotationDeg: '0',
  materialId: '',
  showDimensions: true,
  notes: '',
});

const toDraft = (object: SceneObject): Draft => ({
  type: object.type,
  label: object.label ?? '',
  x: String(object.x),
  y: String(object.y),
  widthMm: String(object.widthMm),
  heightMm: String(object.heightMm),
  rotationDeg: String(object.rotationDeg),
  materialId: object.materialId ?? '',
  showDimensions: object.showDimensions,
  notes: object.notes ?? '',
});

const int = (raw: string): number => {
  const parsed = Math.round(Number(raw.replace(',', '.')));
  return Number.isFinite(parsed) ? parsed : 0;
};

export function CanvasPanel({
  projectId,
  view,
  canEdit,
  materials,
  objectTypes,
}: {
  projectId: string;
  view: CanvasView;
  /** Whether this reader holds `design.edit`. The canvas stays readable
   *  without it; only the controls that write are withheld. */
  canEdit: boolean;
  materials: MaterialOption[];
  /** The trade's palette. The scene can still hold types outside it — an
   *  existing object is never made unopenable by narrowing what is offered. */
  objectTypes: readonly ObjectType[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(objectTypes[0]));
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scene = useMemo(() => ({ sceneVersion: 1 as const, objects: view.objects }), [view.objects]);
  const rendered = useMemo(() => renderScene(scene, { selectedId }), [scene, selectedId]);

  const materialName = (id: string | null | undefined) =>
    materials.find((material) => material.id === id)?.name ?? null;

  async function post(url: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const detail = payload.issues?.map((i: { message: string }) => i.message).join(' ');
        setError(detail || payload.error || strings.canvas.saveFailed);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(strings.canvas.saveFailed);
      return false;
    } finally {
      setPending(false);
    }
  }

  function draftToObject(): Record<string, unknown> {
    return {
      type: draft.type,
      label: draft.label.trim() || null,
      x: int(draft.x),
      y: int(draft.y),
      widthMm: int(draft.widthMm),
      heightMm: int(draft.heightMm),
      rotationDeg: int(draft.rotationDeg),
      materialId: draft.materialId || null,
      showDimensions: draft.showDimensions,
      notes: draft.notes.trim() || null,
    };
  }

  async function submitDraft() {
    const command = editingId
      ? { kind: 'update_object', id: editingId, changes: draftToObject() }
      : { kind: 'add_object', object: draftToObject() };

    const ok = await post(`/api/projects/${projectId}/canvas`, { commands: [command] });
    if (ok) {
      setAdding(false);
      setEditingId(null);
      setDraft(emptyDraft(objectTypes[0]));
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{strings.canvas.title}</h2>
        {rendered.bounds ? (
          <span className="text-xs text-ink-muted">
            {strings.canvas.overallSize} {formatMm(rendered.bounds.widthMm)} ×{' '}
            {formatMm(rendered.bounds.heightMm)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{strings.canvas.subtitle}</p>

      {view.diverged ? (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <p className="text-sm font-medium">{strings.canvas.divergedTitle}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{strings.canvas.divergedBody}</p>
        </div>
      ) : null}

      {rendered.svg ? (
        <div
          className="mt-4 overflow-hidden rounded-md border border-line bg-surface-muted p-2"
          // The markup is generated by our own renderer from validated scene
          // data, and every user-supplied label is XML-escaped there.
          dangerouslySetInnerHTML={{ __html: rendered.svg }}
        />
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-10 text-center">
          <p className="text-sm font-medium">{strings.canvas.empty}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.canvas.emptyHint}</p>
        </div>
      )}

      <p className="mt-2 text-xs text-ink-muted">{strings.canvas.notEngineering}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {view.seedBlockedReason ? (
          <p className="text-sm text-ink-muted">{view.seedBlockedReason}</p>
        ) : (
          <button
            type="button"
            onClick={() => post(`/api/projects/${projectId}/canvas/seed`)}
            disabled={pending || !canEdit}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending
              ? strings.canvas.seeding
              : view.objects.length > 0
                ? strings.canvas.reseed
                : strings.canvas.seed}
          </button>
        )}
        {!adding && !editingId ? (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => {
              setAdding(true);
              setDraft(emptyDraft(objectTypes[0]));
            }}
            className="rounded-md border border-line px-3 py-2 text-sm transition-colors hover:border-accent"
          >
            {strings.canvas.addObject}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {adding || editingId ? (
        <div className="mt-4 rounded-md border border-line p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="c-type" className="text-xs font-medium">
                {strings.canvas.fields.type}
              </label>
              <select
                id="c-type"
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value as ObjectType })}
                disabled={pending || !canEdit}
                className={inputClass}
              >
                {objectTypes.map((type) => (
                  <option key={type} value={type}>
                    {OBJECT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="c-label" className="text-xs font-medium">
                {strings.canvas.fields.label}
              </label>
              <input
                id="c-label"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                maxLength={160}
                disabled={pending || !canEdit}
                className={inputClass}
              />
            </div>

            {(
              [
                ['widthMm', strings.canvas.fields.width],
                ['heightMm', strings.canvas.fields.height],
                ['rotationDeg', strings.canvas.fields.rotation],
                ['x', strings.canvas.fields.x],
                ['y', strings.canvas.fields.y],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <label htmlFor={`c-${field}`} className="text-xs font-medium">
                  {label}
                </label>
                <input
                  id={`c-${field}`}
                  type="number"
                  step="1"
                  value={draft[field]}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                  disabled={pending || !canEdit}
                  className={inputClass}
                />
              </div>
            ))}

            <div>
              <label htmlFor="c-material" className="text-xs font-medium">
                {strings.canvas.fields.material}
              </label>
              <select
                id="c-material"
                value={draft.materialId}
                onChange={(e) => setDraft({ ...draft, materialId: e.target.value })}
                disabled={pending || !canEdit}
                className={inputClass}
              >
                <option value="">{strings.canvas.noMaterial}</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="c-notes" className="text-xs font-medium">
                {strings.canvas.fields.notes}
              </label>
              <input
                id="c-notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                maxLength={500}
                disabled={pending || !canEdit}
                className={inputClass}
              />
            </div>

            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                checked={draft.showDimensions}
                onChange={(e) => setDraft({ ...draft, showDimensions: e.target.checked })}
                disabled={pending || !canEdit}
              />
              {strings.canvas.fields.showDimensions}
            </label>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={submitDraft}
              disabled={pending || !canEdit}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? strings.canvas.saving : strings.canvas.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setEditingId(null);
                setError(null);
              }}
              /* Not gated: cancelling writes nothing, and disabling it would
                 strand a reader who somehow reached the editor. */
              disabled={pending}
              className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {strings.canvas.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {view.objects.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium">{strings.canvas.objects}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {view.objects.map((object) => (
              <li
                key={object.id}
                onMouseEnter={() => setSelectedId(object.id)}
                onMouseLeave={() => setSelectedId(null)}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {object.label || OBJECT_TYPE_LABELS[object.type]}
                  </span>
                  <span className="text-ink-muted">
                    {' · '}
                    {OBJECT_TYPE_LABELS[object.type]}
                    {' · '}
                    {formatMm(object.widthMm)} × {formatMm(object.heightMm)}
                    {materialName(object.materialId) ? ` · ${materialName(object.materialId)}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(object.id);
                      setAdding(false);
                      setDraft(toDraft(object));
                    }}
                    className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    {strings.canvas.edit}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      post(`/api/projects/${projectId}/canvas`, {
                        commands: [{ kind: 'remove_object', id: object.id }],
                      })
                    }
                    disabled={pending || !canEdit}
                    className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {strings.canvas.remove}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
