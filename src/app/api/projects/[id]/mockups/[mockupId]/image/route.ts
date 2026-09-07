import { NextResponse, type NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { ApiError } from '@/lib/http/api';
import { getMockupImageUrl } from '@/lib/mockup/service';

type RouteContext = { params: Promise<{ id: string; mockupId: string }> };

/**
 * GET /api/projects/:id/mockups/:mockupId/image
 *
 * Ownership is checked, then the request is redirected to a short-lived signed
 * R2 URL — the same pattern as project files. A generated mockup is private
 * client-facing artwork, not a public asset.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireDbUser();
    const { id, mockupId } = await params;
    const url = await getMockupImageUrl(id, user.id, mockupId);
    return NextResponse.redirect(url, {
      status: 307,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[mockups/image] unhandled error', error);
    return NextResponse.json({ error: 'Internal server error', code: 'internal' }, { status: 500 });
  }
}
