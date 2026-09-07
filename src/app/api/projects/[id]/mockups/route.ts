import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { listMockups, requestMockup } from '@/lib/mockup/service';

type RouteContext = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  kind: z.enum(['concept', 'site']),
  sourceFileId: z.string().uuid().nullable().optional(),
});

// GET /api/projects/:id/mockups — gallery and history, newest first
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const mockups = await listMockups(id, user.id);
    return {
      mockups: mockups.map((mockup) => ({
        id: mockup.id,
        kind: mockup.kind,
        status: mockup.status,
        prompt: mockup.prompt,
        model: mockup.model,
        failureReason: mockup.failureReason,
        hasImage: mockup.resultObjectKey !== null,
        createdAt: mockup.createdAt,
      })),
    };
  });
}

// POST /api/projects/:id/mockups — queue a generation; returns immediately
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = requestSchema.parse(await readJson(req));
    const mockup = await requestMockup(id, user.id, {
      kind: input.kind,
      sourceFileId: input.sourceFileId ?? null,
    });
    return { mockup: { id: mockup.id, status: mockup.status, kind: mockup.kind } };
  });
}
