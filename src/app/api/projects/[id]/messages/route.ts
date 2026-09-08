import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { listMessages, runConversationTurn } from '@/lib/ai/conversation-service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A tool-calling turn against a reasoning model can legitimately take a while.
 *
 * 60 is the ceiling on Vercel's Hobby plan, and a value above it fails the
 * build rather than degrading — so this is the most the deployment allows, not
 * the most the work wants. A long Darija turn that runs several tool calls can
 * exceed it and will return a timeout; raise this to 300 on Pro if that starts
 * happening in practice.
 */
export const maxDuration = 60;

const sendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Write a message first.').max(4000),
  // Ids are re-checked against the project server-side, so an id from another
  // project cannot be smuggled in here.
  attachmentFileIds: z.array(z.string().uuid()).max(10).optional(),
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
    const { content, attachmentFileIds } = sendMessageSchema.parse(await readJson(req));
    return runConversationTurn(id, user.id, content, attachmentFileIds ?? []);
  });
}
