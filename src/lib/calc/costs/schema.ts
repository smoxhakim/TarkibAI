import { z } from 'zod';

/** 0–100% expressed as basis points. 10000 = 100%. */
const basisPoints = z
  .number()
  .int('Percentages are stored as whole basis points.')
  .min(0)
  .max(10_000, 'A percentage cannot exceed 100%.');

const cents = z.number().int('Amounts are whole minor currency units.').min(0).max(1_000_000_00);

const componentType = z.enum(['percent', 'fixed', 'manual']);

export const costSettingsSchema = z.object({
  laborType: componentType,
  laborBp: basisPoints,
  laborCents: cents,
  transportType: componentType,
  transportBp: basisPoints,
  transportCents: cents,
  installType: componentType,
  installBp: basisPoints,
  installCents: cents,
  marginBp: basisPoints,
  taxBp: basisPoints,
  currency: z.string().trim().min(1).max(8),
});
export type CostSettingsPayload = z.infer<typeof costSettingsSchema>;

export const expenseSchema = z.object({
  label: z.string().trim().min(1, 'An expense needs a label.').max(160),
  amountCents: cents,
});

export const calculateCostSchema = z.object({
  manualOverrides: z
    .object({
      laborCents: cents.optional(),
      transportCents: cents.optional(),
      installCents: cents.optional(),
    })
    .optional(),
});

/** Percent <-> basis points conversion for the UI, kept in one place. */
export const percentToBp = (percent: number): number => Math.round(percent * 100);
export const bpToPercent = (bp: number): number => Math.round(bp) / 100;
