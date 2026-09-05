import { z } from 'zod';
import { projectSpecPatchSchema } from '@/lib/spec/schema';
import { getSpec, updateDraftSpec } from '@/lib/spec/service';

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
 * There is deliberately NO approval tool. Approval is a user action.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (rawArgs: unknown) => Promise<unknown>;
};

export type ToolInvocation = { name: string; arguments: unknown };

const emptyObjectSchema = z.object({}).strict();

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
