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

## T1 — Moroccan Darija AI Intake

- [ ] ChatMessage model
- [ ] ProjectSpec model
- [ ] AI conversation service
- [ ] OpenAI integration
- [ ] Agent/tool architecture foundation
- [ ] Moroccan Darija system instructions
- [ ] Darija/French code-switching support
- [ ] Structured spec extraction
- [ ] Missing-information detection
- [ ] Clarification questions
- [ ] Conversation context management
- [ ] Chat UI
- [ ] User approval flow
- [ ] ProjectVersion snapshot on approval

### Definition of done

A user can describe a signage project naturally in Moroccan Darija, receive clarification questions, review a structured specification, and explicitly approve it.

---

# Phase 2 — Files and Visual References

## T2 — Project File Management

- [ ] Cloudflare R2 storage layer
- [ ] Presigned uploads
- [ ] Private file access
- [ ] Upload images
- [ ] Upload logos
- [ ] Upload reference images
- [ ] Upload sketches
- [ ] Project attachment management
- [ ] File metadata
- [ ] Secure signed downloads
- [ ] AI access to relevant visual context

### Definition of done

Users can attach and manage project references securely, and the AI can use supported visual inputs as context.

---

# Phase 3 — Material System

## T3 — User Material Library

- [ ] Material model
- [ ] Material CRUD
- [ ] Categories
- [ ] Custom categories
- [ ] Suppliers
- [ ] Standard sizes
- [ ] Units
- [ ] Thickness
- [ ] Prices
- [ ] Technical properties
- [ ] Material management UI
- [ ] Material search and filtering

### Definition of done

A user can maintain their own private material database and select materials for a project.

---

# Phase 4 — Deterministic Calculation Engine

## T4 — Material Calculation

- [ ] Calculation domain structure
- [ ] Material requirement calculation
- [ ] Standard-unit purchase calculation
- [ ] Required vs purchased quantity
- [ ] Waste calculation
- [ ] ProjectMaterial persistence
- [ ] Calculation validation
- [ ] Calculation explanation UI
- [ ] Calculation tests

### Definition of done

An approved project produces deterministic material requirements and purchase quantities based on the user's material database.

---

# Phase 5 — Cost and Pricing

## T5 — Cost Engine

- [ ] CostSettings UI
- [ ] Material cost
- [ ] Labor calculation
- [ ] Transport calculation
- [ ] Installation calculation
- [ ] Other expense support
- [ ] Profit margin
- [ ] Tax
- [ ] Internal total
- [ ] Client total
- [ ] Internal/client data separation
- [ ] Cost calculation tests

### Definition of done

The system can calculate a project's internal cost and client-facing price without exposing private cost information.

---

# Phase 6 — Smart Canvas Foundation

## T6 — Structured Smart Canvas

- [ ] Canvas architecture
- [ ] Structured scene/project objects
- [ ] Basic geometry primitives
- [ ] Dimensions
- [ ] Labels
- [ ] Materials on objects
- [ ] Object identifiers
- [ ] Canvas state persistence
- [ ] AI-to-canvas command foundation
- [ ] Structured canvas updates

### Definition of done

The system can represent a basic project as structured visual objects rather than only as an image.

---

# Phase 7 — AI Design Interaction

## T7 — Conversational Design Editing

- [ ] AI design command tools
- [ ] Modify dimensions through conversation
- [ ] Modify materials through conversation
- [ ] Modify object properties
- [ ] Add/remove structured objects
- [ ] Approval-aware design changes
- [ ] Dependency invalidation
- [ ] Design revision history

### Definition of done

A user can say things such as:

"zid 50cm f l3ard"

and the application can safely update the structured project representation.

---

# Phase 8 — Cutting Optimization

## T8 — Sheet Cutting Optimization

- [ ] Sheet material rules
- [ ] 2D nesting
- [ ] Rotation
- [ ] Margins
- [ ] Kerf support
- [ ] Multiple sheets
- [ ] Waste percentage
- [ ] CuttingPlan model
- [ ] SVG cutting diagram
- [ ] PNG rendering
- [ ] Cutting-plan UI

### Definition of done

A project with supported sheet materials can produce a visual cutting plan with calculated waste.

---

# Phase 9 — Advanced Material Optimization

## T9 — Linear Material Cutting

- [ ] Linear material rules
- [ ] Standard bar/profile sizes
- [ ] Cut lengths
- [ ] Kerf
- [ ] Remnants
- [ ] Bar utilization
- [ ] Linear waste
- [ ] Visual cut sequence
- [ ] Linear optimization tests

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

Active milestone:

- [ ] None. T0 is complete and verified; T1 has not been started.

Next milestone:

- [ ] **T1 — Moroccan Darija AI Intake** (Phase 1)

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
