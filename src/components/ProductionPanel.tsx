'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

export type ProductionPackage = {
  id: string;
  version: number;
  notes: string | null;
  hasPdf: boolean;
  createdAt: string;
};

export type ProductionAvailability = {
  drawingVersion: number | null;
  calculatedMaterialCount: number;
  cuttingPlanCount: number;
};

const t = strings.production;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function ProductionPanel({
  projectId,
  packages,
  blockers,
  gaps,
  available,
}: {
  projectId: string;
  packages: ProductionPackage[];
  blockers: string[];
  gaps: string[];
  available: ProductionAvailability;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGenerate = blockers.length === 0;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/production`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() === '' ? null : notes }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.generateFailed);
        return;
      }
      setNotes('');
      router.refresh();
    } catch {
      setError(t.generateFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{t.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

      {/* What the next package would be built from. */}
      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-md border border-line p-2">
          <dt className="text-xs text-ink-muted">{t.availableDrawing}</dt>
          <dd className="mt-0.5 tabular-nums">
            {available.drawingVersion === null ? t.none_ : `Drawing ${available.drawingVersion}`}
          </dd>
        </div>
        <div className="rounded-md border border-line p-2">
          <dt className="text-xs text-ink-muted">{t.availableMaterials}</dt>
          <dd className="mt-0.5 tabular-nums">{available.calculatedMaterialCount}</dd>
        </div>
        <div className="rounded-md border border-line p-2">
          <dt className="text-xs text-ink-muted">{t.availablePlans}</dt>
          <dd className="mt-0.5 tabular-nums">{available.cuttingPlanCount}</dd>
        </div>
      </dl>

      {blockers.length > 0 ? (
        <div className="mt-3 rounded-md border border-line bg-surface-muted p-3 text-xs text-ink-muted">
          <p className="font-medium">{t.blockedHeading}</p>
          <ul className="mt-1 list-disc pl-4">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Gaps do not prevent a package. They are shown here and printed on the
          document, so nobody discovers them on the shop floor. */}
      {canGenerate && gaps.length > 0 ? (
        <div className="mt-3 rounded-md border border-line bg-surface-muted p-3 text-xs text-ink-muted">
          <p className="font-medium">{t.gapsHeading}</p>
          <ul className="mt-1 list-disc pl-4">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {canGenerate ? (
        <>
          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span className="font-medium">{t.notesLabel}</span>
            <textarea
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              rows={3}
              maxLength={4000}
              placeholder={t.notesPlaceholder}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a
              href={`/api/projects/${projectId}/production/preview`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
            >
              {t.preview}
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={generate}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t.generating : t.generate}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">{t.generateNote}</p>
        </>
      ) : null}

      <div className="mt-4 border-t border-line pt-3">
        <p className="text-sm font-medium">{t.packagesHeading}</p>
        {packages.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">{t.none}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {packages.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">Package {entry.version}</span>
                  <span className="ml-2 text-xs text-ink-muted">
                    {t.generatedOn} {dateFormat.format(new Date(entry.createdAt))}
                  </span>
                  {entry.notes ? (
                    <span className="mt-0.5 block text-xs text-ink-muted">{entry.notes}</span>
                  ) : null}
                </span>
                {entry.hasPdf ? (
                  <a
                    href={`/api/projects/${projectId}/production/${entry.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    {t.download}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
