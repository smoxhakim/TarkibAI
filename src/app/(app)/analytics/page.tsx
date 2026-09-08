import { requireDbUser } from '@/lib/auth/current-user';
import { resolveActiveWorkspace } from '@/lib/workspaces/access';
import { can } from '@/lib/workspaces/permissions';
import { getWorkspaceAnalytics } from '@/lib/commercial/service';
import { formatMoney } from '@/lib/quotes/format';
import { strings } from '@/lib/strings';

export const dynamic = 'force-dynamic';

const t = strings.analytics;

const STAGE_LABELS: Record<string, string> = {
  intake: t.stageIntake,
  spec_approved: t.stageSpecApproved,
  calculated: t.stageCalculated,
  quoted: t.stageQuoted,
  production_ready: t.stageProductionReady,
};

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-line p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-lg tabular-nums">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { workspace } = await searchParams;
  const user = await requireDbUser();
  const { workspaceId, role } = await resolveActiveWorkspace(user.id, workspace ?? null);

  // Said plainly rather than rendering an empty page: this is a permission, not
  // a lack of data.
  if (!can(role, 'cost.view')) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-3 text-sm text-ink-muted">{t.restricted}</p>
      </main>
    );
  }

  const analytics = await getWorkspaceAnalytics(workspaceId, user.id);
  const { outcomes } = analytics;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t.pipeline}</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-5">
          {analytics.pipeline.map((entry) => (
            <Stat
              key={entry.stage}
              label={STAGE_LABELS[entry.stage] ?? entry.stage}
              value={String(entry.count)}
            />
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t.outcomes}</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Stat label={t.issued} value={String(outcomes.issued)} />
          <Stat label={t.approved} value={String(outcomes.approved)} />
          <Stat label={t.changesRequested} value={String(outcomes.changesRequested)} />
          <Stat
            label={t.winRate}
            // Unknown, not zero: a business that has not quoted has not lost.
            value={
              outcomes.winRateBp === null ? '—' : `${(outcomes.winRateBp / 100).toFixed(0)}%`
            }
            note={outcomes.winRateBp === null ? t.winRateUnknown : undefined}
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {strings.profitability.title}
        </h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Stat
            label={t.quotedTotal}
            value={formatMoney(analytics.quotedSubtotalCents, analytics.currency)}
          />
          <Stat
            label={t.projectedMargin}
            value={formatMoney(analytics.projectedMarginCents, analytics.currency)}
          />
        </div>

        {/* Every total names the subset it is based on. A single figure over an
            unstated subset reads as a fact and is not one. */}
        <p className="mt-2 text-xs text-ink-muted">
          {t.basedOn.replace('{counted}', String(analytics.projectsCounted))}
          {analytics.projectsIncomplete > 0
            ? ` ${t.excluded.replace('{excluded}', String(analytics.projectsIncomplete))}`
            : ''}
        </p>
        <p className="mt-1 text-xs text-ink-muted">{strings.profitability.projectionNote}</p>
      </section>
    </main>
  );
}
