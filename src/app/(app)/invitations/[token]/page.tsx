import { requireDbUser } from '@/lib/auth/current-user';
import { describeInvitation } from '@/lib/workspaces/service';
import { AcceptInvitation } from '@/components/AcceptInvitation';

export const dynamic = 'force-dynamic';

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Signing in is required first, so the account presenting the link is known
  // before anything about the workspace is shown.
  const user = await requireDbUser();
  const invitation = await describeInvitation(token);

  const wrongAccount = user.email.trim().toLowerCase() !== invitation.email;
  const unusable = invitation.expired || invitation.accepted || invitation.revoked;

  return (
    <main className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Join {invitation.workspaceName}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        You have been invited as {invitation.roleLabel.toLowerCase()}.
      </p>

      {invitation.revoked ? (
        <p className="mt-4 text-sm text-danger">This invitation has been withdrawn.</p>
      ) : invitation.accepted ? (
        <p className="mt-4 text-sm text-ink-muted">This invitation has already been used.</p>
      ) : invitation.expired ? (
        <p className="mt-4 text-sm text-danger">This invitation has expired. Ask for a new one.</p>
      ) : wrongAccount ? (
        <p className="mt-4 text-sm text-danger">
          This invitation was sent to {invitation.email}. You are signed in as {user.email}. Sign in
          with the invited address to accept it.
        </p>
      ) : (
        <div className="mt-6">
          <AcceptInvitation token={token} />
        </div>
      )}

      {unusable || wrongAccount ? null : null}
    </main>
  );
}
