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
| `openai` | Phase 1 — Darija conversational AI |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | Phase 2 — R2 file storage |
| `sharp` | Phase 2 — image processing |
| `inngest` | Phase 12 — background jobs for mockups |
| `@react-pdf/renderer` | Phase 13 — client quotation PDFs |
| `stripe` | Phase 20 — billing |
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
    projects/[id]/        # project workspace (+ loading, not-found)
    api/
      projects/           # GET, POST
      projects/[id]/      # GET, PATCH, DELETE
      projects/[id]/messages/  # 501 until Phase 1

  components/             # StatusBadge, NewProjectForm, ProjectActions

  lib/
    db.ts                 # Prisma singleton + pg driver adapter
    strings.ts            # centralised UI strings (English chrome)
    auth/current-user.ts  # Clerk session -> User row
    http/api.ts           # ApiError, route wrapper, JSON error shapes
    projects/             # schema (Zod), service (ownership), status rules
    ai/                   # (stub) Phase 1
    calc/                 # (stub) Phase 4
    pdf/                  # (stub) Phase 13
    canvas/, geometry/, mockup/, storage/   # (planned)

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

## 3. Run

```bash
npm run dev
```

Open http://localhost:3000

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (no database required) |
| `npm run test:integration` | Integration tests against the real database |
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

**Completed: T0 — Repository and Application Foundation (Phase 0)**

Working end to end:

- Clerk authentication; all pages private by default, API routes return JSON 401s
- Clerk session lazily synced to a `User` row
- Neon Postgres with 16 tables and applied migrations
- Project CRUD: create, list, open, rename, archive, restore, permanent delete
- Ownership enforced in a single service layer; cross-user access reported as 404
- Loading, empty, and error states on every implemented screen
- 18 unit tests, 7 integration tests, clean typecheck, clean production build

**Next: T1 — Moroccan Darija AI Intake (Phase 1)**

Not yet implemented. `/api/projects/[id]/messages` authenticates and authorises
correctly but returns **501**, and the project workspace panels are explicitly
labelled as unbuilt. Nothing in the product returns a fabricated number or a
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
