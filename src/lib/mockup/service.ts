import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { getSpec } from '@/lib/spec/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { buildObjectKey } from '@/lib/storage/keys';
import { getObjectBytes, putObject } from '@/lib/storage/r2';
import type { Mockup } from '@/generated/prisma/client';
import { inngest } from '@/lib/inngest/client';
import { buildMockupPrompt } from './prompt';
import { createReplicateProvider, isMockupConfigured } from './provider';

export type MockupKind = 'concept' | 'site';

const generationUnavailable = () =>
  new ApiError(
    503,
    'Mockup generation is not configured on this server. Set REPLICATE_API_TOKEN to enable it.',
    'mockup_not_configured'
  );

export async function listMockups(projectId: string, userId: string): Promise<Mockup[]> {
  await assertProjectAccess(projectId, userId);
  return prisma.mockup.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
}

/**
 * Queues a mockup.
 *
 * The row is created as `queued` before the job is dispatched, so the request
 * returns immediately with something the UI can poll. A generation that never
 * starts is then visible as a stuck job rather than silently absent.
 */
export async function requestMockup(
  projectId: string,
  userId: string,
  input: { kind: MockupKind; sourceFileId?: string | null }
): Promise<Mockup> {
  await assertProjectAccess(projectId, userId);
  if (!isMockupConfigured()) throw generationUnavailable();
  if (!isStorageConfigured()) {
    throw new ApiError(
      503,
      'File storage is not configured, so a generated mockup could not be saved.',
      'storage_not_configured'
    );
  }

  const specView = await getSpec(projectId, userId);
  if (Object.keys(specView.spec).length <= 1) {
    // Only specVersion present: nothing has been recorded about the project.
    throw badRequest(
      'Describe the project first. A mockup is generated from the specification, not invented.'
    );
  }

  if (input.kind === 'site') {
    if (!input.sourceFileId) {
      throw badRequest('Choose the site photograph to place the project into.');
    }
    // Scoped to the project, so a file id from elsewhere cannot be used.
    const file = await prisma.file.findFirst({
      where: { id: input.sourceFileId, projectId, status: 'ready' },
    });
    if (!file) throw notFound('Site photo');
    if (!file.mimeType.startsWith('image/')) {
      throw badRequest('A site mockup needs an image, not a document.');
    }
  }

  const { prompt, source } = buildMockupPrompt(specView.spec, input.kind);

  const mockup = await prisma.mockup.create({
    data: {
      projectId,
      kind: input.kind,
      sourceFileId: input.sourceFileId ?? null,
      prompt,
      promptSource: source as object,
      status: 'queued',
    },
  });

  await inngest.send({
    name: 'mockup/requested',
    data: { mockupId: mockup.id, projectId, userId },
  });

  return mockup;
}

/**
 * Runs a queued mockup. Called by the background job, never by a request.
 *
 * Every failure path records a reason on the row. A mockup card that simply
 * stays blank tells the user nothing; one that says the model timed out tells
 * them to retry.
 */
export async function runMockup(mockupId: string): Promise<void> {
  const mockup = await prisma.mockup.findUnique({ where: { id: mockupId } });
  if (!mockup) return;
  if (mockup.status === 'succeeded') return;

  const project = await prisma.project.findUnique({
    where: { id: mockup.projectId },
    select: { userId: true },
  });
  if (!project) return;

  await prisma.mockup.update({
    where: { id: mockup.id },
    data: { status: 'running', startedAt: new Date(), failureReason: null },
  });

  try {
    if (!isMockupConfigured()) throw new Error('REPLICATE_API_TOKEN is not set.');

    const provider = createReplicateProvider();
    const specRow = await prisma.projectSpec.findFirst({
      where: { projectId: mockup.projectId },
      orderBy: { version: 'desc' },
    });

    const { parseSpecData } = await import('@/lib/spec/schema');
    const spec = parseSpecData(specRow?.data);
    const { widthPx, heightPx } = buildMockupPrompt(spec, mockup.kind as MockupKind);

    let generated;
    if (mockup.kind === 'site') {
      if (!mockup.sourceFileId) throw new Error('The site photo is missing.');
      const file = await prisma.file.findUnique({ where: { id: mockup.sourceFileId } });
      if (!file) throw new Error('The site photo no longer exists.');

      const imageBytes = await getObjectBytes(file.objectKey);
      generated = await provider.generateOnSite({
        prompt: mockup.prompt,
        widthPx,
        heightPx,
        imageBytes,
        imageMimeType: file.mimeType,
      });
    } else {
      generated = await provider.generateConcept({ prompt: mockup.prompt, widthPx, heightPx });
    }

    const objectKey = buildObjectKey({
      userId: project.userId,
      projectId: mockup.projectId,
      fileId: `mockup-${mockup.id}`,
      category: 'mockups',
      mimeType: generated.mimeType,
    });
    await putObject(objectKey, generated.bytes, generated.mimeType);

    await prisma.mockup.update({
      where: { id: mockup.id },
      data: {
        status: 'succeeded',
        resultObjectKey: objectKey,
        model: generated.model,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.mockup.update({
      where: { id: mockup.id },
      data: {
        status: 'failed',
        failureReason:
          error instanceof Error ? error.message.slice(0, 500) : 'Generation failed.',
        completedAt: new Date(),
      },
    });
    // Rethrown so the job runner records the failure and can retry.
    throw error;
  }
}

export async function deleteMockup(projectId: string, userId: string, mockupId: string): Promise<void> {
  await assertProjectAccess(projectId, userId);

  const mockup = await prisma.mockup.findUnique({ where: { id: mockupId } });
  if (!mockup || mockup.projectId !== projectId) throw notFound('Mockup');

  if (mockup.resultObjectKey && isStorageConfigured()) {
    const { deleteObject } = await import('@/lib/storage/r2');
    await deleteObject(mockup.resultObjectKey).catch(() => undefined);
  }
  await prisma.mockup.delete({ where: { id: mockup.id } });
}

/** Short-lived signed URL for a generated mockup. */
export async function getMockupImageUrl(
  projectId: string,
  userId: string,
  mockupId: string
): Promise<string> {
  await assertProjectAccess(projectId, userId);

  const mockup = await prisma.mockup.findUnique({ where: { id: mockupId } });
  if (!mockup || mockup.projectId !== projectId || !mockup.resultObjectKey) {
    throw notFound('Mockup image');
  }

  const { createSignedDownloadUrl } = await import('@/lib/storage/r2');
  return createSignedDownloadUrl(mockup.resultObjectKey);
}
