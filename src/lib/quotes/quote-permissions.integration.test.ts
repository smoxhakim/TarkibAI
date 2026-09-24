/**
 * Reading a quote and changing one are different permissions.
 *
 * TARKIB has exactly two quote permissions, and `quote.create` is defined in
 * the matrix as "Create, edit and issue client quotations" — so the separation
 * already existed in the model. It was not enforced: every write went through
 * `loadQuote`, which checks `quote.view`, so the production role — which the
 * matrix gives read access and deliberately withholds write access from — could
 * edit a client quotation, delete it, and issue it to the client.
 *
 * Roles are taken from `can(role, …)` rather than listed here, so changing the
 * matrix changes what these tests demand.
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
import { computeProjectCost, getProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { updateQuoteSettings } from '@/lib/quotes/settings-service';
import { isStorageConfigured } from '@/lib/storage/config';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import {
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

const suffix = `qperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds = {} as Record<WorkspaceRole, string>;
let workspaceId: WorkspaceId;

/** Splits driven by the matrix, not by a hardcoded list. */
const canRead = WORKSPACE_ROLES.filter((role) => can(role, 'quote.view'));
const canWrite = WORKSPACE_ROLES.filter((role) => can(role, 'quote.create'));
/** The roles this task is about: they may read a quote and must not change one. */
const readOnly = canRead.filter((role) => !can(role, 'quote.create'));

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

/** A costed project carrying one draft quote, everything current. */
async function quotedProject() {
  const owner = userIds.owner;
  const project = await createProject(workspaceId, owner, { title: `Quote perms ${Math.random()}` });
  await updateDraftSpec(project.id, owner, COMPLETE_SPEC);
  await approveSpec(project.id, owner);

  const material = await createMaterial(workspaceId, owner, {
    name: `tube-${Math.random()}`,
    category: 'Metal',
    customCategory: false,
    measurementModel: 'linear',
    standardLengthMm: 6000,
    unitPriceCents: 20_000,
  });
  const selected = await selectProjectMaterial(project.id, owner, material.id, 'Frame');
  await updateProjectMaterialRequirement(project.id, owner, selected[0].id, {
    requiredQuantity: 25,
    requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, owner);
  await computeProjectCost(project.id, owner);

  const quote = await createQuote(project.id, owner, { clientName: 'Restaurant Atlas' });
  return { project, quote };
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
      name: `Quote perms ${suffix}`,
      members: { create: WORKSPACE_ROLES.map((role) => ({ userId: userIds[role], role })) },
    },
  });
  workspaceId = asWorkspaceId(workspace.id);

  await updateCostSettings(workspaceId, userIds.owner, {
    laborType: 'percent',
    laborBp: 3000,
    laborCents: 0,
    transportType: 'fixed',
    transportBp: 0,
    transportCents: 50_000,
    installType: 'percent',
    installBp: 1000,
    installCents: 0,
    marginBp: 4000,
    taxBp: 2000,
    currency: 'MAD',
  });
  await updateQuoteSettings(workspaceId, userIds.owner, {
    companyName: `Quote perms ${suffix}`,
    validityDays: 30,
    numberPrefix: 'Q',
  });
});

afterAll(async () => {
  const users = { in: Object.values(userIds) };
  await prisma.quote.deleteMany({ where: { userId: users } });
  await prisma.projectMaterial.deleteMany({ where: { material: { userId: users } } });
  await prisma.project.deleteMany({ where: { userId: users } });
  await prisma.material.deleteMany({ where: { userId: users } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: users } } } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

describe('the model this task rests on', () => {
  it('separates reading a quote from writing one', () => {
    // If the matrix ever grants every reader write access these tests become
    // vacuous, so the split is asserted rather than assumed.
    expect(readOnly.length).toBeGreaterThan(0);
    expect(canWrite.length).toBeGreaterThan(0);
  });

  it('gives write access only to roles that may also read', () => {
    for (const role of canWrite) {
      expect(can(role, 'quote.view'), role).toBe(true);
    }
  });
});

describe('reading a quote', () => {
  it.each(canRead)('is allowed for %s', async (role) => {
    const { project, quote } = await quotedProject();

    expect((await getQuoteView(quote.id, userIds[role])).quote.id).toBe(quote.id);
    expect(await listQuotes(project.id, userIds[role])).toHaveLength(1);
  });

  it.each(readOnly)('includes rendering the document for %s, which changes nothing', async (role) => {
    const { quote } = await quotedProject();
    // A PDF is bytes out, not a state change: it stays a read.
    await expect(renderQuote(quote.id, userIds[role])).resolves.toBeInstanceOf(Buffer);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('draft');
  });
});

describe('changing a quote', () => {
  it.each(readOnly)('refuses an update from %s', async (role) => {
    const { quote } = await quotedProject();

    await expect(
      updateQuote(quote.id, userIds[role], { clientName: 'Renamed by a reader' })
    ).rejects.toMatchObject({ status: 403 });

    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).clientName).toBe(
      'Restaurant Atlas'
    );
  });

  it.each(readOnly)('refuses a delete from %s', async (role) => {
    const { quote } = await quotedProject();

    await expect(deleteQuote(quote.id, userIds[role])).rejects.toMatchObject({ status: 403 });
    expect(await prisma.quote.count({ where: { id: quote.id } })).toBe(1);
  });

  it.each(readOnly)('refuses an issue from %s, before anything is written', async (role) => {
    const { quote } = await quotedProject();

    await expect(issueQuote(quote.id, userIds[role])).rejects.toMatchObject({ status: 403 });

    // Authorization comes first: the quote must not have been frozen on the way
    // to being refused.
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe('draft');
    expect(after.issuedAt).toBeNull();
  });

  it.each(canWrite)('allows an update from %s', async (role) => {
    const { quote } = await quotedProject();
    const updated = await updateQuote(quote.id, userIds[role], { clientName: 'Cafe Milano' });
    expect(updated.clientName).toBe('Cafe Milano');
  });

  it.each(canWrite)('allows a delete from %s', async (role) => {
    const { quote } = await quotedProject();
    await deleteQuote(quote.id, userIds[role]);
    expect(await prisma.quote.count({ where: { id: quote.id } })).toBe(0);
  });

  it.runIf(isStorageConfigured()).each(canWrite)('allows an issue from %s', async (role) => {
    const { quote } = await quotedProject();
    const issued = await issueQuote(quote.id, userIds[role]);
    expect(issued.status).toBe('issued');
  });
});

describe('the download link follows read access', () => {
  it.runIf(isStorageConfigured())('is available to a read-only role once issued', async () => {
    const { quote } = await quotedProject();
    await issueQuote(quote.id, userIds.owner);

    for (const role of readOnly) {
      await expect(quoteDownloadUrl(quote.id, userIds[role])).resolves.toContain('http');
    }
  });
});

describe('the earlier boundaries still hold', () => {
  it('keeps quote write separate from cost visibility', async () => {
    const { project, quote } = await quotedProject();

    // Production may not write a quote AND may not see costs; those are two
    // different permissions and neither implies the other.
    await expect(
      updateQuote(quote.id, userIds.production, { clientName: 'x' })
    ).rejects.toMatchObject({ status: 403 });
    await expect(getProjectCost(project.id, userIds.production)).rejects.toMatchObject({
      status: 403,
    });

    // Sales writes quotes and sees costs.
    await expect(
      updateQuote(quote.id, userIds.sales, { clientName: 'Cafe Milano' })
    ).resolves.toBeTruthy();
  });

  it('still refuses a quote built on a stale cost, to a role that may write one', async () => {
    const { project, quote } = await quotedProject();
    // Task 3's gate, reached only after authorization passes.
    await calculateProjectMaterials(project.id, userIds.owner);

    await expect(issueQuote(quote.id, userIds.sales)).rejects.toMatchObject({ status: 400 });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('draft');
  });

  it('hides a quote entirely from a role without read access', async () => {
    const { project, quote } = await quotedProject();
    for (const role of WORKSPACE_ROLES.filter((r) => !can(r, 'quote.view'))) {
      await expect(getQuoteView(quote.id, userIds[role])).rejects.toMatchObject({ status: 403 });
      await expect(listQuotes(project.id, userIds[role])).rejects.toMatchObject({ status: 403 });
    }
  });
});
