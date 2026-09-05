import { describe, expect, it } from 'vitest';
import { normalizeSslMode } from './db-url';

const NEON = 'postgresql://user:pass@ep-x-pooler.eu-central-1.aws.neon.tech/neondb';

describe('normalizeSslMode', () => {
  it('upgrades the modes pg 9 will weaken', () => {
    for (const mode of ['require', 'prefer', 'verify-ca']) {
      expect(normalizeSslMode(`${NEON}?sslmode=${mode}`)).toContain('sslmode=verify-full');
    }
  });

  it('preserves other query parameters, including channel_binding', () => {
    const out = normalizeSslMode(`${NEON}?sslmode=require&channel_binding=require`);
    expect(out).toContain('sslmode=verify-full');
    expect(out).toContain('channel_binding=require');
  });

  it('leaves verify-full and disable untouched', () => {
    expect(normalizeSslMode(`${NEON}?sslmode=verify-full`)).toBe(`${NEON}?sslmode=verify-full`);
    expect(normalizeSslMode(`${NEON}?sslmode=disable`)).toBe(`${NEON}?sslmode=disable`);
  });

  it('leaves a string with no sslmode untouched', () => {
    expect(normalizeSslMode(NEON)).toBe(NEON);
  });

  it('respects an explicit libpq-compatibility opt-in', () => {
    const input = `${NEON}?sslmode=require&uselibpqcompat=true`;
    expect(normalizeSslMode(input)).toBe(input);
  });

  it('returns unparseable strings unchanged rather than throwing', () => {
    expect(normalizeSslMode('host=localhost dbname=neondb sslmode=require')).toBe(
      'host=localhost dbname=neondb sslmode=require'
    );
  });

  it('does not alter the credentials or host', () => {
    const out = new URL(normalizeSslMode(`${NEON}?sslmode=require`));
    expect(out.username).toBe('user');
    expect(out.hostname).toBe('ep-x-pooler.eu-central-1.aws.neon.tech');
    expect(out.pathname).toBe('/neondb');
  });
});
