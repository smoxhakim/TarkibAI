/**
 * Who may change what a project is built from.
 *
 * These five operations write PROJECT-scoped material state — which materials
 * a job uses, how much of each, the calculated purchase counts, and which
 * stock a switch moves it to. None of them touches the shared `Material`
 * catalogue, so they take `project.edit` and not `material.manage`. Getting
 * that backwards would stop a designer or a salesperson specifying materials,
 * which is most of their job, while `material.manage` exists for the library
 * they never write here.
 *
 * All five checked project MEMBERSHIP only, so a worker could attach
 * materials, change the quantities every purchase count rests on, delete
 * lines, run the calculation and swap the stock underneath a cutting plan.
 *
 * The calculation carries a second, separate question. Running it is
 * `project.edit`; seeing the money it totals is `cost.view`. A production
 * manager has the first and not the second, and both halves of that have to
 * work — they calculate what to buy without learning what it costs.
 *
 * Role sets come from `can(role, …)`, so a matrix change changes what this
 * file demands rather than silently passing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { applyMaterialSwitch } from '@/lib/calc/efficiency/service';
import { addPiece } from '@/lib/calc/cutting/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import {
  createMaterial,
  listProjectMaterials,
  removeProjectMaterial,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `mwperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;
let outsiderId: string;
let foreignMaterialId: string;

const canEdit = WORKSPACE_ROLES.filter((role) => can(role, 'project.edit'));
const cannotEdit = WORKSPACE_ROLES.filter((role) => !can(role, 'project.edit'));
/** Holds project.edit and not cost.view — the combination the summary turns on. */
const costBlindEditors = canEdit.filter((role) => !can(role, 'cost.view'));
const costVisibleEditors = canEdit.filter((role) => can(role, 'cost.view'));

const UNIT_PRICE_CENTS = 12_000;
const REQUIRED_METRES = 25;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/** A material in the shared library, created by whichever member is named. */
async function libraryMaterial(creator: WorkspaceRole, overrides: Record<string, unknown> = {}) {
  return createMaterial(workspaceId, userIds[creator], {
    name: `tube-${Math.random()}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: UNIT_PRICE_CENTS,
    ...overrides,
  } as Parameters<typeof createMaterial>[2]);
}

/** An approved project with one material selected and a requirement stated. */
async function readyProject() {
  const owner = userIds.owner;
  const project = await createProject(workspaceId, owner, { title: `Mat perms ${Math.random()}` });
  await updateDraftSpec(project.id, owner, COMPLETE_SPEC);
  await approveSpec(project.id, owner);

  const material = await libraryMaterial('owner');
  const rows = await selectProjectMaterial(project.id, owner, material.id, 'Frame');
  await updateProjectMaterialRequirement(project.id, owner, rows[0].id, {
    requiredQuantity: REQUIRED_METRES,
    requiredDimensions: null,
  });
  return { project, material, lineId: rows[0].id };
}

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
      name: `Mat perms ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  // A separate business, for the material-access assertions.
  const outsider = await prisma.user.create({
    data: { clerkId: `out-${suffix}`, email: `out-${suffix}@example.test` },
  });
  outsiderId = outsider.id;
  const otherWorkspace = await prisma.workspace.create({
    data: { name: `Other ${suffix}`, members: { create: { userId: outsiderId, role: 'owner' } } },
  });
  const foreign = await createMaterial(asWorkspaceId(otherWorkspace.id), outsiderId, {
    name: `foreign-${Math.random()}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 99_000,
  });
  foreignMaterialId = foreign.id;
});

afterAll(async () => {
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.material.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('the permission these operations take', () => {
  it('is project.edit, not material.manage', () => {
    // The distinction this task rests on. If they were gated on the library
    // permission, designer and sales would lose the ability to specify
    // materials on a project.
    expect(can('designer', 'project.edit')).toBe(true);
    expect(can('designer', 'material.manage')).toBe(false);
    expect(can('sales', 'project.edit')).toBe(true);
    expect(can('sales', 'material.manage')).toBe(false);
    expect(can('production', 'project.edit')).toBe(true);
    expect(can('worker', 'project.edit')).toBe(false);
  });

  it('leaves a role holding project.edit without cost.view', () => {
    // Otherwise the redaction assertions below prove nothing.
    expect(costBlindEditors.length).toBeGreaterThan(0);
    expect(costVisibleEditors.length).toBeGreaterThan(0);
    expect(cannotEdit.length).toBeGreaterThan(0);
  });
});

describe('selecting a material for a project', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project } = await readyProject();
    const extra = await libraryMaterial('owner');
    const rows = await selectProjectMaterial(project.id, userIds[role], extra.id, 'Extra');
    expect(rows).toHaveLength(2);
  });

  it.each(cannotEdit)('is refused for %s, and selects nothing', async (role) => {
    const { project } = await readyProject();
    const extra = await libraryMaterial('owner');

    await expect(
      selectProjectMaterial(project.id, userIds[role], extra.id, 'Extra')
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.projectMaterial.count({ where: { projectId: project.id } })).toBe(1);
  });

  it('still refuses a material from another business', async () => {
    const { project } = await readyProject();
    await expect(
      selectProjectMaterial(project.id, userIds.owner, foreignMaterialId, null)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('stating how much is needed', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project, lineId } = await readyProject();
    const rows = await updateProjectMaterialRequirement(project.id, userIds[role], lineId, {
      requiredQuantity: 30,
      requiredDimensions: null,
    });
    expect(rows[0].requiredQuantity).toBe('30');
  });

  it.each(cannotEdit)('is refused for %s, leaving the requirement alone', async (role) => {
    const { project, lineId } = await readyProject();

    await expect(
      updateProjectMaterialRequirement(project.id, userIds[role], lineId, {
        requiredQuantity: 999,
        requiredDimensions: null,
      })
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.projectMaterial.findUniqueOrThrow({ where: { id: lineId } });
    expect(Number(after.requiredQuantity)).toBe(REQUIRED_METRES);
  });
});

describe('removing a material from a project', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project, lineId } = await readyProject();
    await removeProjectMaterial(project.id, userIds[role], lineId);
    expect(await prisma.projectMaterial.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each(cannotEdit)('is refused for %s, leaving the line in place', async (role) => {
    const { project, lineId } = await readyProject();

    await expect(
      removeProjectMaterial(project.id, userIds[role], lineId)
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.projectMaterial.count({ where: { id: lineId } })).toBe(1);
  });
});

describe('calculating the materials', () => {
  it.each(cannotEdit)('is refused for %s, and calculates nothing', async (role) => {
    const { project, lineId } = await readyProject();

    await expect(
      calculateProjectMaterials(project.id, userIds[role])
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.projectMaterial.findUniqueOrThrow({ where: { id: lineId } });
    expect(after.calculatedAt).toBeNull();
    expect(after.unitsToPurchase).toBeNull();
    expect(after.totalCostCents).toBeNull();
  });

  it.each(costVisibleEditors)('gives %s the total, because they may see cost', async (role) => {
    const { project } = await readyProject();
    const summary = await calculateProjectMaterials(project.id, userIds[role]);

    expect(summary.calculatedLines).toBe(1);
    // 25 m from 6 m bars is 5 bars at 12 000 each.
    expect(summary.totalMaterialCostCents).toBe(5 * UNIT_PRICE_CENTS);
  });

  describe('for a role that may calculate but not see cost', () => {
    it.each(costBlindEditors)('lets %s run it and updates the project', async (role) => {
      const { project, lineId } = await readyProject();
      const summary = await calculateProjectMaterials(project.id, userIds[role]);

      // `cost.view` is not a prerequisite: the work happens.
      expect(summary.calculatedLines).toBe(1);
      const after = await prisma.projectMaterial.findUniqueOrThrow({ where: { id: lineId } });
      expect(after.calculatedAt).not.toBeNull();
      expect(after.unitsToPurchase).toBe(5);
      // The stored figures are unaffected — withholding is about the response.
      expect(after.totalCostCents).toBe(5 * UNIT_PRICE_CENTS);
    });

    it.each(costBlindEditors)('withholds the money from %s in the response', async (role) => {
      const { project } = await readyProject();
      const summary = await calculateProjectMaterials(project.id, userIds[role]);

      expect(summary.totalMaterialCostCents).toBeNull();

      // The assertion that matters: no price VALUE anywhere in the payload the
      // caller receives, summary or lines, at any depth.
      const payload = JSON.stringify({
        summary,
        materials: await listProjectMaterials(project.id, userIds[role]),
      });
      expect(payload).not.toContain(String(5 * UNIT_PRICE_CENTS));
      expect(payload).not.toContain(String(UNIT_PRICE_CENTS));
    });
  });
});

describe('switching a project to another material', () => {
  /** Sheet stock, because cutting pieces only exist for sheet materials. */
  const sheet = (creator: WorkspaceRole) =>
    libraryMaterial(creator, {
      measurementModel: 'sheet',
      standardLengthMm: null,
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
    });

  /** A project with a cutting piece, so the switch has something to move. */
  async function switchableProject() {
    const owner = userIds.owner;
    const project = await createProject(workspaceId, owner, { title: `Switch ${Math.random()}` });
    await updateDraftSpec(project.id, owner, COMPLETE_SPEC);
    await approveSpec(project.id, owner);

    const material = await sheet('owner');
    await selectProjectMaterial(project.id, owner, material.id, 'Face');
    await addPiece(project.id, owner, {
      materialId: material.id,
      label: 'Face',
      widthMm: 1000,
      heightMm: 500,
      quantity: 2,
      allowRotation: true,
    });
    return { project, material };
  }

  it.each(cannotEdit)('is refused for %s, leaving every row alone', async (role) => {
    const { project, material } = await switchableProject();
    const target = await sheet('owner');

    await expect(
      applyMaterialSwitch(project.id, userIds[role], material.id, target.id)
    ).rejects.toMatchObject({ status: 403 });

    const pieces = await prisma.cuttingPiece.findMany({ where: { projectId: project.id } });
    expect(pieces.every((piece) => piece.materialId === material.id)).toBe(true);
    const lines = await prisma.projectMaterial.findMany({ where: { projectId: project.id } });
    expect(lines.every((line) => line.materialId === material.id)).toBe(true);
  });

  it('is allowed for a project.edit holder', async () => {
    const { project, material } = await switchableProject();
    const target = await sheet('owner');

    await applyMaterialSwitch(project.id, userIds.designer, material.id, target.id);

    const pieces = await prisma.cuttingPiece.findMany({ where: { projectId: project.id } });
    expect(pieces.every((piece) => piece.materialId === target.id)).toBe(true);
  });

  it('works when the destination material was added by another member', async () => {
    // The check used to compare Material.userId — the CREATOR — which predates
    // workspaces and refused a switch to a colleague's library entry.
    const { project, material } = await switchableProject();
    const colleaguesMaterial = await sheet('production');

    await applyMaterialSwitch(project.id, userIds.owner, material.id, colleaguesMaterial.id);

    const lines = await prisma.projectMaterial.findMany({ where: { projectId: project.id } });
    expect(lines.every((line) => line.materialId === colleaguesMaterial.id)).toBe(true);
  });

  it('still refuses a material from another business', async () => {
    const { project, material } = await switchableProject();
    await expect(
      applyMaterialSwitch(project.id, userIds.owner, material.id, foreignMaterialId)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('reads stay open to every member', () => {
  it.each(WORKSPACE_ROLES)('lets %s list the project materials', async (role) => {
    const { project } = await readyProject();
    const rows = await listProjectMaterials(project.id, userIds[role]);

    expect(rows).toHaveLength(1);
    expect(rows[0].requiredQuantity).toBe(String(REQUIRED_METRES));

    // Money still follows cost.view, not project.edit.
    if (can(role, 'cost.view')) expect(rows[0].unitPriceCents).toBe(UNIT_PRICE_CENTS);
    else expect(rows[0].unitPriceCents).toBeNull();
  });
});
