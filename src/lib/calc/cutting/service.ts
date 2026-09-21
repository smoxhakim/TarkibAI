import { prisma } from '@/lib/db';
import { badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess, assertProjectPermission } from '@/lib/projects/service';
import { assertMaterialAccess } from '@/lib/materials/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { buildObjectKey } from '@/lib/storage/keys';
import type { CuttingPiece, CuttingPlan } from '@/generated/prisma/client';
import { calculateCuttingPlan, type CuttingResult } from './engine';
import { renderCuttingPlan } from './render';
import { calculateLinearPlan, type LinearResult } from './linear';
import { renderLinearPlan } from './linear-render';
import {
  readCutDefaults,
  readMinUsableRemnant,
  type CuttingPieceInputPayload,
  type LinearCutInputPayload,
} from './schema';

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
  // A piece list is PROJECT-scoped fabrication state, so `project.edit` — the
  // same permission the project's material lines take. Not `material.manage`:
  // nothing here writes the shared catalogue, and gating on it would stop a
  // designer or a salesperson saying how a facade divides into panels, which
  // the schema is explicit is theirs to decide.
  await assertProjectPermission(projectId, userId, 'project.edit');
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
  // BEFORE the row is loaded. Authorising afterwards would answer 404 for an
  // id that does not exist and 403 for one that does, which tells a caller who
  // may not touch the piece list what is in it.
  await assertProjectPermission(projectId, userId, 'project.edit');
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
    where: { projectId, kind: 'sheet' },
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
  // Writes the plan row and its stored diagram, so `project.edit`.
  //
  // Deliberately NOT `cost.view`. A layout has no money in it — sheets, waste
  // and areas — and production, the role that actually cuts, does not hold
  // cost visibility. Requiring it would refuse the operation to the people
  // whose work it is, to protect a figure this function never produces.
  await assertProjectPermission(projectId, userId, 'project.edit');
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
      stockSizeLabel: `${material.sheetWidthMm} × ${material.sheetHeightMm} mm`,
      kind: 'sheet',
      layoutData: result as unknown as object,
      stockUnitsUsed: result.sheetsUsed,
      wastePercent: result.wastePercent,
      kerfMm,
      edgeMarginMm,
      diagramObjectKey,
      unplacedCount,
    },
    create: {
      projectId,
      materialId: input.materialId,
      stockSizeLabel: `${material.sheetWidthMm} × ${material.sheetHeightMm} mm`,
      kind: 'sheet',
      layoutData: result as unknown as object,
      stockUnitsUsed: result.sheetsUsed,
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
  diagramId: string,
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
      fileId: `cutting-${diagramId}`,
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

/* -------------------------------------------------------------------------- */
/* Linear cuts                                                                 */
/* -------------------------------------------------------------------------- */

export async function listLinearCuts(projectId: string, userId: string) {
  await assertProjectAccess(projectId, userId);
  return prisma.linearCut.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
}

export async function addLinearCut(
  projectId: string,
  userId: string,
  input: LinearCutInputPayload
) {
  // The 1D counterpart of `addPiece`, and the same permission.
  await assertProjectPermission(projectId, userId, 'project.edit');
  const material = await assertMaterialAccess(input.materialId, userId);

  if (material.measurementModel !== 'linear') {
    throw badRequest('Cut lists apply to linear stock — bars, tubes and profiles.');
  }

  await prisma.linearCut.create({
    data: {
      projectId,
      materialId: input.materialId,
      label: input.label ?? null,
      lengthMm: input.lengthMm,
      quantity: input.quantity,
    },
  });

  return listLinearCuts(projectId, userId);
}

export async function removeLinearCut(projectId: string, userId: string, cutId: string) {
  // Before the row is loaded, for the same reason as `removePiece`.
  await assertProjectPermission(projectId, userId, 'project.edit');
  const row = await prisma.linearCut.findUnique({ where: { id: cutId } });
  if (!row || row.projectId !== projectId) throw notFound('Cut');
  await prisma.linearCut.delete({ where: { id: row.id } });
}

export type LinearPlanView = {
  plan: CuttingPlan | null;
  result: LinearResult | null;
  svg: string;
};

function readLinearResult(value: unknown): LinearResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Partial<LinearResult>;
  if (!Array.isArray(record.bars) || !record.settings) return null;
  return record as LinearResult;
}

export async function listLinearPlans(projectId: string, userId: string): Promise<LinearPlanView[]> {
  await assertProjectAccess(projectId, userId);
  const plans = await prisma.cuttingPlan.findMany({
    where: { projectId, kind: 'linear' },
    orderBy: { createdAt: 'asc' },
  });

  return plans.map((plan) => {
    const result = readLinearResult(plan.layoutData);
    return { plan, result, svg: result ? renderLinearPlan(result) : '' };
  });
}

/**
 * Computes and stores the cut plan for one linear material.
 *
 * This is the authoritative bar count. The T4 material calculation divides total
 * length by bar length, which under-counts whenever cut lengths do not pack
 * neatly, and now says so.
 */
export async function calculateLinearCutPlan(
  projectId: string,
  userId: string,
  input: { materialId: string; kerfMm?: number; minUsableRemnantMm?: number }
): Promise<LinearPlanView> {
  // The same write boundary as `calculatePlan`: it upserts the same
  // `CuttingPlan` table on the same key. Gating one and not the other would
  // mean a caller refused a sheet layout could still write a bar layout.
  await assertProjectPermission(projectId, userId, 'project.edit');
  const material = await assertMaterialAccess(input.materialId, userId);

  if (material.measurementModel !== 'linear') {
    throw badRequest('This material is not linear stock.');
  }
  if (!material.standardLengthMm) {
    throw badRequest('This material has no standard bar length, so a cut plan cannot be computed.');
  }

  const cuts = await prisma.linearCut.findMany({
    where: { projectId, materialId: input.materialId },
  });
  if (cuts.length === 0) {
    throw badRequest('Add the cut lengths for this material before generating a plan.');
  }

  const defaults = readCutDefaults(material.technicalProperties);
  const kerfMm = input.kerfMm ?? defaults.kerfMm;
  const minUsableRemnantMm =
    input.minUsableRemnantMm ?? readMinUsableRemnant(material.technicalProperties);

  const result = calculateLinearPlan(
    cuts.map((row) => ({
      id: row.id,
      label: row.label,
      lengthMm: row.lengthMm,
      quantity: row.quantity,
    })),
    { stockLengthMm: material.standardLengthMm, kerfMm, minUsableRemnantMm }
  );

  const svg = renderLinearPlan(result);
  const diagramObjectKey = await renderDiagramToStorage(
    projectId,
    userId,
    `linear-${input.materialId}`,
    svg
  );

  const unplacedCount = result.unplaced.reduce((sum, row) => sum + row.quantity, 0);
  const stockLabel = `${Number((material.standardLengthMm / 1000).toFixed(3))} m bar`;

  const plan = await prisma.cuttingPlan.upsert({
    where: { projectId_materialId: { projectId, materialId: input.materialId } },
    update: {
      kind: 'linear',
      stockSizeLabel: stockLabel,
      layoutData: result as unknown as object,
      stockUnitsUsed: result.barsUsed,
      wastePercent: result.wastePercent,
      kerfMm,
      edgeMarginMm: 0,
      diagramObjectKey,
      unplacedCount,
    },
    create: {
      projectId,
      materialId: input.materialId,
      kind: 'linear',
      stockSizeLabel: stockLabel,
      layoutData: result as unknown as object,
      stockUnitsUsed: result.barsUsed,
      wastePercent: result.wastePercent,
      kerfMm,
      // Edge margin has no meaning for linear stock.
      edgeMarginMm: 0,
      diagramObjectKey,
      unplacedCount,
    },
  });

  return { plan, result, svg };
}
