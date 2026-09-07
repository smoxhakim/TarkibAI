import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { issueQuote } from '@/lib/quotes/service';

type RouteContext = { params: Promise<{ id: string; quoteId: string }> };

// Rendering and storing a PDF is slower than a plain write, though still well
// inside a normal request.
export const maxDuration = 60;

// POST /api/projects/:id/quotes/:quoteId/issue
export async function POST(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { quoteId } = await params;
    return { quote: await issueQuote(quoteId, user.id) };
  });
}
