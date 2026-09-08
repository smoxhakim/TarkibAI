import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/http/api';
import { getShareView, recordShareView } from '@/lib/collaboration/service';
import { ClientResponseForm } from '@/components/ClientResponseForm';

export const dynamic = 'force-dynamic';

/**
 * The tab says the business and the project, not the product.
 *
 * The root metadata is TARKIB's, which is right for every signed-in page and
 * wrong for the one a client opens — their browser tab and their bookmarks
 * should carry their supplier's name, not ours.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const view = await getShareView(token);
    return {
      title: view.companyName ? `${view.projectTitle} — ${view.companyName}` : view.projectTitle,
      // A client link should never appear in a search index.
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: 'Link unavailable', robots: { index: false, follow: false } };
  }
}

/**
 * The page a client sees.
 *
 * Public: there is no session behind it, and the token in the URL is the whole
 * credential. Everything shown comes from `getShareView`, which is built
 * client-safe by construction — this component has no access to a cost, a
 * material line or a production document because nothing hands it one.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let view;
  try {
    view = await getShareView(token);
  } catch (error) {
    // A dead link looks the same as one that never existed.
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  await recordShareView(token);

  const accent = view.accentColorHex ?? '#1f2937';
  const facts: [string, string | number | null][] = [
    ['Type', view.summary.projectType],
    ['Dimensions', view.summary.dimensions],
    ['Quantity', view.summary.quantity],
    ['Where', view.summary.environment],
    ['Lighting', view.summary.lighting],
    ['Lettering', view.summary.lettering],
    ['Finish', view.summary.finish],
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-xs uppercase tracking-widest text-ink-muted">
        {view.companyName ?? 'Proposal'}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{view.projectTitle}</h1>
      <div className="mt-4 h-1 w-24 rounded" style={{ backgroundColor: accent }} />

      {view.approvedAt ? (
        <p className="mt-6 rounded-md border border-line bg-surface-muted p-3 text-sm">
          You approved this project. The team has been told.
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          The project
        </h2>
        <dl className="mt-2">
          {facts
            .filter(([, value]) => value !== null && value !== '')
            .map(([label, value]) => (
              <div key={label} className="flex gap-4 border-b border-line py-2 text-sm">
                <dt className="w-32 shrink-0 text-ink-muted">{label}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
        </dl>
      </section>

      {view.mockups.length > 0 || view.drawings.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-widest text-ink-muted">Visuals</h2>
          <div className="mt-2 flex flex-col gap-3">
            {[...view.mockups, ...view.drawings].map((image, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={index}
                src={image.dataUri}
                alt={`${view.projectTitle} visual ${index + 1}`}
                className="w-full rounded-md border border-line"
              />
            ))}
          </div>
          {view.mockups.length > 0 ? (
            <p className="mt-2 text-xs text-ink-muted">
              Indicative visualisation. Not a scale drawing, and not a guarantee of final
              appearance.
            </p>
          ) : null}
        </section>
      ) : null}

      {view.quote ? (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-widest text-ink-muted">
              Quotation {view.quote.number}
            </h2>
            <a
              href={view.quote.pdfPath}
              className="text-sm underline-offset-2 hover:underline"
              style={{ color: accent }}
            >
              Download PDF
            </a>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <tbody>
                {view.quote.lines.map((line, index) => (
                  <tr key={index} className="border-b border-line">
                    <td className="py-2 pr-3">
                      {line.description}
                      <span className="block text-xs text-ink-muted">
                        {line.quantity}
                        {line.unitLabel ? ` ${line.unitLabel}` : ''} × {line.unitPrice}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{line.lineTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="mt-3 flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd className="tabular-nums">{view.quote.subtotal}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">{view.quote.taxLabel}</dt>
              <dd className="tabular-nums">{view.quote.tax}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-1 font-medium">
              <dt>Total</dt>
              <dd className="tabular-nums" style={{ color: accent }}>
                {view.quote.total}
              </dd>
            </div>
          </dl>
          {view.quote.validUntil ? (
            <p className="mt-2 text-xs text-ink-muted">Valid until {view.quote.validUntil}.</p>
          ) : null}
        </section>
      ) : null}

      {view.messages.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-widest text-ink-muted">Messages</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {view.messages.map((message) => (
              <li key={message.id} className="text-sm">
                <span className="font-medium">{message.author}</span>
                {message.kind !== 'comment' ? (
                  <span className="ml-2 text-xs text-ink-muted">
                    {message.kind === 'approval' ? 'approved' : 'asked for changes'}
                  </span>
                ) : null}
                {message.body ? <p className="mt-0.5">{message.body}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.allowResponses && !view.approvedAt ? (
        <section className="mt-10 border-t border-line pt-6">
          <ClientResponseForm token={token} accent={accent} />
        </section>
      ) : null}
    </main>
  );
}
