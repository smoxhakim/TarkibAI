'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { strings } from '@/lib/strings';

export type WorkspaceOption = { id: string; name: string; personal: boolean; role: string };

/**
 * Which workspace the page is showing.
 *
 * The choice lives in the URL rather than in a cookie or a session field, so a
 * link to a project list is a link to THAT business's project list, and two
 * tabs can show two workspaces without fighting each other.
 */
export function WorkspaceSwitcher({ workspaces, activeId }: { workspaces: WorkspaceOption[]; activeId: string }) {
  const router = useRouter();
  const params = useSearchParams();

  if (workspaces.length <= 1) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-muted">{strings.workspaces.switchLabel}</span>
      <select
        value={activeId}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          next.set('workspace', event.target.value);
          router.push(`?${next.toString()}`);
        }}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
            {workspace.personal ? ` (${strings.workspaces.personal.toLowerCase()})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
