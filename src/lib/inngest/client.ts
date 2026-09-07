import { Inngest } from 'inngest';

/**
 * Background job client.
 *
 * Image generation takes 10–60 seconds. On Vercel a serverless function is
 * killed once it responds, so a fire-and-forget promise genuinely does not
 * survive — which is why this runs through a durable job runner rather than
 * being started inside the request (ARCHITECTURE §17).
 *
 * Locally this works with `npx inngest-cli dev` and needs no account.
 */
/**
 * Dev mode is derived rather than configured.
 *
 * Without it the SDK assumes cloud mode and refuses to start for want of a
 * signing key, which would make the app fail locally for everyone who has not
 * set up Inngest. Production still requires INNGEST_SIGNING_KEY: the condition
 * below can never be true there, so the signature check cannot be skipped by
 * accident on a deployed instance.
 */
const isDev =
  process.env.INNGEST_DEV === '1' ||
  (process.env.NODE_ENV !== 'production' && !process.env.INNGEST_SIGNING_KEY);

export const inngest = new Inngest({
  id: 'tarkib',
  // Absent in development, where the local dev server accepts unsigned events.
  eventKey: process.env.INNGEST_EVENT_KEY,
  isDev,
});

export type MockupRequestedEvent = {
  name: 'mockup/requested';
  data: {
    mockupId: string;
    projectId: string;
    userId: string;
  };
};
