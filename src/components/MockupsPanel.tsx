'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { strings } from '@/lib/strings';

export type MockupView = {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  prompt: string;
  model: string | null;
  failureReason: string | null;
  hasImage: boolean;
  createdAt: string;
};

export type SitePhotoOption = { id: string; name: string };

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function MockupsPanel({
  projectId,
  mockups,
  sitePhotos,
  configured,
}: {
  projectId: string;
  mockups: MockupView[];
  sitePhotos: SitePhotoOption[];
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState(sitePhotos[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);

  const anyPending = mockups.some((m) => m.status === 'queued' || m.status === 'running');

  async function generate(kind: 'concept' | 'site') {
    setPending(kind);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/mockups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, sourceFileId: kind === 'site' ? photoId : null }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? strings.mockups.generateFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.mockups.generateFailed);
    } finally {
      setPending(null);
    }
  }

  async function remove(mockupId: string) {
    setPending(mockupId);
    try {
      await fetch(`/api/projects/${projectId}/mockups/${mockupId}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{strings.mockups.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{strings.mockups.subtitle}</p>

      {/* Stated before any image is shown, not beneath it: this is the caveat
          that stops a mockup being treated as a measurable drawing. */}
      <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-ink-muted">
        {strings.mockups.disclaimer}
      </p>

      {!configured ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-3 py-3">
          <p className="text-sm font-medium">{strings.mockups.notConfigured}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.mockups.notConfiguredHint}</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => generate('concept')}
            disabled={pending !== null}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending === 'concept' ? strings.mockups.generating : strings.mockups.generateConcept}
          </button>

          {sitePhotos.length > 0 ? (
            <>
              <select
                value={photoId}
                onChange={(e) => setPhotoId(e.target.value)}
                aria-label={strings.mockups.choosePhoto}
                className="rounded-md border border-line bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
              >
                {sitePhotos.map((photo) => (
                  <option key={photo.id} value={photo.id}>
                    {photo.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => generate('site')}
                disabled={pending !== null || !photoId}
                className="rounded-md border border-line px-3 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
              >
                {pending === 'site' ? strings.mockups.generating : strings.mockups.generateSite}
              </button>
            </>
          ) : (
            <p className="text-sm text-ink-muted">{strings.mockups.noSitePhotos}</p>
          )}

          {anyPending ? (
            <button
              type="button"
              onClick={() => router.refresh()}
              className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {strings.mockups.refresh}
            </button>
          ) : null}
        </div>
      )}

      {anyPending ? <p className="mt-2 text-xs text-ink-muted">{strings.mockups.pending}</p> : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {mockups.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium">{strings.mockups.empty}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.mockups.emptyHint}</p>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {mockups.map((mockup) => (
            <li key={mockup.id} className="overflow-hidden rounded-md border border-line">
              {mockup.status === 'succeeded' && mockup.hasImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed
                // URLs are short-lived; the optimizer would cache one that expires.
                <img
                  src={`/api/projects/${projectId}/mockups/${mockup.id}/image`}
                  alt={`${mockup.kind} mockup`}
                  className="w-full bg-surface-muted object-cover"
                />
              ) : (
                <div className="flex h-40 items-center justify-center bg-surface-muted px-4 text-center">
                  <div>
                    <p className="text-sm font-medium">
                      {strings.mockups.status[mockup.status]}
                    </p>
                    {mockup.failureReason ? (
                      // Saying why beats a blank card the user cannot act on.
                      <p className="mt-1 text-xs text-ink-muted">{mockup.failureReason}</p>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {strings.mockups.kind[mockup.kind as 'concept' | 'site'] ?? mockup.kind}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {dateFormat.format(new Date(mockup.createdAt))}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setOpenPrompt(openPrompt === mockup.id ? null : mockup.id)}
                    className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    {openPrompt === mockup.id ? strings.mockups.hidePrompt : strings.mockups.showPrompt}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(mockup.id)}
                    disabled={pending === mockup.id}
                    className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {strings.mockups.remove}
                  </button>
                </div>

                {openPrompt === mockup.id ? (
                  <div className="mt-2 rounded-md bg-surface-muted p-2">
                    <p className="text-xs text-ink-muted">{mockup.prompt}</p>
                    {mockup.model ? (
                      <p className="mt-1 text-xs text-ink-muted">{mockup.model}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
