import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { getSpec } from '@/lib/spec/service';
import type { SpecView } from '@/lib/spec/service';
import { loadReadyFiles } from '@/lib/files/service';
import { HISTORY_WINDOW, IMAGE_CONTEXT_MESSAGES, isAiConfigured } from './config';
import { buildImageParts } from './vision';
import { runAgent } from './agent';
import { buildSpecStateMessage, buildSystemPrompt } from './prompts/system';
import { getDomain } from '@/lib/domains/registry';
import { buildToolbox } from './tools';

export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachmentFileIds: string[];
  createdAt: Date;
};

/** Reads the JSON attachment column defensively — it is untyped in the database. */
function readAttachmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

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
    attachmentFileIds: readAttachmentIds(row.attachmentFileIds),
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
  content: string,
  attachmentFileIds: string[] = []
): Promise<ConversationTurn> {
  const project = await assertProjectAccess(projectId, userId);
  if (!isAiConfigured()) throw aiUnavailable();

  const history = await prisma.chatMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_WINDOW,
  });
  history.reverse();

  const specBefore = await getSpec(projectId, userId);

  // Images from the most recent few messages are re-sent so the agent can still
  // answer a follow-up question about a photo a couple of turns later, while
  // cost stays bounded on a long conversation.
  const recent = history.slice(-IMAGE_CONTEXT_MESSAGES);
  const recentAttachmentIds = recent.flatMap((row) => readAttachmentIds(row.attachmentFileIds));
  const historyImageFiles = await loadReadyFiles(projectId, recentAttachmentIds);
  const historyImagesById = new Map(historyImageFiles.map((file) => [file.id, file]));

  const historyMessages: ChatCompletionMessageParam[] = await Promise.all(
    history.map(async (row) => {
      if (row.role === 'assistant') {
        return { role: 'assistant' as const, content: row.content };
      }
      const attachedFiles = readAttachmentIds(row.attachmentFileIds)
        .map((id) => historyImagesById.get(id))
        .filter((file): file is NonNullable<typeof file> => Boolean(file));

      if (attachedFiles.length === 0) {
        return { role: 'user' as const, content: row.content };
      }
      const imageParts = await buildImageParts(attachedFiles);
      return {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: row.content }, ...imageParts],
      };
    })
  );

  // Attachments on THIS message. Loading them through the file service means the
  // ids are scoped to this project, so a foreign file id cannot be smuggled in.
  const newFiles = await loadReadyFiles(projectId, attachmentFileIds);
  const newImageParts = await buildImageParts(newFiles);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(getDomain(project.domain)) },
    { role: 'system', content: buildSpecStateMessage(specBefore.spec, specBefore.missing) },
    ...historyMessages,
    newImageParts.length > 0
      ? { role: 'user', content: [{ type: 'text' as const, text: content }, ...newImageParts] }
      : { role: 'user', content },
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
    prisma.chatMessage.create({
      data: {
        projectId,
        role: 'user',
        content,
        // Only ids that resolved to ready files in THIS project are recorded.
        attachmentFileIds: newFiles.length > 0 ? newFiles.map((file) => file.id) : undefined,
      },
    }),
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
      attachmentFileIds: newFiles.map((file) => file.id),
      createdAt: userMessage.createdAt,
    },
    assistantMessage: {
      id: assistantMessage.id,
      role: 'assistant',
      content: assistantMessage.content,
      attachmentFileIds: [],
      createdAt: assistantMessage.createdAt,
    },
    spec: await getSpec(projectId, userId),
  };
}
