/**
 * Integration tests for client sharing and the project conversation.
 *
 * The share is the only unauthenticated read surface in the product, so these
 * concentrate on what a link does and does not expose, and on what happens once
 * it is withdrawn or expires. A mistake here is not a bug — it is a business's
 * costs on somebody else's screen.
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
import { computeProjectCost, updateCostSettings } from '@/lib/calc/costs/service';
import { createQuote, issueQuote } from '@/lib/quotes/service';
import { updateQuoteSettings } from '@/lib/quotes/settings-service';
import { isStorageConfigured } from '@/lib/storage/config';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';
import { PRIVATE_FIELD_NAMES } from './share-view';
import {
  createShare,
  getShareView,
  listComments,
  listNotifications,
  listShares,
  markNotificationsRead,
  postClientResponse,
  postComment,
  revokeShare,
} from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ownerWs: WorkspaceId;
let mateId: string;
let outsiderId: string;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led', details: 'halo-lit' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
  finishNotes: 'Brushed aluminium',
};

const COST_SETTINGS = {
  laborType: 'percent' as const, laborBp: 3000, laborCents: 0,
  transportType: 'fixed' as const, transportBp: 0, transportCents: 50_000,
  installType: 'percent' as const, installBp: 1000, installCents: 0,
  marginBp: 4000, taxBp: 2000, currency: 'MAD',
};

const SHARE = {
  includeQuote: true,
  includeMockups: true,
  includeDrawings: false,
  allowResponses: true,
};

beforeAll(async () => {
  const [owner, mate, outsider] = await Promise.all([
    prisma.user.create({ data: { clerkId: `so-${suffix}`, email: `so-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `sm-${suffix}`, email: `sm-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `sx-${suffix}`, email: `sx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  mateId = mate.id;
  outsiderId = outsider.id;

  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  await ensurePersonalWorkspace(outsiderId);
  await prisma.workspaceMember.create({
    data: { workspaceId: ownerWs, userId: mateId, role: 'admin' },
  });

  await updateCostSettings(ownerWs, COST_SETTINGS);
  await updateQuoteSettings(ownerWs, {
    companyName: 'Atelier Nour', companyAddress: null, companyPhone: null,
    companyEmail: null, taxIdentifiers: null, primaryColorHex: '#1f6feb',
    footerText: null, termsText: null, paymentDetails: null,
    validityDays: 30, numberPrefix: 'Q',
  });
});

afterAll(async () => {
  const users = { in: [ownerId, mateId, outsiderId] };
  await prisma.notification.deleteMany({ where: { userId: users } });
  await prisma.auditEvent.deleteMany({ where: { userId: users } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: users } } } });
  await prisma.user.deleteMany({ where: { id: users } });
  await prisma.$disconnect();
});

/** A costed project with an issued quote, ready to show a client. */
async function quotedProject() {
  const project = await createProject(ownerWs, ownerId, { title: `Shopfront ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
  await approveSpec(project.id, ownerId);

  const material = await createMaterial(ownerWs, ownerId, {
    name: `tube-${Math.random()}`,
    category: 'Metal', customCategory: false,
    measurementModel: 'linear', standardLengthMm: 6000, unitPriceCents: 20_000,
    supplier: 'Metaux Casa',
  });
  const rows = await selectProjectMaterial(project.id, ownerId, material.id, 'Frame');
  await updateProjectMaterialRequirement(project.id, ownerId, rows[0].id, {
    requiredQuantity: 25, requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, ownerId);
  const cost = await computeProjectCost(project.id, ownerId);

  return { project, cost, material };
}

/* -------------------------------------------------------------------------- */

describe('what a client link exposes', () => {
  it('shows the project as the business, without naming anyone internal', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);

    const view = await getShareView(share.token);

    expect(view.projectTitle).toBe(project.title);
    expect(view.companyName).toBe('Atelier Nour');
    expect(view.summary.dimensions).toBe('8 × 3 m');
    expect(view.summary.lighting).toBe('led — halo-lit');
  });

  it('carries no internal figure, even with a cost and a supplier on record', async () => {
    const { project, cost, material } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);

    const view = await getShareView(share.token);
    const serialised = JSON.stringify(view);

    // Guard the premise: these have to be values that would be recognisable.
    expect(cost.internalTotalCents).toBeGreaterThan(0);
    expect(material.supplier).toBe('Metaux Casa');

    for (const amount of [
      cost.materialsCostCents, cost.laborCostCents, cost.internalTotalCents, cost.marginCents,
    ]) {
      expect(serialised).not.toContain(String(amount));
      expect(serialised).not.toContain((amount / 100).toFixed(2));
    }
    expect(serialised).not.toContain('Metaux Casa');
    for (const field of PRIVATE_FIELD_NAMES) {
      expect(serialised).not.toContain(`"${field}"`);
    }
  });

  it('never reveals the ids the rest of the product runs on', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);
    const serialised = JSON.stringify(await getShareView(share.token));

    // A share is read by somebody outside the business; handing them a project
    // id or a workspace id invites them to try it somewhere else.
    expect(serialised).not.toContain(project.id);
    expect(serialised).not.toContain(ownerWs);
    expect(serialised).not.toContain(ownerId);
  });

  it.runIf(isStorageConfigured())('shows an issued quote in client terms only', async () => {
    const { project, cost } = await quotedProject();
    const quote = await createQuote(project.id, ownerId, { clientName: 'Cafe Milano' });
    await issueQuote(quote.id, ownerId);

    const share = await createShare(project.id, ownerId, SHARE);
    const view = await getShareView(share.token);

    expect(view.quote?.number).toBe(quote.number);
    expect(view.quote?.total).toContain('3');
    // The client price is shown; nothing behind it is.
    expect(JSON.stringify(view.quote)).not.toContain(String(cost.internalTotalCents));
  });

  it('omits the quote entirely when the link was not scoped to include one', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, { ...SHARE, includeQuote: false });

    expect((await getShareView(share.token)).quote).toBeNull();
  });
});

describe('a link is a credential, so it can be taken away', () => {
  it('refuses an unknown token the same way as a withdrawn one', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);
    await revokeShare(project.id, ownerId, share.id);

    // Both say only that the link does not work. Telling them apart would let
    // somebody probing tokens learn which guesses had once been real.
    const revoked = await getShareView(share.token).catch((error) => error);
    const unknown = await getShareView('not-a-real-token').catch((error) => error);

    expect(revoked.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(revoked.message).toBe(unknown.message);
  });

  it('refuses an expired link', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, { ...SHARE, expiresInDays: 1 });
    await prisma.projectShare.update({
      where: { id: share.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(getShareView(share.token)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps a withdrawn link withdrawn rather than freeing its token', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);
    await revokeShare(project.id, ownerId, share.id);

    const rows = await listShares(project.id, ownerId);
    expect(rows.find((row) => row.id === share.id)?.active).toBe(false);
    expect(await prisma.projectShare.count({ where: { id: share.id } })).toBe(1);
  });

  it('cannot be created by somebody outside the workspace', async () => {
    const { project } = await quotedProject();
    await expect(createShare(project.id, outsiderId, SHARE)).rejects.toMatchObject({ status: 404 });
    await expect(listShares(project.id, outsiderId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('the client review loop', () => {
  it('records an approval as something a named person said', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);

    await postClientResponse(share.token, {
      kind: 'approval',
      name: 'Youssef (Cafe Milano)',
      body: 'Looks good, go ahead.',
    });

    const view = await getShareView(share.token);
    expect(view.approvedAt).not.toBeNull();

    // Not flattened into a boolean on the project: a project marked "approved"
    // with nobody attached is not evidence of anything.
    const comments = await listComments(project.id, ownerId);
    expect(comments[0].authorName).toBe('Youssef (Cafe Milano)');
    expect(comments[0].kind).toBe('approval');
    expect(comments[0].shareId).toBe(share.id);
  });

  it('records a revision request in the same thread as the team\'s replies', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);

    await postClientResponse(share.token, {
      kind: 'revision_request', name: 'Youssef', body: 'Can the letters be gold?',
    });
    await postComment(project.id, ownerId, 'Gold is possible — I will re-quote.');

    const thread = await listComments(project.id, ownerId);
    expect(thread.map((entry) => entry.authorKind)).toEqual(['client', 'member']);
  });

  it('refuses a response on a read-only link', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, { ...SHARE, allowResponses: false });

    await expect(
      postClientResponse(share.token, { kind: 'approval', name: 'Youssef', body: '' })
    ).rejects.toThrow(/read-only/i);
  });

  it('refuses a response on a withdrawn link', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);
    await revokeShare(project.id, ownerId, share.id);

    await expect(
      postClientResponse(share.token, { kind: 'comment', name: 'Youssef', body: 'Hello' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('shows the client the business, not the colleague who replied', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);
    await postComment(project.id, mateId, 'We can do that.');

    const view = await getShareView(share.token);
    const reply = view.messages.find((message) => !message.fromClient)!;

    expect(reply.author).toBe('Atelier Nour');
    expect(JSON.stringify(view)).not.toContain(`sm-${suffix}@example.test`);
  });
});

describe('notifications', () => {
  it('tells the team when a client responds, and says what they did', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);
    await markNotificationsRead(ownerId);

    await postClientResponse(share.token, {
      kind: 'revision_request', name: 'Youssef', body: 'Gold letters please.',
    });

    const forOwner = await listNotifications(ownerId);
    expect(forOwner[0].kind).toBe('client.requested_changes');
    expect(forOwner[0].summary).toMatch(/Youssef requested changes/);

    // Every member of the business hears about it, not just the sender.
    const forMate = await listNotifications(mateId);
    expect(forMate.some((entry) => entry.kind === 'client.requested_changes')).toBe(true);
  });

  it('does not notify the person who just acted', async () => {
    const { project } = await quotedProject();
    await markNotificationsRead(ownerId);
    await markNotificationsRead(mateId);

    await postComment(project.id, ownerId, 'Starting on this today.');

    expect((await listNotifications(ownerId)).filter((n) => n.readAt === null)).toHaveLength(0);
    expect((await listNotifications(mateId)).filter((n) => n.readAt === null)).toHaveLength(1);
  });

  it('never reaches somebody outside the workspace', async () => {
    const { project } = await quotedProject();
    const share = await createShare(project.id, ownerId, SHARE);
    await postClientResponse(share.token, { kind: 'comment', name: 'Youssef', body: 'Hi' });

    expect(await listNotifications(outsiderId)).toHaveLength(0);
  });

  it('marks only the caller\'s own rows, whatever ids are supplied', async () => {
    const { project } = await quotedProject();
    await postComment(project.id, ownerId, 'For the record.');

    const mateRows = await listNotifications(mateId);
    const target = mateRows.find((row) => row.readAt === null)!;

    // Passing somebody else's notification id does nothing.
    expect(await markNotificationsRead(ownerId, [target.id])).toBe(0);
    expect(
      (await listNotifications(mateId)).find((row) => row.id === target.id)?.readAt
    ).toBeNull();
  });
});
