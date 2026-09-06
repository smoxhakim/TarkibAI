import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { sceneCommandSchema } from '@/lib/canvas/schema';
import { applyCommands, getScene } from '@/lib/canvas/service';

type RouteContext = { params: Promise<{ id: string }> };

const commandsSchema = z.object({
  commands: z.array(sceneCommandSchema).min(1).max(50),
});

// GET /api/projects/:id/canvas — the structured scene
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return getScene(id, user.id);
  });
}

// POST /api/projects/:id/canvas — apply scene commands { commands: [...] }
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const { commands } = commandsSchema.parse(await readJson(req));
    return applyCommands(id, user.id, commands);
  });
}
