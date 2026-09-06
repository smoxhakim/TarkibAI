import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { costSettingsSchema } from '@/lib/calc/costs/schema';
import { getCostSettings, updateCostSettings } from '@/lib/calc/costs/service';

// GET /api/cost-settings — the signed-in user's private costing rules
export async function GET(_req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    return { settings: await getCostSettings(user.id) };
  });
}

// PUT /api/cost-settings
export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const input = costSettingsSchema.parse(await readJson(req));
    return { settings: await updateCostSettings(user.id, input) };
  });
}
