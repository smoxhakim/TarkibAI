'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import type { FieldChange, SectionDiff, VersionDiff } from '@/lib/versions/diff';

export type VersionRow = {
  id: string;
  versionNumber: number;
  label: string;
  reasonLabel: string;
  note: string | null;
  createdAt: string;
  producedQuoteNumbers: string[];
  producedPackageVersions: number[];
};

type Comparison = {
  from: { versionNumber: number; label: string };
  to: { versionNumber: number; label: string } | null;
  toIsCurrent: boolean;
  diff: VersionDiff;
};

type RestorePreview = {
  version: { id: string; versionNumber: number; label: string };
  diff: VersionDiff;
  consequences: string[];
  blockers: string[];
};

const t = strings.versions;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const KIND_LABEL: Record<string, string> = {
  added: t.added,
  removed: t.removed,
  changed: t.changed,
};

function ChangeLine({ change }: { change: FieldChange }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-medium">{change.label}</span>
      <span className="text-ink-muted">
        {change.kind === 'added' ? (
          <>
            {KIND_LABEL.added}: {change.to}
          </>
        ) : change.kind === 'removed' ? (
          <>
            {KIND_LABEL.removed}: {change.from}
          </>
        ) : (
          <>
            {change.from} → {change.to}
          </>
        )}
      </span>
    </li>
  );
}

function FieldSection({ title, changes }: { title: string; changes: FieldChange[] }) {
  if (changes.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-xs">
        {changes.map((change) => (
          <ChangeLine key={change.path} change={change} />
        ))}
      </ul>
    </div>
  );
}

function EntrySection({ title, section }: { title: string; section: SectionDiff }) {
  if (section.unavailableReason) {
    return (
      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</p>
        <p className="mt-1 text-xs text-ink-muted">{section.unavailableReason}</p>
      </div>
    );
  }
  if (section.entries.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</p>
      <ul className="mt-1 flex flex-col gap-1 text-xs">
        {section.entries.map((entry) => (
          <li key={`${entry.name}-${entry.kind}`}>
            <span className="font-medium">{entry.name}</span>{' '}
            <span className="text-ink-muted">{KIND_LABEL[entry.kind]}</span>
            {entry.changes.length > 0 ? (
              <ul className="mt-0.5 flex flex-col gap-0.5 pl-4">
                {entry.changes.map((change) => (
                  <ChangeLine key={change.path} change={change} />
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffView({ diff }: { diff: VersionDiff }) {
  if (diff.identical) return <p className="mt-2 text-xs text-ink-muted">{t.identical}</p>;

  return (
    <>
      <FieldSection title={t.sectionSpec} changes={diff.spec} />
      <EntrySection title={t.sectionCanvas} section={diff.canvas} />
      <EntrySection title={t.sectionMaterials} section={diff.materials} />
      {diff.costUnavailableReason ? (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t.sectionCost}</p>
          <p className="mt-1 text-xs text-ink-muted">{diff.costUnavailableReason}</p>
        </div>
      ) : (
        <FieldSection title={t.sectionCost} changes={diff.cost} />
      )}
      <FieldSection title={t.sectionReferences} changes={diff.references} />
    </>
  );
}

export function VersionsPanel({
  projectId,
  versions,
  canEdit,
}: {
  projectId: string;
  versions: VersionRow[];
  /** `project.edit`. The timeline is readable by every member; writing to it is not. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ forId: string; view: Comparison } | null>(null);
  const [restore, setRestore] = useState<RestorePreview | null>(null);

  async function save() {
    if (label.trim() === '') return;
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.saveFailed);
        return;
      }
      setLabel('');
      router.refresh();
    } catch {
      setError(t.saveFailed);
    } finally {
      setBusy(null);
    }
  }

  async function compare(fromId: string, toId: string) {
    setBusy(`compare-${fromId}`);
    setError(null);
    try {
      const query = new URLSearchParams({ from: fromId });
      if (toId !== 'now') query.set('to', toId);
      const res = await fetch(`/api/projects/${projectId}/versions/compare?${query}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.compareFailed);
        return;
      }
      setComparison({ forId: fromId, view: await res.json() });
    } catch {
      setError(t.compareFailed);
    } finally {
      setBusy(null);
    }
  }

  async function openRestore(versionId: string) {
    setBusy(`restore-${versionId}`);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/versions/${versionId}/restore`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.restoreFailed);
        return;
      }
      setRestore(await res.json());
    } catch {
      setError(t.restoreFailed);
    } finally {
      setBusy(null);
    }
  }

  async function confirmRestore() {
    if (!restore) return;
    setBusy('restoring');
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/versions/${restore.version.id}/restore`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.restoreFailed);
        return;
      }
      setRestore(null);
      setComparison(null);
      router.refresh();
    } catch {
      setError(t.restoreFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{t.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          placeholder={t.savePlaceholder}
          maxLength={160}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <button
          type="button"
          disabled={busy !== null || label.trim() === '' || !canEdit}
          onClick={save}
          className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          {busy === 'save' ? t.saving : t.save}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      {/* Restore review. Restoring changes the working specification and the
          canvas, so it is never a single click. */}
      {restore ? (
        <div className="mt-4 rounded-md border border-line bg-surface-muted p-3">
          <p className="text-sm font-medium">{t.restoreHeading}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Version {restore.version.versionNumber} · {restore.version.label}
          </p>

          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
            {t.restoreConsequences}
          </p>
          <ul className="mt-1 list-disc pl-4 text-xs text-ink-muted">
            {restore.consequences.map((consequence) => (
              <li key={consequence}>{consequence}</li>
            ))}
          </ul>

          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
            {t.restoreChanges}
          </p>
          <DiffView diff={restore.diff} />

          {restore.blockers.length > 0 ? (
            <ul className="mt-3 list-disc pl-4 text-xs text-danger">
              {restore.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={busy !== null || restore.blockers.length > 0 || !canEdit}
              onClick={confirmRestore}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'restoring' ? t.restoring : t.restoreConfirm}
            </button>
            <button
              type="button"
              onClick={() => setRestore(null)}
              className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {t.restoreCancel}
            </button>
          </div>
        </div>
      ) : null}

      {versions.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">{t.none}</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {versions.map((version) => (
            <li key={version.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  <span className="tabular-nums text-ink-muted">v{version.versionNumber}</span>{' '}
                  {version.label}
                </span>
                <span className="text-xs text-ink-muted">
                  {dateFormat.format(new Date(version.createdAt))}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">{version.reasonLabel}</p>
              {version.note ? <p className="mt-1 text-xs text-ink-muted">{version.note}</p> : null}

              {version.producedQuoteNumbers.length > 0 || version.producedPackageVersions.length > 0 ? (
                <p className="mt-1 text-xs text-ink-muted">
                  {version.producedQuoteNumbers.map((number) => (
                    <span key={number} className="mr-2">
                      {t.producedQuote} {number}
                    </span>
                  ))}
                  {version.producedPackageVersions.map((number) => (
                    <span key={number} className="mr-2">
                      {t.producedPackage} {number}
                    </span>
                  ))}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  <span className="text-ink-muted">{t.compareWith}</span>
                  <select
                    className="rounded-md border border-line bg-surface px-1.5 py-1 outline-none focus:border-accent"
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value !== '') compare(version.id, event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      …
                    </option>
                    <option value="now">{t.compareNow}</option>
                    {versions
                      .filter((other) => other.id !== version.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          v{other.versionNumber} · {other.label}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy !== null || !canEdit}
                  onClick={() => openRestore(version.id)}
                  className="text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
                >
                  {t.restore}
                </button>
                {busy === `compare-${version.id}` ? (
                  <span className="text-ink-muted">{t.comparing}</span>
                ) : null}
              </div>

              {comparison?.forId === version.id ? (
                <div className="mt-3 border-t border-line pt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs text-ink-muted">
                      v{comparison.view.from.versionNumber} →{' '}
                      {comparison.view.toIsCurrent
                        ? t.compareNow
                        : `v${comparison.view.to?.versionNumber}`}
                    </p>
                    <button
                      type="button"
                      onClick={() => setComparison(null)}
                      className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      {t.close}
                    </button>
                  </div>
                  <DiffView diff={comparison.view.diff} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
