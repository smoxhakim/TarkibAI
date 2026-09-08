import { requireDbUser } from '@/lib/auth/current-user';
import { resolveActiveWorkspace } from '@/lib/workspaces/access';
import { can } from '@/lib/workspaces/permissions';
import { getWorkspaceView, listWorkspacesFor } from '@/lib/workspaces/service';
import { strings } from '@/lib/strings';
import { WorkspacePanel } from '@/components/WorkspacePanel';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { NewWorkspaceForm } from '@/components/NewWorkspaceForm';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { workspace } = await searchParams;
  const user = await requireDbUser();

  const { workspaceId, role } = await resolveActiveWorkspace(user.id, workspace ?? null);
  const [view, workspaces] = await Promise.all([
    getWorkspaceView(workspaceId, user.id),
    listWorkspacesFor(user.id),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{view.workspace.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">{strings.workspaces.subtitle}</p>
        </div>
        <WorkspaceSwitcher workspaces={workspaces} activeId={workspaceId} />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <WorkspacePanel
          workspaceId={workspaceId}
          personal={view.workspace.personal}
          yourRole={view.members.find((member) => member.isYou)?.roleLabel ?? ''}
          canManage={can(role, 'workspace.manage')}
          members={view.members.map((member) => ({
            userId: member.userId,
            name: member.name,
            email: member.email,
            role: member.role,
            roleLabel: member.roleLabel,
            isYou: member.isYou,
          }))}
          invitations={view.invitations.map((invitation) => ({
            id: invitation.id,
            email: invitation.email,
            roleLabel: invitation.roleLabel,
            expired: invitation.expired,
            acceptPath: invitation.acceptPath,
          }))}
          roleOptions={view.roleOptions}
        />
        <NewWorkspaceForm />
      </div>
    </main>
  );
}
