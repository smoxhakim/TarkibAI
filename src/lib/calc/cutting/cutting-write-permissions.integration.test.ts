/**
 * Who may change what a project cuts.
 *
 * Six operations wrote `CuttingPiece`, `LinearCut` and `CuttingPlan` after
 * checking project MEMBERSHIP only, so a worker could add and delete pieces
 * and cut lengths and compute both kinds of plan. The worker role is defined
 * as "Read the project and its production package. Nothing else."
 *
 * It was not only a write a worker should not have. `cutting.unplaced` is a
 * PRODUCTION BLOCKER, so an oversized piece plus one press of Calculate
 * refused the production package for the whole workspace.
 *
 * All six take `project.edit`:
 *
 *  - not `material.manage`, which governs the shared catalogue and which
 *    designer and sales do not hold;
 *  - not `design.edit`, which governs the canvas and which production — the
 *    role that actually cuts — does not hold;
 *  - not `production.generate`, which governs building the package rather
 *    than editing the data it draws on, and which designer does not hold;
 *  - not `cost.view`, which is a visibility permission, and which there is
 *    nothing here to govern: a layout is sheets, areas and waste.
 *
 * Role sets come from `can(role, …)`, so a matrix change changes what this
 * file demands rather than silently passing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { createMaterial } from '@/lib/materials/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import {
  addLinearCut,
  addPiece,
  calculateLinearCutPlan,
  calculatePlan,
  listLinearCuts,
  listLinearPlans,
  listPieces,
  listPlans,
  removeLinearCut,
  removePiece,
} from './service';

const suffix = `cutperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;
let sheetId: string;
let barId: string;

/** A separate business, for the 404 assertions. */
let outsiderId: string;
let outsiderProjectId: string;
let foreignSheetId: string;
let foreignBarId: string;

const canEdit = WORKSPACE_ROLES.filter((role) => can(role, 'project.edit'));
const cannotEdit = WORKSPACE_ROLES.filter((role) => !can(role, 'project.edit'));
/** Holds project.edit and not cost.view — production, the role that cuts. */
const costBlindEditors = canEdit.filter((role) => !can(role, 'cost.view'));

/** An id shaped like the ones the schemas accept, belonging to nothing. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Deliberately not round. A price that happens to equal a millimetre figure
 * makes the "no money in the payload" assertion below unfalsifiable: 12000
 * cents is also two 6 m bars in mm.
 */
const SHEET_PRICE_CENTS = 855_551;
const BAR_PRICE_CENTS = 133_337;

const PIECE = { widthMm: 1000, heightMm: 600, quantity: 2, allowRotation: true };
const CUT = { lengthMm: 2000, quantity: 3 };

const newProject = (title = 'Cut perms') =>
  createProject(workspaceId, userIds.owner, { title: `${title} ${Math.random()}` });

/** A project with one sheet piece, ready for a sheet plan. */
async function projectWithPiece() {
  const project = await newProject();
  await addPiece(project.id, userIds.owner, { materialId: sheetId, label: 'Face', ...PIECE });
  const [piece] = await listPieces(project.id, userIds.owner);
  return { project, piece };
}

/** A project with one cut length, ready for a bar plan. */
async function projectWithCut() {
  const project = await newProject();
  await addLinearCut(project.id, userIds.owner, { materialId: barId, label: 'Upright', ...CUT });
  const [cut] = await listLinearCuts(project.id, userIds.owner);
  return { project, cut };
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
      name: `Cut perms ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  const [sheet, bar] = await Promise.all([
    createMaterial(workspaceId, userIds.owner, {
      name: `Alucobond ${suffix}`,
      category: 'Panel',
      customCategory: false,
      measurementModel: 'sheet',
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      unitPriceCents: SHEET_PRICE_CENTS,
      technicalProperties: { kerfMm: 4, edgeMarginMm: 10 },
    }),
    createMaterial(workspaceId, userIds.owner, {
      name: `Tube ${suffix}`,
      category: 'Metal',
      customCategory: false,
      measurementModel: 'linear',
      standardLengthMm: 6000,
      unitPriceCents: BAR_PRICE_CENTS,
      technicalProperties: { kerfMm: 3, minUsableRemnantMm: 500 },
    }),
  ]);
  sheetId = sheet.id;
  barId = bar.id;

  const outsider = await prisma.user.create({
    data: { clerkId: `out-${suffix}`, email: `out-${suffix}@example.test` },
  });
  outsiderId = outsider.id;
  const otherWorkspace = await prisma.workspace.create({
    data: { name: `Other ${suffix}`, members: { create: { userId: outsiderId, role: 'owner' } } },
  });
  const otherWs = asWorkspaceId(otherWorkspace.id);

  const [otherProject, foreignSheet, foreignBar] = await Promise.all([
    createProject(otherWs, outsiderId, { title: `Other ${suffix}` }),
    createMaterial(otherWs, outsiderId, {
      name: `foreign panel ${suffix}`,
      category: 'Panel',
      customCategory: false,
      measurementModel: 'sheet',
      sheetWidthMm: 3050,
      sheetHeightMm: 1500,
      unitPriceCents: 99_000,
    }),
    createMaterial(otherWs, outsiderId, {
      name: `foreign tube ${suffix}`,
      category: 'Metal',
      customCategory: false,
      measurementModel: 'linear',
      standardLengthMm: 6000,
      unitPriceCents: 99_000,
    }),
  ]);
  outsiderProjectId = otherProject.id;
  foreignSheetId = foreignSheet.id;
  foreignBarId = foreignBar.id;
});

afterAll(async () => {
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.cuttingPlan.deleteMany({ where: { project: { userId: { in: ids } } } });
  await prisma.cuttingPiece.deleteMany({ where: { project: { userId: { in: ids } } } });
  await prisma.linearCut.deleteMany({ where: { project: { userId: { in: ids } } } });
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.material.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* The permission these operations take                                        */
/* -------------------------------------------------------------------------- */

describe('the permission these operations take', () => {
  it('is project.edit, and the worker does not hold it', () => {
    expect(can('designer', 'project.edit')).toBe(true);
    expect(can('sales', 'project.edit')).toBe(true);
    expect(can('production', 'project.edit')).toBe(true);
    expect(can('worker', 'project.edit')).toBe(false);
  });

  it('is not material.manage: designer and sales would lose cutting', () => {
    expect(can('designer', 'material.manage')).toBe(false);
    expect(can('sales', 'material.manage')).toBe(false);
  });

  it('is not design.edit: production would lose cutting', () => {
    expect(can('production', 'design.edit')).toBe(false);
  });

  it('is not production.generate: designer would lose cutting', () => {
    expect(can('designer', 'production.generate')).toBe(false);
  });

  it('is not cost.view: production would lose cutting', () => {
    expect(can('production', 'cost.view')).toBe(false);
    // Otherwise the cost-blindness assertions below prove nothing.
    expect(costBlindEditors.length).toBeGreaterThan(0);
  });

  it('leaves at least one role on each side of the boundary', () => {
    expect(canEdit.length).toBeGreaterThan(0);
    expect(cannotEdit).toContain('worker');
  });
});

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

describe('adding a cutting piece', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const project = await newProject();
    const pieces = await addPiece(project.id, userIds[role], {
      materialId: sheetId,
      label: 'Face',
      ...PIECE,
    });
    expect(pieces).toHaveLength(1);
  });

  it.each(cannotEdit)('is refused for %s, and adds nothing', async (role) => {
    const project = await newProject();

    await expect(
      addPiece(project.id, userIds[role], { materialId: sheetId, label: 'Face', ...PIECE })
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.cuttingPiece.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('still refuses a material from another business', async () => {
    const project = await newProject();
    await expect(
      addPiece(project.id, userIds.owner, { materialId: foreignSheetId, ...PIECE })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reports another business’s project as missing, not forbidden', async () => {
    await expect(
      addPiece(outsiderProjectId, userIds.owner, { materialId: sheetId, ...PIECE })
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each(cannotEdit)('reports another business’s project as missing to %s too', async (role) => {
    await expect(
      addPiece(outsiderProjectId, userIds[role], { materialId: sheetId, ...PIECE })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('removing a cutting piece', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project, piece } = await projectWithPiece();
    await removePiece(project.id, userIds[role], piece.id);
    expect(await prisma.cuttingPiece.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each(cannotEdit)('is refused for %s, and the piece remains', async (role) => {
    const { project, piece } = await projectWithPiece();

    await expect(removePiece(project.id, userIds[role], piece.id)).rejects.toMatchObject({
      status: 403,
    });

    expect(await prisma.cuttingPiece.findUnique({ where: { id: piece.id } })).not.toBeNull();
  });

  it.each(cannotEdit)('tells %s nothing about whether a piece id exists', async (role) => {
    const { project, piece } = await projectWithPiece();

    // The gate runs before the row is loaded, so a real id and an absent one
    // are indistinguishable. Authorising afterwards would answer 403 for one
    // and 404 for the other, which is a read of the piece list.
    const real = await removePiece(project.id, userIds[role], piece.id).catch((e) => e);
    const absent = await removePiece(project.id, userIds[role], ABSENT_ID).catch((e) => e);

    expect(real.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(absent.message).toBe(real.message);
  });

  it('reports another business’s project as missing, not forbidden', async () => {
    await expect(
      removePiece(outsiderProjectId, userIds.owner, ABSENT_ID)
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* Sheet plans                                                                 */
/* -------------------------------------------------------------------------- */

describe('calculating a sheet cutting plan', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project } = await projectWithPiece();
    const view = await calculatePlan(project.id, userIds[role], { materialId: sheetId });
    expect(view.plan).not.toBeNull();
    expect(view.result?.sheetsUsed).toBeGreaterThan(0);
  });

  it.each(cannotEdit)('is refused for %s, and writes no plan', async (role) => {
    const { project } = await projectWithPiece();

    await expect(
      calculatePlan(project.id, userIds[role], { materialId: sheetId })
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.cuttingPlan.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each(cannotEdit)('cannot overwrite an existing plan as %s', async (role) => {
    const { project } = await projectWithPiece();
    const before = await calculatePlan(project.id, userIds.owner, { materialId: sheetId });

    await expect(
      calculatePlan(project.id, userIds[role], { materialId: sheetId })
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.cuttingPlan.findUnique({ where: { id: before.plan!.id } });
    expect(after?.stockUnitsUsed).toBe(before.plan!.stockUnitsUsed);
    expect(after?.unplacedCount).toBe(before.plan!.unplacedCount);
  });

  it('still refuses a material from another business', async () => {
    const { project } = await projectWithPiece();
    await expect(
      calculatePlan(project.id, userIds.owner, { materialId: foreignSheetId })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reports another business’s project as missing, not forbidden', async () => {
    await expect(
      calculatePlan(outsiderProjectId, userIds.owner, { materialId: sheetId })
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* Linear cuts                                                                 */
/* -------------------------------------------------------------------------- */

describe('adding a cut length', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const project = await newProject();
    const cuts = await addLinearCut(project.id, userIds[role], { materialId: barId, ...CUT });
    expect(cuts).toHaveLength(1);
  });

  it.each(cannotEdit)('is refused for %s, and adds nothing', async (role) => {
    const project = await newProject();

    await expect(
      addLinearCut(project.id, userIds[role], { materialId: barId, ...CUT })
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.linearCut.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('still refuses a material from another business', async () => {
    const project = await newProject();
    await expect(
      addLinearCut(project.id, userIds.owner, { materialId: foreignBarId, ...CUT })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reports another business’s project as missing, not forbidden', async () => {
    await expect(
      addLinearCut(outsiderProjectId, userIds.owner, { materialId: barId, ...CUT })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('removing a cut length', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project, cut } = await projectWithCut();
    await removeLinearCut(project.id, userIds[role], cut.id);
    expect(await prisma.linearCut.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each(cannotEdit)('is refused for %s, and the cut remains', async (role) => {
    const { project, cut } = await projectWithCut();

    await expect(removeLinearCut(project.id, userIds[role], cut.id)).rejects.toMatchObject({
      status: 403,
    });

    expect(await prisma.linearCut.findUnique({ where: { id: cut.id } })).not.toBeNull();
  });

  it.each(cannotEdit)('tells %s nothing about whether a cut id exists', async (role) => {
    const { project, cut } = await projectWithCut();

    const real = await removeLinearCut(project.id, userIds[role], cut.id).catch((e) => e);
    const absent = await removeLinearCut(project.id, userIds[role], ABSENT_ID).catch((e) => e);

    expect(real.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(absent.message).toBe(real.message);
  });

  it('reports another business’s project as missing, not forbidden', async () => {
    await expect(
      removeLinearCut(outsiderProjectId, userIds.owner, ABSENT_ID)
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* Bar plans                                                                   */
/* -------------------------------------------------------------------------- */

describe('calculating a bar cut plan', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project } = await projectWithCut();
    const view = await calculateLinearCutPlan(project.id, userIds[role], { materialId: barId });
    expect(view.plan).not.toBeNull();
    expect(view.result?.barsUsed).toBeGreaterThan(0);
  });

  it.each(cannotEdit)('is refused for %s, and writes no plan', async (role) => {
    const { project } = await projectWithCut();

    await expect(
      calculateLinearCutPlan(project.id, userIds[role], { materialId: barId })
    ).rejects.toMatchObject({ status: 403 });

    expect(await prisma.cuttingPlan.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each(cannotEdit)('cannot overwrite an existing bar plan as %s', async (role) => {
    const { project } = await projectWithCut();
    const before = await calculateLinearCutPlan(project.id, userIds.owner, { materialId: barId });

    await expect(
      calculateLinearCutPlan(project.id, userIds[role], { materialId: barId })
    ).rejects.toMatchObject({ status: 403 });

    const after = await prisma.cuttingPlan.findUnique({ where: { id: before.plan!.id } });
    expect(after?.stockUnitsUsed).toBe(before.plan!.stockUnitsUsed);
    expect(after?.unplacedCount).toBe(before.plan!.unplacedCount);
  });

  it('still refuses a material from another business', async () => {
    const { project } = await projectWithCut();
    await expect(
      calculateLinearCutPlan(project.id, userIds.owner, { materialId: foreignBarId })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reports another business’s project as missing, not forbidden', async () => {
    await expect(
      calculateLinearCutPlan(outsiderProjectId, userIds.owner, { materialId: barId })
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* Cost visibility is not a prerequisite                                       */
/* -------------------------------------------------------------------------- */

/** Every money-shaped key the cutting views could ever grow. */
const MONEY_KEY = /cents|price|cost|margin|currency/i;
/**
 * A key ending in `Mm` is a length, not money — the unit suffix says so.
 * Without this, `edgeMarginMm` reads as a profit margin; it is the gap a
 * guillotine leaves at the edge of a sheet.
 */
const LENGTH_KEY = /Mm$/;

const isMoneyKey = (key: string) => MONEY_KEY.test(key) && !LENGTH_KEY.test(key);

function moneyKeysIn(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((entry, i) => moneyKeysIn(entry, `${path}[${i}]`));
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(isMoneyKey(key) ? [`${path}.${key}`] : []),
    ...moneyKeysIn(entry, `${path}.${key}`),
  ]);
}

describe('cost.view is not required to compute a layout', () => {
  it.each(costBlindEditors)('%s computes a sheet plan and gets no money', async (role) => {
    const { project } = await projectWithPiece();
    const view = await calculatePlan(project.id, userIds[role], { materialId: sheetId });

    expect(view.plan).not.toBeNull();
    expect(view.result?.sheetsUsed).toBeGreaterThan(0);
    expect(view.svg).not.toBe('');
    // Not a field-name check on a type: the serialised payload must contain no
    // money at all, so a figure added later cannot slip through unnoticed.
    expect(moneyKeysIn({ plan: view.plan, result: view.result })).toEqual([]);
    // The SVG is excluded on purpose: it is a rendering full of scaled floats,
    // and the data is what a caller reads.
    expect(JSON.stringify({ plan: view.plan, result: view.result })).not.toContain(
      String(SHEET_PRICE_CENTS)
    );
  });

  it.each(costBlindEditors)('%s computes a bar plan and gets no money', async (role) => {
    const { project } = await projectWithCut();
    const view = await calculateLinearCutPlan(project.id, userIds[role], { materialId: barId });

    expect(view.plan).not.toBeNull();
    expect(view.result?.barsUsed).toBeGreaterThan(0);
    expect(moneyKeysIn({ plan: view.plan, result: view.result })).toEqual([]);
    expect(JSON.stringify({ plan: view.plan, result: view.result })).not.toContain(
      String(BAR_PRICE_CENTS)
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Reads stay open                                                             */
/* -------------------------------------------------------------------------- */

describe('reading the cut lists and plans', () => {
  it.each(cannotEdit)('is still allowed for %s', async (role) => {
    // The regression most easily introduced by this change. A worker must
    // still read what the workshop is cutting; that is their whole job.
    const { project } = await projectWithPiece();
    await addLinearCut(project.id, userIds.owner, { materialId: barId, ...CUT });
    await calculatePlan(project.id, userIds.owner, { materialId: sheetId });
    await calculateLinearCutPlan(project.id, userIds.owner, { materialId: barId });

    const reader = userIds[role];
    expect(await listPieces(project.id, reader)).toHaveLength(1);
    expect(await listLinearCuts(project.id, reader)).toHaveLength(1);
    expect(await listPlans(project.id, reader)).toHaveLength(1);
    expect(await listLinearPlans(project.id, reader)).toHaveLength(1);
  });
});
