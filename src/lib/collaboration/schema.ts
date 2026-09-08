import { z } from 'zod';

export const createShareSchema = z.object({
  label: z.string().trim().max(160).nullable().optional(),
  includeQuote: z.boolean().default(true),
  includeMockups: z.boolean().default(true),
  includeDrawings: z.boolean().default(false),
  allowResponses: z.boolean().default(true),
  /** Null means it does not expire; the sender can still withdraw it. */
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});
export type CreateSharePayload = z.infer<typeof createShareSchema>;

export const postCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(4000),
});

export const clientResponseSchema = z.object({
  kind: z.enum(['comment', 'approval', 'revision_request']),
  name: z.string().trim().min(1, 'Please give your name.').max(120),
  body: z.string().trim().max(4000).default(''),
});
