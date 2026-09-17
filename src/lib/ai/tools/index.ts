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
import { getIntegrityReport } from '@/lib/validation/service';
import { assertProjectPermission } from '@/lib/projects/service';
import type { Recommendation } from '@/lib/calc/efficiency/engine';
import type { ProjectMaterialView } from '@/lib/materials/service';
import type { CuttingPlan } from '@/generated/prisma/client';
import { grantsFor, type ProjectAiAccess } from '../access';
import {
  MATERIAL_QUERY_JSON_SCHEMA,
  PROPOSE_DESIGN_CHANGE_SCHEMA,
  SPEC_PATCH_JSON_SCHEMA,
} from './schemas';

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
 *    result a role may not see is not redacted — it is absent, and for money
 *    the underlying row is never read at all. Before T21 the chat was a way
 *    around the permission matrix: a worker could ask the assistant for a
 *    saving in dirhams, and could drive a specification edit that `project.edit`
 *    exists to prevent. The gate is applied twice on purpose — the tool is left
 *    out of the list AND asserts the permission when it runs — because a tool
 *    that is only safe by omission is one refactor away from being unsafe.
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

/** Bounds a library search: a whole catalogue in one tool result helps nobody. */
const MAX_MATERIAL_RESULTS = 25;

/* -------------------------------------------------------------------------- */
/* Money redaction                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A calculated material line with no money in it.
 *
 * A production manager may legitimately ask how many sheets to buy — that is
 * their job — while having no business seeing what they cost. Quantities, waste
 * and the calculation steps survive; anything denominated in money does not.
 * The steps are safe by construction: the material engine writes lengths, areas
 * and unit counts into them, never amounts.
 *
 * Built as an ALLOWLIST rather than by deleting the three price fields. A
 * denylist quietly stops being correct the day somebody adds a fourth one to
 * ProjectMaterialView, and the failure would be silent and financial.
 */
function withoutMoney(line: ProjectMaterialView) {
  return {
    id: line.id,
    materialId: line.materialId,
    name: line.name,
    category: line.category,
    measurementModel: line.measurementModel,
    role: line.role,
    requiredQuantity: line.requiredQuantity,
    requiredDimensions: line.requiredDimensions,
    unitsToPurchase: line.unitsToPurchase,
    totalPurchasedQuantity: line.totalPurchasedQuantity,
    wasteQuantity: line.wasteQuantity,
    wastePercent: line.wastePercent,
    calculatedAt: line.calculatedAt,
    unsupportedReason: line.unsupportedReason,
    steps: line.steps,
    warnings: line.warnings,
    staleReasons: line.staleReasons,
  };
}

/**
 * A recommendation with the money taken out.
 *
 * The engine's own `summary` sentence quotes both totals, so it cannot be
 * forwarded — it is replaced by one built from the units and waste, which is
 * the part a production role can act on.
 */
function recommendationWithoutMoney(recommendation: Recommendation) {
  const { current, alternative } = recommendation;
  return {
    kind: recommendation.kind,
    current: {
      name: current.name,
      stockUnits: current.stockUnits,
      wastePercent: current.wastePercent,
      unplacedCount: current.unplacedCount,
    },
    alternative: {
      name: alternative.name,
      stockUnits: alternative.stockUnits,
      wastePercent: alternative.wastePercent,
      unplacedCount: alternative.unplacedCount,
    },
    savingUnits: recommendation.savingUnits,
    wasteReductionPercent: recommendation.wasteReductionPercent,
    summary:
      `${alternative.name}: ${alternative.stockUnits} stock unit(s) instead of ${current.stockUnits}, ` +
      `waste ${current.wastePercent}% → ${alternative.wastePercent}%.`,
  };
}

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
        lines: grants.viewCost ? lines : lines.map(withoutMoney),
        note: 'Computed by the material engine. Report these figures exactly. A line marked stale was computed before a later change and must be recalculated before it is quoted.',
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
        recommendations: grants.viewCost
          ? result.recommendations
          : result.recommendations.map(recommendationWithoutMoney),
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
