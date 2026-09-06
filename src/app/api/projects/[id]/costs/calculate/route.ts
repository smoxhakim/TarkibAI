import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { calculateCostSchema } from '@/lib/calc/costs/schema';
import { computeProjectCost } from '@/lib/calc/costs/service';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/projects/:id/costs/calculate
// Refused until materials are calculated — percentages apply to material cost.
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const body = await readJson(req).catch(() => ({}));
    const input = calculateCostSchema.parse(body ?? {});
    return { cost: await computeProjectCost(id, user.id, input.manualOverrides) };
  });
}
