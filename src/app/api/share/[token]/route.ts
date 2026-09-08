import type { NextRequest } from 'next/server';
import { handleRoute } from '@/lib/http/api';
import { getShareView, recordShareView } from '@/lib/collaboration/service';

type RouteContext = { params: Promise<{ token: string }> };

/**
 * GET /api/share/:token
 *
 * DELIBERATELY UNAUTHENTICATED. The token is the whole credential, which is why
 * the payload it returns is built client-safe by construction rather than
 * filtered — it has to be safe assuming the link has been forwarded to somebody
 * the sender never intended.
 *
 * No `requireDbUser` here on purpose: a client has no account, and adding one
 * would defeat the point of a link you can send to somebody.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const { token } = await params;
    const view = await getShareView(token);
    await recordShareView(token);
    return view;
  });
}
