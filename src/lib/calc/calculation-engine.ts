// Deterministic Material Calculation Engine — no AI involved.
// Converts an approved spec + selected materials into ProjectMaterial line items.

export interface MaterialSelection {
  materialId: string;
  requiredQuantity: number; // e.g. meters or sqm needed by the project
}

export interface StandardMaterialInfo {
  id: string;
  standardUnitSize: string; // e.g. "6m" or "2.44x1.22m"
  unit: 'meter' | 'sqm' | 'sheet' | 'piece';
  unitPriceCents: number;
}

export interface CalculatedLine {
  materialId: string;
  requiredQuantity: number;
  unitsToPurchase: number;
  totalPurchasedQuantity: number;
  wastePercent: number;
  totalCostCents: number;
}

// Core formula: requiredQty -> standard unit size -> units to purchase -> waste.
// Example: 25m required, 6m bars -> 5 bars, 30m purchased, 5m (16.7%) waste.
export function calculateMaterialLine(
  selection: MaterialSelection,
  material: StandardMaterialInfo
): CalculatedLine {
  // TODO: parse standardUnitSize (linear vs sheet) and compute purchase units
  // TODO: compute wastePercent = (purchased - required) / purchased * 100
  throw new Error('not implemented');
}

// Runs calculateMaterialLine across all selections for a project.
export function calculateProjectMaterials(
  selections: MaterialSelection[],
  materials: StandardMaterialInfo[]
): CalculatedLine[] {
  // TODO: map selections to materials by id and delegate to calculateMaterialLine
  return [];
}
