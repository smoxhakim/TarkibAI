import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { badRequest, handleRoute } from '@/lib/http/api';
import { MAX_LOGO_BYTES, removeQuoteLogo, setQuoteLogo } from '@/lib/quotes/settings-service';
import { assertWorkspacePermission, resolveActiveWorkspace } from '@/lib/workspaces/access';

/**
 * PUT /api/quote-settings/logo — the raw image bytes, typed by Content-Type.
 *
 * Project files are presigned and uploaded straight to R2 because they can be
 * large. A logo is capped at 2 MB, so it goes through the server: the extra
 * round trip buys nothing here.
 */
export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();

    const mimeType = req.headers.get('content-type')?.split(';')[0].trim() ?? '';
    // Checked before reading the body, so an oversized upload is refused rather
    // than buffered in full and then rejected.
    const declaredLength = Number(req.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_LOGO_BYTES) throw badRequest('A logo must be 2 MB or smaller.');

    const bytes = Buffer.from(await req.arrayBuffer());
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    await assertWorkspacePermission(workspaceId, user.id, 'quote.create');
    return { settings: await setQuoteLogo(workspaceId, user.id, bytes, mimeType) };
  });
}

// DELETE /api/quote-settings/logo
export async function DELETE(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { workspaceId } = await resolveActiveWorkspace(user.id, req.nextUrl.searchParams.get('workspaceId'));
    await assertWorkspacePermission(workspaceId, user.id, 'quote.create');
    return { settings: await removeQuoteLogo(workspaceId, user.id) };
  });
}
