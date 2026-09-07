'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { strings } from '@/lib/strings';

export type QuoteSettingsValues = {
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  taxIdentifiers: string | null;
  primaryColorHex: string | null;
  footerText: string | null;
  termsText: string | null;
  paymentDetails: string | null;
  validityDays: number;
  numberPrefix: string;
};

const t = strings.quoteSettings;

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {note ? <span className="text-xs text-ink-muted">{note}</span> : null}
    </label>
  );
}

const inputClass =
  'rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent';

export function QuoteSettingsForm({
  initial,
  hasLogo,
  storageConfigured,
}: {
  initial: QuoteSettingsValues;
  hasLogo: boolean;
  storageConfigured: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof QuoteSettingsValues>(key: K, value: QuoteSettingsValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const text = (key: keyof QuoteSettingsValues) => ({
    value: (values[key] as string | null) ?? '',
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key, (event.target.value === '' ? null : event.target.value) as never),
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch('/api/quote-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.saveFailed);
        return;
      }
      setStatus(t.saved);
      router.refresh();
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setError(null);
    try {
      // Raw bytes with the file's own content type — the server reads the type
      // from the header rather than trusting a field in a JSON envelope.
      const res = await fetch('/api/quote-settings/logo', {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? t.logoFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(t.logoFailed);
    } finally {
      setLogoBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      await fetch('/api/quote-settings/logo', { method: 'DELETE' });
      router.refresh();
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <section className="rounded-lg border border-line p-4">
        <h2 className="font-medium">{t.companyHeading}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t.companyName} note={t.companyNameNote}>
              <input className={inputClass} maxLength={160} {...text('companyName')} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label={t.companyAddress}>
              <textarea className={inputClass} rows={2} maxLength={400} {...text('companyAddress')} />
            </Field>
          </div>
          <Field label={t.companyPhone}>
            <input className={inputClass} maxLength={60} {...text('companyPhone')} />
          </Field>
          <Field label={t.companyEmail}>
            <input className={inputClass} type="email" maxLength={160} {...text('companyEmail')} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t.taxIdentifiers} note={t.taxIdentifiersNote}>
              <input className={inputClass} maxLength={300} {...text('taxIdentifiers')} />
            </Field>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line p-4">
        <h2 className="font-medium">{t.logoHeading}</h2>
        <p className="mt-1 text-sm text-ink-muted">{hasLogo ? t.logoPresent : t.logoAbsent}</p>
        <p className="mt-1 text-xs text-ink-muted">{t.logoNote}</p>
        {storageConfigured ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
            />
            <button
              type="button"
              disabled={logoBusy}
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
            >
              {logoBusy ? t.logoUploading : hasLogo ? t.logoReplace : t.logoChoose}
            </button>
            {hasLogo ? (
              <button
                type="button"
                disabled={logoBusy}
                onClick={removeLogo}
                className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
              >
                {t.logoRemove}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            File storage is not configured, so a logo cannot be stored.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-line p-4">
        <h2 className="font-medium">{t.documentHeading}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t.primaryColor} note={t.primaryColorNote}>
            <input
              className={inputClass}
              placeholder="#1f2937"
              maxLength={7}
              {...text('primaryColorHex')}
            />
          </Field>
          <Field label={t.numberPrefix} note={t.numberPrefixNote}>
            <input
              className={inputClass}
              maxLength={8}
              value={values.numberPrefix}
              onChange={(event) => set('numberPrefix', event.target.value)}
            />
          </Field>
          <Field label={t.validityDays}>
            <input
              className={inputClass}
              type="number"
              min={1}
              max={365}
              value={values.validityDays}
              onChange={(event) => set('validityDays', Number(event.target.value))}
            />
          </Field>
          <Field label={t.footerText} note={t.footerNote}>
            <input className={inputClass} maxLength={400} {...text('footerText')} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t.paymentDetails}>
              <textarea className={inputClass} rows={3} maxLength={1000} {...text('paymentDetails')} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label={t.termsText}>
              <textarea className={inputClass} rows={4} maxLength={4000} {...text('termsText')} />
            </Field>
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {status ? <p className="text-sm text-ink-muted">{status}</p> : null}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? t.saving : t.save}
        </button>
      </div>
    </form>
  );
}
