import { prisma } from '@/lib/db';
import { badRequest } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { applySceneCommands, seedSceneFromSpec } from './commands';
import { emptyScene, parseScene, type CanvasSceneData, type SceneCommand } from './schema';

export type SceneView = {
  scene: CanvasSceneData;
  specVersionAtSeed: number | null;
  /**
   * True when a newer specification has been approved since the scene was
   * seeded. The spec remains the source of truth (PRD §9); the canvas says so
   * rather than silently presenting stale geometry as the project.
   */
  diverged: boolean;
  /** Present when the project has no approved spec to seed from yet. */
  seedBlockedReason: string | null;
  updatedAt: Date | null;
};

async function approvedSpec(projectId: string) {
  return prisma.projectSpec.findFirst({
    where: { projectId, status: 'approved' },
    orderBy: { version: 'desc' },
  });
}

export async function getScene(projectId: string, userId: string): Promise<SceneView> {
  await assertProjectAccess(projectId, userId);

  const [row, spec] = await Promise.all([
    prisma.canvasScene.findUnique({ where: { projectId } }),
    approvedSpec(projectId),
  ]);

  return {
    scene: row ? parseScene(row.data) : emptyScene(),
    specVersionAtSeed: row?.specVersionAtSeed ?? null,
    diverged:
      row !== null &&
      spec !== null &&
      row.specVersionAtSeed !== null &&
      spec.version > row.specVersionAtSeed,
    seedBlockedReason: spec
      ? null
      : 'Approve the project specification before building the canvas from it.',
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * Builds (or rebuilds) the scene from the approved specification.
 *
 * Only dimensions the user actually stated are used. If the spec has no width,
 * height or unit there is nothing truthful to draw, and the caller is told so
 * rather than being given a placeholder rectangle.
 */
export async function seedScene(projectId: string, userId: string): Promise<SceneView> {
  await assertProjectAccess(projectId, userId);

  const spec = await approvedSpec(projectId);
  if (!spec) {
    throw badRequest('Approve the project specification before building the canvas from it.');
  }

  const seeded = seedSceneFromSpec(spec.data as Parameters<typeof seedSceneFromSpec>[0]);
  if (!seeded) {
    throw badRequest(
      'The approved specification has no width, height and unit, so there is nothing to draw yet.'
    );
  }

  await prisma.canvasScene.upsert({
    where: { projectId },
    update: { data: seeded, specVersionAtSeed: spec.version },
    create: { projectId, data: seeded, specVersionAtSeed: spec.version },
  });

  return getScene(projectId, userId);
}

/**
 * Applies validated commands to the scene.
 *
 * The same entry point the AI design tools will use in T7, so an agent-driven
 * change passes through identical ownership checks and identical validation as
 * a change made in the edit panel (ARCHITECTURE §7).
 */
export async function applyCommands(
  projectId: string,
  userId: string,
  commands: SceneCommand[]
): Promise<SceneView> {
  await assertProjectAccess(projectId, userId);

  const row = await prisma.canvasScene.findUnique({ where: { projectId } });
  const current = row ? parseScene(row.data) : emptyScene();

  // Commands are applied in memory first: an invalid command in the middle of a
  // batch throws before anything is written, so the stored scene is never left
  // half-updated.
  const next = applySceneCommands(current, commands);

  const spec = await approvedSpec(projectId);
  await prisma.canvasScene.upsert({
    where: { projectId },
    update: { data: next },
    create: { projectId, data: next, specVersionAtSeed: spec?.version ?? null },
  });

  return getScene(projectId, userId);
}
