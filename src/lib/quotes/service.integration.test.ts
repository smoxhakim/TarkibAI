/**
 * Integration tests for the client quote system.
 *
 * The arithmetic and the template are covered by unit tests. These cover what
 * only the database can show: the cost gate, numbering, ownership, the freeze
 * on issue — and, above all, that an internal figure cannot reach the document
 * a client receives.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import { createMaterial, selectProjectMaterial, updateProjectMaterialRequirement } from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import { computeProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { GROUP_SEPARATOR, formatMoney } from './format';
import { extractPdfText } from '@/lib/pdf/text';
import { getQuoteSettings, updateQuoteSettings } from './settings-service';
import {
  buildQuoteDocument,
  createQuote,
  deleteQuote,
  getQuoteView,
  issueQuote,
  listQuotes,
  quoteDownloadUrl,
  renderQuote,
  updateQuote,
} from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const suffix = `quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/**
 * Rates chosen so no internal figure coincides with a client figure.
 *
 * At 25% margin and 20% tax the two are always equal — the tax on a marked-up
 * total is exactly the markup — and a leak test would pass on that identity
 * rather than on the separation it means to prove. 40% and 20% keep every
 * amount distinct.
 */
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

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `qo-${suffix}`, email: `qo-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `qx-${suffix}`, email: `qx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  otherWs = asWorkspaceId((await ensurePersonalWorkspace(otherId)).id);

  await updateCostSettings(ownerWs, ownerId, COST_SETTINGS);
  await updateCostSettings(otherWs, otherId, COST_SETTINGS);
  await updateQuoteSettings(ownerWs, ownerId, {
    companyName: 'Atelier Nour',
    companyAddress: '12 Rue des Artisans, Casablanca',
    companyPhone: '+212 522 00 00 00',
    companyEmail: 'contact@ateliernour.test',
    taxIdentifiers: 'ICE 001234567000089',
    primaryColorHex: '#1f6feb',
    footerText: 'Atelier Nour',
    termsText: 'Fifty percent on order.',
    paymentDetails: 'Bank transfer.',
    validityDays: 30,
    numberPrefix: 'Q',
  });
});

afterAll(async () => {
  const users = { in: [ownerId, otherId] };
  await prisma.quote.deleteMany({ where: { userId: users } });
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: users } } });
  await prisma.project.deleteMany({ where: { userId: users } });
  await prisma.material.deleteMany({ where: { userId: users } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: users } } } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

/**
 * A project costed to known figures.
 *
 *   materials  5 bars x 20000  = 100 000
 *   labour     30% of material =  30 000
 *   transport  fixed           =  50 000
 *   install    10% of material =  10 000
 *   internal                     190 000
 *   margin     40%             =  76 000
 *   client subtotal              266 000
 *   tax        20%             =  53 200
 *   client total                 319 200
 */
async function costedProject(userId = ownerId, workspaceId: WorkspaceId = ownerWs) {
  const project = await createProject(workspaceId, userId, { title: `Shopfront ${Math.random()}` });
  await updateDraftSpec(project.id, userId, COMPLETE_SPEC);
  await approveSpec(project.id, userId);

  const material = await createMaterial(workspaceId, userId, {
    name: `tube-${Math.random()}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 20_000,
  });
  const rows = await selectProjectMaterial(project.id, userId, material.id, null);
  await updateProjectMaterialRequirement(project.id, userId, rows[0].id, {
    requiredQuantity: 25,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, userId);
  const cost = await computeProjectCost(project.id, userId);

  return { project, cost };
}

const client = { clientName: 'Cafe Milano', clientAddress: '45 Boulevard Zerktouni' };

/* -------------------------------------------------------------------------- */

describe('the cost gate', () => {
  it('refuses to quote a project that has not been costed', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Uncosted' });

    await expect(createQuote(project.id, ownerId, client)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.quote.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('says what is missing rather than producing an empty quote', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Uncosted 2' });

    await expect(createQuote(project.id, ownerId, client)).rejects.toThrow(/materials|cost/i);
  });
});

describe('seeding from the calculation', () => {
  it('prices the first line at the calculated client subtotal', async () => {
    const { project, cost } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    expect(cost.clientSubtotalCents).toBe(266_000);
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].unitPriceCents).toBe(266_000);
    expect(quote.subtotalCents).toBe(266_000);
    expect(quote.taxCents).toBe(53_200);
    expect(quote.totalCents).toBe(319_200);
    expect(quote.sourceCostId).toBe(cost.id);
  });

  it('uses the tax rate that produced the cost, not today\'s rate', async () => {
    const { project } = await costedProject();
    // Changed after the cost was computed. The quote must price on the rate the
    // calculation used, or the totals would not reconcile with it.
    await updateCostSettings(ownerWs, ownerId, { ...COST_SETTINGS, taxBp: 700 });
    const quote = await createQuote(project.id, ownerId, client);
    await updateCostSettings(ownerWs, ownerId, COST_SETTINGS);

    expect(quote.taxBp).toBe(2000);
  });

  it('reports no divergence for an untouched quote', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    const view = await getQuoteView(quote.id, ownerId);
    expect(view.divergence).toBeNull();
    expect(view.calculatedSubtotalCents).toBe(266_000);
  });
});

describe('numbering', () => {
  it('runs sequentially per business', async () => {
    const first = await createQuote((await costedProject()).project.id, ownerId, client);
    const second = await createQuote((await costedProject()).project.id, ownerId, client);

    expect(second.sequence).toBe(first.sequence + 1);
    expect(second.number).not.toBe(first.number);
    expect(first.number).toMatch(/^Q-\d{4}-\d{4}$/);
  });

  it('does not share a sequence between businesses', async () => {
    // Per business, not per person: two members of one workspace must never
    // both produce Q-2026-0001, and two workspaces must not see each other's
    // numbering.
    await updateCostSettings(otherWs, otherId, COST_SETTINGS);
    const project = (await costedProject(otherId, otherWs)).project;
    const theirs = await createQuote(project.id, otherId, client);

    expect(theirs.sequence).toBe(1);
    expect(theirs.workspaceId).toBe(otherWs);
  });

  it('continues one sequence across the members of a business', async () => {
    const first = await createQuote((await costedProject()).project.id, ownerId, client);
    const second = await createQuote((await costedProject()).project.id, ownerId, client);
    expect(second.sequence).toBe(first.sequence + 1);
  });
});

describe('ownership', () => {
  it('hides another user\'s quote rather than admitting it exists', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    await expect(getQuoteView(quote.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(updateQuote(quote.id, otherId, { title: 'Theirs' })).rejects.toMatchObject({ status: 404 });
    await expect(issueQuote(quote.id, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(deleteQuote(quote.id, otherId)).rejects.toMatchObject({ status: 404 });
  });

  it('lists only the project\'s own quotes', async () => {
    const { project } = await costedProject();
    await createQuote(project.id, ownerId, client);
    const { project: elsewhere } = await costedProject();
    await createQuote(elsewhere.id, ownerId, client);

    expect(await listQuotes(project.id, ownerId)).toHaveLength(1);
  });
});

describe('editing', () => {
  it('recomputes totals from the lines instead of trusting a supplied total', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    const updated = await updateQuote(quote.id, ownerId, {
      lines: [
        { description: 'Fabrication', quantityMilli: 1_000, unitLabel: null, unitPriceCents: 200_000 },
        { description: 'Installation', quantityMilli: 2_500, unitLabel: 'h', unitPriceCents: 20_000 },
      ],
    });

    expect(updated.lines.map((line) => line.lineTotalCents)).toEqual([200_000, 50_000]);
    expect(updated.subtotalCents).toBe(250_000);
    expect(updated.taxCents).toBe(50_000);
    expect(updated.totalCents).toBe(300_000);
  });

  it('makes a deviation from the calculated price visible', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    await updateQuote(quote.id, ownerId, {
      lines: [{ description: 'Everything', quantityMilli: 1_000, unitLabel: null, unitPriceCents: 300_000 }],
    });

    const view = await getQuoteView(quote.id, ownerId);
    expect(view.divergence).toEqual({ differenceCents: 34_000, direction: 'above' });
  });

  it('replaces the line set rather than merging it', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    const updated = await updateQuote(quote.id, ownerId, {
      lines: [
        { description: 'A', quantityMilli: 1_000, unitLabel: null, unitPriceCents: 100 },
        { description: 'B', quantityMilli: 1_000, unitLabel: null, unitPriceCents: 200 },
      ],
    });

    expect(updated.lines.map((line) => [line.position, line.description])).toEqual([
      [0, 'A'],
      [1, 'B'],
    ]);
    expect(await prisma.quoteLine.count({ where: { quoteId: quote.id } })).toBe(2);
  });

  it('leaves the lines alone when only the client details change', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    const updated = await updateQuote(quote.id, ownerId, { clientName: 'Cafe Roma' });

    expect(updated.clientName).toBe('Cafe Roma');
    expect(updated.lines).toHaveLength(1);
    expect(updated.subtotalCents).toBe(266_000);
  });
});

describe('issuing', () => {
  it('refuses without a company name rather than sending an unattributed quote', async () => {
    const nameless = await prisma.user.create({
      data: { clerkId: `qn-${suffix}`, email: `qn-${suffix}@example.test` },
    });
    const namelessWs = asWorkspaceId((await ensurePersonalWorkspace(nameless.id)).id);
    await updateCostSettings(namelessWs, nameless.id, COST_SETTINGS);
    const { project } = await costedProject(nameless.id, namelessWs);
    const quote = await createQuote(project.id, nameless.id, client);

    await expect(issueQuote(quote.id, nameless.id)).rejects.toThrow(/company name/i);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('draft');

    await prisma.quote.deleteMany({ where: { userId: nameless.id } });
    await prisma.projectMaterial.deleteMany({ where: { material: { userId: nameless.id } } });
    await prisma.project.deleteMany({ where: { userId: nameless.id } });
    await prisma.material.deleteMany({ where: { userId: nameless.id } });
    await prisma.workspace.deleteMany({ where: { members: { some: { userId: nameless.id } } } });
    await prisma.user.delete({ where: { id: nameless.id } });
  });

  it('refuses a quote with no lines', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);
    await updateQuote(quote.id, ownerId, { lines: [] });

    await expect(issueQuote(quote.id, ownerId)).rejects.toThrow(/at least one line/i);
  });

  it.runIf(isStorageConfigured())('freezes the company block at issue', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    const issued = await issueQuote(quote.id, ownerId);
    expect(issued.status).toBe('issued');
    expect(issued.issuedAt).not.toBeNull();
    expect(issued.validUntil).not.toBeNull();
    expect(issued.pdfObjectKey).toBeTruthy();

    // The company is renamed afterwards. The issued quote must not follow.
    const before = await getQuoteSettings(ownerWs);
    await updateQuoteSettings(ownerWs, ownerId, { ...toPayload(before), companyName: 'Renamed Atelier' });
    const document = await buildQuoteDocument(quote.id, ownerId);
    await updateQuoteSettings(ownerWs, ownerId, toPayload(before));

    expect(document.issuer.companyName).toBe('Atelier Nour');
  });

  it.runIf(isStorageConfigured())('moves the project to the quoted stage', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);
    await issueQuote(quote.id, ownerId);

    const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.status).toBe('quoted');
  });

  it.runIf(isStorageConfigured())('refuses to edit, re-issue or delete an issued quote', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);
    await issueQuote(quote.id, ownerId);

    await expect(updateQuote(quote.id, ownerId, { title: 'Changed' })).rejects.toThrow(/issued/i);
    await expect(issueQuote(quote.id, ownerId)).rejects.toThrow(/already been issued/i);
    await expect(deleteQuote(quote.id, ownerId)).rejects.toThrow(/issued/i);
  });

  it.runIf(isStorageConfigured())('stores a downloadable document', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    await expect(quoteDownloadUrl(quote.id, ownerId)).rejects.toThrow(/not been issued/i);

    await issueQuote(quote.id, ownerId);
    const url = await quoteDownloadUrl(quote.id, ownerId);
    expect(url).toContain('https://');
    expect(url).toContain('X-Amz-Signature');
  });
});

describe('internal cost separation', () => {
  it('never prints an internal figure on the client document', async () => {
    const { project, cost } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);
    const text = extractPdfText(await renderQuote(quote.id, ownerId));

    // Everything the business must not show a client.
    const internal = {
      materials: cost.materialsCostCents,
      labour: cost.laborCostCents,
      transport: cost.transportCostCents,
      installation: cost.installCostCents,
      internalTotal: cost.internalTotalCents,
      margin: cost.marginCents,
    };

    // Guard the test itself: if a rate change ever made an internal amount
    // equal a client amount, the assertions below would pass for the wrong
    // reason. See the note on COST_SETTINGS.
    const clientAmounts = [cost.clientSubtotalCents, cost.taxCents, cost.clientTotalCents];
    for (const [name, amount] of Object.entries(internal)) {
      expect(clientAmounts, `${name} coincides with a client amount`).not.toContain(amount);
    }

    for (const [name, amount] of Object.entries(internal)) {
      expect(text, `${name} leaked`).not.toContain(formatMoney(amount, 'MAD'));
    }

    // And the words that would frame one.
    for (const word of ['Margin', 'Profit', 'Internal', 'Purchase', 'Supplier', 'Waste']) {
      expect(text, `"${word}" leaked`).not.toContain(word);
    }

    // The client figures, however, must be there — otherwise the assertions
    // above would pass on an empty document.
    expect(text).toContain(formatMoney(cost.clientSubtotalCents, 'MAD'));
    expect(text).toContain(formatMoney(cost.taxCents, 'MAD'));
    expect(text).toContain(formatMoney(cost.clientTotalCents, 'MAD'));
    expect(text).toContain(`2${GROUP_SEPARATOR}660.00 MAD`);
  });

  it('builds the document without loading a cost figure at all', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    const document = await buildQuoteDocument(quote.id, ownerId);
    const serialised = JSON.stringify(document);

    for (const field of ['internalTotal', 'margin', 'laborCost', 'materialsCost', 'purchase']) {
      expect(serialised.toLowerCase()).not.toContain(field.toLowerCase());
    }
  });
});

describe('warnings', () => {
  it('says Arabic text cannot be drawn instead of printing blank boxes', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, { ...client, clientName: 'مقهى ميلانو' });

    const view = await getQuoteView(quote.id, ownerId);
    expect(view.warnings.join(' ')).toMatch(/Arabic/i);
  });

  it('reports nothing for a Latin-script quote', async () => {
    const { project } = await costedProject();
    const quote = await createQuote(project.id, ownerId, client);

    expect((await getQuoteView(quote.id, ownerId)).warnings).toEqual([]);
  });
});

/** Round-trips settings through the update payload shape. */
function toPayload(settings: Awaited<ReturnType<typeof getQuoteSettings>>) {
  return {
    companyName: settings.companyName,
    companyAddress: settings.companyAddress,
    companyPhone: settings.companyPhone,
    companyEmail: settings.companyEmail,
    taxIdentifiers: settings.taxIdentifiers,
    primaryColorHex: settings.primaryColorHex,
    footerText: settings.footerText,
    termsText: settings.termsText,
    paymentDetails: settings.paymentDetails,
    validityDays: settings.validityDays,
    numberPrefix: settings.numberPrefix,
  };
}
