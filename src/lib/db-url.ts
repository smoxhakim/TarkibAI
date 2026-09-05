/**
 * Neon hands out connection strings containing `sslmode=require`.
 *
 * `pg` >= 8.16 currently treats `require`, `prefer`, and `verify-ca` as aliases
 * for `verify-full`, but emits a process warning saying that in pg 9 they will
 * adopt libpq semantics instead — which do NOT verify the server certificate.
 * Node surfaces that warning in Next's dev overlay as a blocking issue.
 *
 * Rewriting the mode to `verify-full` keeps exactly today's behaviour, states
 * the intent explicitly, and means the security guarantee will not silently
 * weaken when pg 9 lands. It is applied in code rather than in .env so that a
 * string pasted straight from the Neon dashboard works in every environment.
 */
const WEAKER_IN_PG9 = new Set(['require', 'prefer', 'verify-ca']);

export function normalizeSslMode(connectionString: string): string {
  // Not a URL we can parse (e.g. a libpq keyword/value string) — leave it alone.
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }

  const sslmode = url.searchParams.get('sslmode');
  if (sslmode === null) return connectionString;

  // The caller explicitly opted into libpq semantics; respect that.
  if (url.searchParams.get('uselibpqcompat') === 'true') return connectionString;

  if (!WEAKER_IN_PG9.has(sslmode)) return connectionString;

  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
