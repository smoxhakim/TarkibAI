import { inngest } from './client';
import { runMockup } from '@/lib/mockup/service';

/**
 * Generates a queued mockup.
 *
 * Inngest v4 takes triggers inside the config object; the three-argument form
 * belongs to v3.
 *
 * Retries are bounded: an image model that is failing will keep failing, and
 * each attempt costs money. The mockup row records the reason after the final
 * attempt, so the user sees why rather than a card stuck on "running".
 */
export const generateMockup = inngest.createFunction(
  {
    id: 'generate-mockup',
    retries: 2,
    triggers: [{ event: 'mockup/requested' }],
  },
  async ({ event, step }) => {
    const mockupId = (event.data as { mockupId: string }).mockupId;

    await step.run('generate', async () => {
      await runMockup(mockupId);
    });

    return { mockupId };
  }
);

export const inngestFunctions = [generateMockup];
