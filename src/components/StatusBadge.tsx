import { strings } from '@/lib/strings';
import { displayStatus } from '@/lib/projects/status';

const TONE: Record<string, string> = {
  intake: 'bg-surface-muted text-ink-muted',
  spec_approved: 'bg-accent/10 text-accent',
  calculated: 'bg-accent/10 text-accent',
  quoted: 'bg-accent/15 text-accent',
  production_ready: 'bg-accent/20 text-accent',
  archived: 'bg-surface-muted text-ink-muted',
};

export function StatusBadge({ project }: { project: { status: string; archivedAt: Date | null } }) {
  const status = displayStatus(project);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status]}`}
    >
      {strings.status[status]}
    </span>
  );
}
