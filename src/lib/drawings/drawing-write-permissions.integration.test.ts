/**
 * Who may issue a technical drawing.
 *
 * `issueDrawing` wrote a numbered `Diagram` and an R2 object after checking
 * project MEMBERSHIP only, so a worker could issue one. The worker role is
 * defined as "Read the project and its production package. Nothing else."
 *
 * It was a lifecycle lever as well as a write. A production package always
 * points at the HIGHEST-numbered drawing, so issuing one silently redirects
 * every package built afterwards; and a project with neither a drawing nor a
 * calculated material cannot be packaged at all, so issuing one clears that
 * blocker for the whole workspace.
 *
 * It takes `project.edit`:
 *
 *  - not `design.edit`, which governs the canvas — only READ here — and which
 *    production, the role whose description leads with drawings, does not hold;
 *  - not `production.generate`, which governs building the package rather than
 *    the artefact the package points at, and which designer does not hold;
 *  - not `material.manage`, which governs the shared catalogue and which
 *    designer and sales do not hold;
 *  - not `cost.view`, which is a visibility permission, and which there is
 *    nothing here to govern: a drawing is geometry, labels and material names.
 *
 * Reads stay open. A worker must be able to look at the drawing they are
 * building from, so `renderLiveDrawing` and `listIssuedDrawings` keep project
 * access and are asserted here so a future change cannot quietly close them.
 *
 * Role sets come from `can(role, …)`, so a matrix change changes what this file
 * demands rather than silently passing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { createMaterial } from '@/lib/materials/service';
import { updateDraftSpec, approveSpec } from '@/lib/spec/service';
import { applyCommands, seedScene } from '@/lib/canvas/service';
import { getProductionView } from '@/lib/production/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import { SIGNAGE } from '@/lib/domains/registry';
import type { ProjectAiAccess } from '@/lib/ai/access';
import { buildToolbox } from '@/lib/ai/tools';
import type { ProjectSpecPatch } from '@/lib/spec/schema';
import { issueDrawing, listIssuedDrawings, renderLiveDrawing } from './service';

const suffix = `dwperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;
/** Added by a COLLEAGUE, never by the member issuing the drawing. */
let sharedMaterialId: string;
let sharedMaterialName: string;

/** A separate business, for the 404 assertions and the foreign-material case. */
let outsiderId: string;
let outsiderProjectId: string;
let foreignMaterialId: string;
let foreignMaterialName: string;

const canEdit = WORKSPACE_ROLES.filter((role) => can(role, 'project.edit'));
const cannotEdit = WORKSPACE_ROLES.filter((role) => !can(role, 'project.edit'));
/** Holds project.edit and not cost.view — production, the role that builds. */
const costBlindEditors = canEdit.filter((role) => !can(role, 'cost.view'));

/**
 * Deliberately not round, and far from any millimetre in the fixtures. A price
 * that happens to equal a dimension makes the "no money on the sheet"
 * assertion below unfalsifiable.
 */
const MATERIAL_PRICE_CENTS = 744_193;

const SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

const newProject = (title = 'Drawing perms') =>
  createProject(workspaceId, userIds.owner, { title: `${title} ${Math.random()}` });

/** A project whose canvas has one panel, so a drawing can actually be made. */
async function projectWithCanvas() {
  const project = await newProject();
  await updateDraftSpec(project.id, userIds.owner, SPEC);
  await approveSpec(project.id, userIds.owner);
  const scene = await seedScene(project.id, userIds.owner);
  return { project, panelId: scene.scene.objects[0].id };
}

/** The same, with the panel pointing at a material so the sheet annotates it. */
async function projectWithMaterial(materialId: string) {
  const { project, panelId } = await projectWithCanvas();
  await applyCommands(project.id, userIds.owner, [
    { kind: 'update_object', id: panelId, changes: { materialId } },
  ]);
  return { project, panelId };
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
      name: `Drawing perms ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  sharedMaterialName = `Alucobond ${suffix}`;
  // Added by the production manager, NOT by the designer who issues below.
  // Under the old creator-scoped lookup this name never reached the sheet.
  const shared = await createMaterial(workspaceId, userIds.production, {
    name: sharedMaterialName,
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: MATERIAL_PRICE_CENTS,
  });
  sharedMaterialId = shared.id;

  const outsider = await prisma.user.create({
    data: { clerkId: `out-${suffix}`, email: `out-${suffix}@example.test` },
  });
  outsiderId = outsider.id;
  const otherWorkspace = await prisma.workspace.create({
    data: { name: `Other ${suffix}`, members: { create: { userId: outsiderId, role: 'owner' } } },
  });
  const otherWs = asWorkspaceId(otherWorkspace.id);

  foreignMaterialName = `Foreign dibond ${suffix}`;
  const [otherProject, foreignMaterial] = await Promise.all([
    createProject(otherWs, outsiderId, { title: `Other ${suffix}` }),
    createMaterial(otherWs, outsiderId, {
      name: foreignMaterialName,
      category: 'Panel',
      customCategory: false,
      measurementModel: 'sheet',
      sheetWidthMm: 3050,
      sheetHeightMm: 1500,
      unitPriceCents: 99_000,
    }),
  ]);
  outsiderProjectId = otherProject.id;
  foreignMaterialId = foreignMaterial.id;
});

afterAll(async () => {
  const ids = [...Object.values(userIds), outsiderId];
  await prisma.diagram.deleteMany({ where: { project: { userId: { in: ids } } } });
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.material.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* The permission this operation takes                                         */
/* -------------------------------------------------------------------------- */

describe('the permission issuing a drawing takes', () => {
  it('is project.edit, and the worker does not hold it', () => {
    expect(can('designer', 'project.edit')).toBe(true);
    expect(can('sales', 'project.edit')).toBe(true);
    expect(can('production', 'project.edit')).toBe(true);
    expect(can('worker', 'project.edit')).toBe(false);
  });

  it('is not design.edit: production would lose drawings', () => {
    // Their role description leads with "Drawings, cutting plans, …".
    expect(can('production', 'design.edit')).toBe(false);
  });

  it('is not production.generate: designer would lose drawings', () => {
    // Their role description says "Specifications, design and drawings".
    expect(can('designer', 'production.generate')).toBe(false);
  });

  it('is not material.manage: designer and sales would lose drawings', () => {
    expect(can('designer', 'material.manage')).toBe(false);
    expect(can('sales', 'material.manage')).toBe(false);
  });

  it('is not cost.view: production would lose drawings', () => {
    expect(can('production', 'cost.view')).toBe(false);
    // Otherwise the cost-blindness assertion below proves nothing.
    expect(costBlindEditors.length).toBeGreaterThan(0);
  });

  it('leaves at least one role on each side of the boundary', () => {
    expect(canEdit.length).toBeGreaterThan(0);
    expect(cannotEdit).toContain('worker');
  });
});

/* -------------------------------------------------------------------------- */
/* Issuing                                                                     */
/* -------------------------------------------------------------------------- */

describe('issuing a drawing', () => {
  it.each(canEdit)('is allowed for %s', async (role) => {
    const { project } = await projectWithCanvas();
    const drawing = await issueDrawing(project.id, userIds[role]);
    expect(drawing.version).toBe(1);
    expect(await prisma.diagram.count({ where: { projectId: project.id } })).toBe(1);
  });

  it.each(cannotEdit)('is refused for %s, and issues nothing', async (role) => {
    const { project } = await projectWithCanvas();

    await expect(issueDrawing(project.id, userIds[role])).rejects.toMatchObject({ status: 403 });

    expect(await prisma.diagram.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each(cannotEdit)(
    'refuses %s BEFORE the canvas is looked at, not after',
    async (role) => {
      // No spec, no scene: an authorised caller gets 400 "the canvas is empty".
      // A caller without the permission must not be able to tell the two apart,
      // which is only true if the capability is asserted before anything is read.
      const project = await newProject('No canvas');

      await expect(issueDrawing(project.id, userIds[role])).rejects.toMatchObject({ status: 403 });

      // And the authorised caller really does reach the domain guard, so the
      // assertion above is about ordering rather than about an empty project.
      await expect(issueDrawing(project.id, userIds.owner)).rejects.toMatchObject({ status: 400 });
    }
  );

  it('reports another business’s project as missing, not forbidden', async () => {
    await expect(issueDrawing(outsiderProjectId, userIds.owner)).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each(cannotEdit)('reports another business’s project as missing to %s too', async (role) => {
    // 404 before 403: a worker outside the business must not learn it exists.
    await expect(issueDrawing(outsiderProjectId, userIds[role])).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

describe('reading a drawing', () => {
  it.each(WORKSPACE_ROLES)('stays open to %s, including the roles that cannot issue', async (role) => {
    const { project } = await projectWithCanvas();
    await issueDrawing(project.id, userIds.owner);

    const live = await renderLiveDrawing(project.id, userIds[role]);
    expect(live.sceneEmpty).toBe(false);
    expect(live.svg).toContain('<svg');

    const issued = await listIssuedDrawings(project.id, userIds[role]);
    expect(issued).toHaveLength(1);
  });

  it('still refuses both reads across businesses', async () => {
    await expect(renderLiveDrawing(outsiderProjectId, userIds.worker)).rejects.toMatchObject({
      status: 404,
    });
    await expect(listIssuedDrawings(outsiderProjectId, userIds.worker)).rejects.toMatchObject({
      status: 404,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* What issuing does to the production package                                 */
/* -------------------------------------------------------------------------- */

describe('the production package this drawing feeds', () => {
  it('follows the newest issued drawing', async () => {
    const { project } = await projectWithCanvas();

    const before = await getProductionView(project.id, userIds.owner);
    expect(before.available.drawingVersion).toBeNull();
    expect(before.blockers.join(' ')).toContain('nothing to put in a package');

    await issueDrawing(project.id, userIds.designer);
    const afterFirst = await getProductionView(project.id, userIds.owner);
    expect(afterFirst.available.drawingVersion).toBe(1);
    // Issuing cleared the no-drawing blocker for the whole workspace.
    expect(afterFirst.blockers.join(' ')).not.toContain('nothing to put in a package');

    await issueDrawing(project.id, userIds.production);
    const afterSecond = await getProductionView(project.id, userIds.owner);
    // The package points at the HIGHEST version, so a second issue redirects it.
    expect(afterSecond.available.drawingVersion).toBe(2);
  });

  it.each(cannotEdit)('cannot be redirected by %s', async (role) => {
    const { project } = await projectWithCanvas();
    await issueDrawing(project.id, userIds.owner);
    expect((await getProductionView(project.id, userIds.owner)).available.drawingVersion).toBe(1);

    await expect(issueDrawing(project.id, userIds[role])).rejects.toMatchObject({ status: 403 });

    // The workshop still gets the drawing it was given.
    const after = await getProductionView(project.id, userIds.owner);
    expect(after.available.drawingVersion).toBe(1);
    expect(await prisma.diagram.count({ where: { projectId: project.id } })).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Material names come from the workspace, not from whoever added them         */
/* -------------------------------------------------------------------------- */

describe('material annotations', () => {
  it('carries a colleague’s material, not only the issuer’s own', async () => {
    // The material was added by production; the drawing is issued by the
    // designer. The old lookup read Material.userId and returned nothing here,
    // so the annotation silently vanished from an immutable sheet.
    const { project } = await projectWithMaterial(sharedMaterialId);
    const drawing = await issueDrawing(project.id, userIds.designer);

    expect(drawing.svg).toContain(sharedMaterialName);
  });

  it('shows it on the live sheet too, for a role that cannot issue', async () => {
    const { project } = await projectWithMaterial(sharedMaterialId);
    const live = await renderLiveDrawing(project.id, userIds.worker);
    expect(live.svg).toContain(sharedMaterialName);
  });

  it('does not resolve a material from another business', async () => {
    // A scene can name any uuid. Resolving it must stay inside the workspace:
    // the part is drawn, unannotated, rather than labelled with a name from a
    // business this project has nothing to do with.
    const { project } = await projectWithMaterial(foreignMaterialId);
    const drawing = await issueDrawing(project.id, userIds.owner);

    expect(drawing.svg).not.toContain(foreignMaterialName);
    expect(drawing.svg).toContain('<svg');
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing financial crosses this boundary                                     */
/* -------------------------------------------------------------------------- */

describe('the drawing payload', () => {
  it.each(costBlindEditors)('carries no money, and %s may still issue', async (role) => {
    const { project } = await projectWithMaterial(sharedMaterialId);
    const drawing = await issueDrawing(project.id, userIds[role]);

    const serialised = JSON.stringify(drawing);
    // The price is on the material this sheet annotates, so if any cost column
    // were being read into the render it would show up here.
    expect(serialised).not.toContain(String(MATERIAL_PRICE_CENTS));
    expect(drawing.svg).not.toContain(String(MATERIAL_PRICE_CENTS));
    // And no money-shaped field came along for the ride.
    expect(serialised).not.toMatch(/unitPriceCents|pricePerUnitCents|totalCents|marginBp/i);
  });
});

/* -------------------------------------------------------------------------- */
/* The AI surface                                                              */
/* -------------------------------------------------------------------------- */

describe('the AI boundary', () => {
  it('gives no role a tool that touches drawings at all', () => {
    for (const role of WORKSPACE_ROLES) {
      const access: ProjectAiAccess = {
        projectId: 'project-1',
        workspaceId: asWorkspaceId('workspace-1'),
        userId: 'user-1',
        role,
        domain: SIGNAGE,
      };
      for (const name of buildToolbox(access).map((tool) => tool.name)) {
        expect(name, `${role} must not have ${name}`).not.toMatch(/drawing|diagram/i);
      }
    }
  });
});
