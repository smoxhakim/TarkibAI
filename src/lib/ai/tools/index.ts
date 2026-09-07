import { z } from 'zod';
import { projectSpecPatchSchema } from '@/lib/spec/schema';
import { getSpec, updateDraftSpec } from '@/lib/spec/service';
import { getScene } from '@/lib/canvas/service';
import { sceneCommandSchema } from '@/lib/canvas/schema';
import { createProposal } from '@/lib/design/service';
import { getRecommendations } from '@/lib/calc/efficiency/service';

/**
 * The agent's tool surface.
 *
 * Two properties matter more than anything else here:
 *
 * 1. `projectId` and `userId` are NOT tool parameters. They are bound by the
 *    caller when the toolbox is constructed, from the server-side Clerk
 *    session. The model therefore cannot address a different project or claim a
 *    different identity, no matter what it emits (ARCHITECTURE §4.4, §19).
 *
 * 2. Every tool validates its arguments with the same Zod schemas the HTTP
 *    routes use, and executes through the same service layer, so an AI-driven
 *    write passes through the identical ownership and validation checks as a
 *    direct API call (§7).
 *
 * There is deliberately NO approval tool, and no tool that mutates the canvas
 * directly. The agent can read the scene and PROPOSE changes; a proposal does
 * nothing until a person approves it in the UI.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (rawArgs: unknown) => Promise<unknown>;
};

export type ToolInvocation = { name: string; arguments: unknown };

const emptyObjectSchema = z.object({}).strict();

/** Validates what the model sends to propose_design_change. */
const proposeSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  commands: z.array(sceneCommandSchema).min(1).max(20),
  specPatch: projectSpecPatchSchema.nullable().optional(),
});

/** Zod -> JSON Schema for the two shapes we expose, written explicitly for clarity. */
const SPEC_PATCH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectType: { type: ['string', 'null'], description: 'e.g. enseigne, façade, totem, caisson lumineux, lettres 3D' },
    industry: { type: ['string', 'null'] },
    dimensions: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        width: { type: ['number', 'null'] },
        height: { type: ['number', 'null'] },
        depth: { type: ['number', 'null'] },
        unit: { type: ['string', 'null'], enum: ['mm', 'cm', 'm', null] },
      },
    },
    quantity: { type: ['integer', 'null'] },
    components: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string' },
          quantity: { type: ['integer', 'null'] },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    materials: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string' },
          appliesTo: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    lighting: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        type: { type: ['string', 'null'], enum: ['none', 'led', 'neon', 'backlit', 'frontlit', 'halo', 'other', null] },
        details: { type: ['string', 'null'] },
      },
    },
    mounting: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        method: { type: ['string', 'null'] },
        surface: { type: ['string', 'null'] },
        heightFromGroundM: { type: ['number', 'null'] },
      },
    },
    site: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        environment: { type: ['string', 'null'], enum: ['indoor', 'outdoor', null] },
        locationText: { type: ['string', 'null'] },
      },
    },
    lettering: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        text: { type: ['string', 'null'] },
        style: { type: ['string', 'null'] },
        colors: { type: ['array', 'null'], items: { type: 'string' } },
      },
    },
    finishNotes: { type: ['string', 'null'] },
    deadline: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
} as const;

const SCENE_OBJECT_FIELDS = {
  type: { type: 'string', enum: ['panel', 'frame', 'lettering', 'light', 'note'] },
  label: { type: ['string', 'null'] },
  x: { type: 'integer', description: 'Millimetres from the scene origin.' },
  y: { type: 'integer', description: 'Millimetres from the scene origin.' },
  widthMm: { type: 'integer' },
  heightMm: { type: 'integer' },
  rotationDeg: { type: 'integer' },
  materialId: { type: ['string', 'null'], description: 'Id from the user material library.' },
  notes: { type: ['string', 'null'] },
  showDimensions: { type: 'boolean' },
} as const;

const PROPOSE_DESIGN_CHANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'commands'],
  properties: {
    summary: {
      type: 'string',
      description:
        "One or two sentences, in the user's language, describing exactly what will change and by how much. This is what the user reads before approving.",
    },
    commands: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['add_object', 'update_object', 'remove_object'] },
          id: { type: 'string', description: 'Target object id, for update_object and remove_object.' },
          object: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'x', 'y', 'widthMm', 'heightMm'],
            properties: { id: { type: 'string' }, ...SCENE_OBJECT_FIELDS },
            description: 'The new object, for add_object.',
          },
          changes: {
            type: 'object',
            additionalProperties: false,
            properties: SCENE_OBJECT_FIELDS,
            description:
              'Fields to change, for update_object. Omitted fields keep their current value.',
          },
        },
      },
    },
    specPatch: {
      type: ['object', 'null'],
      description:
        'Include ONLY when the change alters an agreed project fact such as an overall dimension. Approving then creates a new draft specification the user still has to approve separately.',
      additionalProperties: true,
    },
  },
} as const;

export function buildToolbox(projectId: string, userId: string): ToolDefinition[] {
  return [
    {
      name: 'get_project_spec',
      description:
        'Read the project specification currently recorded, together with the list of required fields still missing. Use this to check state before answering.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async (rawArgs) => {
        emptyObjectSchema.parse(rawArgs ?? {});
        const view = await getSpec(projectId, userId);
        return { spec: view.spec, missing: view.missing, complete: view.complete, status: view.status };
      },
    },
    {
      name: 'get_canvas',
      description:
        'Read the project canvas: every object with its id, type, label, position and size in millimetres. Call this before proposing a change so you target the right object and know its current dimensions.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async (rawArgs) => {
        emptyObjectSchema.parse(rawArgs ?? {});
        const view = await getScene(projectId, userId);
        return {
          objects: view.scene.objects,
          diverged: view.diverged,
          seedBlockedReason: view.seedBlockedReason,
        };
      },
    },
    {
      name: 'get_material_recommendations',
      description:
        'Read material efficiency recommendations for this project: cheaper stock sizes from the user\'s own material library, with the real saving in sheets or bars, waste and cost. These are COMPUTED by the cutting engines — report the numbers exactly as given and never estimate a saving yourself. You cannot apply one; the user applies it in the interface.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async (rawArgs) => {
        emptyObjectSchema.parse(rawArgs ?? {});
        const result = await getRecommendations(projectId, userId);
        return {
          recommendations: result.recommendations,
          emptyReason: result.emptyReason,
          note: 'Computed by the cutting engines. Report these figures exactly; do not calculate your own. The user applies a recommendation in the interface.',
        };
      },
    },
    {
      name: 'propose_design_change',
      description:
        'Propose a change to the canvas for the user to approve. This does NOT change anything by itself — the user must approve it in the interface. Always read the canvas first, compute the new value from the object\'s CURRENT dimensions, and state the exact result in the summary.',
      parameters: PROPOSE_DESIGN_CHANGE_SCHEMA as unknown as Record<string, unknown>,
      execute: async (rawArgs) => {
        const parsed = proposeSchema.parse(rawArgs ?? {});
        const proposal = await createProposal(projectId, userId, {
          summary: parsed.summary,
          commands: parsed.commands,
          specPatch: parsed.specPatch ?? null,
        });
        return {
          proposalId: proposal.id,
          status: proposal.status,
          // Told plainly so the agent does not report the change as done.
          note: 'Proposal recorded. Nothing has changed yet — the user must approve it in the interface.',
        };
      },
    },
    {
      name: 'update_project_spec',
      description:
        'Record information the user has actually stated. Send only the fields they gave you; omitted fields keep their current values. Send null to clear a field the user retracted. Never send a value the user did not state.',
      parameters: SPEC_PATCH_JSON_SCHEMA as unknown as Record<string, unknown>,
      execute: async (rawArgs) => {
        const patch = projectSpecPatchSchema.parse(rawArgs ?? {});
        const view = await updateDraftSpec(projectId, userId, patch);
        return { spec: view.spec, missing: view.missing, complete: view.complete };
      },
    },
  ];
}
