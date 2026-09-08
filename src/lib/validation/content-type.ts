/**
 * Byte-level content sniffing for uploaded files.
 *
 * Deferred from T2, where the declared MIME type is validated and bound into
 * the upload signature. That binds what the browser *said*; it does not check
 * what actually arrived. A file whose bytes are not the type it claims is
 * either a mistake or an attempt to have something else rendered as an image,
 * and the vision model is handed image bytes directly.
 *
 * Pure and offline: bytes in, verdict out.
 */

type Signature = {
  mimeType: string;
  /** Byte prefix, with null for "any byte here". */
  magic: (number | null)[];
  /** Extra bytes to match at a further offset, e.g. WebP's "WEBP" at 8. */
  at?: { offset: number; bytes: number[] };
};

const ASCII = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

const SIGNATURES: Signature[] = [
  { mimeType: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/gif', magic: ASCII('GIF8') },
  {
    mimeType: 'image/webp',
    magic: ASCII('RIFF'),
    at: { offset: 8, bytes: ASCII('WEBP') },
  },
  { mimeType: 'application/pdf', magic: ASCII('%PDF-') },
];

/** The longest prefix any signature needs, so a caller knows what to fetch. */
export const SNIFF_BYTES = 16;

function matches(bytes: Buffer, signature: Signature): boolean {
  if (bytes.length < signature.magic.length) return false;
  for (let index = 0; index < signature.magic.length; index += 1) {
    const expected = signature.magic[index];
    if (expected !== null && bytes[index] !== expected) return false;
  }
  if (signature.at) {
    const { offset, bytes: extra } = signature.at;
    if (bytes.length < offset + extra.length) return false;
    for (let index = 0; index < extra.length; index += 1) {
      if (bytes[offset + index] !== extra[index]) return false;
    }
  }
  return true;
}

/** The type the bytes actually are, or null when nothing recognises them. */
export function sniffMimeType(bytes: Buffer): string | null {
  return SIGNATURES.find((signature) => matches(bytes, signature))?.mimeType ?? null;
}

export type ContentVerdict =
  | { ok: true; detectedMimeType: string | null }
  | { ok: false; detectedMimeType: string | null; reason: string };

/**
 * Whether a file's bytes match what it claimed to be.
 *
 * An unrecognised prefix is accepted rather than refused. The signature list
 * covers the types this application renders or shows a model; a DXF, an SVG or
 * a supplier's spreadsheet has no magic number here, and rejecting every file
 * this module has not been taught would break ordinary attachments to protect
 * against nothing.
 *
 * A recognised prefix that contradicts the declared type is refused, because
 * that is the case that matters: something claiming to be a PNG which is not.
 */
export function verifyDeclaredType(bytes: Buffer, declaredMimeType: string): ContentVerdict {
  const detected = sniffMimeType(bytes);
  if (detected === null) return { ok: true, detectedMimeType: null };
  if (detected === declaredMimeType) return { ok: true, detectedMimeType: detected };

  // JPEG has several interchangeable labels in the wild.
  if (detected === 'image/jpeg' && declaredMimeType === 'image/jpg') {
    return { ok: true, detectedMimeType: detected };
  }

  return {
    ok: false,
    detectedMimeType: detected,
    reason: `The file was uploaded as ${declaredMimeType} but its contents are ${detected}.`,
  };
}
