/**
 * Who may create a project, add to the catalogue, and set the business's rules.
 *
 * These six operations were already gated — but only in their route handlers.
 * Nothing was exploitable over HTTP, and that is exactly why it was worth
 * closing: a permission that lives in one caller is a permission the next
 * caller can forget. Every finding Tasks 5–9 closed had that shape, and these
 * were the last writes in the codebase where the service would say yes to
 * anyone who called it directly.
 *
 * They are WORKSPACE-scoped, not project-scoped, so the gate is
 * `assertWorkspacePermission` rather than `assertProjectPermission`. There is
 * no project row to resolve: `createProject` is the call that makes one, and
 * the other five act on the workspace itself.
 *
 * | Operation | Permission |
 * | --- | --- |
 * | `createProject` | `project.create` |
 * | `createMaterial` | `material.manage` |
 * | `updateCostSettings` | `cost.manage` |
 * | `updateQuoteSettings`, `setQuoteLogo`, `removeQuoteLogo` | `quote.create` |
 *
 * Four different permissions, deliberately. These are not one boundary — the
 * matrix gives each to a different set, and that is the point: production adds
 * material and may not price it, sales prices the work and may not touch the
 * catalogue, and only owner and admin set the costing rules the whole business
 * quotes against.
 *
 * Role sets come from `can(role, …)`, so a matrix change changes what this file
 * demands rather than silently passing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { createMaterial } from '@/lib/materials/service';
import { updateCostSettings } from '@/lib/calc/costs/service';
import {
  removeQuoteLogo,
  setQuoteLogo,
  updateQuoteSettings,
} from '@/lib/quotes/settings-service';
import { asWorkspaceId, type WorkspaceId } from './access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from './permissions';

const suffix = `wsperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;

/** Belongs to no workspace of ours at all, for the 404 assertions. */
let outsiderId: string;

const allowed = (permission: Parameters<typeof can>[1]) =>
  WORKSPACE_ROLES.filter((role) => can(role, permission));
const refused = (permission: Parameters<typeof can>[1]) =>
  WORKSPACE_ROLES.filter((role) => !can(role, permission));

const canCreateProject = allowed('project.create');
const cannotCreateProject = refused('project.create');
const canManageMaterial = allowed('material.manage');
const cannotManageMaterial = refused('material.manage');
const canManageCost = allowed('cost.manage');
const cannotManageCost = refused('cost.manage');
const canWriteQuotes = allowed('quote.create');
const cannotWriteQuotes = refused('quote.create');

const COST_SETTINGS = {
  laborType: 'percent' as const,
  laborBp: 3000,
  laborCents: 0,
  transportType: 'fixed' as const,
  transportBp: 0,
  transportCents: 50_000,
  installType: 'percent' as const,
  installBp: 1000,
  installCents: 0,
  marginBp: 4000,
  taxBp: 2000,
  currency: 'MAD',
};

const QUOTE_SETTINGS = {
  companyName: 'Atelier Nour',
  companyAddress: null,
  companyPhone: null,
  companyEmail: null,
  taxIdentifiers: null,
  primaryColorHex: null,
  footerText: null,
  termsText: null,
  paymentDetails: null,
  validityDays: 30,
  numberPrefix: 'Q',
};

const material = (name: string) => ({
  name,
  category: 'Metal',
  customCategory: false,
  measurementModel: 'linear' as const,
  standardLengthMm: 6000,
  unitPriceCents: 133_337,
});

/** A one-pixel PNG, so the logo path is exercised without a real image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

beforeAll(async () => {
  const users = await Promise.all(
    WORKSPACE_ROLES.map((role) =>
      prisma.user.create({
        data: { clerkId: `${role}-${suffix}`, email: `${role}-${suffix}@example.test` },
      })
    )
  );
  WORKSPACE_ROLES.forEach((role, index) => {
    userIds[role] = users[index].id;
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `Workspace perms ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  const outsider = await prisma.user.create({
    data: { clerkId: `out-${suffix}`, email: `out-${suffix}@example.test` },
  });
  outsiderId = outsider.id;
});

afterAll(async () => {
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.material.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Four permissions, not one                                                   */
/* -------------------------------------------------------------------------- */

describe('the four boundaries these operations sit on', () => {
  it('are genuinely different sets, which is why one gate would not do', () => {
    // Production adds material and may not price it.
    expect(can('production', 'material.manage')).toBe(true);
    expect(can('production', 'cost.manage')).toBe(false);
    // Sales prices the work and may not touch the catalogue.
    expect(can('sales', 'quote.create')).toBe(true);
    expect(can('sales', 'material.manage')).toBe(false);
    // A designer starts jobs and does neither.
    expect(can('designer', 'project.create')).toBe(true);
    expect(can('designer', 'quote.create')).toBe(false);
  });

  it('leave the worker outside every one of them', () => {
    expect(can('worker', 'project.create')).toBe(false);
    expect(can('worker', 'material.manage')).toBe(false);
    expect(can('worker', 'cost.manage')).toBe(false);
    expect(can('worker', 'quote.create')).toBe(false);
  });

  it('keep the costing rules narrower than cost visibility', () => {
    // Sales see internal cost; they do not set the margin the business prices
    // against. Guarding the rules with `cost.view` would erase that line.
    expect(can('sales', 'cost.view')).toBe(true);
    expect(can('sales', 'cost.manage')).toBe(false);
  });

  it('leave at least one role on each side of each boundary', () => {
    for (const set of [
      [canCreateProject, cannotCreateProject],
      [canManageMaterial, cannotManageMaterial],
      [canManageCost, cannotManageCost],
      [canWriteQuotes, cannotWriteQuotes],
    ]) {
      expect(set[0].length).toBeGreaterThan(0);
      expect(set[1].length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Creating a project                                                          */
/* -------------------------------------------------------------------------- */

describe('creating a project', () => {
  it.each(canCreateProject)('is allowed for %s', async (role) => {
    const project = await createProject(workspaceId, userIds[role], {
      title: `Created by ${role} ${Math.random()}`,
    });
    expect(project.workspaceId).toBe(workspaceId);
  });

  it.each(cannotCreateProject)('is refused for %s, and creates nothing', async (role) => {
    const before = await prisma.project.count({ where: { workspaceId } });

    await expect(
      createProject(workspaceId, userIds[role], { title: `Refused ${role}` })
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.project.count({ where: { workspaceId } })).toBe(before);
  });

  it('reports a workspace the caller does not belong to as missing', async () => {
    await expect(
      createProject(workspaceId, outsiderId, { title: 'Outsider' })
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* The shared catalogue                                                        */
/* -------------------------------------------------------------------------- */

describe('adding a material to the library', () => {
  it.each(canManageMaterial)('is allowed for %s', async (role) => {
    const row = await createMaterial(workspaceId, userIds[role], material(`tube-${Math.random()}`));
    expect(row.workspaceId).toBe(workspaceId);
  });

  it.each(cannotManageMaterial)('is refused for %s, and adds nothing', async (role) => {
    const before = await prisma.material.count({ where: { workspaceId } });

    await expect(
      createMaterial(workspaceId, userIds[role], material(`refused-${role}-${Math.random()}`))
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.material.count({ where: { workspaceId } })).toBe(before);
  });

  it('reports a workspace the caller does not belong to as missing', async () => {
    await expect(
      createMaterial(workspaceId, outsiderId, material(`outsider-${Math.random()}`))
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* The costing rules                                                           */
/* -------------------------------------------------------------------------- */

describe('setting the costing rules', () => {
  it.each(canManageCost)('is allowed for %s', async (role) => {
    const settings = await updateCostSettings(workspaceId, userIds[role], COST_SETTINGS);
    expect(settings.workspaceId).toBe(workspaceId);
  });

  it.each(cannotManageCost)('is refused for %s, and the margin is unchanged', async (role) => {
    // Set a known margin as an authorised caller first, so a silent write by
    // the refused one would be visible.
    await updateCostSettings(workspaceId, userIds.owner, { ...COST_SETTINGS, marginBp: 4000 });

    await expect(
      updateCostSettings(workspaceId, userIds[role], { ...COST_SETTINGS, marginBp: 100 })
    ).rejects.toMatchObject({ status: 403 });

    const row = await prisma.costSettings.findUniqueOrThrow({ where: { workspaceId } });
    expect(row.marginBp).toBe(4000);
  });

  it('is refused to sales, who may SEE cost and not set the rules', async () => {
    // The distinction the matrix draws, asserted against the real service
    // rather than only against `can(...)`.
    await expect(
      updateCostSettings(workspaceId, userIds.sales, COST_SETTINGS)
    ).rejects.toMatchObject({ status: 403 });
  });

  it('reports a workspace the caller does not belong to as missing', async () => {
    await expect(
      updateCostSettings(workspaceId, outsiderId, COST_SETTINGS)
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* The quotation identity                                                      */
/* -------------------------------------------------------------------------- */

describe('setting the company identity on quotes', () => {
  it.each(canWriteQuotes)('is allowed for %s', async (role) => {
    const settings = await updateQuoteSettings(workspaceId, userIds[role], QUOTE_SETTINGS);
    expect(settings.companyName).toBe('Atelier Nour');
  });

  it.each(cannotWriteQuotes)('is refused for %s, and the name is unchanged', async (role) => {
    await updateQuoteSettings(workspaceId, userIds.owner, QUOTE_SETTINGS);

    await expect(
      updateQuoteSettings(workspaceId, userIds[role], {
        ...QUOTE_SETTINGS,
        companyName: `Renamed by ${role}`,
      })
    ).rejects.toMatchObject({ status: 403 });

    const row = await prisma.quoteSettings.findUniqueOrThrow({ where: { workspaceId } });
    expect(row.companyName).toBe('Atelier Nour');
  });

  it('is refused to production, who may READ a quote and not change one', async () => {
    expect(can('production', 'quote.view')).toBe(true);
    await expect(
      updateQuoteSettings(workspaceId, userIds.production, QUOTE_SETTINGS)
    ).rejects.toMatchObject({ status: 403 });
  });

  it('reports a workspace the caller does not belong to as missing', async () => {
    await expect(
      updateQuoteSettings(workspaceId, outsiderId, QUOTE_SETTINGS)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('the logo printed on a quote', () => {
  it.each(cannotWriteQuotes)('cannot be set by %s, before any byte is stored', async (role) => {
    // The permission is asserted ahead of the image validation and well ahead
    // of the upload, so a refused caller never reaches storage.
    await expect(
      setQuoteLogo(workspaceId, userIds[role], PNG, 'image/png')
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(cannotWriteQuotes)('cannot be removed by %s', async (role) => {
    await expect(removeQuoteLogo(workspaceId, userIds[role])).rejects.toMatchObject({
      status: 403,
    });
  });

  it('refuses a caller outside the workspace with 404, not 403', async () => {
    await expect(
      setQuoteLogo(workspaceId, outsiderId, PNG, 'image/png')
    ).rejects.toMatchObject({ status: 404 });
    await expect(removeQuoteLogo(workspaceId, outsiderId)).rejects.toMatchObject({ status: 404 });
  });

  it('is refused for a bad image only AFTER the permission passes', async () => {
    // An authorised caller reaches the format check; that is what makes the
    // 403s above assertions about authorization rather than about the bytes.
    await expect(
      setQuoteLogo(workspaceId, userIds.owner, PNG, 'image/gif')
    ).rejects.toMatchObject({ status: 400 });
  });
});
