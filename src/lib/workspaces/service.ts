import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import { recordAudit } from '@/lib/audit/service';
import type { Workspace, WorkspaceInvitation, WorkspaceMember } from '@/generated/prisma/client';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  asWorkspaceRole,
  isOwnerOnly,
  permissionsFor,
  type WorkspaceRole,
} from './permissions';
import {
  assertWorkspaceAccess,
  assertWorkspacePermission,
  ensurePersonalWorkspace,
  getMembership,
  listMemberships,
  type WorkspaceId,
} from './access';

/** Long enough that guessing one is not a way into somebody's business. */
const INVITE_TOKEN_BYTES = 32;
const INVITE_VALID_DAYS = 14;

export type MemberView = {
  userId: string;
  name: string | null;
  email: string;
  role: WorkspaceRole;
  roleLabel: string;
  joinedAt: Date;
  /** True for the caller's own row, which the UI must not offer to remove. */
  isYou: boolean;
};

export type InvitationView = {
  id: string;
  email: string;
  role: WorkspaceRole;
  roleLabel: string;
  expiresAt: Date;
  expired: boolean;
  /** The link the inviter sends. No email is dispatched — see `inviteMember`. */
  acceptPath: string;
};

export type WorkspaceView = {
  workspace: Workspace;
  role: WorkspaceRole;
  permissions: readonly string[];
  members: MemberView[];
  invitations: InvitationView[];
  /** Roles offered when inviting, with what each one means. */
  roleOptions: { id: WorkspaceRole; label: string; description: string }[];
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export async function listWorkspacesFor(userId: string) {
  await ensurePersonalWorkspace(userId);
  const memberships = await listMemberships(userId);
  return memberships.map((membership) => ({
    id: membership.workspaceId,
    name: membership.workspace.name,
    personal: membership.workspace.personal,
    role: asWorkspaceRole(membership.role),
  }));
}

export async function getWorkspaceView(
  workspaceId: string,
  userId: string
): Promise<WorkspaceView> {
  const access = await assertWorkspaceAccess(workspaceId, userId);

  const [workspace, members, invitations] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.workspaceInvitation.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const now = new Date();
  return {
    workspace,
    role: access.role,
    permissions: permissionsFor(access.role),
    members: members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: asWorkspaceRole(member.role),
      roleLabel: ROLE_LABELS[asWorkspaceRole(member.role)],
      joinedAt: member.createdAt,
      isYou: member.userId === userId,
    })),
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: asWorkspaceRole(invitation.role),
      roleLabel: ROLE_LABELS[asWorkspaceRole(invitation.role)],
      expiresAt: invitation.expiresAt,
      expired: invitation.expiresAt < now,
      acceptPath: `/invitations/${invitation.token}`,
    })),
    roleOptions: (Object.keys(ROLE_LABELS) as WorkspaceRole[])
      // The owner role is transferred, not handed out.
      .filter((role) => role !== 'owner')
      .map((role) => ({ id: role, label: ROLE_LABELS[role], description: ROLE_DESCRIPTIONS[role] })),
  };
}

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                  */
/* -------------------------------------------------------------------------- */

export async function createWorkspace(userId: string, name: string): Promise<Workspace> {
  const workspace = await prisma.workspace.create({
    data: { name: name.trim(), personal: false, members: { create: { userId, role: 'owner' } } },
  });

  await recordAudit({
    userId,
    action: 'workspace.created',
    summary: `Created the workspace "${workspace.name}".`,
    detail: { workspaceId: workspace.id },
  });

  return workspace;
}

export async function renameWorkspace(
  workspaceId: string,
  userId: string,
  name: string
): Promise<Workspace> {
  await assertWorkspacePermission(workspaceId, userId, 'workspace.manage');
  return prisma.workspace.update({ where: { id: workspaceId }, data: { name: name.trim() } });
}

/* -------------------------------------------------------------------------- */
/* Members                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Invites somebody by email.
 *
 * Addressed to an email rather than a user because the person may not have an
 * account yet — users are created lazily from the identity provider on first
 * sign-in, so requiring one first would mean nobody could be invited before
 * they had already signed up.
 *
 * NO EMAIL IS SENT. There is no mail provider wired into the product yet, and
 * pretending to send one would leave an invitation nobody receives. The token
 * is returned so the inviter can pass the link on themselves.
 */
export async function inviteMember(
  workspaceId: string,
  userId: string,
  input: { email: string; role: WorkspaceRole }
): Promise<WorkspaceInvitation> {
  await assertWorkspacePermission(workspaceId, userId, 'workspace.manage');

  if (isOwnerOnly(input.role)) {
    throw badRequest('The owner role is transferred, not granted. Invite an admin instead.');
  }

  const email = input.email.trim().toLowerCase();

  // Already a member: say so rather than creating an invitation that would do
  // nothing when accepted.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser && (await getMembership(workspaceId, existingUser.id))) {
    throw badRequest('That person is already a member of this workspace.');
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_VALID_DAYS);

  const invitation = await prisma.workspaceInvitation.upsert({
    where: { workspaceId_email: { workspaceId, email } },
    // Re-inviting replaces the previous token, so a link shared by mistake
    // stops working.
    update: {
      role: input.role,
      token: randomBytes(INVITE_TOKEN_BYTES).toString('base64url'),
      invitedByUserId: userId,
      expiresAt,
      acceptedAt: null,
      revokedAt: null,
    },
    create: {
      workspaceId,
      email,
      role: input.role,
      token: randomBytes(INVITE_TOKEN_BYTES).toString('base64url'),
      invitedByUserId: userId,
      expiresAt,
    },
  });

  await recordAudit({
    userId,
    action: 'workspace.invited',
    summary: `Invited ${email} as ${ROLE_LABELS[input.role].toLowerCase()}.`,
    detail: { workspaceId, email, role: input.role },
  });

  return invitation;
}

export async function revokeInvitation(
  workspaceId: string,
  userId: string,
  invitationId: string
): Promise<void> {
  await assertWorkspacePermission(workspaceId, userId, 'workspace.manage');

  const invitation = await prisma.workspaceInvitation.findFirst({
    where: { id: invitationId, workspaceId },
  });
  if (!invitation) throw notFound('Invitation');

  // Marked revoked rather than deleted: deleting would free the unique
  // (workspace, email) slot and let the same token be recreated, and a link
  // already shared should stay dead.
  await prisma.workspaceInvitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date() },
  });
}

/** What an invitation is for, before the invitee decides. */
export async function describeInvitation(token: string) {
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: { workspace: { select: { name: true } } },
  });
  if (!invitation) throw notFound('Invitation');

  return {
    workspaceName: invitation.workspace.name,
    role: asWorkspaceRole(invitation.role),
    roleLabel: ROLE_LABELS[asWorkspaceRole(invitation.role)],
    email: invitation.email,
    expired: invitation.expiresAt < new Date(),
    accepted: invitation.acceptedAt !== null,
    revoked: invitation.revokedAt !== null,
  };
}

/**
 * Accepts an invitation.
 *
 * The signed-in account's email must match the address the invitation was sent
 * to. Without that check a leaked link would let whoever holds it join, which
 * is the whole risk of an emailed token.
 */
export async function acceptInvitation(token: string, userId: string): Promise<WorkspaceMember> {
  const invitation = await prisma.workspaceInvitation.findUnique({ where: { token } });
  if (!invitation) throw notFound('Invitation');

  if (invitation.revokedAt) throw badRequest('This invitation has been withdrawn.');
  if (invitation.acceptedAt) throw badRequest('This invitation has already been used.');
  if (invitation.expiresAt < new Date()) throw badRequest('This invitation has expired.');

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email.trim().toLowerCase() !== invitation.email) {
    throw new ApiError(
      403,
      `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
      'invitation_wrong_account'
    );
  }

  const [member] = await prisma.$transaction([
    prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      update: {},
      create: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
    }),
    prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  await recordAudit({
    userId,
    action: 'workspace.joined',
    summary: `Joined the workspace as ${ROLE_LABELS[asWorkspaceRole(invitation.role)].toLowerCase()}.`,
    detail: { workspaceId: invitation.workspaceId, role: invitation.role },
  });

  return member;
}

/** The workspace's owner, which every workspace must always have exactly one of. */
async function ownerCount(workspaceId: string): Promise<number> {
  return prisma.workspaceMember.count({ where: { workspaceId, role: 'owner' } });
}

export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  targetUserId: string,
  role: WorkspaceRole
): Promise<WorkspaceMember> {
  const access = await assertWorkspacePermission(workspaceId, userId, 'workspace.manage');

  const target = await getMembership(workspaceId, targetUserId);
  if (!target) throw notFound('Member');

  const targetRole = asWorkspaceRole(target.role);

  // Only an owner may hand the owner role over, and only an owner may take it
  // from somebody. An admin holds every permission but cannot promote itself.
  if ((isOwnerOnly(role) || isOwnerOnly(targetRole)) && !isOwnerOnly(access.role)) {
    throw new ApiError(403, 'Only the owner can change who the owner is.', 'forbidden');
  }

  if (isOwnerOnly(targetRole) && !isOwnerOnly(role) && (await ownerCount(workspaceId)) <= 1) {
    throw badRequest(
      'This workspace would be left with no owner. Make somebody else the owner first.'
    );
  }

  const updated = await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    data: { role },
  });

  await recordAudit({
    userId,
    action: 'workspace.role_changed',
    summary: `Changed a member's role to ${ROLE_LABELS[role].toLowerCase()}.`,
    detail: { workspaceId, targetUserId, from: targetRole, to: role },
  });

  return updated;
}

export async function removeMember(
  workspaceId: string,
  userId: string,
  targetUserId: string
): Promise<void> {
  const access = await assertWorkspacePermission(workspaceId, userId, 'workspace.manage');

  const target = await getMembership(workspaceId, targetUserId);
  if (!target) throw notFound('Member');

  if (isOwnerOnly(asWorkspaceRole(target.role))) {
    throw badRequest('The owner cannot be removed. Transfer the workspace first.');
  }

  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (workspace.personal) {
    throw badRequest('A personal workspace has only its owner.');
  }

  // Removing yourself is leaving, which is allowed; removing somebody else
  // needs the permission checked above and is not allowed against the owner.
  void access;

  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });

  await recordAudit({
    userId,
    action: 'workspace.member_removed',
    summary: `Removed a member from the workspace.`,
    detail: { workspaceId, targetUserId, role: target.role },
  });
}

export type { WorkspaceId };
