/**
 * Production document generation — Phase 14.
 *
 * The client quote pipeline that this file used to sketch is implemented: see
 * `src/lib/quotes/`. `toClientSafeCost` lives in `src/lib/calc/costs/engine.ts`
 * and the quote template consumes `QuoteDocument` from
 * `src/lib/quotes/document.ts`, which has no internal fields to strip.
 *
 * The sketches for those were removed rather than left here, because a second
 * `toClientSafeCost` that throws is something a future reader could import by
 * mistake instead of the real one.
 */

/** Generates the production PDF: drawings, material list, cutting plans. */
export async function generateProductionPdf(_projectId: string): Promise<{ pdfUrl: string }> {
  // TODO (T14): load Diagram, ProjectMaterial[], CuttingPlan[] for the project,
  // render with @react-pdf/renderer, upload to R2, create a Document row.
  throw new Error('not implemented');
}
