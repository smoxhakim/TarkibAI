import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { buildObjectKey } from '@/lib/storage/keys';
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteObject,
  getObjectPrefix,
  headObject,
} from '@/lib/storage/r2';
import { isStorageConfigured } from '@/lib/storage/config';
import { SNIFF_BYTES, verifyDeclaredType } from '@/lib/validation/content-type';
import { recordAudit } from '@/lib/audit/service';
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

  // What the browser declared is bound into the upload signature (T2); this is
  // the first check of what actually arrived. The vision model is handed image
  // bytes directly, so a file that is not the type it claims does not become a
  // rendering problem later — it is refused here.
  await rejectMismatchedContent(row, userId);

  const updated = await prisma.file.update({
    where: { id: row.id },
    data: { status: 'ready', sizeBytes: head.sizeBytes },
  });
  return toView(updated);
}

/**
 * Refuses a file whose bytes contradict its declared type.
 *
 * A failure to read the prefix is NOT treated as a rejection. Storage being
 * briefly unreachable is not evidence that a file is lying, and deleting
 * someone's upload on that basis would be worse than the risk it guards
 * against. The file is accepted and the failure logged.
 */
async function rejectMismatchedContent(row: FileRow, userId: string): Promise<void> {
  let prefix: Buffer;
  try {
    prefix = await getObjectPrefix(row.objectKey, SNIFF_BYTES);
  } catch (error) {
    console.error('[files] could not read the uploaded bytes to verify them', row.id, error);
    return;
  }

  const verdict = verifyDeclaredType(prefix, row.mimeType);
  if (verdict.ok) return;

  await deleteObject(row.objectKey).catch((error) =>
    console.error('[files] could not remove a rejected upload', row.objectKey, error)
  );
  await prisma.file.delete({ where: { id: row.id } });

  await recordAudit({
    userId,
    projectId: row.projectId,
    action: 'file.rejected',
    summary: `Rejected the upload "${row.originalName}": ${verdict.reason}`,
    detail: {
      declaredMimeType: row.mimeType,
      detectedMimeType: verdict.detectedMimeType,
      originalName: row.originalName,
    },
  });

  throw badRequest(`${verdict.reason} The upload was not kept.`);
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
