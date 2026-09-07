import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { listIssuedDrawings, renderLiveDrawing } from '@/lib/drawings/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/drawings
 *
 * The live drawing, rendered from current data, plus the list of issued
 * versions. Live can never be stale; issued versions are the record.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const [live, issued] = await Promise.all([
      renderLiveDrawing(id, user.id),
      listIssuedDrawings(id, user.id),
    ]);
    return {
      live,
      issued: issued.map((drawing) => ({
        id: drawing.id,
        version: drawing.version,
        label: drawing.label,
        createdAt: drawing.createdAt,
      })),
    };
  });
}
