import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { VIEW_KINDS } from '@/lib/drawings/project';
import { issueDrawing } from '@/lib/drawings/service';

type RouteContext = { params: Promise<{ id: string }> };

const issueSchema = z.object({
  kinds: z.array(z.enum(VIEW_KINDS)).min(1).optional(),
  label: z.string().trim().max(160).nullable().optional(),
});

// POST /api/projects/:id/drawings/issue — capture a numbered snapshot
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const body = await readJson(req).catch(() => ({}));
    const input = issueSchema.parse(body ?? {});
    const drawing = await issueDrawing(id, user.id, input);
    return {
      drawing: { id: drawing.id, version: drawing.version, label: drawing.label },
    };
  });
}
