/**
 * Integration tests for the validation and safety layer.
 *
 * The checks are pure and covered by unit tests. These cover what only real
 * project state can show: that the report sees what the engines actually
 * recorded, that the gates refuse a document built on superseded figures, and
 * that consequential actions leave a trail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject, deleteProject, updateProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  selectProjectMaterial,
  setMaterialArchived,
  updateMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { computeProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { addPiece, calculatePlan } from '@/lib/calc/cutting/service';
import { createQuote, issueQuote } from '@/lib/quotes/service';
import { updateQuoteSettings } from '@/lib/quotes/settings-service';
import { generateProductionDocument } from '@/lib/production/service';
import { listProjectAudit } from '@/lib/audit/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { getIntegrityReport } from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const suffix = `val-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ownerWs: WorkspaceId;
let otherId: string;
let otherWs: WorkspaceId;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `ao-${suffix}`, email: `ao-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `ax-${suffix}`, email: `ax-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  otherWs = asWorkspaceId((await ensurePersonalWorkspace(otherId)).id);

  await updateCostSettings(ownerWs, ownerId, {
    laborType: 'percent', laborBp: 3000, laborCents: 0,
    transportType: 'fixed', transportBp: 0, transportCents: 50_000,
    installType: 'percent', installBp: 1000, installCents: 0,
    marginBp: 4000, taxBp: 2000, currency: 'MAD',
  });
  await updateQuoteSettings(ownerWs, ownerId, {
    companyName: 'Atelier Nour', companyAddress: null, companyPhone: null,
    companyEmail: null, taxIdentifiers: null, primaryColorHex: null,
    footerText: null, termsText: null, paymentDetails: null,
    validityDays: 30, numberPrefix: 'Q',
  });
});

afterAll(async () => {
  const users = { in: [ownerId, otherId] };
  await prisma.auditEvent.deleteMany({ where: { userId: users } });
  await prisma.document.deleteMany({ where: { project: { userId: users } } });
  await prisma.quote.deleteMany({ where: { userId: users } });
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: users } } });
  await prisma.project.deleteMany({ where: { userId: users } });
  await prisma.material.deleteMany({ where: { userId: users } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: users } } } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

/** A project that is ready to quote: approved spec, calculated line, costed. */
async function readyProject(userId = ownerId) {
  const project = await createProject(ownerWs, userId, { title: `Shopfront ${Math.random()}` });
  await updateDraftSpec(project.id, userId, COMPLETE_SPEC);
  await approveSpec(project.id, userId);

  const material = await createMaterial(ownerWs, userId, {
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

const codes = (findings: { code: string }[]) => findings.map((finding) => finding.code);

/* -------------------------------------------------------------------------- */

describe('the integrity report', () => {
  it('reports a ready project as ready for both documents', async () => {
    const { project } = await readyProject();
    const report = await getIntegrityReport(project.id, ownerId);

    expect(report.summary.blocker).toBe(0);
    expect(report.readiness.quote.ready).toBe(true);
    expect(report.readiness.production.ready).toBe(true);
  });

  it('sees a calculation superseded by a specification change', async () => {
    const { project } = await readyProject();
    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12, height: 3, unit: 'm' } });
    await approveSpec(project.id, ownerId);

    const report = await getIntegrityReport(project.id, ownerId);
    expect(codes(report.findings)).toContain('calculation.stale');
    expect(report.readiness.quote.ready).toBe(false);
  });

  it('sees a material archived out from under the project', async () => {
    const { project, material } = await readyProject();
    await setMaterialArchived(material.id, ownerId, true);

    const report = await getIntegrityReport(project.id, ownerId);
    expect(codes(report.findings)).toContain('material.archived');
    // A warning, not a blocker. Archiving changes no price and no stock size,
    // so the calculated figures still stand — staleness compares the inputs a
    // calculation actually used, not the material's updatedAt.
    expect(codes(report.findings)).not.toContain('calculation.stale');
    expect(report.readiness.quote.ready).toBe(true);
  });

  it('does not call a line stale for an edit that changes no figure', async () => {
    const { project, material } = await readyProject();
    await updateMaterial(material.id, ownerId, {
      name: 'Renamed tube', category: 'Metal', customCategory: false,
      measurementModel: 'linear', standardLengthMm: 6000, unitPriceCents: 20_000,
      supplier: 'A different supplier',
    });

    const report = await getIntegrityReport(project.id, ownerId);
    expect(codes(report.findings)).not.toContain('calculation.stale');
  });

  it('does call a line stale when the price changes', async () => {
    const { project, material } = await readyProject();
    await updateMaterial(material.id, ownerId, {
      name: 'tube', category: 'Metal', customCategory: false,
      measurementModel: 'linear', standardLengthMm: 6000, unitPriceCents: 25_000,
    });

    const report = await getIntegrityReport(project.id, ownerId);
    expect(codes(report.findings)).toContain('calculation.stale');
    expect(report.readiness.quote.ready).toBe(false);
  });

  it('blocks when a material loses the stock size its figures depended on', async () => {
    const { project, material } = await readyProject();
    await updateMaterial(material.id, ownerId, {
      name: 'tube', category: 'Metal', customCategory: false,
      measurementModel: 'linear', standardLengthMm: null, unitPriceCents: 20_000,
    });

    const report = await getIntegrityReport(project.id, ownerId);
    expect(codes(report.findings)).toContain('material.missing_stock_size');
    expect(report.readiness.quote.ready).toBe(false);
  });

  it('warns about a dimension that looks like a slipped decimal', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Huge' });
    await updateDraftSpec(project.id, ownerId, {
      ...COMPLETE_SPEC,
      dimensions: { width: 800, height: 3, unit: 'm' },
    });

    const report = await getIntegrityReport(project.id, ownerId);
    const finding = report.findings.find((f) => f.code === 'dimensions.implausibly_large');
    expect(finding?.severity).toBe('warning');
    // Never a blocker: the tool does not decide what someone may build.
    expect(report.readiness.production.blockers.map((b) => b.code)).not.toContain(
      'dimensions.implausibly_large'
    );
  });

  it('reports a line with no stated quantity once, not twice', async () => {
    const { project } = await readyProject();
    const second = await createMaterial(ownerWs, ownerId, {
      name: `panel-${Math.random()}`, category: 'Panel', customCategory: false,
      measurementModel: 'sheet', sheetWidthMm: 2440, sheetHeightMm: 1220, unitPriceCents: 40_000,
    });
    await selectProjectMaterial(project.id, ownerId, second.id, null);

    const report = await getIntegrityReport(project.id, ownerId);
    const forSecond = report.findings.filter((f) => f.subject?.includes('panel'));
    // "no requirement" and "never calculated" are the same fact told twice.
    expect(codes(forSecond)).toEqual(['material.no_requirement']);
  });

  it('blocks when pieces could not be placed in a cutting plan', async () => {
    const { project } = await readyProject();
    const panel = await createMaterial(ownerWs, ownerId, {
      name: `sheet-${Math.random()}`, category: 'Panel', customCategory: false,
      measurementModel: 'sheet', sheetWidthMm: 2440, sheetHeightMm: 1220, unitPriceCents: 40_000,
    });
    await addPiece(project.id, ownerId, {
      materialId: panel.id, label: 'Oversized', widthMm: 5000, heightMm: 3000,
      quantity: 1, allowRotation: true,
    });
    await calculatePlan(project.id, ownerId, { materialId: panel.id });

    const report = await getIntegrityReport(project.id, ownerId);
    expect(codes(report.findings)).toContain('cutting.unplaced');
    expect(report.readiness.production.ready).toBe(false);
  });

  it('puts blockers before warnings', async () => {
    const { project, material } = await readyProject();
    await setMaterialArchived(material.id, ownerId, true);
    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12, height: 3, unit: 'm' } });
    await approveSpec(project.id, ownerId);

    const report = await getIntegrityReport(project.id, ownerId);
    const severities = report.findings.map((f) => f.severity);
    expect(severities.indexOf('blocker')).toBeLessThan(severities.lastIndexOf('warning'));
  });

  it("hides another user's project", async () => {
    const { project } = await readyProject();
    await expect(getIntegrityReport(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('safeguards', () => {
  it.runIf(isStorageConfigured())('refuses to issue a quote priced from superseded figures', async () => {
    const { project } = await readyProject();
    const quote = await createQuote(project.id, ownerId, { clientName: 'Cafe Milano' });

    // The specification moves after the quote was drafted.
    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12, height: 3, unit: 'm' } });
    await approveSpec(project.id, ownerId);

    await expect(issueQuote(quote.id, ownerId)).rejects.toThrow(/no longer current/i);

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe('draft');
    expect(after.pdfObjectKey).toBeNull();
  });

  it.runIf(isStorageConfigured())('issues once the figures are current again', async () => {
    const { project } = await readyProject();
    await updateDraftSpec(project.id, ownerId, { dimensions: { width: 12, height: 3, unit: 'm' } });
    await approveSpec(project.id, ownerId);
    await calculateProjectMaterials(project.id, ownerId);
    await computeProjectCost(project.id, ownerId);

    const quote = await createQuote(project.id, ownerId, { clientName: 'Cafe Milano' });
    const issued = await issueQuote(quote.id, ownerId);
    expect(issued.status).toBe('issued');
  });

  it.runIf(isStorageConfigured())('refuses a package carrying pieces that are not being cut', async () => {
    const { project } = await readyProject();
    const panel = await createMaterial(ownerWs, ownerId, {
      name: `sheet-${Math.random()}`, category: 'Panel', customCategory: false,
      measurementModel: 'sheet', sheetWidthMm: 2440, sheetHeightMm: 1220, unitPriceCents: 40_000,
    });
    await addPiece(project.id, ownerId, {
      materialId: panel.id, label: 'Oversized', widthMm: 5000, heightMm: 3000,
      quantity: 1, allowRotation: true,
    });
    await calculatePlan(project.id, ownerId, { materialId: panel.id });

    await expect(generateProductionDocument(project.id, ownerId)).rejects.toThrow(
      /no longer correct/i
    );
    expect(await prisma.document.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.runIf(isStorageConfigured())('still allows a package with data merely absent', async () => {
    // T14's promise: a package may be built from a material list alone, with the
    // gaps printed on it. Absent is a gap, not a blocker.
    const { project } = await readyProject();
    const document = await generateProductionDocument(project.id, ownerId);
    expect(document.version).toBe(1);
  });
});

describe('the audit trail', () => {
  it('records approving a specification', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Audited' });
    await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
    await approveSpec(project.id, ownerId);

    const events = await listProjectAudit(project.id, ownerId);
    expect(events.map((event) => event.action)).toContain('spec.approved');
    expect(events[0].summary).toMatch(/Approved specification v1/);
  });

  it.runIf(isStorageConfigured())('records issuing a quote with its amount', async () => {
    const { project } = await readyProject();
    const quote = await createQuote(project.id, ownerId, { clientName: 'Cafe Milano' });
    await issueQuote(quote.id, ownerId);

    const events = await listProjectAudit(project.id, ownerId);
    const issued = events.find((event) => event.action === 'quote.issued');
    expect(issued?.summary).toMatch(/Cafe Milano/);
    expect((issued?.detail as Record<string, unknown>).totalCents).toBe(319_200);
  });

  it('records archiving and restoring a project', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Toggled' });
    await updateProject(project.id, ownerId, { archived: true });
    await updateProject(project.id, ownerId, { archived: false });

    const actions = (await listProjectAudit(project.id, ownerId)).map((event) => event.action);
    expect(actions).toEqual(['project.restored', 'project.archived']);
  });

  it('survives the project it describes being deleted', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Doomed' });
    await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
    await approveSpec(project.id, ownerId);
    await deleteProject(project.id, ownerId);

    // The project row is gone, so the events are detached rather than removed:
    // the record that a project existed and was deleted is the one that matters
    // most.
    const events = await prisma.auditEvent.findMany({
      where: { userId: ownerId, action: 'project.deleted' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(events[0].summary).toMatch(/Doomed/);
    expect(events[0].projectId).toBeNull();

    const orphaned = await prisma.auditEvent.findMany({
      where: { userId: ownerId, action: 'spec.approved', projectId: null },
    });
    expect(orphaned.length).toBeGreaterThan(0);
  });

  it("hides another user's trail", async () => {
    const { project } = await readyProject();
    await expect(listProjectAudit(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });
});
