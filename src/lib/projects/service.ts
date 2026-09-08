import { prisma } from '@/lib/db';
import { notFound } from '@/lib/http/api';
import type { Project } from '@/generated/prisma/client';
import type { CreateProjectInput, UpdateProjectInput } from './schema';
import { recordAudit } from '@/lib/audit/service';

/**
 * Loads a project and asserts the caller owns it.
 *
 * A project belonging to somebody else is reported as 404, not 403 — a 403
 * would confirm that the id exists, leaking the existence of another user's
 * data. Every read/write path goes through this function; no route handler
 * queries Project directly.
 *
 * `userId` is the internal User.id resolved from the Clerk session by
 * requireDbUser(). It is never accepted from request input.
 */
export async function assertProjectAccess(projectId: string, userId: string): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== userId) throw notFound('Project');
  return project;
}

export async function listProjects(
  userId: string,
  options: { includeArchived?: boolean } = {}
): Promise<Project[]> {
  return prisma.project.findMany({
    where: {
      userId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function createProject(userId: string, input: CreateProjectInput): Promise<Project> {
  return prisma.project.create({
    data: { userId, title: input.title },
  });
}

export async function getProject(projectId: string, userId: string): Promise<Project> {
  return assertProjectAccess(projectId, userId);
}

export async function updateProject(
  projectId: string,
  userId: string,
  input: UpdateProjectInput
): Promise<Project> {
  await assertProjectAccess(projectId, userId);

  const data: { title?: string; archivedAt?: Date | null } = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.archived !== undefined) data.archivedAt = input.archived ? new Date() : null;

  const updated = await prisma.project.update({ where: { id: projectId }, data });

  if (input.archived !== undefined) {
    await recordAudit({
      userId,
      projectId,
      action: input.archived ? 'project.archived' : 'project.restored',
      summary: `${input.archived ? 'Archived' : 'Restored'} the project "${updated.title}".`,
    });
  }

  return updated;
}

/**
 * Permanent delete. Dependent rows (messages, specs, calculations, cutting
 * plans, costs, documents) are removed by the ON DELETE CASCADE constraints
 * declared in schema.prisma.
 *
 * The UI archives by default and gates this behind an explicit confirmation:
 * fabrication projects carry client quotes and production documents that must
 * not disappear on a misclick.
 */
export async function deleteProject(projectId: string, userId: string): Promise<void> {
  const project = await assertProjectAccess(projectId, userId);
  await prisma.project.delete({ where: { id: projectId } });

  // The project link is set null by the delete, so the event survives as a
  // record that the project existed and was removed. That is the one case where
  // the trail matters most.
  await recordAudit({
    userId,
    projectId: null,
    action: 'project.deleted',
    summary: `Deleted the project "${project.title}" and everything derived from it.`,
    detail: { projectId, title: project.title },
  });
}
