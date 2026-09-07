import { NextResponse, type NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { ApiError } from '@/lib/http/api';
import { getQuoteView, quoteDownloadUrl, renderQuote } from '@/lib/quotes/service';

type RouteContext = { params: Promise<{ id: string; quoteId: string }> };

export const maxDuration = 60;

/**
 * GET /api/projects/:id/quotes/:quoteId/pdf
 *
 * An issued quote redirects to the stored document: the file a client received
 * is the record, and re-rendering it could produce something subtly different.
 * A draft has no stored file, so it is rendered on the spot and streamed — that
 * preview is explicitly watermarked, and nothing is kept.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requireDbUser();
    const { quoteId } = await params;
    const { quote } = await getQuoteView(quoteId, user.id);

    if (quote.status === 'issued' && quote.pdfObjectKey) {
      return NextResponse.redirect(await quoteDownloadUrl(quoteId, user.id), {
        status: 307,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const pdf = await renderQuote(quoteId, user.id);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${quote.number}-draft.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[quotes/pdf] unhandled error', error);
    return NextResponse.json({ error: 'Internal server error', code: 'internal' }, { status: 500 });
  }
}
