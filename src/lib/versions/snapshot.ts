/**
 * The shape of a project snapshot.
 *
 * Written by the version service and read back by the diff. Everything here is
 * a copy of state that existed — nothing is derived at snapshot time, so a
 * version can be compared and reviewed years later without re-running an
 * engine whose rules may since have changed.
 *
 * The cost snapshot carries internal figures. Versions are an internal record:
 * they are never handed to a client document, which builds its own payload from
 * a type that has no field for them.
 */

export type SnapshotCanvasObject = {
  id: string;
  type: string;
  label: string | null;
  x: number;
  y: number;
  widthMm: number;
  heightMm: number;
  depthMm: number | null;
};

export type SnapshotMaterial = {
  materialId: string;
  name: string;
  role: string | null;
  /** Decimal values are stored as strings so no precision is lost in JSON. */
  requiredQuantity: string | null;
  unitsToPurchase: number | null;
  totalPurchasedQuantity: string | null;
  wastePercent: string | null;
  unsupportedReason: string | null;
};

export type SnapshotCost = {
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
  computedAt: string;
  /** Null on snapshots written before the currency was captured. */
  currency: string | null;
};

export type SnapshotReferences = {
  specVersion: number | null;
  specApproved: boolean;
  drawingVersions: number[];
  quoteNumbers: string[];
  productionVersions: number[];
};

/** A version's snapshot, assembled from the columns it is stored across. */
export type VersionSnapshot = {
  spec: Record<string, unknown>;
  canvas: SnapshotCanvasObject[] | null;
  materials: SnapshotMaterial[] | null;
  cost: SnapshotCost | null;
  references: SnapshotReferences | null;
};

/* -------------------------------------------------------------------------- */
/* Reading stored JSON back                                                    */
/* -------------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function readSpecSnapshot(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Reads a stored array back defensively.
 *
 * Snapshots written by an older version of the application may not match the
 * current type. Returning null for an unreadable snapshot is honest — the diff
 * then says that section cannot be compared, rather than reporting a difference
 * that is really a parsing failure.
 */
function readArray<T>(value: unknown, read: (entry: Record<string, unknown>) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const parsed = read(entry);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

export function readCanvasSnapshot(value: unknown): SnapshotCanvasObject[] | null {
  return readArray(value, (entry) => {
    const id = str(entry.id);
    if (id === null) return null;
    return {
      id,
      type: str(entry.type) ?? 'unknown',
      label: str(entry.label),
      x: num(entry.x) ?? 0,
      y: num(entry.y) ?? 0,
      widthMm: num(entry.widthMm) ?? 0,
      heightMm: num(entry.heightMm) ?? 0,
      depthMm: num(entry.depthMm),
    };
  });
}

export function readMaterialsSnapshot(value: unknown): SnapshotMaterial[] | null {
  return readArray(value, (entry) => {
    const materialId = str(entry.materialId);
    if (materialId === null) return null;
    return {
      materialId,
      name: str(entry.name) ?? 'Unnamed material',
      role: str(entry.role),
      requiredQuantity: str(entry.requiredQuantity),
      unitsToPurchase: num(entry.unitsToPurchase),
      totalPurchasedQuantity: str(entry.totalPurchasedQuantity),
      wastePercent: str(entry.wastePercent),
      unsupportedReason: str(entry.unsupportedReason),
    };
  });
}

export function readCostSnapshot(value: unknown): SnapshotCost | null {
  if (!isRecord(value)) return null;
  const required = [
    'materialsCostCents',
    'laborCostCents',
    'transportCostCents',
    'installCostCents',
    'otherCostCents',
    'internalTotalCents',
    'marginCents',
    'clientSubtotalCents',
    'taxCents',
    'clientTotalCents',
  ] as const;

  const out = {} as SnapshotCost;
  for (const key of required) {
    const amount = num(value[key]);
    if (amount === null) return null;
    out[key] = amount;
  }
  out.computedAt = str(value.computedAt) ?? '';
  out.currency = str(value.currency);
  return out;
}

export function readReferenceSnapshot(value: unknown): SnapshotReferences | null {
  if (!isRecord(value)) return null;
  const numbers = (key: string): number[] =>
    Array.isArray(value[key]) ? (value[key] as unknown[]).filter((v): v is number => typeof v === 'number') : [];

  return {
    specVersion: num(value.specVersion),
    specApproved: value.specApproved === true,
    drawingVersions: numbers('drawingVersions'),
    quoteNumbers: Array.isArray(value.quoteNumbers)
      ? (value.quoteNumbers as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
    productionVersions: numbers('productionVersions'),
  };
}
