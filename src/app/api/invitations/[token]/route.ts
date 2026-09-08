import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { acceptInvitation, describeInvitation } from '@/lib/workspaces/service';

type RouteContext = { params: Promise<{ token: string }> };

// GET /api/invitations/:token — what the invitation is for
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    await requireDbUser();
    const { token } = await params;
    return describeInvitation(token);
  });
}

// POST /api/invitations/:token — accept it as the signed-in account
export async function POST(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { token } = await params;
    return { member: await acceptInvitation(token, user.id) };
  });
}
