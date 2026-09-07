import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { countPages, extractPdfText, offPagePlacements } from '@/lib/pdf/text';
import type { ProductionDocument } from './document';
import { renderProductionPdf } from './pdf';

/** A 1x1 PNG. Enough to prove an image block renders; the picture is not the point. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const baseDocument = (overrides: Partial<ProductionDocument> = {}): ProductionDocument => ({
  reference: 'Production package 1',
  generatedAt: '2026-09-08T09:00:00.000Z',
  projectTitle: 'Cafe Milano shopfront sign',
  versions: {
    specVersion: 3,
    specApproved: true,
    specApprovedAt: '2026-09-05T09:00:00.000Z',
    drawingVersion: 2,
    materialsCalculatedAt: '2026-09-06T09:00:00.000Z',
  },
  summary: {
    projectType: 'enseigne',
    dimensions: '8 × 3 m',
    quantity: 1,
    environment: 'outdoor — Boulevard Zerktouni',
    lighting: 'led — halo-lit letters',
    lettering: '"CAFE MILANO" — bold',
    finishNotes: 'Brushed aluminium, matt lacquer',
  },
  drawing: { reference: 'Drawing 2', image: { dataUri: PIXEL, mimeType: 'image/png' } },
  drawingUnavailableReason: null,
  components: [
    { name: 'Aluminium tray', quantity: 1, notes: 'Welded corners' },
    { name: 'Acrylic face', quantity: 1, notes: null },
  ],
  materials: [
    {
      name: 'Aluminium tube 40x40',
      role: 'Frame',
      supplier: 'Metaux Casa',
      stockSize: '6 m',
      thickness: '2 mm',
      required: '25 m',
      unitsToPurchase: 5,
      purchased: '30 m',
      waste: '5 m (16.67%)',
      unsupportedReason: null,
      warnings: [],
    },
  ],
  cuttingPlans: [
    {
      materialName: 'Dibond 3 mm',
      kind: 'sheet',
      stockSizeLabel: '2.44 m × 1.22 m',
      stockUnitsUsed: 3,
      wastePercent: '12.4',
      kerfMm: 4,
      edgeMarginMm: 10,
      unplaced: [],
      images: [{ dataUri: PIXEL, mimeType: 'image/png' }],
    },
  ],
  mounting: { method: 'steel frame', surface: 'brick', heightFromGround: '3.5 m from ground' },
  notes: 'Weld the tray before drilling the fixing points.',
  ...overrides,
});

describe('renderProductionPdf', () => {
  it('produces a valid PDF', async () => {
    const pdf = await renderProductionPdf(baseDocument());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('prints what the package was built from', async () => {
    const text = extractPdfText(await renderProductionPdf(baseDocument()));

    expect(text).toContain('PRODUCTION PACKAGE');
    expect(text).toContain('Cafe Milano shopfront sign');
    expect(text).toContain('Production package 1');
    expect(text).toContain('Version 3');
    expect(text).toContain('Drawing 2');
  });

  it('prints the specification and mounting details that were recorded', async () => {
    const text = extractPdfText(await renderProductionPdf(baseDocument()));

    expect(text).toContain('8 × 3 m');
    expect(text).toContain('led — halo-lit letters');
    expect(text).toContain('steel frame');
    expect(text).toContain('3.5 m from ground');
  });

  it('says a value is missing rather than leaving the row blank', async () => {
    const text = extractPdfText(
      await renderProductionPdf(
        baseDocument({
          summary: {
            projectType: null,
            dimensions: null,
            quantity: null,
            environment: null,
            lighting: null,
            lettering: null,
            finishNotes: null,
          },
        })
      )
    );

    expect(text).toContain('Not recorded');
  });

  it('warns against assuming a mounting method when none is recorded', async () => {
    const text = extractPdfText(await renderProductionPdf(baseDocument({ mounting: null })));

    expect(text).toContain('No mounting method is recorded');
    expect(text).toContain('Do not assume one');
  });

  it('prints a calculation warning beside the figure it qualifies', async () => {
    const text = extractPdfText(
      await renderProductionPdf(
        baseDocument({
          materials: [
            {
              ...baseDocument().materials[0],
              warnings: ['This is a MINIMUM. Bars are counted by total length, not by how the cuts pack.'],
            },
          ],
        })
      )
    );

    // A workshop acting on "5 bars" has to see the caveat on the same sheet.
    expect(text).toContain('This is a MINIMUM');
  });

  it('reports an uncalculated material line instead of showing a zero', async () => {
    const text = extractPdfText(
      await renderProductionPdf(
        baseDocument({
          materials: [
            {
              ...baseDocument().materials[0],
              required: null,
              unitsToPurchase: null,
              purchased: null,
              waste: null,
              unsupportedReason: 'The material has no stock length recorded.',
            },
          ],
        })
      )
    );

    expect(text).toContain('Not calculated: The material has no stock length recorded.');
  });

  it('names the pieces a cutting plan could not place', async () => {
    const text = extractPdfText(
      await renderProductionPdf(
        baseDocument({
          cuttingPlans: [
            {
              ...baseDocument().cuttingPlans[0],
              unplaced: [{ label: 'Back panel', reason: 'Larger than the sheet.' }],
            },
          ],
        })
      )
    );

    expect(text).toContain('could not be placed');
    expect(text).toContain('Back panel');
    expect(text).toContain('Larger than the sheet.');
  });

  it('says there is no drawing rather than printing an empty page', async () => {
    const text = extractPdfText(
      await renderProductionPdf(
        baseDocument({
          drawing: null,
          drawingUnavailableReason: 'No technical drawing has been issued for this project.',
        })
      )
    );

    expect(text).toContain('No technical drawing has been issued');
  });

  it('tells the workshop not to infer cuts when no plan exists', async () => {
    const text = extractPdfText(await renderProductionPdf(baseDocument({ cuttingPlans: [] })));

    expect(text).toContain('do not infer them from the drawing');
  });

  it('flags a package built from an unapproved specification', async () => {
    const approved = extractPdfText(await renderProductionPdf(baseDocument()));
    const draft = extractPdfText(
      await renderProductionPdf(
        baseDocument({
          versions: { ...baseDocument().versions, specApproved: false, specApprovedAt: null },
        })
      )
    );

    expect(draft).toContain('DRAFT, NOT APPROVED');
    expect(draft).toContain('may not reflect what the client agreed');
    expect(approved).not.toContain('NOT APPROVED');
  });

  it('carries no prices', async () => {
    const text = extractPdfText(await renderProductionPdf(baseDocument()));

    // The shop floor needs quantities, not costs, and a package can end up with
    // a subcontractor.
    for (const word of ['MAD', 'Price', 'Cost', 'Total']) {
      expect(text, `"${word}" reached the workshop copy`).not.toContain(word);
    }
  });

  it('keeps every element on the page', async () => {
    const pdf = await renderProductionPdf(baseDocument());

    expect(extractPdfText(pdf)).toContain('1 / ');
    expect(offPagePlacements(pdf)).toEqual([]);
  });

  it('keeps every element on the page for a package with many plans', async () => {
    const plans = Array.from({ length: 6 }, (_, index) => ({
      ...baseDocument().cuttingPlans[0],
      materialName: `Material ${index + 1}`,
    }));
    const materials = Array.from({ length: 25 }, (_, index) => ({
      ...baseDocument().materials[0],
      name: `Material line ${index + 1}`,
    }));

    const pdf = await renderProductionPdf(baseDocument({ cuttingPlans: plans, materials }));

    expect(offPagePlacements(pdf)).toEqual([]);
    expect(extractPdfText(pdf)).toContain('Material 6');
    expect(extractPdfText(pdf)).toContain('Material line 25');
  });

  it('lays the package out in three pages with nothing left blank', async () => {
    // Cover, drawing, then material list and cutting plans. An overflowing
    // block does not raise an error in react-pdf — it silently leaves an empty
    // page behind, and every text assertion still passes.
    expect(countPages(await renderProductionPdf(baseDocument()))).toBe(3);
  });

  it('does not add a page when there is no drawing and no plan', async () => {
    const pdf = await renderProductionPdf(
      baseDocument({
        drawing: null,
        drawingUnavailableReason: 'No technical drawing has been issued for this project.',
        cuttingPlans: [],
      })
    );

    expect(countPages(pdf)).toBe(3);
  });

  it('writes samples for visual inspection', async () => {
    writeFileSync('/tmp/tarkib-production-sample.pdf', await renderProductionPdf(baseDocument()));
    writeFileSync(
      '/tmp/tarkib-production-gaps.pdf',
      await renderProductionPdf(
        baseDocument({
          drawing: null,
          drawingUnavailableReason: 'No technical drawing has been issued for this project.',
          cuttingPlans: [],
          mounting: null,
          notes: null,
          versions: { ...baseDocument().versions, specApproved: false, specApprovedAt: null },
        })
      )
    );
  });
});
