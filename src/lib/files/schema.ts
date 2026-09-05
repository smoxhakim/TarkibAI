import { z } from 'zod';

/**
 * Accepted upload types.
 *
 * SVG is deliberately excluded. It is an XML document that can carry script,
 * and serving one from our own origin would be a stored-XSS vector. HEIC is
 * included because iPhone photos of a shopfront arrive in that format.
 */
export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

/** Types the vision model can actually read. PDFs are stored but not sent. */
export const VISION_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — a phone photo with headroom

export const FILE_TYPES = ['photo', 'logo', 'sketch', 'reference'] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const createUploadSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ACCEPTED_MIME_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES, `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024}MB or smaller.`),
  type: z.enum(FILE_TYPES).default('reference'),
});

export type CreateUploadInput = z.infer<typeof createUploadSchema>;

export const attachmentIdsSchema = z.array(z.string().uuid()).max(10).optional();

export function isVisionMimeType(mimeType: string): boolean {
  return VISION_MIME_TYPES.includes(mimeType);
}
