import { describe, expect, it } from 'vitest';
import { calculateLinearPlan } from './linear';
import { renderLinearPlan } from './linear-render';

const settings = { stockLengthMm: 6000, kerfMm: 0, minUsableRemnantMm: 500 };

describe('renderLinearPlan', () => {
  it('renders nothing for an empty plan', () => {
    expect(renderLinearPlan(calculateLinearPlan([], settings))).toBe('');
  });

  it('labels each bar', () => {
    const svg = renderLinearPlan(
      calculateLinearPlan([{ id: 'a', lengthMm: 4000, quantity: 3 }], settings)
    );
    expect(svg).toContain('Bar 1');
    expect(svg).toContain('Bar 3');
  });

  it('is deterministic', () => {
    const build = () =>
      renderLinearPlan(calculateLinearPlan([{ id: 'a', lengthMm: 2000, quantity: 4 }], settings));
    expect(build()).toBe(build());
  });

  it('escapes labels so they cannot inject markup', () => {
    const svg = renderLinearPlan(
      calculateLinearPlan([{ id: 'a', label: '<script>x</script>', lengthMm: 5000, quantity: 1 }], settings)
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('drops a caption that would overflow a narrow cut', () => {
    // A 200mm cut cannot hold "Renfort long name · 200" without spilling over
    // its neighbour and making both unreadable.
    const svg = renderLinearPlan(
      calculateLinearPlan(
        [{ id: 'a', label: 'Renfort long name', lengthMm: 200, quantity: 1 }],
        settings
      )
    );
    expect(svg).not.toContain('Renfort long name');
  });

  it('keeps a caption that fits comfortably', () => {
    const svg = renderLinearPlan(
      calculateLinearPlan([{ id: 'a', label: 'Montant', lengthMm: 2800, quantity: 1 }], settings)
    );
    expect(svg).toContain('Montant');
  });

  it('marks a keepable remnant differently from scrap', () => {
    const keep = renderLinearPlan(
      calculateLinearPlan([{ id: 'a', lengthMm: 4000, quantity: 1 }], settings)
    );
    const scrap = renderLinearPlan(
      calculateLinearPlan([{ id: 'a', lengthMm: 5900, quantity: 1 }], settings)
    );
    expect(keep).toContain('(keep)');
    expect(scrap).toContain('(scrap)');
  });
});
