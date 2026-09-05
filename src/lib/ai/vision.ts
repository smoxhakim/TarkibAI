import sharp from 'sharp';
import { getObjectBytes } from '@/lib/storage/r2';
import { isVisionMimeType } from '@/lib/files/schema';
import type { File as FileRow } from '@/generated/prisma/client';

/**
 * Turns stored project files into image content for the model.
 *
 * Images are fetched from R2 by the server and sent inline. A signed URL would
 * be simpler, but it would make a private site photo fetchable by anyone
 * holding that URL for its lifetime; inlining keeps the object inside our
 * infrastructure.
 *
 * Everything is re-encoded to JPEG at a bounded size. A 12MP phone photo costs
 * far more in vision tokens than the model can use, and normalising the format
 * also handles HEIC from iPhones, which the API does not accept.
 */
const MAX_EDGE_PIXELS = 1536;
const JPEG_QUALITY = 80;

/** Bounds cost on a message with many attachments. */
export const MAX_IMAGES_PER_TURN = 4;

export type ImagePart = {
  type: 'image_url';
  image_url: { url: string };
};

/**
 * A file that could not be decoded is SKIPPED rather than failing the turn.
 * Losing one unreadable attachment is much better than a user's whole message
 * erroring; the agent simply does not see that image.
 */
async function toImagePart(file: FileRow): Promise<ImagePart | null> {
  if (!isVisionMimeType(file.mimeType)) return null;

  try {
    const original = await getObjectBytes(file.objectKey);
    const normalised = await sharp(original)
      .rotate() // honour EXIF orientation, or a phone photo arrives sideways
      .resize(MAX_EDGE_PIXELS, MAX_EDGE_PIXELS, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    return {
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${normalised.toString('base64')}` },
    };
  } catch (error) {
    console.error('[vision] could not prepare image', { fileId: file.id, error });
    return null;
  }
}

export async function buildImageParts(files: FileRow[]): Promise<ImagePart[]> {
  const candidates = files.filter((file) => isVisionMimeType(file.mimeType)).slice(0, MAX_IMAGES_PER_TURN);
  const parts = await Promise.all(candidates.map(toImagePart));
  return parts.filter((part): part is ImagePart => part !== null);
}
