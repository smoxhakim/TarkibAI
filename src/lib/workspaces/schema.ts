import { z } from 'zod';
import { WORKSPACE_ROLES } from './permissions';

const workspaceName = z.string().trim().min(1, 'A workspace needs a name.').max(120);

/** The owner role is transferred, never handed out in an invitation. */
const grantableRole = z.enum(
  WORKSPACE_ROLES.filter((role) => role !== 'owner') as [string, ...string[]]
);

export const createWorkspaceSchema = z.object({ name: workspaceName });
export const renameWorkspaceSchema = z.object({ name: workspaceName });

export const inviteMemberSchema = z.object({
  email: z.string().trim().email('That is not a valid email address.').max(160),
  role: grantableRole,
});

export const changeRoleSchema = z.object({
  role: z.enum(WORKSPACE_ROLES as unknown as [string, ...string[]]),
});
