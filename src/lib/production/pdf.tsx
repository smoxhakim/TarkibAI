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
import { formatDate } from '@/lib/pdf/format';
import {
  assertNoPricing,
  type ProductionCuttingPlan,
  type ProductionDocument,
  type ProductionMaterial,
} from './document';

/**
 * The production package template.
 *
 * Designed for a bench, not a desk: high contrast, no decorative colour, and
 * every caveat printed next to the number it qualifies rather than collected in
 * a footnote nobody reads. A workshop acting on a purchase count needs to see
 * "this is a minimum" on the same line.
 *
 * It consumes `ProductionDocument` and nothing else, so it has no way to print
 * a figure the project did not record.
 */

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#9ca3af';
const FAINT = '#e5e7eb';
const ALERT = '#7f1d1d';

const styles = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
    color: INK,
    lineHeight: 1.4,
  },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 17, lineHeight: 1.2, fontFamily: 'Helvetica-Bold' },
  docKind: { fontSize: 8, letterSpacing: 1.4, color: MUTED, fontFamily: 'Helvetica-Bold' },
  headerRight: { alignItems: 'flex-end' },
  reference: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  headerRule: { height: 2, backgroundColor: INK, marginTop: 12, marginBottom: 14 },

  sectionHeading: {
    fontSize: 8,
    letterSpacing: 1.2,
    color: MUTED,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
  },
  section: { marginTop: 18 },

  pairRow: { flexDirection: 'row', paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: FAINT },
  pairLabel: { width: '32%', color: MUTED },
  pairValue: { width: '68%' },
  absent: { color: MUTED, fontFamily: 'Helvetica-Oblique' },

  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 3,
  },
  headCell: { fontSize: 7.5, letterSpacing: 0.6, color: MUTED, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: FAINT },

  cMaterial: { width: '24%', paddingRight: 6 },
  cSpec: { width: '24%', paddingRight: 6 },
  cRequired: { width: '16%', paddingRight: 6, textAlign: 'right' },
  cBuy: { width: '18%', paddingRight: 6, textAlign: 'right' },
  cWaste: { width: '18%', textAlign: 'right' },

  cComponent: { width: '52%', paddingRight: 6 },
  cQuantity: { width: '10%', textAlign: 'right', paddingRight: 12 },
  cNotes: { width: '38%' },

  bold: { fontFamily: 'Helvetica-Bold' },
  small: { fontSize: 8, color: MUTED },

  callout: {
    marginTop: 6,
    borderLeftWidth: 2.5,
    borderLeftColor: ALERT,
    paddingLeft: 7,
    paddingVertical: 3,
  },
  calloutText: { fontSize: 8, color: ALERT },

  noteBox: {
    marginTop: 6,
    borderWidth: 0.5,
    borderColor: RULE,
    padding: 8,
  },

  planBlock: { marginTop: 16 },
  planFacts: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 3 },
  planFact: { marginRight: 16, fontSize: 8, color: MUTED },
  // Width first, height only as a backstop. Capping the height at a value that
  // binds in the normal case is what turned a five-sheet plan into a postage
  // stamp with unreadable cut labels. A single sheet is about 2:1, so at full
  // measure it lands near 260pt and the cap never applies; it exists for a
  // pathologically tall stock size, which is letterboxed onto one page rather
  // than clipped.
  planImage: { marginTop: 8, width: '100%', maxHeight: 640, objectFit: 'contain' },
  // The drawing gets an explicit height so it always occupies exactly one
  // landscape page. Without it the block overflows and leaves a blank page
  // behind it.
  drawingImage: { marginTop: 8, width: '100%', height: 430, objectFit: 'contain' },

  footerRule: { position: 'absolute', bottom: 36, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: RULE },
  footerLeft: { position: 'absolute', bottom: 22, left: 40, fontSize: 7.5, color: MUTED },
  // See the note in the quote template: a <Text render> measures ~5800pt tall,
  // so it needs a maxHeight or it lands off the page.
  footerRight: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    maxHeight: 11,
    fontSize: 7.5,
    color: MUTED,
    textAlign: 'right',
  },
});

/**
 * A statement the workshop has to act on, not merely a missing value.
 *
 * "No mounting method is recorded" and "do not infer cuts from the drawing" are
 * instructions; rendering them in the same muted italic as an empty field made
 * them read as incidental. Anything telling a reader NOT to do something gets
 * the alert rule.
 */
function Caution({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.callout}>
      <Text style={styles.calloutText}>{children}</Text>
    </View>
  );
}

/** A label/value row that says "not recorded" rather than leaving a blank. */
function Pair({ label, value }: { label: string; value: string | number | null }) {
  const missing = value === null || value === '';
  return (
    <View style={styles.pairRow}>
      <Text style={styles.pairLabel}>{label}</Text>
      <Text style={[styles.pairValue, ...(missing ? [styles.absent] : [])] as StyleProp}>
        {missing ? 'Not recorded' : String(value)}
      </Text>
    </View>
  );
}

function TextLines({ value }: { value: string }) {
  return (
    <>
      {value
        .split('\n')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part, index) => (
          <Text key={index}>{part}</Text>
        ))}
    </>
  );
}

function MaterialRow({ material }: { material: ProductionMaterial }) {
  const spec = [material.stockSize, material.thickness, material.supplier]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <View wrap={false}>
      <View style={styles.row}>
        <View style={styles.cMaterial}>
          <Text style={styles.bold}>{material.name}</Text>
          {material.role ? <Text style={styles.small}>{material.role}</Text> : null}
        </View>
        <Text style={styles.cSpec}>{spec || '—'}</Text>
        <Text style={styles.cRequired}>{material.required ?? '—'}</Text>
        <Text style={styles.cBuy}>
          {material.unitsToPurchase === null
            ? '—'
            : material.stockSize
              ? `${material.unitsToPurchase} × ${material.stockSize}`
              : String(material.unitsToPurchase)}
        </Text>
        <Text style={styles.cWaste}>{material.waste ?? '—'}</Text>
      </View>

      {/* The line has no numbers and says why, instead of showing a zero. */}
      {material.unsupportedReason ? (
        <View style={styles.callout}>
          <Text style={styles.calloutText}>Not calculated: {material.unsupportedReason}</Text>
        </View>
      ) : null}

      {material.warnings.map((warning) => (
        <View key={warning} style={styles.callout}>
          <Text style={styles.calloutText}>{warning}</Text>
        </View>
      ))}
    </View>
  );
}

function CuttingPlanBlock({ plan }: { plan: ProductionCuttingPlan }) {
  return (
    <View style={styles.planBlock}>
      <Text style={styles.sectionHeading}>
        CUTTING PLAN — {plan.kind === 'sheet' ? 'SHEET' : 'LINEAR'}
      </Text>
      <Text style={styles.bold}>{plan.materialName}</Text>

      <View style={styles.planFacts}>
        <Text style={styles.planFact}>Stock: {plan.stockSizeLabel}</Text>
        <Text style={styles.planFact}>
          {plan.kind === 'sheet' ? 'Sheets' : 'Bars'} used: {plan.stockUnitsUsed}
        </Text>
        <Text style={styles.planFact}>Waste: {plan.wastePercent}%</Text>
        <Text style={styles.planFact}>Kerf: {plan.kerfMm} mm</Text>
        {plan.kind === 'sheet' ? (
          <Text style={styles.planFact}>Edge margin: {plan.edgeMarginMm} mm</Text>
        ) : null}
      </View>

      {plan.images.length > 0 ? (
        plan.images.map((image, index) => (
          // Wrapped in a non-splitting View: an Image takes no `wrap` prop, and
          // a sheet figure cut in half across a page break is unusable.
          <View key={index} wrap={false}>
            {/* react-pdf's Image draws into a PDF and takes no alt text; the
                DOM accessibility rule does not apply to it. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.planImage} src={image.dataUri} />
          </View>
        ))
      ) : (
        <Caution>
          The plan diagram could not be rendered into this package. Open the cutting plan in the
          application rather than cutting from the figures alone.
        </Caution>
      )}

      {plan.unplaced.length > 0 ? (
        <View style={styles.callout}>
          <Text style={[styles.calloutText, styles.bold] as StyleProp}>
            {plan.unplaced.length} piece{plan.unplaced.length === 1 ? '' : 's'} could not be placed
            and {plan.unplaced.length === 1 ? 'is' : 'are'} NOT in this plan:
          </Text>
          {plan.unplaced.map((piece, index) => (
            <Text key={index} style={styles.calloutText}>
              · {piece.label} — {piece.reason}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Repeated on every page. See the quote template for the maxHeight note. */
function Footer({ document }: { document: ProductionDocument }) {
  return (
    <>
      <View style={styles.footerRule} fixed />
      <Text style={styles.footerLeft} fixed>
        {document.projectTitle} · {document.reference}
      </Text>
      <Text
        style={styles.footerRight}
        fixed
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </>
  );
}

export function ProductionPdf({ document }: { document: ProductionDocument }) {
  const { versions, summary, mounting } = document;

  return (
    <Document title={`${document.reference} — ${document.projectTitle}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ width: '62%' }}>
            <Text style={styles.docKind}>PRODUCTION PACKAGE</Text>
            <Text style={styles.title}>{document.projectTitle}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.reference}>{document.reference}</Text>
            <Text style={styles.small}>{formatDate(document.generatedAt)}</Text>
          </View>
        </View>
        <View style={styles.headerRule} />

        <Text style={styles.sectionHeading}>BUILT FROM</Text>
        <Pair
          label="Specification"
          value={
            versions.specVersion === null
              ? null
              : `Version ${versions.specVersion}${
                  versions.specApproved
                    ? ` — approved ${formatDate(versions.specApprovedAt)}`
                    : ' — DRAFT, NOT APPROVED'
                }`
          }
        />
        <Pair
          label="Technical drawing"
          value={versions.drawingVersion === null ? null : `Drawing ${versions.drawingVersion}`}
        />
        <Pair
          label="Materials calculated"
          value={versions.materialsCalculatedAt === null ? null : formatDate(versions.materialsCalculatedAt)}
        />
        {/* Building to an unapproved specification is a decision somebody should
            make knowingly, so it is stated on the first page rather than buried
            in the version line. */}
        {versions.specVersion !== null && !versions.specApproved ? (
          <View style={styles.callout}>
            <Text style={styles.calloutText}>
              This package was built from a specification that has not been approved. It may not
              reflect what the client agreed.
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>SPECIFICATION</Text>
          <Pair label="Type" value={summary.projectType} />
          <Pair label="Dimensions" value={summary.dimensions} />
          <Pair label="Quantity" value={summary.quantity} />
          <Pair label="Environment" value={summary.environment} />
          <Pair label="Lighting" value={summary.lighting} />
          <Pair label="Lettering" value={summary.lettering} />
          <Pair label="Finish" value={summary.finishNotes} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>MOUNTING</Text>
          {mounting === null ? (
            <Caution>
              No mounting method is recorded for this project. Do not assume one — confirm before
              fabricating fixings.
            </Caution>
          ) : (
            <>
              <Pair label="Method" value={mounting.method} />
              <Pair label="Surface" value={mounting.surface} />
              <Pair label="Height" value={mounting.heightFromGround} />
            </>
          )}
        </View>

        {document.components.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>COMPONENTS</Text>
            <View style={styles.tableHead}>
              <Text style={[styles.cComponent, styles.headCell] as StyleProp}>COMPONENT</Text>
              <Text style={[styles.cQuantity, styles.headCell] as StyleProp}>QTY</Text>
              <Text style={[styles.cNotes, styles.headCell] as StyleProp}>NOTES</Text>
            </View>
            {document.components.map((component, index) => (
              <View key={index} style={styles.row} wrap={false}>
                <Text style={styles.cComponent}>{component.name}</Text>
                <Text style={styles.cQuantity}>
                  {component.quantity === null ? '—' : String(component.quantity)}
                </Text>
                <Text style={styles.cNotes}>{component.notes ?? ''}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {document.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>PRODUCTION NOTES</Text>
            <View style={styles.noteBox}>
              <TextLines value={document.notes} />
            </View>
          </View>
        ) : null}

        <Footer document={document} />
      </Page>

      {/* ---- Drawing ----
          Landscape. A drawing sheet is the page somebody squints at on a bench,
          and the extra 245pt of measure is roughly a 47% larger figure. */}
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View>
          <Text style={styles.sectionHeading}>
            TECHNICAL DRAWING{document.drawing ? ` — ${document.drawing.reference.toUpperCase()}` : ''}
          </Text>
          {document.drawing ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- see the plan image above
            <Image style={styles.drawingImage} src={document.drawing.image.dataUri} />
          ) : (
            <View style={styles.callout}>
              <Text style={styles.calloutText}>{document.drawingUnavailableReason}</Text>
            </View>
          )}
        </View>

        <Footer document={document} />
      </Page>

      {/* ---- Materials and cutting plans ---- */}
      <Page size="A4" style={styles.page}>
        <View>
          <Text style={styles.sectionHeading}>MATERIAL LIST</Text>
          {document.materials.length === 0 ? (
            <Caution>
              No materials have been selected for this project, so there is no material list. Do not
              order from this package.
            </Caution>
          ) : (
            <>
              <View style={styles.tableHead}>
                <Text style={[styles.cMaterial, styles.headCell] as StyleProp}>MATERIAL</Text>
                <Text style={[styles.cSpec, styles.headCell] as StyleProp}>STOCK / SUPPLIER</Text>
                <Text style={[styles.cRequired, styles.headCell] as StyleProp}>REQUIRED</Text>
                <Text style={[styles.cBuy, styles.headCell] as StyleProp}>BUY</Text>
                <Text style={[styles.cWaste, styles.headCell] as StyleProp}>WASTE</Text>
              </View>
              {document.materials.map((material, index) => (
                <MaterialRow key={index} material={material} />
              ))}
            </>
          )}
        </View>

        {/* ---- Cutting plans ---- */}
        {document.cuttingPlans.length === 0 ? (
          // No `break`: a page containing only "there is no cutting plan" is a
          // blank sheet with a sentence on it. It belongs under the materials.
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>CUTTING PLANS</Text>
            <Caution>
              No cutting plan has been computed for this project. Cut lengths and panel sizes have
              not been optimised — do not infer them from the drawing.
            </Caution>
          </View>
        ) : (
          document.cuttingPlans.map((plan, index) => <CuttingPlanBlock key={index} plan={plan} />)
        )}

        <Footer document={document} />
      </Page>
    </Document>
  );
}

export async function renderProductionPdf(document: ProductionDocument): Promise<Buffer> {
  assertNoPricing(document);
  return renderToBuffer(<ProductionPdf document={document} />);
}
