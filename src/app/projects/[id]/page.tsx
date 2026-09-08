import Link from 'next/link';
import { notFound as renderNotFound } from 'next/navigation';
import { requireDbUser } from '@/lib/auth/current-user';
import { ApiError } from '@/lib/http/api';
import { getProject } from '@/lib/projects/service';
import { strings } from '@/lib/strings';
import { StatusBadge } from '@/components/StatusBadge';
import { ProjectActions } from '@/components/ProjectActions';
import { ChatPanel } from '@/components/ChatPanel';
import { SpecPanel } from '@/components/SpecPanel';
import { listMessages } from '@/lib/ai/conversation-service';
import { isAiConfigured } from '@/lib/ai/config';
import { getSpec } from '@/lib/spec/service';
import { FilesPanel } from '@/components/FilesPanel';
import { listFiles } from '@/lib/files/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { ProjectMaterialsPanel } from '@/components/ProjectMaterialsPanel';
import { listMaterials, listProjectMaterials } from '@/lib/materials/service';
import { prisma } from '@/lib/db';
import { CostPanel } from '@/components/CostPanel';
import { getProjectCost, listExpenses } from '@/lib/calc/costs/service';
import { CanvasPanel } from '@/components/CanvasPanel';
import { getScene } from '@/lib/canvas/service';
import { DesignProposalsPanel } from '@/components/DesignProposalsPanel';
import { listProposals } from '@/lib/design/service';
import { CuttingPlanPanel } from '@/components/CuttingPlanPanel';
import { getDomain } from '@/lib/domains/registry';
import {
  listLinearCuts,
  listLinearPlans,
  listPieces,
  listPlans,
} from '@/lib/calc/cutting/service';
import { LinearCutPanel } from '@/components/LinearCutPanel';
import { EfficiencyPanel } from '@/components/EfficiencyPanel';
import { DrawingsPanel } from '@/components/DrawingsPanel';
import { listIssuedDrawings, renderLiveDrawing } from '@/lib/drawings/service';
import { MockupsPanel } from '@/components/MockupsPanel';
import { listMockups } from '@/lib/mockup/service';
import { isMockupConfigured } from '@/lib/mockup/provider';
import { getRecommendations } from '@/lib/calc/efficiency/service';
import { QuotesPanel } from '@/components/QuotesPanel';
import { getQuoteView, listQuotes } from '@/lib/quotes/service';
import { ProductionPanel } from '@/components/ProductionPanel';
import { getProductionView } from '@/lib/production/service';
import { VersionsPanel } from '@/components/VersionsPanel';
import { listVersions } from '@/lib/versions/service';
import { IntegrityPanel } from '@/components/IntegrityPanel';
import { getIntegrityReport } from '@/lib/validation/service';
import { AuditPanel } from '@/components/AuditPanel';
import { listProjectAudit } from '@/lib/audit/service';
import { formatStockSize } from '@/lib/materials/format';

export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Panels for capabilities that do not exist yet. They are rendered as explicitly
 * empty rather than filled with placeholder data: a user must never be shown a
 * number the system did not actually calculate (PRD §5.3).
 */
function PendingPanel({ title, note }: { title: string; note: string }) {
  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{title}</h2>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
          {strings.workspace.comingSoon}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{note}</p>
    </section>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireDbUser();

  let project;
  try {
    project = await getProject(id, user.id);
  } catch (error) {
    // assertProjectAccess reports both "missing" and "not yours" as 404 so the
    // page cannot be used to probe for other users' project ids.
    if (error instanceof ApiError && error.status === 404) renderNotFound();
    throw error;
  }

  const [messages, spec, files, projectMaterials, library, costSettings] = await Promise.all([
    listMessages(project.id, user.id),
    getSpec(project.id, user.id),
    listFiles(project.id, user.id),
    listProjectMaterials(project.id, user.id),
    listMaterials(user.id, { includeArchived: false }),
    prisma.costSettings.findUnique({ where: { userId: user.id } }),
  ]);
  const [costView, expenses, sceneView, proposals, cuttingPieces, cuttingPlans] =
    await Promise.all([
      getProjectCost(project.id, user.id),
      listExpenses(project.id, user.id),
      getScene(project.id, user.id),
      listProposals(project.id, user.id),
      listPieces(project.id, user.id),
      listPlans(project.id, user.id),
    ]);
  const [linearCuts, linearPlans, efficiency, liveDrawing, issuedDrawings] = await Promise.all([
    listLinearCuts(project.id, user.id),
    listLinearPlans(project.id, user.id),
    getRecommendations(project.id, user.id),
    renderLiveDrawing(project.id, user.id),
    listIssuedDrawings(project.id, user.id),
  ]);
  const [mockups, quotes, productionView, versions, integrity, auditEvents] = await Promise.all([
    listMockups(project.id, user.id),
    listQuotes(project.id, user.id),
    getProductionView(project.id, user.id),
    listVersions(project.id, user.id),
    getIntegrityReport(project.id, user.id),
    listProjectAudit(project.id, user.id, { limit: 50 }),
  ]);

  // The newest quote is the one being worked on; the rest are history. Only it
  // needs the divergence and issue checks, so only it is looked up in full.
  const activeQuote = quotes[0] ?? null;
  const quoteView = activeQuote ? await getQuoteView(activeQuote.id, user.id) : null;

  const linearMaterials = projectMaterials
    .map((row) => library.find((material) => material.id === row.materialId))
    .filter(
      (material): material is NonNullable<typeof material> =>
        material !== undefined && material.measurementModel === 'linear'
    );

  // Cutting applies to sheet stock only; linear optimisation is a later phase.
  const sheetMaterials = projectMaterials
    .map((row) => library.find((material) => material.id === row.materialId))
    .filter(
      (material): material is NonNullable<typeof material> =>
        material !== undefined && material.measurementModel === 'sheet'
    );
  const domain = getDomain(project.domain);
  const currency = costSettings?.currency ?? 'MAD';
  const aiConfigured = isAiConfigured();
  const storageConfigured = isStorageConfigured();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/dashboard"
        className="text-sm text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
      >
        {strings.workspace.backToProjects}
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
          <p className="mt-1 text-xs text-ink-muted">
            {strings.projects.createdOn} {dateFormat.format(project.createdAt)}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
            {domain.label}
          </span>
          <StatusBadge project={project} />
        </span>
      </div>

      <div className="mt-4 border-y border-line py-3">
        <ProjectActions
          projectId={project.id}
          title={project.title}
          archived={project.archivedAt !== null}
        />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <ChatPanel
          projectId={project.id}
          initialMessages={messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
          aiConfigured={aiConfigured}
          files={files.map((f) => ({ id: f.id, originalName: f.originalName, mimeType: f.mimeType }))}
        />
        <FilesPanel
          projectId={project.id}
          files={files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))}
          storageConfigured={storageConfigured}
        />
        <SpecPanel
          projectId={project.id}
          data={{
            spec: spec.spec,
            version: spec.version,
            status: spec.status,
            approvedAt: spec.approvedAt ? spec.approvedAt.toISOString() : null,
            missing: spec.missing,
            complete: spec.complete,
          }}
        />
        <IntegrityPanel report={integrity} />
        <DesignProposalsPanel
          projectId={project.id}
          proposals={proposals.map((p) => ({
            id: p.id,
            summary: p.summary,
            commands: p.commands,
            hasSpecPatch: p.specPatch !== null,
            status: p.status,
            failureReason: p.failureReason,
            createdAt: p.createdAt.toISOString(),
          }))}
        />
        <CanvasPanel
          projectId={project.id}
          view={{
            objects: sceneView.scene.objects,
            diverged: sceneView.diverged,
            seedBlockedReason: sceneView.seedBlockedReason,
          }}
          materials={library.map((m) => ({ id: m.id, name: m.name }))}
          objectTypes={domain.canvasObjectTypes}
        />
        <ProjectMaterialsPanel
          projectId={project.id}
          currency={currency}
          specApproved={spec.status === 'approved'}
          selected={projectMaterials.map((row) => ({
            ...row,
            calculatedAt: row.calculatedAt ? row.calculatedAt.toISOString() : null,
          }))}
          library={library.map((m) => ({ id: m.id, name: m.name, category: m.category }))}
        />
        <MockupsPanel
          projectId={project.id}
          configured={isMockupConfigured()}
          sitePhotos={files
            .filter((file) => file.mimeType.startsWith('image/'))
            .map((file) => ({ id: file.id, name: file.originalName }))}
          mockups={mockups.map((mockup) => ({
            id: mockup.id,
            kind: mockup.kind,
            status: mockup.status as 'queued' | 'running' | 'succeeded' | 'failed',
            prompt: mockup.prompt,
            model: mockup.model,
            failureReason: mockup.failureReason,
            hasImage: mockup.resultObjectKey !== null,
            createdAt: mockup.createdAt.toISOString(),
          }))}
        />
        <DrawingsPanel
          projectId={project.id}
          svg={liveDrawing.svg}
          views={liveDrawing.views}
          sceneEmpty={liveDrawing.sceneEmpty}
          issued={issuedDrawings.map((drawing) => ({
            id: drawing.id,
            version: drawing.version,
            label: drawing.label,
            createdAt: drawing.createdAt.toISOString(),
          }))}
        />
        <CuttingPlanPanel
          projectId={project.id}
          sheetMaterials={sheetMaterials.map((material) => ({
            id: material.id,
            name: material.name,
            sheetLabel: formatStockSize({
              measurementModel: material.measurementModel,
              standardLengthMm: material.standardLengthMm,
              sheetWidthMm: material.sheetWidthMm,
              sheetHeightMm: material.sheetHeightMm,
              thicknessMm: material.thicknessMm === null ? null : Number(material.thicknessMm),
            }) ?? '—',
          }))}
          pieces={cuttingPieces.map((piece) => ({
            id: piece.id,
            materialId: piece.materialId,
            label: piece.label,
            widthMm: piece.widthMm,
            heightMm: piece.heightMm,
            quantity: piece.quantity,
            allowRotation: piece.allowRotation,
          }))}
          plans={cuttingPlans
            .filter((entry) => entry.plan !== null)
            .map((entry) => ({
              materialId: entry.plan!.materialId,
              sheetSizeLabel: entry.plan!.stockSizeLabel,
              sheetsUsed: entry.plan!.stockUnitsUsed,
              wastePercent: entry.plan!.wastePercent.toString(),
              kerfMm: entry.plan!.kerfMm,
              edgeMarginMm: entry.plan!.edgeMarginMm,
              unplacedCount: entry.plan!.unplacedCount,
              svg: entry.svg,
              unplaced: entry.result?.unplaced ?? [],
              offcutCount: (entry.result?.sheets ?? []).reduce(
                (sum, sheet) => sum + sheet.offcuts.length,
                0
              ),
            }))}
        />
        <LinearCutPanel
          projectId={project.id}
          materials={linearMaterials.map((material) => ({
            id: material.id,
            name: material.name,
            barLabel: material.standardLengthMm
              ? `${Number((material.standardLengthMm / 1000).toFixed(3))} m bar`
              : '—',
          }))}
          cuts={linearCuts.map((cut) => ({
            id: cut.id,
            materialId: cut.materialId,
            label: cut.label,
            lengthMm: cut.lengthMm,
            quantity: cut.quantity,
          }))}
          plans={linearPlans
            .filter((entry) => entry.plan !== null && entry.result !== null)
            .map((entry) => ({
              materialId: entry.plan!.materialId,
              stockSizeLabel: entry.plan!.stockSizeLabel,
              barsUsed: entry.plan!.stockUnitsUsed,
              wastePercent: entry.plan!.wastePercent.toString(),
              kerfMm: entry.plan!.kerfMm,
              usableRemnantsMm: entry.result!.usableRemnantsMm,
              totalRequiredMm: entry.result!.totalRequiredMm,
              totalPurchasedMm: entry.result!.totalPurchasedMm,
              unplaced: entry.result!.unplaced,
              svg: entry.svg,
            }))}
        />
        <EfficiencyPanel
          projectId={project.id}
          currency={currency}
          recommendations={efficiency.recommendations}
          emptyReason={efficiency.emptyReason}
        />
        <CostPanel
          projectId={project.id}
          currency={currency}
          stale={costView.stale}
          blockedReason={costView.blockedReason}
          expenses={expenses.map((e) => ({ id: e.id, label: e.label, amountCents: e.amountCents }))}
          cost={
            costView.cost
              ? {
                  materialsCostCents: costView.cost.materialsCostCents,
                  laborCostCents: costView.cost.laborCostCents,
                  transportCostCents: costView.cost.transportCostCents,
                  installCostCents: costView.cost.installCostCents,
                  otherCostCents: costView.cost.otherCostCents,
                  internalTotalCents: costView.cost.internalTotalCents,
                  marginCents: costView.cost.marginCents,
                  clientSubtotalCents: costView.cost.clientSubtotalCents,
                  taxCents: costView.cost.taxCents,
                  clientTotalCents: costView.cost.clientTotalCents,
                  computedAt: costView.cost.computedAt.toISOString(),
                }
              : null
          }
        />
        <QuotesPanel
          projectId={project.id}
          currency={currency}
          costBlockedReason={
            costView.cost
              ? null
              : (costView.blockedReason ??
                'Calculate the project cost before quoting it. A quote is priced from the cost calculation.')
          }
          calculatedSubtotalCents={quoteView?.calculatedSubtotalCents ?? null}
          divergence={quoteView?.divergence ?? null}
          blockers={quoteView?.blockers ?? []}
          warnings={quoteView?.warnings ?? []}
          mockups={mockups
            .filter((mockup) => mockup.status === 'succeeded')
            .map((mockup) => ({
              id: mockup.id,
              label: `${mockup.kind === 'site' ? 'Site' : 'Concept'} · ${dateFormat.format(mockup.createdAt)}`,
            }))}
          active={
            activeQuote
              ? {
                  id: activeQuote.id,
                  number: activeQuote.number,
                  status: activeQuote.status,
                  clientName: activeQuote.clientName,
                  clientAddress: activeQuote.clientAddress,
                  clientPhone: activeQuote.clientPhone,
                  clientEmail: activeQuote.clientEmail,
                  mockupId: activeQuote.mockupId,
                  currency: activeQuote.currency,
                  lines: activeQuote.lines.map((line) => ({
                    description: line.description,
                    quantityMilli: line.quantityMilli,
                    unitLabel: line.unitLabel,
                    unitPriceCents: line.unitPriceCents,
                    lineTotalCents: line.lineTotalCents,
                  })),
                  subtotalCents: activeQuote.subtotalCents,
                  taxBp: activeQuote.taxBp,
                  taxCents: activeQuote.taxCents,
                  totalCents: activeQuote.totalCents,
                  issuedAt: activeQuote.issuedAt?.toISOString() ?? null,
                  validUntil: activeQuote.validUntil?.toISOString() ?? null,
                }
              : null
          }
          history={quotes.slice(1).map((quote) => ({
            id: quote.id,
            number: quote.number,
            status: quote.status,
            clientName: quote.clientName,
            totalCents: quote.totalCents,
            currency: quote.currency,
          }))}
        />
        <ProductionPanel
          projectId={project.id}
          blockers={productionView.blockers}
          gaps={productionView.gaps}
          available={productionView.available}
          packages={productionView.documents.map((entry) => ({
            id: entry.id,
            version: entry.version,
            notes: entry.notes,
            hasPdf: entry.pdfObjectKey !== null,
            createdAt: entry.createdAt.toISOString(),
          }))}
        />
        <VersionsPanel
          projectId={project.id}
          versions={versions.map((version) => ({
            id: version.id,
            versionNumber: version.versionNumber,
            label: version.label,
            reasonLabel: version.reasonLabel,
            note: version.note,
            createdAt: version.createdAt.toISOString(),
            producedQuoteNumbers: version.producedQuoteNumbers,
            producedPackageVersions: version.producedPackageVersions,
          }))}
        />
        <AuditPanel
          events={auditEvents.map((event) => ({
            id: event.id,
            action: event.action,
            summary: event.summary,
            createdAt: event.createdAt.toISOString(),
          }))}
        />
      </div>
    </main>
  );
}
