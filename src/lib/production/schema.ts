import { z } from 'zod';

export const generateProductionSchema = z.object({
  /** Instructions for the shop floor, frozen onto the package. */
  notes: z.string().trim().max(4000).nullable().optional(),
});
export type GenerateProductionPayload = z.infer<typeof generateProductionSchema>;
