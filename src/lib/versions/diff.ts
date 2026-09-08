import { formatMoney } from '@/lib/quotes/format';
import type {
  SnapshotCanvasObject,
  SnapshotCost,
  SnapshotMaterial,
  SnapshotReferences,
  VersionSnapshot,
} from './snapshot';

/**
 * Deterministic comparison of two project snapshots.
 *
 * Pure: same two snapshots in, same diff out, no database and no model. A
 * version comparison is a factual statement about what changed, and a summary
 * written by a language model would be a plausible account of it rather than
 * the thing itself.
 *
 * Where a snapshot section is absent — an older version written before that
 * section existed, or state a project never had — the section reports that it
 * cannot be compared. Treating a missing snapshot as "nothing there" would
 * report a deletion that never happened.
 */

export type ChangeKind = 'added' | 'removed' | 'changed';

export type FieldChange = {
  /** Dotted path into the snapshot, e.g. "dimensions.width". */
  path: string;
  /** The same path written for a person, e.g. "Dimensions › Width". */
  label: string;
  from: string | null;
  to: string | null;
  kind: ChangeKind;
};

export type EntryChange = {
  /** What identifies the entry to a reader — an object's label, a material's name. */
  name: string;
  kind: ChangeKind;
  /** Empty for an added or removed entry; the field-level changes otherwise. */
  changes: FieldChange[];
};

export type SectionDiff = {
  entries: EntryChange[];
  /** Set when the section is absent from one side and cannot be compared. */
  unavailableReason: string | null;
};

export type VersionDiff = {
  spec: FieldChange[];
  canvas: SectionDiff;
  materials: SectionDiff;
  cost: FieldChange[];
  costUnavailableReason: string | null;
  references: FieldChange[];
  /** True when nothing at all differs. */
  identical: boolean;
};

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** "dimensions.width" -> "Dimensions › Width". */
export function humanisePath(path: string): string {
  return path
    .split('.')
    .map((segment) =>
      segment
        // Keep a bracketed key intact: "components[Tray]" -> "Components [Tray]".
        .replace(/\[(.+)\]$/, ' [$1]')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (character) => character.toUpperCase())
    )
    .join(' › ');
}

/** Renders a leaf value for display, or null when it is absent. */
function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    const parts = value.map((entry) => formatValue(entry)).filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return String(value);
}

/* -------------------------------------------------------------------------- */
/* Flattening                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Flattens a specification into path/value pairs.
 *
 * Arrays of named objects are keyed by name rather than by index, so reordering
 * two components does not read as four changes. Arrays of scalars stay whole,
 * because "colors: red, white" is one fact to a reader, not two.
 */
export function flattenSpec(spec: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();

  for (const [key, value] of Object.entries(spec)) {
    // Internal bookkeeping, not something a user changed.
    if (key === 'specVersion') continue;

    const path = prefix ? `${prefix}.${key}` : key;

    if (Array.isArray(value)) {
      const named = value.every(
        (entry) => typeof entry === 'object' && entry !== null && typeof (entry as { name?: unknown }).name === 'string'
      );
      if (value.length > 0 && named) {
        for (const entry of value as Record<string, unknown>[]) {
          // The name is already the key in the path. Emitting it as a field too
          // makes every added entry report "Name: added — Downlight bar"
          // alongside the heading that already says so.
          const { name: _name, ...rest } = entry;
          const scoped = `${path}[${entry.name as string}]`;
          if (Object.keys(rest).length === 0) {
            out.set(scoped, 'present');
            continue;
          }
          for (const [innerKey, innerValue] of flattenSpec(rest, scoped)) {
            out.set(innerKey, innerValue);
          }
        }
        continue;
      }
      const formatted = formatValue(value);
      if (formatted !== null) out.set(path, formatted);
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      for (const [innerKey, innerValue] of flattenSpec(value as Record<string, unknown>, path)) {
        out.set(innerKey, innerValue);
      }
      continue;
    }

    const formatted = formatValue(value);
    if (formatted !== null) out.set(path, formatted);
  }

  return out;
}

/** Compares two flat maps, sorted by path so a diff is reproducible. */
export function diffMaps(before: Map<string, string>, after: Map<string, string>): FieldChange[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: FieldChange[] = [];

  for (const path of paths) {
    const from = before.get(path) ?? null;
    const to = after.get(path) ?? null;
    if (from === to) continue;

    changes.push({
      path,
      label: humanisePath(path),
      from,
      to,
      kind: from === null ? 'added' : to === null ? 'removed' : 'changed',
    });
  }

  return changes;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/** Compares two keyed collections entry by entry. */
function diffEntries<T>(
  before: T[] | null,
  after: T[] | null,
  key: (entry: T) => string,
  name: (entry: T) => string,
  fields: (entry: T) => Map<string, string>,
  unavailable: string
): SectionDiff {
  if (before === null || after === null) {
    return { entries: [], unavailableReason: unavailable };
  }

  const beforeById = new Map(before.map((entry) => [key(entry), entry]));
  const afterById = new Map(after.map((entry) => [key(entry), entry]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();

  const entries: EntryChange[] = [];
  for (const id of ids) {
    const from = beforeById.get(id);
    const to = afterById.get(id);

    if (from === undefined && to !== undefined) {
      entries.push({ name: name(to), kind: 'added', changes: [] });
      continue;
    }
    if (from !== undefined && to === undefined) {
      entries.push({ name: name(from), kind: 'removed', changes: [] });
      continue;
    }
    if (from === undefined || to === undefined) continue;

    const changes = diffMaps(fields(from), fields(to));
    if (changes.length > 0) entries.push({ name: name(to), kind: 'changed', changes });
  }

  return { entries, unavailableReason: null };
}

const mm = (value: number | null): string | null => (value === null ? null : `${value} mm`);

const canvasFields = (object: SnapshotCanvasObject): Map<string, string> =>
  flattenSpec({
    type: object.type,
    label: object.label,
    x: mm(object.x),
    y: mm(object.y),
    width: mm(object.widthMm),
    height: mm(object.heightMm),
    depth: mm(object.depthMm),
  });

const materialFields = (material: SnapshotMaterial): Map<string, string> =>
  flattenSpec({
    role: material.role,
    requiredQuantity: material.requiredQuantity,
    unitsToPurchase: material.unitsToPurchase,
    totalPurchasedQuantity: material.totalPurchasedQuantity,
    wastePercent: material.wastePercent,
    unsupportedReason: material.unsupportedReason,
  });

/**
 * Cost figures, formatted as money.
 *
 * Printing the stored minor units would show "266000" for two thousand six
 * hundred and sixty — an order-of-magnitude misreading on the one section where
 * the numbers are money. The currency is absent on snapshots written before it
 * was captured, and the amount is then shown without one rather than with a
 * guessed symbol.
 *
 * `computedAt` is excluded: two identical calculations run at different times
 * are the same cost, and reporting the timestamp would bury the figures that
 * actually moved.
 */
function costFields(cost: SnapshotCost): Map<string, string> {
  const money = (amount: number): string =>
    cost.currency ? formatMoney(amount, cost.currency) : formatMoney(amount, '').trimEnd();

  return new Map([
    ['materials', money(cost.materialsCostCents)],
    ['labour', money(cost.laborCostCents)],
    ['transport', money(cost.transportCostCents)],
    ['installation', money(cost.installCostCents)],
    ['otherExpenses', money(cost.otherCostCents)],
    ['internalTotal', money(cost.internalTotalCents)],
    ['margin', money(cost.marginCents)],
    ['clientSubtotal', money(cost.clientSubtotalCents)],
    ['tax', money(cost.taxCents)],
    ['clientTotal', money(cost.clientTotalCents)],
  ]);
}

const referenceFields = (references: SnapshotReferences): Map<string, string> =>
  flattenSpec({
    specVersion: references.specVersion,
    specApproved: references.specApproved,
    drawingVersions: references.drawingVersions,
    quoteNumbers: references.quoteNumbers,
    productionVersions: references.productionVersions,
  });

/* -------------------------------------------------------------------------- */

export function diffSnapshots(before: VersionSnapshot, after: VersionSnapshot): VersionDiff {
  const spec = diffMaps(flattenSpec(before.spec), flattenSpec(after.spec));

  const canvas = diffEntries(
    before.canvas,
    after.canvas,
    (object) => object.id,
    (object) => object.label ?? object.type,
    canvasFields,
    'One of these versions has no canvas snapshot, so the design cannot be compared.'
  );

  const materials = diffEntries(
    before.materials,
    after.materials,
    (material) => material.materialId,
    (material) => material.name,
    materialFields,
    'One of these versions has no material snapshot, so the materials cannot be compared.'
  );

  const costComparable = before.cost !== null && after.cost !== null;
  const cost = costComparable ? diffMaps(costFields(before.cost!), costFields(after.cost!)) : [];
  const costUnavailableReason = costComparable
    ? null
    : 'One of these versions has no cost snapshot, so the cost cannot be compared.';

  const references =
    before.references !== null && after.references !== null
      ? diffMaps(referenceFields(before.references), referenceFields(after.references))
      : [];

  return {
    spec,
    canvas,
    materials,
    cost,
    costUnavailableReason,
    references,
    identical:
      spec.length === 0 &&
      canvas.entries.length === 0 &&
      materials.entries.length === 0 &&
      cost.length === 0 &&
      references.length === 0,
  };
}
