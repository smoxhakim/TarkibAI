'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

export type MemberRow = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  roleLabel: string;
  isYou: boolean;
};

export type InvitationRow = {
  id: string;
  email: string;
  roleLabel: string;
  expired: boolean;
  acceptPath: string;
};

export type RoleOption = { id: string; label: string; description: string };

const t = strings.workspaces;

export function WorkspacePanel({
  workspaceId,
  personal,
  yourRole,
  canManage,
  members,
  invitations,
  roleOptions,
}: {
  workspaceId: string;
  personal: boolean;
  yourRole: string;
  canManage: boolean;
  members: MemberRow[];
  invitations: InvitationRow[];
  roleOptions: RoleOption[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roleOptions[0]?.id ?? 'worker');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function call(action: string, path: string, init: RequestInit, fallback: string) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(path, init);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? fallback);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const invite = async () => {
    if (email.trim() === '') return;
    const ok = await call(
      'invite',
      `/api/workspaces/${workspaceId}/members`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      },
      t.inviteFailed
    );
    if (ok) setEmail('');
  };

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{t.membersHeading}</h2>
        <span className="text-xs text-ink-muted">
          {t.yourRole}: {yourRole}
        </span>
      </div>

      {personal ? <p className="mt-1 text-sm text-ink-muted">{t.personalNote}</p> : null}

      <ul className="mt-3 flex flex-col gap-2">
        {members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {member.name ?? member.email}
              {member.isYou ? <span className="ml-1 text-xs text-ink-muted">({t.you})</span> : null}
              <span className="block text-xs text-ink-muted">{member.email}</span>
            </span>
            <span className="flex items-center gap-2">
              {canManage && !member.isYou && member.role !== 'owner' ? (
                <select
                  value={member.role}
                  disabled={busy !== null}
                  onChange={(event) =>
                    call(
                      `role-${member.userId}`,
                      `/api/workspaces/${workspaceId}/members/${member.userId}`,
                      {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role: event.target.value }),
                      },
                      t.roleFailed
                    )
                  }
                  className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
                >
                  {roleOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-ink-muted">{member.roleLabel}</span>
              )}
              {canManage && !member.isYou && member.role !== 'owner' ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    call(
                      `remove-${member.userId}`,
                      `/api/workspaces/${workspaceId}/members/${member.userId}`,
                      { method: 'DELETE' },
                      t.removeFailed
                    )
                  }
                  className="text-xs text-ink-muted underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
                >
                  {t.remove}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {invitations.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-medium">{t.invitesHeading}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {invitation.email}
                  <span className="ml-2 text-xs text-ink-muted">
                    {invitation.roleLabel}
                    {invitation.expired ? ` · ${t.expired}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(`${window.location.origin}${invitation.acceptPath}`)
                        .then(() => setCopied(invitation.id))
                        .catch(() => setError(t.inviteFailed));
                    }}
                    className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    {copied === invitation.id ? t.copied : t.copyLink}
                  </button>
                  {canManage ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        call(
                          `revoke-${invitation.id}`,
                          `/api/workspaces/${workspaceId}/invitations/${invitation.id}`,
                          { method: 'DELETE' },
                          t.inviteFailed
                        )
                      }
                      className="text-ink-muted underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
                    >
                      {t.revoke}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage && !personal ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-medium">{t.inviteHeading}</p>
          {/* Said plainly rather than implied: nothing is delivered. */}
          <p className="mt-1 text-xs text-ink-muted">{t.inviteNoEmail}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              type="email"
              placeholder={t.inviteEmail}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              {roleOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy !== null || email.trim() === ''}
              onClick={invite}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'invite' ? t.inviting : t.invite}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {roleOptions.find((option) => option.id === role)?.description}
          </p>
        </div>
      ) : !canManage ? (
        <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">{t.readOnly}</p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
