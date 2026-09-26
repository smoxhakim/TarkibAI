/**
 * JSON Schemas for the tool arguments the model may send.
 *
 * Written out by hand rather than generated from the Zod schemas: these are the
 * contract the MODEL reads, and their descriptions are instructions — "whole
 * millimetres", "only fields the user stated" — that a generator would drop.
 * Every one of them is re-validated with the matching Zod schema before it
 * reaches a service, so a schema that drifts from its validator fails loudly at
 * the tool boundary instead of writing something unexpected.
 */
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

export { SPEC_PATCH_JSON_SCHEMA, PROPOSE_DESIGN_CHANGE_SCHEMA };

/** Mirrors `materialQuerySchema`; archived stock is never offered to the model. */
const MATERIAL_QUERY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    search: {
      type: 'string',
      description:
        'Free text matched against name, supplier and notes. Use the word the user used: "alucobond", "inox", "MDF".',
    },
    category: { type: 'string' },
    measurementModel: {
      type: 'string',
      enum: ['linear', 'sheet', 'area', 'piece'],
      description: 'sheet for panels, linear for bars and profiles, area for goods sold by m², piece for items.',
    },
  },
} as const;

export { MATERIAL_QUERY_JSON_SCHEMA };

/**
 * Creating a draft quotation (T22.3).
 *
 * Only the CLIENT and the wording are the model's to supply. The lines, prices,
 * tax, total, currency, number and status are all decided by `createQuote` from
 * the project's cost calculation, so none of them is a parameter — the model has
 * no way to state a price even if it wanted to.
 *
 * Mirrors `createQuoteSchema` in `src/lib/quotes/schema.ts`, which re-validates
 * every call. `confirmed` is the one field that schema does not have.
 */
const CREATE_QUOTE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clientName', 'confirmed'],
  properties: {
    clientName: {
      type: 'string',
      description: 'The client the quotation is addressed to, exactly as the user gave it. Never invented.',
    },
    clientAddress: { type: ['string', 'null'] },
    clientPhone: { type: ['string', 'null'] },
    clientEmail: { type: ['string', 'null'] },
    title: {
      type: ['string', 'null'],
      description: 'A heading for the quotation. Omit it to use the project title.',
    },
    description: { type: ['string', 'null'] },
    confirmed: {
      type: 'boolean',
      description:
        'false to PREVIEW: nothing is created, and you show the user what would be. true to CREATE — only after the user has explicitly agreed to that preview in their reply, and with exactly the same details. A true call without that preview in your previous turn is refused.',
    },
  },
} as const;

export { CREATE_QUOTE_JSON_SCHEMA };
