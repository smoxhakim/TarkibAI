/**
 * Integration tests for conversational design editing.
 *
 * The property that matters most: a proposal changes nothing until a person
 * approves it, and the agent has no path to that approval.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, getSpec, updateDraftSpec } from '@/lib/spec/service';
import { getScene, seedScene } from '@/lib/canvas/service';
import { buildToolbox } from '@/lib/ai/tools';
import { approveProposal, createProposal, listProposals, rejectProposal } from './service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const suffix = `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let otherId: string;

const COMPLETE_SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `do-${suffix}`, email: `do-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `dx-${suffix}`, email: `dx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

/** A project with an approved spec and a seeded canvas. */
async function readyProject() {
  const project = await createProject(ownerId, { title: `design ${Math.random()}` });
  await updateDraftSpec(project.id, ownerId, COMPLETE_SPEC);
  await approveSpec(project.id, ownerId);
  const scene = await seedScene(project.id, ownerId);
  return { project, panelId: scene.scene.objects[0].id };
}

describe('the approval gate', () => {
  it('changes nothing until the user approves', async () => {
    const { project, panelId } = await readyProject();

    await createProposal(project.id, ownerId, {
      summary: '3ard ghadi ytzad mn 8 m l 8.5 m.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });

    // The canvas must be untouched while the proposal is pending.
    const scene = await getScene(project.id, ownerId);
    expect(scene.scene.objects[0].widthMm).toBe(8000);
  });

  it('applies the change only on approval', async () => {
    const { project, panelId } = await readyProject();
    const proposal = await createProposal(project.id, ownerId, {
      summary: 'Widen to 8.5 m.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });

    await approveProposal(project.id, ownerId, proposal.id);

    const scene = await getScene(project.id, ownerId);
    expect(scene.scene.objects[0].widthMm).toBe(8500);
  });

  it('leaves the canvas alone when rejected', async () => {
    const { project, panelId } = await readyProject();
    const proposal = await createProposal(project.id, ownerId, {
      summary: 'Widen to 9 m.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 9000 } }],
    });

    const rejected = await rejectProposal(project.id, ownerId, proposal.id);
    expect(rejected.status).toBe('rejected');
    expect((await getScene(project.id, ownerId)).scene.objects[0].widthMm).toBe(8000);
  });

  it('refuses to decide the same proposal twice', async () => {
    const { project, panelId } = await readyProject();
    const proposal = await createProposal(project.id, ownerId, {
      summary: 'Widen.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });

    await approveProposal(project.id, ownerId, proposal.id);
    await expect(approveProposal(project.id, ownerId, proposal.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses to create or decide a proposal on another user's project", async () => {
    const { project, panelId } = await readyProject();

    await expect(
      createProposal(project.id, otherId, {
        summary: 'Hijack.',
        commands: [{ kind: 'remove_object', id: panelId }],
      })
    ).rejects.toMatchObject({ status: 404 });

    const proposal = await createProposal(project.id, ownerId, {
      summary: 'Widen.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });
    await expect(approveProposal(project.id, otherId, proposal.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(rejectProposal(project.id, otherId, proposal.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('the agent cannot bypass the gate', () => {
  it('exposes no tool that mutates the canvas or approves anything', () => {
    const names = buildToolbox('project-1', 'user-1').map((tool) => tool.name);

    // The agent may read and propose. Everything else is a user action.
    expect(names).toContain('get_canvas');
    expect(names).toContain('propose_design_change');
    for (const forbidden of ['approve_proposal', 'approve_spec', 'update_canvas', 'apply_commands']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('leaves a proposal created through the tool in pending state', async () => {
    const { project, panelId } = await readyProject();
    const toolbox = buildToolbox(project.id, ownerId);
    const propose = toolbox.find((tool) => tool.name === 'propose_design_change')!;

    const result = (await propose.execute({
      summary: 'zid 50cm f l3ard: mn 8 m l 8.5 m.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    })) as { status: string };

    expect(result.status).toBe('pending');
    // The canvas the agent just "changed" is unchanged.
    expect((await getScene(project.id, ownerId)).scene.objects[0].widthMm).toBe(8000);
  });

  it('rejects an invalid command at proposal time so the agent can correct itself', async () => {
    const { project } = await readyProject();
    const toolbox = buildToolbox(project.id, ownerId);
    const propose = toolbox.find((tool) => tool.name === 'propose_design_change')!;

    await expect(
      propose.execute({
        summary: 'Bad geometry.',
        // Fractional millimetres are not valid geometry.
        commands: [{ kind: 'add_object', object: { type: 'panel', x: 0, y: 0, widthMm: 10.5, heightMm: 10 } }],
      })
    ).rejects.toThrow();
  });
});

describe('superseding', () => {
  it('supersedes an earlier pending proposal', async () => {
    const { project, panelId } = await readyProject();
    const first = await createProposal(project.id, ownerId, {
      summary: 'Widen to 8.5 m.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });
    await createProposal(project.id, ownerId, {
      summary: 'Widen to 9 m instead.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 9000 } }],
    });

    // Two competing pending changes could be approved in an order producing a
    // result neither proposal described.
    const all = await listProposals(project.id, ownerId);
    expect(all.find((p) => p.id === first.id)?.status).toBe('superseded');
    expect(all.filter((p) => p.status === 'pending')).toHaveLength(1);
  });

  it('refuses to approve a superseded proposal', async () => {
    const { project, panelId } = await readyProject();
    const first = await createProposal(project.id, ownerId, {
      summary: 'One.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });
    await createProposal(project.id, ownerId, {
      summary: 'Two.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 9000 } }],
    });

    await expect(approveProposal(project.id, ownerId, first.id)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('specification propagation', () => {
  it('writes a new DRAFT spec rather than rewriting the approved one', async () => {
    const { project, panelId } = await readyProject();
    const proposal = await createProposal(project.id, ownerId, {
      summary: '3ard mn 8 m l 8.5 m.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
      specPatch: { dimensions: { width: 8.5 } },
    });

    await approveProposal(project.id, ownerId, proposal.id);

    const view = await getSpec(project.id, ownerId);
    expect(view.status).toBe('draft');
    expect(view.version).toBe(2);
    expect(view.spec.dimensions?.width).toBe(8.5);

    // The approved version 1 still records what was actually agreed.
    const approved = await prisma.projectSpec.findFirstOrThrow({
      where: { projectId: project.id, status: 'approved' },
      orderBy: { version: 'desc' },
    });
    expect((approved.data as { dimensions?: { width?: number } }).dimensions?.width).toBe(8);
  });

  it('does not touch the specification when no patch is included', async () => {
    const { project, panelId } = await readyProject();
    const proposal = await createProposal(project.id, ownerId, {
      summary: 'Rename the panel.',
      commands: [{ kind: 'update_object', id: panelId, changes: { label: 'Façade principale' } }],
    });
    await approveProposal(project.id, ownerId, proposal.id);

    const view = await getSpec(project.id, ownerId);
    // Moving or renaming is layout detail, not an agreed project fact.
    expect(view.version).toBe(1);
    expect(view.status).toBe('approved');
  });
});

describe('applying against a changed scene', () => {
  it('fails safely and records why when the target object is gone', async () => {
    const { project, panelId } = await readyProject();
    const proposal = await createProposal(project.id, ownerId, {
      summary: 'Widen the panel.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });

    // The user deletes the object in the edit panel before deciding.
    const { applyCommands } = await import('@/lib/canvas/service');
    await applyCommands(project.id, ownerId, [{ kind: 'remove_object', id: panelId }]);

    await expect(approveProposal(project.id, ownerId, proposal.id)).rejects.toMatchObject({
      status: 409,
    });

    const stored = await prisma.designProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(stored.status).toBe('rejected');
    expect(stored.failureReason).toContain('No canvas object');
  });
});

describe('revision history', () => {
  it('keeps decided proposals as the design history', async () => {
    const { project, panelId } = await readyProject();

    const approved = await createProposal(project.id, ownerId, {
      summary: 'Widen.',
      commands: [{ kind: 'update_object', id: panelId, changes: { widthMm: 8500 } }],
    });
    await approveProposal(project.id, ownerId, approved.id);

    const rejected = await createProposal(project.id, ownerId, {
      summary: 'Make it red.',
      commands: [{ kind: 'update_object', id: panelId, changes: { label: 'Red' } }],
    });
    await rejectProposal(project.id, ownerId, rejected.id);

    const history = await listProposals(project.id, ownerId);
    expect(history.map((p) => p.status).sort()).toEqual(['approved', 'rejected']);
    expect(history.every((p) => p.decidedAt !== null)).toBe(true);
  });
});
