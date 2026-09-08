import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createWorkspaceSchema } from '@/lib/workspaces/schema';
import { createWorkspace, listWorkspacesFor } from '@/lib/workspaces/service';

// GET /api/workspaces — every workspace the caller belongs to
export async function GET(_req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    return { workspaces: await listWorkspacesFor(user.id) };
  });
}

// POST /api/workspaces — start a shared workspace. Anyone may; they own it.
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { name } = createWorkspaceSchema.parse(await readJson(req));
    return { workspace: await createWorkspace(user.id, name) };
  });
}
