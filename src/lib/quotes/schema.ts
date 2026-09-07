import { z } from 'zod';

/**
 * An optional free-text field.
 *
 * `.optional()` comes last on purpose: putting it before `.transform()` makes
 * the transform's return type erase `undefined`, so every field would become
 * required on the parsed type and a caller could no longer omit one.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    // An empty box means "not set", not an empty string printed on the PDF.
    .transform((value) => (value === null || value === '' ? null : value))
    .optional();

const cents = z.number().int('Amounts are whole minor currency units.').min(0).max(1_000_000_00);

export const quoteSettingsSchema = z.object({
  companyName: optionalText(160),
  companyAddress: optionalText(400),
  companyPhone: optionalText(60),
  companyEmail: optionalText(160),
  taxIdentifiers: optionalText(300),
  primaryColorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour such as #1f2937.')
    .nullable()
    .optional(),
  footerText: optionalText(400),
  termsText: optionalText(4000),
  paymentDetails: optionalText(1000),
  validityDays: z.number().int().min(1).max(365),
  numberPrefix: z.string().trim().min(1).max(8),
});
export type QuoteSettingsPayload = z.infer<typeof quoteSettingsSchema>;

/** An empty email box clears the field rather than failing validation. */
const emailField = z
  .union([z.literal(''), z.string().trim().email('That is not a valid email address.').max(160), z.null()])
  .transform((value) => (value === '' || value === null ? null : value))
  .optional();

export const quoteLineSchema = z.object({
  description: z.string().trim().min(1, 'A quote line needs a description.').max(300),
  /** Thousandths of a unit. 2.5 is 2500. */
  quantityMilli: z
    .number()
    .int('Quantities are stored as whole thousandths.')
    .min(1, 'A quote line needs a quantity.')
    .max(1_000_000_000),
  unitLabel: optionalText(24),
  unitPriceCents: cents,
});

export const createQuoteSchema = z.object({
  clientName: z.string().trim().min(1, 'A quote needs a client name.').max(160),
  clientAddress: optionalText(400),
  clientPhone: optionalText(60),
  clientEmail: emailField,
  title: z.string().trim().max(200).nullable().optional(),
  description: optionalText(2000),
});
export type CreateQuotePayload = z.infer<typeof createQuoteSchema>;

export const updateQuoteSchema = z.object({
  clientName: z.string().trim().min(1).max(160).optional(),
  clientAddress: optionalText(400),
  clientPhone: optionalText(60),
  clientEmail: emailField,
  title: z.string().trim().min(1).max(200).optional(),
  description: optionalText(2000),
  /** Replaces the whole line set. Partial line edits are not expressible. */
  lines: z.array(quoteLineSchema).max(60).optional(),
  /** Mockup printed on the quote. Null removes it. */
  mockupId: z.string().uuid().nullable().optional(),
});
export type UpdateQuotePayload = z.infer<typeof updateQuoteSchema>;
