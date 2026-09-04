import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/**
 * Error type carrying an HTTP status. Thrown by service-layer code so route
 * handlers never have to build status codes by hand.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error'
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, `${what} not found`, 'not_found');
export const unauthorized = () => new ApiError(401, 'Authentication required', 'unauthorized');
export const forbidden = () => new ApiError(403, 'You do not have access to this resource', 'forbidden');
export const badRequest = (message: string) => new ApiError(400, message, 'bad_request');

/**
 * Wraps a route handler so every failure produces a structured JSON response
 * instead of an unhandled 500 with a stack trace.
 *
 * Ownership failures are deliberately reported as 404, not 403: telling an
 * unauthorised caller that a project *exists* leaks the existence of another
 * user's data. See `assertProjectAccess` in lib/projects/service.ts.
 */
export async function handleRoute<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          code: 'validation_failed',
          issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 422 }
      );
    }
    // Unexpected: log server-side, return an opaque message. Sentry is wired in a later phase.
    console.error('[api] unhandled error', error);
    return NextResponse.json({ error: 'Internal server error', code: 'internal' }, { status: 500 });
  }
}

/** Parses a JSON body, converting malformed JSON into a 400 rather than a 500. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
}
