// AI Conversation Service — wraps OpenAI chat + structured spec extraction.
// TODO: use OpenAI function-calling / structured outputs to emit ProjectSpec.data
// NOTE: the `openai` dependency is added in Phase 1 (T1), when this is implemented.

export interface SpecDraft {
  dimensions?: { width?: number; height?: number; depth?: number };
  industry?: string;
  lighting?: string;
  mountingType?: string;
  materialsRequested?: string[];
  notes?: string;
  referenceFileIds?: string[];
}

// Runs one conversational turn: sends history + new user message to the model,
// returns assistant reply text and an updated (possibly partial) spec draft.
export async function runConversationTurn(
  projectId: string,
  userMessage: string,
  attachmentFileIds: string[] = []
): Promise<{ assistantReply: string; specDraft: SpecDraft }> {
  // TODO: load ChatMessage history for projectId
  // TODO: call OpenAI chat.completions with function-calling schema for SpecDraft
  // TODO: persist updated ProjectSpec version
  throw new Error('not implemented');
}

// Determines whether enough information has been collected to present a summary for approval.
export function isSpecComplete(spec: SpecDraft): boolean {
  // TODO: define required fields per industry (dimensions, lighting, mounting, materials...)
  return false;
}

// Produces a human-readable summary of the current spec for user approval.
export function summarizeSpec(spec: SpecDraft): string {
  // TODO: template a readable "Here is my understanding of the project..." message
  return '';
}
