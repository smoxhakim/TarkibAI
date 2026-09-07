import { prisma } from '@/lib/db';
import { badRequest } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { getScene } from '@/lib/canvas/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { buildObjectKey } from '@/lib/storage/keys';
import type { Diagram } from '@/generated/prisma/client';
import { projectViews, VIEW_KINDS, type ViewKind } from './project';
import { renderDrawingSheet } from './render';

/**
 * Technical drawings.
 *
 * The workspace renders LIVE from current data, so what is on screen can never
 * be stale. Issuing a drawing stores a numbered snapshot, which is what a
 * production document must point at — a workshop needs the drawing it was
 * actually given, not one that has moved on since.
 */
export type LiveDrawing = {
  svg: string;
  views: {
    kind: ViewKind;
    available: boolean;
    unavailableReason: string | null;
    omittedCount: number;
  }[];
  sceneEmpty: boolean;
};

/** Material id → name, so parts can carry a material annotation. */
async function materialNames(userId: string): Promise<Record<string, string>> {
  const materials = await prisma.material.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  return Object.fromEntries(materials.map((material) => [material.id, material.name]));
}

async function projectTitle(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { title: true },
  });
  return project?.title ?? 'Project';
}

export async function renderLiveDrawing(
  projectId: string,
  userId: string,
  kinds: ViewKind[] = [...VIEW_KINDS]
): Promise<LiveDrawing> {
  await assertProjectAccess(projectId, userId);

  const [sceneView, materials, title] = await Promise.all([
    getScene(projectId, userId),
    materialNames(userId),
    projectTitle(projectId),
  ]);

  const views = projectViews(sceneView.scene, kinds);
  const svg = renderDrawingSheet(views, { title, materials });

  return {
    svg,
    views: views.map((view) => ({
      kind: view.kind,
      available: view.unavailableReason === null,
      unavailableReason: view.unavailableReason,
      omittedCount: view.omitted.length,
    })),
    sceneEmpty: sceneView.scene.objects.length === 0,
  };
}

export async function listIssuedDrawings(projectId: string, userId: string): Promise<Diagram[]> {
  await assertProjectAccess(projectId, userId);
  return prisma.diagram.findMany({ where: { projectId }, orderBy: { version: 'desc' } });
}

/**
 * Issues a numbered drawing.
 *
 * The rendered SVG is stored as text rather than regenerated on read, so an
 * issued drawing stays byte-identical even if the renderer changes later. That
 * is the whole point of issuing one: the copy in the workshop and the copy in
 * the record must be the same drawing.
 */
export async function issueDrawing(
  projectId: string,
  userId: string,
  input: { kinds?: ViewKind[]; label?: string | null } = {}
): Promise<Diagram> {
  await assertProjectAccess(projectId, userId);

  const kinds = input.kinds && input.kinds.length > 0 ? input.kinds : [...VIEW_KINDS];
  const [sceneView, materials, title] = await Promise.all([
    getScene(projectId, userId),
    materialNames(userId),
    projectTitle(projectId),
  ]);

  if (sceneView.scene.objects.length === 0) {
    throw badRequest('The canvas is empty, so there is nothing to draw. Build the canvas first.');
  }

  const views = projectViews(sceneView.scene, kinds);
  if (views.every((view) => view.unavailableReason !== null)) {
    throw badRequest(
      'None of the selected views can be drawn from the current canvas. Add depth to the parts that need it, or select the front view.'
    );
  }

  const last = await prisma.diagram.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  const svg = renderDrawingSheet(views, {
    title,
    materials,
    reference: `Drawing ${version}`,
  });

  const imageObjectKey = await rasteriseToStorage(projectId, userId, version, svg);

  return prisma.diagram.create({
    data: {
      projectId,
      version,
      views: kinds as unknown as object,
      svg,
      // Recorded so an issued drawing can be traced back to the exact project
      // state that produced it.
      sourceSnapshot: {
        scene: sceneView.scene,
        specVersionAtSeed: sceneView.specVersionAtSeed,
        diverged: sceneView.diverged,
      } as unknown as object,
      imageObjectKey,
      label: input.label ?? null,
    },
  });
}

/** PNG for production documents; failure is non-fatal since the SVG is stored. */
async function rasteriseToStorage(
  projectId: string,
  userId: string,
  version: number,
  svg: string
): Promise<string | null> {
  if (!isStorageConfigured()) return null;

  try {
    const [{ default: sharp }, { putObject }] = await Promise.all([
      import('sharp'),
      import('@/lib/storage/r2'),
    ]);

    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const objectKey = buildObjectKey({
      userId,
      projectId,
      fileId: `drawing-v${version}`,
      category: 'diagrams',
      mimeType: 'image/png',
    });

    await putObject(objectKey, png, 'image/png');
    return objectKey;
  } catch (error) {
    console.error('[drawings] could not rasterise the drawing', error);
    return null;
  }
}
