/**
 * Integration tests for the domain framework.
 *
 * The profiles and their invariants are covered by unit tests. These cover the
 * thing that matters end to end: that a project's trade actually changes what
 * it must answer, what it may draw, and what it is warned about — and that the
 * calculation engines below are untouched by it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, getSpec, updateDraftSpec } from '@/lib/spec/service';
import { applyCommands } from '@/lib/canvas/service';
import {
  createMaterial,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { computeProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { getIntegrityReport } from '@/lib/validation/service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const suffix = `dom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ownerWs: WorkspaceId;

/** Everything both trades require, and nothing either does not. */
const SHARED_SPEC: ProjectSpecPatch = {
  projectType: 'placard',
  dimensions: { width: 2.4, height: 2.2, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'MDF 18mm' }],
  mounting: { method: 'wall-fixed' },
  site: { environment: 'indoor' },
};

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { clerkId: `do-${suffix}`, email: `do-${suffix}@example.test` },
  });
  ownerId = owner.id;
  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  await updateCostSettings(ownerWs, {
    laborType: 'percent', laborBp: 3000, laborCents: 0,
    transportType: 'fixed', transportBp: 0, transportCents: 50_000,
    installType: 'percent', installBp: 1000, installCents: 0,
    marginBp: 4000, taxBp: 2000, currency: 'MAD',
  });
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { userId: ownerId } });
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: ownerId } } });
  await prisma.project.deleteMany({ where: { userId: ownerId } });
  await prisma.material.deleteMany({ where: { userId: ownerId } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: ownerId } } } });
  await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe('a project carries its trade', () => {
  it('defaults to signage, so nothing created before T17 changes', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Unspecified' });
    expect(project.domain).toBe('signage');
  });

  it('records the trade it was created with', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Wardrobe', domain: 'joinery' });
    expect(project.domain).toBe('joinery');
  });
});

describe('the trade decides what must be answered', () => {
  it('blocks a signage project until lighting is decided', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Sign', domain: 'signage' });
    await updateDraftSpec(project.id, ownerId, SHARED_SPEC);

    const spec = await getSpec(project.id, ownerId);
    expect(spec.missing).toEqual(['lighting.type']);
    await expect(approveSpec(project.id, ownerId)).rejects.toThrow(/lighting/i);
  });

  it('approves the same specification for joinery, which does not ask about lighting', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Wardrobe', domain: 'joinery' });
    await updateDraftSpec(project.id, ownerId, SHARED_SPEC);

    const spec = await getSpec(project.id, ownerId);
    expect(spec.missing).toEqual([]);
    expect(spec.complete).toBe(true);

    const approved = await approveSpec(project.id, ownerId);
    expect(approved.status).toBe('approved');
  });

  it('still requires what every engine downstream needs', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Vague', domain: 'joinery' });
    await updateDraftSpec(project.id, ownerId, { projectType: 'placard' });

    const spec = await getSpec(project.id, ownerId);
    expect(spec.missing).toContain('dimensions.width');
    expect(spec.missing).toContain('materials');
    expect(spec.missing).toContain('quantity');
  });
});

describe('the trade decides what may be drawn', () => {
  it('refuses a canvas object the trade does not use', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Wardrobe', domain: 'joinery' });

    await expect(
      applyCommands(project.id, ownerId, [
        {
          kind: 'add_object',
          object: {
            type: 'lettering', x: 0, y: 0, widthMm: 500, heightMm: 200,
            rotationDeg: 0, showDimensions: true,
          },
        },
      ])
    ).rejects.toThrow(/not part of joinery/i);
  });

  it('accepts an object the trade does use', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Wardrobe', domain: 'joinery' });

    const view = await applyCommands(project.id, ownerId, [
      {
        kind: 'add_object',
        object: {
          type: 'panel', x: 0, y: 0, widthMm: 2400, heightMm: 2200,
          rotationDeg: 0, showDimensions: true,
        },
      },
    ]);
    expect(view.scene.objects).toHaveLength(1);
  });

  it('still allows a signage project its full palette', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Sign', domain: 'signage' });

    const view = await applyCommands(project.id, ownerId, [
      {
        kind: 'add_object',
        object: {
          type: 'lettering', x: 0, y: 0, widthMm: 500, heightMm: 200,
          rotationDeg: 0, showDimensions: true,
        },
      },
    ]);
    expect(view.scene.objects[0].type).toBe('lettering');
  });
});

describe('the trade decides what looks implausible', () => {
  it('reads the same measurement differently in each trade', async () => {
    // A 30 m run: an ordinary facade band, an unusually large wardrobe.
    const big = { ...SHARED_SPEC, dimensions: { width: 30, height: 2.2, unit: 'm' as const } };

    const sign = await createProject(ownerWs, ownerId, { title: 'Long sign', domain: 'signage' });
    await updateDraftSpec(sign.id, ownerId, { ...big, lighting: { type: 'led' } });

    const wardrobe = await createProject(ownerWs, ownerId, { title: 'Long run', domain: 'joinery' });
    await updateDraftSpec(wardrobe.id, ownerId, big);

    const signCodes = (await getIntegrityReport(sign.id, ownerId)).findings.map((f) => f.code);
    const joineryCodes = (await getIntegrityReport(wardrobe.id, ownerId)).findings.map((f) => f.code);

    expect(signCodes).not.toContain('dimensions.implausibly_large');
    expect(joineryCodes).toContain('dimensions.implausibly_large');
  });

  it('names the trade in the note about long thin work', async () => {
    const wardrobe = await createProject(ownerWs, ownerId, { title: 'Shelf run', domain: 'joinery' });
    await updateDraftSpec(wardrobe.id, ownerId, {
      ...SHARED_SPEC,
      dimensions: { width: 12, height: 0.3, unit: 'm' },
    });

    const report = await getIntegrityReport(wardrobe.id, ownerId);
    const note = report.findings.find((f) => f.code === 'dimensions.extreme_ratio');
    expect(note?.message).toMatch(/shelving runs/i);
    expect(note?.message).toMatch(/piece is about/i);
  });
});

describe('the engines below are trade-independent', () => {
  it('calculates, cuts and costs a joinery project unchanged', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Wardrobe', domain: 'joinery' });
    await updateDraftSpec(project.id, ownerId, SHARED_SPEC);
    await approveSpec(project.id, ownerId);

    const material = await createMaterial(ownerWs, ownerId, {
      name: `MDF-${Math.random()}`, category: 'Panel', customCategory: false,
      measurementModel: 'sheet', sheetWidthMm: 2440, sheetHeightMm: 1220,
      unitPriceCents: 30_000,
    });
    const rows = await selectProjectMaterial(project.id, ownerId, material.id, 'Carcass');
    await updateProjectMaterialRequirement(project.id, ownerId, rows[0].id, {
      requiredQuantity: 12, requiredDimensions: null,
    });
    await calculateProjectMaterials(project.id, ownerId);
    const cost = await computeProjectCost(project.id, ownerId);

    // 12 m² of 2.44 x 1.22 sheets = 2.9768 m² each -> 5 sheets, 150000 material.
    const line = await prisma.projectMaterial.findFirstOrThrow({ where: { projectId: project.id } });
    expect(line.unitsToPurchase).toBe(5);
    expect(cost.materialsCostCents).toBe(150_000);

    // The same arithmetic a signage project gets. Nothing in the profile can
    // reach it, which is the point of keeping calculation out of the profile.
    expect(cost.internalTotalCents).toBe(150_000 + 45_000 + 50_000 + 15_000);
  });
});
