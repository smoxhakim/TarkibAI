'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invitations/${token}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not accept the invitation.');
        return;
      }
      router.push(`/dashboard?workspace=${body.member.workspaceId}`);
      router.refresh();
    } catch {
      setError('Could not accept the invitation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={accept}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Joining…' : 'Accept invitation'}
      </button>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </>
  );
}
