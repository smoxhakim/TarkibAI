import { requireDbUser } from '@/lib/auth/current-user';
import { getQuoteSettings } from '@/lib/quotes/settings-service';
import { isStorageConfigured } from '@/lib/storage/config';
import { strings } from '@/lib/strings';
import { QuoteSettingsForm } from '@/components/QuoteSettingsForm';
import { resolveActiveWorkspace } from '@/lib/workspaces/access';

export const dynamic = 'force-dynamic';

export default async function QuoteSettingsPage() {
  const user = await requireDbUser();
  const { workspaceId } = await resolveActiveWorkspace(user.id);
  const settings = await getQuoteSettings(workspaceId);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{strings.quoteSettings.title}</h1>
      <p className="mt-1 text-sm text-ink-muted">{strings.quoteSettings.subtitle}</p>

      <div className="mt-6">
        <QuoteSettingsForm
          hasLogo={settings.logoObjectKey !== null}
          storageConfigured={isStorageConfigured()}
          initial={{
            companyName: settings.companyName,
            companyAddress: settings.companyAddress,
            companyPhone: settings.companyPhone,
            companyEmail: settings.companyEmail,
            taxIdentifiers: settings.taxIdentifiers,
            primaryColorHex: settings.primaryColorHex,
            footerText: settings.footerText,
            termsText: settings.termsText,
            paymentDetails: settings.paymentDetails,
            validityDays: settings.validityDays,
            numberPrefix: settings.numberPrefix,
          }}
        />
      </div>
    </main>
  );
}
