import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { createProjectSchema } from '@/lib/projects/schema';
import { createProject, listProjects } from '@/lib/projects/service';

// GET /api/projects — list the signed-in user's projects.
// ?includeArchived=true also returns archived projects.
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const includeArchived = req.nextUrl.searchParams.get('includeArchived') === 'true';
    const projects = await listProjects(user.id, { includeArchived });
    return { projects };
  });
}

// POST /api/projects — create a project { title }
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const input = createProjectSchema.parse(await readJson(req));
    const project = await createProject(user.id, input);
    return { project };
  });
}
