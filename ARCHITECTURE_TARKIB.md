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

One-to-one with User.

Fields include:

- labor type/value
- transport type/value
- installation type/value
- margin
- tax
- currency

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
- standard dimensions
- unit
- thickness
- unit price
- notes
- technical properties
- createdAt
- updatedAt

### ProjectMaterial

- id
- projectId
- materialId
- required quantity
- required dimensions
- units to purchase
- purchased quantity
- waste
- price snapshot
- total cost
- manual override
- createdAt
- updatedAt

### CuttingPlan

- id
- projectId
- materialId
- stock size
- layoutData
- waste
- diagram URL
- createdAt

Future:
- kerf
- margin
- multiple stock sizes
- linear-cut representation

### Diagram

Current:
- projectId
- type
- imageUrl
- dimensionsData
- createdAt

Future:
- front/side/top/back/section views
- structured geometry references

### Mockup

- id
- projectId
- source file
- result image
- prompt
- createdAt

### ProjectCost

- id
- projectId
- material cost
- labor
- transport
- installation
- internal total
- margin
- tax
- client total
- computedAt

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

### Client quote pipeline

Project
 -> approved commercial data
 -> client-safe serializer
 -> quote template
 -> @react-pdf/renderer
 -> PDF
 -> R2
 -> signed download URL

### Production pipeline

Project
 -> approved technical state
 -> diagrams
 -> material list
 -> cutting plans
 -> production notes
 -> production template
 -> PDF
 -> R2
 -> signed download URL

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
