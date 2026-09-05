/**
 * AI configuration. The application must remain usable without an OpenAI key —
 * every other feature works, and the conversation endpoint reports 503 with a
 * clear message rather than crashing the project workspace.
 */
export const AI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-5';

/** Maximum tool-calling round trips in a single turn, to bound cost and latency. */
export const MAX_TOOL_ITERATIONS = 6;

/** Number of prior chat messages replayed as conversational context. */
export const HISTORY_WINDOW = 20;

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
