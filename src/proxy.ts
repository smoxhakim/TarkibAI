import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Next 16 replaced the "middleware" file convention with "proxy"; the contract
// (default export + config.matcher) is unchanged.

// Public pages. Everything else is protected by default, so a route added in a
// later phase is private unless it is deliberately listed here.
//
// `/share/*` is a client review page. A client has no account — requiring one
// would defeat the point of a link you send to somebody — so the token in the
// URL is the whole credential. What that costs is paid for elsewhere: the
// payload behind it is built client-safe by construction (see
// src/lib/collaboration/share-view.ts), the token is 32 random bytes, and the
// link can be given an expiry and withdrawn at any time.
const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)', '/share/(.*)']);

// API routes authenticate themselves via requireDbUser(), which throws a 401
// that handleRoute() serialises as JSON. Redirecting them to Clerk's HTML
// sign-in page instead would hand an API client an unparseable response.
const isApiRoute = createRouteMatcher(['/api(.*)']);

/**
 * The Inngest endpoint is called by the job runner as a machine, with no user
 * session. It authenticates by request signature instead, so it must not be
 * pushed through Clerk at all.
 */
const isMachineRoute = createRouteMatcher(['/api/inngest(.*)']);

export default clerkMiddleware(async (auth, request) => {
  if (isMachineRoute(request) || isPublicRoute(request) || isApiRoute(request)) return;
  await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless they appear in search params.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
