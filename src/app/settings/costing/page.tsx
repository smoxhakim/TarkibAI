import { requireDbUser } from '@/lib/auth/current-user';
import { getCostSettings } from '@/lib/calc/costs/service';
import { strings } from '@/lib/strings';
import { CostSettingsForm } from '@/components/CostSettingsForm';

export const dynamic = 'force-dynamic';

export default async function CostSettingsPage() {
  const user = await requireDbUser();
  const settings = await getCostSettings(user.id);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{strings.costSettings.title}</h1>
      <p className="mt-1 text-sm text-ink-muted">{strings.costSettings.subtitle}</p>

      <div className="mt-6">
        <CostSettingsForm
          initial={{
            laborType: settings.laborType,
            laborBp: settings.laborBp,
            laborCents: settings.laborCents,
            transportType: settings.transportType,
            transportBp: settings.transportBp,
            transportCents: settings.transportCents,
            installType: settings.installType,
            installBp: settings.installBp,
            installCents: settings.installCents,
            marginBp: settings.marginBp,
            taxBp: settings.taxBp,
            currency: settings.currency,
          }}
        />
      </div>
    </main>
  );
}
