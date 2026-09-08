import { z } from 'zod';
import { DOMAIN_IDS } from '@/lib/domains/registry';

export const projectTitleSchema = z
  .string()
  .trim()
  .min(1, 'A project title is required.')
  .max(200, 'Project titles are limited to 200 characters.');

export const createProjectSchema = z.object({
  title: projectTitleSchema,
  /**
   * The trade this project belongs to. Omitted means signage, which is what
   * every project created before T17 is — a caller that does not know about
   * domains keeps working and keeps getting the same behaviour.
   */
  domain: z.enum(DOMAIN_IDS as [string, ...string[]]).optional(),
});

export const updateProjectSchema = z
  .object({
    title: projectTitleSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.archived !== undefined, {
    message: 'Provide at least one field to update.',
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
