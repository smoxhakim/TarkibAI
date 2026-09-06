/**
 * Deterministic cost calculation.
 *
 * Money is integer minor currency units throughout (ARCHITECTURE §10) — never a
 * float. Percentages are integer basis points, so 12.5% is 1250 and the
 * arithmetic stays exact.
 *
 * # Order of operations
 *
 * The order is fixed and part of the contract, because a different order gives
 * a different total:
 *
 *   materials + labour + transport + installation + other  = internal total
 *   internal total × margin                                = margin
 *   internal total + margin                                = client subtotal
 *   client subtotal × tax                                  = tax
 *   client subtotal + tax                                  = client total
 *
 * Percentage components (labour, transport, installation) are each a percentage
 * of the MATERIAL cost, not of a running subtotal. They are therefore
 * independent of one another and of their order, which makes a breakdown
 * checkable by hand.
 */

export type ComponentType = 'percent' | 'fixed' | 'manual';

export const COMPONENT_TYPES: readonly ComponentType[] = ['percent', 'fixed', 'manual'];

/**
 * Narrows a value read from the database.
 *
 * Throws rather than defaulting. Settings are only ever written through a
 * validated route, so an unrecognised value means corrupt data — and silently
 * treating it as one of the valid types would change what a client is charged.
 */
export function asComponentType(value: string, field: string): ComponentType {
  if ((COMPONENT_TYPES as readonly string[]).includes(value)) return value as ComponentType;
  throw new Error(`Invalid cost component type for ${field}: ${JSON.stringify(value)}`);
}

export type CostSettingsInput = {
  laborType: ComponentType;
  laborBp: number;
  laborCents: number;
  transportType: ComponentType;
  transportBp: number;
  transportCents: number;
  installType: ComponentType;
  installBp: number;
  installCents: number;
  /** Basis points. 2500 = 25%. */
  marginBp: number;
  taxBp: number;
};

export type CostInput = {
  settings: CostSettingsInput;
  /** Sum of calculated material lines, in minor units. */
  materialsCostCents: number;
  /** Per-project one-off expenses, in minor units. */
  expensesCents: number[];
  /**
   * Amounts entered for this project where the rule is "manual". Ignored for
   * components configured as percent or fixed.
   */
  manualOverrides?: {
    transportCents?: number;
    laborCents?: number;
    installCents?: number;
  };
};

export type CostBreakdown = {
  materialsCostCents: number;
  laborCostCents: number;
  transportCostCents: number;
  installCostCents: number;
  otherCostCents: number;
  internalTotalCents: number;
  marginCents: number;
  clientSubtotalCents: number;
  taxCents: number;
  clientTotalCents: number;
};

const BP_DIVISOR = 10_000;

/**
 * Applies basis points to an integer amount, rounding half away from zero.
 *
 * `Math.round` in JavaScript rounds .5 towards positive infinity, which biases
 * negative values. Amounts here are non-negative, but the helper is written to
 * be correct regardless so it stays safe if credits or discounts are added.
 */
export function applyBasisPoints(amountCents: number, basisPoints: number): number {
  const product = amountCents * basisPoints;
  const sign = product < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(product) / BP_DIVISOR);
}

/** Resolves one configurable component to an integer amount. */
function resolveComponent(
  type: ComponentType,
  basisPoints: number,
  fixedCents: number,
  materialsCostCents: number,
  manualCents: number | undefined
): number {
  switch (type) {
    case 'percent':
      return applyBasisPoints(materialsCostCents, basisPoints);
    case 'fixed':
      return Math.max(0, Math.round(fixedCents));
    case 'manual':
      // Nothing is assumed when the user has not entered a manual amount: an
      // unentered cost is zero, not a guess.
      return Math.max(0, Math.round(manualCents ?? 0));
    default:
      return 0;
  }
}

export function calculateProjectCost(input: CostInput): CostBreakdown {
  const { settings, manualOverrides } = input;
  const materialsCostCents = Math.max(0, Math.round(input.materialsCostCents));

  const laborCostCents = resolveComponent(
    settings.laborType,
    settings.laborBp,
    settings.laborCents,
    materialsCostCents,
    manualOverrides?.laborCents
  );
  const transportCostCents = resolveComponent(
    settings.transportType,
    settings.transportBp,
    settings.transportCents,
    materialsCostCents,
    manualOverrides?.transportCents
  );
  const installCostCents = resolveComponent(
    settings.installType,
    settings.installBp,
    settings.installCents,
    materialsCostCents,
    manualOverrides?.installCents
  );

  const otherCostCents = input.expensesCents.reduce(
    (sum, amount) => sum + Math.max(0, Math.round(amount)),
    0
  );

  const internalTotalCents =
    materialsCostCents + laborCostCents + transportCostCents + installCostCents + otherCostCents;

  const marginCents = applyBasisPoints(internalTotalCents, settings.marginBp);
  const clientSubtotalCents = internalTotalCents + marginCents;

  const taxCents = applyBasisPoints(clientSubtotalCents, settings.taxBp);
  const clientTotalCents = clientSubtotalCents + taxCents;

  return {
    materialsCostCents,
    laborCostCents,
    transportCostCents,
    installCostCents,
    otherCostCents,
    internalTotalCents,
    marginCents,
    clientSubtotalCents,
    taxCents,
    clientTotalCents,
  };
}

/* -------------------------------------------------------------------------- */
/* Client-safe serialization                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The ONLY representation of cost that may reach a client-facing surface.
 *
 * It is built by explicitly naming the three safe fields rather than by
 * deleting unsafe ones from the internal object. Deletion is fragile: a field
 * added to CostBreakdown later would leak by default. Construction means a new
 * internal field is invisible here unless somebody deliberately adds it.
 *
 * Internal cost, labour, transport, installation and MARGIN must never appear
 * on a client document (PRD §22, ARCHITECTURE §15).
 */
export type ClientSafeCost = {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export function toClientSafeCost(breakdown: CostBreakdown): ClientSafeCost {
  return {
    subtotalCents: breakdown.clientSubtotalCents,
    taxCents: breakdown.taxCents,
    totalCents: breakdown.clientTotalCents,
  };
}
