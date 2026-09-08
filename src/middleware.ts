import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// DO NOT rename this to proxy.ts. Next 16 deprecates "middleware" in favour of
// "proxy" and prints a warning on every build saying so — but it compiles
// proxy.ts WITHOUT adding an entry to .next/server/middleware-manifest.json,
// and that manifest is what Vercel reads to decide whether to run it at all.
//
// The effect is silent and total. `next start` locally runs the proxy anyway,
// so everything passes; on Vercel the middleware never executes, `auth()`
// throws because it cannot detect clerkMiddleware, and EVERY request returns
// 500 — pages, API routes, the public share link, all of it. The build is
// green throughout.
//
// Verified by building both ways: proxy.ts gives `middleware: {}` in the
// manifest, middleware.ts gives `middleware: { '/': ... }`.
//
// Accept the deprecation warning. It is the version that runs.

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

  // Redirect explicitly rather than calling auth.protect(). protect() decides
  // for itself between redirecting and answering 404, and under this file
  // convention it chose 404 — so a signed-out visitor to /dashboard was told
  // the page does not exist instead of being sent to sign in. Saying which
  // outcome we want removes the guess.
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless they appear in search params.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
