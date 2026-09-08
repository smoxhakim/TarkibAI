'use client';

import { strings } from '@/lib/strings';
import type { Finding, FindingSummary, Severity } from '@/lib/validation/checks';

export type IntegrityView = {
  findings: Finding[];
  summary: FindingSummary;
  readiness: {
    quote: { ready: boolean; blockers: Finding[] };
    production: { ready: boolean; blockers: Finding[] };
  };
};

const t = strings.integrity;

const AREA_LABEL: Record<string, string> = {
  specification: t.areaSpecification,
  design: t.areaDesign,
  materials: t.areaMaterials,
  cutting: t.areaCutting,
  cost: t.areaCost,
  documents: t.areaDocuments,
};

const GROUPS: { severity: Severity; heading: string }[] = [
  { severity: 'blocker', heading: t.blockers },
  { severity: 'warning', heading: t.warnings },
  { severity: 'note', heading: t.notes },
];

/** Blockers are the only findings that stop anything, so only they are marked. */
function Badge({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        ready ? 'bg-accent/10 text-accent' : 'bg-danger/10 text-danger'
      }`}
    >
      {label}
    </span>
  );
}

export function IntegrityPanel({ report }: { report: IntegrityView }) {
  const { findings, summary, readiness } = report;

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{t.title}</h2>
        <span className="flex flex-wrap items-center gap-2">
          <Badge
            ready={readiness.quote.ready}
            label={readiness.quote.ready ? t.readyQuote : t.notReadyQuote}
          />
          <Badge
            ready={readiness.production.ready}
            label={readiness.production.ready ? t.readyProduction : t.notReadyProduction}
          />
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

      {findings.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t.allClear}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {GROUPS.map(({ severity, heading }) => {
            const group = findings.filter((finding) => finding.severity === severity);
            if (group.length === 0) return null;

            return (
              <div key={severity}>
                <p
                  className={`text-xs font-medium uppercase tracking-wide ${
                    severity === 'blocker' ? 'text-danger' : 'text-ink-muted'
                  }`}
                >
                  {heading} · {group.length}
                </p>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {group.map((finding, index) => (
                    <li key={`${finding.code}-${finding.subject ?? index}`} className="text-sm">
                      <span className="text-xs text-ink-muted">
                        {AREA_LABEL[finding.area] ?? finding.area}
                      </span>
                      <p>{finding.message}</p>
                      {finding.action ? (
                        <p className="text-xs text-ink-muted">{finding.action}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {summary.blocker > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">{t.readyNote}</p>
      ) : null}
    </section>
  );
}
