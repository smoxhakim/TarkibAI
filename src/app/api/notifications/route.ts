import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { listNotifications, markNotificationsRead } from '@/lib/collaboration/service';

// GET /api/notifications — the caller's own, newest first
export async function GET(_req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    return { notifications: await listNotifications(user.id) };
  });
}

// POST /api/notifications — mark read. Body { ids } or empty for all.
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const body = (await readJson(req).catch(() => ({}))) as { ids?: string[] };
    return { marked: await markNotificationsRead(user.id, body?.ids) };
  });
}
