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
- [x] Server-side image content sniffing — done in T16: the first 16 bytes are
      read at confirmation and a file whose prefix contradicts its declared type
      is refused
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

## T10 — Material Efficiency Recommendations ✅ COMPLETE

- [x] Detect waste opportunities (re-runs the real cutting engines)
- [x] Compare alternative standard sizes (sheet and bar)
- [x] Compare material options (from the user's own library only)
- [x] Suggest purchasing alternatives
- [x] Explain expected savings (cost, stock units, waste points)
- [x] Require user approval (applying is an explicit click; nothing is automatic)
- [x] Recalculate after approval (pieces reassigned, stale plan and figures cleared)
- [x] Read-only AI tool so the agent can explain savings in Darija

### Deferred out of T10 (deliberately)

- [ ] Hypothetical stock sizes the user does not carry — would invent supplier
      availability
- [ ] Cross-project offcut reuse
- [ ] Suggesting a cheaper material of a *different* specification (thinner,
      different alloy) — that is a fabrication judgement, not arithmetic
- [ ] Applying a rotation recommendation automatically — the user decides whether
      the material truly has no grain

The AI may suggest alternatives, but deterministic engines must calculate the actual result.

---

# Phase 11 — Technical Drawing System

## T11 — Structured Technical Drawings ✅ COMPLETE

- [x] Drawing domain model (projection layer + issued Diagram records)
- [x] Front view
- [x] Side view (needs per-part depth; says so when absent)
- [x] Top view (needs per-part depth; says so when absent)
- [x] Back view (mirrored, which matters for fixings and cable exits)
- [ ] **Sections — deliberately not implemented**, see below
- [x] Dimension annotations (overall, per view, with the axis named)
- [x] Material annotations (in the per-view legend)
- [x] Component labels (numbered callouts + legend)
- [x] SVG renderer (pure and deterministic)
- [x] Drawing versioning (live render + explicitly issued snapshots)

### Deferred out of T11 (deliberately)

- [ ] **Section views** — a section needs a cut plane and knowledge of internal
      construction the scene does not hold. Drawing one would mean inventing
      internal structure. Revisit when the geometry can support it.
- [ ] Per-part dimension annotations (only overall dimensions are annotated)
- [ ] Exploded and assembly views
- [ ] Scale bars and standard sheet sizes (A3/A4)

### Definition of done

Supported project types can generate structured technical documentation from validated project data.

---

# Phase 12 — Mockup Generation

## T12 — AI Mockups ✅ COMPLETE (pending live provider verification)

- [x] Mockup model (kind, status, prompt source, failure reason, timings)
- [x] Image generation provider abstraction (Replicate first)
- [x] Design concept generation
- [x] Site-photo compositing (image-to-image onto a real photo)
- [x] Upload site photo (reuses the T2 file pipeline)
- [x] Prompt construction from project state (stated facts only)
- [x] Inngest jobs (`/api/inngest`, outside the Clerk boundary by design)
- [x] Progress states (queued / running / succeeded / failed, with reasons)
- [x] Mockup gallery
- [x] Mockup history

### Deferred out of T12 (deliberately)

- [ ] Live polling — the panel offers a refresh rather than a socket or interval
- [ ] Regenerating a mockup with an edited prompt
- [ ] Attaching a chosen mockup to a client quote (T13 decides that)
- [ ] Model comparison / multiple candidates per request

Mockups must be clearly positioned as presentation visualizations rather than guaranteed production geometry.

---

# Phase 13 — Client Quotation

## T13 — Client Quote System ✅ COMPLETE

- [x] Quote template (`@react-pdf/renderer`, A4, accent colour, draft watermark)
- [x] QuoteSettings UI (`/settings/quotes`)
- [x] Company information (name, address, phone, email, tax identifiers)
- [x] Company logo (uploaded to R2, inlined into the PDF)
- [x] Client information (name, address, phone, email)
- [x] Line items (user-authored, replaced wholesale, positions preserved)
- [x] Quantities (integer thousandths, so 2.5 m² is exact)
- [x] Unit prices (integer minor units)
- [x] Tax (basis points from the cost snapshot, applied to the subtotal)
- [x] Commercial totals (computed by the engine, never accepted from a request)
- [x] Optional mockup (succeeded mockups only, labelled as indicative)
- [x] Terms and payment details (frozen onto the quote at issue)
- [x] Quote numbering (per business, PREFIX-YEAR-NNNN, unique-constrained)
- [x] PDF generation (synchronous; draft previews streamed, never stored)
- [x] R2 storage
- [x] Signed downloads
- [x] Client-safe financial serializer (`QuoteDocument` + `assertClientSafe`)
- [x] Divergence reporting when a quote is priced away from the calculation
- [x] Tests (27 unit, 23 integration, including a rendered-PDF leak test)

### Deferred out of T13 (deliberately)

- [ ] Arabic-script rendering — the built-in Helvetica family has no Arabic
      glyphs, so Arabic text would print as blank boxes. The quote view reports
      this instead of printing them. Fixing it means embedding a font.
- [ ] Emailing a quote to the client — no mail provider is wired yet
      (`resend` is still a deferred dependency)
- [ ] Per-project margin or tax override — settings remain per user
- [ ] Editing an issued quote — deliberately impossible; re-quote instead
- [ ] Revising a quote as a new version of the same number — a new quote gets
      a new number, which is what per-business numbering means
- [ ] Discounts and deposits as line types
- [ ] Yearly reset of the quote sequence — numbers carry the current year but
      the sequence runs continuously, so the first quote of a new year does not
      restart at 0001. Uniqueness is unaffected.
- [ ] AI tools for quoting — the agent can read the spec but has no tool that
      creates, prices or issues a quote, by design

### Definition of done

A user can generate and download a professional client quotation without leaking internal business costs. ✅

---

# Phase 14 — Production Documentation

## T14 — Production PDF ✅ COMPLETE

- [x] Production template (`@react-pdf/renderer`, portrait cover, landscape drawing page)
- [x] Technical drawings (the issued Diagram, rasterised at full landscape measure)
- [x] Material list (stock size, thickness, supplier, required, buy, waste)
- [x] Cutting plans (one figure per sheet so piece labels stay legible)
- [x] Dimensions (from the specification, with the unit that was stated)
- [x] Component list (from the specification's own components)
- [x] Assembly guidance — recorded mounting method, surface and height only
- [x] Production notes (written at generation time, frozen onto the package)
- [x] PDF generation (synchronous; previews render on demand and are never stored)
- [x] Version references (spec version and approval, drawing version, calculation time)
- [x] R2 storage
- [x] Secure download (signed, ownership-checked redirect)
- [x] Gaps printed on the document rather than hidden
- [x] `assertNoPricing` — no money on a workshop copy, by construction
- [x] Tests (32 unit, 18 integration, including a costed-project leak test)

### Deferred out of T14 (deliberately)

- [ ] Inferred assembly steps, tooling or build order — the application does not
      know how a sign is assembled, and a workshop acts on such a sequence
      directly. Only recorded mounting details are printed.
- [ ] Section views — still unimplemented in T11, so the package cannot carry them
- [ ] Per-piece cut lists as text tables — the plan figures carry the labels;
      a redundant text list would be a second source of truth
- [ ] Regenerating a package in place — a new package gets the next number, so
      a sheet already on a bench is never silently superseded
- [ ] Moving generation to Inngest — the work is local rasterisation of stored
      data, well inside a request. Revisit if projects carry enough plans to
      approach the limit.
- [ ] Arabic-script rendering — the same embedded-font gap as T13

### Definition of done

The production team receives a visual fabrication package containing drawings, material information, and cutting instructions. ✅

---

# Phase 15 — Project Versioning

## T15 — Full Version History ✅ COMPLETE

- [x] Project snapshots (whole project, copied as it stood, never recomputed)
- [x] Specification snapshots
- [x] Cost snapshots (internal; versions are an internal record)
- [x] Canvas state snapshots (absent and emptied are distinguishable)
- [x] Drawing references
- [x] Document/version references (`Quote.projectVersionId`, `Document.projectVersionId`)
- [x] Version timeline (`/api/projects/:id/versions`, panel on the project page)
- [x] Version comparison (pure deterministic diff; any two versions, or one against now)
- [x] Restore/review flow (preview states every consequence before confirming)
- [x] Automatic capture at spec approval, design approval, quote issue, package generation
- [x] Manual capture with a user-written label and note
- [x] Tests (20 unit, 22 integration)

### Deferred out of T15 (deliberately)

- [ ] Versions on every material or cost recalculation — they run often and
      would bury the moments that matter. Both are already auditable at row
      level through their own input snapshots.
- [ ] Restoring calculations — their numbers were derived from the
      specification being moved away from, so they go stale instead
- [ ] Deleting or editing a version — append-only is the property that makes
      "this document came from this state" true
- [ ] Branching a project from a version — a version restores in place; a
      separate project is a different feature
- [ ] Diffing an issued quote's line items — the quote is frozen on its own
      model and does not change

### Definition of done

Users can understand how a project changed and identify which project state generated a particular document. ✅

---

# Phase 16 — Production Reliability

## T16 — Validation and Safety Layer ✅ COMPLETE

- [x] Calculation validation (missing, unsupported and stale lines, with the engine's own caveats carried through)
- [x] Dimension validation (slipped decimals, wrong unit, extreme ratio, depth — all warnings, never blockers)
- [x] Material availability validation (archived, missing stock size, zero price, no stated quantity)
- [x] Unsupported-scenario detection (surfaced from every engine into one report)
- [x] Stale output detection — now compares the fields a calculation actually used, not `updatedAt`
- [x] User warnings (`IntegrityPanel`, grouped by what each severity means)
- [x] Approval safeguards (quote refused on superseded figures; package refused on wrong ones)
- [x] Audit logging (append-only, narrow by design, survives project deletion)
- [x] Robust error recovery (audit and version writes never fail the action they record; an unreadable upload is accepted, not deleted)
- [x] Byte-level content sniffing at upload confirmation (deferred from T2)
- [x] Tests (39 unit, 20 integration)

### Deferred out of T16 (deliberately)

- [ ] A user-visible audit trail across all projects — the per-project trail is
      on the project page; an account-wide view is a different screen
- [ ] Retention or export of audit events — nothing prunes the table yet
- [ ] Sniffing beyond the first bytes (a full container parse) — the magic
      number catches the case that matters without decoding untrusted files
- [ ] Signature checks for DXF, SVG and spreadsheets — they have no reliable
      magic number, and refusing every unrecognised file would break ordinary
      attachments to guard against nothing
- [ ] Re-validating already-issued documents when a project later changes —
      issued documents are frozen by design and keep their own snapshots
- [ ] Rate limiting and abuse controls — a hosting concern, not a project one

The system must fail safely rather than fabricate technical output. ✅

---

# Phase 17 — Industry Abstraction

## T17 — Domain Framework ✅ COMPLETE

- [x] Separate core platform entities from industry-specific rules (`src/lib/domains`)
- [x] Domain configuration system (`DomainProfile`, registry, `Project.domain`)
- [x] Industry-specific material rules — measurement models are platform; what a
      trade *requires* before approval is the profile's decision
- [x] Industry-specific component schemas (required spec fields, canvas palette)
- [x] Industry-specific prompts (domain guidance appended to the system prompt)
- [x] Industry-specific plausibility bounds and mockup phrasing
- [x] Two real domains: signage & shopfronts, joinery & furniture
- [x] Tests (21 unit invariants over every profile, 11 integration)

### Deliberately NOT industry-specific

- [x] **Calculation rules stay platform-level.** The T17 checklist listed
      "industry-specific calculation rules"; measurement models, purchase
      counts, cutting, waste, cost and tax are the same arithmetic in every
      trade, and a profile able to reach them would be where a trade acquires
      its own quietly different numbers. `DomainProfile` has no calculation
      field, and an integration test runs a joinery project through the
      unchanged engines to prove it needs none. If a trade ever genuinely needs
      different arithmetic, that is a new measurement model in the engine, not a
      hook in the profile.
- [x] **Drawing templates stay platform-level.** Orthographic projection,
      dimensions and callouts are geometry, not trade knowledge. What differs by
      trade is the object vocabulary, which the profile already narrows.

### Deferred out of T17 (deliberately)

- [ ] Changing a project's trade after creation — it decides what "approved"
      required, so switching it would retroactively change that
- [ ] The remaining PRD domains (metal fabrication, MDF, pergolas, restaurant
      branding, custom installations) — each needs its own trade vocabulary and
      required-field decisions, and inventing them without a practitioner would
      be guessing. The framework and its invariant tests are what make adding
      one small.
- [ ] Per-domain material categories and default libraries
- [ ] Per-domain document templates — the quote and package templates are
      trade-neutral today and nothing yet needs them not to be
- [ ] Domain-specific Darija vocabulary lists beyond the prompt guidance

Initial domain:

- Signage / fabrication ✅

Second domain, shipped to prove the seam:

- Joinery / furniture ✅

Potential future domains:

- Restaurant/store branding
- Metal fabrication
- MDF fabrication
- Pergolas
- Custom installations
- Additional fabrication industries

---

# Phase 18 — Multi-User Workspaces

## T18 — Teams and Permissions ✅ COMPLETE

- [x] Workspace model (owns projects, materials, costing rules and the company block)
- [x] Members (`WorkspaceMember` — this row IS the authorization)
- [x] Roles (owner, admin, designer, sales, production, worker)
- [x] Permissions (matrix written out per role, unit-tested exactly)
- [x] Project access (`assertProjectAccess` resolves workspace then membership)
- [x] Shared materials (one library per business, not per person)
- [x] Team activity (audit records invites, joins, role changes, removals)
- [x] Secure workspace authorization (28 integration tests on isolation and roles)
- [x] Invitations by email with a token, expiry, revocation and an identity check
- [x] Backfill giving every existing user a personal workspace, verified to move nothing
- [x] Branded `WorkspaceId`, so a user id can never be passed where a workspace belongs
- [x] Quote numbering moved to the business — found by a test during this milestone
- [x] Tests (36 unit, 28 integration for workspaces alone)

### Deliberately NOT built

- [x] **Super Admin.** The PRD lists it among possible roles, but it is a
      platform-operator concept, not a workspace one: it would mean an account
      that can read every business's data. Nothing in the product needs it, and
      building a cross-tenant superuser without a concrete need is the single
      most dangerous thing this phase could add.

### Deferred out of T18 (deliberately)

- [ ] Sending invitation emails — no mail provider is wired (`resend` is still
      a deferred dependency). The link is handed to the inviter, and the
      interface says plainly that nothing was sent.
- [ ] Transferring ownership of a workspace — the owner cannot currently hand
      over; they can promote an admin, but the final transfer needs a
      confirmation flow of its own
- [ ] Deleting a shared workspace — cascade would remove every project, quote
      and package, which needs more than a button
- [ ] Leaving a workspace you were invited to (self-removal)
- [ ] Per-project access within a workspace — membership currently grants the
      role's permissions across every project the business owns
- [ ] Moving a project between workspaces
- [ ] Clerk Organizations — TARKIB's own membership model is the source of
      truth; syncing to the identity provider's is a separate decision

This phase must be designed as a deliberate workspace architecture, not retrofitted through ad-hoc permissions. ✅

---

# Phase 19 — Collaboration

## T19 — Client and Team Collaboration ✅ COMPLETE

The only milestone whose brief was "potential future capabilities" with no
definition of done, so the scope below was chosen deliberately rather than read
off a list. What ties it together: one link a client can open, one thread both
sides write in, and nothing internal reachable from either.

- [x] Share project (`ProjectShare` — scoped, revocable, optionally expiring)
- [x] Client review (a public page needing no account)
- [x] Client approval (recorded as a named message, not a status flag)
- [x] Comments (one thread carrying team and client messages)
- [x] Revision requests (a typed entry in the same thread)
- [x] Team notifications (in-app; no email, and the interface says so)
- [x] Document sharing (the issued quote, via a short-lived signed URL)
- [x] Collaborative workflows — the approve / request-changes / reply loop
- [x] `ShareView` + `assertShareSafe`: the third client-safe boundary
- [x] `(app)` route group so the client page carries no product chrome
- [x] Tests (18 integration, including leak and token-probing tests)
- [x] Verified live: the share page and API serve with no session while
      `/dashboard` still redirects, and the approval loop was driven end to end
      in a browser

### Deferred out of T19 (deliberately)

- [ ] Emailing a share link — no mail provider (`resend` is still deferred).
      The link is handed to the sender, and the UI says nothing was sent.
- [ ] @mentions — needs a member picker and parsing; the thread notifies the
      whole workspace today, which is honest for a small business
- [ ] Client comments on a specific line, drawing or region — the thread is
      per project
- [ ] Editing or deleting a posted message — the thread is a record, and a
      client's approval in particular should not be editable after the fact
- [ ] Per-share passcodes or client accounts — a longer credential and an
      expiry were judged the right trade for a link somebody has to be able to
      open from an email on a phone
- [ ] Realtime updates — the thread refreshes on navigation
- [ ] Notification preferences and digests — there is one channel to configure

### Definition of done (chosen for this milestone)

A user can send a client a link that shows the project, the quote and the
visuals without exposing anything internal; the client can approve or ask for
changes; the team sees it in the app; and the link can be withdrawn. ✅

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
- [x] **T10 — Material Efficiency Recommendations** (Phase 10)
- [x] **T11 — Structured Technical Drawings** (Phase 11)
- [x] **T12 — AI Mockups** (Phase 12) — pending live provider verification
- [x] **T13 — Client Quote System** (Phase 13)
- [x] **T14 — Production PDF** (Phase 14)
- [x] **T15 — Full Version History** (Phase 15)
- [x] **T16 — Validation and Safety Layer** (Phase 16)
- [x] **T17 — Domain Framework** (Phase 17)
- [x] **T18 — Teams and Permissions** (Phase 18)
- [x] **T19 — Client and Team Collaboration** (Phase 19)

Active milestone:

- [ ] None. T20 has not been started.

Next milestone:

- [ ] **T20 — Commercial and Operational Features** (Phase 20)

### T19 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 471 passed |
| Integration tests | 288 passed against Neon |
| Production build | passed, 77 routes |
| Migrations | 23 applied |
| Auth boundary | verified live: `/share/<token>` and `/api/share/<token>` return 200 with no session; `/dashboard` still 307s to sign-in; an unknown token 404s |
| Leak tests | a costed project with a supplier on record, shared: no internal amount, no supplier, no project/workspace/user id, no member email |
| Token probing | unknown, revoked and expired links return the same status and the same message |
| Client loop | driven end to end in a browser: approve → confirmation, message in the thread, notification delivered to the team |

**A real defect was found by looking at the client page.** It rendered inside
the root layout, so a client opening their supplier's proposal saw TARKIB's
name, a "Sign in" link and a "Get started" button. The header moved into an
`(app)` route group; the share page also sets its own title and `noindex`.

### T18 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 471 passed |
| Integration tests | 270 passed against Neon |
| Production build | passed, 69 routes |
| Migrations | 22 applied |
| Backfill | verified: every user has a personal workspace, and zero projects or materials changed hands |
| Cross-workspace isolation | tested: project, material, listing and workspace all 404 for a non-member |
| Role enforcement | tested at the service layer, not the interface: worker and production refused cost, designer refused quoting, sales refused design editing |
| Degradation | tested: a worker opens the project and the integrity report without the cost section |
| Owner invariants | tested: cannot remove the owner, demote the last owner, or have an admin change who the owner is |
| Invitations | tested: wrong account, expired and revoked links all refused |

**Two real defects were found during this milestone, both by the work itself.**
The branded `WorkspaceId` exposed twenty-four call sites that had silently kept
passing a user id. And a test exposed that quote numbering was still per-person,
so two members of one business could each issue Q-2026-0001; it now runs per
workspace, backfilled so no issued quote changed its number.

### T17 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 435 passed |
| Integration tests | 241 passed against Neon |
| Production build | passed, 61 routes |
| Migrations | 20 applied |
| No behaviour change for signage | tested: the required field list and plausibility bounds are asserted to be the ones that shipped |
| The seam is real | tested: one specification is blocked for signage and approves for joinery |
| Engines are trade-independent | tested: a joinery project calculates, cuts and costs through the unchanged engines |

### T16 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 414 passed |
| Integration tests | 230 passed against Neon |
| Production build | passed, 61 routes |
| Migrations | 19 applied |
| Quote gate | tested: a quote whose spec moved after drafting is refused and stays a draft |
| Package gate | tested: unplaced pieces refuse a package; absent data still allows one |
| Audit | tested: survives deletion of the project it describes |
| Schema correction | the first T16 migration left the audit FK as RESTRICT, which made deleting a user impossible; a second migration cascades it |

**The stricter gate found a real false positive.** Staleness compared
`Material.updatedAt`, so archiving or renaming a material marked every line
using it out of date. Harmless as a warning; as a blocker it refused a quote
that was perfectly sound. It now compares the fields the calculation used.

### T15 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 375 passed |
| Integration tests | 210 passed against Neon |
| Production build | passed, 59 routes |
| Migrations | 17 applied |
| Append-only | tested: restoring adds a version and every earlier one survives |
| Document traceability | tested: an issued quote keeps its version after a restore |

### T14 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 355 passed |
| Integration tests | 189 passed against Neon |
| Production build | passed, 55 routes |
| Migrations | 16 applied |
| Package PDF | generated from real project state and inspected page by page |
| Layout | `countPages` guards against the blank page an overflow leaves behind |
| Pricing separation | costed project rendered; no internal or client figure on the page |

**Two real defects were found by looking at the rendered pages, not by the
tests.** A five-sheet cutting plan was shrunk to a quarter of the measure with
unreadable piece labels, and the drawing page left a blank page behind it. Every
assertion passed in both cases.

### T13 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 323 passed |
| Integration tests | 171 passed against Neon |
| Production build | passed, 52 routes |
| Migrations | 15 applied |
| Quote PDF | rendered and inspected visually (header, table, totals, footer, draft watermark, multi-page) |
| Cost separation | leak test renders the PDF, reads the text back, and finds no internal figure |
| R2 | issued quotes stored and downloaded through a signed URL |

**The in-app quote panel was not screenshotted.** The browser available here has
no Clerk session and signing in is not something to do on the user's behalf. The
PDF — the artefact a client actually receives — was rendered and inspected, and
the panel reuses the primitives of the ten panels already shipped.

### T12 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 295 passed |
| Integration tests | 147 passed against Neon |
| Production build | passed, 49 routes |
| Migrations | 14 applied |
| Auth boundary | mockup routes JSON 401; `/api/inngest` deliberately open, signature-guarded |
| Inngest endpoint | HTTP 200, 1 function registered, dev mode |

**Live generation is NOT verified.** `REPLICATE_API_TOKEN` is unset, so no image
has actually been generated. Everything around the provider is verified: prompt
construction, aspect ratios, ownership, the refusal to generate from an
undescribed project, failure recording, and the Inngest registration.

To verify end to end: add `REPLICATE_API_TOKEN`, run `npx inngest-cli@latest dev`
alongside `npm run dev`, then generate a concept mockup.

### T11 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 280 passed |
| Integration tests | 138 passed against Neon |
| Production build | passed, 45 routes |
| Migrations | 13 applied |
| Auth boundary | drawing routes return JSON 401 |
| Visual check | rendered a 4-view sheet and inspected it twice |

The visual check found two defects no unit test caught: labels colliding on
concentric parts, and a top view whose extreme aspect ratio left no room for text
at all. Both were fixed by moving to numbered callouts with a legend, and the
callout positions are themselves collision-stacked.

### T10 verification record

| Check | Result |
| --- | --- |
| TypeScript | clean |
| ESLint | 0 errors |
| Unit tests | 248 passed |
| Integration tests | 126 passed against Neon |
| Production build | passed, 43 routes |
| Migrations | 12 applied (no schema change needed) |
| Auth boundary | recommendation routes return JSON 401 |

No migration was required: recommendations are computed, not stored. The tests
assert the invariant that matters commercially — every recommendation strictly
reduces cost, and a candidate that cannot produce every piece is never offered
however cheap it is.

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
