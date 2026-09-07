import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createQuoteSchema } from '@/lib/quotes/schema';
import { createQuote, listQuotes } from '@/lib/quotes/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/quotes
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { quotes: await listQuotes(id, user.id) };
  });
}

// POST /api/projects/:id/quotes — a draft seeded from the calculated cost
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = createQuoteSchema.parse(await readJson(req));
    return { quote: await createQuote(id, user.id, input) };
  });
}
