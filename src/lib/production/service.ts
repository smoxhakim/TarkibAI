import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { getSpec } from '@/lib/spec/service';
import { listProjectMaterials } from '@/lib/materials/service';
import { formatStockSize, formatThickness, unitLabelFor } from '@/lib/materials/format';
import { listLinearPlans, listPlans } from '@/lib/calc/cutting/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { buildObjectKey } from '@/lib/storage/keys';
import { rasteriseSvg, type EmbeddedImage } from '@/lib/pdf/image';
import type { Document } from '@/generated/prisma/client';
import {
  assertNoPricing,
  type ProductionCuttingPlan,
  type ProductionDocument,
  type ProductionMaterial,
} from './document';
import { buildComponents, buildMounting, buildSummary } from './summary';

export type ProductionView = {
  documents: Document[];
  /** Reasons a package cannot be generated. Empty when it can. */
  blockers: string[];
  /** Things the workshop would want that this project does not have yet. */
  gaps: string[];
  /** What the next package would be built from. */
  available: {
    drawingVersion: number | null;
    calculatedMaterialCount: number;
    cuttingPlanCount: number;
  };
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

async function latestDrawing(projectId: string) {
  return prisma.diagram.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
}

export async function listProductionDocuments(
  projectId: string,
  userId: string
): Promise<Document[]> {
  await assertProjectAccess(projectId, userId);
  return prisma.document.findMany({
    where: { projectId, type: 'production' },
    orderBy: { version: 'desc' },
  });
}

export async function getProductionView(
  projectId: string,
  userId: string
): Promise<ProductionView> {
  await assertProjectAccess(projectId, userId);

  const [documents, drawing, materials, sheetPlans, linearPlans, spec] = await Promise.all([
    listProductionDocuments(projectId, userId),
    latestDrawing(projectId),
    listProjectMaterials(projectId, userId),
    listPlans(projectId, userId),
    listLinearPlans(projectId, userId),
    getSpec(projectId, userId),
  ]);

  const calculated = materials.filter((row) => row.calculatedAt !== null);
  const planCount =
    sheetPlans.filter((entry) => entry.plan !== null).length +
    linearPlans.filter((entry) => entry.plan !== null).length;

  const blockers: string[] = [];
  if (drawing === null && calculated.length === 0) {
    blockers.push(
      'There is nothing to put in a package yet. Issue a technical drawing or calculate the project materials first.'
    );
  }
  if (!isStorageConfigured()) {
    blockers.push('File storage is not configured, so the package cannot be kept on record.');
  }

  // Gaps are not blockers. A workshop can start from a drawing alone, or from a
  // material list alone; saying what is absent is more useful than refusing.
  const gaps: string[] = [];
  if (drawing === null) {
    gaps.push('No technical drawing has been issued, so the package will carry no views.');
  }
  if (calculated.length === 0) {
    gaps.push('No material line has been calculated, so the package will carry no material list.');
  }
  if (planCount === 0) {
    gaps.push('No cutting plan has been computed, so the package will carry no cutting instructions.');
  }
  if (spec.status !== 'approved') {
    gaps.push('The specification is still a draft. The package will say so on its first page.');
  }

  return {
    documents,
    blockers,
    gaps,
    available: {
      drawingVersion: drawing?.version ?? null,
      calculatedMaterialCount: calculated.length,
      cuttingPlanCount: planCount,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

/** Trims a Decimal-ish string for print: "16.670000" -> "16.67". */
function trimDecimal(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const asNumber = Number(value.toString());
  if (Number.isNaN(asNumber)) return null;
  return String(Number(asNumber.toFixed(3)));
}

async function buildMaterials(
  projectId: string,
  userId: string
): Promise<ProductionMaterial[]> {
  const rows = await listProjectMaterials(projectId, userId);
  if (rows.length === 0) return [];

  const library = await prisma.material.findMany({
    where: { id: { in: rows.map((row) => row.materialId) } },
  });
  const byId = new Map(library.map((material) => [material.id, material]));

  return rows.map((row) => {
    const material = byId.get(row.materialId);
    const unit = unitLabelFor(row.measurementModel);

    return {
      name: row.name,
      role: row.role,
      supplier: material?.supplier ?? null,
      stockSize: material
        ? formatStockSize({
            measurementModel: material.measurementModel,
            standardLengthMm: material.standardLengthMm,
            sheetWidthMm: material.sheetWidthMm,
            sheetHeightMm: material.sheetHeightMm,
            thicknessMm: material.thicknessMm === null ? null : Number(material.thicknessMm),
          })
        : null,
      thickness:
        material && material.thicknessMm !== null
          ? formatThickness(Number(material.thicknessMm))
          : null,
      required: row.requiredQuantity ? `${trimDecimal(row.requiredQuantity)} ${unit}` : null,
      unitsToPurchase: row.unitsToPurchase,
      purchased: row.totalPurchasedQuantity
        ? `${trimDecimal(row.totalPurchasedQuantity)} ${unit}`
        : null,
      waste:
        row.wasteQuantity && row.wastePercent
          ? `${trimDecimal(row.wasteQuantity)} ${unit} (${trimDecimal(row.wastePercent)}%)`
          : null,
      unsupportedReason: row.unsupportedReason,
      // Carried through verbatim. These are the calculation's own caveats — the
      // sheet-count minimum, the linear under-count — and a workshop acting on
      // a purchase figure needs to see them beside it, not in the app.
      warnings: row.warnings.map((warning) => warning.message),
    };
  });
}

/** Raster widths. Generous, because these are read at arm's length on a bench. */
const PLAN_IMAGE_WIDTH = 1600;
const DRAWING_IMAGE_WIDTH = 2000;

/**
 * Renders one plan as the images the page will lay out.
 *
 * Sheet plans are split one image per sheet. Drawn as a single stacked figure,
 * five sheets give a 1:2.7 aspect that the page height forces down to about a
 * quarter of the width, and the piece labels go with it. Per sheet the aspect
 * is roughly 2:1, so each figure fills the measure and stays legible. The
 * renderer keeps the correct "Sheet 3 of 5" label because it reads the sheet's
 * own index and the plan's total, not the length of the array it is handed.
 *
 * Linear plans stay whole: bars are drawn as wide, short rows, so the stacked
 * figure is already close to the page's own proportions.
 */
async function renderPlanImages(
  kind: 'sheet' | 'linear',
  svg: string,
  result: unknown
): Promise<EmbeddedImage[]> {
  if (kind === 'linear') {
    const image = await rasteriseSvg(svg, PLAN_IMAGE_WIDTH);
    return image ? [image] : [];
  }

  const sheets =
    typeof result === 'object' && result !== null && Array.isArray((result as { sheets?: unknown[] }).sheets)
      ? (result as { sheets: unknown[] }).sheets
      : [];
  if (sheets.length <= 1) {
    const image = await rasteriseSvg(svg, PLAN_IMAGE_WIDTH);
    return image ? [image] : [];
  }

  const { renderCuttingPlan } = await import('@/lib/calc/cutting/render');
  const perSheet = await Promise.all(
    sheets.map((sheet) =>
      rasteriseSvg(
        renderCuttingPlan({
          ...(result as Record<string, unknown>),
          sheets: [sheet],
        } as never),
        PLAN_IMAGE_WIDTH
      )
    )
  );

  const usable = perSheet.filter((image): image is EmbeddedImage => image !== null);
  if (usable.length > 0) return usable;

  // Fall back to the combined figure rather than dropping the plan entirely.
  const combined = await rasteriseSvg(svg, PLAN_IMAGE_WIDTH);
  return combined ? [combined] : [];
}

async function buildCuttingPlans(
  projectId: string,
  userId: string
): Promise<ProductionCuttingPlan[]> {
  const [sheetPlans, linearPlans] = await Promise.all([
    listPlans(projectId, userId),
    listLinearPlans(projectId, userId),
  ]);

  const entries = [
    ...sheetPlans.map((entry) => ({ ...entry, kind: 'sheet' as const })),
    ...linearPlans.map((entry) => ({ ...entry, kind: 'linear' as const })),
  ].filter((entry) => entry.plan !== null);

  if (entries.length === 0) return [];

  const materials = await prisma.material.findMany({
    where: { id: { in: entries.map((entry) => entry.plan!.materialId) } },
    select: { id: true, name: true },
  });
  const names = new Map(materials.map((material) => [material.id, material.name]));

  // Rasterised together: each is an independent sharp call and a package with
  // several plans would otherwise serialise them for no reason.
  const images = await Promise.all(
    entries.map((entry) => renderPlanImages(entry.kind, entry.svg, entry.result))
  );

  return entries.map((entry, index) => {
    const plan = entry.plan!;
    const unplaced =
      entry.result && 'unplaced' in entry.result && Array.isArray(entry.result.unplaced)
        ? (entry.result.unplaced as { label?: string; reason?: string }[]).map((piece) => ({
            label: piece.label ?? 'Unnamed piece',
            reason: piece.reason ?? 'No reason recorded.',
          }))
        : [];

    return {
      materialName: names.get(plan.materialId) ?? 'Unknown material',
      kind: entry.kind,
      stockSizeLabel: plan.stockSizeLabel,
      stockUnitsUsed: plan.stockUnitsUsed,
      wastePercent: trimDecimal(plan.wastePercent) ?? '0',
      kerfMm: plan.kerfMm,
      edgeMarginMm: plan.edgeMarginMm,
      unplaced,
      images: images[index],
    };
  });
}

/**
 * Assembles the package payload.
 *
 * Nothing here consults the cost layer. The workshop's copy carries quantities
 * and specifications; `assertNoPricing` is the backstop if that ever changes by
 * accident.
 */
export async function buildProductionDocument(
  projectId: string,
  userId: string,
  input: { version: number; notes: string | null }
): Promise<ProductionDocument> {
  await assertProjectAccess(projectId, userId);

  const [project, spec, drawing, materials, cuttingPlans] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { title: true } }),
    getSpec(projectId, userId),
    latestDrawing(projectId),
    buildMaterials(projectId, userId),
    buildCuttingPlans(projectId, userId),
  ]);

  let drawingImage: EmbeddedImage | null = null;
  if (drawing) drawingImage = await rasteriseSvg(drawing.svg, DRAWING_IMAGE_WIDTH);

  const materialsCalculatedAt = materials.some((line) => line.unitsToPurchase !== null)
    ? (
        await prisma.projectMaterial.findFirst({
          where: { projectId, calculatedAt: { not: null } },
          orderBy: { calculatedAt: 'desc' },
          select: { calculatedAt: true },
        })
      )?.calculatedAt ?? null
    : null;

  const document: ProductionDocument = {
    reference: `Production package ${input.version}`,
    generatedAt: new Date().toISOString(),
    projectTitle: project.title,

    versions: {
      specVersion: spec.version > 0 ? spec.version : null,
      specApproved: spec.status === 'approved',
      specApprovedAt: spec.approvedAt?.toISOString() ?? null,
      drawingVersion: drawing?.version ?? null,
      materialsCalculatedAt: materialsCalculatedAt?.toISOString() ?? null,
    },

    summary: buildSummary(spec.spec),

    drawing:
      drawing && drawingImage
        ? { reference: `Drawing ${drawing.version}`, image: drawingImage }
        : null,
    drawingUnavailableReason:
      drawing === null
        ? 'No technical drawing has been issued for this project.'
        : drawingImage === null
          ? 'The issued drawing could not be rendered into this package. Open drawing ' +
            `${drawing.version} in the application instead.`
          : null,

    components: buildComponents(spec.spec),
    materials,
    cuttingPlans,
    mounting: buildMounting(spec.spec),
    notes: input.notes,
  };

  assertNoPricing(document);
  return document;
}

/** Renders a package to PDF bytes without storing anything. */
export async function renderProductionDocument(
  projectId: string,
  userId: string,
  input: { version: number; notes: string | null }
): Promise<Buffer> {
  const document = await buildProductionDocument(projectId, userId, input);
  const { renderProductionPdf } = await import('./pdf');
  return renderProductionPdf(document);
}

/* -------------------------------------------------------------------------- */
/* Generating                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Generates and stores a numbered production package.
 *
 * Synchronous, like the quote. The heavy part is rasterising the drawing and
 * each cutting plan, which run together and come from data already in the
 * database — no model call, no third-party API. If a project ever carries
 * enough plans that this approaches the request limit, this is the operation
 * ARCHITECTURE 17 has in mind for the job runner; it does not need it yet.
 */
export async function generateProductionDocument(
  projectId: string,
  userId: string,
  input: { notes?: string | null } = {}
): Promise<Document> {
  await assertProjectAccess(projectId, userId);

  const view = await getProductionView(projectId, userId);
  if (view.blockers.length > 0) throw badRequest(view.blockers.join(' '));

  const last = await prisma.document.findFirst({
    where: { projectId, type: 'production' },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;
  const notes = input.notes?.trim() || null;

  const pdf = await renderProductionDocument(projectId, userId, { version, notes });

  const pdfObjectKey = buildObjectKey({
    userId,
    projectId,
    fileId: `production-v${version}`,
    category: 'documents',
    mimeType: 'application/pdf',
  });
  const { putObject } = await import('@/lib/storage/r2');
  await putObject(pdfObjectKey, pdf, 'application/pdf');

  const [drawing, spec] = await Promise.all([
    latestDrawing(projectId),
    getSpec(projectId, userId),
  ]);

  const [created] = await Promise.all([
    prisma.document.create({
      data: {
        projectId,
        type: 'production',
        version,
        notes,
        pdfObjectKey,
        // Recorded so a sheet on a bench can be traced to the project state
        // behind it, without re-deriving it from timestamps.
        sourceSnapshot: {
          specVersion: spec.version > 0 ? spec.version : null,
          specApproved: spec.status === 'approved',
          drawingVersion: drawing?.version ?? null,
          calculatedMaterialCount: view.available.calculatedMaterialCount,
          cuttingPlanCount: view.available.cuttingPlanCount,
          gaps: view.gaps,
        } as unknown as object,
      },
    }),
    // The project has reached the production stage. Never moved backwards.
    prisma.project.updateMany({
      where: { id: projectId, status: { in: ['intake', 'spec_approved', 'calculated', 'quoted'] } },
      data: { status: 'production_ready' },
    }),
  ]);

  return created;
}

/** A short-lived signed URL for a stored package. */
export async function productionDownloadUrl(
  documentId: string,
  userId: string
): Promise<string> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw notFound('Document');
  await assertProjectAccess(document.projectId, userId);

  if (!document.pdfObjectKey) {
    throw new ApiError(404, 'This package has no stored document.', 'not_found');
  }

  const { createSignedDownloadUrl } = await import('@/lib/storage/r2');
  return createSignedDownloadUrl(document.pdfObjectKey, {
    downloadName: `production-v${document.version}.pdf`,
  });
}
