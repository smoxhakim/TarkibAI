import { assertWorkspaceAccess, type WorkspaceId } from '@/lib/workspaces/access';
import { can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import { assertProjectAccess } from '@/lib/projects/service';
import { getDomain } from '@/lib/domains/registry';
import type { DomainProfile } from '@/lib/domains/types';

/**
 * Who the agent is acting as, resolved once per turn.
 *
 * Before T21 the toolbox was built from `(projectId, userId)` alone, which made
 * every tool available to every member of the workspace. That was wrong in both
 * directions: a worker — the role the cost boundary exists for — could ask the
 * assistant for a saving in dirhams, and could drive `update_project_spec` even
 * though `project.edit` is exactly the permission they do not have. The chat
 * route was therefore a way around the permission matrix — an AI tool call has
 * to sit inside the same authorization boundary as the direct operation
 * (ARCHITECTURE §7, §19).
 *
 * Resolving the role once, here, means the toolbox and the prompt agree about
 * what this person may do, and neither has to re-derive it.
 *
 * `userId` is the internal User.id from the Clerk session. It is never accepted
 * from model output, and there is deliberately no way to construct this type
 * from a tool argument.
 */
export type ProjectAiAccess = {
  projectId: string;
  workspaceId: WorkspaceId;
  userId: string;
  role: WorkspaceRole;
  domain: DomainProfile;
};

/**
 * The permissions the AI layer actually branches on, named for what they mean
 * here rather than for the matrix entry behind them.
 *
 * A flat record rather than repeated `can(role, '…')` calls at twenty sites: a
 * new tool then has to state which grant it needs, and the grant is testable on
 * its own without a database.
 */
export type AiGrants = {
  /** Record what the user says into the specification. */
  editProject: boolean;
  /** Propose a change to the canvas. */
  editDesign: boolean;
  /** Internal cost, margin, purchase prices and computed savings. */
  viewCost: boolean;
  /** Client quotations. */
  viewQuotes: boolean;
  /** The shared material library. */
  manageMaterials: boolean;
  /** The workshop package. */
  viewProduction: boolean;
};

export function grantsFor(role: WorkspaceRole): AiGrants {
  return {
    editProject: can(role, 'project.edit'),
    editDesign: can(role, 'design.edit'),
    viewCost: can(role, 'cost.view'),
    viewQuotes: can(role, 'quote.view'),
    manageMaterials: can(role, 'material.manage'),
    viewProduction: can(role, 'production.view'),
  };
}

/**
 * The project, the workspace and the caller's role in it, or 404.
 *
 * Both gates are the existing ones, in the existing order: `assertProjectAccess`
 * first, so a project in a workspace the caller does not belong to is reported
 * as missing exactly as every other read path reports it, then
 * `assertWorkspaceAccess` for the role. Nothing here compares a user id to an
 * owner — that comparison lives in one module and this is not it.
 */
export async function resolveProjectAiAccess(
  projectId: string,
  userId: string
): Promise<ProjectAiAccess> {
  const project = await assertProjectAccess(projectId, userId);
  const { workspaceId, role } = await assertWorkspaceAccess(project.workspaceId, userId);

  return {
    projectId: project.id,
    workspaceId,
    userId,
    role,
    domain: getDomain(project.domain),
  };
}
