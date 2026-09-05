import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  createUploadSchema,
  isVisionMimeType,
} from './schema';

const valid = {
  originalName: 'facade.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
};

describe('createUploadSchema', () => {
  it('accepts a normal photo upload', () => {
    expect(createUploadSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults the file type to reference', () => {
    expect(createUploadSchema.parse(valid).type).toBe('reference');
  });

  it('rejects SVG, which can carry script', () => {
    expect(
      createUploadSchema.safeParse({ ...valid, mimeType: 'image/svg+xml' }).success
    ).toBe(false);
  });

  it('rejects executables and arbitrary binaries', () => {
    for (const mimeType of ['application/x-msdownload', 'text/html', 'application/zip']) {
      expect(createUploadSchema.safeParse({ ...valid, mimeType }).success).toBe(false);
    }
  });

  it('rejects a file over the size limit', () => {
    expect(
      createUploadSchema.safeParse({ ...valid, sizeBytes: MAX_UPLOAD_BYTES + 1 }).success
    ).toBe(false);
    expect(
      createUploadSchema.safeParse({ ...valid, sizeBytes: MAX_UPLOAD_BYTES }).success
    ).toBe(true);
  });

  it('rejects a zero or negative size', () => {
    expect(createUploadSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(false);
    expect(createUploadSchema.safeParse({ ...valid, sizeBytes: -5 }).success).toBe(false);
  });

  it('rejects an empty filename', () => {
    expect(createUploadSchema.safeParse({ ...valid, originalName: '   ' }).success).toBe(false);
  });

  it('accepts HEIC, which is what iPhone photos arrive as', () => {
    expect(createUploadSchema.safeParse({ ...valid, mimeType: 'image/heic' }).success).toBe(true);
  });
});

describe('isVisionMimeType', () => {
  it('accepts images the model can read', () => {
    expect(isVisionMimeType('image/jpeg')).toBe(true);
    expect(isVisionMimeType('image/png')).toBe(true);
  });

  it('rejects PDF — stored and downloadable, but not readable by the vision model', () => {
    expect(isVisionMimeType('application/pdf')).toBe(false);
  });

  it('only claims vision support for accepted types', () => {
    for (const mimeType of ACCEPTED_MIME_TYPES) {
      if (mimeType === 'application/pdf') continue;
      expect(isVisionMimeType(mimeType)).toBe(true);
    }
  });
});
