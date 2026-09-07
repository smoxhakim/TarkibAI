import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { generateProductionSchema } from '@/lib/production/schema';
import { generateProductionDocument, getProductionView } from '@/lib/production/service';

type RouteContext = { params: Promise<{ id: string }> };

// Rasterising a drawing and several cutting plans takes longer than a plain
// write, though still well inside a request.
export const maxDuration = 60;

// GET /api/projects/:id/production — packages, blockers and gaps
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return getProductionView(id, user.id);
  });
}

// POST /api/projects/:id/production — generate the next numbered package
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const { notes } = generateProductionSchema.parse(await readJson(req));
    return { document: await generateProductionDocument(id, user.id, { notes }) };
  });
}
