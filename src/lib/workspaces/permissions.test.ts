import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  WORKSPACE_ROLES,
  asWorkspaceRole,
  can,
  isOwnerOnly,
  permissionsFor,
  type Permission,
  type WorkspaceRole,
} from './permissions';

describe('the matrix is complete', () => {
  it.each(WORKSPACE_ROLES)('%s has a defined permission set, a label and a description', (role) => {
    expect(permissionsFor(role)).toBeDefined();
    expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(0);
  });

  it.each(WORKSPACE_ROLES)('%s grants only permissions that exist', (role) => {
    for (const permission of permissionsFor(role)) {
      expect(PERMISSIONS).toContain(permission);
    }
  });

  it.each(WORKSPACE_ROLES)('%s can see a project at all', (role) => {
    // A role that cannot view a project is a role that cannot use the product.
    expect(can(role, 'project.view')).toBe(true);
  });

  it('grants every permission to somebody', () => {
    // A permission no role has is dead code pretending to be a policy.
    for (const permission of PERMISSIONS) {
      const holders = WORKSPACE_ROLES.filter((role) => can(role, permission));
      expect(holders.length, `nobody has ${permission}`).toBeGreaterThan(0);
    }
  });
});

describe('cost visibility', () => {
  it('is denied to the roles that have no business seeing margin', () => {
    // The PRD's headline example: a worker must not see the margin on the job
    // they are building, and production buys material without pricing it.
    expect(can('worker', 'cost.view')).toBe(false);
    expect(can('production', 'cost.view')).toBe(false);
    expect(can('designer', 'cost.view')).toBe(false);
  });

  it('is granted to the roles that price the work', () => {
    expect(can('sales', 'cost.view')).toBe(true);
    expect(can('owner', 'cost.view')).toBe(true);
    expect(can('admin', 'cost.view')).toBe(true);
  });

  it('never comes with quoting for a role that cannot see cost', () => {
    // Issuing a quote without cost visibility would mean pricing blind.
    for (const role of WORKSPACE_ROLES) {
      if (can(role, 'quote.create')) expect(can(role, 'cost.view')).toBe(true);
      // Writing a quotation you cannot read would be a nonsense state, and the
      // write gate is layered on the read one, so it could never be reached.
      if (can(role, 'quote.create')) expect(can(role, 'quote.view')).toBe(true);
    }
  });
});

describe('role shapes that are not a hierarchy', () => {
  it('lets sales price without touching the design', () => {
    expect(can('sales', 'cost.view')).toBe(true);
    expect(can('sales', 'design.edit')).toBe(false);
  });

  it('lets production buy material without seeing what it is sold for', () => {
    expect(can('production', 'material.manage')).toBe(true);
    expect(can('production', 'cost.view')).toBe(false);
  });

  it('lets a designer draw without quoting', () => {
    expect(can('designer', 'design.edit')).toBe(true);
    expect(can('designer', 'quote.create')).toBe(false);
  });

  it('gives a worker nothing beyond reading the job and its package', () => {
    expect([...permissionsFor('worker')].sort()).toEqual(['production.view', 'project.view']);
  });
});

describe('owner and admin', () => {
  it('both hold every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(can('owner', permission)).toBe(true);
      expect(can('admin', permission)).toBe(true);
    }
  });

  it('are separated by what is not a permission at all', () => {
    // Deleting the workspace and removing the owner cannot be granted, so they
    // are an owner check rather than a matrix entry.
    expect(isOwnerOnly('owner')).toBe(true);
    expect(isOwnerOnly('admin')).toBe(false);
  });
});

describe('asWorkspaceRole', () => {
  it('accepts every real role', () => {
    for (const role of WORKSPACE_ROLES) expect(asWorkspaceRole(role)).toBe(role);
  });

  it('throws rather than defaulting to something permissive', () => {
    // Falling back to a role here would turn corrupt data into access.
    expect(() => asWorkspaceRole('superadmin')).toThrow(/Unrecognised/);
    expect(() => asWorkspaceRole('')).toThrow();
  });
});

describe('the matrix cannot drift silently', () => {
  const snapshot: Record<WorkspaceRole, Permission[]> = {
    owner: [...PERMISSIONS],
    admin: [...PERMISSIONS],
    designer: ['project.view', 'project.create', 'project.edit', 'design.edit', 'production.view'],
    sales: [
      'project.view', 'project.create', 'project.edit', 'cost.view',
      'quote.view', 'quote.create', 'production.view',
    ],
    production: [
      'project.view', 'project.edit', 'material.manage',
      'production.view', 'production.generate', 'quote.view',
    ],
    worker: ['project.view', 'production.view'],
  };

  it.each(WORKSPACE_ROLES)('%s grants exactly what was intended', (role) => {
    // A widened role should be a deliberate edit here, not a diff nobody reads.
    expect([...permissionsFor(role)].sort()).toEqual([...snapshot[role]].sort());
  });
});
