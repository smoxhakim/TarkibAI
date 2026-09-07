# TODO — TARKIB Development Roadmap

This roadmap represents the planned evolution of the complete TARKIB product.

Development is sequential.

Only one milestone should be actively implemented at a time.

A milestone must be completed, tested, and verified before moving to the next milestone.

The roadmap may evolve as product validation reveals better priorities, but major architectural changes must be deliberate and documented.

---

# Phase 0 — Foundation

## T0 — Repository and Application Foundation ✅ COMPLETE

- [x] Inspect and stabilize the existing repository
- [x] Next.js + TypeScript foundation (Next 16, React 19, Tailwind 4)
- [x] Clerk authentication (Clerk 7 / Core 3, private by default via `src/proxy.ts`)
- [x] Prisma + Neon/Postgres (Prisma 7 + pg driver adapter, 2 migrations applied)
- [x] Core User model (lazily synced from the Clerk session)
- [x] Core Project model (+ `archivedAt`, cascade deletes)
- [x] CostSettings (schema only; UI arrives in Phase 5)
- [x] QuoteSettings (schema only; UI arrives in Phase 13)
- [x] Basic project CRUD (create, list, read, rename, archive, restore, delete)
- [x] Base application shell
- [x] Base error handling (`ApiError`, structured JSON, route-level error UI)
- [x] Base loading states
- [x] Base validation (Zod on every mutating route)
- [x] Environment configuration
- [x] Initial documentation synchronization

### Deferred out of T0 (deliberately)

- [ ] Clerk webhook user sync — lazy sync covers T0 without a public endpoint
- [ ] Sentry wiring — added with the observability phase
- [ ] Vercel deployment

### Definition of done

- User can authenticate
- User can create a project
- User can rename a project
- User can archive/delete a project according to the implemented project lifecycle
- Application builds successfully
- Database migrations work
- Authentication and ownership checks work

---

# Phase 1 — Conversational AI

## T1 — Moroccan Darija AI Intake ✅ COMPLETE

- [x] ChatMessage model (+ toolCalls audit trail, index)
- [x] ProjectSpec model (+ unique version constraint)
- [x] AI conversation service
- [x] OpenAI integration (`gpt-5` default, `OPENAI_MODEL` override)
- [x] Agent/tool architecture foundation (bounded tool loop, context-bound toolbox)
- [x] Moroccan Darija system instructions
- [x] Darija/French code-switching support
- [x] Structured spec extraction (Zod-validated patches, deterministic merge)
- [x] Missing-information detection (deterministic, not model-decided)
- [x] Clarification questions
- [x] Conversation context management (spec injected, not replayed)
- [x] Chat UI
- [x] User approval flow (no AI tool can approve)
- [x] ProjectVersion snapshot on approval

### Deferred out of T1 (deliberately)

- [ ] Streaming replies — non-streaming is sufficient; revisit with Inngest (Phase 12)
- [ ] Image/vision input in the conversation — depends on file storage (Phase 2)
- [ ] `create_project` / `request_missing_information` tools — not needed by this flow

### Definition of done

A user can describe a signage project naturally in Moroccan Darija, receive clarification questions, review a structured specification, and explicitly approve it.

---

# Phase 2 — Files and Visual References

## T2 — Project File Management ✅ COMPLETE

- [x] Cloudflare R2 storage layer
- [x] Presigned uploads (browser → R2 direct)
- [x] Private file access (no URL ever stored; signed, short-lived reads)
- [x] Upload images
- [x] Upload logos
- [x] Upload reference images
- [x] Upload sketches
- [x] Project attachment management (list, preview, download, delete)
- [x] File metadata (original name, mime type, verified size, status)
- [x] Secure signed downloads
- [x] AI access to relevant visual context (downscaled, inlined, recent-message window)

### Deferred out of T2 (deliberately)

- [ ] PDF content extraction — stored and downloadable, but not readable by the vision model
- [ ] Server-side image content sniffing — type is validated by declared MIME and bound into the upload signature; byte-level sniffing belongs with the validation layer in T16
- [ ] Orphaned-object sweep for abandoned pending uploads

### Definition of done

Users can attach and manage project references securely, and the AI can use supported visual inputs as context.

---

# Phase 3 — Material System

## T3 — User Material Library ✅ COMPLETE

- [x] Material model (structured mm dimensions, measurement model, archivedAt)
- [x] Material CRUD
- [x] Categories
- [x] Custom categories
- [x] Suppliers
- [x] Standard sizes (integer millimetres, validated per measurement model)
- [x] Units (measurementModel: linear | sheet | area | piece)
- [x] Thickness (Decimal mm)
- [x] Prices (integer minor units, per purchase unit)
- [x] Technical properties (extensible Json)
- [x] Material management UI (`/materials`)
- [x] Material search and filtering (name/supplier/notes, category, model, archived)
- [x] Project material selection (calculated fields deliberately null until T4)

### Deferred out of T3 (deliberately)

- [ ] AI tools for materials (`list_materials`, `get_material`) — the agent still
      records materials as free text in the spec; linking spec materials to
      library records belongs with calculation in T4
- [ ] Technical-properties editor UI — the column is live and extensible, but no
      form exposes it until a domain rule needs one
- [ ] Bulk import of a supplier price list

### Definition of done

A user can maintain their own private material database and select materials for a project.

---

# Phase 4 — Deterministic Calculation Engine

## T4 — Material Calculation ✅ COMPLETE

- [x] Calculation domain structure (`src/lib/calc/materials/`)
- [x] Material requirement calculation (user-stated input, never derived)
- [x] Standard-unit purchase calculation (integer `ceilDiv`)
- [x] Required vs purchased quantity
- [x] Waste calculation (quantity and percentage)
- [x] ProjectMaterial persistence (+ input snapshot for auditability)
- [x] Calculation validation (approval gate, unsupported lines refuse rather than guess)
- [x] Calculation explanation UI ("show working" with every derivation step)
- [x] Calculation tests (21 engine unit tests, 12 integration tests)
- [x] Stale detection (spec / material / requirement changed)

### Deferred out of T4 (deliberately)

- [ ] True sheet counts from 2D nesting — T8. Sheet results are an area-based
      MINIMUM and say so on every line.
- [ ] Spec-derived requirements (e.g. perimeter from dimensions) — needs domain
      rules, T17
- [ ] Manual override of a calculated line (`manualOverride` column exists, unused)
- [ ] Linear offcut reuse across lines — T9

### Definition of done

An approved project produces deterministic material requirements and purchase quantities based on the user's material database.

---

# Phase 5 — Cost and Pricing

## T5 — Cost Engine ✅ COMPLETE

- [x] CostSettings UI (`/settings/costing`)
- [x] Material cost (from the T4 calculation)
- [x] Labor calculation (percent of materials | fixed | manual)
- [x] Transport calculation
- [x] Installation calculation
- [x] Other expense support (ProjectExpense, per project)
- [x] Profit margin (basis points, applied to the internal total)
- [x] Tax (basis points, applied to the client subtotal)
- [x] Internal total
- [x] Client total
- [x] Internal/client data separation (`toClientSafeCost`, built by construction)
- [x] Cost calculation tests (26 engine unit tests, 15 integration tests)

### Deferred out of T5 (deliberately)

- [ ] Client-visible line items — the quote template decides how the total is
      broken down for a client; that is T13
- [ ] Per-project override of margin or tax — settings are per user for now
- [ ] Cost history UI — every calculation is stored, but only the latest is shown

### Definition of done

The system can calculate a project's internal cost and client-facing price without exposing private cost information.

---

# Phase 6 — Smart Canvas Foundation

## T6 — Structured Smart Canvas ✅ COMPLETE

- [x] Canvas architecture (`src/lib/canvas/`: schema, commands, render, service)
- [x] Structured scene/project objects (panel, frame, lettering, light, note)
- [x] Basic geometry primitives (integer millimetres, position, size, rotation)
- [x] Dimensions (rendered annotations, per object)
- [x] Labels (collision-aware placement)
- [x] Materials on objects (linked to the user's library)
- [x] Object identifiers (stable ids, addressable by AI commands)
- [x] Canvas state persistence (CanvasScene, one per project)
- [x] AI-to-canvas command foundation (validated command vocabulary + reducer)
- [x] Structured canvas updates (add / update / remove, batched atomically)
- [x] Divergence detection against the approved specification

### Deferred out of T6 (deliberately)

- [ ] Conversational editing — "zid 50cm f l3ard" is T7; the command layer it
      will drive is built and tested
- [ ] Drag-and-drop manipulation — precision editing by millimetre suits a
      fabrication drawing, and drag code is not reusable by the AI path
- [ ] Multi-view (front/side/top) — T11
- [ ] Canvas snapshots in project versions — T15
- [ ] Relationships between objects (parent/child, constraints)

### Definition of done

The system can represent a basic project as structured visual objects rather than only as an image.

---

# Phase 7 — AI Design Interaction

## T7 — Conversational Design Editing ✅ COMPLETE

- [x] AI design command tools (`get_canvas`, `propose_design_change`)
- [x] Modify dimensions through conversation
- [x] Modify materials through conversation (materialId on an object)
- [x] Modify object properties
- [x] Add/remove structured objects
- [x] Approval-aware design changes (every AI change is a proposal)
- [x] Dependency invalidation (a dimensional change writes a draft spec; its
      re-approval is what marks calculations and costs stale)
- [x] Design revision history (decided proposals are retained)

### Deferred out of T7 (deliberately)

- [ ] Undo of an approved change — the history records what happened but does
      not yet offer a revert
- [ ] Multi-step design conversations that batch several turns into one proposal
- [ ] Agent-suggested material substitution from the library — the agent can set
      a materialId but does not yet browse the library; that pairs with the
      waste-reduction advice in T10

### Definition of done

A user can say things such as:

"zid 50cm f l3ard"

and the application can safely update the structured project representation.

---

# Phase 8 — Cutting Optimization

## T8 — Sheet Cutting Optimization ✅ COMPLETE

- [x] Sheet material rules (sheet stock only; linear is T9)
- [x] 2D nesting (guillotine, best-area-fit, largest piece first)
- [x] Rotation (per piece, off for grain-directional material)
- [x] Margins (edge trim excluded from usable area)
- [x] Kerf support (blade width consumed by every cut)
- [x] Multiple sheets
- [x] Waste percentage (against full purchased area)
- [x] CuttingPiece + CuttingPlan models
- [x] SVG cutting diagram (deterministic, per sheet)
- [x] PNG rendering (sharp → R2, for later PDF use)
- [x] Cutting-plan UI
- [x] Usable offcuts reported, largest first

### Deferred out of T8 (deliberately)

- [ ] Linear stock optimisation — T9
- [ ] Multiple stock sizes for one material (compare a 3 m vs 4 m sheet)
- [ ] Offcut reuse across projects
- [ ] Feeding the real sheet count back into the T4 material calculation —
      the plan is authoritative but the two are not yet linked

### Definition of done

A project with supported sheet materials can produce a visual cutting plan with calculated waste.

---

# Phase 9 — Advanced Material Optimization

## T9 — Linear Material Cutting ✅ COMPLETE

- [x] Linear material rules (linear stock only; sheet is T8)
- [x] Standard bar/profile sizes (from Material.standardLengthMm)
- [x] Cut lengths (LinearCut model, stated by the user)
- [x] Kerf (charged between cuts, not after the last)
- [x] Remnants (usable above a threshold, otherwise scrap)
- [x] Bar utilization (per bar, percentage)
- [x] Linear waste (kerf plus unusable tails)
- [x] Visual cut sequence (deterministic SVG, one strip per bar)
- [x] Linear optimization tests (18 engine + 7 render unit tests, 9 integration)
- [x] **Fix: T4's linear bar count is no longer presented as exact**

Supported examples:

- Steel tubes
- Steel bars
- Aluminum profiles
- Wood bars

---

# Phase 10 — Waste Reduction Intelligence

## T10 — Material Efficiency Recommendations

- [ ] Detect waste opportunities
- [ ] Compare alternative standard sizes
- [ ] Compare material options
- [ ] Suggest purchasing alternatives
- [ ] Explain expected savings
- [ ] Require user approval
- [ ] Recalculate after approval

The AI may suggest alternatives, but deterministic engines must calculate the actual result.

---

# Phase 11 — Technical Drawing System

## T11 — Structured Technical Drawings

- [ ] Drawing domain model
- [ ] Front view
- [ ] Side view
- [ ] Top view
- [ ] Back view
- [ ] Sections
- [ ] Dimension annotations
- [ ] Material annotations
- [ ] Component labels
- [ ] SVG renderer
- [ ] Drawing versioning

### Definition of done

Supported project types can generate structured technical documentation from validated project data.

---

# Phase 12 — Mockup Generation

## T12 — AI Mockups

- [ ] Mockup model
- [ ] Image generation provider abstraction
- [ ] Design concept generation
- [ ] Site-photo compositing
- [ ] Upload site photo
- [ ] Prompt construction from project state
- [ ] Inngest jobs
- [ ] Progress states
- [ ] Mockup gallery
- [ ] Mockup history

Mockups must be clearly positioned as presentation visualizations rather than guaranteed production geometry.

---

# Phase 13 — Client Quotation

## T13 — Client Quote System

- [ ] Quote template
- [ ] QuoteSettings
- [ ] Company information
- [ ] Client information
- [ ] Line items
- [ ] Quantities
- [ ] Unit prices
- [ ] Tax
- [ ] Commercial totals
- [ ] Optional mockup
- [ ] Terms
- [ ] PDF generation
- [ ] R2 storage
- [ ] Signed downloads
- [ ] Client-safe financial serializer

### Definition of done

A user can generate and download a professional client quotation without leaking internal business costs.

---

# Phase 14 — Production Documentation

## T14 — Production PDF

- [ ] Production template
- [ ] Technical drawings
- [ ] Material list
- [ ] Cutting plans
- [ ] Dimensions
- [ ] Component list
- [ ] Assembly guidance
- [ ] Production notes
- [ ] PDF generation
- [ ] Version references
- [ ] R2 storage
- [ ] Secure download

### Definition of done

The production team receives a visual fabrication package containing drawings, material information, and cutting instructions.

---

# Phase 15 — Project Versioning

## T15 — Full Version History

- [ ] Project snapshots
- [ ] Specification snapshots
- [ ] Cost snapshots
- [ ] Canvas state snapshots
- [ ] Drawing references
- [ ] Document/version references
- [ ] Version timeline
- [ ] Version comparison
- [ ] Restore/review flow

### Definition of done

Users can understand how a project changed and identify which project state generated a particular document.

---

# Phase 16 — Production Reliability

## T16 — Validation and Safety Layer

- [ ] Calculation validation
- [ ] Dimension validation
- [ ] Material availability validation
- [ ] Unsupported-scenario detection
- [ ] Stale output detection
- [ ] User warnings
- [ ] Approval safeguards
- [ ] Audit logging
- [ ] Robust error recovery

The system must fail safely rather than fabricate technical output.

---

# Phase 17 — Industry Abstraction

## T17 — Domain Framework

- [ ] Separate core platform entities from industry-specific rules
- [ ] Domain configuration system
- [ ] Industry-specific material rules
- [ ] Industry-specific calculation rules
- [ ] Industry-specific component schemas
- [ ] Industry-specific prompts
- [ ] Industry-specific drawing templates

Initial domain:

- Signage / fabrication

Potential future domains:

- Restaurant/store branding
- Metal fabrication
- Woodworking
- MDF fabrication
- Pergolas
- Custom installations
- Additional fabrication industries

---

# Phase 18 — Multi-User Workspaces

## T18 — Teams and Permissions

- [ ] Workspace model
- [ ] Members
- [ ] Roles
- [ ] Permissions
- [ ] Project access
- [ ] Shared materials
- [ ] Team activity
- [ ] Secure workspace authorization

Potential roles:

- Super Admin
- Owner
- Designer
- Sales
- Production Manager
- Worker

This phase must be designed as a deliberate workspace architecture, not retrofitted through ad-hoc permissions.

---

# Phase 19 — Collaboration

## T19 — Client and Team Collaboration

Potential future capabilities:

- [ ] Share project
- [ ] Client review
- [ ] Client approval
- [ ] Comments
- [ ] Revision requests
- [ ] Team notifications
- [ ] Document sharing
- [ ] Collaborative workflows

---

# Phase 20 — Advanced Business Platform

## T20 — Commercial and Operational Features

Potential capabilities:

- [ ] Advanced quotation templates
- [ ] More pricing models
- [ ] Supplier management
- [ ] Purchase planning
- [ ] Inventory integrations
- [ ] Advanced analytics
- [ ] Project profitability
- [ ] Client CRM
- [ ] Production workflow tracking
- [ ] Billing and subscription management
- [ ] Usage-based limits

---

# Phase 21 — Advanced AI

## T21 — Advanced Fabrication Intelligence

Potential capabilities:

- [ ] More specialized AI agents
- [ ] Design specialist agent
- [ ] Materials specialist agent
- [ ] Cost specialist agent
- [ ] Technical drawing specialist agent
- [ ] Production specialist agent
- [ ] Cross-agent orchestration
- [ ] Better Darija understanding
- [ ] Voice interaction
- [ ] More advanced reference-image understanding

Do not split the AI into multiple agents unless there is a measurable engineering or product benefit.

---

# Global Engineering Checklist

Every milestone should maintain:

- [ ] TypeScript correctness
- [ ] Authentication
- [ ] Authorization
- [ ] Input validation
- [ ] Error handling
- [ ] Loading states
- [ ] Empty states
- [ ] Responsive UI
- [ ] Tests where appropriate
- [ ] Documentation updates
- [ ] No unauthorized data exposure
- [ ] No fabricated calculations
- [ ] No unnecessary dependencies

---

# Milestone Completion Rules

A milestone is complete only when:

- [ ] Functionality works end-to-end
- [ ] Relevant API routes work
- [ ] Relevant database changes work
- [ ] Authorization works
- [ ] TypeScript passes
- [ ] Tests pass where applicable
- [ ] Production build passes
- [ ] UI states are handled
- [ ] Errors are handled
- [ ] Existing functionality remains intact
- [ ] Documentation reflects the implementation

Do not automatically start the next milestone.

---

# Current Status

Completed:

- [x] **T0 — Repository and Application Foundation** (Phase 0)
- [x] **T1 — Moroccan Darija AI Intake** (Phase 1)
- [x] **T2 — Project File Management** (Phase 2)
- [x] **T3 — User Material Library** (Phase 3)
- [x] **T4 — Material Calculation** (Phase 4)
- [x] **T5 — Cost Engine** (Phase 5)
- [x] **T6 — Structured Smart Canvas** (Phase 6)
- [x] **T7 — Conversational Design Editing** (Phase 7)
- [x] **T8 — Sheet Cutting Optimization** (Phase 8)
- [x] **T9 — Linear Material Cutting** (Phase 9)

Active milestone:

- [ ] None. T10 has not been started.

Next milestone:

- [ ] **T10 — Material Efficiency Recommendations** (Phase 10)

### T9 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 231 passed |
| Integration tests | 115 passed against Neon |
| Production build | passed, 41 routes |
| Migrations | 12 applied |
| Auth boundary | all linear routes return JSON 401 |
| Visual check | rendered a 5-bar mixed cut plan and inspected it |

**A real bug in shipped T4 code was found and fixed during this milestone.** Its
linear calculation divided total length by bar length and presented the result
as exact. Four 4 m pieces from 6 m bars needs four bars; T4 said three, with no
warning. It now carries the same MINIMUM caveat as the sheet path and names the
case. The bar cut plan is the authoritative count.

### T8 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 204 passed |
| Integration tests | 105 passed against Neon |
| Production build | passed, 38 routes |
| Migrations | 11 applied |
| Auth boundary | all cutting routes return JSON 401 |
| Visual check | rendered a 3-sheet mixed layout and inspected it |

The engine tests assert the two invariants that matter physically: no two placed
pieces ever overlap, and every piece sits inside the sheet after edge margin.

### T7 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 184 passed |
| Integration tests | 94 passed against Neon |
| Live Darija evaluations | 15 passed, including 3 new design cases |
| Production build | passed, 34 routes |
| Migrations | 10 applied |
| Auth boundary | design routes return JSON 401; no route creates a proposal directly |

The milestone's definition of done is verified against the real model: "zid 50cm
f l3ard" on an 8 m panel produces a proposal containing 8500 mm, the canvas is
unchanged until approval, the agent does not claim the change is done, and on an
empty canvas it declines to invent a panel to widen.

### T6 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 184 passed |
| Integration tests | 80 passed against Neon |
| Production build | passed, 32 routes |
| Migrations | 9 applied |
| Auth boundary | all canvas routes return JSON 401 |
| Visual check | rendered a realistic scene and inspected it |

The visual check found a defect no unit test could: labels on concentric objects
(a panel, its frame, its lettering) were all centred and overlapped into
unreadable text. Fixed with type-aware anchoring plus deterministic line
stacking, and covered by regression tests.

### T5 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 147 passed |
| Integration tests | 69 passed against Neon |
| Production build | passed, 29 routes |
| Migrations | 8 applied |
| Auth boundary | all cost routes return JSON 401; no figure leaks unauthenticated |

The client-safe boundary is asserted twice — once on the pure serializer and
once end to end through the database — including that a deliberately
recognisable internal expense value never appears in the serialized payload.

### T4 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 121 passed |
| Integration tests | 54 passed against Neon |
| Production build | passed, 23 routes |
| Migrations | 7 applied |
| Auth boundary | calculate and requirement routes return JSON 401 |

The engine reproduces the PRD worked example exactly: 25 m required, 6 m bars →
5 bars, 30 m purchased, 5 m waste, 16.67%.

An integration test caught a real defect during this milestone: staleness was
keyed on `ProjectMaterial.updatedAt`, which the calculation itself bumps, so
every line marked itself stale immediately after being calculated. Fixed by
tracking `requirementUpdatedAt` separately.

### T3 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 100 passed |
| Integration tests | 42 passed against Neon |
| Production build | passed, 21 routes |
| Migrations | 5 applied |
| Auth boundary | all material routes return JSON 401; `/materials` redirects |

Library isolation is covered explicitly: another user's materials never appear
in a listing, cannot be read, edited, archived or deleted, and cannot be
selected into a project.

### T2 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 71 passed |
| Integration tests | 27 passed against Neon |
| Production build | passed, 15 routes |
| Migrations | 4 applied |
| Auth boundary | all file routes return JSON 401; download leaks no redirect target |
| Live R2 round trip | passed against the real bucket |
| Live vision turn | passed — model read text off an uploaded image |

**Live R2 behaviour verified** on 2026-09-05 against the real bucket:

- presigned PUT, HEAD verification, server-side read, signed download and
  delete all succeed
- an object URL with its signature stripped is refused (HTTP 400), which is the
  assumption the whole private-storage design rests on
- the API token is bucket-scoped: listing an unrelated bucket in the same
  Cloudflare account fails with AccessDenied
- a Darija turn with an attached image returned the text visible in that image,
  confirming R2 read, sharp re-encoding and the vision request all work
- an attachment id from another project is silently dropped rather than honoured

### T1 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 54 passed |
| Integration tests | 21 passed against Neon |
| Live Darija evaluations | 7 passed against gpt-5 |
| Production build | passed, 11 routes |
| Migrations | 3 applied |
| Auth boundary | all new routes return JSON 401 unauthenticated |

**Live model behaviour verified** against `gpt-5` on 2026-09-05. The evaluation
suite caught one real defect: the agent asked the user to confirm an explicit
correction instead of applying it, leaving the specification stale. Cause was a
system-prompt rule, not the deterministic layer; fixed and re-verified.

Known behavioural note carried into later phases: relative changes such as
"zid 50cm f l3ard" require arithmetic on an existing value. The agent must not
perform that arithmetic itself (PRD §5.3). Handling relative edits deterministically
belongs to T7 — Conversational Design Editing.

### T0 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean (`tsc --noEmit`) |
| ESLint | 0 errors (12 warnings, all unused params in Phase 1/4/13 stubs) |
| Unit tests | 18 passed |
| Integration tests | 7 passed against Neon |
| Production build | passed, 9 routes |
| Migrations | 2 applied, 16 tables live |
| Auth boundary | pages redirect to Clerk; API returns JSON 401 |

**Not verified by the agent:** the signed-in UI flow. Creating an account and
entering credentials is outside what the agent may do, so project
create/rename/archive/delete were verified through the service layer against the
real database rather than by driving the browser as a signed-in user.

Before implementation, the agent must announce the milestone in one line and wait for confirmation where required by the development instructions.
