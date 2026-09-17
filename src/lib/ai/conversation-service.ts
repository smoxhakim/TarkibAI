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
import { selectCapabilities } from './prompts/capabilities';
import { buildProjectContext, renderProjectState } from './context/project-context';
import { resolveProjectAiAccess } from './access';
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
 * Runs one turn of the conversation.
 *
 * # What the model is given, and why
 *
 * Context is rebuilt from scratch every turn from four sources, never replayed
 * from what was sent last time:
 *
 * 1. The system prompt, ASSEMBLED for this project and this caller's role —
 *    only the capability modules that apply here (T21).
 * 2. The CURRENT structured specification, which is the record of what the user
 *    stated (PRD §9).
 * 3. A summary of what the project already HAS: materials, calculations,
 *    plans, cost status, documents. Added in T21 so the agent can explain a
 *    deterministic result instead of being unable to reach it — and so it stops
 *    telling users that features shipped in T4–T20 do not exist yet.
 * 4. The recent plain-text messages, with images from the last few.
 *
 * Injecting 2 and 3 fresh keeps the agent correct even after older messages
 * have fallen outside the history window, and means a tool call made earlier in
 * the same thread cannot leave a stale figure sitting in the context.
 *
 * The state summary carries EXISTENCE and STATUS, not figures. Figures live
 * behind tools, so a turn's fixed cost stays small and every authoritative
 * number comes from the service that owns it.
 */
export async function runConversationTurn(
  projectId: string,
  userId: string,
  content: string,
  attachmentFileIds: string[] = []
): Promise<ConversationTurn> {
  // Resolves the project, the workspace and the caller's ROLE. Everything the
  // agent may do this turn is decided from this and nothing else.
  const access = await resolveProjectAiAccess(projectId, userId);
  if (!isAiConfigured()) throw aiUnavailable();

  // Issued together: the conversation history and the specification do not
  // depend on each other, and the turn now reads enough of the project that the
  // sequential version would add latency for nothing.
  const [history, specBefore] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_WINDOW,
    }),
    getSpec(projectId, userId),
  ]);
  history.reverse();

  const { grants, snapshot } = await buildProjectContext(access, specBefore);

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
    {
      role: 'system',
      content: buildSystemPrompt({
        domain: access.domain,
        capabilities: selectCapabilities(snapshot, grants),
        grants,
      }),
    },
    { role: 'system', content: buildSpecStateMessage(specBefore.spec, specBefore.missing) },
    { role: 'system', content: renderProjectState(snapshot) },
    ...historyMessages,
    newImageParts.length > 0
      ? { role: 'user', content: [{ type: 'text' as const, text: content }, ...newImageParts] }
      : { role: 'user', content },
  ];

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await runAgent(client, messages, buildToolbox(access));

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
