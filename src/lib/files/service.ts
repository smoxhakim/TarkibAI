import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { buildObjectKey } from '@/lib/storage/keys';
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteObject,
  headObject,
} from '@/lib/storage/r2';
import { isStorageConfigured } from '@/lib/storage/config';
import type { File as FileRow } from '@/generated/prisma/client';
import { MAX_UPLOAD_BYTES, type CreateUploadInput } from './schema';

export type FileView = {
  id: string;
  type: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
};

const storageUnavailable = () =>
  new ApiError(
    503,
    'File storage is not configured on this server. Set the R2_* environment variables to enable uploads.',
    'storage_not_configured'
  );

const toView = (row: FileRow): FileView => ({
  id: row.id,
  type: row.type,
  originalName: row.originalName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
});

/** Only files whose upload was confirmed. A pending row is not a usable asset. */
export async function listFiles(projectId: string, userId: string): Promise<FileView[]> {
  await assertProjectAccess(projectId, userId);
  const rows = await prisma.file.findMany({
    where: { projectId, status: 'ready' },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toView);
}

/**
 * Step 1 of an upload: authorise it and hand back a signed PUT URL.
 *
 * The File row is created as `pending` so the object key is reserved and
 * attributable before any bytes exist. Nothing is shown to the user or sent to
 * the model until confirmUpload verifies the object actually landed.
 */
export async function createUploadIntent(
  projectId: string,
  userId: string,
  input: CreateUploadInput
): Promise<{ fileId: string; uploadUrl: string }> {
  await assertProjectAccess(projectId, userId);
  if (!isStorageConfigured()) throw storageUnavailable();

  const fileId = crypto.randomUUID();
  const objectKey = buildObjectKey({
    userId,
    projectId,
    fileId,
    category: 'uploads',
    mimeType: input.mimeType,
  });

  const uploadUrl = await createSignedUploadUrl(objectKey, input.mimeType);

  await prisma.file.create({
    data: {
      id: fileId,
      projectId,
      userId,
      type: input.type,
      objectKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      // Client-declared for now; replaced with R2's actual value on confirm.
      sizeBytes: input.sizeBytes,
      status: 'pending',
    },
  });

  return { fileId, uploadUrl };
}

/**
 * Step 2: verify the object exists in R2 and record its real size.
 *
 * The size the browser declared is not trusted. A presigned PUT cannot enforce
 * a length limit, so an oversized object is detected here and deleted rather
 * than being left to accumulate storage cost. This is the only place a file
 * becomes visible to the rest of the application.
 */
export async function confirmUpload(
  projectId: string,
  userId: string,
  fileId: string
): Promise<FileView> {
  await assertProjectAccess(projectId, userId);
  if (!isStorageConfigured()) throw storageUnavailable();

  const row = await prisma.file.findUnique({ where: { id: fileId } });
  if (!row || row.projectId !== projectId) throw notFound('File');
  if (row.status === 'ready') return toView(row);

  const head = await headObject(row.objectKey);
  if (!head) {
    throw badRequest('The upload did not complete. Try again.');
  }

  if (head.sizeBytes > MAX_UPLOAD_BYTES) {
    await deleteObject(row.objectKey);
    await prisma.file.delete({ where: { id: row.id } });
    throw badRequest(`Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024}MB or smaller.`);
  }

  const updated = await prisma.file.update({
    where: { id: row.id },
    data: { status: 'ready', sizeBytes: head.sizeBytes },
  });
  return toView(updated);
}

/** A short-lived signed URL. Never persisted, never reused. */
export async function getFileDownloadUrl(
  projectId: string,
  userId: string,
  fileId: string,
  options: { asAttachment?: boolean } = {}
): Promise<string> {
  await assertProjectAccess(projectId, userId);
  if (!isStorageConfigured()) throw storageUnavailable();

  const row = await prisma.file.findUnique({ where: { id: fileId } });
  if (!row || row.projectId !== projectId || row.status !== 'ready') throw notFound('File');

  return createSignedDownloadUrl(row.objectKey, {
    downloadName: options.asAttachment ? row.originalName : undefined,
  });
}

/**
 * Removes the object first, then the row.
 *
 * In that order a failure leaves an orphaned row pointing at a missing object,
 * which surfaces as a clear error. The reverse order would leave an orphaned
 * object nothing references — invisible, and billed for indefinitely.
 */
export async function deleteFile(projectId: string, userId: string, fileId: string): Promise<void> {
  await assertProjectAccess(projectId, userId);

  const row = await prisma.file.findUnique({ where: { id: fileId } });
  if (!row || row.projectId !== projectId) throw notFound('File');

  if (isStorageConfigured()) {
    await deleteObject(row.objectKey);
  }
  await prisma.file.delete({ where: { id: row.id } });
}

/** Loads ready files by id, scoped to the project. Used to build vision context. */
export async function loadReadyFiles(projectId: string, fileIds: string[]): Promise<FileRow[]> {
  if (fileIds.length === 0) return [];
  return prisma.file.findMany({
    where: { id: { in: fileIds }, projectId, status: 'ready' },
  });
}
