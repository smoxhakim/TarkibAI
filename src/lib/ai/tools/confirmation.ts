import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';

/**
 * Proof that a person saw a proposed write, and explicitly agreed to it, before
 * the agent performs it.
 *
 * # What the model can and cannot do here
 *
 * The model can call a tool with any arguments it likes, including
 * `confirmed: true`. What it cannot do is write the user's message. So consent
 * is not read from the model's arguments at all. It is read from the text the
 * person sent to start the turn, which reaches the toolbox from the route, not
 * from the model.
 *
 * # The three guarantees, and where each comes from
 *
 * 1. **A person replied to this preview.** `runConversationTurn` runs the agent
 *    first and persists the user and assistant messages AFTERWARDS. While a turn
 *    runs, a preview made earlier in that SAME turn is not in the database yet,
 *    so the commit — which looks for the preview in the last PERSISTED assistant
 *    turn — cannot find it. The agent cannot ask and answer its own question,
 *    and a later turn exists only because the user sent a message.
 *
 * 2. **The reply was an explicit yes to exactly this write.** The preview issues
 *    a short numeric CODE, and the application — not the model — shows it to the
 *    user under the reply. The commit is refused unless the user's whole message
 *    is that code. "wakha", "ok", "iyeh", a question, a refusal that happens to
 *    quote the code: none of them is the code, so none of them writes. Keyword
 *    matching was rejected for exactly that reason: the Darija module is explicit
 *    that "wakha" acknowledges rather than consents.
 *
 *    The code is a hash of everything the write depends on (see
 *    `confirmationCode`) and is recomputed from the CURRENT state at commit. A
 *    different client, heading, cost calculation, price or person produces a
 *    different code, so a code confirms the write as it was shown and nothing
 *    else.
 *
 * 3. **It happens once.** A preview whose write already landed is spent, and
 *    the check and the write run under one lock per project, so two turns
 *    confirming at the same moment cannot both pass the check before either
 *    writes.
 *
 * # Why the previous turn and not "any earlier turn"
 *
 * Confirmation has to be immediate. If the user asked something else in
 * between, the preview is stale — the cost may have moved, or they may have
 * forgotten what they were shown — and the agent must show it again.
 *
 * # Why the code is not secret
 *
 * It does not need to be. Its job is to be something the user can only produce
 * by deliberately typing it, and that stops matching when the write changes. The
 * one person who could compute it is somebody already allowed to make the write.
 */

/** A tool call as `runAgent` records it on the persisted assistant message. */
type RecordedCall = { name?: unknown; arguments?: unknown };

export type ConfirmationRefusal =
  /** No preview of this write in the most recent persisted assistant turn. */
  | 'no_preview'
  /** That preview was already acted on. */
  | 'already_committed'
  /** The details being committed are not the ones previewed. */
  | 'changed'
  /** The user's message is not a confirmation code. */
  | 'not_confirmed'
  /** A code, but not the one for this write as it stands now. */
  | 'code_mismatch';

export type ConfirmationCheck =
  | { ok: true; previewAt: Date }
  | { ok: false; reason: Extract<ConfirmationRefusal, 'no_preview' | 'already_committed' | 'changed'> };

/**
 * Whether the most recent persisted assistant turn previewed exactly this write
 * and did not already perform it.
 *
 * `sameIntent` decides whether a recorded preview's arguments describe the same
 * write as the ones now being committed. It is supplied by the caller because
 * only the tool knows which of its arguments matter — `confirmed` itself must
 * not, or no preview would ever match.
 *
 * `previewAt` is when that turn was persisted, so the caller can tell whether a
 * write has landed since.
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
    select: { toolCalls: true, createdAt: true },
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
  if (!previous || previews.length === 0) return { ok: false, reason: 'no_preview' };

  // What the user was shown must be what is written. Otherwise the agent could
  // preview one client and create a quotation for another.
  if (!previews.some((call) => sameIntent(call.arguments))) {
    return { ok: false, reason: 'changed' };
  }

  return { ok: true, previewAt: previous.createdAt };
}

/* -------------------------------------------------------------------------- */
/* The code                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Digits only, so it can be typed on any phone keyboard — including an Arabic
 * one, whose digits `codeInMessage` reads as the same code.
 */
export const CONFIRMATION_CODE_LENGTH = 6;

/**
 * The code for one write, derived from everything that write depends on.
 *
 * The caller passes the tool name, the project, the person, the normalised
 * arguments and whatever the write is priced from. Change any of them and the
 * code changes, which is what makes a stale confirmation fail.
 */
export function confirmationCode(parts: readonly unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest();
  const value = digest.readUIntBE(0, 6) % 10 ** CONFIRMATION_CODE_LENGTH;
  return String(value).padStart(CONFIRMATION_CODE_LENGTH, '0');
}

/** Arabic-Indic (٠–٩) and Eastern Arabic-Indic (۰–۹) digits, as ASCII. */
function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/**
 * The code a message consists of, or null if the message is anything else.
 *
 * The WHOLE message has to be the code. "la, ma tdirch 482915" contains it and
 * is a refusal; "wach 482915 howa l code?" contains it and is a question. Only
 * spacing inside the code and a trailing full stop — which phone keyboards add
 * on their own — are forgiven.
 */
export function codeInMessage(message: string | undefined): string | null {
  if (!message) return null;
  const compact = asciiDigits(message).replace(/\s+/g, '').replace(/\.$/, '');
  return new RegExp(`^\\d{${CONFIRMATION_CODE_LENGTH}}$`).test(compact) ? compact : null;
}

/* -------------------------------------------------------------------------- */
/* One confirmation at a time                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Generous on purpose. The lock is held while the write runs, and a quote
 * creation under database load has been seen to take several seconds; timing
 * out after the write committed would report a failure for a write that landed.
 */
const LOCK_MAX_WAIT_MS = 10_000;
const LOCK_TIMEOUT_MS = 30_000;

/**
 * Runs `critical` while holding this project's lock for `toolName`.
 *
 * # Why a lock is needed at all
 *
 * The "already acted on" signal is the COMMITTING turn's persisted tool calls,
 * and a turn is persisted only when it ends. Two requests carrying the same
 * code — a double submit, a second tab, a colleague — can therefore both read
 * the preview as unspent and both write. Serialising the check with the write,
 * and having the caller re-check for a write that landed since the preview,
 * closes that.
 *
 * A transaction-scoped Postgres advisory lock: no table, no schema change, and
 * released by the database when the transaction ends, however it ends — which
 * also makes it safe behind Neon's transaction-mode pooler. The work inside runs
 * on the ordinary client; the transaction exists only to hold the lock.
 */
export async function withConfirmationLock<T>(
  projectId: string,
  toolName: string,
  critical: () => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`confirm:${toolName}:${projectId}`}))`;
      return critical();
    },
    { maxWait: LOCK_MAX_WAIT_MS, timeout: LOCK_TIMEOUT_MS }
  );
}
