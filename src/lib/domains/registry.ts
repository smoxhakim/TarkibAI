import { JOINERY } from './joinery';
import { SIGNAGE } from './signage';
import type { DomainProfile } from './types';

/**
 * The domains a project can belong to.
 *
 * Signage is the default and stays the default: every project created before
 * T17 is one, and changing that silently would alter which fields those
 * projects require before approval.
 */
export const DOMAINS: readonly DomainProfile[] = [SIGNAGE, JOINERY];

export const DEFAULT_DOMAIN_ID = SIGNAGE.id;

const BY_ID = new Map(DOMAINS.map((domain) => [domain.id, domain]));

export const DOMAIN_IDS = DOMAINS.map((domain) => domain.id);

/**
 * The profile for an id, falling back to the default.
 *
 * Falls back rather than throwing. A project row carrying an id this build does
 * not know — a domain removed, or a database ahead of the code — should still
 * open, and signage's rules are the strictest superset in practice. The
 * fallback is logged so it does not pass unnoticed.
 */
export function getDomain(id: string | null | undefined): DomainProfile {
  if (!id) return SIGNAGE;
  const domain = BY_ID.get(id);
  if (domain) return domain;

  console.warn(`[domains] unknown domain "${id}", falling back to ${SIGNAGE.id}`);
  return SIGNAGE;
}

export function isKnownDomain(id: string): boolean {
  return BY_ID.has(id);
}

export type { DomainProfile } from './types';
export { SIGNAGE, JOINERY };
