/**
 * The bounded tool-calling loop.
 *
 * Driven by a stub client rather than the real API: every behaviour that
 * matters here is about what the loop does with what the model returns, and
 * none of it needs a network. The recurring theme is that a failure must stay a
 * failure — a tool that throws, an argument that is not JSON, a name that does
 * not exist — and must reach the model as a structured error it can recover
 * from, never be swallowed into a confident answer.
 */
import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { MAX_TOOL_ITERATIONS } from './config';
import { runAgent } from './agent';
import type { ToolDefinition } from './tools';

type Completion = { choices: [{ message: Record<string, unknown> }] };

/** A client that returns the given completions in order, then repeats the last. */
function stubClient(completions: Completion[]) {
  const create = vi.fn(async (body: { tools?: unknown[] }) => {
    // The loop's last request withholds tools; it only ever wants a reply.
    if (!body.tools) return completions[completions.length - 1];
    return completions[Math.min(create.mock.calls.length - 1, completions.length - 1)];
  });
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

const reply = (content: string): Completion => ({ choices: [{ message: { role: 'assistant', content } }] });

const callsTool = (name: string, args: string, id = 'call-1'): Completion => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id, type: 'function', function: { name, arguments: args } }],
      },
    },
  ],
});

function tool(name: string, execute: ToolDefinition['execute']): ToolDefinition {
  return { name, description: `The ${name} tool.`, parameters: { type: 'object', properties: {} }, execute };
}

describe('runAgent', () => {
  it('returns the reply when the model calls no tools', async () => {
    const { client } = stubClient([reply('  Wakha, chno l3ard?  ')]);
    const result = await runAgent(client, [], []);
    expect(result.text).toBe('Wakha, chno l3ard?');
    expect(result.toolCalls).toEqual([]);
  });

  it('runs a tool, feeds the result back, and records the invocation', async () => {
    const execute = vi.fn(async () => ({ unitsToPurchase: 4 }));
    const { client, create } = stubClient([
      callsTool('get_material_calculations', '{}'),
      reply('4 plaques.'),
    ]);

    const result = await runAgent(client, [], [tool('get_material_calculations', execute)]);

    expect(execute).toHaveBeenCalledOnce();
    expect(result.text).toBe('4 plaques.');
    expect(result.toolCalls).toEqual([{ name: 'get_material_calculations', arguments: {} }]);

    // The tool result must go back to the model as a tool message, or the model
    // answers the follow-up turn without the figure it just asked for.
    const followUp = create.mock.calls[1][0] as unknown as { messages: { role: string; content: string }[] };
    const toolMessage = followUp.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('4');
  });

  it('passes validated arguments through to the tool', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const { client } = stubClient([
      callsTool('list_materials', '{"search":"alucobond"}'),
      reply('done'),
    ]);

    await runAgent(client, [], [tool('list_materials', execute)]);
    expect(execute).toHaveBeenCalledWith({ search: 'alucobond' });
  });

  describe('failures reach the model, not the user', () => {
    it('reports a tool that throws as a structured error and still answers', async () => {
      const { client, create } = stubClient([
        callsTool('get_project_cost', '{}'),
        reply('Ma3endich l cost daba.'),
      ]);

      const result = await runAgent(
        client,
        [],
        [tool('get_project_cost', async () => { throw new Error('Cost is not visible for your role.'); })]
      );

      const followUp = create.mock.calls[1][0] as unknown as { messages: { role: string; content: string }[] };
      const toolMessage = followUp.messages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toContain('Cost is not visible for your role.');
      // The user gets the model's sentence, never the raw failure.
      expect(result.text).toBe('Ma3endich l cost daba.');
    });

    it('refuses a tool it was never given, without inventing one', async () => {
      const execute = vi.fn();
      const { client, create } = stubClient([callsTool('approve_spec', '{}'), reply('Ma n9derch.')]);

      const result = await runAgent(client, [], [tool('get_project_spec', execute)]);

      expect(execute).not.toHaveBeenCalled();
      const followUp = create.mock.calls[1][0] as unknown as { messages: { role: string; content: string }[] };
      expect(followUp.messages.find((message) => message.role === 'tool')?.content).toContain(
        'Unknown tool'
      );
      // An unknown name is never recorded as something the agent did.
      expect(result.toolCalls).toEqual([]);
    });

    it('rejects arguments that are not valid JSON without running the tool', async () => {
      const execute = vi.fn();
      const { client, create } = stubClient([
        callsTool('update_project_spec', '{"width": '),
        reply('3awd 3afak.'),
      ]);

      const result = await runAgent(client, [], [tool('update_project_spec', execute)]);

      expect(execute).not.toHaveBeenCalled();
      expect(result.toolCalls).toEqual([]);
      const followUp = create.mock.calls[1][0] as unknown as { messages: { role: string; content: string }[] };
      expect(followUp.messages.find((message) => message.role === 'tool')?.content).toContain(
        'not valid JSON'
      );
    });

    it('throws when the model returns no message at all', async () => {
      const create = vi.fn(async () => ({ choices: [] }));
      const client = { chat: { completions: { create } } } as unknown as OpenAI;
      await expect(runAgent(client, [], [])).rejects.toThrow(/no message/i);
    });
  });

  describe('the loop is bounded', () => {
    it('stops a model that keeps calling tools and still returns a reply', async () => {
      const execute = vi.fn(async () => ({ again: true }));
      // Always asks for another tool call; only the final, tool-less request
      // can end it.
      const create = vi.fn(async (body: { tools?: unknown[] }) =>
        body.tools ? callsTool('get_canvas', '{}') : reply('Safi, hakka l7al.')
      );
      const client = { chat: { completions: { create } } } as unknown as OpenAI;

      const result = await runAgent(client, [], [tool('get_canvas', execute)]);

      expect(execute).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
      // One request per iteration, plus the final one with tools withheld.
      expect(create).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
      expect((create.mock.calls.at(-1)![0] as unknown as { tools?: unknown[] }).tools).toBeUndefined();
      expect(result.text).toBe('Safi, hakka l7al.');
      expect(result.toolCalls).toHaveLength(MAX_TOOL_ITERATIONS);
    });
  });
});
