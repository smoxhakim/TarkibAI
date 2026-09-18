/**
 * The financial-information boundary, proved at the server boundary.
 *
 * `cost.view` and `quote.view` are defined in this directory, so the test that
 * every service actually obeys them lives here too — rather than being split
 * across the modules it constrains, where "does the whole product respect this
 * permission" is a question nobody can answer from one file.
 *
 * Two rules, both driven by the matrix rather than by a hardcoded role list, so
 * changing `permissions.ts` changes what this test demands:
 *
 *   can(role, 'cost.view')   → internal money may be returned
 *   !can(role, 'cost.view')  → no monetary VALUE crosses the boundary
 *   can(role, 'quote.view')  → quotations may be read
 *   !can(role, 'quote.view') → reading one is refused
 *
 * The assertions are on the payload a caller actually receives, not on whether
 * a component rendered. A figure withheld in the browser has already crossed
 * the boundary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  listProjectMaterials,
  selectProjectMaterial,
  updateProjectMaterialRequirement,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { computeProjectCost, getProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { addPiece } from '@/lib/calc/cutting/service';
import { getRecommendations } from '@/lib/calc/efficiency/service';
import { getPurchasePlan } from '@/lib/commercial/service';
import { getIntegrityReport } from '@/lib/validation/service';
import { createQuote, getQuoteView, listQuotes } from '@/lib/quotes/service';
import { updateQuoteSettings } from '@/lib/quotes/settings-service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from './permissions';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `costvis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;
let projectId: string;
let quoteId: string;
/** A second project carrying a zero-priced material, for the integrity report. */
let zeroPriceProjectId: string;

/** The unit price of the project's material, in minor units. Must never leak. */
const UNIT_PRICE_CENTS = 45_000;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/** Roles split by the matrix itself, so the test follows the rules it checks. */
const withCost = WORKSPACE_ROLES.filter((role) => can(role, 'cost.view'));
const withoutCost = WORKSPACE_ROLES.filter((role) => !can(role, 'cost.view'));
const withQuotes = WORKSPACE_ROLES.filter((role) => can(role, 'quote.view'));
const withoutQuotes = WORKSPACE_ROLES.filter((role) => !can(role, 'quote.view'));

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
      name: `Cost visibility ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);
  const owner = userIds.owner;

  await updateCostSettings(workspaceId, {
    laborType: 'percent',
    laborBp: 3000,
    laborCents: 0,
    transportType: 'fixed',
    transportBp: 0,
    transportCents: 50_000,
    installType: 'percent',
    installBp: 1000,
    installCents: 0,
    marginBp: 2000,
    taxBp: 2000,
    currency: 'MAD',
  });
  await updateQuoteSettings(workspaceId, {
    companyName: `Cost visibility ${suffix}`,
    validityDays: 30,
    numberPrefix: 'DEV',
  });

  const project = await createProject(workspaceId, owner, { title: `Cost visibility ${suffix}` });
  projectId = project.id;
  await updateDraftSpec(projectId, owner, COMPLETE_SPEC);
  await approveSpec(projectId, owner);

  const panel = await createMaterial(workspaceId, owner, {
    name: 'Alucobond 3mm noir',
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: UNIT_PRICE_CENTS,
  });
  // A bigger, cheaper sheet, so the efficiency engine has something real to
  // recommend and the test is not asserting against an empty list.
  await createMaterial(workspaceId, owner, {
    name: 'Alucobond 3mm noir — grand format',
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 3050,
    sheetHeightMm: 1500,
    unitPriceCents: 52_000,
  });

  const selected = await selectProjectMaterial(projectId, owner, panel.id, 'Face');
  await updateProjectMaterialRequirement(projectId, owner, selected[0].id, {
    requiredQuantity: 24,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(projectId, owner);
  await computeProjectCost(projectId, owner);

  await addPiece(projectId, owner, {
    materialId: panel.id,
    label: 'Face',
    widthMm: 2000,
    heightMm: 1000,
    quantity: 6,
    allowRotation: true,
  });

  const quote = await createQuote(projectId, owner, { clientName: 'Restaurant Atlas' });
  quoteId = quote.id;

  // A separate project so the material assertions above keep their single line.
  // Its material is priced at zero and has no requirement, which produces one
  // FINANCIAL finding (material.zero_price) and one non-financial one
  // (material.no_requirement) from the same check — so a test can tell the
  // difference between withholding the money and silencing the whole report.
  const freebie = await createMaterial(workspaceId, owner, {
    name: 'Client-supplied panel',
    category: 'Panel',
    customCategory: false,
    measurementModel: 'sheet',
    sheetWidthMm: 2440,
    sheetHeightMm: 1220,
    unitPriceCents: 0,
  });
  const zeroPriceProject = await createProject(workspaceId, owner, {
    title: `Zero price ${suffix}`,
  });
  zeroPriceProjectId = zeroPriceProject.id;
  await updateDraftSpec(zeroPriceProjectId, owner, COMPLETE_SPEC);
  await approveSpec(zeroPriceProjectId, owner);
  await selectProjectMaterial(zeroPriceProjectId, owner, freebie.id, 'Face');
});

afterAll(async () => {
  const ids = Object.values(userIds);
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

/** Every number in a payload, however deeply nested. */
function numbersIn(value: unknown, found: number[] = []): number[] {
  if (typeof value === 'number') found.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => numbersIn(entry, found));
  else if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((entry) => numbersIn(entry, found));
  }
  return found;
}

describe('the permission matrix this test is driven by', () => {
  it('still splits the roles both ways, so the assertions below mean something', () => {
    expect(withCost.length).toBeGreaterThan(0);
    expect(withoutCost.length).toBeGreaterThan(0);
    expect(withQuotes.length).toBeGreaterThan(0);
    expect(withoutQuotes.length).toBeGreaterThan(0);
  });
});

describe('project material lines', () => {
  it.each(withoutCost)('withholds every price from %s', async (role) => {
    const lines = await listProjectMaterials(projectId, userIds[role]);
    expect(lines).toHaveLength(1);

    const [line] = lines;
    expect(line.unitPriceCents).toBeNull();
    expect(line.unitPriceCentsSnapshot).toBeNull();
    expect(line.totalCostCents).toBeNull();

    // Not just the named fields: the price must not appear as a value anywhere,
    // including in the calculation steps and the warnings.
    expect(numbersIn(line)).not.toContain(UNIT_PRICE_CENTS);
    expect(JSON.stringify(line)).not.toContain(String(UNIT_PRICE_CENTS));
  });

  it.each(withoutCost)('still gives %s the quantities and the working', async (role) => {
    const [line] = await listProjectMaterials(projectId, userIds[role]);

    // The whole point of degrading rather than refusing: a production manager
    // orders the sheets, a worker cuts them, and neither needs the price.
    expect(line.name).toBe('Alucobond 3mm noir');
    expect(line.unitsToPurchase).toBeGreaterThan(0);
    expect(line.requiredQuantity).not.toBeNull();
    expect(line.steps.length).toBeGreaterThan(0);
    expect(line.calculatedAt).not.toBeNull();
  });

  it.each(withCost)('gives %s the prices', async (role) => {
    const [line] = await listProjectMaterials(projectId, userIds[role]);
    expect(line.unitPriceCents).toBe(UNIT_PRICE_CENTS);
    expect(line.totalCostCents).toBeGreaterThan(0);
  });
});

describe('efficiency recommendations', () => {
  it.each(withoutCost)('withholds every saving from %s', async (role) => {
    const result = await getRecommendations(projectId, userIds[role]);
    expect(result.showsPrices).toBe(false);

    for (const recommendation of result.recommendations) {
      expect(recommendation.savingCents).toBeNull();
      expect(recommendation.current.totalCostCents).toBeNull();
      expect(recommendation.alternative.totalCostCents).toBeNull();
      // The engine's own summary quotes both totals as decimal money. It must
      // have been replaced, not forwarded.
      expect(recommendation.summary).not.toMatch(/\d+\.\d{2}/);
    }
  });

  it.each(withoutCost)('still gives %s the units and the waste', async (role) => {
    const result = await getRecommendations(projectId, userIds[role]);
    for (const recommendation of result.recommendations) {
      expect(recommendation.current.name.length).toBeGreaterThan(0);
      expect(recommendation.current.stockUnits).toBeGreaterThan(0);
      expect(typeof recommendation.wasteReductionPercent).toBe('number');
    }
  });

  it.each(withCost)('gives %s the saving', async (role) => {
    const result = await getRecommendations(projectId, userIds[role]);
    expect(result.showsPrices).toBe(true);
    for (const recommendation of result.recommendations) {
      expect(recommendation.savingCents).not.toBeNull();
      expect(recommendation.current.totalCostCents).not.toBeNull();
    }
  });
});

describe('the internal cost breakdown', () => {
  it.each(withoutCost)('is refused outright to %s', async (role) => {
    await expect(getProjectCost(projectId, userIds[role])).rejects.toMatchObject({ status: 403 });
  });

  it.each(withCost)('is returned to %s', async (role) => {
    const view = await getProjectCost(projectId, userIds[role]);
    expect(view.cost?.internalTotalCents).toBeGreaterThan(0);
  });
});

describe('the purchase plan', () => {
  it.each(withoutCost)('carries quantities but no price for %s', async (role) => {
    const plan = await getPurchasePlan(projectId, userIds[role]);
    expect(plan.showsPrices).toBe(false);
    expect(numbersIn(plan)).not.toContain(UNIT_PRICE_CENTS);
  });
});

describe('the integrity report', () => {
  const codes = async (role: WorkspaceRole) =>
    (await getIntegrityReport(zeroPriceProjectId, userIds[role])).findings.map((f) => f.code);

  it.each(withCost)('tells %s that a material is priced at zero', async (role) => {
    expect(await codes(role)).toContain('material.zero_price');
  });

  it.each(withoutCost)('withholds the zero-price diagnostic from %s', async (role) => {
    // "priced at zero" is a statement about a price. It sits under area
    // "materials" rather than "cost", which is exactly why the area-based
    // check in the T18 tests never caught it.
    expect(await codes(role)).not.toContain('material.zero_price');
  });

  it.each(withoutCost)('still gives %s the non-financial material warnings', async (role) => {
    // Withholding the money must not silence the report: the same material has
    // no requirement recorded, and that is theirs to see.
    expect(await codes(role)).toContain('material.no_requirement');
  });

  it.each(withoutCost)('leaves no trace of the price in %s\'s report', async (role) => {
    const report = await getIntegrityReport(zeroPriceProjectId, userIds[role]);
    const serialised = JSON.stringify(report);

    // Not just the code: the message and the action say it too.
    expect(serialised).not.toMatch(/priced at zero/i);
    expect(serialised).not.toMatch(/add nothing to the cost/i);
    expect(serialised).not.toMatch(/Set its price/i);
  });

  it('counts only the findings the reader was actually given', async () => {
    const worker = await getIntegrityReport(zeroPriceProjectId, userIds.worker);
    const owner = await getIntegrityReport(zeroPriceProjectId, userIds.owner);

    // A summary that counted a withheld finding would tell the worker there is
    // a warning they cannot see.
    expect(worker.summary.warning).toBe(worker.findings.filter((f) => f.severity === 'warning').length);
    expect(owner.summary.warning).toBeGreaterThan(worker.summary.warning);
  });

  it('never lets the zero-price warning gate a document', async () => {
    // Withholding a finding could only change what somebody may produce if that
    // finding were a blocker. This one is a warning by design — buying material
    // for nothing is unusual, not wrong — so removing it from a cost-blind
    // reader's report cannot make the project look readier than it is.
    const owner = await getIntegrityReport(zeroPriceProjectId, userIds.owner);
    expect(owner.findings.map((f) => f.code)).toContain('material.zero_price');

    const gating = [...owner.readiness.quote.blockers, ...owner.readiness.production.blockers];
    expect(gating.map((f) => f.code)).not.toContain('material.zero_price');
  });
});

describe('quotations', () => {
  it.each(withoutQuotes)('refuses to list them for %s', async (role) => {
    await expect(listQuotes(projectId, userIds[role])).rejects.toMatchObject({ status: 403 });
  });

  it.each(withoutQuotes)('refuses to open one for %s', async (role) => {
    await expect(getQuoteView(quoteId, userIds[role])).rejects.toMatchObject({ status: 403 });
  });

  it.each(withQuotes)('lists them for %s, with the totals a client would see', async (role) => {
    const quotes = await listQuotes(projectId, userIds[role]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].totalCents).toBeGreaterThan(0);
  });

  it('shows the internal comparison only to a role that may see costs', async () => {
    // The distinction this whole boundary rests on: a production manager reads
    // the quote's own figures, and does not get the calculated subtotal it is
    // being measured against.
    const production = await getQuoteView(quoteId, userIds.production);
    expect(production.quote.totalCents).toBeGreaterThan(0);
    expect(production.calculatedSubtotalCents).toBeNull();

    const sales = await getQuoteView(quoteId, userIds.sales);
    expect(sales.calculatedSubtotalCents).not.toBeNull();
  });
});
