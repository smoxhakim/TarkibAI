// Document Generator — assembles client quote & production PDFs via @react-pdf/renderer.
// IMPORTANT: client_quote PDFs must NEVER include internal cost/margin data.

export interface ClientSafeCost {
  lineItems: Array<{ label: string; quantity: number; unitPriceCents: number; totalCents: number }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

// The ONLY allowed path for feeding cost data into the quote PDF template.
// Strips materialsCostCents/laborCostCents/marginCents/internalTotalCents etc.
export function toClientSafeCost(projectCost: unknown): ClientSafeCost {
  // TODO: map internal ProjectCost fields -> client-safe shape only
  throw new Error('not implemented');
}

// Generates the client-facing quotation PDF (logo, client info, line items, totals, terms).
export async function generateClientQuotePdf(projectId: string): Promise<{ pdfUrl: string }> {
  // TODO: load project, quoteSettings, toClientSafeCost(cost)
  // TODO: render with @react-pdf/renderer, upload to R2, create Document row
  throw new Error('not implemented');
}

// Generates the production PDF: diagram + material list + cutting plan images.
export async function generateProductionPdf(projectId: string): Promise<{ pdfUrl: string }> {
  // TODO: load Diagram, ProjectMaterial[], CuttingPlan[] for projectId
  // TODO: render with @react-pdf/renderer, upload to R2, create Document row
  throw new Error('not implemented');
}
