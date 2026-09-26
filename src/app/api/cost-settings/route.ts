import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { costSettingsSchema } from '@/lib/calc/costs/schema';
import { getCostSettings, updateCostSettings } from '@/lib/calc/costs/service';
import { assertWorkspacePermission, resolveActiveWorkspace } from '@/lib/workspaces/access';

// GET /api/cost-settings — the signed-in user's private costing rules
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    return { settings: await getCostSettings(workspaceId) };
  });
}

// PUT /api/cost-settings
export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const input = costSettingsSchema.parse(await readJson(req));
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    // Costing rules are the business's, so changing them is a permission. The
    // service asserts it too — this stays so the route reads as guarded.
    await assertWorkspacePermission(workspaceId, user.id, 'cost.manage');
    return { settings: await updateCostSettings(workspaceId, user.id, input) };
  });
}
