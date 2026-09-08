import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { quoteSettingsSchema } from '@/lib/quotes/schema';
import { getQuoteSettings, updateQuoteSettings } from '@/lib/quotes/settings-service';
import { assertWorkspacePermission, resolveActiveWorkspace } from '@/lib/workspaces/access';

// GET /api/quote-settings — the company identity printed on this user's quotes
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    return { settings: await getQuoteSettings(workspaceId) };
  });
}

// PUT /api/quote-settings
export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const input = quoteSettingsSchema.parse(await readJson(req));
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    await assertWorkspacePermission(workspaceId, user.id, 'quote.create');
    return { settings: await updateQuoteSettings(workspaceId, input) };
  });
}
