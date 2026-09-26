import { z } from 'zod';
import { projectSpecPatchSchema } from '@/lib/spec/schema';
import { getSpec, updateDraftSpec } from '@/lib/spec/service';
import { getScene } from '@/lib/canvas/service';
import { sceneCommandSchema } from '@/lib/canvas/schema';
import { createProposal } from '@/lib/design/service';
import { getRecommendations } from '@/lib/calc/efficiency/service';
import { listMaterials, listProjectMaterials } from '@/lib/materials/service';
import { materialQuerySchema } from '@/lib/materials/schema';
import { listLinearPlans, listPlans } from '@/lib/calc/cutting/service';
import { getCostSettings, getProjectCost } from '@/lib/calc/costs/service';
import { createQuote, getQuoteView, listQuotes, type QuoteWithLines } from '@/lib/quotes/service';
import { createQuoteSchema } from '@/lib/quotes/schema';
import { formatQuantity } from '@/lib/quotes/format';
import { getIntegrityReport } from '@/lib/validation/service';
import { listProjectAudit } from '@/lib/audit/service';
import { assertProjectPermission } from '@/lib/projects/service';
import type { CuttingPlan } from '@/generated/prisma/client';
import { grantsFor, type ProjectAiAccess } from '../access';
import {
  CREATE_QUOTE_JSON_SCHEMA,
  MATERIAL_QUERY_JSON_SCHEMA,
  PROPOSE_DESIGN_CHANGE_SCHEMA,
  SPEC_PATCH_JSON_SCHEMA,
} from './schemas';
import { checkPreviousTurnPreview } from './confirmation';

/**
 * The agent's tool surface.
 *
 * Three properties matter more than anything else here:
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
 * 3. The toolbox is built for a ROLE, not just for a user (T21). A tool whose
 *    result a role may not see is absent from the list. Before T21 the chat was
 *    a way around the permission matrix: a worker could ask the assistant for a
 *    saving in dirhams, and could drive a specification edit that `project.edit`
 *    exists to prevent. The gate is applied twice on purpose — the tool is left
 *    out of the list AND asserts the permission when it runs — because a tool
 *    that is only safe by omission is one refactor away from being unsafe.
 *
 *    Where a tool stays available but its MONEY does not, the withholding is no
 *    longer done here. The services decide it, so the AI, the HTTP routes and
 *    the pages all inherit one answer; these tools forward what they are given.
 *    Two implementations of "what counts as money" is one more than can be kept
 *    correct.
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

/**
 * How much of the audit trail to scan for quote events, and how many to report.
 *
 * The trail is shared by every domain, so a project with a busy conversation can
 * push quote events well down it. Scanning a wider window than is reported keeps
 * the quote history honest without putting a hundred unrelated events in the
 * model's context.
 */
const AUDIT_SCAN_LIMIT = 100;
const QUOTE_HISTORY_LIMIT = 10;

/** Validates what the model sends to propose_design_change. */
const proposeSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  commands: z.array(sceneCommandSchema).min(1).max(20),
  specPatch: projectSpecPatchSchema.nullable().optional(),
});

/**
 * What the model may send to create_quote: the service's own payload plus the
 * confirmation flag. Strict, so an unknown key — a price, a status, a project —
 * is rejected rather than ignored.
 */
const createQuoteArgsSchema = createQuoteSchema.extend({ confirmed: z.boolean() }).strict();

/** A recorded create_quote call that COMMITTED rather than previewed. */
const isQuoteCommit = (args: unknown): boolean =>
  typeof args === 'object' && args !== null && (args as { confirmed?: unknown }).confirmed === true;

/**
 * The write a create_quote call describes, with the confirmation flag removed.
 *
 * Parsed through the service's own schema, so whitespace or an omitted null
 * cannot make a preview and a commit of the same client look different — and so
 * a recorded preview the schema would reject can never match anything.
 */
function quoteIntent(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null;
  // `confirmed` is dropped: it is the one argument that differs between a
  // preview and the commit that confirms it.
  const rest = Object.fromEntries(
    Object.entries(args as Record<string, unknown>).filter(([key]) => key !== 'confirmed')
  );
  const parsed = createQuoteSchema.safeParse(rest);
  if (!parsed.success) return null;
  const value = parsed.data;
  return JSON.stringify({
    clientName: value.clientName,
    clientAddress: value.clientAddress ?? null,
    clientPhone: value.clientPhone ?? null,
    clientEmail: value.clientEmail ?? null,
    title: value.title ?? null,
    description: value.description ?? null,
  });
}

/** The client-facing view of a quotation the agent just created. */
function createdQuoteView(quote: QuoteWithLines) {
  return {
    number: quote.number,
    status: quote.status,
    title: quote.title,
    clientName: quote.clientName,
    currency: quote.currency,
    lines: quote.lines.map((line) => ({
      description: line.description,
      quantity: formatQuantity(line.quantityMilli),
      unitLabel: line.unitLabel,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    })),
    subtotalCents: quote.subtotalCents,
    taxBp: quote.taxBp,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
    createdAt: quote.createdAt,
  };
}

/** Bounds a library search: a whole catalogue in one tool result helps nobody. */
const MAX_MATERIAL_RESULTS = 25;

/* -------------------------------------------------------------------------- */
/* Toolbox                                                                     */
/* -------------------------------------------------------------------------- */

export function buildToolbox(access: ProjectAiAccess): ToolDefinition[] {
  const { projectId, userId, workspaceId } = access;
  const grants = grantsFor(access.role);
  const tools: ToolDefinition[] = [];

  /* ---- Specification ----------------------------------------------------- */

  tools.push({
    name: 'get_project_spec',
    description:
      'Read the project specification currently recorded, together with the list of required fields still missing. This is what the USER STATED, not what the application computed.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    execute: async (rawArgs) => {
      emptyObjectSchema.parse(rawArgs ?? {});
      const view = await getSpec(projectId, userId);
      return { spec: view.spec, missing: view.missing, complete: view.complete, status: view.status };
    },
  });

  if (grants.editProject) {
    tools.push({
      name: 'update_project_spec',
      description:
        'Record information the user has actually stated. Send only the fields they gave you; omitted fields keep their current values. Send null to clear a field the user retracted. Never send a value the user did not state, and never send a value you estimated from an image.',
      parameters: SPEC_PATCH_JSON_SCHEMA as unknown as Record<string, unknown>,
      execute: async (rawArgs) => {
        await assertProjectPermission(projectId, userId, 'project.edit');
        const patch = projectSpecPatchSchema.parse(rawArgs ?? {});
        const view = await updateDraftSpec(projectId, userId, patch);
        return { spec: view.spec, missing: view.missing, complete: view.complete };
      },
    });
  }

  /* ---- Design ------------------------------------------------------------ */

  tools.push({
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
  });

  if (grants.editDesign) {
    tools.push({
      name: 'propose_design_change',
      description:
        "Propose a change to the canvas for the user to approve. This does NOT change anything by itself — the user must approve it in the interface. Always read the canvas first, compute the new value from the object's CURRENT dimensions, and state the exact result in the summary.",
      parameters: PROPOSE_DESIGN_CHANGE_SCHEMA as unknown as Record<string, unknown>,
      execute: async (rawArgs) => {
        await assertProjectPermission(projectId, userId, 'design.edit');
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
    });
  }

  /* ---- Materials --------------------------------------------------------- */

  tools.push({
    name: 'list_materials',
    description:
      "Search the workspace's own material library — the stock this business actually buys. Use it before talking about a material, so you never suggest something they do not stock. Returns stock sizes and thicknesses. Archived materials are never returned.",
    parameters: MATERIAL_QUERY_JSON_SCHEMA as unknown as Record<string, unknown>,
    execute: async (rawArgs) => {
      const query = materialQuerySchema.parse({ ...(rawArgs as object), includeArchived: false });
      const materials = await listMaterials(workspaceId, query);
      return {
        materials: materials.slice(0, MAX_MATERIAL_RESULTS).map((material) => ({
          id: material.id,
          name: material.name,
          category: material.category,
          measurementModel: material.measurementModel,
          standardLengthMm: material.standardLengthMm,
          sheetWidthMm: material.sheetWidthMm,
          sheetHeightMm: material.sheetHeightMm,
          thicknessMm: material.thicknessMm?.toString() ?? null,
          ...(grants.viewCost ? { unitPriceCents: material.unitPriceCents } : {}),
        })),
        totalMatched: materials.length,
        note: 'This is the user\'s own library. Never suggest stock that is not in it as though they could buy it.',
      };
    },
  });

  tools.push({
    name: 'get_material_calculations',
    description:
      'Read the deterministic material calculation for this project: how many sheets, bars or pieces to purchase, the waste, and the steps the engine took to get there. These figures are COMPUTED — report them exactly and never work one out yourself. A line with no calculation has no quantity; say so rather than producing one.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    execute: async (rawArgs) => {
      emptyObjectSchema.parse(rawArgs ?? {});
      const lines = await listProjectMaterials(projectId, userId);
      return {
        lines,
        note: 'Computed by the material engine. Report these figures exactly. A line marked stale was computed before a later change and must be recalculated before it is quoted. A price that comes back null is one this user may not see — say so rather than guessing at it.',
      };
    },
  });

  tools.push({
    name: 'get_material_recommendations',
    description:
      "Read material efficiency recommendations for this project: cheaper or tighter stock sizes from the user's own material library, with the real saving in sheets or bars and waste. These are COMPUTED by re-running the cutting engines — report the numbers exactly as given and never estimate a saving yourself. You cannot apply one; the user applies it in the interface.",
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    execute: async (rawArgs) => {
      emptyObjectSchema.parse(rawArgs ?? {});
      const result = await getRecommendations(projectId, userId);
      return {
        recommendations: result.recommendations,
        showsPrices: result.showsPrices,
        emptyReason: result.emptyReason,
        note: 'Computed by the cutting engines. Report these figures exactly; do not calculate your own. The user applies a recommendation in the interface.',
      };
    },
  });

  /* ---- Cutting ----------------------------------------------------------- */

  tools.push({
    name: 'get_cutting_plans',
    description:
      'Read the computed cutting plans: which stock size, how many sheets or bars, the waste percentage, and any pieces the optimiser could NOT place. Unplaced pieces mean the plan does not cover the project — say which material and that those pieces do not fit. Never describe a layout that has not been computed.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    execute: async (rawArgs) => {
      emptyObjectSchema.parse(rawArgs ?? {});
      const [sheet, linear] = await Promise.all([
        listPlans(projectId, userId),
        listLinearPlans(projectId, userId),
      ]);
      // The SVG each view carries is a rendering, not information the model can
      // use, and it is far larger than everything else put together, so it is
      // dropped rather than sent.
      const describe = (entry: { plan: CuttingPlan | null }) =>
        entry.plan
          ? {
              materialId: entry.plan.materialId,
              stockSize: entry.plan.stockSizeLabel,
              stockUnitsUsed: entry.plan.stockUnitsUsed,
              wastePercent: entry.plan.wastePercent.toString(),
              unplacedCount: entry.plan.unplacedCount,
            }
          : null;

      const stated = <T,>(value: T | null): value is T => value !== null;

      return {
        sheetPlans: sheet.map(describe).filter(stated),
        linearPlans: linear.map(describe).filter(stated),
        note: 'Computed by the cutting optimiser. Report these figures exactly.',
      };
    },
  });

  /* ---- Cost -------------------------------------------------------------- */

  if (grants.viewCost) {
    tools.push({
      name: 'get_project_cost',
      description:
        'Read the internal cost breakdown computed by the cost engine: materials, labour, transport, installation, other expenses, margin, tax and totals, in minor currency units. Report these exactly. Never add to them, scale them, or price a change that has not been costed.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async (rawArgs) => {
        emptyObjectSchema.parse(rawArgs ?? {});
        await assertProjectPermission(projectId, userId, 'cost.view');
        const [view, settings] = await Promise.all([
          getProjectCost(projectId, userId),
          getCostSettings(workspaceId),
        ]);

        if (!view.cost) {
          return {
            cost: null,
            blockedReason: view.blockedReason,
            note: 'No cost has been computed. Say what is missing; do not produce a figure.',
          };
        }

        return {
          currency: settings.currency,
          cost: {
            materialsCostCents: view.cost.materialsCostCents,
            laborCostCents: view.cost.laborCostCents,
            transportCostCents: view.cost.transportCostCents,
            installCostCents: view.cost.installCostCents,
            otherCostCents: view.cost.otherCostCents,
            internalTotalCents: view.cost.internalTotalCents,
            marginCents: view.cost.marginCents,
            clientSubtotalCents: view.cost.clientSubtotalCents,
            taxCents: view.cost.taxCents,
            clientTotalCents: view.cost.clientTotalCents,
            computedAt: view.cost.computedAt,
          },
          stale: view.stale,
          note: view.stale
            ? 'SUPERSEDED: computed before a later material calculation. Say it must be recalculated rather than presenting it as the current cost.'
            : 'Computed by the cost engine. Report these figures exactly, in the currency given.',
        };
      },
    });
  }

  /* ---- Quotations -------------------------------------------------------- */

  if (grants.viewQuotes) {
    tools.push({
      name: 'get_quote',
      description:
        'Read the project\'s client quotations and where each one stands: number, status, client, currency, the priced lines a client is sent, subtotal, tax and total, when it was created, last changed and issued, how long it stays valid, whether a sendable document exists, what is blocking an unissued quote, and the record of quotes already issued. The newest quote is returned in full and older ones as a summary. Report these exactly. This READS a quotation and can never create, change, or issue one.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async (rawArgs) => {
        emptyObjectSchema.parse(rawArgs ?? {});

        // `listQuotes` asserts `quote.view` for itself, so the gate holds even
        // if this tool were ever reached without the grant above.
        const quotes = await listQuotes(projectId, userId);
        if (quotes.length === 0) {
          return {
            quote: null,
            history: [],
            note: 'No quotation exists for this project. Say so; do not invent a number, a line, a total or a date.',
          };
        }

        // The newest is the one being worked on, the same rule the project page
        // uses. Only it needs the issue blockers and the divergence check.
        const active = quotes[0];
        const [view, audit] = await Promise.all([
          getQuoteView(active.id, userId),
          listProjectAudit(projectId, userId, { limit: AUDIT_SCAN_LIMIT }),
        ]);

        // Quote events only. The trail carries every domain's events, and the
        // rest of it is not this tool's business — nor is it gated by
        // `quote.view`, which this tool is.
        const history = audit
          .filter((event) => event.action.startsWith('quote.'))
          .slice(0, QUOTE_HISTORY_LIMIT)
          .map((event) => ({
            action: event.action,
            summary: event.summary,
            at: event.createdAt,
          }));

        return {
          quote: {
            number: view.quote.number,
            status: view.quote.status,
            title: view.quote.title,
            clientName: view.quote.clientName,
            currency: view.quote.currency,
            lines: view.quote.lines.map((line) => ({
              description: line.description,
              quantity: formatQuantity(line.quantityMilli),
              unitLabel: line.unitLabel,
              unitPriceCents: line.unitPriceCents,
              lineTotalCents: line.lineTotalCents,
            })),
            subtotalCents: view.quote.subtotalCents,
            taxBp: view.quote.taxBp,
            taxCents: view.quote.taxCents,
            totalCents: view.quote.totalCents,
            validUntil: view.quote.validUntil,
            issuedAt: view.quote.issuedAt,
            createdAt: view.quote.createdAt,
            updatedAt: view.quote.updatedAt,
            // Whether a document actually exists to send. Only the key's
            // PRESENCE — the key itself is never model-visible.
            hasDocument: view.quote.pdfObjectKey !== null,
          },
          // Null for a caller without `cost.view` — the SERVICE decides that,
          // here and on every other read path. This tool forwards what it is
          // given rather than deciding again what counts as money.
          calculatedSubtotalCents: view.calculatedSubtotalCents,
          divergence: view.divergence,
          blockers: view.blockers,
          warnings: view.warnings,
          olderQuotes: quotes.slice(1).map((quote) => ({
            number: quote.number,
            status: quote.status,
            totalCents: quote.totalCents,
            currency: quote.currency,
            createdAt: quote.createdAt,
            issuedAt: quote.issuedAt,
            validUntil: quote.validUntil,
          })),
          // What has actually happened to this project's quotations, from the
          // audit trail the application already keeps. Reachable only through
          // this tool, which needs `quote.view`.
          history,
          statusNote:
            'A quote is DRAFT or ISSUED. The application records no other state — there is no accepted, rejected, or expired status. Report the status as given. `validUntil` is the date the quote says it holds until; report that date and do not declare a quote expired, accepted or refused, because nothing here records that.',
          note:
            view.calculatedSubtotalCents === null
              ? 'A quote PRICE is what the client is charged; it is not the internal cost. No internal comparison is available here, so do not state, estimate or imply a margin, a profit or whether this quote is above cost.'
              : 'A quote PRICE is what the client is charged. `calculatedSubtotalCents` is the internal calculated client subtotal, and `divergence` is how far this quote sits from it. Report both exactly; do not recompute them.',
        };
      },
    });
  }

  /* ---- Creating a quotation (T22.3) -------------------------------------- */

  if (grants.createQuotes) {
    /**
     * At most one quotation per turn, however often the model calls this.
     *
     * The previous-turn check below stops a second commit in a LATER turn; this
     * stops one in the SAME turn, where the preview being acted on is still the
     * last persisted one and would otherwise match twice.
     */
    let createdThisTurn: QuoteWithLines | null = null;

    tools.push({
      name: 'create_quote',
      description:
        'Create a DRAFT client quotation for this project, priced by the application from the project\'s cost calculation. You supply only who it is for and how it is headed; the lines, prices, tax, total, number and status are decided by the application. Two steps, always: call with confirmed=false to preview — nothing is created — show the user exactly what would be created and ask them to confirm; then, only in your NEXT turn and only if they agreed, call again with confirmed=true and the same details. It never issues or sends a quotation.',
      parameters: CREATE_QUOTE_JSON_SCHEMA as unknown as Record<string, unknown>,
      execute: async (rawArgs) => {
        const { confirmed, ...fields } = createQuoteArgsSchema.parse(rawArgs ?? {});
        const payload = createQuoteSchema.parse(fields);

        // Before the cost is read and before anything is written. The service
        // asserts it again on the commit path; the preview path never reaches
        // the service, so it has to be refused here.
        await assertProjectPermission(projectId, userId, 'quote.create');

        if (!confirmed) {
          // PREVIEW. Reads only. `getProjectCost` asserts `cost.view`, which
          // every role holding `quote.create` also holds — and `createQuote`
          // reads the same cost, so a role without it could not create anyway.
          const view = await getProjectCost(projectId, userId);
          if (!view.cost) {
            return {
              created: false,
              preview: null,
              blockedReason: view.blockedReason,
              note: 'A quotation is priced from the cost calculation and there is none yet. Say what is missing; do not offer to create one.',
            };
          }

          return {
            created: false,
            preview: {
              clientName: payload.clientName,
              clientAddress: payload.clientAddress ?? null,
              clientPhone: payload.clientPhone ?? null,
              clientEmail: payload.clientEmail ?? null,
              title: payload.title ?? null,
              description: payload.description ?? null,
              status: 'draft',
              // The single line it will be priced at, straight from the cost
              // engine. Tax and total are computed when it is created.
              pricedAtSubtotalCents: view.cost.clientSubtotalCents,
            },
            note: 'NOTHING HAS BEEN CREATED. Show the user these details and ask them to confirm. It will be a DRAFT, not sent to anyone, and creating it uses the next number in the quote sequence. Only if they clearly agree, call create_quote again in your next turn with confirmed=true and exactly these details. "wakha" or "ok" said in passing is not agreement to a new document; if in doubt, ask.',
          };
        }

        // COMMIT.
        if (createdThisTurn) {
          return {
            created: false,
            alreadyCreated: createdThisTurn.number,
            note: `Quotation ${createdThisTurn.number} was already created in this turn. Do not create another.`,
          };
        }

        const intent = quoteIntent(fields);
        const check = await checkPreviousTurnPreview(projectId, 'create_quote', isQuoteCommit, (recorded) =>
          quoteIntent(recorded) === intent
        );

        if (!check.ok) {
          const why = {
            no_preview:
              'There is no preview of this quotation in your previous turn. Call create_quote with confirmed=false, show the user the result, and create it only after they agree.',
            already_committed:
              'That preview was already turned into a quotation. Do not create it again; preview a new one if the user wants another.',
            changed:
              'These details differ from the preview the user saw. Preview the new details and ask again.',
          }[check.reason];
          return { created: false, refused: check.reason, note: `NOTHING WAS CREATED. ${why}` };
        }

        const quote = await createQuote(projectId, userId, payload);
        createdThisTurn = quote;

        return {
          created: true,
          quote: createdQuoteView(quote),
          note: `Quotation ${quote.number} has been created as a DRAFT. It has not been issued or sent. Report its number and total exactly; the user issues it from the interface.`,
        };
      },
    });
  }

  /* ---- Readiness --------------------------------------------------------- */

  tools.push({
    name: 'get_project_readiness',
    description:
      'Read the integrity report: everything the application has found wrong or missing across the specification, design, materials, cutting and cost, plus whether the project is ready to quote and ready for a production package. Use this to answer "wach wajed?" and to explain what is blocking a document. Report the findings given; do not invent additional ones.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    execute: async (rawArgs) => {
      emptyObjectSchema.parse(rawArgs ?? {});
      const report = await getIntegrityReport(projectId, userId);
      return {
        findings: report.findings,
        summary: report.summary,
        readiness: report.readiness,
        note: 'Computed by the validation layer. A blocker genuinely refuses the action; a warning does not.',
      };
    },
  });

  return tools;
}
