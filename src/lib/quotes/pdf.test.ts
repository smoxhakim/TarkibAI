import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { QuoteDocument } from './document';
import { GROUP_SEPARATOR } from './format';
import { renderQuotePdf } from './pdf';
import { extractPdfText, offPagePlacements } from '@/lib/pdf/text';

/**
 * These render a real PDF and read back the text a client would see.
 *
 * Asserting on the document object instead would prove nothing about leakage:
 * the question is what reaches the page.
 */

const baseDocument = (overrides: Partial<QuoteDocument> = {}): QuoteDocument => ({
  number: 'Q-2026-0007',
  issuedAt: '2026-09-07T10:00:00.000Z',
  validUntil: '2026-10-07T10:00:00.000Z',
  isDraft: false,
  issuer: {
    companyName: 'Atelier Nour',
    address: '12 Rue des Artisans\nCasablanca',
    phone: '+212 522 00 00 00',
    email: 'contact@ateliernour.ma',
    taxIdentifiers: 'ICE 001234567000089',
    primaryColorHex: '#1f6feb',
    logo: null,
  },
  client: {
    name: 'Cafe Milano',
    address: '45 Boulevard Zerktouni\nCasablanca',
    phone: '+212 661 00 00 00',
    email: 'gerant@cafemilano.ma',
  },
  projectTitle: 'Illuminated shopfront sign',
  projectDescription: 'Aluminium tray with acrylic face and LED illumination.',
  lines: [
    {
      position: 0,
      description: 'Illuminated shopfront sign, 3000 x 800 mm',
      quantityMilli: 1_000,
      unitLabel: null,
      unitPriceCents: 1_875_00,
      lineTotalCents: 1_875_00,
    },
    {
      position: 1,
      description: 'On-site installation',
      quantityMilli: 2_500,
      unitLabel: 'h',
      unitPriceCents: 200_00,
      lineTotalCents: 500_00,
    },
  ],
  currency: 'MAD',
  subtotalCents: 2_375_00,
  taxBp: 2_000,
  taxCents: 475_00,
  totalCents: 2_850_00,
  termsText: 'Fifty percent on order, balance on delivery.',
  paymentDetails: 'Bank transfer to Atelier Nour, RIB 011 780 000...',
  footerText: 'Atelier Nour — Casablanca',
  mockup: null,
  ...overrides,
});

describe('renderQuotePdf', () => {
  it('produces a valid PDF', async () => {
    const pdf = await renderQuotePdf(baseDocument());

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });

  it('prints the identifying information a client needs', async () => {
    const text = extractPdfText(await renderQuotePdf(baseDocument()));

    expect(text).toContain('QUOTATION');
    expect(text).toContain('Q-2026-0007');
    expect(text).toContain('Atelier Nour');
    expect(text).toContain('Cafe Milano');
    expect(text).toContain('ICE 001234567000089');
    expect(text).toContain('7 September 2026');
    expect(text).toContain('Illuminated shopfront sign');
  });

  it('prints line totals that add up to the printed total', async () => {
    const text = extractPdfText(await renderQuotePdf(baseDocument()));

    // Thousands are grouped with U+00A0 so an amount cannot wrap mid-number;
    // the space before the currency is an ordinary one.
    const sep = GROUP_SEPARATOR;

    expect(text).toContain(`1${sep}875.00 MAD`); // line 1
    expect(text).toContain('500.00 MAD'); // line 2
    expect(text).toContain(`2${sep}375.00 MAD`); // subtotal = 1875 + 500
    expect(text).toContain('475.00 MAD'); // tax
    expect(text).toContain(`2${sep}850.00 MAD`); // total
    expect(text).toContain('Tax / TVA (20%)');
  });

  it('shows fractional quantities with their unit', async () => {
    const text = extractPdfText(await renderQuotePdf(baseDocument()));
    expect(text).toContain('2.5 h');
  });

  it('marks a draft on the page so it cannot be mistaken for an issued quote', async () => {
    const draft = extractPdfText(
      await renderQuotePdf(baseDocument({ isDraft: true, issuedAt: null, validUntil: null }))
    );
    const issued = extractPdfText(await renderQuotePdf(baseDocument()));

    expect(draft).toContain('DRAFT');
    expect(issued).not.toContain('DRAFT');
  });

  it('says a mockup is indicative rather than letting a client read it as a drawing', async () => {
    // A 1x1 PNG is enough: the caption is the point, not the picture.
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const text = extractPdfText(
      await renderQuotePdf(baseDocument({ mockup: { dataUri: pixel, mimeType: 'image/png' } }))
    );

    expect(text).toContain('Indicative visualisation');
    expect(text).toContain('Not a scale drawing');
  });

  it('omits sections that have no content instead of printing empty headings', async () => {
    const text = extractPdfText(
      await renderQuotePdf(
        baseDocument({ termsText: null, paymentDetails: null, mockup: null })
      )
    );

    expect(text).not.toContain('TERMS');
    expect(text).not.toContain('PAYMENT');
    expect(text).not.toContain('VISUAL REFERENCE');
    // The quote itself still renders.
    expect(text).toContain('Q-2026-0007');
  });

  it('renders the page number inside the page', async () => {
    const pdf = await renderQuotePdf(baseDocument());

    expect(extractPdfText(pdf)).toContain('1 / 1');
    // A mis-measured element still produces a valid PDF containing all the
    // text, drawn somewhere nobody can see it. Only the placement says so.
    expect(offPagePlacements(pdf)).toEqual([]);
  });

  it('keeps every element on the page when the quote runs long', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      position: index,
      description: `Component ${index + 1} — fabricated, finished and delivered to site`,
      quantityMilli: 1_000,
      unitLabel: 'pc',
      unitPriceCents: 12_345,
      lineTotalCents: 12_345,
    }));

    const pdf = await renderQuotePdf(baseDocument({ lines: many }));

    expect(offPagePlacements(pdf)).toEqual([]);
    expect(extractPdfText(pdf)).toContain('Component 40');
  });

  it('keeps the draft watermark and a mockup on the page', async () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const pdf = await renderQuotePdf(
      baseDocument({
        isDraft: true,
        issuedAt: null,
        validUntil: null,
        mockup: { dataUri: pixel, mimeType: 'image/png' },
      })
    );

    expect(offPagePlacements(pdf)).toEqual([]);
    writeFileSync('/tmp/tarkib-quote-draft.pdf', pdf);
  });

  it('writes a sample for visual inspection', async () => {
    const pdf = await renderQuotePdf(baseDocument());
    writeFileSync('/tmp/tarkib-quote-sample.pdf', pdf);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });
});
