import { describe, expect, it } from 'vitest';
import { createProjectSchema, updateProjectSchema } from './schema';

describe('createProjectSchema', () => {
  it('trims surrounding whitespace', () => {
    expect(createProjectSchema.parse({ title: '  Facade  ' }).title).toBe('Facade');
  });

  it('rejects an empty or whitespace-only title', () => {
    expect(createProjectSchema.safeParse({ title: '' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('rejects a title longer than 200 characters', () => {
    expect(createProjectSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(createProjectSchema.safeParse({ title: 'x'.repeat(200) }).success).toBe(true);
  });

  it('accepts Arabic-script and Latin Darija titles', () => {
    expect(createProjectSchema.safeParse({ title: 'واجهة مطعم' }).success).toBe(true);
    expect(createProjectSchema.safeParse({ title: 'enseigne dyal restaurant' }).success).toBe(true);
  });
});

describe('updateProjectSchema', () => {
  it('accepts a rename alone', () => {
    expect(updateProjectSchema.safeParse({ title: 'New name' }).success).toBe(true);
  });

  it('accepts an archive toggle alone', () => {
    expect(updateProjectSchema.safeParse({ archived: true }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ archived: false }).success).toBe(true);
  });

  it('rejects an empty patch so a no-op cannot masquerade as an update', () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an invalid title even when archived is present', () => {
    expect(updateProjectSchema.safeParse({ title: '', archived: true }).success).toBe(false);
  });
});
