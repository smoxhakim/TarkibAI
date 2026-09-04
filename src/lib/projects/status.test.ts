import { describe, expect, it } from 'vitest';
import { PROJECT_STAGES, canTransition, displayStatus, isProjectStage } from './status';

describe('isProjectStage', () => {
  it('accepts every declared stage', () => {
    for (const stage of PROJECT_STAGES) expect(isProjectStage(stage)).toBe(true);
  });

  it('rejects "archived", which is tracked by archivedAt rather than status', () => {
    expect(isProjectStage('archived')).toBe(false);
  });

  it('rejects unknown values', () => {
    expect(isProjectStage('')).toBe(false);
    expect(isProjectStage('production-ready')).toBe(false);
  });
});

describe('canTransition', () => {
  it('allows advancing exactly one stage', () => {
    expect(canTransition('intake', 'spec_approved')).toBe(true);
    expect(canTransition('calculated', 'quoted')).toBe(true);
  });

  it('refuses skipping a stage, because each stage consumes the previous output', () => {
    expect(canTransition('intake', 'calculated')).toBe(false);
    expect(canTransition('intake', 'production_ready')).toBe(false);
  });

  it('allows moving backwards, which is how stale derived data is handled', () => {
    expect(canTransition('quoted', 'intake')).toBe(true);
    expect(canTransition('production_ready', 'calculated')).toBe(true);
  });

  it('treats staying put as valid', () => {
    for (const stage of PROJECT_STAGES) expect(canTransition(stage, stage)).toBe(true);
  });
});

describe('displayStatus', () => {
  it('reports archived regardless of the underlying stage', () => {
    expect(displayStatus({ status: 'quoted', archivedAt: new Date() })).toBe('archived');
  });

  it('preserves the stage of a non-archived project', () => {
    expect(displayStatus({ status: 'quoted', archivedAt: null })).toBe('quoted');
  });

  it('falls back to intake for values not in the stage list', () => {
    expect(displayStatus({ status: 'nonsense', archivedAt: null })).toBe('intake');
  });
});
