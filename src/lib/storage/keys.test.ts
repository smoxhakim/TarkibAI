import { describe, expect, it } from 'vitest';
import { buildObjectKey, extensionForMime } from './keys';

const base = {
  userId: 'user-1',
  projectId: 'project-1',
  fileId: 'file-1',
  category: 'uploads' as const,
};

describe('buildObjectKey', () => {
  it('namespaces by environment, user, and project', () => {
    const key = buildObjectKey({ ...base, mimeType: 'image/png' });
    expect(key).toBe('dev/users/user-1/projects/project-1/uploads/file-1.png');
  });

  it('never includes the user-supplied filename', () => {
    // The filename is attacker-controlled. A key built from it could contain
    // path traversal or control characters, so it is stored separately instead.
    const key = buildObjectKey({ ...base, mimeType: 'image/jpeg' });
    expect(key).not.toContain('..');
    expect(key.split('/').pop()).toBe('file-1.jpg');
  });

  it('produces a key with no traversal segments', () => {
    const key = buildObjectKey({ ...base, mimeType: 'application/pdf' });
    expect(key.split('/').every((segment) => segment !== '..' && segment !== '.')).toBe(true);
  });

  it('separates categories so a mockup cannot collide with an upload', () => {
    const upload = buildObjectKey({ ...base, mimeType: 'image/png' });
    const mockup = buildObjectKey({ ...base, category: 'mockups', mimeType: 'image/png' });
    expect(upload).not.toBe(mockup);
  });
});

describe('extensionForMime', () => {
  it('maps supported types', () => {
    expect(extensionForMime('image/jpeg')).toBe('.jpg');
    expect(extensionForMime('image/png')).toBe('.png');
    expect(extensionForMime('image/webp')).toBe('.webp');
    expect(extensionForMime('application/pdf')).toBe('.pdf');
  });

  it('returns an empty extension for anything unknown rather than guessing', () => {
    expect(extensionForMime('application/x-msdownload')).toBe('');
  });
});
