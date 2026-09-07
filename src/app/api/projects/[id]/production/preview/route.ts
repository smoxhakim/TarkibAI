import { NextResponse, type NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { ApiError } from '@/lib/http/api';
import { getProductionView, renderProductionDocument } from '@/lib/production/service';

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 60;

/**
 * GET /api/projects/:id/production/preview
 *
 * Renders what the next package would contain, without numbering or storing
 * anything. Seeing the gaps on the page before committing a version number is
 * the point: a package is a document a workshop is meant to trust.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireDbUser();
    const { id } = await params;

    const view = await getProductionView(id, user.id);
    // Storage being unconfigured blocks generating, but not previewing: nothing
    // is stored either way.
    const blocking = view.blockers.filter((reason) => !reason.startsWith('File storage'));
    if (blocking.length > 0) throw new ApiError(400, blocking.join(' '), 'bad_request');

    const version = (view.documents[0]?.version ?? 0) + 1;
    const pdf = await renderProductionDocument(id, user.id, { version, notes: null });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="production-preview.pdf"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[production/preview] unhandled error', error);
    return NextResponse.json({ error: 'Internal server error', code: 'internal' }, { status: 500 });
  }
}
