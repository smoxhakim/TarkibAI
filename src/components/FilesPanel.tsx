'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { strings } from '@/lib/strings';
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/files/schema';

export type ProjectFile = {
  id: string;
  type: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string | Date;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isImage = (mimeType: string) => mimeType.startsWith('image/');

export function FilesPanel({
  projectId,
  files,
  storageConfigured,
  canEdit,
}: {
  projectId: string;
  files: ProjectFile[];
  storageConfigured: boolean;
  /** `project.edit`. Every member may read and download; adding and removing is gated. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Three steps per file: authorise, PUT straight to R2, then confirm. The
   * bytes never pass through our server, so a large site photo is not bounded
   * by the platform's request body limit.
   */
  async function uploadOne(file: File): Promise<void> {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(strings.files.tooLarge);
    if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
      throw new Error(strings.files.wrongType);
    }

    const intentRes = await fetch(`/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        type: 'reference',
      }),
    });
    const intent = await intentRes.json().catch(() => ({}));
    if (!intentRes.ok) throw new Error(intent.error ?? strings.files.uploadFailed);

    const putRes = await fetch(intent.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!putRes.ok) throw new Error(strings.files.uploadFailed);

    const confirmRes = await fetch(
      `/api/projects/${projectId}/files/${intent.fileId}/confirm`,
      { method: 'POST' }
    );
    const confirmed = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok) throw new Error(confirmed.error ?? strings.files.uploadFailed);
  }

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      for (const file of picked) {
        await uploadOne(file);
      }
      router.refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : strings.files.uploadFailed);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(fileId: string) {
    setRemovingId(fileId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/files/${fileId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? strings.files.removeFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(strings.files.removeFailed);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{strings.files.title}</h2>
        {storageConfigured ? (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_MIME_TYPES.join(',')}
              onChange={onPick}
              disabled={uploading || !canEdit}
              className="sr-only"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className={`cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 ${
                uploading || !canEdit ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              {uploading ? strings.files.uploading : strings.files.add}
            </label>
          </>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{strings.files.subtitle}</p>

      {!storageConfigured ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-3 py-3">
          <p className="text-sm font-medium">{strings.files.notConfigured}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.files.notConfiguredHint}</p>
        </div>
      ) : files.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium">{strings.files.empty}</p>
          <p className="mt-1 text-sm text-ink-muted">{strings.files.emptyHint}</p>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {files.map((file) => (
            <li key={file.id} className="overflow-hidden rounded-md border border-line">
              <a
                href={`/api/projects/${projectId}/files/${file.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                {isImage(file.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed
                  // URLs are short-lived and single-use; the optimizer would
                  // cache a URL that expires in minutes.
                  <img
                    src={`/api/projects/${projectId}/files/${file.id}/download`}
                    alt={file.originalName}
                    className="h-24 w-full bg-surface-muted object-cover"
                  />
                ) : (
                  <div className="flex h-24 items-center justify-center bg-surface-muted text-xs text-ink-muted">
                    PDF
                  </div>
                )}
              </a>
              <div className="p-2">
                <p className="truncate text-xs font-medium" title={file.originalName}>
                  {file.originalName}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">{formatSize(file.sizeBytes)}</p>
                <button
                  type="button"
                  onClick={() => remove(file.id)}
                  disabled={removingId === file.id || !canEdit}
                  className="mt-1 text-xs text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {removingId === file.id ? strings.files.removing : strings.files.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
