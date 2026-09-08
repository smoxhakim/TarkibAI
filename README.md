# TARKIB

## AI Fabrication & Design Platform

TARKIB is an AI-powered web platform that helps fabrication and signage professionals transform a project idea into a structured, visual, calculated, and production-oriented project.

The user communicates naturally with the application, primarily in **Moroccan Darija**, and can provide text, images, logos, site photos, sketches, references, and measurements.

TARKIB progressively transforms that input into:

- Structured project specifications
- AI-assisted design concepts
- Smart Canvas representations
- Material requirements
- Material purchasing quantities
- Cutting plans
- Waste calculations
- Cost estimates
- Client pricing
- Technical drawings
- Real-environment mockups
- Client quotation PDFs
- Production/fabrication PDFs
- Project versions and history

The long-term goal is to create an intelligent operating layer for businesses that turn ideas into physical fabricated projects.

---

# Product Workflow

```text
User Idea
    ↓
Moroccan Darija Conversation
    ↓
AI Requirement Collection
    ↓
Structured Project Specification
    ↓
User Approval
    ↓
AI-Assisted Design
    ↓
Smart Canvas
    ↓
Material Calculation
    ↓
Cutting Optimization
    ↓
Cost Calculation
    ↓
Technical Drawings
    ↓
Mockup Generation
    ↓
Client Quotation
    ↓
Production Documentation
```

Not every project requires every stage.

The system should always preserve the relationship between the approved project specification and its derived outputs.

---

# AI Interaction

The primary conversational language is **Moroccan Darija**.

The AI should understand:

- Arabic-script Darija
- Latin-script Darija
- Darija/French
- Darija/English
- Common Moroccan fabrication and signage terminology

Example:

```text
bghit enseigne dyal restaurant 8 metres

dir lia façade b alucobond noir

ch7al ghadi n7taj dyal l7did?

zid 50cm f l3ard

bdel had lmaterial

3tini devis
```

The AI acts as the conversational and orchestration layer between the user and the application's backend capabilities.

The AI is not the source of truth for:

- Calculations
- Authorization
- Ownership
- Financial data
- Production measurements

Those are handled by validated backend services and deterministic engines.

---

# Core Architecture

The application follows a layered architecture:

```text
User
  ↓
TARKIB Web Application
  ↓
AI Conversation / Agent Layer
  ↓
Authorized Application Tools
  ↓
Application Services
  ↓
Structured Project State
  ↓
Calculation / Geometry / Cutting / Cost / Document Services
  ↓
Postgres + Cloudflare R2
```

AI is responsible for understanding the user and orchestrating actions.

Deterministic application services are responsible for business-critical calculations and generated production data.

---

# Technology Stack

Versions below are the ones actually installed. They were brought to current
majors during T0: the pinned `next@14.2.5` carried ~20 advisories that Vercel no
longer backports to the 14 line, including authorization-bypass and SSRF issues.

## Core

| Package | Version |
| --- | --- |
| Next.js (App Router) | 16.3.4 |
| React / React DOM | 19.2.8 |
| TypeScript | 5.9.3 |
| Tailwind CSS | 4.3.3 |
| Prisma ORM + CLI | 7.10.0 |
| `@prisma/adapter-pg` | 7.10.0 |
| Clerk (`@clerk/nextjs`) | 7.9.1 |
| Zod | 4.5.4 |
| OpenAI SDK | 7.10.0 |
| AWS SDK (S3 client for R2) | 3.1126.0 |
| sharp | 0.35.4 |
| Vitest | 5.0.0 |

Database is PostgreSQL on **Neon**; hosting target is **Vercel**.

### Notes on Prisma 7

Prisma 7 changed two things this project depends on:

1. Connection URLs are no longer allowed in `schema.prisma`. They live in
   `prisma.config.ts`, which also loads `.env` explicitly (Prisma 7 no longer
   reads it automatically).
2. `PrismaClient` requires an explicit **driver adapter**. `src/lib/db.ts` uses
   `PrismaPg` against Neon's pooled endpoint.

### Notes on Clerk 7 (Core 3)

`<SignedIn>` / `<SignedOut>` were removed. Use `<Show when="signed-in">` /
`<Show when="signed-out">`. `auth()` is async.

### Notes on Next 16

`middleware.ts` is deprecated in favour of `proxy.ts` (same contract). Route
`params` and `searchParams` are Promises and must be awaited.

## Deferred dependencies

These are part of the architecture but are **not installed yet**. Each is added
in the phase that first needs it, so unused packages do not sit in the tree
accumulating advisories.

| Package | Added in |
| --- | --- |
| a payment provider | later — not chosen; Stripe does not serve Moroccan merchants (see ARCHITECTURE) |
| `resend` | later — email |
| `@sentry/nextjs` | later — monitoring |

## Known advisories

`npm audit` reports 4 high advisories, all reached only through the **`prisma`
CLI devDependency** (`mysql2`, `deepmerge-ts`). `mysql2` is a MySQL driver this
project never imports — the datasource is PostgreSQL — and the CLI does not ship
to production. npm's suggested "fix" is a downgrade to Prisma 6, which is
backwards; it is deliberately not applied.

---

# Repository Structure

Directories marked *(planned)* do not exist yet; they are created by the phase
that needs them.

```text
prisma/
  schema.prisma           # data model
  migrations/             # applied SQL migrations
prisma.config.ts          # Prisma 7 config: schema path + migration datasource

src/
  proxy.ts                # Clerk route protection (Next 16 "proxy" convention)
  generated/prisma/       # generated Prisma client (gitignored)

  app/
    layout.tsx            # app shell: header, auth controls
    page.tsx              # landing page
    globals.css           # Tailwind 4 entry + theme tokens
    sign-in/, sign-up/    # Clerk hosted components
    dashboard/            # project list (+ loading, error states)
    materials/            # material library (+ loading, error states)
    settings/costing/     # private costing rules (+ loading, error states)
    projects/[id]/        # project workspace (+ loading, not-found)
    api/
      projects/           # GET, POST
      projects/[id]/      # GET, PATCH, DELETE
      projects/[id]/messages/       # GET, POST — one Darija intake turn
      projects/[id]/spec/           # GET — structured specification
      projects/[id]/spec/approve/   # POST — user-only approval
      projects/[id]/files/          # GET, POST (authorise upload)
      projects/[id]/files/[fileId]/          # DELETE
      projects/[id]/files/[fileId]/confirm/  # POST — verify the object landed
      projects/[id]/files/[fileId]/download/ # GET — redirect to a signed URL
      projects/[id]/materials/       # GET, POST — project material selection
      projects/[id]/materials/[projectMaterialId]/  # PATCH (requirement), DELETE
      projects/[id]/calculate-materials/  # POST — run the deterministic engine
      projects/[id]/costs/            # GET — internal breakdown
      projects/[id]/costs/calculate/  # POST — compute the cost
      projects/[id]/expenses/         # GET, POST
      projects/[id]/expenses/[expenseId]/  # DELETE
      projects/[id]/canvas/           # GET, POST (scene commands)
      projects/[id]/canvas/seed/      # POST — build from the approved spec
      projects/[id]/design-proposals/ # GET — pending + history
      projects/[id]/design-proposals/[proposalId]/  # POST — approve | reject
      projects/[id]/cutting-pieces/   # GET, POST
      projects/[id]/cutting-pieces/[pieceId]/  # DELETE
      projects/[id]/cutting-plan/     # GET, POST — guillotine sheet nesting
      projects/[id]/linear-cuts/      # GET, POST
      projects/[id]/linear-cuts/[cutId]/  # DELETE
      projects/[id]/linear-plan/      # GET, POST — bar cut optimisation
      projects/[id]/recommendations/  # GET — computed material savings
      projects/[id]/recommendations/apply/  # POST — switch material
      projects/[id]/drawings/         # GET — live drawing + issued versions
      projects/[id]/drawings/issue/   # POST — capture a numbered snapshot
      projects/[id]/mockups/          # GET, POST — gallery, queue generation
      projects/[id]/mockups/[mockupId]/        # DELETE
      projects/[id]/mockups/[mockupId]/image/  # GET — signed redirect
    inngest/                          # background job endpoint (machine caller)
    cost-settings/                    # GET, PUT
    materials/                       # GET, POST
    materials/[id]/                  # GET, PATCH, DELETE
    materials/categories/            # GET

  components/             # StatusBadge, NewProjectForm, ProjectActions,
                          # ChatPanel, SpecPanel, FilesPanel,
                          # MaterialLibrary, MaterialForm, ProjectMaterialsPanel,
                          # ProjectMaterialRow, CostPanel, CostSettingsForm,
                          # CanvasPanel, DesignProposalsPanel, CuttingPlanPanel,
                          # LinearCutPanel, EfficiencyPanel, DrawingsPanel,
                          # MockupsPanel

  lib/
    db.ts                 # Prisma singleton + pg driver adapter
    strings.ts            # centralised UI strings (English chrome)
    auth/current-user.ts  # Clerk session -> User row
    http/api.ts           # ApiError, route wrapper, JSON error shapes
    projects/             # schema (Zod), service (ownership), status rules
    ai/
      config.ts           # model + feature gate
      agent.ts            # bounded tool-calling loop
      conversation-service.ts
      prompts/system.ts   # Moroccan Darija instructions
      tools/              # context-bound toolbox (no approval tool)
      eval/               # live Darija evaluation cases
      vision.ts           # downscale + inline images for the model
    spec/                 # schema, deterministic merge, completeness, service
    files/                # upload authorisation, confirmation, ownership
    materials/            # library CRUD, search, project selection, formatting
    storage/              # R2 client, signed URLs, object-key construction
    calc/
      materials/          # deterministic material engine (pure) + persistence
      costs/              # deterministic cost engine + client-safe serializer
      cutting/            # guillotine sheet nesting + 1D bar packing,
                          # diagram renderers, service
      efficiency/         # material savings, computed by re-running the engines
    drawings/             # orthographic projection, sheet renderer, issuing
    mockup/               # provider abstraction, prompt construction, jobs
    inngest/              # background job client and functions
    canvas/               # scene schema, command reducer, SVG renderer, service
    design/               # AI design proposals and the approval gate
    quotes/               # quote engine, client-safe document, PDF template,
                          # settings and issuing
    production/           # workshop package: spec readers, assembly, template
    versions/             # project snapshots, deterministic diff, restore
    workspaces/           # membership, roles, permissions, invitations
    collaboration/        # client share links, the project thread, notifications
    commercial/           # suppliers, purchase planning, projected margin, analytics
    domains/              # trade profiles: required fields, palette, bounds, prompt
    validation/           # integrity checks, document gates, content sniffing
    audit/                # append-only record of consequential actions
    pdf/                  # shared document layer: image inlining, formatting,
                          # and PDF text/layout inspection used by the tests
    geometry/, mockup/    # (planned)

inngest/                  # (planned) Phase 12
```

---

# Development Philosophy

TARKIB is being built as a **complete product in progressive phases**, not as a one-pass MVP.

Development should be:

- Incremental
- Testable
- Architecture-aware
- Domain-driven
- Production-oriented

Do not attempt to implement the whole product at once.

Each milestone should result in a working part of the product.

---

# Important Engineering Principles

## AI is an orchestrator

The AI understands the user's language, asks questions, extracts structured information, and calls controlled tools.

## Structured project data is the source of truth

Chat messages are not the canonical project state.

## Deterministic calculations

Business-critical calculations must be performed using application code.

## Explicit approvals

Important changes and downstream project decisions should require user confirmation.

## Backend authorization

Every protected action must be authorized server-side.

## Secure file storage

Project files and generated assets should be stored privately in Cloudflare R2 and accessed through controlled signed URLs.

## No fabricated technical results

If the system cannot reliably calculate or generate something, it must communicate that limitation rather than inventing a result.

---

# Local Development

## Prerequisites

- Node.js 20.9+ (Next 16 requirement)
- A **Neon** Postgres project
- A **Clerk** application

## 1. Environment

```bash
cp .env.example .env
```

Fill in four variables; leave the rest blank until their phase arrives.

| Variable | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Neon connection string with **pooling ON** (host contains `-pooler`) |
| `DIRECT_URL` | Neon connection string with **pooling OFF** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk → API keys (`pk_...`) |
| `CLERK_SECRET_KEY` | Clerk → API keys (`sk_...`) |
| `OPENAI_API_KEY` | platform.openai.com → API keys (`sk-...`) |
| `R2_ACCOUNT_ID` | Cloudflare dashboard → R2 → account id |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → Manage API tokens |
| `R2_SECRET_ACCESS_KEY` | shown once when the token is created |
| `R2_BUCKET_NAME` | the bucket you created |

`OPENAI_MODEL` is optional and defaults to `gpt-5`.

Without `OPENAI_API_KEY` the application still runs: the conversation endpoint
returns 503 and the chat panel says the assistant is not configured. The same
applies to the `R2_*` variables and the file endpoints. Nothing else is
affected, and neither gap is hidden from the user.

The R2 bucket must allow `PUT` from the app's origin via CORS, because uploads
go from the browser straight to R2.

Two database URLs are required because Neon's pooler runs in transaction mode
and cannot hold the advisory locks `prisma migrate` needs. Runtime queries use
the pooled URL; migrations use the direct one.

## 2. Install and migrate

```bash
npm install
```

`postinstall` runs `prisma generate` automatically. Then apply migrations:

```bash
npm run prisma:migrate
```

**Restart `next dev` after a migration.** `src/lib/db.ts` caches the Prisma
client on `globalThis` in development, so that a hot reload does not open a new
Neon connection pool each time. A migration regenerates the client, but the
cached *instance* is still the one built from the previous schema — so a model
added by the migration surfaces as
`Cannot read properties of undefined (reading 'findMany')` until the server is
restarted. Nothing is wrong with the code when this happens.

## 3. Run

```bash
npm run dev
```

Open http://localhost:3000

## Deploying

Verified against a production build and a from-empty migration run before the
first deploy. What is written here is what was actually checked, not a guess.

### The migration chain applies from scratch

All 24 migrations were applied to an empty schema and the result matched
`schema.prisma` with **zero drift**, so a fresh Neon database comes up correctly.
Vercel runs `postinstall: prisma generate`; run `npm run prisma:deploy` against
the production database once before the first release.

### Environment

| Variable | Required | Note |
| --- | --- | --- |
| `DATABASE_URL` / `DIRECT_URL` | yes | pooled and direct Neon endpoints |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | yes | a **production** Clerk instance issues new keys; the development ones do not carry over |
| `OPENAI_API_KEY` | yes | without it the chat endpoint returns 503 and says so |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | yes | files, quote PDFs, production packages, mockups |
| `INNGEST_SIGNING_KEY` | **yes** | verified: without it `/api/inngest` returns 500 in production mode. With it, an unsigned request is correctly refused with 401. |
| `INNGEST_EVENT_KEY` | yes | outbound events; without it a mockup can never start |
| `REPLICATE_API_TOKEN` | optional | mockups say they are not configured without it |

### Two things that bite otherwise

**R2 CORS** currently allows `http://localhost:3000` only. Uploads go from the
browser straight to R2, so the production origin must be added or every upload
fails with an opaque CORS error.

**`maxDuration = 120`** on `/api/projects/[id]/messages` exceeds the Vercel
Hobby ceiling of 60 seconds and will fail the build there. On Pro it is fine. On
Hobby, lower it to 60 and accept that a long Darija turn running several tool
calls may time out.

### After the first deploy

Sync the Inngest app: app.inngest.com → Manage → Apps → Sync new app, pointing
at `https://<your-domain>/api/inngest`. Inngest does not know the functions
exist until it fetches that endpoint.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (no database required) |
| `npm run test:integration` | Integration tests against the real database |
| `npm run test:eval` | Live Moroccan Darija evaluations (needs `OPENAI_API_KEY`; self-skips without one) |
| `npm run prisma:migrate` | Create and apply a migration |
| `npm run prisma:studio` | Browse the database |

Unit and integration tests are separated deliberately: `npm test` must stay
runnable in CI without database credentials.

---

# Documentation

The main project documentation is:

### PRD_TARKIB.md

Defines:

- Product vision
- User problems
- Target users
- Product capabilities
- Product principles
- Future product direction

### ARCHITECTURE_TARKIB.md

Defines:

- Technical architecture
- Technology choices
- Data model
- API structure
- AI architecture
- Calculation architecture
- Development phases
- Security principles

### TODO.md

Tracks the active development roadmap and milestone status.

---

# Development Status

TARKIB is built progressively according to the roadmap in `TODO.md`.

**Completed: T0 Foundation · T1 Darija AI Intake · T2 File Management ·
T3 Material Library · T4 Material Calculation · T5 Cost Engine ·
T6 Smart Canvas · T7 Conversational Design Editing ·
T8 Sheet Cutting Optimization · T9 Linear Material Cutting ·
T10 Material Efficiency Recommendations · T11 Technical Drawings ·
T12 AI Mockups**

Working end to end:

- Clerk authentication; all pages private by default, API routes return JSON 401s
- Clerk session lazily synced to a `User` row
- Neon Postgres with 16 tables and applied migrations
- Project CRUD: create, list, open, rename, archive, restore, permanent delete
- Ownership enforced in a single service layer; cross-user access reported as 404
- Loading, empty, and error states on every implemented screen
- 18 unit tests, 7 integration tests, clean typecheck, clean production build

T1 adds: a Moroccan Darija conversation that extracts a structured
specification through validated tool calls, deterministic missing-field
detection, and explicit user approval that snapshots a project version. The
agent has no tool that can approve anything.

T2 adds: private file storage on Cloudflare R2 with browser-to-R2 presigned
uploads, signed short-lived downloads, attachment management in the project
workspace, and image context for the agent. No URL is ever persisted; every
read is authorised first.

T3 adds: a private material library with structured stock dimensions in integer
millimetres, categories, suppliers, prices in integer minor units, search and
filtering, and per-project material selection. Selected materials show "not
calculated yet" rather than a zero, because no engine has computed them.

T4 adds: a deterministic material calculation engine. You state how much of each
material the project needs; the engine derives purchase units, purchased
quantity, waste and cost in integer arithmetic, shows its working step by step,
and flags results as stale when the spec, the material, or the requirement
changes underneath them. Sheet counts are an explicitly labelled minimum until
2D nesting arrives in T8.

T5 adds: configurable costing rules in basis points, a deterministic engine
turning material cost plus labour, transport, installation and per-project
expenses into a private internal total, then margin and tax into a client price
— with a serializer boundary that exposes only subtotal, tax and total.

T6 adds: a structured canvas holding typed objects with real millimetre
geometry, materials and dimension annotations, rendered deterministically to
SVG from project data rather than generated as an image. It is built from the
approved specification and flags itself when the specification moves on. The
validated command layer behind it is what conversational editing will drive.

T7 adds: the Darija agent can read the canvas and propose structured changes —
"zid 50cm f l3ard" becomes a concrete proposal computed from the panel's real
width. Nothing is applied until you approve it; the agent has no tool that
mutates the canvas or approves anything. A change to an agreed dimension writes
a new draft specification rather than rewriting the approved one.

T8 adds: guillotine sheet nesting with kerf, edge margin, rotation and multiple
sheets, producing a visual cutting plan, real waste, and usable offcuts. Cuts run
edge to edge so a panel saw can actually make them. Pieces too large for the
sheet are reported rather than silently split.

T9 adds: bar and profile cut optimisation with kerf, per-bar utilisation and
remnants that are reported as reusable stock rather than waste when they are
long enough to keep. It also fixes a real defect in T4, whose linear bar count
divided total length by bar length and presented the result as exact — that
under-counts whenever cut lengths do not pack neatly.

T10 adds: material savings computed by re-running the real cutting engines
against every alternative in your own library. A recommendation is only shown
when it strictly reduces cost and can still produce every piece. Nothing is
stored, because a stale saving is worse than none, and the agent can explain the
figures in Darija but cannot generate or apply one.

T11 adds: front, back, top and side views generated deterministically from the
canvas geometry, with dimensions, material annotations and numbered part
callouts. Views needing depth say so when a part has none, rather than inventing
a thickness. Drawings render live and can be issued as numbered snapshots for a
workshop. Section views are deliberately not implemented — they would require
inventing internal structure.

T12 adds: concept and real-site mockups generated in the background through
Inngest, with prompts built only from facts the specification records, progress
states that say why a generation failed, and a gallery. Mockups are labelled as
presentation aids, never production geometry.

Requires `REPLICATE_API_TOKEN`, and locally `npx inngest-cli@latest dev`
alongside the dev server.

T13 adds: client quotations. A quote is seeded from the calculated client
subtotal, split into whatever lines you want a client to see, and issued as a
professional PDF stored privately in R2 behind a signed download. The company
block, logo, terms, payment details and numbering live in Quote settings.

Internal cost never reaches the document: the template consumes a type that has
no field for margin, labour or a purchase price, and a test renders the PDF and
reads the text back to prove it. Pricing differently from the calculation is
allowed — the difference is computed and shown, so it is a decision rather than
an accident. Issuing freezes the quote; changing anything means a new quote with
a new number. Arabic-script text is reported as unrenderable rather than printed
as blank boxes.

T14 adds: the production package. One numbered PDF for the workshop containing
the issued drawing on a landscape page, the material list with each line's own
calculation caveats printed beside it, and every cutting plan drawn one sheet
per figure so the piece labels are readable at the bench. Stored in R2 behind a
signed download; a preview renders on demand and is never stored.

It carries no prices — the shop floor gets quantities, and a package can end up
with a subcontractor. Nothing about assembly is inferred: the package prints the
mounting method somebody recorded, and when none is recorded it says so and
tells the reader not to assume one. Gaps are printed rather than hidden — no
drawing issued, no cutting plan computed, specification still a draft — and only
a project with neither a drawing nor a calculated material line is refused.

T15 adds: version history. A snapshot of the whole project — specification,
canvas, material lines, cost and document references — is recorded whenever a
specification is approved, a design accepted, a quote issued or a package
generated, and whenever you save one deliberately. Any two versions can be
compared, or a version compared against the project as it stands.

The comparison is computed, not summarised: same two snapshots in, same diff
out, no model involved. Sections a version never captured report that they
cannot be compared rather than claiming the work was deleted.

Versions are append-only. Restoring writes a new draft specification and
restores the canvas; it does not restore calculations, because their numbers
came from the specification you are moving away from — they go stale instead.
Issued quotes and generated packages keep pointing at the state they were built
from, which is the promise the whole system rests on.

T16 adds: one place that asks every integrity question at once — stale figures,
uncalculable materials, pieces that are not being cut, dimensions that look like
a slipped decimal — and safeguards built on it. A quote is now refused while its
price would come from superseded figures; a package is refused while it would
carry figures that are wrong, though not merely absent, because a package may
still be built from a drawing alone with its gaps printed on it.

Severity is a promise: a blocker stops a document, a warning proceeds after
telling you, a note is worth knowing. Plausibility is never a blocker — the tool
does not decide what you are allowed to build.

Also: an append-only audit trail of approvals, issues, generations, restores and
removals, which survives the project it describes being deleted; and byte-level
content sniffing at upload confirmation, deferred from T2.

T17 adds: the domain framework. A project belongs to a trade, and the trade
decides which specification fields must be answered before approval, what
vocabulary the assistant uses, which canvas objects are offered, and what counts
as an implausible dimension.

It does not decide anything about calculation. Material requirements, purchase
counts, cutting, waste, cost and tax are the same arithmetic in every trade, and
keeping them out of the profile is what stops a trade acquiring its own quietly
different numbers.

Two domains ship: **signage & shopfronts**, which behaves exactly as it did
before — every value in the profile was hard-coded somewhere, and tests assert
so — and **joinery & furniture**, which is real rather than a placeholder,
because every engine below the specification already supported it unchanged. It
proves the seam by differing where the trades differ: no lighting requirement,
smaller plausible sizes, no lettering on its canvas.

T18 adds: workspaces. A business owns its projects, its material library, its
costing rules and its company block; people are members with roles. Every
existing user got a personal workspace holding exactly what they already owned,
and a single-person business behaves as it did before.

Access is decided at one gate. `assertProjectAccess` resolves a project to its
workspace and requires a membership row — the same function eighty-odd services
already called, so they all inherited the new rule at once.

Six roles, with permissions written out per role rather than derived from a
hierarchy: sales sees costs and cannot touch the canvas, production manages the
material library and cannot see costs, a worker reads the job and its production
package and nothing else. Cost visibility is enforced by refusing the read, not
by filtering the response.

Invitations are by email, with no email sent — the product has no mail provider
yet, so the link is handed to the inviter to pass on, and the interface says so.
Accepting requires the signed-in account to be the one invited.

T19 adds: client sharing and the project conversation. A revocable, optionally
expiring link gives a client a read-only page showing the project, the issued
quote, the visuals and the conversation — and nothing else. They can approve,
ask for changes, or just reply, and the team is notified in the app.

The share is the only unauthenticated surface in the product, so it is built
assuming the link has been forwarded to somebody the sender never intended: the
payload is client-safe by construction, carries no internal figure and no
internal id, shows members as the business rather than by name, and reports
unknown, revoked and expired links identically so a token cannot be probed.

The client page deliberately carries none of TARKIB's own chrome — it is the
business's document, and their client is not our user.

No email is sent for shares or invitations. There is no mail provider yet, so
the link is handed back to the sender and the interface says so plainly.

T20 adds: the commercial loop the product left open. Suppliers as records, a
purchase list grouped by who you order from — built from the quantities the
engines already computed, never recomputed — projected margin per project, and
workspace analytics including a win rate drawn from real client approvals.

Everything here is labelled for what it is. The margin is **projected**: the
product knows what it estimated and what it quoted, and does not know what a job
actually cost, because nothing records invoices or hours. A project missing a
cost or a quote says which rather than counting a zero, workspace totals name
how many projects they cover, and a business that has issued no quotes has an
unknown win rate rather than 0%.

Prices in the purchase list follow cost visibility: production sees the
quantities they need to order and no prices at all.

Eleven capabilities were listed for this phase; four shipped. Billing,
inventory integrations, a CRM, extra pricing models and extra quote templates
are recorded in TODO as deliberately out, with reasons.

**Next: T21 — Advanced AI (Phase 21)**

Not yet implemented. Nothing in the product returns a fabricated number or a
mocked AI reply.

A milestone is complete only when the functionality works end to end — not when
UI files or API stubs exist.

---

# Project Vision

TARKIB aims to make it possible for a professional to go from:

```text
"bghit enseigne dyal restaurant..."
```

to:

```text
Approved Project
↓
Design
↓
Materials
↓
Cuts
↓
Costs
↓
Mockup
↓
Client Quote
↓
Production Package
```

while keeping the user in control of important decisions.

The long-term vision is to make TARKIB an AI-powered operating layer for physical fabrication workflows.
