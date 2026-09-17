/**
 * End-to-end vision check: a real image through the real upload path, attached
 * to a real Darija turn, read by the real model.
 *
 * This is the only test that exercises the whole chain at once — presigned
 * upload, HEAD confirmation, server-side fetch, sharp re-encoding, and the
 * vision request. It self-skips unless both AI and storage are configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { runConversationTurn } from '@/lib/ai/conversation-service';
import { getSpec } from '@/lib/spec/service';
import { isAiConfigured } from '@/lib/ai/config';
import { isStorageConfigured } from '@/lib/storage/config';
import { confirmUpload, createUploadIntent } from '@/lib/files/service';
import { deleteObject } from '@/lib/storage/r2';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const enabled = isAiConfigured() && isStorageConfigured();
const suffix = `vis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string;
let workspaceId: WorkspaceId;
const uploadedKeys: string[] = [];

/** A synthetic shopfront sign with text the model can be asked to read back. */
async function makeSignImage(text: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500">
    <rect width="900" height="500" fill="#101418"/>
    <rect x="60" y="150" width="780" height="200" rx="12" fill="#f2b705"/>
    <text x="450" y="275" font-family="Helvetica,Arial,sans-serif" font-size="86"
          font-weight="bold" fill="#101418" text-anchor="middle">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

beforeAll(async () => {
  if (!enabled) return;
  const user = await prisma.user.create({
    data: { clerkId: `vis-${suffix}`, email: `vis-${suffix}@example.test` },
  });
  userId = user.id;
  workspaceId = asWorkspaceId((await ensurePersonalWorkspace(userId)).id);
});

afterAll(async () => {
  if (!enabled) return;
  for (const key of uploadedKeys) {
    await deleteObject(key).catch(() => undefined);
  }
  await prisma.project.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe.skipIf(!enabled)('vision context', () => {
  it(
    'reads an attached image and answers about it in Darija',
    async () => {
      const project = await createProject(workspaceId, userId, { title: 'vision eval' });
      const image = await makeSignImage('ATLAS');

      // The exact three-step path the browser takes.
      const intent = await createUploadIntent(project.id, userId, {
        originalName: 'shopfront.png',
        mimeType: 'image/png',
        sizeBytes: image.length,
        type: 'photo',
      });

      const put = await fetch(intent.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: new Uint8Array(image),
      });
      expect(put.ok).toBe(true);

      const confirmed = await confirmUpload(project.id, userId, intent.fileId);
      // Size must come from R2, not from what the client declared.
      expect(confirmed.sizeBytes).toBe(image.length);

      const row = await prisma.file.findUniqueOrThrow({ where: { id: intent.fileId } });
      uploadedKeys.push(row.objectKey);

      const turn = await runConversationTurn(
        project.id,
        userId,
        'hadi hiya la photo dyal l7anout. chno mektoub f enseigne?',
        [intent.fileId]
      );

      // If the model can name the text on the sign, every link in the chain
      // worked: R2 read, sharp re-encode, and the vision request.
      expect(turn.assistantMessage.content.toUpperCase()).toContain('ATLAS');
      expect(turn.userMessage.attachmentFileIds).toEqual([intent.fileId]);
    },
    180_000
  );

  it(
    'treats a size read from an image as an estimate, never as a recorded dimension',
    async () => {
      const project = await createProject(workspaceId, userId, { title: 'vision fact boundary' });
      const image = await makeSignImage('ATLAS');

      const intent = await createUploadIntent(project.id, userId, {
        originalName: 'facade.png',
        mimeType: 'image/png',
        sizeBytes: image.length,
        type: 'reference',
      });
      await fetch(intent.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: new Uint8Array(image),
      });
      await confirmUpload(project.id, userId, intent.fileId);
      uploadedKeys.push(
        (await prisma.file.findUniqueOrThrow({ where: { id: intent.fileId } })).objectKey
      );

      // An explicit invitation to guess. The user has measured nothing.
      await runConversationTurn(
        project.id,
        userId,
        'hadi hiya lenseigne li bghit. chouf tswira w 9is liya l3ard w l3lo mnha, w sjjelhom.',
        [intent.fileId]
      );

      // A dimension estimated from pixels would become the basis of a material
      // calculation and of what somebody cuts. It must not reach the record.
      const view = await getSpec(project.id, userId);
      expect(
        view.spec.dimensions,
        `recorded a dimension estimated from an image: ${JSON.stringify(view.spec.dimensions)}`
      ).toBeUndefined();
    },
    180_000
  );

  it(
    'ignores an attachment id belonging to a different project',
    async () => {
      const projectA = await createProject(workspaceId, userId, { title: 'vision A' });
      const projectB = await createProject(workspaceId, userId, { title: 'vision B' });
      const image = await makeSignImage('SECRET');

      const intent = await createUploadIntent(projectA.id, userId, {
        originalName: 'a.png',
        mimeType: 'image/png',
        sizeBytes: image.length,
        type: 'photo',
      });
      await fetch(intent.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: new Uint8Array(image),
      });
      await confirmUpload(projectA.id, userId, intent.fileId);

      const row = await prisma.file.findUniqueOrThrow({ where: { id: intent.fileId } });
      uploadedKeys.push(row.objectKey);

      // Passing project A's file id into project B's conversation must be
      // silently dropped, not honoured.
      const turn = await runConversationTurn(projectB.id, userId, 'salam', [intent.fileId]);
      expect(turn.userMessage.attachmentFileIds).toEqual([]);
    },
    180_000
  );
});
