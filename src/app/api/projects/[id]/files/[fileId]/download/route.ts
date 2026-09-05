import { NextResponse, type NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { ApiError } from '@/lib/http/api';
import { getFileDownloadUrl } from '@/lib/files/service';

type RouteContext = { params: Promise<{ id: string; fileId: string }> };

/**
 * GET /api/projects/:id/files/:fileId/download
 *
 * Checks ownership, then redirects to a short-lived signed R2 URL. The signed
 * URL is never stored and never returned in a listing, so possession of a file
 * id alone grants nothing without a valid session.
 *
 * ?download=1 sets a Content-Disposition attachment header; otherwise the file
 * renders inline, which is what the image previews use.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireDbUser();
    const { id, fileId } = await params;
    const asAttachment = req.nextUrl.searchParams.get('download') === '1';
    const url = await getFileDownloadUrl(id, user.id, fileId, { asAttachment });

    // 307 keeps the method and prevents any intermediary caching the redirect,
    // which would outlive the signature.
    return NextResponse.redirect(url, {
      status: 307,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[files/download] unhandled error', error);
    return NextResponse.json({ error: 'Internal server error', code: 'internal' }, { status: 500 });
  }
}
