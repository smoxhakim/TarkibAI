/**
 * What to order, grouped by who you order it from.
 *
 * Pure. Takes the purchase counts the material engine already produced and
 * arranges them; it does not recompute a quantity, because a second place that
 * decides how many bars to buy is a second place that can disagree with the
 * first.
 *
 * Lines the engine could not calculate are carried through with their reason
 * rather than dropped. A purchase list that silently omits a material is how
 * somebody arrives at the yard missing half the job.
 */

export type PurchaseLineInput = {
  materialId: string;
  materialName: string;
  supplierId: string | null;
  /** Free-text fallback for a material not linked to a supplier record. */
  supplierLabel: string | null;
  stockSize: string | null;
  unitsToPurchase: number | null;
  unitPriceCents: number | null;
  unsupportedReason: string | null;
  /** Caveats the calculation recorded, e.g. the linear MINIMUM warning. */
  warnings: string[];
};

export type PurchaseLine = {
  materialId: string;
  materialName: string;
  stockSize: string | null;
  unitsToPurchase: number | null;
  /** Null when the caller may not see prices — see the note in the service. */
  lineTotalCents: number | null;
  unsupportedReason: string | null;
  warnings: string[];
};

export type PurchaseGroup = {
  supplierId: string | null;
  /** "Metaux Casa", or "No supplier recorded" when nothing links it. */
  supplierName: string;
  lines: PurchaseLine[];
  /** Null when prices are hidden, or when any line in the group has no price. */
  subtotalCents: number | null;
  /** True when some line in this group could not be calculated. */
  incomplete: boolean;
};

export const NO_SUPPLIER = 'No supplier recorded';

/**
 * Groups purchase lines by supplier.
 *
 * `includePrices` is passed rather than inferred, because whether somebody may
 * see what material costs is a permission (T18) and this module has no business
 * deciding it. When false, no price reaches the output at all — the field is
 * null rather than the number being formatted away.
 */
export function groupPurchases(
  lines: PurchaseLineInput[],
  options: { includePrices: boolean }
): PurchaseGroup[] {
  const groups = new Map<string, PurchaseGroup>();

  for (const line of lines) {
    const key = line.supplierId ?? `label:${line.supplierLabel ?? ''}`;
    const name = line.supplierLabel?.trim() || NO_SUPPLIER;

    if (!groups.has(key)) {
      groups.set(key, {
        supplierId: line.supplierId,
        supplierName: name,
        lines: [],
        subtotalCents: options.includePrices ? 0 : null,
        incomplete: false,
      });
    }

    const group = groups.get(key)!;
    const priced =
      options.includePrices && line.unitsToPurchase !== null && line.unitPriceCents !== null
        ? line.unitsToPurchase * line.unitPriceCents
        : null;

    group.lines.push({
      materialId: line.materialId,
      materialName: line.materialName,
      stockSize: line.stockSize,
      unitsToPurchase: line.unitsToPurchase,
      lineTotalCents: priced,
      unsupportedReason: line.unsupportedReason,
      warnings: line.warnings,
    });

    if (line.unsupportedReason !== null || line.unitsToPurchase === null) {
      group.incomplete = true;
      // A subtotal that silently omits an uncalculable line reads as a
      // complete order value. It is not one, so there is no subtotal.
      group.subtotalCents = null;
    } else if (group.subtotalCents !== null && priced !== null) {
      group.subtotalCents += priced;
    } else if (options.includePrices && priced === null) {
      group.subtotalCents = null;
    }
  }

  // Named suppliers first, alphabetically; the unattributed group last, because
  // it is the one that needs attention rather than the one to read first.
  return [...groups.values()].sort((a, b) => {
    if (a.supplierName === NO_SUPPLIER) return 1;
    if (b.supplierName === NO_SUPPLIER) return -1;
    return a.supplierName.localeCompare(b.supplierName);
  });
}
