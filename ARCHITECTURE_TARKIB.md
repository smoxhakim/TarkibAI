# Architecture: TARKIB (AI Fabrication & Design Platform)

## 1. Architectural Goals

The architecture must support the complete evolution of TARKIB from a focused signage/fabrication product into a broader AI fabrication platform.

Core goals:

- Conversational AI in Moroccan Darija
- Structured project state
- Deterministic calculation engines
- Visual project workspace
- Secure project/file ownership
- Extensible industry-specific rules
- Asynchronous processing for long-running operations
- Reliable client and production documents
- Versioned project history
- Future multi-user workspace support without forcing it into the initial foundation

The system should remain pragmatic and understandable for a solo founder while being designed so major capabilities can be added without repeatedly rewriting the foundation.

---

## 2. Recommended Stack

### Core application

- Framework: Next.js + TypeScript + App Router
- UI: React
- Styling: Tailwind CSS
- API: Next.js route handlers
- ORM: Prisma
- Database: Postgres via Neon
- Authentication: Clerk
- Object storage: Cloudflare R2
- Hosting: Vercel

### AI

- OpenAI API / OpenAI Agents SDK where appropriate
- Structured outputs / tool calling
- Vision-capable model for image and reference context
- Moroccan Darija conversational instructions
- Server-side tool execution
- Agent guardrails and validation around application actions

### Image generation

- Replicate or fal.ai initially
- Image-to-image / compositing models for real-environment mockups

### Documents

- @react-pdf/renderer
- SVG/PNG rendering for diagrams and cutting plans

### Optimization

- Custom deterministic TypeScript algorithms initially
- Sheet 2D nesting/bin-packing
- Linear stock optimization in a later phase
- Configurable kerf/margin/waste rules

### Background jobs

- Inngest for slow/async workflows

### Billing

- Stripe Billing

### Email

- Resend

### Monitoring

- Sentry

---

## 3. High-Level Architecture

The application should follow this conceptual architecture:

USER
  |
  v
TARKIB WEB APP
  |
  +-----------------------------+
  |                             |
  v                             v
AI CONVERSATION LAYER       APPLICATION UI
  |                             |
  v                             |
AI AGENT / ORCHESTRATOR         |
  |                             |
  +-------------+---------------+
                |
                v
        AUTHORIZED TOOL LAYER
                |
       +--------+--------+------------------+
       |        |        |                  |
       v        v        v                  v
   Projects  Materials  Calculations     Documents
       |        |        |                  |
       +--------+--------+------------------+
                |
                v
       STRUCTURED PROJECT STATE
                |
       +--------+--------+--------+---------+
       |        |        |        |         |
       v        v        v        v         v
     Costs   Cutting  Geometry  Mockups   Versions
       |        |        |        |         |
       +--------+--------+--------+---------+
                |
          +-----+------+
          |            |
          v            v
       Postgres      R2 Storage
```

The AI agent is an interaction/orchestration layer.

It is not the database, calculation engine, authorization layer, or source of truth.

---

## 4. Core Architectural Principles

### 4.1 Structured project state

Chat history is not the source of truth.

Every project must have structured state representing the latest validated project specification and derived results.

### 4.2 Deterministic business logic

Calculations must be pure or deterministic TypeScript services where possible.

Do not ask an LLM to perform authoritative arithmetic.

### 4.3 Tool-mediated AI

The AI agent should access application capabilities through explicit tools.

Example tools:

- create_project
- get_project
- get_project_spec
- update_project_spec
- request_missing_information
- list_materials
- get_material
- calculate_materials
- calculate_cost
- generate_cutting_plan
- generate_diagram
- generate_mockup
- create_quote
- create_production_document
- get_versions

Every tool must validate inputs and authorization.

**There is deliberately no `approve_spec` tool.** An earlier draft of this
document listed one. It was removed in T1 because it contradicts PRD §5.4: if
the model can call approval, then consent is whatever the model infers from free
text, and an ambiguous "wakha" or "ok" can lock in a specification the user was
still editing. Approval is a user action in the UI, reaching
`POST /api/projects/:id/spec/approve`, which no tool wraps. The agent may say a
specification looks complete and invite review; it cannot approve it.

### 4.4 Server authority

The authenticated user is derived server-side from Clerk.

Never trust model-generated userId values.

Every project/resource query must verify ownership or future workspace access.

### 4.5 Approval-aware state transitions

Important operations should use explicit project states and approval records.

Example:

intake
  ->
spec draft
  ->
spec approved
  ->
calculated
  ->
quoted
  ->
production ready
  ->
archived

### 4.6 Domain separation

Reusable platform services should be separated from industry-specific calculation rules.

Example:

CORE:
- Project
- Materials
- Cost
- Document
- File
- Version

DOMAIN:
- Signage component rules
- Letter calculations
- Panel rules
- Profile rules
- Industry-specific fabrication logic

---

## 5. Moroccan Darija AI Architecture

Moroccan Darija is a first-class conversational language.

The system must support:

- Arabic-script Darija
- Latin-script Darija
- Darija/French code-switching
- Darija/English code-switching
- Common Moroccan technical terms

The agent should not depend on a literal translation pipeline such as:

Darija -> English -> backend

Instead:

Moroccan Darija
      |
      v
TARKIB AI AGENT
      |
      v
Structured intent / tool arguments
      |
      v
Validated backend services

The agent should be instructed to understand local phrasing while producing strict structured tool calls.

---

## 6. AI Agent Design

The initial architecture can use a single primary TARKIB agent with explicit tools.

As complexity increases, specialist agents can be introduced behind the same orchestration layer.

Potential future specialists:

- Intake/Requirements Agent
- Design Agent
- Materials Agent
- Cost Agent
- Technical Drawing Agent
- Mockup Agent
- Document Agent

Do not introduce multiple agents merely for organizational style.

Introduce them only when delegation materially improves reliability or maintainability.

---

## 7. AI Tool Contract

Each AI tool must define:

- Name
- Description
- Strict input schema
- Authorization requirements
- Side effects
- Idempotency where needed
- Structured output
- Error behavior

Example:

calculate_materials

Input:
- projectId
- approvedSpecVersion
- material selections

Server:
1. Authenticate user.
2. Verify project ownership/workspace access.
3. Load approved project data.
4. Load authorized material records.
5. Run deterministic calculation engine.
6. Persist results.
7. Return structured calculation.

The model must never directly write arbitrary database fields.

---

## 8. Data Model

The database should retain and extend the existing core entities.

### User

- id
- clerkId
- email
- name
- companyName
- logoUrl
- stripeCustomerId
- subscriptionPlan
- subscriptionStatus
- createdAt
- updatedAt

### CostSettings

One-to-one with User. Private business rules — they determine margin and never
appear on anything a client sees.

- laborType / laborBp / laborCents
- transportType / transportBp / transportCents
- installType / installBp / installCents
- marginBp
- taxBp
- currency

Percentages are integer BASIS POINTS (1250 = 12.5%), the same discipline as
storing money in minor units: exact integer arithmetic, but able to express the
half-percents real pricing uses. `type` selects which field is read — `percent`
reads the `Bp` field, `fixed` reads the `Cents` field, `manual` takes an amount
entered per project.

### QuoteSettings

One-to-one with User.

Fields include:

- logo
- branding color
- footer
- terms
- payment details

### Project

- id
- userId
- title
- status
- archivedAt
- createdAt
- updatedAt

`status` holds the workflow stage only: intake | spec_approved | calculated |
quoted | production_ready.

`archived` is deliberately NOT a status value. Archiving is orthogonal to
progress, so it is recorded by the `archivedAt` timestamp. Storing it as a
status would destroy the stage a project had reached, making restore lossy.

All Project-owned entities (ChatMessage, File, ProjectSpec, ProjectVersion,
ProjectMaterial, CuttingPlan, Diagram, Mockup, ProjectCost, Document) declare
`onDelete: Cascade`, so a permanent delete removes derived data atomically
rather than failing on a foreign key.

Future:
- workspaceId when multi-user architecture is introduced

### ChatMessage

- id
- projectId
- role
- content
- attachment references
- createdAt

Future:
- tool-call metadata
- agent run identifiers
- structured action metadata

### File

- id
- projectId
- userId
- type
- objectKey (R2 object key)
- originalName (display only)
- mimeType
- sizeBytes
- status (pending | ready)
- createdAt

Do not rely on a public storage URL as the security mechanism. The column is
`objectKey`, never a URL: a stored URL is a standing grant of access to anyone
who reads the row or a log line. Reads go through an ownership check and a
short-lived signed URL.

`status` exists because uploads go browser-to-R2 directly. A row is reserved as
`pending` before any bytes exist, and only becomes `ready` once the object is
verified in the bucket. Nothing pending is listed, downloadable, or sent to the
model.

### ProjectSpec

- id
- projectId
- version
- data jsonb
- status
- approvedAt
- createdAt

The structured spec should evolve over time while preserving backward compatibility where practical.

### ProjectVersion

- id
- projectId
- versionNumber
- label
- specSnapshot
- costSnapshot
- optional derived-state snapshots
- createdAt

### Material

- id
- userId
- name
- category
- customCategory
- supplier
- measurementModel (linear | sheet | area | piece)
- standardLengthMm, sheetWidthMm, sheetHeightMm — INTEGER millimetres
- thicknessMm — Decimal(8,2)
- unitPriceCents — price of one purchase unit, integer minor units
- technicalProperties (Json)
- notes
- archivedAt
- createdAt
- updatedAt

Stock dimensions are integer millimetres, not free text. Purchase counts are
derived from them, and a floating-point remainder can flip a division and change
how many bars or sheets someone buys. Thickness is Decimal because real stock
includes 0.5 mm and 3.5 mm.

`measurementModel` decides which dimensions are required and what
`unitPriceCents` buys: one bar, one sheet, one square metre, or one piece.

### ProjectMaterial

- id
- projectId
- materialId
- role — what the material is for, in the user's words
- requiredQuantity, requiredDimensions, unitsToPurchase, totalPurchasedQuantity,
  wastePercent, unitPriceCentsSnapshot, totalCostCents, calculatedAt — all NULLABLE
- manualOverride
- createdAt
- updatedAt

A row means "this material is used on this project" — a selection, not a result.
Every calculated field is null until the calculation engine runs, so the UI can
say "not calculated yet" instead of displaying a zero nothing computed.

Unique on (projectId, materialId): quantities belong in the fields above, not in
duplicate rows.

### CuttingPiece

- id, projectId, materialId, label, widthMm, heightMm, quantity, allowRotation

The individual pieces to cut. Stated by the user: how a facade divides into
panels is a fabrication decision involving seams and joins that the system
cannot infer from a total area.

### LinearCut

- id, projectId, materialId, label, lengthMm, quantity

A required cut length for bar, tube or profile stock. The 1D counterpart of
CuttingPiece, kept separate rather than reusing a height field that would be
meaningless — a bar cut has one dimension, and pretending otherwise invites a
wrong number into the optimiser.

### CuttingPlan

- id, projectId, materialId, kind (sheet | linear), stockSizeLabel,
  layoutData (Json), stockUnitsUsed, wastePercent, kerfMm, edgeMarginMm,
  diagramObjectKey, unplacedCount, createdAt

One plan per material, and a material is either sheet or linear. Columns were
renamed from the sheet-specific `sheetSizeLabel`/`sheetsUsed` in T9: leaving
sheet vocabulary on a table holding bar plans would have been permanently
misleading.

Unique on (projectId, materialId): one current plan per material.
`diagramObjectKey` is the R2 key of the rendered PNG, null when storage is not
configured — the in-app SVG works regardless.

Future:
- multiple stock sizes
- linear-cut representation

### Diagram

- id, projectId, version, views (Json), svg (text), sourceSnapshot (Json),
  imageObjectKey, label, createdAt

An ISSUED technical drawing: a numbered snapshot captured deliberately. The
workspace renders drawings live from current data, so nothing on screen can be
stale; this table exists because a production document must point at the drawing
a workshop was actually given. The SVG is stored as text rather than regenerated
on read, so an issued drawing stays byte-identical even if the renderer changes.

Future:
- section views
- structured geometry references

### Mockup

- id, projectId, kind (concept | site), sourceFileId, prompt, model,
  status (queued | running | succeeded | failed), resultObjectKey,
  failureReason, promptSource (Json), startedAt, completedAt, createdAt

A PRESENTATION AID, not production geometry. Generated by an image model, so it
will look plausible without being dimensionally accurate; nothing derived from a
mockup may feed a calculation. `promptSource` records the specification facts the
prompt was built from, so a result can be explained and repeated.

### ProjectCost

Internal, private:
- materialsCostCents, laborCostCents, transportCostCents, installCostCents,
  otherCostCents, internalTotalCents, marginCents

Client-facing:
- clientSubtotalCents, taxCents, clientTotalCents

Also: settingsSnapshot (Json), materialsCalculatedAt, computedAt.

### ProjectExpense

- id, projectId, label, amountCents, createdAt

A one-off internal expense for a single project — crane hire, a permit, a
subcontractor. Feeds the internal total; never becomes a client line item.

### Document

- id
- projectId
- type
- version
- R2 object key
- createdAt

---

## 9. Storage Architecture

Use Cloudflare R2 for binary project assets.

Store:

- Uploaded photos
- Logos
- Sketches
- Reference images
- Mockup source files
- Generated mockups
- Technical diagrams
- Cutting-plan images
- PDFs

Use private object keys and server-generated signed URLs.

Recommended layout:

prod/
  users/{userId}/
  projects/{projectId}/
    uploads/
    mockups/
    diagrams/
    cutting-plans/
    documents/

dev/
  ...

The database stores metadata and object keys, not binary contents.

---

## 10. Calculation Architecture

The calculation system must be independent of the AI layer.

Suggested modules:

src/lib/calc/
  materials/
  waste/
  costs/
  cutting/
  validation/

Each engine should accept validated structured input and return deterministic output.

Example:

calculateMaterialRequirement(spec, material)

=> {
  requiredQuantity,
  purchaseUnits,
  purchasedQuantity,
  waste,
  totalCost
}

Use integer minor currency units for monetary values.

Use decimal-safe arithmetic for dimensions/quantities where floating-point errors could affect purchase decisions.

---

## 11. Material Rules

Material calculations should be rule-driven where possible.

A material record may specify its measurement model:

- linear
- area
- sheet
- piece

Different domains may eventually add rules such as:

- standard bar length
- sheet width/height
- thickness
- kerf
- edge margin
- minimum usable remnant
- profile-specific properties

Do not overload the core Material entity with every possible industry-specific rule.

Prefer extensible structured technical properties.

---

## 12. Cutting Optimization Architecture

### Sheet optimization

Initial algorithm:

- 2D bin-packing/nesting heuristic
- Maximal rectangles or guillotine strategy
- Rotation
- Configurable margin
- Optional kerf

Input:

- Stock sheet dimensions
- Required pieces
- Quantity
- Material
- Cutting constraints

Output:

- Number of sheets
- Piece placement coordinates
- Waste percentage
- Visual SVG/PNG layout

### Linear optimization

Implement in a later milestone.

Input:

- Stock length
- Required cut lengths
- Quantity
- Kerf

Output:

- Number of bars/profiles
- Cut sequence
- Remnants
- Waste

---

## 13. Geometry and Technical Drawing Architecture

Do not use image generation as the technical drawing engine.

Technical drawings must be generated from structured project data.

The drawing system should evolve through layers:

### Layer 1

Template-driven SVG drawings.

### Layer 2

Structured components and reusable geometry primitives.

### Layer 3

Multi-view rendering.

### Layer 4

More advanced fabrication geometry when validated.

The system must clearly distinguish:

- Concept visualization
- Technical reference drawing
- Production-ready engineering output

Do not label a diagram as CAD-grade unless the system can guarantee the associated accuracy.

---

## 14. Smart Canvas Architecture

The long-term canvas should use structured scene/project data.

Potential model:

Canvas
  -> Objects
      -> type
      -> geometry
      -> dimensions
      -> material
      -> style
      -> relationships

AI commands modify structured objects.

Example:

User:
"zid 50cm f l3ard"

Agent:
1. Identifies target object.
2. Proposes width change.
3. Requests approval if required.
4. Calls update_canvas_object.
5. Project spec changes.
6. Dependent calculations become stale.
7. UI displays recalculation required.

The system should explicitly track stale derived data when core project inputs change.

---

## 15. Cost Architecture

Keep internal and client-facing representations separate.

Internal cost service:

Project
 -> material costs
 -> labor
 -> transport
 -> installation
 -> other expenses
 -> margin
 -> tax
 -> final client price

Client serializer:

toClientSafeProjectCost()

Only this safe representation should be passed to the client quote template.

This prevents accidental leakage of:

- Purchase prices
- Labor
- Internal expenses
- Profit margin

---

## 16. Document Architecture

Documents should be generated from structured project data.

### Client quote pipeline (implemented in T13)

Project
 -> ProjectCost (internal)
 -> Quote + QuoteLine   (client prices only; seeded from the client subtotal)
 -> buildQuoteDocument  (QuoteDocument: no internal fields exist on the type)
 -> assertClientSafe
 -> quote template
 -> @react-pdf/renderer
 -> R2
 -> signed download URL

A draft is rendered on demand and streamed, watermarked, and never stored. Only
an issued quote is written to R2, and the stored file is what a download
returns — re-rendering it could produce something subtly different from the
document the client received.

### Production pipeline (implemented in T14)

Project
 -> issued Diagram + calculated ProjectMaterial + CuttingPlan + approved spec
 -> buildProductionDocument  (ProductionDocument: no priced field exists on it)
 -> assertNoPricing
 -> production template
 -> @react-pdf/renderer
 -> R2
 -> signed download URL

A preview renders on demand and is never stored, so the gaps can be read on the
page before a version number is committed. A generated package is numbered,
stored, and downloaded from storage: the sheet on the bench and the record in
the system must be the same document.

Documents should carry a project/version reference so users can identify which project state produced them.

---

## 17. Background Jobs

Use Inngest for operations that may exceed normal request limits.

Examples:

- AI processing of long conversations
- Mockup generation
- Large PDF generation
- Complex cutting optimization
- Batch document generation

Pattern:

HTTP request
  -> create job
  -> Inngest function
  -> update job status
  -> client polls/streams status
  -> result stored
  -> UI refreshes project state

Jobs should be idempotent where practical.

---

## 18. API Design

All protected routes require an authenticated session.

Page routes and API routes fail differently on purpose. An unauthenticated page
request is redirected to Clerk's sign-in screen; an unauthenticated API request
returns a JSON 401. Redirecting an API caller to an HTML page would hand it an
unparseable response. This split is implemented in `src/proxy.ts`, which skips
`auth.protect()` for `/api(.*)` and lets each handler authenticate through
`requireDbUser()`.

Resources belonging to another user are reported as **404, not 403**. A 403
would confirm that the id exists, leaking the existence of another user's data.

Every handler must:

1. Authenticate.
2. Load resource.
3. Validate ownership/workspace access.
4. Validate body/query.
5. Execute service.
6. Return structured response.

Core routes should continue from the existing architecture and expand as capabilities are added.

### Projects

GET /api/projects
POST /api/projects
GET /api/projects/:id
PATCH /api/projects/:id
DELETE /api/projects/:id

### Chat

GET /api/projects/:id/messages
POST /api/projects/:id/messages

### Jobs

GET /api/jobs/:jobId

### Spec

GET /api/projects/:id/spec
POST /api/projects/:id/spec/approve

### Files

POST /api/projects/:id/files
GET /api/projects/:id/files
DELETE /api/files/:fileId

### Materials

GET /api/materials
POST /api/materials
GET /api/materials/:id
PATCH /api/materials/:id
DELETE /api/materials/:id
GET /api/materials/categories

### Calculations

POST /api/projects/:id/calculate-materials
GET /api/projects/:id/materials
PATCH /api/projects/:id/materials/:lineId

### Cutting

POST /api/projects/:id/cutting-plan
GET /api/projects/:id/cutting-plan

### Cost

GET /api/cost-settings
PUT /api/cost-settings
POST /api/projects/:id/costs/calculate
GET /api/projects/:id/costs

### Diagrams

POST /api/projects/:id/diagram
GET /api/projects/:id/diagram

Future:
- multi-view diagram endpoints

### Mockups

POST /api/projects/:id/mockup
GET /api/projects/:id/mockups

### Documents

POST /api/projects/:id/documents/quote
POST /api/projects/:id/documents/production
GET /api/projects/:id/documents
GET /api/documents/:id/download

### Versions

GET /api/projects/:id/versions
GET /api/projects/:id/versions/:versionId

### Settings

GET /api/quote-settings
PUT /api/quote-settings

### Billing

POST /api/billing/checkout
POST /api/billing/portal

---

## 19. Authentication and Security

Use Clerk for authentication.

Rules:

- Session-derived user identity
- Server-side authorization
- Resource ownership checks
- Strict input validation
- Private R2 objects
- Signed URLs
- Webhook verification
- AI endpoint rate limiting
- Secret values server-side only

AI tool calls must pass through the same authorization checks as normal APIs.

Do not allow the model to:

- assign ownership
- bypass approval
- grant itself permissions
- retrieve another user's resources
- alter protected system settings

---

## 20. State and Dependency Management

Derived data becomes stale when the underlying approved project specification changes.

Example:

spec changed
  ->
material calculations stale
  ->
cutting plans stale
  ->
cost stale
  ->
technical drawings stale
  ->
production PDF stale

The system should represent this dependency explicitly.

Users should be warned when a document or calculation no longer corresponds to the latest approved project state.

---

## 21. AI and Application Observability

Track:

- AI request status
- Tool calls
- Tool failures
- Job IDs
- Calculation failures
- Document-generation failures
- Mockup failures

Sentry should capture unexpected failures.

Do not log sensitive project or customer content unnecessarily.

---

## 22. Testing Strategy

### Unit tests

Prioritize:

- Material calculations
- Cost calculations
- Cutting optimization
- Currency arithmetic
- Waste calculations
- Project state transitions
- Safe client cost serialization

### Integration tests

Prioritize:

- Authentication
- Ownership checks
- API routes
- AI tool authorization
- File upload
- Document generation

### AI evaluations

Create representative Moroccan Darija test conversations including:

- Arabic-script Darija
- Latin Darija
- Darija/French
- Darija/English
- Technical vocabulary
- Ambiguous requests
- Missing dimensions
- Conflicting requirements

AI tests should measure:

- Correct intent extraction
- Correct clarification behavior
- Correct tool selection
- Avoidance of hallucinated project facts

---

## 23. Project Documentation

Keep these files synchronized:

- PRD.md
- ARCHITECTURE.md
- README.md
- TODO.md

When a milestone introduces a meaningful architectural change:

1. Update architecture documentation.
2. Update relevant API/schema documentation.
3. Record the reasoning.
4. Add or update TODO items.

Documentation should describe the actual implemented system, not an aspirational state.

---

## 24. Development Strategy

The complete platform must be built sequentially.

Use major phases instead of treating the current MVP roadmap as the final product.

### Phase 0 — Foundation

- Existing Next.js foundation
- Clerk
- Prisma
- Neon
- R2
- Base project CRUD
- Configuration

### Phase 1 — Darija AI Intake

- OpenAI agent/service
- Chat UI
- Moroccan Darija instructions
- Structured spec extraction
- Clarification logic
- Approval workflow
- File references

### Phase 2 — Material System

- User material library
- Material categories
- Technical properties
- Project material selection

### Phase 3 — Deterministic Calculations

- Material calculations
- Purchase counts
- Waste
- Cost calculations
- Stale-state detection

### Phase 4 — Smart Canvas

- Structured visual objects
- Dimensions
- AI-driven project modifications
- Version-aware canvas state

### Phase 5 — Cutting Optimization

- Sheet nesting
- Visual layouts
- Kerf/margins
- Waste reporting

### Phase 6 — Advanced Costing

- Labor
- Transport
- Installation
- Other expenses
- Profit
- Taxes
- Client pricing

### Phase 7 — Technical Drawings

- Front
- Side
- Top
- Back
- Sections
- Structured annotations

### Phase 8 — Mockups

- Design concepts
- Real-site compositing
- Async jobs
- Mockup history

### Phase 9 — Commercial Documents

- Client quotation
- Templates
- Safe financial serialization
- Versioned documents

### Phase 10 — Production Documents

- Multi-view technical package
- Material list
- Cutting plans
- Assembly guidance

### Phase 11 — Versioning

- Full revision history
- Snapshots
- Diff UI
- Reproducible documents

### Phase 12 — Advanced Fabrication Intelligence

- Linear material optimization
- Waste reduction recommendations
- More fabrication-specific rules
- More advanced calculation models

### Phase 13 — Industry Expansion

Add new industries using reusable platform capabilities and isolated domain rules.

### Phase 14 — Multi-user Workspaces

Introduce:

- Workspaces
- Team members
- Roles
- Permissions
- Shared projects
- Access controls

### Phase 15 — Commercial and Scale Features

- Billing plans
- Usage controls
- Analytics
- Client collaboration
- Advanced integrations

The exact phase ordering may change based on real product validation.

---

## 25. Milestone Rules for the Coding Agent

Before each milestone:

1. Inspect the current repository state.
2. Inspect relevant documentation.
3. Identify dependencies and affected systems.
4. State in one line what will be built.
5. Do not silently change architecture.

During the milestone:

- Keep scope focused.
- Reuse existing code.
- Avoid unnecessary dependencies.
- Add tests for important deterministic logic.
- Preserve existing functionality.

After the milestone:

- Run type checking.
- Run tests.
- Run production build.
- Verify relevant user flows.
- Summarize changed files and decisions.
- Update documentation if needed.
- STOP.

Do not automatically start the next milestone.

---

## 26. Definition of Done

A milestone is complete only when:

- Its functionality works end-to-end.
- Relevant API routes work.
- Relevant database changes work.
- Authorization works.
- TypeScript passes.
- Tests pass where applicable.
- Production build passes.
- UI states are handled.
- Errors are handled.
- The feature does not rely on an undocumented placeholder unless explicitly agreed.
- Documentation reflects the implemented behavior.

---

## 27. Architecture Change Policy

Minor implementation choices can be made without approval.

A major architecture change requires:

1. Stop implementation.
2. Explain why the current architecture is insufficient.
3. Explain the proposed alternative.
4. Explain impact.
5. Explain migration/technical debt.
6. Explain future benefits.
7. Wait for approval.

Do not swap technologies simply because another technology is easier for one feature.

---

## 28. Long-Term Architecture Principle

TARKIB should remain:

AI-driven at the interaction layer,
structured at the project-data layer,
deterministic at the calculation layer,
visual at the design/documentation layer,
and secure at the application boundary.

The final architecture should allow the user to move from:

Conversation

to

Validated structured project

to

Visual design

to

Engineering calculations

to

Commercial pricing

to

Production documentation

without breaking the link between any of those stages.

---

## 29. Implementation Decision Log

Decisions taken during implementation that are not obvious from the code alone.

### T0 — Foundation (Phase 0)

**Dependency majors raised.** The starter pinned `next@14.2.5`. Around twenty
advisories against it have ranges ending above the 14 line, meaning no 14.x
release ever fixes them — including authorization bypass, middleware/proxy
bypass, and SSRF in Server Actions and rewrites. For a product whose security
model rests on server-side ownership checks and private cost data, that was not
acceptable. Next 16 / React 19 / Clerk 7 / Prisma 7 were adopted while the
repository was still stubs and the migration cost was near zero. The documented
stack is unchanged — same technologies, current versions.

**Unused dependencies removed.** `openai`, `@react-pdf/renderer`, `inngest`,
`stripe`, `resend`, `@sentry/nextjs`, `sharp`, and the AWS SDK packages were
removed from `package.json` and are reintroduced by the phase that first uses
them. They contributed advisories while contributing no functionality. The
mapping from package to phase is recorded in README.md.

**Prisma 7 driver adapters.** Prisma 7 forbids connection URLs in
`schema.prisma` and requires an explicit driver adapter. Connection config moved
to `prisma.config.ts` (which loads `.env` via Node's built-in loader, avoiding a
`dotenv` dependency), and `src/lib/db.ts` constructs `PrismaClient` with
`PrismaPg`. Migrations use Neon's direct endpoint; runtime uses the pooled one.

**Ownership centralised in one function.** Every project read and write passes
through `assertProjectAccess(projectId, userId)` in
`src/lib/projects/service.ts`. No route handler queries `Project` directly. When
AI tools arrive in Phase 1 they call the same service layer, so the agent
inherits the identical authorization boundary rather than a parallel one — the
requirement in §7 and §19.

**Server-derived identity only.** `requireDbUser()` resolves the Clerk session
server-side and lazily creates the `User` row. No code path accepts a user id
from request input, and none will be added for AI tool calls.

**Unimplemented endpoints return 501.** `/api/projects/[id]/messages`
authenticates and authorises correctly but returns 501 rather than an empty
array. A caller must be able to distinguish "no messages" from "not built yet".
The same principle governs the project workspace panels, which state that they
are unbuilt rather than displaying placeholder figures.

**UI chrome language is English.** The conversational layer remains Moroccan
Darija. Chrome strings are centralised in `src/lib/strings.ts` so a second
language can be added without touching component code.

### T1 — Darija AI Intake (Phase 1)

**Approval removed from the tool surface.** See §4.3. The agent has exactly two
tools — `get_project_spec` and `update_project_spec` — and no path to approval.

**Tools are bound, not parameterised.** `buildToolbox(projectId, userId)`
closes over the authenticated identifiers, so `projectId` and `userId` are not
tool parameters at all. The model cannot address another project or assume
another identity regardless of what it emits, which is a stronger guarantee than
validating a model-supplied id would be.

**The spec is injected, not replayed.** Each turn sends the system prompt, a
freshly rendered snapshot of the current structured specification plus its
missing fields, and the recent plain-text messages. Tool-call plumbing is not
replayed from history. This follows PRD §9 — the specification is the source of
truth, so the agent stays correct even after older messages fall outside the
history window.

**Completeness is deterministic.** `missingFields()` decides what is missing and
whether approval is permitted. The model is told the answer; it never computes
it. Approval is refused server-side while anything required is absent, so a
persuasive reply cannot advance the project.

**Merge semantics are explicit.** Omitted keys retain their value, `null`
clears, nested objects merge key by key, and arrays are replaced wholesale.
Array replacement is intentional: merging them would make removing a material
impossible and would duplicate entries whenever the agent restated a list.

**Approved specifications are immutable.** A patch arriving after approval opens
a new draft version seeded from the approved one rather than editing it. An
approved spec is the fixed point that versions and later documents refer back
to.

**The application runs without an OpenAI key.** `isAiConfigured()` gates the
conversation; the endpoint returns 503 and the UI says the assistant is not
configured. Every other feature keeps working.

**Non-streaming replies.** A turn is one request with a pending state.
Interleaving a token stream with a multi-step tool loop adds significant
complexity, and long turns move to Inngest in Phase 12 regardless. The data
model does not change if streaming is added later.

**Model choice.** `gpt-5` by default, overridable with `OPENAI_MODEL`. Darija in
two scripts with French and English code-switching is a demanding multilingual
task, and the dominant failure mode to avoid is inventing a dimension the user
never gave.

### DesignProposal

- id, projectId, summary, commands (Json), specPatch (Json), status,
  failureReason, createdAt, decidedAt

A change to the design proposed by the agent, awaiting a human decision. Status
is pending | approved | rejected | superseded. Decided rows are never deleted:
together they are the design revision history.

### T2 — Project File Management (Phase 2)

**Uploads go browser-to-R2, not through the API.** The server authorises an
upload and returns a signed PUT URL bound to the declared content type; the
browser sends the bytes straight to R2 and then calls a confirm endpoint. A
phone photo of a shopfront routinely exceeds Vercel's request body limit, so
proxying would have capped a core use case.

**The declared size is not trusted.** A presigned PUT cannot enforce a length,
so `confirmUpload` HEADs the object, records R2's actual size, and deletes
anything over the limit rather than leaving it to accrue storage cost.

**Object keys are generated server-side and never contain the filename.** A
filename is attacker-supplied and can carry traversal or control characters. It
is stored separately as display text. Keys follow §9 and are prefixed `dev/` or
`prod/` so a local experiment cannot touch a real project's asset.

**Ownership is checked before storage availability.** An outsider gets 404, not
the 503 that would reveal whether storage is configured on the deployment.

**SVG is rejected.** It is an XML document that can carry script; serving one
from our own origin would be a stored-XSS vector. HEIC is accepted because that
is what iPhone photos arrive as.

**Vision context is inlined, not linked.** Images are fetched from R2 by the
server, re-encoded with sharp to a bounded size, and sent inline. A signed URL
would be less code but would make a private site photo fetchable by anyone
holding it for its lifetime. Re-encoding also normalises HEIC, which the API
does not accept, and honours EXIF rotation.

**Images have a shorter memory than text.** Only attachments from the most
recent few messages are re-sent. Vision tokens dominate cost, so a long thread
would otherwise carry every photo forever.

**Attachment ids are re-resolved server-side.** `loadReadyFiles(projectId, ids)`
scopes every id to the project, so a file id from another project cannot be
smuggled through a chat message into someone else's vision context.

**A file that cannot be decoded is skipped, not fatal.** Losing one unreadable
attachment is better than failing the user's whole message.

### T3 — User Material Library (Phase 3)

**Stock sizes are structured numbers, not text.** The starter stored
`standardUnitSize` as a string like "2.44x1.22m". T4 must divide by these values
to produce purchase counts, and a regex over user-typed text would silently
mis-parse "2,44 x 1,22" or "244cm" into a wrong number of sheets. Replaced with
integer millimetres per measurement model, validated so a linear material cannot
be saved without a stock length.

**Selection is separate from calculation.** ProjectMaterial's calculated columns
were made nullable rather than zero-filled. Zero-filling would have put a real
looking `0.00 MAD` in front of the user for something no engine had computed,
which is exactly what PRD §5.3 forbids.

**Materials are archived, not deleted, once used.** Deleting a material a project
references would orphan the quotes and production documents that named it, so
delete is refused with a 409 explaining that archiving is the right action.
Archived materials stay out of pickers while remaining resolvable.

**Changing the measurement model clears dimensions that no longer apply.** A
material switched from sheet to linear must not retain sheet dimensions, or the
cutting engine would later read stale geometry.

**Prices are private.** The library holds the user's suppliers and purchase
prices. Every query is scoped by the session-derived userId, and selecting a
material into a project re-checks ownership so a project can never reference
another user's pricing.

### T4 — Material Calculation (Phase 4)

**The requirement is an input, not a derivation.** The engine does not infer how
much material a project needs from spec dimensions. Deriving "an 8x3 m sign
implies a 22 m perimeter frame" would encode an assumption about how the sign is
built, and being wrong would silently produce a wrong purchase order. The user
states the requirement; the engine derives everything downstream from it. Spec
driven requirements belong with domain rules (T17), not here.

**All counts are integer arithmetic.** Purchase quantities come from a division
followed by a ceiling, and in binary floating point a value that should divide
exactly can land either side of the boundary — buying one bar too many, or one
too few. Lengths are computed in whole millimetres, areas in square millimetres,
via `ceilDiv`. Decimals appear only when formatting output.

**Sheet counts are a labelled minimum, not an optimisation.** `ceil(required m² /
sheet m²)` assumes pieces nest perfectly with zero offcut, which real cutting
never achieves. Every sheet result carries a warning saying so and pointing at
the cutting plan (T8) for the true count. This keeps the engine useful for the
most common signage material without presenting an area division as a nesting
result, which §14 of the PRD forbids.

**Calculation requires an approved specification.** Quantities derived from a
draft would be numbers nobody agreed to, and the stage machine expects
spec_approved before calculated.

**Inputs are snapshotted with the result.** `calculationInputs` stores the stock
dimensions, price, derivation steps and warnings as they were at calculation
time. Without it, editing a material afterwards would silently rewrite the
explanation of a calculation that may already have been quoted.

**Stale data is flagged, not hidden.** A line reports `spec_changed`,
`material_changed`, or `requirement_changed` while keeping its previous numbers
visible, so the user can see what the old result was before recalculating
(PRD §24).

`requirementUpdatedAt` exists specifically because the calculation writes to the
same row: `updatedAt` cannot distinguish "the user changed the quantity" from
"we just calculated", and using it marked every line stale the moment it was
calculated.

**An unsupported line stores a reason and no numbers.** If stock dimensions are
missing the engine refuses rather than guessing, and any previous result is
cleared — a stale number beside an "unsupported" message is worse than none.

### T5 — Cost Engine (Phase 5)

**Order of operations is part of the contract.** materials + labour + transport
+ installation + other = internal total; × margin = margin; internal + margin =
client subtotal; × tax = tax; subtotal + tax = client total. A different order
gives a different number, so it is fixed and tested.

**Percentage components apply to the MATERIAL cost, not a running subtotal.**
Labour, transport and installation are therefore independent of one another and
of the order they are applied in, which makes a breakdown checkable by hand. A
compounding model would make the total depend on component ordering.

**Percentages are basis points.** The starter stored whole integer percents,
which cannot express a 12.5% margin or 7.5% transport. Basis points keep the
arithmetic exact while allowing half-percents, and `applyBasisPoints` rounds
half away from zero rather than toward positive infinity, so the helper stays
correct if credits are ever introduced.

**`toClientSafeCost` is built by construction, not by deletion.** It names the
three safe fields explicitly instead of stripping unsafe ones from the internal
object. Deletion is fragile — a field added to the breakdown later would leak by
default. Construction means a new internal field is invisible to clients unless
somebody deliberately adds it. A test asserts a polluted input still yields
exactly three keys.

**Costing requires calculated materials.** Every percentage is applied to the
material cost, so costing without it would have no base. The route reports why
rather than returning zeros.

**Settings are snapshotted onto each ProjectCost**, so a breakdown stays
explicable after the user changes their rules, and costs are flagged stale when
materials are recalculated underneath them.

**An arithmetic identity worth knowing:** at 25% margin with 20% tax, the margin
and the tax are always numerically equal, because
tax = (internal x 1.25) x 0.20 = internal x 0.25 = margin. This is not a bug,
but it does mean value-based leak assertions need rates where the two differ.

**Defaults are all zero.** A user who has not configured costing gets no margin
and no labour rate, because inventing either would silently mis-price their
first quote.

### T6 — Structured Smart Canvas (Phase 6)

**The canvas is geometry, not a picture.** Objects carry integer millimetres —
the same unit the material and cutting engines use — so an 8 m sign is 8000
units wide and that number is the one a calculation would consume. Nothing here
is image generation; the scene is measurable, labellable, and is the foundation
the technical drawing system (T11) and production document (T14) build on.

**The specification stays the source of truth.** A scene records
`specVersionAtSeed` and is flagged as diverged when a newer spec is approved.
Canvas edits are layout detail and never rewrite an approved dimension — letting
them would allow a typo to silently change a signed-off fact without passing
through approval (PRD §9, §5.4).

**One command vocabulary.** `add_object`, `update_object`, `remove_object`
validated by Zod and applied by a pure reducer. The edit panel uses it today and
the T7 design tools will use exactly the same commands, so the agent inherits
this validation instead of getting a parallel path into the data. `update_object`
ignores undefined fields, so a width change cannot erase a label or a material
link.

**Batches are applied in memory before persisting**, so an invalid command
midway through leaves the stored scene untouched rather than half-updated.

**Seeding derives only from stated facts.** A scene is built from the approved
width, height and unit, plus lettering ONLY when the spec records text. With no
usable dimensions it refuses rather than drawing a placeholder rectangle — an
unknown size is not a size.

**Rendering is a pure deterministic function.** The same scene always produces
identical SVG, which is what makes a drawing reproducible from project data.
Labels are XML-escaped at the renderer, since they are user input rendered into
markup.

**Label placement is computed, not naive.** Structural objects (panel, frame,
note) are typically concentric, so centring every label stacked them into
unreadable overlap. Their labels are corner-anchored and pushed onto separate
lines when they would collide; only objects whose label IS their content
(lettering, lighting) are centred. This was found by rendering a realistic scene
and looking at it — unit tests asserting valid SVG passed throughout.

### T7 — Conversational Design Editing (Phase 7)

**The agent proposes; it cannot apply.** There is no tool that mutates the
canvas, and no tool that approves anything. `propose_design_change` writes a
DesignProposal and returns a note stating plainly that nothing has changed yet,
so the model does not report the edit as done. A test enumerates the toolbox and
asserts no mutation or approval tool exists — that guarantee is structural, not
a matter of prompt wording.

**Every AI change is a proposal, including cosmetic ones.** The alternative —
letting trivial edits through — requires the model to judge whether its own
change is important, which is precisely the judgement PRD §5.4 says not to
delegate. A uniform rule costs one click on a rename and removes a whole class
of misclassification.

**Relative changes are computed from real geometry.** "zid 50cm f l3ard" means
current + 500 mm, so the agent must call `get_canvas` first. The prompt forbids
guessing a current size, and the live evaluation asserts the resulting proposal
contains 8500 mm for a panel that is actually 8000 mm.

**Commands are validated twice: at proposal and at approval.** Validating early
lets the agent see the error and correct itself conversationally. Validating
again at approval matters because the scene may have changed in between — if the
target object was deleted meanwhile, the proposal fails and records why rather
than silently doing something else.

**A pending proposal supersedes any earlier one.** Two competing pending changes
to the same scene could be approved in an order that produces a result neither
proposal described.

**A dimensional change writes a new DRAFT specification.** Approving a proposal
that carries a `specPatch` updates the canvas and creates a draft spec revision;
it does not touch the approved one. An agreed dimension is a signed-off fact, so
changing it passes back through spec approval — which is also what marks
calculations, costs and documents stale downstream (PRD §24). Renaming or moving
an object carries no patch, because layout is not an agreed project fact.

**The proposal UI describes the COMMANDS, not the agent's prose.** The summary
is model-written text; the change list is rendered from the commands that will
actually execute. A user approving a change sees the real operation.

### T8 — Sheet Cutting Optimization (Phase 8)

**Guillotine, not free nesting.** Every cut runs edge to edge across the region
being divided, which is what a panel saw physically does. Free nesting packs
tighter, but a free-nested layout cannot be produced on a panel saw at all,
while a guillotine layout cuts fine on both a saw and a CNC router. The extra
waste buys a plan every workshop can execute. The constraint lives in
`splitFreeRect`, which divides a remainder with one straight cut into exactly
two rectangles — never an L-shape.

**Pieces are stated, not derived.** Nesting needs individual dimensions, which a
total area cannot supply. Deriving them from canvas objects would mean deciding
where to seam an oversized panel, a fabrication decision with joins and edges
that the system has no basis to make. An oversized piece is reported as unplaced
with its reason rather than split.

**Kerf is modelled, not ignored.** Each cut consumes blade width, so a piece
placed beside another needs its own width plus kerf. Two 1220 mm pieces fit a
2440 mm sheet exactly with no kerf and need two sheets with a 4 mm blade —
ignoring this is the classic way a plan that looks right on paper comes up short
on the last piece.

**Rotation respects grain.** Pieces carry `allowRotation`, false for material
with a grain or print direction, where a 90° turn would spoil the piece.

**Integer millimetres throughout**, as in the material and cost engines: a
floating-point remainder deciding whether a piece "just fits" would change how
many sheets are bought.

**Incomplete plans are stored.** When some pieces cannot be placed, the plan is
saved with the unplaced list and reasons. Refusing to store anything would lose
the placements that did work; dropping the pieces silently would be far worse.

**Offcuts are reported as usable rectangles**, largest first, so a workshop sees
reusable material rather than treating the remainder as scrap.

**Kerf and edge margin come from `Material.technicalProperties`**, the
extensible field added in T3 for exactly this, with a per-plan override. The
values used are snapshotted onto the plan.

**A PNG is rasterised to R2 via sharp**, because the PDF renderer for production
documents cannot lay out arbitrary SVG. Failure is non-fatal: the plan and its
in-app SVG are the real output.

This replaces T4's area-based estimate as the authoritative sheet count. T4's
warning now points at the cutting plan rather than saying it does not exist.

### T9 — Linear Material Cutting (Phase 9)

**A length division under-counts bars, and T4 was presenting it as exact.**
Found while building this milestone: four 4 m pieces from 6 m bars is 16 m of
material, which divides to three bars — but only ONE 4 m piece fits per bar, so
four are needed. T4's linear result had `warnings: []`, so the material panel
showed a bar count that could be too low with nothing saying so. Under-buying
stops a job mid-fabrication. T4 now carries the same MINIMUM caveat the sheet
path has and names this exact case.

The T4 test suite did not catch it because it asserted the purchased *length*
was never less than required, which is true — the flaw is that the length is not
usable in the required cut sizes.

**First Fit Decreasing.** Cuts are sorted longest first and placed into the
first bar with room. FFD is the standard heuristic for one-dimensional cutting
stock, is deterministic, and is provably within 11/9 of optimal plus a constant
— a gap smaller than the variation between real saw operators.

**Kerf is charged between cuts, not after the last one.** A cut only needs blade
clearance when material follows it on the bar. Charging unconditionally would
waste a blade width per bar and inflate the bar count.

**A remnant worth keeping is stock, not waste.** Tails at or above
`minUsableRemnantMm` (from the material's technical properties) are reported as
reusable and excluded from the waste figure; shorter ends are scrap. Counting a
keepable 2 m tail as waste would overstate what a job actually costs.

**Cuts longer than a bar are refused, not spliced.** Joining two bars to make one
long piece is a decision about joints and structural strength, not an
optimisation.

**Sheet and linear plans share one table, discriminated by `kind`.** Each
listing filters on it, because the two `layoutData` shapes are entirely
different and cross-contamination would surface as a rendering failure.

**Caption overflow is handled deterministically.** A 600 mm cut is a narrow box;
a label wider than its segment spills over the neighbour and both become
unreadable. The caption degrades from full label, to length alone, to nothing.
Found by rendering a realistic plan and looking at it — the same way the T6
label defect surfaced.

### T10 — Material Efficiency Recommendations (Phase 10)

**Every saving is computed by re-running the real engines.** A recommendation is
produced by running the SAME cutting engine against the alternative and diffing
two real results. Nothing approximates a saving, and nothing is generated by a
model. This is the milestone's central rule from PRD §13: the AI may surface and
explain a recommendation; the deterministic engines decide whether it is true.

**Alternatives come only from the user's own library.** Suggesting a 4 m bar
because it nests better would be inventing supplier availability — the system has
no basis to believe it can be ordered. Archived materials are excluded too,
since archived stock is not something the user still buys. If a better size
exists that they do not stock, they add it and re-check.

**A recommendation must strictly reduce cost, not unit count.** Fewer sheets at
a higher unit price can cost more. Comparing on sheet count would let the panel
advertise "3 instead of 4" while quietly increasing the bill, which is worse than
saying nothing. Candidates that cannot produce every piece are discarded
regardless of price.

**Nothing is stored.** Recommendations are computed on demand. A stored saving
goes stale the moment a price, a piece list or a material changes, and stale
financial advice is worse than none. Recomputation is cheap — it is the same
engines the plans already run.

**Rotation is reported, never applied.** Rotation is disabled on a piece for a
reason: grain, print direction, a brushed finish. The recommendation states the
saving and leaves the judgement to the user, with no apply button, rather than
assuming the flag was a mistake.

**Applying is a plain deterministic reassignment.** The click is the approval
PRD §13 requires. Switching moves the project's pieces and cuts to the new
material, clears calculated figures that were computed for the old one, and
deletes the old cutting plan — which described stock the project no longer uses.

**The agent's tool is read-only.** `get_material_recommendations` lets it explain
savings in Darija but cannot generate or alter one, and cannot apply anything.
The toolbox is now: get_project_spec, update_project_spec, get_canvas,
get_material_recommendations, propose_design_change. Still no tool that mutates
the canvas or approves anything.

**An interaction worth recording:** with a permissive remnant policy
(`minUsableRemnantMm` of 0), a wasteful bar choice reports 0% waste because every
tail counts as reusable stock. The money is then the whole signal. This follows
correctly from T9's rule that a keepable remnant is not a loss, and a test
asserts both halves so the behaviour is not mistaken for a bug later.

### T11 — Structured Technical Drawings (Phase 11)

**Drawings are generated from geometry, never from image generation.** Every
coordinate traces to a millimetre the user stated. The sheet itself carries the
statement ARCHITECTURE §13 requires — "technical reference drawing… not a
certified engineering drawing… verify dimensions before fabrication" — printed
on the drawing rather than only in the UI around it, because the printed sheet
is what reaches a workshop.

**Depth is per object and optional.** The canvas is a front elevation, so front
and back need nothing extra. Side and top need depth, which genuinely differs per
part: a 3 mm alucobond skin, a 40 mm frame, 80 mm built-up letters. Applying one
project-level depth to everything would draw those three as identical slabs — a
side view that looks precise and is wrong is worse than no side view. Objects
without a depth are omitted from those views and named.

**Depth-view stacking is an admitted approximation.** The scene records no
z-position, so parts are stacked outward from the wall in scene order. That is
the only assumption which adds no false precision about stand-off distance.

**Numbered callouts, not inline labels.** Rendering a realistic sheet showed two
failures that inline labels cannot survive: concentric parts (a panel inside its
frame) had colliding labels, and a top view of an 8 m sign 123 mm deep is a thin
strip in which no text fits at all. Parts now carry a number and a legend beneath
the view, which is how technical drawings have always solved this and works at
any aspect ratio. Callout positions are collision-stacked as well, since numbers
on concentric parts land within a few units of each other.

**Live rendering plus explicit issuing.** The panel always renders from current
data and therefore cannot be stale. Issuing stores a numbered snapshot with its
rendered SVG and a copy of the scene it came from. A production document (T14)
will reference an issued drawing, so the workshop copy and the record cannot
drift apart.

**Sections are deliberately not implemented.** A section requires a cut plane
and knowledge of internal construction that the scene does not hold. Drawing one
would mean inventing internal structure — Layer 4 work, and only once the
geometry can support it.

### T12 — AI Mockups (Phase 12)

**The prompt is built from stated facts only.** Project type, dimensions,
materials, lettering, lighting, mounting and environment come from the
specification; nothing else is added. A mockup showing a material or colour
nobody specified will be read as a proposal and argued about with a client.
Generation is refused outright when the project has not been described, because
the model would otherwise invent the entire project.

**Proportions are carried through, and that took two attempts.** Rendering an
8 × 3 m sign square would show a sign nobody is buying. A first implementation
floored the short edge at 768 px, which silently squared that sign off from
2.67:1 to 1.875:1 — the exact failure the function exists to prevent. A second
attempt at 320 px still could not express a 6 m × 1 m fascia band, an entirely
ordinary piece of signage. The floor is now 128 px, giving roughly 11:1, and
beyond that the distortion is documented rather than hidden.

**Inngest, because fire-and-forget does not survive serverless.** On Vercel a
function is killed once it responds, so a promise left running after the
response never completes. The job row is created as `queued` before dispatch, so
a generation that never starts shows as a stuck job rather than being silently
absent.

**Dev mode is derived, not configured.** Without it the SDK assumes cloud mode
and refuses to start for want of a signing key, breaking the app locally for
anyone who has not set up Inngest. The condition can never be true in
production, so the signature check cannot be skipped by accident on a deployed
instance.

**`/api/inngest` is excluded from Clerk.** The job runner calls it as a machine
with no session; it authenticates by request signature instead. This is the
first route in the application deliberately outside the session boundary, and it
is guarded by `INNGEST_SIGNING_KEY` in production.

**Every failure records a reason.** A card stuck on "running" tells a user
nothing they can act on; one that says the model timed out tells them to retry.
Retries are bounded at two, because a failing image model keeps failing and each
attempt costs money.

**A succeeded mockup is never regenerated**, so the same result cannot be paid
for twice.

**Images are private.** Results go to R2 under the project's prefix and are
served through an ownership-checked redirect to a short-lived signed URL — the
same pattern as project files.

### T13 — Client Quote System (Phase 13)

**A typed `Quote` model, not the generic `Document` row.** A quote carries
structured data that must be frozen — client block, priced lines, tax rate,
company block — and `Document` holds only a type, a version and a URL. The
generic model is left for T14 to decide on. Every other milestone that produced
an artefact (Mockup, Diagram, CuttingPlan) made a typed model, and quotes are
not the place to break that.

**The client-safe boundary is a type, not a filter.** `QuoteDocument` is built
field by field from the quote and the issuer block, and the PDF template
consumes nothing else. It has no import from the cost layer, so there is no path
by which margin or a purchase price could reach the page. A deny-list would leak
any internal column added later, by default; here such a column is simply absent
unless someone deliberately adds it to the type — and `assertClientSafe`, which
runs on the way into the renderer, then throws.

**The leak test asserts on the rendered page, not on the object.** It costs a
project to known figures, renders the PDF, decompresses the content streams and
reads back the text a client would actually see. Asserting on the document
object would prove only that the object is clean.

**And it guards its own premise.** At 25% margin and 20% tax the two are always
equal — the tax on a marked-up total is exactly the markup — so a leak test at
those rates passes on an arithmetic identity rather than on the separation it
means to prove. The fixture uses 40% and 20%, and asserts up front that no
internal amount coincides with a client amount before asserting that none
appears.

**Line totals are rounded once, in the engine.** Quantities are integer
thousandths and money integer minor units. Rounding at display time instead
would let the printed lines sum to something other than the printed subtotal,
which is the first thing a client checks. Tax is applied to the subtotal and
never per line: rounding each line's tax and summing gives a different figure
from taxing the sum, and the sum is what is being charged.

**A quote cannot exist without a cost calculation.** Creating one is refused
until the project has been costed, and the first line is seeded at the
calculated client subtotal. A quote conjured without one would be a price with
no basis.

**But the user may still price differently, visibly.** The lines are theirs to
write, and the subtotal follows the lines rather than being pinned to the
engine. The gap between the two is computed and shown. Forbidding the deviation
would be wrong — the user is the authority on price — and permitting it
silently would be worse.

**The tax rate comes from the cost's snapshot, not from today's settings.**
Otherwise editing the tax rate would silently re-price a quote built on an older
calculation, and its totals would no longer reconcile with the cost behind it.

**Issuing freezes and is not reversible.** The company block is snapshotted onto
the quote, so renaming the business later does not rewrite a document a client
is holding. An issued quote cannot be edited or deleted; re-quoting means a new
quote with a new number. Rendering is synchronous — a one-page quote takes well
under a second, and a job queue would add a queued state and a failure mode for
nothing. If the PDF fails to render or store, the quote is rolled back to draft:
a number marked issued that the user cannot send is worse than no number.

**Numbers are allocated at creation, not at issue.** A draft therefore has one
stable identity from the moment the user starts writing it, at the cost of gaps
in the sequence where drafts were abandoned. The unique constraint on
(userId, sequence) is the real guard — two concurrent creates collide there
rather than handing the same number to two clients.

**Arabic script is reported, not silently dropped.** The template uses the
built-in Helvetica family, which has no Arabic glyphs: Arabic text renders as
blank boxes on a document a client receives. The quote view detects it and says
so. Embedding a font is deferred, not overlooked.

**The logo is uploaded through the server.** Project files are presigned and
sent straight to R2 because they can be large. A logo is capped at 2 MB and
replaces one row field, so the presign/confirm handshake would buy nothing.

**react-pdf mis-measures `render`-prop text, silently.** A `<Text render={...}>`
measures roughly 5800pt tall in 4.9.0, so anchoring it on `bottom` places it
thousands of points off the page — and nesting it in a flex row spreads that
height to the whole row, which is how the footer first disappeared. The PDF was
structurally valid and contained every character; only the placement transforms
said otherwise. `maxHeight` caps the bogus measurement; an explicit `height`
makes the text vanish instead. `offPagePlacements` reads the transforms back and
fails the test when anything lands off the paper, because no assertion about
text content can catch this class of defect.

### T14 — Production Package (Phase 14)

**`Document` became the production record; `Quote` stayed its own model.** T13
left this open. A quote carries structured commercial data that must be frozen —
client block, priced lines, tax rate. A production package carries none of its
own: it is a rendering of state that already exists, so what is stored is a
reference to that state plus the notes written at generation time. The empty
`pdfUrl` column was dropped for `pdfObjectKey`, because no URL is stored
anywhere in this application; the table had never been written to.

**No money reaches the workshop copy.** The shop floor needs quantities and
specifications, not prices, and a package can end up with a subcontractor.
`ProductionDocument` has no priced field and `assertNoPricing` throws on the way
into the renderer, the same construction as the quote's client-safe boundary
applied to a different audience. An integration test costs a project first, so
the figures it looks for are ones that would be recognisable if they leaked.

**Nothing about assembly is inferred.** The application does not know how a sign
is built. The package prints the mounting method, surface and height somebody
actually recorded, and when the spec records none it says so and tells the
reader not to assume one. A plausible-looking build sequence would be the most
dangerous invented content in the product: unlike a wrong price, a workshop acts
on it directly.

**Gaps are printed, not hidden and not fatal.** A package can be built from a
drawing alone or a material list alone — refusing would be unhelpful — but the
document states what it does not contain: no drawing issued, no cutting plan
computed, and in that case an explicit instruction not to infer cut sizes from
the drawing. Only a project with neither a drawing nor a calculated line is
refused, because that package would say nothing.

**Anything telling the reader NOT to do something gets the alert rule.** In the
first draft "no mounting method is recorded — do not assume one" rendered in the
same muted italic as an empty field, which read as incidental. Instructions and
absent values are now visually distinct.

**Calculation caveats travel to the bench.** T4's linear count is a minimum, and
that caveat is printed beside the purchase figure rather than left in the app.
Someone ordering from the sheet is exactly who needs it.

**Drawings render on a landscape page.** A drawing sheet is the page somebody
squints at, and landscape A4 gives 762pt of measure against 515pt — a 47% larger
figure, which is the difference between a readable callout legend and a
decorative one.

**A cutting plan is split one image per sheet, and this was a real defect.** The
plan renderer stacks every sheet into one tall figure. Placed on a page, a
five-sheet plan is 1:2.7, so fitting it to the page height shrinks it to about a
quarter of the measure and takes the piece labels with it — a cutting plan
nobody can cut from. Every test passed; the PDF was valid; the document was
useless. Split per sheet each figure is roughly 2:1 and fills the measure. The
renderer keeps the correct "Sheet 3 of 5" label because it reads the sheet's own
index and the plan's total, not the length of the array handed to it.

**Height caps are a backstop, never the normal case.** The original bug was a
300pt cap that bound on ordinary plans. Plan images are now sized by width, with
a cap high enough that only a pathological stock aspect reaches it, and the
drawing gets an explicit height so it always occupies exactly one page.

**`countPages` guards the layout.** An overflowing block does not raise an error
in react-pdf — it silently leaves an empty page behind, and every assertion
about text still passes because the text is all on the pages before it. The
count caught a stray page break under the empty-cutting-plans branch that visual
inspection had rationalised away.

**Generation is synchronous.** The heavy part is rasterising the drawing and
each sheet, which run together and come from data already in the database — no
model call, no third-party API. This is the operation ARCHITECTURE 17 has in
mind for the job runner if projects ever carry enough plans to approach the
request limit; it does not need it yet.

**The PDF extractor learned WinAnsi.** react-pdf writes an em dash as the single
byte 0x97, which Latin-1 decodes to an unprintable control character. An
assertion on "led — halo-lit" then failed against a PDF that rendered it
perfectly, so the extractor now maps the 0x80-0x9F range.

### T15 — Version History (Phase 15)

**Versions are append-only, and that is the whole promise.** T13 and T14 both
sell traceability: a quote or a package can be traced to the state that produced
it. That only holds if the state cannot be edited afterwards. Restoring writes a
new draft and a new version; it never rewrites or removes an earlier one.

**Recorded at authoritative moments, not on every recalculation.** A version is
written when a specification is approved, a design accepted, a quote issued, a
package generated, or when the user asks for one. Material and cost
recalculations deliberately do not write versions: they run often, and a
timeline flooded with them would bury the moments that matter. Those are already
auditable at row level — `ProjectMaterial.calculationInputs` and
`ProjectCost.settingsSnapshot` each snapshot the rules that produced them.

**Snapshots copy, they never recompute.** Spec, canvas, material lines, cost and
document references are stored as they stood. A version stays reviewable after
the engine that produced its numbers has changed, which is the point of keeping
it.

**An absent section is not an empty one.** A project with no canvas snapshots
`null`; a project whose canvas was emptied snapshots `[]`. The diff reports the
first as "cannot be compared" and the second as objects removed. Conflating them
would report a deletion that never happened — and older versions, written before
canvas snapshots existed, are exactly the case that would trigger it.

**The diff is pure and deterministic.** Same two snapshots in, same diff out, no
database and no model. A version comparison is a factual statement about what
changed; a summary written by a language model would be a plausible account of
one. Output is sorted by path so the same comparison always reads the same way.

**Named arrays are keyed by name, not by index.** Reordering two components in
the specification would otherwise read as four changes. Arrays of scalars stay
whole, because "colors: red, white" is one fact to a reader rather than two.

**`computedAt` is excluded from the cost diff.** Re-running a calculation on
unchanged inputs is not a change to the cost, and reporting the timestamp would
bury the figures that actually moved.

**Comparing against the present needs no version.** "What has moved since we
approved this?" is the question users actually have, and requiring a snapshot of
the current state to answer it would mean taking one on every page load.

**Restoring is deliberately partial, and says so before it runs.** It restores
the specification and the canvas; it does not restore calculations. Those
numbers were derived from the specification being moved away from, so writing
them back would present figures that no longer follow from the project. They go
stale instead, which the material and cost panels already detect and report. The
restore preview states all four consequences — new draft, calculations not
restored, issued documents untouched, nothing deleted — before the user
confirms.

**Restoring returns the project to intake.** The working specification is
unapproved again, and a later stage would describe state that no longer holds.

**Version capture never fails the thing that caused it.** Inside `approveSpec`
it shares the transaction, because an approved specification must not exist
without its snapshot. For a design approval, an issued quote or a generated
package the capture is outside the transaction and its failure is logged: the
design is already applied and the PDF already stored, and losing a history entry
is not a reason to undo them. The document's `projectVersionId` is simply absent
in that case rather than pointing at nothing.

### T16 — Validation and Safety Layer (Phase 16)

**Severity is a promise about what happens next.** `blocker` means an action is
refused; `warning` means it proceeds and the user is told first; `note` means
worth knowing. Getting this wrong in either direction is a product failure —
refusing legitimate work, or letting a wrong number reach a client — so the
boundary is written down rather than decided per check.

**A plausibility check is never a blocker.** An 80 m sign is unusual, not
impossible. Dimension checks warn about what looks like a slipped decimal and
say so in those words; they never stop the job, because the alternative is the
tool deciding what a user is allowed to build.

**Staleness IS a blocker.** A superseded purchase count is not merely uncertain
— it is a figure the system knows no longer follows from the project. Putting
one on a quote is the exact failure this layer exists to prevent, so a quote is
now refused while any material line or the cost is out of date.

**The two gates are deliberately different.** A quote is refused for anything
that makes the price wrong, absent data included: a line never calculated means
the total is missing it. A package is refused only for data that is present and
WRONG — superseded figures, and pieces the optimiser could not place that a plan
would imply are being cut. Absent data stays a gap printed on the document,
because T14 promised a package can be built from a drawing alone and that
promise is worth keeping.

**The stricter gate exposed a false positive that had been harmless.** Staleness
compared `Material.updatedAt` against `calculatedAt`, which marks a line stale
for edits that cannot change a figure: renaming a material, changing its
supplier, or archiving it. As a warning that was noise; as a blocker it stops
real work. It now compares the five fields the calculation actually used —
already snapshotted on the row since T4 — against the material now. Without a
readable snapshot it falls back to the timestamp, which over-reports: a line
wrongly called stale costs a recalculation, a stale line called current reaches
a client.

**One finding per fact.** A material with no stated quantity is reported as
having no quantity, not additionally as never calculated. The same problem told
twice makes a project read as worse than it is, and a list nobody trusts is a
list nobody reads.

**The audit trail is deliberately narrow.** Approvals, issues, generations,
restores and removals. Not reads, not recalculations. A trail recording
everything is one nobody scans, and a trail nobody scans provides no safety.

**Writing an event never fails the action it records.** Every call site is
something that already succeeded — a quote issued, a package stored. Undoing
real work to protect a record of it is backwards, so failures are logged and the
gap shows as a missing entry.

**Audit events survive the project they describe.** `Project` is set null on
delete rather than cascading, because "this project existed and was deleted" is
the entry that matters most.

**Content sniffing accepts what it does not recognise.** T2 bound the declared
MIME type into the upload signature, which validates what the browser said, not
what arrived. The bytes are now checked at confirm time and a file whose prefix
contradicts its declared type is refused — that is the case that matters, since
the vision model is handed image bytes directly. A prefix the module has never
been taught is accepted: a DXF or a supplier's spreadsheet has no magic number
here, and refusing every unknown file would break ordinary attachments to guard
against nothing. A failure to read the bytes is likewise not a rejection —
storage being briefly unreachable is not evidence that a file is lying.

**Only the first sixteen bytes are fetched.** A ranged read, because pulling a
20 MB upload through the app server to check a magic number would be a real cost
on every confirmed file.

### T17 — Domain Framework (Phase 17)

**A profile decides what is asked, never what is calculated.** Required
specification fields, agent vocabulary, canvas palette, dimension plausibility
and mockup phrasing differ by trade. Material requirements, purchase counts,
cutting, waste, cost and tax do not — a 6 m bar divides the same way whether it
becomes a sign frame or a pergola rafter. Keeping calculation out of
`DomainProfile` is deliberate: a profile that could reach it would be the place
a trade quietly acquires its own arithmetic, which is exactly what PRD 24 asks
to avoid by isolating industry rules FROM reusable components rather than
threading them through.

**Anything a profile cannot express means the seam is wrong.** The type is
narrow on purpose, and widening it until it can express everything would turn it
back into the thing it replaced.

**A second real domain, not an abstraction with one implementation.** Joinery is
in because every engine below the specification already supports it unchanged —
a wardrobe carcass nests like a sign face, a pergola rafter cuts like a sign
frame — and because a framework with a single profile is untested machinery. It
proves the seam by differing where the trades actually differ: no lighting
requirement, a smaller plausible size, no lettering in its canvas vocabulary.

**Signage keeps exactly the behaviour it shipped with.** Every value in the
signage profile was hard-coded somewhere before T17, and a test asserts the
required field list and the plausibility bounds are the ones that shipped. The
`domain` column defaults to signage, so no existing project changes.

**Narrowing applies to what is offered, not to what is stored.** The scene
schema keeps the full object vocabulary; a domain declares a subset. Adding a
lettering object to a joinery project is refused, but a scene that already
contains one stays readable and editable — otherwise changing a project's trade
would make its own design impossible to open.

**`getDomain` falls back rather than throwing.** A project row carrying an id
this build does not know — a domain removed, or a database ahead of the code —
should still open. Signage is the fallback because it is the default and the
stricter set, and the fallback is logged so it does not pass unnoticed.

**Completeness gained a reader table.** `missingFields` was nine hand-written
`if` statements; it is now a lookup from field key to where that field lives.
That is what makes the required set a parameter rather than a constant, and it
means a domain cannot require a field nothing knows how to read — a registry
test asserts every domain's required set comes back missing from an empty
specification.

**The domain paragraph is appended to the system prompt, not interpolated
through it.** The trade-specific vocabulary stays one readable block a person
can check against the profile, instead of conditionals scattered through
instructions that are identical everywhere.

**The trade is chosen at creation and not changed afterwards.** It decides which
questions a project must answer before approval, and switching it under an
approved specification would retroactively change what "approved" meant.

### T18 — Workspaces and Permissions (Phase 18)

**Ownership moved from a person to a business, at one gate.** Before T18
`assertProjectAccess` compared `project.userId` to the caller. It now resolves
the project's workspace and requires a membership row. The signature is
unchanged on purpose: eighty-odd call sites inherited the new rule without each
having to be reasoned about, which is the entire value of having had one gate.
`Project.userId` and `Material.userId` survive as "who created this" and are
never consulted for access again.

**Everyone got a personal workspace, and nothing changed hands.** The migration
is hand-written rather than generated, because the generated version would
`ADD COLUMN ... NOT NULL` onto populated tables and drop the settings' owner
link without moving what it pointed at. Every existing row lands in the personal
workspace of the user who owned it, and a check afterwards confirmed zero
mismatches. A personal workspace cannot be left or deleted, so there is no state
in which somebody is signed in with nowhere to work.

**The workspace id is a branded type, and that was not decoration.** Turning
twenty-four call sites from "pass the user id" to "pass the workspace id" was a
refactor in which every single site typechecked either way, and a mistake at any
one of them reads another business's data or writes into it. `WorkspaceId` is a
branded string that only `asWorkspaceId` can produce, so the compiler found all
twenty-four and will find the twenty-fifth.

**The permission matrix is written out per role, not derived.** Derivation by
seniority reads neatly and hides the question that matters. Sales sees cost and
cannot touch the canvas; production manages the material library and cannot see
cost. Neither falls out of a hierarchy, and a test asserts each role's exact set
so widening one is a deliberate edit rather than a diff nobody reads.

**Cost visibility is enforced by refusing the read, not by filtering it.** A
role without `cost.view` never receives the ProjectCost row at all, so an
internal column added later cannot leak through a serialiser somebody forgot to
update. Same construction as the client-safe quote boundary in T13, applied to a
second audience.

**Which forced three aggregators to degrade rather than fail.** The integrity
report, the quote view and the project page all read cost. A worker opening a
project must see the project minus the cost panel, not an error page, so they
ask `hasProjectPermission` and omit the section. The alternative — catching a
403 they provoked on purpose — hides real failures.

**Missing and forbidden are both 404 ACROSS workspaces, and 403 within one.** A
403 on another business's project would confirm the id is real and let anyone
enumerate it. Inside a workspace you already know the project exists, so a 403
naming the missing permission is safe and actionable.

**Owner is an ownership check, not a permission.** An admin holds every entry in
the matrix and still cannot promote itself or demote the owner, because a
permission is something that can be granted and this is not. The workspace is
also refused any transition that would leave it with no owner.

**No invitation email is sent, and the interface says so.** There is no mail
provider wired into the product, and pretending to deliver an invitation would
leave one nobody receives. The token is returned and the inviter shares the
link. Accepting requires the signed-in account's email to match the address
invited — without that, a leaked link is a way into somebody's business, which
is the whole risk of a token in a URL.

**A revoked invitation is marked, not deleted.** Deleting would free the unique
(workspace, email) slot and allow the same token to be recreated; a link already
shared should stay dead.

### T19 — Client and Team Collaboration (Phase 19)

**The share is the product's only unauthenticated read surface**, so it is
built assuming the link has already been forwarded to somebody the sender never
intended. The token is the whole credential: there is no second check behind
it, which is why the payload has to be safe on its own rather than safe because
of who is reading it.

**Third client-safe boundary, same construction as the first two.** A quote
hides internal cost from a document (T13); a package hides prices from the
workshop (T14); `ShareView` hides everything internal from somebody outside the
business entirely. Absent by construction: cost, margin, purchase prices,
supplier names, quantities, waste, cutting plans, the production package, the
audit trail, version history, and workspace membership.

**Ids are private too.** A share carries no project id, workspace id or user id.
Handing an outside reader an internal identifier invites them to try it
somewhere else, and none of them is needed to render the page.

**Members appear to a client as the business, never by name.** The client is
dealing with a company; which colleague replied is not theirs to have, and an
email address in a shared thread is a leak with no upside.

**Every dead link fails identically.** Unknown, revoked and expired all report
that the link does not work, in the same words. Distinguishing them would tell
somebody probing tokens which of their guesses had once been real.

**A revoked share is marked, not deleted.** Deleting would free the token and
also detach the client messages that arrived through it, which are part of the
project's record.

**An approval is a message, not a flag.** It is recorded as something a named
person said at a time, in the same thread as the team's replies. A project
marked "approved" with nobody attached is not evidence of anything, and a
revision request and the answer to it belong next to each other rather than in
two places somebody has to reconcile.

**The client-facing page has no product chrome, and that was a defect found by
looking at it.** The share page originally rendered inside the root layout, so a
client opening their supplier's proposal saw TARKIB's name, a "Sign in" link and
a "Get started" button — a business's document turned into somebody else's
marketing surface. The header moved into an `(app)` route group; the root layout
is now the document shell only. The share page also sets its own title and
`robots: noindex`, because a client's browser tab should carry their supplier's
name and a client link has no business in a search index.

**Notifications are in-app only, and the interface says so.** No mail provider
is wired into the product. A notification nobody receives is worse than one the
user has to come back and read, and an invitation or share that claims to have
been emailed is worse still — so both hand the link back to the sender instead.

**Writing a notification never fails the thing it was about**, the same rule the
audit trail and version capture follow.

**Marking notifications read is scoped to the caller's own rows**, so an id from
somewhere else does nothing rather than being rejected — there is no version of
this where one user changes another's state.

### T20 — Commercial and Operational Features (Phase 20)

**Scope was chosen, and the choice is the first decision worth recording.** The
phase listed eleven "potential capabilities", several of which are whole
products. Building all of them shallowly would have produced a screen for each
and a use for none. What shipped closes one loop the product left open: you
could quote a job but not see what to order for it or whether your quoting makes
money. Suppliers, a purchase list, project profitability and workspace analytics
are that loop; billing, inventory integrations and a CRM are recorded as
deliberately out, with reasons.

**Profitability is PROJECTED, and the naming says so at every level.** The
product knows what the engines estimated and what the client was quoted. It does
not know what the job cost — nothing records invoices, hours worked, or material
actually consumed. The type carries `isProjection: true`, the field is
`projectedMarginCents`, and the panel says it in words. Calling this "profit"
would present an estimate as a result, and a business making decisions on it
would be trusting a number nothing measured.

**A missing half is named, never zeroed.** A project with a cost and no quote
reports which is absent. Substituting zero would show the entire estimated cost
as a loss on a job nobody has priced yet.

**Workspace totals name the subset they cover.** Projects lacking either a cost
or a quote are excluded and counted separately, because a single "projected
margin" over an unstated subset reads as a fact and is not one.

**An unknown win rate is unknown, not zero.** A business that has issued no
quotes has not lost them. Reporting 0% would be a claim about a business that
has not started.

**The purchase list reads the engine, never recomputes it.** A second place that
decides how many bars to buy is a second place that can disagree with the first.
Uncalculable lines are carried with their reason rather than dropped — a list
that silently omits a material is how somebody arrives at the yard missing half
the job — and a group containing one has no subtotal, because a total that
quietly skipped a line reads as a complete order value.

**Prices in the purchase list follow `cost.view`, by omission.** Production buys
the material and does not see the margin (T18). For them the price field is null
rather than formatted away, so nothing internal reaches the payload at all. The
quantities — which are what they actually need to place an order — are
unaffected. `includePrices` is passed into the pure grouper rather than inferred
there, because whether somebody may see a cost is a permission and that module
has no business deciding it.

**Prices are the ones the calculation used**, read from
`unitPriceCentsSnapshot`, so the order list matches the figures the cost and any
quote were built from rather than today's price list.

**Suppliers are additive.** `Material.supplier` stays as free text and remains
the fallback label, so nothing had to be migrated and a material nobody has
linked still groups under a heading that says no supplier is recorded — rather
than vanishing from the list.

**Lead time is stated, not inferred.** The product has no delivery history, so
it asks rather than computing a number that would look derived.
