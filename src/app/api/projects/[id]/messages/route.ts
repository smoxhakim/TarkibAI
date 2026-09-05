import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { listMessages, runConversationTurn } from '@/lib/ai/conversation-service';

type RouteContext = { params: Promise<{ id: string }> };

// A tool-calling turn against a reasoning model can legitimately take a while.
export const maxDuration = 120;

const sendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Write a message first.').max(4000),
});

// GET /api/projects/:id/messages — full conversation history
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { messages: await listMessages(id, user.id) };
  });
}

// POST /api/projects/:id/messages — run one intake turn { content }
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const { content } = sendMessageSchema.parse(await readJson(req));
    return runConversationTurn(id, user.id, content);
  });
}
