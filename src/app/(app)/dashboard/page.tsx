import Link from 'next/link';
import { requireDbUser } from '@/lib/auth/current-user';
import { listProjects } from '@/lib/projects/service';
import { strings } from '@/lib/strings';
import { StatusBadge } from '@/components/StatusBadge';
import { NewProjectForm } from '@/components/NewProjectForm';
import { ProjectActions } from '@/components/ProjectActions';
import { DOMAINS } from '@/lib/domains/registry';
import { resolveActiveWorkspace } from '@/lib/workspaces/access';
import { listWorkspacesFor } from '@/lib/workspaces/service';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { can } from '@/lib/workspaces/permissions';

// Reads the signed-in user's own data, so it must never be statically cached.
export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; workspace?: string }>;
}) {
  const { archived, workspace } = await searchParams;
  const showArchived = archived === 'true';

  const user = await requireDbUser();
  const { workspaceId, role } = await resolveActiveWorkspace(user.id, workspace ?? null);
  const workspaces = await listWorkspacesFor(user.id);
  const projects = await listProjects(workspaceId, { includeArchived: showArchived });
  const visible = showArchived ? projects.filter((p) => p.archivedAt) : projects;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{strings.projects.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{strings.projects.subtitle}</p>
        </div>
        <WorkspaceSwitcher workspaces={workspaces} activeId={workspaceId} />
        <Link
          href={showArchived ? '/dashboard' : '/dashboard?archived=true'}
          className="text-sm text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          {showArchived ? strings.projects.hideArchived : strings.projects.showArchived}
        </Link>
      </div>

      {showArchived ? null : (
        <div className="mt-6">
          {can(role, 'project.create') ? (
          <NewProjectForm
            domains={DOMAINS.map((domain) => ({
              id: domain.id,
              label: domain.label,
              description: domain.description,
            }))}
            workspaceId={workspaceId}
          />
          ) : null}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line px-6 py-12 text-center">
          <p className="font-medium">
            {showArchived ? strings.projects.emptyArchived : strings.projects.empty}
          </p>
          {showArchived ? null : (
            <p className="mt-1 text-sm text-ink-muted">{strings.projects.emptyHint}</p>
          )}
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {visible.map((project) => (
            <li key={project.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/projects/${project.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {project.title}
                  </Link>
                  <p className="mt-1 text-xs text-ink-muted">
                    {strings.projects.updatedOn} {dateFormat.format(project.updatedAt)}
                  </p>
                </div>
                <StatusBadge project={project} />
              </div>
              <div className="mt-3 border-t border-line pt-3">
                <ProjectActions
                  projectId={project.id}
                  title={project.title}
                  archived={project.archivedAt !== null}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
