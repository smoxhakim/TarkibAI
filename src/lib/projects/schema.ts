import { z } from 'zod';

export const projectTitleSchema = z
  .string()
  .trim()
  .min(1, 'A project title is required.')
  .max(200, 'Project titles are limited to 200 characters.');

export const createProjectSchema = z.object({
  title: projectTitleSchema,
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
