/**
 * Integration tests for the conversation boundary that do NOT call the model.
 *
 * Live model behaviour is covered separately in src/lib/ai/eval.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { listMessages, runConversationTurn } from './conversation-service';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const suffix = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId: string;
let ownerWs: WorkspaceId;
let otherId: string;
let otherWs: WorkspaceId;
const originalKey = process.env.OPENAI_API_KEY;

beforeAll(async () => {
  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { clerkId: `co-${suffix}`, email: `co-${suffix}@example.test` } }),
    prisma.user.create({ data: { clerkId: `cx-${suffix}`, email: `cx-${suffix}@example.test` } }),
  ]);
  ownerId = owner.id;
  otherId = other.id;
  ownerWs = asWorkspaceId((await ensurePersonalWorkspace(ownerId)).id);
  otherWs = asWorkspaceId((await ensurePersonalWorkspace(otherId)).id);
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.workspace.deleteMany({ where: { members: { some: { userId: { in: [ownerId, otherId] } } } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

describe('conversation access control', () => {
  it("refuses to read another user's conversation", async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Private chat' });
    await expect(listMessages(project.id, otherId)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to post into another user's conversation", async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Private chat 2' });
    await expect(runConversationTurn(project.id, otherId, 'salam')).rejects.toMatchObject({
      status: 404,
    });
    // Ownership is checked before the AI-configuration check, so an outsider
    // cannot even learn whether the assistant is enabled.
    expect(await prisma.chatMessage.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('returns an empty history for a new project rather than failing', async () => {
    const project = await createProject(ownerWs, ownerId, { title: 'Fresh' });
    expect(await listMessages(project.id, ownerId)).toEqual([]);
  });
});

describe('when the AI is not configured', () => {
  it('reports 503 and persists nothing', async () => {
    delete process.env.OPENAI_API_KEY;
    const project = await createProject(ownerWs, ownerId, { title: 'No key' });

    await expect(runConversationTurn(project.id, ownerId, 'bghit enseigne')).rejects.toMatchObject({
      status: 503,
      code: 'ai_not_configured',
    });

    // A failed turn must not strand the user's message in an unanswered thread.
    expect(await prisma.chatMessage.count({ where: { projectId: project.id } })).toBe(0);
  });
});
