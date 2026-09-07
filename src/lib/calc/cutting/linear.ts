/**
 * Deterministic 1D stock cutting for bars, tubes and profiles.
 *
 * # Why this exists separately from a length division
 *
 * Dividing total required length by bar length under-counts. Four 4 m pieces
 * from 6 m bars is 16 m of material, which suggests three bars — but only ONE
 * 4 m piece fits in a 6 m bar, so the workshop needs four. Under-buying stops a
 * job mid-fabrication, so the cut lengths themselves have to be packed.
 *
 * # Algorithm
 *
 * First Fit Decreasing: sort cuts longest first, then place each into the first
 * bar with room. FFD is the standard heuristic for one-dimensional cutting
 * stock, is deterministic, and is provably within 11/9 of optimal plus a
 * constant — good enough that the remaining gap is smaller than the variation
 * between real saw operators.
 *
 * # Kerf
 *
 * Every cut consumes blade width. A cut only needs kerf when material follows
 * it on the bar, so the kerf is charged between consecutive cuts rather than
 * after the last one — charging it unconditionally would waste a blade width
 * per bar and inflate the bar count.
 */

export type LinearCutInput = {
  id: string;
  label?: string | null;
  lengthMm: number;
  quantity: number;
};

export type LinearSettings = {
  stockLengthMm: number;
  kerfMm: number;
  /**
   * Shortest tail still worth keeping. A remnant at or above this is reported
   * as reusable stock and excluded from waste; anything shorter is scrap.
   */
  minUsableRemnantMm: number;
};

export type BarCut = {
  cutId: string;
  label: string | null;
  lengthMm: number;
  /** Distance from the start of the bar to the start of this cut. */
  offsetMm: number;
};

export type BarLayout = {
  index: number;
  cuts: BarCut[];
  /** Material used by cuts, excluding kerf. */
  usedMm: number;
  /** Blade width consumed on this bar. */
  kerfMm: number;
  /** Length left at the end of the bar. */
  remnantMm: number;
  /** True when the remnant is long enough to keep. */
  remnantUsable: boolean;
  /** Share of the bar consumed by cuts, 0–100. */
  utilisationPercent: number;
};

export type UnplacedCut = {
  cutId: string;
  label: string | null;
  lengthMm: number;
  quantity: number;
  reason: string;
};

export type LinearResult = {
  bars: BarLayout[];
  barsUsed: number;
  unplaced: UnplacedCut[];
  totalRequiredMm: number;
  totalPurchasedMm: number;
  totalKerfMm: number;
  /** Remnants long enough to keep, per bar. */
  usableRemnantsMm: number[];
  /** Material genuinely lost: kerf plus remnants too short to reuse. */
  wasteMm: number;
  wastePercent: number;
  settings: LinearSettings;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function calculateLinearPlan(
  cuts: LinearCutInput[],
  settings: LinearSettings
): LinearResult {
  const { stockLengthMm, kerfMm, minUsableRemnantMm } = settings;

  const unplaced: UnplacedCut[] = [];
  const instances: { cutId: string; label: string | null; lengthMm: number }[] = [];

  for (const cut of cuts) {
    if (cut.lengthMm > stockLengthMm) {
      // Splicing two bars to make one long piece is a fabrication decision
      // about joints and strength, not something an optimiser may assume.
      unplaced.push({
        cutId: cut.id,
        label: cut.label ?? null,
        lengthMm: cut.lengthMm,
        quantity: cut.quantity,
        reason: `Longer than a ${stockLengthMm} mm bar.`,
      });
      continue;
    }
    for (let i = 0; i < cut.quantity; i += 1) {
      instances.push({ cutId: cut.id, label: cut.label ?? null, lengthMm: cut.lengthMm });
    }
  }

  // Longest first. Placing long pieces before short ones is what makes first-fit
  // produce sensible bars; the short pieces then fill the tails.
  instances.sort((a, b) => {
    if (b.lengthMm !== a.lengthMm) return b.lengthMm - a.lengthMm;
    // Deterministic tie-break so identical input yields an identical plan.
    return a.cutId.localeCompare(b.cutId);
  });

  const bars: BarLayout[] = [];

  for (const instance of instances) {
    let placed = false;

    for (const bar of bars) {
      // Kerf is only needed if something is already on the bar.
      const kerfNeeded = bar.cuts.length > 0 ? kerfMm : 0;
      const consumed = bar.usedMm + bar.kerfMm;
      if (consumed + kerfNeeded + instance.lengthMm > stockLengthMm) continue;

      bar.cuts.push({
        cutId: instance.cutId,
        label: instance.label,
        lengthMm: instance.lengthMm,
        offsetMm: consumed + kerfNeeded,
      });
      bar.usedMm += instance.lengthMm;
      bar.kerfMm += kerfNeeded;
      placed = true;
      break;
    }

    if (!placed) {
      bars.push({
        index: bars.length,
        cuts: [
          { cutId: instance.cutId, label: instance.label, lengthMm: instance.lengthMm, offsetMm: 0 },
        ],
        usedMm: instance.lengthMm,
        kerfMm: 0,
        remnantMm: 0,
        remnantUsable: false,
        utilisationPercent: 0,
      });
    }
  }

  let totalKerfMm = 0;
  const usableRemnantsMm: number[] = [];
  let scrapMm = 0;

  for (const bar of bars) {
    bar.remnantMm = stockLengthMm - bar.usedMm - bar.kerfMm;
    bar.remnantUsable = bar.remnantMm >= minUsableRemnantMm && bar.remnantMm > 0;
    bar.utilisationPercent = round2((bar.usedMm / stockLengthMm) * 100);

    totalKerfMm += bar.kerfMm;
    if (bar.remnantUsable) usableRemnantsMm.push(bar.remnantMm);
    else scrapMm += bar.remnantMm;
  }

  const totalRequiredMm = instances.reduce((sum, instance) => sum + instance.lengthMm, 0);
  const totalPurchasedMm = bars.length * stockLengthMm;

  // Waste is kerf plus tails too short to keep. A remnant worth keeping is
  // stock, not loss — counting it as waste would overstate the cost of a job.
  const wasteMm = totalKerfMm + scrapMm;
  const wastePercent = totalPurchasedMm === 0 ? 0 : round2((wasteMm / totalPurchasedMm) * 100);

  return {
    bars,
    barsUsed: bars.length,
    unplaced,
    totalRequiredMm,
    totalPurchasedMm,
    totalKerfMm,
    usableRemnantsMm,
    wasteMm,
    wastePercent,
    settings,
  };
}
