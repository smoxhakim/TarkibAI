/**
 * Integration tests for the production package.
 *
 * The template and the spec readers are covered by unit tests. These cover what
 * only real project state can show: the gate, what the package carries from
 * each source, what it says when a source is missing, versioning, ownership,
 * and that no price reaches the workshop copy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { updateCostSettings, computeProjectCost } from '@/lib/calc/costs/service';
import { addLinearCut, calculateLinearCutPlan } from '@/lib/calc/cutting/service';
import { seedScene } from '@/lib/canvas/service';
import { issueDrawing } from '@/lib/drawings/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { extractPdfText } from '@/lib/pdf/text';
import {
  buildProductionDocument,
  generateProductionDocument,
  getProductionView,
  listProductionDocuments,
  productionDownloadUrl,
  renderProductionDocument,
} from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  components: [{ name: 'Aluminium tray', quantity: 1, notes: 'Welded corners' }],
  materials: [{ name: 'tube' }],
  lighting: { type: 'led', details: 'halo-lit' },
  mounting: { method: 'steel frame', surface: 'brick', heightFromGroundM: 3.5 },
  site: { environment: 'outdoor' },
  finishNotes: 'Brushed aluminium',
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `po-${suffix}`, email: `po-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `px-${suffix}`, email: `px-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;

  await updateCostSettings(ownerId, {
    laborType: 'percent', laborBp: 3000, laborCents: 0,
    transportType: 'fixed', transportBp: 0, transportCents: 50_000,
    installType: 'percent', installBp: 1000, installCents: 0,
    marginBp: 4000, taxBp: 2000, currency: 'MAD',
  });
});

afterAll(async () => {
  const users = { in: [ownerId, otherId] };
  await prisma.document.deleteMany({ where: { project: { userId: users } } });
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: users } } });
  await prisma.project.deleteMany({ where: { userId: users } });
  await prisma.material.deleteMany({ where: { userId: users } });
  await prisma.costSettings.deleteMany({ where: { userId: users } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

/** A project with an approved spec and one calculated linear material line. */
async function buildableProject(userId = ownerId) {
  const project = await createProject(userId, { title: `Shopfront ${Math.random()}` });
  await updateDraftSpec(project.id, userId, COMPLETE_SPEC);
  await approveSpec(project.id, userId);

  const material = await createMaterial(userId, {
    name: `tube-${Math.random()}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 20_000,
    supplier: 'Metaux Casa',
  });
  const rows = await selectProjectMaterial(project.id, userId, material.id, 'Frame');
  await updateProjectMaterialRequirement(project.id, userId, rows[0].id, {
    requiredQuantity: 25,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, userId);

  return { project, material };
}

const NEXT = { version: 1, notes: null };

/* -------------------------------------------------------------------------- */

describe('the gate', () => {
  it('refuses a package for a project with nothing in it', async () => {
    const project = await createProject(ownerId, { title: 'Empty' });

    const view = await getProductionView(project.id, ownerId);
    expect(view.blockers.join(' ')).toMatch(/nothing to put in a package/i);
    await expect(generateProductionDocument(project.id, ownerId)).rejects.toMatchObject({
      status: 400,
    });
    expect(await prisma.document.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('allows a package from a material list alone, and says what is absent', async () => {
    const { project } = await buildableProject();

    const view = await getProductionView(project.id, ownerId);
    expect(view.blockers).toEqual([]);
    // Gaps are reported, not treated as failures: a workshop can start from a
    // material list, provided the sheet says what it does not have.
    expect(view.gaps.join(' ')).toMatch(/No technical drawing/i);
    expect(view.gaps.join(' ')).toMatch(/No cutting plan/i);
    expect(view.available.calculatedMaterialCount).toBe(1);
  });
});

describe('what the package carries', () => {
  it('reports the specification, components and mounting that were recorded', async () => {
    const { project } = await buildableProject();
    const text = extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT));

    expect(text).toContain('PRODUCTION PACKAGE');
    expect(text).toContain('enseigne');
    expect(text).toContain('8 × 3 m');
    expect(text).toContain('led — halo-lit');
    expect(text).toContain('steel frame');
    expect(text).toContain('3.5 m from ground');
    expect(text).toContain('Aluminium tray');
  });

  it('carries the material line with its supplier, stock size and waste', async () => {
    const { project } = await buildableProject();
    const text = extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT));

    expect(text).toContain('Metaux Casa');
    expect(text).toContain('25 m'); // required
    expect(text).toContain('5 × 6 m'); // five 6 m bars
    expect(text).toContain('16.67'); // waste percent from the T4 engine
  });

  it('carries the calculation\'s own caveats through to the bench', async () => {
    const { project } = await buildableProject();
    const document = await buildProductionDocument(project.id, ownerId, NEXT);

    // T4 records a MINIMUM caveat on linear lines: dividing total length by bar
    // length under-counts when cuts do not pack neatly. A workshop ordering
    // from this sheet has to see that beside the figure.
    const warnings = document.materials.flatMap((material) => material.warnings);
    expect(warnings.join(' ')).toMatch(/minimum/i);

    const text = extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT));
    expect(text.toLowerCase()).toContain('minimum');
  });

  it('includes an issued drawing and names its version', async () => {
    const { project } = await buildableProject();
    await seedScene(project.id, ownerId);
    const drawing = await issueDrawing(project.id, ownerId);

    const document = await buildProductionDocument(project.id, ownerId, NEXT);
    expect(document.versions.drawingVersion).toBe(drawing.version);
    expect(document.drawing).not.toBeNull();
    expect(document.drawingUnavailableReason).toBeNull();

    const text = extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT));
    expect(text).toContain(`Drawing ${drawing.version}`);
  });

  it('includes a computed cutting plan with its kerf and waste', async () => {
    const { project, material } = await buildableProject();
    await addLinearCut(project.id, ownerId, {
      materialId: material.id,
      label: 'Upright',
      lengthMm: 2800,
      quantity: 4,
    });
    await calculateLinearCutPlan(project.id, ownerId, { materialId: material.id });

    const document = await buildProductionDocument(project.id, ownerId, NEXT);
    expect(document.cuttingPlans).toHaveLength(1);
    expect(document.cuttingPlans[0].kind).toBe('linear');
    expect(document.cuttingPlans[0].stockUnitsUsed).toBeGreaterThan(0);

    const text = extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT));
    expect(text).toContain('CUTTING PLAN');
    expect(text).toContain('Bars used:');
  });
});

describe('what the package says when something is missing', () => {
  it('says no drawing was issued rather than leaving the page blank', async () => {
    const { project } = await buildableProject();
    const document = await buildProductionDocument(project.id, ownerId, NEXT);

    expect(document.drawing).toBeNull();
    expect(document.drawingUnavailableReason).toMatch(/No technical drawing/i);
    expect(extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT))).toContain(
      'No technical drawing has been issued'
    );
  });

  it('tells the workshop not to infer cuts when no plan exists', async () => {
    const { project } = await buildableProject();
    const text = extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT));

    expect(text).toContain('do not infer them from the drawing');
  });

  it('refuses to invent a mounting method the spec does not record', async () => {
    // Approval requires a mounting method, so the only way to reach a project
    // without one is a draft that cleared it after approval. The template still
    // has to handle it, because packages may be built from drafts.
    const { project } = await buildableProject();
    await updateDraftSpec(project.id, ownerId, { mounting: null });

    const document = await buildProductionDocument(project.id, ownerId, NEXT);
    expect(document.mounting).toBeNull();

    const text = extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT));
    expect(text).toContain('No mounting method is recorded');
    expect(text).toContain('Do not assume one');
  });

  it('flags a package built from an unapproved specification', async () => {
    const { project } = await buildableProject();
    // A new draft supersedes the approved spec without replacing it.
    await updateDraftSpec(project.id, ownerId, { finishNotes: 'Changed after approval' });

    const view = await getProductionView(project.id, ownerId);
    expect(view.gaps.join(' ')).toMatch(/still a draft/i);

    const document = await buildProductionDocument(project.id, ownerId, NEXT);
    expect(document.versions.specApproved).toBe(false);
    expect(extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT))).toContain(
      'DRAFT, NOT APPROVED'
    );
  });
});

describe('pricing separation', () => {
  it('carries no cost onto the workshop copy even when the project is costed', async () => {
    const { project } = await buildableProject();
    const cost = await computeProjectCost(project.id, ownerId);

    const document = await buildProductionDocument(project.id, ownerId, NEXT);
    expect(JSON.stringify(document)).not.toContain('Cents');

    const text = extractPdfText(await renderProductionDocument(project.id, ownerId, NEXT));

    // Guard the premise: these have to be figures that would be recognisable if
    // they did leak.
    expect(cost.materialsCostCents).toBeGreaterThan(0);
    expect(cost.clientTotalCents).toBeGreaterThan(0);

    for (const amount of [cost.materialsCostCents, cost.internalTotalCents, cost.clientTotalCents]) {
      expect(text).not.toContain((amount / 100).toFixed(2));
    }
    expect(text).not.toContain('MAD');
  });
});

describe('versioning and ownership', () => {
  it.runIf(isStorageConfigured())('numbers packages sequentially per project', async () => {
    const { project } = await buildableProject();

    const first = await generateProductionDocument(project.id, ownerId, { notes: 'Batch one' });
    const second = await generateProductionDocument(project.id, ownerId);

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(first.notes).toBe('Batch one');
    expect(second.notes).toBeNull();
    expect(await listProductionDocuments(project.id, ownerId)).toHaveLength(2);
  });

  it.runIf(isStorageConfigured())('moves the project to the production stage', async () => {
    const { project } = await buildableProject();
    await generateProductionDocument(project.id, ownerId);

    const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.status).toBe('production_ready');
  });

  it.runIf(isStorageConfigured())('stores a downloadable package', async () => {
    const { project } = await buildableProject();
    const document = await generateProductionDocument(project.id, ownerId);

    expect(document.pdfObjectKey).toBeTruthy();
    const url = await productionDownloadUrl(document.id, ownerId);
    expect(url).toContain('X-Amz-Signature');
  });

  it.runIf(isStorageConfigured())('records what the package was built from', async () => {
    const { project } = await buildableProject();
    const document = await generateProductionDocument(project.id, ownerId);

    const snapshot = document.sourceSnapshot as Record<string, unknown>;
    expect(snapshot.specApproved).toBe(true);
    expect(snapshot.calculatedMaterialCount).toBe(1);
    expect(Array.isArray(snapshot.gaps)).toBe(true);
  });

  it('hides another user\'s project rather than admitting it exists', async () => {
    const { project } = await buildableProject();

    await expect(getProductionView(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(generateProductionDocument(project.id, otherId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      renderProductionDocument(project.id, otherId, NEXT)
    ).rejects.toMatchObject({ status: 404 });
  });

  it.runIf(isStorageConfigured())('hides another user\'s package', async () => {
    const { project } = await buildableProject();
    const document = await generateProductionDocument(project.id, ownerId);

    await expect(productionDownloadUrl(document.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});
