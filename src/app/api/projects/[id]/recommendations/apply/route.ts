import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { applyMaterialSwitch, getRecommendations } from '@/lib/calc/efficiency/service';

type RouteContext = { params: Promise<{ id: string }> };

const applySchema = z.object({
  fromMaterialId: z.string().uuid(),
  toMaterialId: z.string().uuid(),
});

/**
 * POST /api/projects/:id/recommendations/apply
 *
 * Switches the project's pieces and cuts to the alternative material. The user's
 * click is the approval required by PRD §13; the change itself is a plain
 * deterministic reassignment, and the cutting plan is regenerated afterwards.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = applySchema.parse(await readJson(req));
    await applyMaterialSwitch(id, user.id, input.fromMaterialId, input.toMaterialId);
    return getRecommendations(id, user.id);
  });
}
