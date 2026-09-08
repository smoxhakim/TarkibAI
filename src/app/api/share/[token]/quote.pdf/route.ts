import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@/lib/http/api';
import { shareQuotePdfKey } from '@/lib/collaboration/service';

type RouteContext = { params: Promise<{ token: string }> };

/**
 * GET /api/share/:token/quote.pdf
 *
 * Redirects to a short-lived signed URL for the issued quote. The client never
 * sees an object key, and the signed URL expires — so forwarding the PDF link
 * on its own stops working, while the share link keeps working until it is
 * withdrawn.
 *
 * The share's own `includeQuote` flag decides whether this resolves at all.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params;
    const objectKey = await shareQuotePdfKey(token);

    const { createSignedDownloadUrl } = await import('@/lib/storage/r2');
    const url = await createSignedDownloadUrl(objectKey, { downloadName: 'quotation.pdf' });

    return NextResponse.redirect(url, {
      status: 307,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[share/quote] unhandled error', error);
    return NextResponse.json({ error: 'Internal server error', code: 'internal' }, { status: 500 });
  }
}
