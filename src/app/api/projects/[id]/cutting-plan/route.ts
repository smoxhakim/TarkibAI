import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { calculateCuttingSchema } from '@/lib/calc/cutting/schema';
import { calculatePlan, listPlans } from '@/lib/calc/cutting/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/cutting-plan — stored plans with their diagrams
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { plans: await listPlans(id, user.id) };
  });
}

// POST /api/projects/:id/cutting-plan — compute for one material
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = calculateCuttingSchema.parse(await readJson(req));
    return calculatePlan(id, user.id, input);
  });
}
