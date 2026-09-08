import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value))
    .optional();

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'A supplier needs a name.').max(160),
  contact: optionalText(160),
  phone: optionalText(60),
  email: optionalText(160),
  notes: optionalText(2000),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
});
export type SupplierPayload = z.infer<typeof supplierSchema>;

export const setMaterialSupplierSchema = z.object({
  supplierId: z.string().uuid().nullable(),
});
