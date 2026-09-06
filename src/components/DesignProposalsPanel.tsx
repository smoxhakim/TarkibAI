'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';
import { OBJECT_TYPE_LABELS, type ObjectType, type SceneCommand } from '@/lib/canvas/schema';
import { formatMm } from '@/lib/canvas/render';

export type ProposalItem = {
  id: string;
  summary: string;
  commands: SceneCommand[];
  hasSpecPatch: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  failureReason: string | null;
  createdAt: string;
};

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Renders a command as a plain sentence.
 *
 * Deliberately derived from the command itself rather than from the agent's
 * summary: the summary is model-written prose, while this is what will actually
 * execute. A user approving a change should see the real operation.
 */
function describeCommand(command: SceneCommand): string {
  switch (command.kind) {
    case 'add_object': {
      const type = OBJECT_TYPE_LABELS[command.object.type as ObjectType] ?? command.object.type;
      const label = command.object.label ? ` "${command.object.label}"` : '';
      return `${strings.design.commandAdd} ${type}${label} — ${formatMm(command.object.widthMm)} × ${formatMm(command.object.heightMm)}`;
    }
    case 'update_object': {
      const parts = Object.entries(command.changes)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
          if (key === 'widthMm' || key === 'heightMm' || key === 'x' || key === 'y') {
            return `${key.replace('Mm', '')} → ${formatMm(Number(value))}`;
          }
          return `${key} → ${value === null ? 'none' : String(value)}`;
        });
      return `${strings.design.commandUpdate} ${command.id}: ${parts.join(', ')}`;
    }
    case 'remove_object':
      return `${strings.design.commandRemove} ${command.id}`;
    default:
      return '';
  }
}

export function DesignProposalsPanel({
  projectId,
  proposals,
}: {
  projectId: string;
  proposals: ProposalItem[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const pending = proposals.filter((p) => p.status === 'pending');
  const history = proposals.filter((p) => p.status !== 'pending');

  async function decide(proposalId: string, choice: 'approve' | 'reject') {
    setBusyId(proposalId);
    setDecision(choice);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/design-proposals/${proposalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: choice }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.design.failed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.design.failed);
    } finally {
      setBusyId(null);
      setDecision(null);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{strings.design.title}</h2>
        {history.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowHistory((prev) => !prev)}
            className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {showHistory ? strings.design.hideHistory : strings.design.showHistory}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{strings.design.subtitle}</p>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {pending.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium">{strings.design.none}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.design.noneHint}</p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {pending.map((proposal) => (
            <li key={proposal.id} className="rounded-md border border-accent/40 bg-accent/5 p-3">
              <p className="text-xs font-medium text-accent">{strings.design.pending}</p>
              <p className="mt-1 text-sm">{proposal.summary}</p>

              <ul className="mt-2 flex flex-col gap-0.5">
                {proposal.commands.map((command, index) => (
                  <li key={index} className="font-mono text-xs text-ink-muted">
                    {describeCommand(command)}
                  </li>
                ))}
              </ul>

              {proposal.hasSpecPatch ? (
                <p className="mt-2 rounded-md bg-surface-muted px-2 py-1.5 text-xs text-ink-muted">
                  {strings.design.specNotice}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => decide(proposal.id, 'approve')}
                  disabled={busyId === proposal.id}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {busyId === proposal.id && decision === 'approve'
                    ? strings.design.approving
                    : strings.design.approve}
                </button>
                <button
                  type="button"
                  onClick={() => decide(proposal.id, 'reject')}
                  disabled={busyId === proposal.id}
                  className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
                >
                  {busyId === proposal.id && decision === 'reject'
                    ? strings.design.rejecting
                    : strings.design.reject}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showHistory && history.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-medium">{strings.design.history}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {history.map((proposal) => (
              <li key={proposal.id} className="text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-ink-muted">{proposal.summary}</span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {strings.design.status[proposal.status]} ·{' '}
                    {dateFormat.format(new Date(proposal.createdAt))}
                  </span>
                </div>
                {proposal.failureReason ? (
                  <p className="mt-0.5 text-xs text-red-600">{proposal.failureReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
