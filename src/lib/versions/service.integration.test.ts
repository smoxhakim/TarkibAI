/**
 * Integration tests for version history.
 *
 * The diff is pure and covered by unit tests. These cover what only real
 * project state can show: what gets snapshotted, which moments record a
 * version, the link from a document back to the state it came from, and that
 * restoring is append-only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, getSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { computeProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { applyCommands, getScene, seedScene } from '@/lib/canvas/service';
import { createQuote, issueQuote } from '@/lib/quotes/service';
import { updateQuoteSettings } from '@/lib/quotes/settings-service';
import { generateProductionDocument } from '@/lib/production/service';
import { isStorageConfigured } from '@/lib/storage/config';
import {
  captureSnapshot,
  compareVersions,
  getVersion,
  listVersions,
  previewRestore,
  recordVersion,
  restoreVersion,
} from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `ver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  components: [{ name: 'Aluminium tray', quantity: 1 }],
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `vo-${suffix}`, email: `vo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `vx-${suffix}`, email: `vx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;

  await updateCostSettings(ownerId, {
    laborType: 'percent', laborBp: 3000, laborCents: 0,
    transportType: 'fixed', transportBp: 0, transportCents: 50_000,
    installType: 'percent', installBp: 1000, installCents: 0,
    marginBp: 4000, taxBp: 2000, currency: 'MAD',
  });
  await updateQuoteSettings(ownerId, {
    companyName: 'Atelier Nour', companyAddress: null, companyPhone: null,
    companyEmail: null, taxIdentifiers: null, primaryColorHex: null,
    footerText: null, termsText: null, paymentDetails: null,
    validityDays: 30, numberPrefix: 'Q',
  });
});

afterAll(async () => {
  const users = { in: [ownerId, otherId] };
  await prisma.document.deleteMany({ where: { project: { userId: users } } });
  await prisma.quote.deleteMany({ where: { userId: users } });
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: users } } });
  await prisma.project.deleteMany({ where: { userId: users } });
  await prisma.material.deleteMany({ where: { userId: users } });
  await prisma.costSettings.deleteMany({ where: { userId: users } });
  await prisma.quoteSettings.deleteMany({ where: { userId: users } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

/** A project with an approved spec, a seeded canvas and one calculated line. */
async function fullProject(userId = ownerId) {
  const project = await createProject(userId, { title: `Shopfront ${Math.random()}` });
  await updateDraftSpec(project.id, userId, COMPLETE_SPEC);
  await approveSpec(project.id, userId);
  await seedScene(project.id, userId);

  const material = await createMaterial(userId, {
    name: `tube-${Math.random()}`,
    category: 'Metal', customCategory: false,
    measurementModel: 'linear', standardLengthMm: 6000, unitPriceCents: 20_000,
  });
  const rows = await selectProjectMaterial(project.id, userId, material.id, 'Frame');
  await updateProjectMaterialRequirement(project.id, userId, rows[0].id, {
    requiredQuantity: 25, requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, userId);
  await computeProjectCost(project.id, userId);

  return { project, material };
}

/* -------------------------------------------------------------------------- */

describe('what a snapshot captures', () => {
  it('copies the specification, canvas, materials and cost as they stand', async () => {
    const { project } = await fullProject();
    const snapshot = await captureSnapshot(project.id);

    expect(snapshot.spec.projectType).toBe('enseigne');
    expect(snapshot.specApproved).toBe(true);
    expect(snapshot.canvas).not.toBeNull();
    expect(snapshot.canvas!.length).toBeGreaterThan(0);
    expect(snapshot.materials).toHaveLength(1);
    expect(snapshot.materials[0].unitsToPurchase).toBe(5);
    expect(snapshot.cost).not.toBeNull();
    expect(snapshot.cost!.clientSubtotalCents).toBe(266_000);
  });

  it('distinguishes a project with no canvas from one with an empty canvas', async () => {
    // An absent scene and an emptied scene are different facts. Conflating them
    // would make the diff report every object as removed.
    const project = await createProject(ownerId, { title: 'No canvas' });
    expect((await captureSnapshot(project.id)).canvas).toBeNull();

    const { project: seeded } = await fullProject();
    const scene = await getScene(seeded.id, ownerId);
    await applyCommands(
      seeded.id,
      ownerId,
      scene.scene.objects.map((object) => ({ kind: 'remove_object' as const, id: object.id }))
    );
    expect(await captureSnapshot(seeded.id).then((s) => s.canvas)).toEqual([]);
  });

  it('keeps decimal quantities as strings so no digit is rounded away', async () => {
    const { project } = await fullProject();
    const snapshot = await captureSnapshot(project.id);
    expect(typeof snapshot.materials[0].requiredQuantity).toBe('string');
  });
});

describe('moments that record a version', () => {
  it('records one when a specification is approved', async () => {
    const project = await createProject(ownerId, { title: 'Approving' });
    await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
    await approveSpec(project.id, ownerId);

    const versions = await listVersions(project.id, ownerId);
    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe('spec_approved');
    // The snapshot must reflect the approval, not the state just before it.
    expect(versions[0].snapshot.references?.specApproved).toBe(true);
  });

  it.runIf(isStorageConfigured())('records one when a quote is issued, and links them', async () => {
    const { project } = await fullProject();
    const quote = await createQuote(project.id, ownerId, { clientName: 'Cafe Milano' });
    const issued = await issueQuote(quote.id, ownerId);

    expect(issued.projectVersionId).not.toBeNull();

    const version = await getVersion(issued.projectVersionId!, ownerId);
    expect(version.reason).toBe('quote_issued');
    expect(version.producedQuoteNumbers).toEqual([issued.number]);
  });

  it.runIf(isStorageConfigured())('records one when a package is generated, and links them', async () => {
    const { project } = await fullProject();
    const document = await generateProductionDocument(project.id, ownerId);

    expect(document.projectVersionId).not.toBeNull();

    const version = await getVersion(document.projectVersionId!, ownerId);
    expect(version.reason).toBe('production_generated');
    expect(version.producedPackageVersions).toEqual([document.version]);
  });

  it('records one when the user asks for it', async () => {
    const { project } = await fullProject();
    await recordVersion(project.id, {
      reason: 'manual',
      label: 'Before the client meeting',
      note: 'Agreed to review the lighting.',
    });

    const versions = await listVersions(project.id, ownerId);
    expect(versions[0].label).toBe('Before the client meeting');
    expect(versions[0].note).toBe('Agreed to review the lighting.');
    expect(versions[0].reasonLabel).toBe('Saved by you');
  });

  it('numbers versions sequentially per project', async () => {
    const { project } = await fullProject();
    await recordVersion(project.id, { reason: 'manual', label: 'Two' });
    await recordVersion(project.id, { reason: 'manual', label: 'Three' });

    const versions = await listVersions(project.id, ownerId);
    expect(versions.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
  });
});

describe('comparison', () => {
  it('reports what changed between two versions', async () => {
    const { project } = await fullProject();
    const [first] = await listVersions(project.id, ownerId);

    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 10, height: 3, unit: 'm' } });
    const second = await recordVersion(project.id, { reason: 'manual', label: 'Wider' });

    const comparison = await compareVersions(project.id, ownerId, {
      fromId: first.id,
      toId: second.id,
    });

    expect(comparison.diff.identical).toBe(false);
    expect(comparison.diff.spec).toContainEqual({
      path: 'dimensions.width', label: 'Dimensions › Width', from: '8', to: '10', kind: 'changed',
    });
  });

  it('compares a version against the project as it stands now', async () => {
    const { project } = await fullProject();
    const [version] = await listVersions(project.id, ownerId);

    await updateDraftSpec(project.id, ownerId, { finishNotes: 'Brushed' });

    const comparison = await compareVersions(project.id, ownerId, { fromId: version.id });
    expect(comparison.toIsCurrent).toBe(true);
    expect(comparison.to).toBeNull();
    expect(comparison.diff.spec).toContainEqual({
      path: 'finishNotes', label: 'Finish Notes', from: null, to: 'Brushed', kind: 'added',
    });
  });

  it('reports no difference when nothing has moved', async () => {
    const { project } = await fullProject();
    // Taken now, not at approval: the approval snapshot predates the canvas,
    // the material lines and the cost, so it legitimately differs from today.
    const version = await recordVersion(project.id, { reason: 'manual', label: 'As it stands' });

    expect((await compareVersions(project.id, ownerId, { fromId: version.id })).diff.identical).toBe(true);
  });

  it('shows the work done since a specification was approved', async () => {
    const { project } = await fullProject();
    const approval = (await listVersions(project.id, ownerId)).find(
      (version) => version.reason === 'spec_approved'
    )!;

    const diff = (await compareVersions(project.id, ownerId, { fromId: approval.id })).diff;

    // The approval snapshot has no canvas, no materials and no cost, so those
    // sections report that they cannot be compared rather than claiming the
    // work was deleted.
    expect(diff.canvas.unavailableReason).toMatch(/cannot be compared/i);
    expect(diff.materials.entries.map((entry) => entry.kind)).toEqual(['added']);
    expect(diff.costUnavailableReason).toMatch(/cannot be compared/i);
  });

  it('refuses to compare a version with itself', async () => {
    const { project } = await fullProject();
    const [version] = await listVersions(project.id, ownerId);

    await expect(
      compareVersions(project.id, ownerId, { fromId: version.id, toId: version.id })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a version belonging to another project', async () => {
    const { project: mine } = await fullProject();
    const { project: theirs } = await fullProject();
    const [version] = await listVersions(theirs.id, ownerId);

    await expect(
      compareVersions(mine.id, ownerId, { fromId: version.id })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('restoring', () => {
  it('says what it would do before doing it', async () => {
    const { project } = await fullProject();
    const [version] = await listVersions(project.id, ownerId);
    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12, height: 3, unit: 'm' } });

    const preview = await previewRestore(version.id, ownerId);

    expect(preview.blockers).toEqual([]);
    expect(preview.diff.spec).toContainEqual({
      path: 'dimensions.width', label: 'Dimensions › Width', from: '12', to: '8', kind: 'changed',
    });
    expect(preview.consequences.join(' ')).toMatch(/new DRAFT/i);
    expect(preview.consequences.join(' ')).toMatch(/not restored/i);
    expect(preview.consequences.join(' ')).toMatch(/Nothing is deleted/i);
  });

  it('writes a new draft rather than overwriting the approved specification', async () => {
    const { project } = await fullProject();
    const [approved] = await listVersions(project.id, ownerId);
    const before = await getSpec(project.id, ownerId);

    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12, height: 3, unit: 'm' } });
    await restoreVersion(approved.id, ownerId);

    const after = await getSpec(project.id, ownerId);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.status).toBe('draft');
    expect(after.spec.dimensions?.width).toBe(8);

    // The approved record is still there, untouched.
    const approvedRows = await prisma.projectSpec.findMany({
      where: { projectId: project.id, status: 'approved' },
    });
    expect(approvedRows).toHaveLength(1);
  });

  it('records the restore as a new version and deletes nothing', async () => {
    const { project } = await fullProject();
    const before = await listVersions(project.id, ownerId);

    const recorded = await restoreVersion(before[0].id, ownerId);
    const after = await listVersions(project.id, ownerId);

    expect(after).toHaveLength(before.length + 1);
    expect(after[0].id).toBe(recorded.id);
    expect(after[0].reason).toBe('restored');
    // Every earlier version survives: documents already issued point at them.
    for (const version of before) {
      expect(after.some((entry) => entry.id === version.id)).toBe(true);
    }
  });

  it.runIf(isStorageConfigured())('leaves an issued quote pointing at the state it was built from', async () => {
    const { project } = await fullProject();
    const quote = await createQuote(project.id, ownerId, { clientName: 'Cafe Milano' });
    const issued = await issueQuote(quote.id, ownerId);
    const [issuedVersion] = await listVersions(project.id, ownerId);

    await restoreVersion(issuedVersion.id, ownerId);

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: issued.id } });
    expect(after.projectVersionId).toBe(issued.projectVersionId);
    expect(after.status).toBe('issued');
    expect(after.subtotalCents).toBe(issued.subtotalCents);
  });

  it('does not restore calculations, so nothing shows figures that no longer follow', async () => {
    const { project } = await fullProject();
    const [version] = await listVersions(project.id, ownerId);
    const before = await prisma.projectMaterial.findFirstOrThrow({ where: { projectId: project.id } });

    await restoreVersion(version.id, ownerId);

    const after = await prisma.projectMaterial.findFirstOrThrow({ where: { projectId: project.id } });
    expect(after.calculatedAt?.getTime()).toBe(before.calculatedAt?.getTime());
    // The restored draft is a newer spec version, so the line is now stale and
    // the material panel reports it rather than presenting it as current.
    const spec = await getSpec(project.id, ownerId);
    expect(after.specVersionAtCalculation).toBeLessThan(spec.version);
  });

  it('returns the project to intake, since the specification is unapproved again', async () => {
    const { project } = await fullProject();
    const [version] = await listVersions(project.id, ownerId);

    await restoreVersion(version.id, ownerId);

    const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.status).toBe('intake');
  });
});

describe('ownership', () => {
  it('hides another user\'s versions rather than admitting they exist', async () => {
    const { project } = await fullProject();
    const [version] = await listVersions(project.id, ownerId);

    await expect(listVersions(project.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(getVersion(version.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(previewRestore(version.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(restoreVersion(version.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(
      compareVersions(project.id, otherId, { fromId: version.id })
    ).rejects.toMatchObject({ status: 404 });
  });
});
