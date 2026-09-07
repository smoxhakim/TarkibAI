import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { quoteSettingsSchema } from '@/lib/quotes/schema';
import { getQuoteSettings, updateQuoteSettings } from '@/lib/quotes/settings-service';

// GET /api/quote-settings — the company identity printed on this user's quotes
export async function GET(_req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    return { settings: await getQuoteSettings(user.id) };
  });
}

// PUT /api/quote-settings
export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const input = quoteSettingsSchema.parse(await readJson(req));
    return { settings: await updateQuoteSettings(user.id, input) };
  });
}
