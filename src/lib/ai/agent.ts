import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { AI_MODEL, MAX_TOOL_ITERATIONS } from './config';
import type { ToolDefinition, ToolInvocation } from './tools';

export type AgentResult = {
  text: string;
  toolCalls: ToolInvocation[];
};

/**
 * Runs one conversational turn with tool calling.
 *
 * The loop is bounded: a model that keeps calling tools without producing a
 * reply is stopped after MAX_TOOL_ITERATIONS rather than spending unbounded
 * time and money. Tool failures are returned to the model as structured errors
 * so it can recover conversationally (for example by asking the user again)
 * instead of the whole turn collapsing.
 */
export async function runAgent(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  tools: ToolDefinition[]
): Promise<AgentResult> {
  const toolSchemas: ChatCompletionTool[] = tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const working = [...messages];
  const executed: ToolInvocation[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const completion = await client.chat.completions.create({
      model: AI_MODEL,
      messages: working,
      tools: toolSchemas,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) throw new Error('The model returned no message.');

    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      return { text: choice.content?.trim() ?? '', toolCalls: executed };
    }

    working.push(choice);

    for (const call of calls) {
      if (call.type !== 'function') continue;
      const tool = byName.get(call.function.name);

      let result: unknown;
      if (!tool) {
        result = { error: `Unknown tool: ${call.function.name}` };
      } else {
        let args: unknown = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = undefined;
        }

        if (args === undefined) {
          result = { error: 'Arguments were not valid JSON. Send a well-formed object.' };
        } else {
          executed.push({ name: call.function.name, arguments: args });
          try {
            result = await tool.execute(args);
          } catch (error) {
            // Surfaced to the model, not to the user: it can retry or ask a
            // clarifying question. Validation messages are genuinely useful here.
            result = {
              error: error instanceof Error ? error.message : 'Tool execution failed.',
            };
          }
        }
      }

      working.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Ran out of iterations. Ask for a plain reply with tools withheld so the user
  // still gets a coherent message rather than an error.
  const finalCompletion = await client.chat.completions.create({
    model: AI_MODEL,
    messages: working,
  });

  return {
    text: finalCompletion.choices[0]?.message?.content?.trim() ?? '',
    toolCalls: executed,
  };
}
