import { ApiError } from '@/lib/http/api';
import {
  SCENE_VERSION,
  type CanvasSceneData,
  type SceneCommand,
  type SceneObject,
} from './schema';

/**
 * Pure scene mutation. No I/O, no randomness beyond an injectable id factory,
 * so the whole command layer is unit-testable and deterministic.
 *
 * This is the single path by which a scene changes. The edit panel uses it now;
 * the AI design tools in T7 will call exactly the same commands, so the agent
 * inherits this validation rather than getting a parallel route into the data.
 */
export type IdFactory = () => string;

const defaultIdFactory: IdFactory = () => crypto.randomUUID();

const objectNotFound = (id: string) =>
  new ApiError(404, `No canvas object with id ${id}.`, 'object_not_found');

/** Applies one command, returning a NEW scene. The input is never mutated. */
export function applySceneCommand(
  scene: CanvasSceneData,
  command: SceneCommand,
  makeId: IdFactory = defaultIdFactory
): CanvasSceneData {
  switch (command.kind) {
    case 'add_object': {
      const id = command.object.id ?? makeId();
      if (scene.objects.some((object) => object.id === id)) {
        throw new ApiError(409, `A canvas object with id ${id} already exists.`, 'duplicate_object');
      }
      const object: SceneObject = { ...command.object, id };
      return { sceneVersion: SCENE_VERSION, objects: [...scene.objects, object] };
    }

    case 'update_object': {
      const index = scene.objects.findIndex((object) => object.id === command.id);
      if (index === -1) throw objectNotFound(command.id);

      const objects = [...scene.objects];
      // Omitted fields keep their value, so a command that changes only width
      // cannot silently erase a label or a material link.
      const changes = Object.fromEntries(
        Object.entries(command.changes).filter(([, value]) => value !== undefined)
      );
      objects[index] = { ...objects[index], ...changes, id: command.id };
      return { sceneVersion: SCENE_VERSION, objects };
    }

    case 'remove_object': {
      if (!scene.objects.some((object) => object.id === command.id)) {
        throw objectNotFound(command.id);
      }
      return {
        sceneVersion: SCENE_VERSION,
        objects: scene.objects.filter((object) => object.id !== command.id),
      };
    }

    default: {
      // Exhaustiveness guard: adding a command kind without handling it fails
      // to compile rather than silently doing nothing.
      const exhaustive: never = command;
      throw new Error(`Unhandled scene command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function applySceneCommands(
  scene: CanvasSceneData,
  commands: SceneCommand[],
  makeId: IdFactory = defaultIdFactory
): CanvasSceneData {
  return commands.reduce((current, command) => applySceneCommand(current, command, makeId), scene);
}

/* -------------------------------------------------------------------------- */
/* Seeding from the approved specification                                     */
/* -------------------------------------------------------------------------- */

export type SeedSpec = {
  projectType?: string | null;
  dimensions?: {
    width?: number | null;
    height?: number | null;
    unit?: 'mm' | 'cm' | 'm' | null;
  } | null;
  lettering?: { text?: string | null } | null;
};

const UNIT_TO_MM: Record<'mm' | 'cm' | 'm', number> = { mm: 1, cm: 10, m: 1000 };

/**
 * Builds a starting scene from the approved specification.
 *
 * This derives ONLY from dimensions the user actually stated — it does not
 * invent a frame, a thickness, or a layout the specification never described.
 * Returns null when the spec lacks the width and height needed to draw
 * anything truthful.
 */
export function seedSceneFromSpec(spec: SeedSpec, makeId: IdFactory = defaultIdFactory): CanvasSceneData | null {
  const dimensions = spec.dimensions;
  const unit = dimensions?.unit;
  if (!dimensions?.width || !dimensions?.height || !unit) return null;

  const factor = UNIT_TO_MM[unit];
  const widthMm = Math.round(dimensions.width * factor);
  const heightMm = Math.round(dimensions.height * factor);
  if (widthMm <= 0 || heightMm <= 0) return null;

  const objects: SceneObject[] = [
    {
      id: makeId(),
      type: 'panel',
      label: spec.projectType ?? 'Main face',
      x: 0,
      y: 0,
      widthMm,
      heightMm,
      rotationDeg: 0,
      materialId: null,
      notes: null,
      showDimensions: true,
    },
  ];

  // Lettering is added only when the specification actually records text.
  const letteringText = spec.lettering?.text?.trim();
  if (letteringText) {
    objects.push({
      id: makeId(),
      type: 'lettering',
      label: letteringText,
      // Centred horizontally at 40% height, a neutral placement the user can
      // move. Deliberately simple: the spec says nothing about where the
      // lettering sits, so nothing here pretends to know.
      x: Math.round(widthMm * 0.15),
      y: Math.round(heightMm * 0.35),
      widthMm: Math.max(1, Math.round(widthMm * 0.7)),
      heightMm: Math.max(1, Math.round(heightMm * 0.3)),
      rotationDeg: 0,
      materialId: null,
      notes: null,
      showDimensions: false,
    });
  }

  return { sceneVersion: SCENE_VERSION, objects };
}
