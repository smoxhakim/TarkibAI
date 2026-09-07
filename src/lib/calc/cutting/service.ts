import { prisma } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { assertMaterialAccess } from '@/lib/materials/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { buildObjectKey } from '@/lib/storage/keys';
import type { CuttingPiece, CuttingPlan } from '@/generated/prisma/client';
import { calculateCuttingPlan, type CuttingResult } from './engine';
import { renderCuttingPlan } from './render';
import { readCutDefaults, type CuttingPieceInputPayload } from './schema';

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

export async function listPieces(projectId: string, userId: string): Promise<CuttingPiece[]> {
  await assertProjectAccess(projectId, userId);
  return prisma.cuttingPiece.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
}

export async function addPiece(
  projectId: string,
  userId: string,
  input: CuttingPieceInputPayload
): Promise<CuttingPiece[]> {
  await assertProjectAccess(projectId, userId);
  // Scopes the material to this user, so a project cannot reference someone
  // else's library entry.
  const material = await assertMaterialAccess(input.materialId, userId);

  if (material.measurementModel !== 'sheet') {
    throw badRequest(
      'Cutting plans are only supported for sheet materials. Linear stock optimisation is a later milestone.'
    );
  }

  await prisma.cuttingPiece.create({
    data: {
      projectId,
      materialId: input.materialId,
      label: input.label ?? null,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      quantity: input.quantity,
      allowRotation: input.allowRotation,
    },
  });

  return listPieces(projectId, userId);
}

export async function removePiece(
  projectId: string,
  userId: string,
  pieceId: string
): Promise<void> {
  await assertProjectAccess(projectId, userId);
  const row = await prisma.cuttingPiece.findUnique({ where: { id: pieceId } });
  if (!row || row.projectId !== projectId) throw notFound('Cutting piece');
  await prisma.cuttingPiece.delete({ where: { id: row.id } });
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                       */
/* -------------------------------------------------------------------------- */

export type PlanView = {
  plan: CuttingPlan | null;
  result: CuttingResult | null;
  svg: string;
};

/** Reads a stored layout back into the engine's result shape. */
function readResult(value: unknown): CuttingResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Partial<CuttingResult>;
  if (!Array.isArray(record.sheets) || !record.settings) return null;
  return record as CuttingResult;
}

export async function listPlans(projectId: string, userId: string): Promise<PlanView[]> {
  await assertProjectAccess(projectId, userId);
  const plans = await prisma.cuttingPlan.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });

  return plans.map((plan) => {
    const result = readResult(plan.layoutData);
    return { plan, result, svg: result ? renderCuttingPlan(result) : '' };
  });
}

/**
 * Computes and stores the cutting plan for one sheet material.
 *
 * The plan is stored even when some pieces could not be placed: the unplaced
 * list and its reasons are more useful than an error, and silently dropping a
 * piece would be far worse.
 */
export async function calculatePlan(
  projectId: string,
  userId: string,
  input: { materialId: string; kerfMm?: number; edgeMarginMm?: number }
): Promise<PlanView> {
  await assertProjectAccess(projectId, userId);
  const material = await assertMaterialAccess(input.materialId, userId);

  if (material.measurementModel !== 'sheet') {
    throw badRequest('Cutting plans are only supported for sheet materials.');
  }
  if (!material.sheetWidthMm || !material.sheetHeightMm) {
    throw badRequest('This material has no stock sheet size, so a layout cannot be computed.');
  }

  const pieces = await prisma.cuttingPiece.findMany({
    where: { projectId, materialId: input.materialId },
  });
  if (pieces.length === 0) {
    throw badRequest('Add the pieces to cut from this material before generating a plan.');
  }

  const defaults = readCutDefaults(material.technicalProperties);
  const kerfMm = input.kerfMm ?? defaults.kerfMm;
  const edgeMarginMm = input.edgeMarginMm ?? defaults.edgeMarginMm;

  const result = calculateCuttingPlan(
    pieces.map((piece) => ({
      id: piece.id,
      label: piece.label,
      widthMm: piece.widthMm,
      heightMm: piece.heightMm,
      quantity: piece.quantity,
      allowRotation: piece.allowRotation,
    })),
    {
      sheetWidthMm: material.sheetWidthMm,
      sheetHeightMm: material.sheetHeightMm,
      kerfMm,
      edgeMarginMm,
    }
  );

  const svg = renderCuttingPlan(result);
  const diagramObjectKey = await renderDiagramToStorage(projectId, userId, input.materialId, svg);

  const unplacedCount = result.unplaced.reduce((sum, piece) => sum + piece.quantity, 0);

  const plan = await prisma.cuttingPlan.upsert({
    where: { projectId_materialId: { projectId, materialId: input.materialId } },
    update: {
      sheetSizeLabel: `${material.sheetWidthMm} × ${material.sheetHeightMm} mm`,
      layoutData: result as unknown as object,
      sheetsUsed: result.sheetsUsed,
      wastePercent: result.wastePercent,
      kerfMm,
      edgeMarginMm,
      diagramObjectKey,
      unplacedCount,
    },
    create: {
      projectId,
      materialId: input.materialId,
      sheetSizeLabel: `${material.sheetWidthMm} × ${material.sheetHeightMm} mm`,
      layoutData: result as unknown as object,
      sheetsUsed: result.sheetsUsed,
      wastePercent: result.wastePercent,
      kerfMm,
      edgeMarginMm,
      diagramObjectKey,
      unplacedCount,
    },
  });

  return { plan, result, svg };
}

/**
 * Rasterises the diagram to PNG and stores it in R2.
 *
 * A PNG is needed because the PDF renderer used for production documents cannot
 * lay out arbitrary SVG. Failure here is deliberately non-fatal: the plan and
 * its in-app SVG are the real output, and losing the raster should not lose the
 * calculation.
 */
async function renderDiagramToStorage(
  projectId: string,
  userId: string,
  materialId: string,
  svg: string
): Promise<string | null> {
  if (!svg || !isStorageConfigured()) return null;

  try {
    const [{ default: sharp }, { putObject }] = await Promise.all([
      import('sharp'),
      import('@/lib/storage/r2'),
    ]);

    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const objectKey = buildObjectKey({
      userId,
      projectId,
      fileId: `cutting-${materialId}`,
      category: 'cutting-plans',
      mimeType: 'image/png',
    });

    await putObject(objectKey, png, 'image/png');
    return objectKey;
  } catch (error) {
    console.error('[cutting] could not render the plan diagram to PNG', error);
    return null;
  }
}
