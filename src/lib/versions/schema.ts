import { z } from 'zod';

export const createVersionSchema = z.object({
  /** What the user is marking, in their own words. */
  label: z.string().trim().min(1, 'Give the version a name.').max(160),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type CreateVersionPayload = z.infer<typeof createVersionSchema>;

export const compareVersionsSchema = z.object({
  fromId: z.string().uuid(),
  /** Omitted compares against the project as it stands now. */
  toId: z.string().uuid().nullable().optional(),
});
