import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { updateQuoteSchema } from '@/lib/quotes/schema';
import { deleteQuote, getQuoteView, updateQuote } from '@/lib/quotes/service';

type RouteContext = { params: Promise<{ id: string; quoteId: string }> };

// GET /api/projects/:id/quotes/:quoteId
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { quoteId } = await params;
    return getQuoteView(quoteId, user.id);
  });
}

// PATCH /api/projects/:id/quotes/:quoteId — drafts only
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { quoteId } = await params;
    const input = updateQuoteSchema.parse(await readJson(req));
    return { quote: await updateQuote(quoteId, user.id, input) };
  });
}

// DELETE /api/projects/:id/quotes/:quoteId — drafts only
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { quoteId } = await params;
    await deleteQuote(quoteId, user.id);
    return { deleted: true };
  });
}
