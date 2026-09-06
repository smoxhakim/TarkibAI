import Link from 'next/link';
import { notFound as renderNotFound } from 'next/navigation';
import { requireDbUser } from '@/lib/auth/current-user';
import { ApiError } from '@/lib/http/api';
import { getProject } from '@/lib/projects/service';
import { strings } from '@/lib/strings';
import { StatusBadge } from '@/components/StatusBadge';
import { ProjectActions } from '@/components/ProjectActions';
import { ChatPanel } from '@/components/ChatPanel';
import { SpecPanel } from '@/components/SpecPanel';
import { listMessages } from '@/lib/ai/conversation-service';
import { isAiConfigured } from '@/lib/ai/config';
import { getSpec } from '@/lib/spec/service';
import { FilesPanel } from '@/components/FilesPanel';
import { listFiles } from '@/lib/files/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { ProjectMaterialsPanel } from '@/components/ProjectMaterialsPanel';
import { listMaterials, listProjectMaterials } from '@/lib/materials/service';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Panels for capabilities that do not exist yet. They are rendered as explicitly
 * empty rather than filled with placeholder data: a user must never be shown a
 * number the system did not actually calculate (PRD §5.3).
 */
function PendingPanel({ title, note }: { title: string; note: string }) {
  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{title}</h2>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
          {strings.workspace.comingSoon}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{note}</p>
    </section>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireDbUser();

  let project;
  try {
    project = await getProject(id, user.id);
  } catch (error) {
    // assertProjectAccess reports both "missing" and "not yours" as 404 so the
    // page cannot be used to probe for other users' project ids.
    if (error instanceof ApiError && error.status === 404) renderNotFound();
    throw error;
  }

  const [messages, spec, files, projectMaterials, library, costSettings] = await Promise.all([
    listMessages(project.id, user.id),
    getSpec(project.id, user.id),
    listFiles(project.id, user.id),
    listProjectMaterials(project.id, user.id),
    listMaterials(user.id, { includeArchived: false }),
    prisma.costSettings.findUnique({ where: { userId: user.id } }),
  ]);
  const currency = costSettings?.currency ?? 'MAD';
  const aiConfigured = isAiConfigured();
  const storageConfigured = isStorageConfigured();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/dashboard"
        className="text-sm text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
      >
        {strings.workspace.backToProjects}
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
          <p className="mt-1 text-xs text-ink-muted">
            {strings.projects.createdOn} {dateFormat.format(project.createdAt)}
          </p>
        </div>
        <StatusBadge project={project} />
      </div>

      <div className="mt-4 border-y border-line py-3">
        <ProjectActions
          projectId={project.id}
          title={project.title}
          archived={project.archivedAt !== null}
        />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <ChatPanel
          projectId={project.id}
          initialMessages={messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
          aiConfigured={aiConfigured}
          files={files.map((f) => ({ id: f.id, originalName: f.originalName, mimeType: f.mimeType }))}
        />
        <FilesPanel
          projectId={project.id}
          files={files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))}
          storageConfigured={storageConfigured}
        />
        <SpecPanel
          projectId={project.id}
          data={{
            spec: spec.spec,
            version: spec.version,
            status: spec.status,
            approvedAt: spec.approvedAt ? spec.approvedAt.toISOString() : null,
            missing: spec.missing,
            complete: spec.complete,
          }}
        />
        <ProjectMaterialsPanel
          projectId={project.id}
          currency={currency}
          specApproved={spec.status === 'approved'}
          selected={projectMaterials.map((row) => ({
            ...row,
            calculatedAt: row.calculatedAt ? row.calculatedAt.toISOString() : null,
          }))}
          library={library.map((m) => ({ id: m.id, name: m.name, category: m.category }))}
        />
        <PendingPanel title={strings.workspace.documents} note={strings.workspace.documentsNote} />
      </div>
    </main>
  );
}
