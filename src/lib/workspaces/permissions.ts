/**
 * Workspace roles and what each one may do.
 *
 * Pure data and pure functions: no database, no session. Authorization is
 * decided here and enforced at one chokepoint, so "can this person do this"
 * has exactly one answer and one place to read it.
 *
 * # Why a matrix rather than checks scattered at call sites
 *
 * A permission tested inline in a route is a permission that can be forgotten
 * in the next route. Every role's full set is written out below, so adding a
 * capability means deciding what each role gets rather than defaulting to
 * whoever happens to reach the code first.
 *
 * # The one that matters most
 *
 * `cost.view` guards internal cost, margin and purchase prices. A worker on the
 * shop floor has no business seeing the margin on the job they are building,
 * and a subcontractor even less. It is enforced by REFUSING the read, not by
 * filtering a response — the same reasoning as the client-safe quote boundary
 * in T13. Data that is never fetched cannot leak through a field somebody adds
 * later.
 */

export const WORKSPACE_ROLES = [
  'owner',
  'admin',
  'designer',
  'sales',
  'production',
  'worker',
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  designer: 'Designer',
  sales: 'Sales',
  production: 'Production manager',
  worker: 'Worker',
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: 'Everything, including members, billing and deleting the workspace.',
  admin: 'Everything except deleting the workspace or removing the owner.',
  designer: 'Specifications, design and drawings. No costs and no quotes.',
  sales: 'Specifications, costs, quotes and client documents. No design editing.',
  production: 'Drawings, cutting plans, the material library and production packages. No costs.',
  worker: 'Read the project and its production package. Nothing else.',
};

export const PERMISSIONS = [
  /** See a project at all. Without it the project does not exist to you. */
  'project.view',
  'project.create',
  /** Edit the specification, files and conversation. */
  'project.edit',
  'project.delete',
  /** Edit the canvas and decide on design proposals. */
  'design.edit',
  /** The shared material library. */
  'material.manage',
  /** Internal cost, margin and purchase prices. */
  'cost.view',
  /** The costing rules that produce them. */
  'cost.manage',
  'quote.view',
  /** Create, edit and issue client quotations. */
  'quote.create',
  'production.view',
  'production.generate',
  /** Invite, remove and re-role members; rename the workspace. */
  'workspace.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Every role's complete set, written out rather than derived.
 *
 * Derivation by seniority ("admin gets everything designer gets, plus…") reads
 * neatly and hides the question that matters: does THIS role need THIS. Sales
 * can see costs and cannot touch the canvas; production can touch the material
 * library and cannot see costs. Neither falls out of a hierarchy.
 */
const MATRIX: Record<WorkspaceRole, readonly Permission[]> = {
  owner: [...PERMISSIONS],

  // Everything the owner has. Deleting the workspace and removing the owner are
  // not permissions — they are owner-only checks, because a permission can be
  // granted and those cannot.
  admin: [...PERMISSIONS],

  designer: ['project.view', 'project.create', 'project.edit', 'design.edit', 'production.view'],

  // Sales prices the work, so they see internal cost: a quote negotiated
  // without knowing the margin is a quote negotiated blind. They do not edit
  // the design.
  sales: [
    'project.view',
    'project.create',
    'project.edit',
    'cost.view',
    'quote.view',
    'quote.create',
    'production.view',
  ],

  // Buys the material and runs the floor. No cost visibility: the purchase
  // quantities they need are not the margin they do not.
  production: [
    'project.view',
    'project.edit',
    'material.manage',
    'production.view',
    'production.generate',
    'quote.view',
  ],

  // Reads the job and its package. This is the role the cost boundary exists
  // for.
  worker: ['project.view', 'production.view'],
};

export function permissionsFor(role: WorkspaceRole): readonly Permission[] {
  return MATRIX[role];
}

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** Roles that may act on the workspace itself. Not expressible as a permission. */
export function isOwnerOnly(role: WorkspaceRole): boolean {
  return role === 'owner';
}

/** Narrows a role read back from the database. Throws rather than defaulting:
 *  an unrecognised role must never silently become a permissive one. */
export function asWorkspaceRole(value: string): WorkspaceRole {
  if ((WORKSPACE_ROLES as readonly string[]).includes(value)) return value as WorkspaceRole;
  throw new Error(`Unrecognised workspace role: ${JSON.stringify(value)}`);
}
