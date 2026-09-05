import type { ProjectSpecData, ProjectSpecPatch } from './schema';
import { SPEC_VERSION } from './schema';

/**
 * Applies a patch to a specification. Deterministic and pure — the model
 * proposes the patch, but this function alone decides what the spec becomes.
 *
 * Rules:
 *  - A key absent from the patch leaves the existing value untouched. This is
 *    what makes it safe for the agent to send a small patch each turn without
 *    silently erasing facts the user established earlier.
 *  - An explicit `null` clears the field. This is the only way to unset
 *    something, so "the user changed their mind" is expressible.
 *  - Nested objects (dimensions, lighting, mounting, site, lettering) merge
 *    key by key, so setting a width does not wipe a known height.
 *  - Arrays (materials, components) are REPLACED wholesale, not concatenated.
 *    Merging them would make removing one item impossible and would duplicate
 *    entries every time the agent restates the list.
 */
const NESTED_OBJECT_KEYS = ['dimensions', 'lighting', 'mounting', 'site', 'lettering'] as const;

type NestedKey = (typeof NESTED_OBJECT_KEYS)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeSpec(current: ProjectSpecData, patch: ProjectSpecPatch): ProjectSpecData {
  const next: Record<string, unknown> = { ...current, specVersion: SPEC_VERSION };

  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue;

    if (patchValue === null) {
      delete next[key];
      continue;
    }

    if ((NESTED_OBJECT_KEYS as readonly string[]).includes(key) && isPlainObject(patchValue)) {
      const existing = current[key as NestedKey];
      const base = isPlainObject(existing) ? existing : {};
      const merged: Record<string, unknown> = { ...base };

      for (const [nestedKey, nestedValue] of Object.entries(patchValue)) {
        if (nestedValue === undefined) continue;
        if (nestedValue === null) delete merged[nestedKey];
        else merged[nestedKey] = nestedValue;
      }

      if (Object.keys(merged).length === 0) delete next[key];
      else next[key] = merged;
      continue;
    }

    next[key] = patchValue;
  }

  return next as ProjectSpecData;
}
