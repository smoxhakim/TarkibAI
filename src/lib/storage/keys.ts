import { environmentPrefix } from './config';

/**
 * Object keys are generated entirely server-side from ids we control.
 *
 * The user's filename is NEVER part of the key. A filename is attacker-supplied
 * input and could contain path traversal, control characters, or unicode that
 * changes how the key is interpreted. It is stored separately as display text.
 *
 * Layout follows ARCHITECTURE §9:
 *   {env}/users/{userId}/projects/{projectId}/{category}/{fileId}{ext}
 */
export type StorageCategory = 'uploads' | 'mockups' | 'diagrams' | 'cutting-plans' | 'documents';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

export function extensionForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? '';
}

export function buildObjectKey(params: {
  userId: string;
  projectId: string;
  fileId: string;
  category: StorageCategory;
  mimeType: string;
}): string {
  const { userId, projectId, fileId, category, mimeType } = params;
  return [
    environmentPrefix(),
    'users',
    userId,
    'projects',
    projectId,
    category,
    `${fileId}${extensionForMime(mimeType)}`,
  ].join('/');
}
