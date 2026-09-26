import { prisma } from '@/lib/db';

/**
 * Proof that a person saw a proposed write before the agent performs it.
 *
 * # Why this is enforced here and not only in the prompt
 *
 * A prompt that says "ask before creating" is an instruction the model can
 * ignore. This check does not depend on the model at all. It rests on how a
 * turn is persisted: `runConversationTurn` runs the agent first and writes the
 * user and assistant messages AFTERWARDS, in one transaction. So while a turn is
 * running, a preview made earlier in the SAME turn is not in the database yet.
 *
 * That gives two guarantees for free:
 *
 * 1. The agent cannot preview and commit in one turn. The commit looks for the
 *    preview in the last PERSISTED assistant turn, and the current one is not
 *    persisted until the agent has finished.
 * 2. A person replied in between. A new turn exists only because the user sent
 *    a message — there is no other way into `runConversationTurn`.
 *
 * What it does NOT decide is whether that reply was a yes. That is language,
 * and the Darija module is explicit that "wakha" is an acknowledgement rather
 * than consent — the one thing a keyword match would get wrong. So the model
 * judges the reply, and this module guarantees the reply happened, to the
 * preview the model is now acting on, with nothing changed in between.
 *
 * # Why the previous turn and not "any earlier turn"
 *
 * Confirmation has to be immediate. If the user asked something else in
 * between, the preview is stale — the cost may have moved, or they may have
 * forgotten what they were shown — and the agent must show it again.
 */

/** A tool call as `runAgent` records it on the persisted assistant message. */
type RecordedCall = { name?: unknown; arguments?: unknown };

export type ConfirmationCheck =
  | { ok: true }
  | { ok: false; reason: 'no_preview' | 'already_committed' | 'changed' };

/**
 * Whether the most recent persisted assistant turn previewed exactly this write
 * and did not already perform it.
 *
 * `sameIntent` decides whether a recorded preview's arguments describe the same
 * write as the ones now being committed. It is supplied by the caller because
 * only the tool knows which of its arguments matter — `confirmed` itself must
 * not, or no preview would ever match.
 */
export async function checkPreviousTurnPreview(
  projectId: string,
  toolName: string,
  isCommit: (args: unknown) => boolean,
  sameIntent: (recorded: unknown) => boolean
): Promise<ConfirmationCheck> {
  const previous = await prisma.chatMessage.findFirst({
    where: { projectId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { toolCalls: true },
  });

  const calls: RecordedCall[] = Array.isArray(previous?.toolCalls)
    ? (previous!.toolCalls as RecordedCall[])
    : [];
  const ofThisTool = calls.filter((call) => call?.name === toolName);

  // Already acted on. Committing again from the same preview would write the
  // same thing twice, and the user was only ever asked about it once.
  if (ofThisTool.some((call) => isCommit(call.arguments))) {
    return { ok: false, reason: 'already_committed' };
  }

  const previews = ofThisTool.filter((call) => !isCommit(call.arguments));
  if (previews.length === 0) return { ok: false, reason: 'no_preview' };

  // What the user was shown must be what is written. Otherwise the agent could
  // preview one client and create a quotation for another.
  if (!previews.some((call) => sameIntent(call.arguments))) {
    return { ok: false, reason: 'changed' };
  }

  return { ok: true };
}
