/**
 * Live Moroccan Darija evaluation against the real model.
 *
 * Skipped automatically when OPENAI_API_KEY is absent, so CI and ordinary test
 * runs never depend on network access or spend money. Run deliberately with:
 *
 *   npm run test:eval
 *
 * These assertions are about extraction fidelity and restraint, not phrasing.
 * A model reply is non-deterministic; what must hold is that the agent records
 * what the user said and invents nothing they did not.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { runConversationTurn } from '@/lib/ai/conversation-service';
import { getSpec } from '@/lib/spec/service';
import { isAiConfigured } from '@/lib/ai/config';
import { EVAL_CASES } from './cases';
import { asWorkspaceId, ensurePersonalWorkspace, type WorkspaceId } from '@/lib/workspaces/access';

const enabled = isAiConfigured();
const suffix = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string;
let workspaceId: WorkspaceId;

beforeAll(async () => {
  if (!enabled) return;
  const user = await prisma.user.create({
    data: { clerkId: `eval-${suffix}`, email: `eval-${suffix}@example.test` },
  });
  userId = user.id;
  workspaceId = asWorkspaceId((await ensurePersonalWorkspace(userId)).id);
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.project.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe.skipIf(!enabled)('Moroccan Darija intake', () => {
  for (const testCase of EVAL_CASES) {
    it(
      testCase.name,
      async () => {
        const project = await createProject(workspaceId, userId, { title: `eval: ${testCase.name}` });

        let lastReply = '';
        for (const message of testCase.messages) {
          const turn = await runConversationTurn(project.id, userId, message);
          lastReply = turn.assistantMessage.content;
        }

        expect(lastReply.length).toBeGreaterThan(0);

        const view = await getSpec(project.id, userId);

        // Extraction fidelity.
        testCase.expect(view.spec);

        // Restraint: fields the user never mentioned must remain unset.
        for (const key of testCase.mustNotInvent) {
          expect(
            view.spec[key],
            `agent invented "${String(key)}" = ${JSON.stringify(view.spec[key])}`
          ).toBeUndefined();
        }

        // The agent must never claim it approved anything.
        expect(view.status).toBe('draft');
        expect(/\bapproved\b/i.test(lastReply)).toBe(false);
      },
      120_000
    );
  }

  it(
    'does not state a price when asked',
    async () => {
      const project = await createProject(workspaceId, userId, { title: 'eval: price refusal' });
      const turn = await runConversationTurn(
        project.id,
        userId,
        'bghit enseigne 5m x 2m f alucobond b LED. 3tini prix daba, ch7al?'
      );

      // A currency figure here would be a fabricated cost — the exact failure
      // PRD §5.3 forbids, since no cost engine exists until Phase 5.
      const reply = turn.assistantMessage.content;
      const priceLike = /\b\d[\d\s.,]*\s*(dh|dhs|mad|درهم|dirham|€|\$)/i;
      expect(priceLike.test(reply), `reply appears to quote a price: ${reply}`).toBe(false);
    },
    120_000
  );
});
