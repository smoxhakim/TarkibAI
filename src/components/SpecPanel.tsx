'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { FIELD_LABELS, type SpecFieldKey } from '@/lib/spec/completeness';
import type { ProjectSpecData } from '@/lib/spec/schema';

export type SpecPanelData = {
  spec: ProjectSpecData;
  version: number;
  status: 'draft' | 'approved';
  approvedAt: string | Date | null;
  missing: string[];
  complete: boolean;
};

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function formatDimensions(spec: ProjectSpecData): string | null {
  const d = spec.dimensions;
  if (!d) return null;
  const unit = d.unit ?? '';
  const parts = [
    d.width != null ? `W ${d.width}${unit}` : null,
    d.height != null ? `H ${d.height}${unit}` : null,
    d.depth != null ? `D ${d.depth}${unit}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' × ') : null;
}

export function SpecPanel({ projectId, data }: { projectId: string; data: SpecPanelData }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { spec } = data;
  const dimensions = formatDimensions(spec);
  const isApproved = data.status === 'approved';

  // Only render rows the conversation has actually filled in. An empty row would
  // imply the system knows something it does not.
  const hasAnything =
    dimensions !== null ||
    Boolean(
      spec.projectType ||
        spec.quantity ||
        spec.materials?.length ||
        spec.components?.length ||
        spec.lighting?.type ||
        spec.mounting?.method ||
        spec.site?.environment ||
        spec.lettering?.text ||
        spec.finishNotes ||
        spec.deadline ||
        spec.notes
    );

  async function approve() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/spec/approve`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? strings.spec.approveFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.spec.approveFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{strings.spec.title}</h2>
        {data.version > 0 ? (
          <span className="text-xs text-ink-muted">
            {strings.spec.version} {data.version}
            {isApproved ? ` · ${strings.spec.approved}` : ''}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{strings.spec.subtitle}</p>

      {!hasAnything ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium">{strings.spec.empty}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.spec.emptyHint}</p>
        </div>
      ) : (
        <dl className="mt-4">
          {spec.projectType ? <Row label={strings.spec.fields.projectType}>{spec.projectType}</Row> : null}
          {dimensions ? <Row label={strings.spec.fields.dimensions}>{dimensions}</Row> : null}
          {spec.quantity != null ? <Row label={strings.spec.fields.quantity}>{spec.quantity}</Row> : null}
          {spec.materials?.length ? (
            <Row label={strings.spec.fields.materials}>
              <ul className="flex flex-col gap-0.5">
                {spec.materials.map((m, i) => (
                  <li key={`${m.name}-${i}`}>
                    {m.name}
                    {m.appliesTo ? <span className="text-ink-muted"> — {m.appliesTo}</span> : null}
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
          {spec.components?.length ? (
            <Row label={strings.spec.fields.components}>
              <ul className="flex flex-col gap-0.5">
                {spec.components.map((c, i) => (
                  <li key={`${c.name}-${i}`}>
                    {c.name}
                    {c.quantity != null ? <span className="text-ink-muted"> × {c.quantity}</span> : null}
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
          {spec.lighting?.type ? (
            <Row label={strings.spec.fields.lighting}>
              {spec.lighting.type}
              {spec.lighting.details ? <span className="text-ink-muted"> — {spec.lighting.details}</span> : null}
            </Row>
          ) : null}
          {spec.mounting?.method ? (
            <Row label={strings.spec.fields.mounting}>
              {spec.mounting.method}
              {spec.mounting.surface ? <span className="text-ink-muted"> — {spec.mounting.surface}</span> : null}
            </Row>
          ) : null}
          {spec.site?.environment ? (
            <Row label={strings.spec.fields.site}>
              {spec.site.environment}
              {spec.site.locationText ? <span className="text-ink-muted"> — {spec.site.locationText}</span> : null}
            </Row>
          ) : null}
          {spec.lettering?.text ? <Row label={strings.spec.fields.lettering}>{spec.lettering.text}</Row> : null}
          {spec.finishNotes ? <Row label={strings.spec.fields.finishNotes}>{spec.finishNotes}</Row> : null}
          {spec.deadline ? <Row label={strings.spec.fields.deadline}>{spec.deadline}</Row> : null}
          {spec.notes ? <Row label={strings.spec.fields.notes}>{spec.notes}</Row> : null}
        </dl>
      )}

      {isApproved ? (
        <p className="mt-4 rounded-md bg-accent/10 px-3 py-2 text-sm text-accent">
          {strings.spec.approvedNote}{' '}
          {data.approvedAt ? dateFormat.format(new Date(data.approvedAt)) : ''}
        </p>
      ) : (
        <div className="mt-4 border-t border-line pt-4">
          {data.missing.length > 0 ? (
            <>
              <p className="text-sm font-medium">{strings.spec.missingTitle}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.missing.map((key) => (
                  <li
                    key={key}
                    className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted"
                  >
                    {FIELD_LABELS[key as SpecFieldKey] ?? key}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink-muted">{strings.spec.approveBlocked}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">{strings.spec.complete}</p>
              <p className="mt-1 text-sm text-ink-muted">{strings.spec.reviewBeforeApprove}</p>
              <button
                type="button"
                onClick={approve}
                disabled={pending}
                className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {pending ? strings.spec.approving : strings.spec.approve}
              </button>
            </>
          )}
          {error ? (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
