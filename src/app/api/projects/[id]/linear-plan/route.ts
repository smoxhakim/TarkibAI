import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { calculateLinearSchema } from '@/lib/calc/cutting/schema';
import { calculateLinearCutPlan, listLinearPlans } from '@/lib/calc/cutting/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/linear-plan
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { plans: await listLinearPlans(id, user.id) };
  });
}

// POST /api/projects/:id/linear-plan — compute the bar cut plan for one material
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = calculateLinearSchema.parse(await readJson(req));
    return calculateLinearCutPlan(id, user.id, input);
  });
}
