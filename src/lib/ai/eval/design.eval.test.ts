/**
 * Live evaluation of conversational design editing.
 *
 * The milestone's definition of done is that a user can say "zid 50cm f l3ard"
 * and the application safely updates the structured project. Safely means: the
 * agent computes from the object's real current size, proposes rather than
 * applies, and does not claim the change is done.
 *
 * Self-skips without OPENAI_API_KEY. Run with: npm run test:eval
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/projects/service';
import { approveSpec, updateDraftSpec } from '@/lib/spec/service';
import { getScene, seedScene } from '@/lib/canvas/service';
import { runConversationTurn } from '@/lib/ai/conversation-service';
import { isAiConfigured } from '@/lib/ai/config';
import { approveProposal, listProposals } from '@/lib/design/service';
import type { ProjectSpecPatch } from '@/lib/spec/schema';

const enabled = isAiConfigured();
const suffix = `deval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string;

const SPEC: ProjectSpecPatch = {
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'steel frame' },
  site: { environment: 'outdoor' },
};

beforeAll(async () => {
  if (!enabled) return;
  const user = await prisma.user.create({
    data: { clerkId: `de-${suffix}`, email: `de-${suffix}@example.test` },
  });
  userId = user.id;
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.project.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

async function readyProject() {
  const project = await createProject(userId, { title: `design eval ${Math.random()}` });
  await updateDraftSpec(project.id, userId, SPEC);
  await approveSpec(project.id, userId);
  await seedScene(project.id, userId);
  return project;
}

describe.skipIf(!enabled)('conversational design editing', () => {
  it(
    'turns "zid 50cm f l3ard" into a proposal computed from the real width',
    async () => {
      const project = await readyProject();

      const turn = await runConversationTurn(project.id, userId, 'zid 50cm f l3ard');

      const proposals = await listProposals(project.id, userId);
      const pending = proposals.find((p) => p.status === 'pending');
      expect(pending, 'the agent should have proposed a change').toBeTruthy();

      // 8000mm + 500mm. Getting this right requires reading the canvas rather
      // than guessing a size.
      const update = pending!.commands.find((c) => c.kind === 'update_object');
      expect(update).toBeTruthy();
      if (update?.kind === 'update_object') {
        expect(update.changes.widthMm).toBe(8500);
      }

      // Nothing may have changed yet.
      const scene = await getScene(project.id, userId);
      expect(scene.scene.objects[0].widthMm).toBe(8000);

      // And the agent must not claim it did.
      expect(/\b(done|applied|updated it|changed it)\b/i.test(turn.assistantMessage.content)).toBe(
        false
      );
    },
    180_000
  );

  it(
    'applies only after the user approves, then the canvas reflects it',
    async () => {
      const project = await readyProject();
      await runConversationTurn(project.id, userId, 'zid 50cm f l3ard');

      const pending = (await listProposals(project.id, userId)).find((p) => p.status === 'pending');
      expect(pending).toBeTruthy();

      await approveProposal(project.id, userId, pending!.id);

      const scene = await getScene(project.id, userId);
      expect(scene.scene.objects[0].widthMm).toBe(8500);
    },
    180_000
  );

  it(
    'does not invent a size when asked to change an empty canvas',
    async () => {
      const project = await createProject(userId, { title: `empty canvas ${Math.random()}` });
      await updateDraftSpec(project.id, userId, SPEC);
      await approveSpec(project.id, userId);
      // Deliberately not seeded: there is nothing to widen.

      await runConversationTurn(project.id, userId, 'zid 50cm f l3ard');

      const proposals = await listProposals(project.id, userId);
      const added = proposals
        .flatMap((p) => p.commands)
        .filter((c) => c.kind === 'add_object');

      // Inventing a panel to widen would fabricate project geometry.
      expect(added).toHaveLength(0);
      expect((await getScene(project.id, userId)).scene.objects).toHaveLength(0);
    },
    180_000
  );
});
