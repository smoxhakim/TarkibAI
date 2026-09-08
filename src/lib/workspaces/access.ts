import { prisma } from '@/lib/db';
import { ApiError, notFound } from '@/lib/http/api';
import type { Workspace, WorkspaceMember } from '@/generated/prisma/client';
import { asWorkspaceRole, can, type Permission, type WorkspaceRole } from './permissions';

/**
 * The single authorization chokepoint for workspace-owned resources.
 *
 * Nothing outside this module compares a userId to a resource's owner. A
 * request resolves to a membership row, the membership carries a role, and the
 * role decides — so a new resource type gets the same answer as every existing
 * one without its author having to reason about it.
 *
 * # Missing and forbidden are both 404
 *
 * A 403 tells an unauthorised caller that the thing exists. That is a real leak
 * across workspaces — it would let anyone enumerate another business's project
 * ids — so a project you cannot see is reported exactly as one that is not
 * there. The same rule the ownership checks used before T18, now applied to
 * membership. The one exception is a permission you lack WITHIN a workspace you
 * belong to: you already know the project exists, so that is a 403 saying which
 * permission is missing, which is actionable.
 */
/**
 * A workspace id, distinguishable from a user id by the compiler.
 *
 * Both are strings, and the T18 refactor turned twenty-four call sites from
 * "pass the user id" into "pass the workspace id" — every one of which
 * typechecked either way. A branded type turns that whole class of mistake,
 * which silently reads another business's data or writes into it, into a build
 * error. `asWorkspaceId` is the only way to make one, so every construction is
 * a deliberate statement that this really is a workspace.
 */
declare const workspaceIdBrand: unique symbol;
export type WorkspaceId = string & { readonly [workspaceIdBrand]: true };

export const asWorkspaceId = (id: string): WorkspaceId => id as WorkspaceId;

export type WorkspaceAccess = {
  userId: string;
  workspaceId: WorkspaceId;
  role: WorkspaceRole;
};

export const forbidden = (permission: Permission, role: WorkspaceRole) =>
  new ApiError(
    403,
    `Your role in this workspace (${role}) does not allow this. It needs the "${permission}" permission.`,
    'forbidden'
  );

/** The caller's membership row, or null when they are not a member. */
export async function getMembership(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMember | null> {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

/** Membership of a workspace, or 404. */
export async function assertWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccess> {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) throw notFound('Workspace');
  return { userId, workspaceId: asWorkspaceId(workspaceId), role: asWorkspaceRole(membership.role) };
}

/** Membership plus a permission, or 404 / 403. */
export async function assertWorkspacePermission(
  workspaceId: string,
  userId: string,
  permission: Permission
): Promise<WorkspaceAccess> {
  const access = await assertWorkspaceAccess(workspaceId, userId);
  if (!can(access.role, permission)) throw forbidden(permission, access.role);
  return access;
}

/** Every workspace the user belongs to, personal first, then by name. */
export async function listMemberships(
  userId: string
): Promise<(WorkspaceMember & { workspace: Workspace })[]> {
  return prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: [{ workspace: { personal: 'desc' } }, { workspace: { name: 'asc' } }],
  });
}

/**
 * A user's personal workspace, created if it does not exist yet.
 *
 * Every user has one and it cannot be left or deleted, so there is no state in
 * which somebody is signed in with nowhere to work. Created here rather than in
 * the sign-up path because a user row can also arrive from a backfill or an
 * import, and all of those need the same guarantee.
 */
export async function ensurePersonalWorkspace(userId: string): Promise<Workspace> {
  const existing = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { personal: true } },
    include: { workspace: true },
  });
  if (existing) return existing.workspace;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const name = user.companyName?.trim() || user.name?.trim() || user.email.split('@')[0];

  return prisma.workspace.create({
    data: {
      name,
      personal: true,
      members: { create: { userId, role: 'owner' } },
    },
  });
}

/**
 * Which workspace a request is acting in.
 *
 * A requested workspace is honoured only if the caller is a member of it;
 * otherwise this falls back to their personal one rather than throwing, because
 * a stale id in a bookmark should not make the dashboard unopenable. Anything
 * that acts ON a specific workspace still goes through `assertWorkspaceAccess`
 * and gets a 404 there.
 */
export async function resolveActiveWorkspace(
  userId: string,
  requestedId?: string | null
): Promise<WorkspaceAccess> {
  if (requestedId) {
    const membership = await getMembership(requestedId, userId);
    if (membership) {
      return {
        userId,
        workspaceId: asWorkspaceId(requestedId),
        role: asWorkspaceRole(membership.role),
      };
    }
  }

  const personal = await ensurePersonalWorkspace(userId);
  const membership = await getMembership(personal.id, userId);
  return {
    userId,
    workspaceId: asWorkspaceId(personal.id),
    role: membership ? asWorkspaceRole(membership.role) : 'owner',
  };
}
