import { NextResponse, type NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { ApiError } from '@/lib/http/api';
import { productionDownloadUrl } from '@/lib/production/service';

type RouteContext = { params: Promise<{ id: string; documentId: string }> };

/**
 * GET /api/projects/:id/production/:documentId/pdf
 *
 * Ownership is checked, then the request is redirected to a short-lived signed
 * R2 URL. The stored file is the record: a package on a workshop bench and the
 * package in the system must be the same document.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireDbUser();
    const { documentId } = await params;
    return NextResponse.redirect(await productionDownloadUrl(documentId, user.id), {
      status: 307,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[production/pdf] unhandled error', error);
    return NextResponse.json({ error: 'Internal server error', code: 'internal' }, { status: 500 });
  }
}
