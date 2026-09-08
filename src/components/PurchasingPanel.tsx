'use client';

import { strings } from '@/lib/strings';
import { formatMoney } from '@/lib/quotes/format';

export type PurchaseLineView = {
  materialName: string;
  stockSize: string | null;
  unitsToPurchase: number | null;
  lineTotalCents: number | null;
  unsupportedReason: string | null;
  warnings: string[];
};

export type PurchaseGroupView = {
  supplierName: string;
  lines: PurchaseLineView[];
  subtotalCents: number | null;
  incomplete: boolean;
};

const t = strings.purchasing;

export function PurchasingPanel({
  groups,
  showsPrices,
  emptyReason,
  currency,
}: {
  groups: PurchaseGroupView[];
  showsPrices: boolean;
  emptyReason: string | null;
  currency: string;
}) {
  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="font-medium">{t.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.subtitle}</p>

      {emptyReason ? (
        <p className="mt-3 text-sm text-ink-muted">{emptyReason}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.supplierName}>
              <p className="text-sm font-medium">{group.supplierName}</p>

              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[440px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-muted">
                      <th className="pb-1 font-medium">{t.material}</th>
                      <th className="pb-1 font-medium">{t.stock}</th>
                      <th className="w-16 pb-1 text-right font-medium">{t.buy}</th>
                      {showsPrices ? (
                        <th className="w-28 pb-1 text-right font-medium">{t.lineTotal}</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {group.lines.map((line, index) => (
                      <tr key={index} className="border-b border-line/60 align-top">
                        <td className="py-1.5 pr-2">
                          {line.materialName}
                          {line.unsupportedReason ? (
                            <span className="block text-xs text-danger">
                              {line.unsupportedReason}
                            </span>
                          ) : null}
                          {/* The engine's own caveats travel with the figure a
                              buyer is about to act on. */}
                          {line.warnings.map((warning) => (
                            <span key={warning} className="block text-xs text-ink-muted">
                              {warning}
                            </span>
                          ))}
                        </td>
                        <td className="py-1.5 pr-2 text-ink-muted">{line.stockSize ?? '—'}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {line.unitsToPurchase ?? '—'}
                        </td>
                        {showsPrices ? (
                          <td className="py-1.5 text-right tabular-nums">
                            {line.lineTotalCents === null
                              ? '—'
                              : formatMoney(line.lineTotalCents, currency)}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {showsPrices ? (
                <p className="mt-1 text-right text-sm">
                  <span className="text-ink-muted">{t.subtotal} </span>
                  <span className="tabular-nums">
                    {group.subtotalCents === null
                      ? '—'
                      : formatMoney(group.subtotalCents, currency)}
                  </span>
                </p>
              ) : null}

              {group.incomplete ? (
                <p className="mt-1 text-xs text-danger">{t.incomplete}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-muted">{showsPrices ? t.pricesNote : t.noPrices}</p>
    </section>
  );
}
