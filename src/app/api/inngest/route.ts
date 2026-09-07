import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';

/**
 * Inngest endpoint.
 *
 * Deliberately outside the Clerk-protected routes: Inngest calls it as a
 * machine, not a signed-in user. It authenticates by request signature instead,
 * read from INNGEST_SIGNING_KEY in the environment — the serve handler picks it
 * up itself rather than taking it as an option.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
