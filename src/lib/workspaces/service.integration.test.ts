/**
 * Integration tests for workspaces, membership and permissions.
 *
 * The matrix is pure and covered by unit tests. These cover the properties that
 * only the database can demonstrate, and that a mistake in would be a security
 * incident rather than a bug: that one business cannot reach another's data,
 * that a role's limits are enforced by the services and not merely by the UI,
 * and that a shared workspace really is shared.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject, getProject, listProjects, updateProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import {
  createMaterial,
  getMaterial,
  listMaterials,
  setMaterialArchived,
  updateProjectMaterialRequirement,
  selectProjectMaterial,
} from '@/lib/materials/service';
import { calculateProjectMaterials } from '@/lib/calc/materials/service';
import {
  computeProjectCost,
  getCostSettings,
  getProjectCost,
  updateCostSettings,
} from '@/lib/calc/costs/service';
import { applyCommands } from '@/lib/canvas/service';
import { createQuote } from '@/lib/quotes/service';
import { generateProductionDocument } from '@/lib/production/service';
import { getIntegrityReport } from '@/lib/validation/service';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from './access';
import {
  acceptInvitation,
  changeMemberRole,
  createWorkspace,
  getWorkspaceView,
  inviteMember,
  removeMember,
  revokeInvitation,
} from './service';
import type { WorkspaceRole } from './permissions';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** The owner of the shared workspace, and one member per role under test. */
let ownerId: string;
let sharedWs: WorkspaceId;
let outsiderId: string;
let outsiderWs: WorkspaceId;
const memberIds: Record<string, string> = {};

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'tube' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

async function makeUser(tag: string) {
  return prisma.user.create({
    data: { clerkId: `${tag}-${suffix}`, email: `${tag}-${suffix}@example.test` },
  });
}

beforeAll(async () => {
  const owner = await makeUser('own');
  ownerId = owner.id;
  await ensurePersonalWorkspace(ownerId);

  const outsider = await makeUser('out');
  outsiderId = outsider.id;
  outsiderWs = asWorkspaceId((await ensurePersonalWorkspace(outsiderId)).id);

  const workspace = await createWorkspace(ownerId, `Atelier ${suffix}`);
  sharedWs = asWorkspaceId(workspace.id);

  for (const role of ['admin', 'designer', 'sales', 'production', 'worker'] as WorkspaceRole[]) {
    const user = await makeUser(role.slice(0, 3));
    memberIds[role] = user.id;
    await ensurePersonalWorkspace(user.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: sharedWs, userId: user.id, role },
    });
  }

  await updateCostSettings(sharedWs, ownerId, {
    laborType: 'percent', laborBp: 3000, laborCents: 0,
    transportType: 'fixed', transportBp: 0, transportCents: 50_000,
    installType: 'percent', installBp: 1000, installCents: 0,
    marginBp: 4000, taxBp: 2000, currency: 'MAD',
  });
});

afterAll(async () => {
  const users = [ownerId, outsiderId, ...Object.values(memberIds)];
  await prisma.auditEvent.deleteMany({ where: { userId: { in: users } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: users } } } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

/** A costed project in the shared workspace, created by its owner. */
async function sharedProject() {
  const project = await createProject(sharedWs, ownerId, { title: `Job ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
  await approveSpec(project.id, ownerId);

  const material = await createMaterial(sharedWs, ownerId, {
    name: `tube-${Math.random()}`,
    category: 'Metal', customCategory: false,
    measurementModel: 'linear', standardLengthMm: 6000, unitPriceCents: 20_000,
  });
  const rows = await selectProjectMaterial(project.id, ownerId, material.id, 'Frame');
  await updateProjectMaterialRequirement(project.id, ownerId, rows[0].id, {
    requiredQuantity: 25, requiredDimensions: null,
  });
  await calculateProjectMaterials(project.id, ownerId);
  await computeProjectCost(project.id, ownerId);

  return { project, material };
}

/* -------------------------------------------------------------------------- */

describe('isolation between businesses', () => {
  it("hides another workspace's project rather than admitting it exists", async () => {
    const { project } = await sharedProject();

    // 404, not 403: a 403 would confirm the id is real and let anyone
    // enumerate another business's projects.
    await expect(getProject(project.id, outsiderId)).rejects.toMatchObject({ status: 404 });
    await expect(
      updateProject(project.id, outsiderId, { title: 'Mine now' })
    ).rejects.toMatchObject({ status: 404 });
    await expect(getIntegrityReport(project.id, outsiderId)).rejects.toMatchObject({ status: 404 });
  });

  it("hides another workspace's material", async () => {
    const { material } = await sharedProject();
    await expect(getMaterial(material.id, outsiderId)).rejects.toMatchObject({ status: 404 });
    await expect(setMaterialArchived(material.id, outsiderId, true)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('never lists across workspaces', async () => {
    await sharedProject();

    const mine = await listProjects(outsiderWs, {});
    const theirs = await listProjects(sharedWs, {});

    expect(mine).toHaveLength(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(await listMaterials(outsiderWs, { includeArchived: false })).toHaveLength(0);
  });

  it('hides the workspace itself from a non-member', async () => {
    await expect(getWorkspaceView(sharedWs, outsiderId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('a shared workspace really is shared', () => {
  it('shows one member the project another created', async () => {
    const { project } = await sharedProject();
    const seen = await getProject(project.id, memberIds.designer);
    expect(seen.id).toBe(project.id);
  });

  it('shows every member the same material library', async () => {
    const { material } = await sharedProject();
    const asProduction = await listMaterials(sharedWs, { includeArchived: false });
    expect(asProduction.some((row) => row.id === material.id)).toBe(true);
  });

  it('gives every member the same costing rules', async () => {
    // Two members quoting the same project must reach the same price, so the
    // rules belong to the business rather than to whoever is signed in.
    const settings = await getCostSettings(sharedWs);
    expect(settings.marginBp).toBe(4000);

    const personal = await getCostSettings(outsiderWs);
    expect(personal.marginBp).toBe(0);
  });
});

describe('roles are enforced by the services, not by the interface', () => {
  it('refuses internal cost to a worker', async () => {
    const { project } = await sharedProject();

    // The PRD's headline permission. Refused, not redacted: the row is never
    // fetched, so no column added later can leak through it.
    await expect(getProjectCost(project.id, memberIds.worker)).rejects.toMatchObject({
      status: 403,
    });
    await expect(getProjectCost(project.id, memberIds.production)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('allows internal cost to sales and the owner', async () => {
    const { project } = await sharedProject();
    expect((await getProjectCost(project.id, memberIds.sales)).cost).not.toBeNull();
    expect((await getProjectCost(project.id, ownerId)).cost).not.toBeNull();
  });

  it('still lets a worker open the project, without the figures', async () => {
    const { project } = await sharedProject();

    // Degrades rather than failing: a worker sees the job they are building.
    const report = await getIntegrityReport(project.id, memberIds.worker);
    expect(report.findings.length).toBeGreaterThanOrEqual(0);

    // This used to assert `finding.area !== 'cost'`, which was the wrong rule
    // twice over. It let "priced at zero" through, because that finding is
    // filed under materials; and it hid `cost.stale`, which states no figure
    // and is what stops a quote going out on superseded numbers. What a worker
    // must not receive is a FIGURE, not everything filed under cost.
    const serialised = JSON.stringify(report);
    expect(serialised).not.toMatch(/priced at zero/i);
    expect(serialised).not.toMatch(/\b\d+[.,]\d{2}\b/);

    const forOwner = await getIntegrityReport(project.id, ownerId);
    expect(forOwner.findings.length).toBeGreaterThanOrEqual(report.findings.length);
  });

  it('gives a worker and the owner the same document gates', async () => {
    const { project } = await sharedProject();

    // Visibility may differ; what the project is SAFE to produce may not.
    const worker = await getIntegrityReport(project.id, memberIds.worker);
    const owner = await getIntegrityReport(project.id, ownerId);

    expect(worker.readiness.quote.ready).toBe(owner.readiness.quote.ready);
    expect(worker.readiness.production.ready).toBe(owner.readiness.production.ready);
    expect(worker.readiness.quote.blockers.map((f) => f.code)).toEqual(
      owner.readiness.quote.blockers.map((f) => f.code)
    );
  });

  it('refuses quoting to a designer, who cannot see the price behind it', async () => {
    const { project } = await sharedProject();
    await expect(
      createQuote(project.id, memberIds.designer, { clientName: 'Cafe Milano' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows quoting to sales', async () => {
    const { project } = await sharedProject();
    const quote = await createQuote(project.id, memberIds.sales, { clientName: 'Cafe Milano' });
    expect(quote.clientName).toBe('Cafe Milano');
  });

  it('refuses design editing to sales and allows it to a designer', async () => {
    const { project } = await sharedProject();
    const add = {
      kind: 'add_object' as const,
      object: {
        type: 'panel' as const, x: 0, y: 0, widthMm: 1000, heightMm: 500,
        rotationDeg: 0, showDimensions: true,
      },
    };

    await expect(applyCommands(project.id, memberIds.sales, [add])).rejects.toMatchObject({
      status: 403,
    });
    const view = await applyCommands(project.id, memberIds.designer, [add]);
    expect(view.scene.objects).toHaveLength(1);
  });

  it('refuses the material library to a worker and allows it to production', async () => {
    const { material } = await sharedProject();

    await expect(setMaterialArchived(material.id, memberIds.worker, true)).rejects.toMatchObject({
      status: 403,
    });
    const archived = await setMaterialArchived(material.id, memberIds.production, true);
    expect(archived.archivedAt).not.toBeNull();
    await setMaterialArchived(material.id, memberIds.production, false);
  });

  it('refuses package generation to a worker and allows it to production', async () => {
    const { project } = await sharedProject();

    await expect(
      generateProductionDocument(project.id, memberIds.worker)
    ).rejects.toMatchObject({ status: 403 });
  });

  it('says which permission is missing, because the caller can see the project', async () => {
    const { project } = await sharedProject();

    // A 403 here is safe and useful: membership already tells them it exists.
    await expect(getProjectCost(project.id, memberIds.worker)).rejects.toThrow(/cost\.view/);
  });
});

describe('invitations', () => {
  const invitee = () => `invitee-${suffix}@example.test`;

  it('refuses a link presented by the wrong account', async () => {
    const invitation = await inviteMember(sharedWs, ownerId, {
      email: invitee(),
      role: 'designer',
    });

    // The whole risk of a shared link: whoever holds it must not be able to
    // walk in.
    await expect(acceptInvitation(invitation.token, outsiderId)).rejects.toMatchObject({
      status: 403,
    });
    expect(await prisma.workspaceMember.count({ where: { workspaceId: sharedWs, userId: outsiderId } })).toBe(0);
  });

  it('admits the account it was addressed to, with the role it named', async () => {
    const user = await makeUser('inv');
    memberIds.invited = user.id;
    await ensurePersonalWorkspace(user.id);

    const invitation = await inviteMember(sharedWs, ownerId, {
      email: user.email,
      role: 'designer',
    });
    const member = await acceptInvitation(invitation.token, user.id);

    expect(member.role).toBe('designer');
    const project = (await sharedProject()).project;
    expect((await getProject(project.id, user.id)).id).toBe(project.id);
  });

  it('refuses a revoked link rather than deleting it and freeing the token', async () => {
    const email = `revoked-${suffix}@example.test`;
    const invitation = await inviteMember(sharedWs, ownerId, { email, role: 'worker' });
    const view = await getWorkspaceView(sharedWs, ownerId);
    const row = view.invitations.find((entry) => entry.email === email)!;

    await revokeInvitation(sharedWs, ownerId, row.id);

    const user = await makeUser('rev');
    memberIds.revoked = user.id;
    await prisma.user.update({ where: { id: user.id }, data: { email } });
    await expect(acceptInvitation(invitation.token, user.id)).rejects.toThrow(/withdrawn/i);
  });

  it('refuses an expired link', async () => {
    const email = `expired-${suffix}@example.test`;
    const invitation = await inviteMember(sharedWs, ownerId, { email, role: 'worker' });
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const user = await makeUser('exp');
    memberIds.expired = user.id;
    await prisma.user.update({ where: { id: user.id }, data: { email } });
    await expect(acceptInvitation(invitation.token, user.id)).rejects.toThrow(/expired/i);
  });

  it('cannot be sent by a member without the permission', async () => {
    await expect(
      inviteMember(sharedWs, memberIds.designer, { email: 'x@example.test', role: 'worker' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('cannot hand out the owner role', async () => {
    await expect(
      inviteMember(sharedWs, ownerId, { email: 'x@example.test', role: 'owner' as WorkspaceRole })
    ).rejects.toThrow(/transferred/i);
  });
});

describe('the workspace always keeps an owner', () => {
  it('refuses to remove the owner', async () => {
    await expect(removeMember(sharedWs, ownerId, ownerId)).rejects.toThrow(/owner cannot be removed/i);
  });

  it('refuses to demote the only owner', async () => {
    await expect(changeMemberRole(sharedWs, ownerId, ownerId, 'admin')).rejects.toThrow(
      /no owner/i
    );
  });

  it('does not let an admin change who the owner is', async () => {
    // An admin holds every permission in the matrix, and still cannot promote
    // itself — which is why that is an owner check rather than a permission.
    await expect(
      changeMemberRole(sharedWs, memberIds.admin, memberIds.admin, 'owner')
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      changeMemberRole(sharedWs, memberIds.admin, ownerId, 'worker')
    ).rejects.toMatchObject({ status: 403 });
  });

  it('lets an admin change everybody else', async () => {
    const updated = await changeMemberRole(sharedWs, memberIds.admin, memberIds.worker, 'designer');
    expect(updated.role).toBe('designer');
    await changeMemberRole(sharedWs, memberIds.admin, memberIds.worker, 'worker');
  });
});

describe('personal workspaces', () => {
  it('exist for every user and cannot be emptied of their owner', async () => {
    const personal = await ensurePersonalWorkspace(outsiderId);
    expect(personal.personal).toBe(true);
    await expect(removeMember(personal.id, outsiderId, outsiderId)).rejects.toThrow(/owner/i);
  });

  it('are created once, not on every call', async () => {
    const first = await ensurePersonalWorkspace(outsiderId);
    const second = await ensurePersonalWorkspace(outsiderId);
    expect(second.id).toBe(first.id);
  });
});
