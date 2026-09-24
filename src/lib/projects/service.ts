import { prisma } from '@/lib/db';
import type { WorkspaceId } from '@/lib/workspaces/access';
import { notFound } from '@/lib/http/api';
import type { Project } from '@/generated/prisma/client';
import type { CreateProjectInput, UpdateProjectInput } from './schema';
import { recordAudit } from '@/lib/audit/service';
import { assertWorkspacePermission, getMembership, type WorkspaceAccess } from '@/lib/workspaces/access';
import { asWorkspaceRole, can, type Permission } from '@/lib/workspaces/permissions';

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
/**
 * The single gate every project-scoped service passes through.
 *
 * Before T18 this compared `project.userId` to the caller. It now resolves the
 * project's workspace and requires a membership row there. The signature is
 * unchanged on purpose: eighty-odd call sites inherited the new rule without
 * each having to be reasoned about, which is the point of having one gate.
 *
 * `project.userId` still exists and records who CREATED the project. It is
 * never consulted here, and nothing else may consult it for access either.
 *
 * A project in a workspace you do not belong to is reported as missing, not as
 * forbidden — a 403 would confirm it exists and let anyone enumerate another
 * business's projects.
 */
export async function assertProjectAccess(projectId: string, userId: string): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound('Project');

  const membership = await getMembership(project.workspaceId, userId);
  if (!membership) throw notFound('Project');

  return project;
}

/**
 * Whether the caller holds a permission on a project, without throwing.
 *
 * For aggregators that must DEGRADE rather than fail. A worker opening a
 * project should see the project — minus the cost panel — not an error page,
 * so the page asks this and omits the section instead of catching a 403 it
 * provoked on purpose.
 */
export async function hasProjectPermission(
  projectId: string,
  userId: string,
  permission: Permission
): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return false;
  const membership = await getMembership(project.workspaceId, userId);
  if (!membership) return false;
  return can(asWorkspaceRole(membership.role), permission);
}

/**
 * Access plus a specific permission.
 *
 * Separate from `assertProjectAccess` because viewing is the baseline every
 * role has, and the interesting question is what a member may DO. Called at the
 * actions that change something or expose something private, never as a
 * blanket wrapper — a permission check on a read that every role may perform
 * is noise that hides the ones that matter.
 */
export async function assertProjectPermission(
  projectId: string,
  userId: string,
  permission: Permission
): Promise<{ project: Project; access: WorkspaceAccess }> {
  const project = await assertProjectAccess(projectId, userId);
  const access = await assertWorkspacePermission(project.workspaceId, userId, permission);
  return { project, access };
}

export async function listProjects(
  workspaceId: WorkspaceId,
  options: { includeArchived?: boolean } = {}
): Promise<Project[]> {
  return prisma.project.findMany({
    where: {
      workspaceId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Creates a project in a workspace.
 *
 * The permission is asserted HERE and not only in the route. Every other write
 * in this codebase is refusable at the service, and a creation that is only
 * guarded by its caller is a creation the next caller can forget to guard —
 * which is the shape of every finding Tasks 5–9 closed.
 *
 * It takes a workspace rather than a project gate because there is no project
 * yet: `assertProjectPermission` needs a row to resolve, and this is the call
 * that makes one.
 */
export async function createProject(
  workspaceId: WorkspaceId,
  userId: string,
  input: CreateProjectInput
): Promise<Project> {
  await assertWorkspacePermission(workspaceId, userId, 'project.create');

  return prisma.project.create({
    // The column defaults to signage, so an omitted domain keeps the behaviour
    // every project had before T17.
    data: {
      workspaceId,
      userId,
      title: input.title,
      ...(input.domain ? { domain: input.domain } : {}),
    },
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
  await assertProjectPermission(projectId, userId, 'project.edit');

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
  const { project } = await assertProjectPermission(projectId, userId, 'project.delete');
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
