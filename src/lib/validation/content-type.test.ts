import { describe, expect, it } from 'vitest';
import { sniffMimeType, verifyDeclaredType } from './content-type';

const bytes = (...values: number[]) => Buffer.from(values);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PDF = Buffer.from('%PDF-1.7\nrest of the file');
const WEBP = Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WEBPVP8 ')]);
const TEXT = Buffer.from('name,quantity\ntube,4\n');

describe('sniffMimeType', () => {
  it('recognises the types this application renders', () => {
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(JPEG)).toBe('image/jpeg');
    expect(sniffMimeType(PDF)).toBe('application/pdf');
    expect(sniffMimeType(WEBP)).toBe('image/webp');
  });

  it('does not mistake a RIFF container for a WebP', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WAVEfmt ')]);
    expect(sniffMimeType(wav)).toBeNull();
  });

  it('returns null for bytes it has not been taught', () => {
    expect(sniffMimeType(TEXT)).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('does not read past the end of a short file', () => {
    expect(sniffMimeType(bytes(0x89, 0x50))).toBeNull();
    expect(sniffMimeType(Buffer.from('RIFF'))).toBeNull();
  });
});

describe('verifyDeclaredType', () => {
  it('accepts a file that is what it says', () => {
    expect(verifyDeclaredType(PNG, 'image/png')).toEqual({ ok: true, detectedMimeType: 'image/png' });
  });

  it('refuses a file whose bytes contradict its declared type', () => {
    const verdict = verifyDeclaredType(PDF, 'image/png');

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ detectedMimeType: 'application/pdf' });
    if (!verdict.ok) expect(verdict.reason).toMatch(/uploaded as image\/png .* application\/pdf/);
  });

  it('accepts image/jpg for a JPEG, which is the same thing', () => {
    expect(verifyDeclaredType(JPEG, 'image/jpg').ok).toBe(true);
  });

  it('accepts a type it does not recognise rather than refusing every attachment', () => {
    // A DXF, an SVG or a supplier's spreadsheet has no magic number here.
    // Refusing everything unrecognised would break ordinary uploads to protect
    // against nothing.
    expect(verifyDeclaredType(TEXT, 'text/csv')).toEqual({ ok: true, detectedMimeType: null });
  });
});
