import { isStorageConfigured } from '@/lib/storage/config';

/**
 * Images for generated documents.
 *
 * A PDF cannot follow a signed URL, so every picture has to be in the file as
 * bytes. Both document types need that, and both need it to fail softly: a
 * quote without its logo is still a correct quote, and a production package
 * without a plan picture still carries the numbers. Refusing to render because
 * a decorative image is missing would be the worse outcome in either case.
 */
export type EmbeddedImage = {
  dataUri: string;
  mimeType: string;
};

/** PNG throughout, so transparency survives instead of gaining a white box. */
async function toPngDataUri(input: Buffer, maxWidth: number): Promise<EmbeddedImage> {
  const { default: sharp } = await import('sharp');
  const png = await sharp(input).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer();
  return { dataUri: `data:image/png;base64,${png.toString('base64')}`, mimeType: 'image/png' };
}

/** Fetches a stored object and inlines it, downscaled. Null on any failure. */
export async function inlineStoredImage(
  objectKey: string | null,
  maxWidth: number
): Promise<EmbeddedImage | null> {
  if (!objectKey || !isStorageConfigured()) return null;

  try {
    const { getObjectBytes } = await import('@/lib/storage/r2');
    return await toPngDataUri(await getObjectBytes(objectKey), maxWidth);
  } catch (error) {
    console.error('[pdf] could not inline a stored image', objectKey, error);
    return null;
  }
}

/**
 * Rasterises an SVG the application generated.
 *
 * Drawings and cutting plans are re-rendered from stored data rather than read
 * back from the PNG copies in R2. Those copies are best-effort and absent when
 * storage was unconfigured at calculation time, whereas the stored SVG source —
 * the drawing's own text, the plan's layout JSON — is always there. Rendering
 * from it means a package cannot silently omit a plan that exists.
 */
export async function rasteriseSvg(
  svg: string,
  width: number
): Promise<EmbeddedImage | null> {
  if (!svg.trim()) return null;

  try {
    return await toPngDataUri(Buffer.from(svg), width);
  } catch (error) {
    console.error('[pdf] could not rasterise an SVG', error);
    return null;
  }
}
