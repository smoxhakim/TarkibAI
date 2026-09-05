import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { getSpec } from '@/lib/spec/service';
import type { SpecView } from '@/lib/spec/service';
import { HISTORY_WINDOW, isAiConfigured } from './config';
import { runAgent } from './agent';
import { TARKIB_SYSTEM_PROMPT, buildSpecStateMessage } from './prompts/system';
import { buildToolbox } from './tools';

export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
};

export type ConversationTurn = {
  userMessage: ChatMessageView;
  assistantMessage: ChatMessageView;
  spec: SpecView;
};

const aiUnavailable = () =>
  new ApiError(
    503,
    'The AI assistant is not configured on this server. Set OPENAI_API_KEY to enable the conversation.',
    'ai_not_configured'
  );

export async function listMessages(projectId: string, userId: string): Promise<ChatMessageView[]> {
  await assertProjectAccess(projectId, userId);
  const rows = await prisma.chatMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    createdAt: row.createdAt,
  }));
}

/**
 * Runs one turn of the intake conversation.
 *
 * Context sent to the model is rebuilt each turn from two sources: the recent
 * plain-text messages, and the CURRENT structured specification. The spec is
 * injected fresh rather than replayed from history, because the spec is the
 * source of truth (PRD §9) — this keeps the agent correct even after older
 * messages fall outside the history window.
 */
export async function runConversationTurn(
  projectId: string,
  userId: string,
  content: string
): Promise<ConversationTurn> {
  await assertProjectAccess(projectId, userId);
  if (!isAiConfigured()) throw aiUnavailable();

  const history = await prisma.chatMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_WINDOW,
  });
  history.reverse();

  const specBefore = await getSpec(projectId, userId);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: TARKIB_SYSTEM_PROMPT },
    { role: 'system', content: buildSpecStateMessage(specBefore.spec, specBefore.missing) },
    ...history.map((row) => ({
      role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: row.content,
    })),
    { role: 'user', content },
  ];

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await runAgent(client, messages, buildToolbox(projectId, userId));

  const text =
    result.text ||
    // The model returned tool calls but no prose. Better to say so than to
    // persist an empty bubble the user cannot interpret.
    'Ma9dertch njaweb daba. 3awd jarreb 3afak. (I could not produce a reply just now — please try again.)';

  // Persisted only after the agent succeeds, so a failed turn does not leave the
  // user's message stranded in a conversation that was never answered.
  const [userMessage, assistantMessage] = await prisma.$transaction([
    prisma.chatMessage.create({ data: { projectId, role: 'user', content } }),
    prisma.chatMessage.create({
      data: {
        projectId,
        role: 'assistant',
        content: text,
        toolCalls: result.toolCalls.length > 0 ? (result.toolCalls as object) : undefined,
      },
    }),
  ]);

  return {
    userMessage: {
      id: userMessage.id,
      role: 'user',
      content: userMessage.content,
      createdAt: userMessage.createdAt,
    },
    assistantMessage: {
      id: assistantMessage.id,
      role: 'assistant',
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
    },
    spec: await getSpec(projectId, userId),
  };
}
