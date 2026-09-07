import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { StyleProp } from '@react-pdf/types';
import { assertClientSafe, type QuoteDocument, type QuoteDocumentLine } from './document';
import { formatDate, formatMoney, formatQuantity } from './format';

/**
 * The client quotation template.
 *
 * It consumes `QuoteDocument` and nothing else. It has no database access and
 * no imports from the cost layer, so there is no path by which an internal
 * figure could reach the page even by mistake.
 */

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
const DEFAULT_ACCENT = '#1f2937';

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 64,
    paddingHorizontal: 44,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
    color: INK,
    lineHeight: 1.45,
  },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  issuerBlock: { width: '55%' },
  logo: { maxWidth: 150, maxHeight: 56, marginBottom: 8, objectFit: 'contain' },
  companyName: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  muted: { color: MUTED },

  titleBlock: { width: '40%', alignItems: 'flex-end' },
  // An explicit line height: the page's 1.45 leaves the 22pt title's box
  // shorter than its glyphs, and the meta rows below print over the letters.
  docTitle: { fontSize: 22, lineHeight: 1.2, marginBottom: 5, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  metaRow: { flexDirection: 'row', marginTop: 3 },
  metaLabel: { color: MUTED, marginRight: 6 },
  metaValue: { fontFamily: 'Helvetica-Bold' },

  accentRule: { height: 3, marginTop: 14, marginBottom: 16 },

  panels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  panel: { width: '48%' },
  panelHeading: {
    fontSize: 8,
    letterSpacing: 1,
    color: MUTED,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  panelName: { fontFamily: 'Helvetica-Bold' },

  descriptionBlock: { marginBottom: 14 },

  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 4,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingVertical: 6,
  },
  colDescription: { width: '48%', paddingRight: 8 },
  colQuantity: { width: '16%', textAlign: 'right', paddingRight: 8 },
  colUnitPrice: { width: '18%', textAlign: 'right', paddingRight: 8 },
  colTotal: { width: '18%', textAlign: 'right' },
  headCell: { fontSize: 8, letterSpacing: 0.6, color: MUTED, fontFamily: 'Helvetica-Bold' },

  totals: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end' },
  totalsInner: { width: '52%' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: INK,
  },
  grandLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  grandValue: { fontSize: 12, fontFamily: 'Helvetica-Bold' },

  mockupSection: { marginTop: 22 },
  mockupImage: { marginTop: 6, maxHeight: 230, objectFit: 'contain' },
  sectionHeading: {
    fontSize: 8,
    letterSpacing: 1,
    color: MUTED,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  caption: { fontSize: 7.5, color: MUTED, marginTop: 4 },

  terms: { marginTop: 22 },
  termsBody: { color: MUTED },

  /**
   * The footer is three separately positioned elements rather than one row.
   *
   * A <Text render={...}> measures roughly 5800pt tall in 4.9.0 — silently,
   * with no error — so anchoring it on `bottom` puts it thousands of points off
   * the page. `maxHeight` caps the bogus measurement and is the only fix that
   * keeps the element: an explicit `height` makes the text vanish instead.
   * Nesting it in a flex row spreads the same broken height to the whole row,
   * which is why the footer is three positioned elements and not one.
   *
   * `renders the page number inside the page` guards all of this.
   */
  footerRule: {
    position: 'absolute',
    bottom: 40,
    left: 44,
    right: 44,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
  },
  footerLeft: { position: 'absolute', bottom: 26, left: 44, fontSize: 7.5, color: MUTED },
  // Spans the full measure and right-aligns. Anchoring on `right` alone gives
  // the box no width, and the page number is then drawn but never visible.
  footerRight: {
    position: 'absolute',
    bottom: 26,
    left: 44,
    right: 44,
    maxHeight: 11,
    fontSize: 7.5,
    color: MUTED,
    textAlign: 'right',
  },

  draftMark: {
    position: 'absolute',
    top: 300,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 82,
    fontFamily: 'Helvetica-Bold',
    color: '#f3f4f6',
    letterSpacing: 10,
  },
});

/** Blank lines would print as empty rows in an address block. */
function TextLines({ value, style }: { value: string | null; style?: StyleProp }) {
  if (!value) return null;
  return (
    <>
      {value
        .split('\n')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part, index) => (
          <Text key={index} style={style}>
            {part}
          </Text>
        ))}
    </>
  );
}

function LineRow({ line, currency }: { line: QuoteDocumentLine; currency: string }) {
  const quantity = formatQuantity(line.quantityMilli);
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.colDescription}>{line.description}</Text>
      <Text style={styles.colQuantity}>
        {line.unitLabel ? `${quantity} ${line.unitLabel}` : quantity}
      </Text>
      <Text style={styles.colUnitPrice}>{formatMoney(line.unitPriceCents, currency)}</Text>
      <Text style={styles.colTotal}>{formatMoney(line.lineTotalCents, currency)}</Text>
    </View>
  );
}

export function QuotePdf({ quote }: { quote: QuoteDocument }) {
  const accent = quote.issuer.primaryColorHex ?? DEFAULT_ACCENT;
  const taxLabel = `Tax / TVA (${(quote.taxBp / 100).toFixed(quote.taxBp % 100 === 0 ? 0 : 2)}%)`;

  return (
    <Document title={`Quotation ${quote.number}`} author={quote.issuer.companyName}>
      <Page size="A4" style={styles.page}>
        {quote.isDraft ? <Text style={styles.draftMark} fixed>DRAFT</Text> : null}

        <View style={styles.headerRow}>
          <View style={styles.issuerBlock}>
            {quote.issuer.logo ? (
              // react-pdf's Image draws into a PDF and takes no alt text; the
              // DOM accessibility rule does not apply to it.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image style={styles.logo} src={quote.issuer.logo.dataUri} />
            ) : null}
            <Text style={styles.companyName}>{quote.issuer.companyName}</Text>
            <TextLines value={quote.issuer.address} style={styles.muted} />
            {quote.issuer.phone ? <Text style={styles.muted}>{quote.issuer.phone}</Text> : null}
            {quote.issuer.email ? <Text style={styles.muted}>{quote.issuer.email}</Text> : null}
            <TextLines value={quote.issuer.taxIdentifiers} style={styles.muted} />
          </View>

          <View style={styles.titleBlock}>
            <Text style={[styles.docTitle, { color: accent }]}>QUOTATION</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>No.</Text>
              <Text style={styles.metaValue}>{quote.number}</Text>
            </View>
            {quote.issuedAt ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Date</Text>
                <Text>{formatDate(quote.issuedAt)}</Text>
              </View>
            ) : null}
            {quote.validUntil ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Valid until</Text>
                <Text>{formatDate(quote.validUntil)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.accentRule, { backgroundColor: accent }]} />

        <View style={styles.panels}>
          <View style={styles.panel}>
            <Text style={styles.panelHeading}>PREPARED FOR</Text>
            <Text style={styles.panelName}>{quote.client.name}</Text>
            <TextLines value={quote.client.address} style={styles.muted} />
            {quote.client.phone ? <Text style={styles.muted}>{quote.client.phone}</Text> : null}
            {quote.client.email ? <Text style={styles.muted}>{quote.client.email}</Text> : null}
          </View>
          <View style={styles.panel}>
            <Text style={styles.panelHeading}>PROJECT</Text>
            <Text style={styles.panelName}>{quote.projectTitle}</Text>
          </View>
        </View>

        {quote.projectDescription ? (
          <View style={styles.descriptionBlock}>
            <TextLines value={quote.projectDescription} />
          </View>
        ) : null}

        <View style={styles.tableHead} fixed>
          <Text style={[styles.colDescription, styles.headCell]}>DESCRIPTION</Text>
          <Text style={[styles.colQuantity, styles.headCell]}>QTY</Text>
          <Text style={[styles.colUnitPrice, styles.headCell]}>UNIT PRICE</Text>
          <Text style={[styles.colTotal, styles.headCell]}>AMOUNT</Text>
        </View>

        {quote.lines.map((line) => (
          <LineRow key={line.position} line={line} currency={quote.currency} />
        ))}

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalsInner}>
            <View style={styles.totalsRow}>
              <Text style={styles.muted}>Subtotal</Text>
              <Text>{formatMoney(quote.subtotalCents, quote.currency)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.muted}>{taxLabel}</Text>
              <Text>{formatMoney(quote.taxCents, quote.currency)}</Text>
            </View>
            <View style={[styles.grandRow, { borderTopColor: accent }]}>
              <Text style={styles.grandLabel}>Total</Text>
              <Text style={[styles.grandValue, { color: accent }]}>
                {formatMoney(quote.totalCents, quote.currency)}
              </Text>
            </View>
          </View>
        </View>

        {quote.mockup ? (
          <View style={styles.mockupSection} wrap={false}>
            <Text style={styles.sectionHeading}>VISUAL REFERENCE</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- see the logo above */}
            <Image style={styles.mockupImage} src={quote.mockup.dataUri} />
            {/* Stated on the document itself, not only in the app: an AI
                visualisation is a presentation aid and a client must not read
                it as an engineering drawing (PRD 17). */}
            <Text style={styles.caption}>
              Indicative visualisation. Not a scale drawing, and not a guarantee of final
              appearance.
            </Text>
          </View>
        ) : null}

        {quote.paymentDetails ? (
          <View style={styles.terms} wrap={false}>
            <Text style={styles.sectionHeading}>PAYMENT</Text>
            <TextLines value={quote.paymentDetails} style={styles.termsBody} />
          </View>
        ) : null}

        {quote.termsText ? (
          <View style={styles.terms}>
            <Text style={styles.sectionHeading}>TERMS</Text>
            <TextLines value={quote.termsText} style={styles.termsBody} />
          </View>
        ) : null}

        <View style={styles.footerRule} fixed />
        <Text style={styles.footerLeft} fixed>
          {quote.footerText ?? quote.issuer.companyName}
        </Text>
        <Text
          style={styles.footerRight}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

/** Renders a quote document to PDF bytes. */
export async function renderQuotePdf(quote: QuoteDocument): Promise<Buffer> {
  // Last checkpoint before bytes are produced. If a refactor ever widens the
  // document type to carry internal figures, this throws instead of printing
  // them for a client.
  assertClientSafe(quote);
  return renderToBuffer(<QuotePdf quote={quote} />);
}
