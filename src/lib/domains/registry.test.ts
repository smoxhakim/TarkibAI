import { describe, expect, it } from 'vitest';
import { ALL_SPEC_FIELDS } from '@/lib/spec/completeness';
import { OBJECT_TYPES } from '@/lib/canvas/schema';
import { emptySpec } from '@/lib/spec/schema';
import { missingFields } from '@/lib/spec/completeness';
import { DEFAULT_DOMAIN_ID, DOMAINS, JOINERY, SIGNAGE, getDomain, isKnownDomain } from './registry';

/**
 * Invariants every domain must hold.
 *
 * These run over the whole registry rather than over one profile, so a domain
 * added later cannot quietly require a field nothing reads, offer a canvas
 * object the scene schema does not understand, or set bounds that make an
 * ordinary project look implausible.
 */
describe('every domain profile', () => {
  it.each(DOMAINS.map((domain) => [domain.id, domain] as const))(
    '%s requires only fields the specification can answer',
    (_id, domain) => {
      for (const field of domain.requiredSpecFields) {
        expect(ALL_SPEC_FIELDS).toContain(field);
      }
    }
  );

  it.each(DOMAINS.map((domain) => [domain.id, domain] as const))(
    '%s offers only canvas objects the scene schema understands',
    (_id, domain) => {
      expect(domain.canvasObjectTypes.length).toBeGreaterThan(0);
      for (const type of domain.canvasObjectTypes) {
        expect(OBJECT_TYPES).toContain(type);
      }
    }
  );

  it.each(DOMAINS.map((domain) => [domain.id, domain] as const))(
    '%s reports every required field missing from an empty specification',
    (_id, domain) => {
      // The completeness reader must know where each required field lives; a
      // field with no reader would silently never be asked for.
      expect(missingFields(emptySpec(), domain.requiredSpecFields).sort()).toEqual(
        [...domain.requiredSpecFields].sort()
      );
    }
  );

  it.each(DOMAINS.map((domain) => [domain.id, domain] as const))(
    '%s has plausibility bounds wide enough for ordinary work',
    (_id, domain) => {
      const { implausiblyLargeMm, implausiblySmallMm, extremeAspectRatio } = domain.dimensionBounds;

      expect(implausiblySmallMm).toBeLessThan(implausiblyLargeMm);
      // A metre is ordinary in every fabrication trade. A bound that flags it
      // would make the warning meaningless by firing constantly.
      expect(implausiblyLargeMm).toBeGreaterThanOrEqual(1_000);
      expect(implausiblySmallMm).toBeLessThanOrEqual(100);
      expect(extremeAspectRatio).toBeGreaterThan(1);
    }
  );

  it.each(DOMAINS.map((domain) => [domain.id, domain] as const))(
    '%s says enough for a person and for the model',
    (_id, domain) => {
      expect(domain.label.length).toBeGreaterThan(0);
      expect(domain.description.length).toBeGreaterThan(0);
      expect(domain.noun.singular.length).toBeGreaterThan(0);
      expect(domain.projectTypeExamples.length).toBeGreaterThan(0);
      expect(domain.promptGuidance.length).toBeGreaterThan(50);
      expect(domain.mockupSubject.length).toBeGreaterThan(0);
    }
  );

  it('has unique ids', () => {
    const ids = DOMAINS.map((domain) => domain.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getDomain', () => {
  it('returns the profile for a known id', () => {
    expect(getDomain('joinery')).toBe(JOINERY);
    expect(getDomain('signage')).toBe(SIGNAGE);
  });

  it('falls back to signage rather than throwing', () => {
    // A project row from a build that knew a domain this one does not must
    // still open. Signage is the default and the stricter set.
    expect(getDomain('woodturning')).toBe(SIGNAGE);
    expect(getDomain(null)).toBe(SIGNAGE);
    expect(getDomain(undefined)).toBe(SIGNAGE);
  });

  it('reports which ids are real', () => {
    expect(isKnownDomain('signage')).toBe(true);
    expect(isKnownDomain('woodturning')).toBe(false);
  });

  it('defaults to signage, which is what every pre-T17 project is', () => {
    expect(DEFAULT_DOMAIN_ID).toBe('signage');
  });
});

describe('signage keeps the behaviour it shipped with', () => {
  it('requires exactly the fields that were hard-coded before T17', () => {
    expect([...SIGNAGE.requiredSpecFields]).toEqual([
      'projectType',
      'dimensions.width',
      'dimensions.height',
      'dimensions.unit',
      'quantity',
      'materials',
      'lighting.type',
      'mounting.method',
      'site.environment',
    ]);
  });

  it('keeps the bounds that were hard-coded before T17', () => {
    expect(SIGNAGE.dimensionBounds.implausiblyLargeMm).toBe(100_000);
    expect(SIGNAGE.dimensionBounds.implausiblySmallMm).toBe(10);
    expect(SIGNAGE.dimensionBounds.extremeAspectRatio).toBe(50);
  });
});

describe('joinery differs from signage where the trade differs', () => {
  it('does not require a lighting decision', () => {
    // The point of the framework: a wardrobe should not be blocked on a
    // question its trade does not ask.
    expect(SIGNAGE.requiredSpecFields).toContain('lighting.type');
    expect(JOINERY.requiredSpecFields).not.toContain('lighting.type');
  });

  it('still requires everything the engines downstream need', () => {
    // Materials, dimensions and quantity feed calculation, cutting and cost in
    // every trade. A domain that dropped one would produce a project that can
    // be approved but not calculated.
    for (const field of ['dimensions.width', 'dimensions.height', 'dimensions.unit', 'quantity', 'materials'] as const) {
      for (const domain of DOMAINS) {
        expect(domain.requiredSpecFields).toContain(field);
      }
    }
  });

  it('does not offer lettering or lighting on the canvas', () => {
    expect(JOINERY.canvasObjectTypes).not.toContain('lettering');
    expect(JOINERY.canvasObjectTypes).not.toContain('light');
    expect(SIGNAGE.canvasObjectTypes).toContain('lettering');
  });

  it('treats a smaller dimension as the point where work looks implausible', () => {
    expect(JOINERY.dimensionBounds.implausiblyLargeMm).toBeLessThan(
      SIGNAGE.dimensionBounds.implausiblyLargeMm
    );
  });
});
