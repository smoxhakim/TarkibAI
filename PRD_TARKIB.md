# PRD: TARKIB — AI Fabrication & Design Platform

## 1. Product Vision

TARKIB is an AI-powered web platform designed to transform the workflow of professionals who design, estimate, document, and prepare physical fabrication projects.

The platform combines conversational AI, visual design assistance, structured project data, deterministic calculation engines, technical drawing generation, cutting optimization, cost estimation, mockup generation, client quotations, and production documentation in one workspace.

The long-term vision is broader than a traditional design tool. TARKIB should become an intelligent operating layer for businesses that turn an idea into a physical product or installation.

The user should be able to describe a project naturally, upload references, answer AI questions, review the proposed project, approve decisions, and progressively obtain the information needed to quote and produce the project.

The user should not need advanced CAD or graphic-design knowledge to start a project.

The AI should assist the user rather than silently make critical production decisions.

---

## 2. Problem

Professionals in signage, advertising, commercial branding, fabrication, and related trades often complete one project using several disconnected tools:

- WhatsApp, email, or phone calls for client requirements
- Illustrator or other design tools for concepts
- CAD tools for technical drawings
- Excel and calculators for material quantities and costing
- Photoshop or image tools for mockups
- Word or similar tools for quotations
- Separate documents for production teams

Every handoff can introduce errors, duplicated work, inconsistent pricing, and lost information.

A single project may require hours of repetitive work before a client even receives a quotation.

TARKIB centralizes this workflow.

---

## 3. Target Users

### Primary users

Professionals and small businesses involved in:

- Advertising and signage
- Illuminated signs
- 3D letters
- Light boxes
- Billboards
- Totems
- Restaurant facades
- Storefront branding
- Commercial interior/exterior branding
- Metal fabrication
- MDF and woodworking
- Alucobond/composite panel work
- PVC and acrylic fabrication
- Pergolas
- Custom physical installations

### Initial product wedge

The initial domain should remain signage and fabrication because it provides a focused environment for validating the AI workflow and calculation logic.

The architecture should nevertheless be extensible so additional industries can be introduced later.

---

## 4. Core Value Proposition

TARKIB aims to replace a fragmented estimating and preparation workflow with one guided workspace:

> Idea → Conversation → Structured Specification → Approval → Design → Calculation → Optimization → Cost → Mockup → Quote → Production

The product's core differentiation is not generic AI image generation.

Its core value is the connection between:

- Natural-language project understanding
- Structured project specifications
- Deterministic engineering/business calculations
- Visual design
- Material planning
- Production documentation

---

## 5. Core Product Principles

### 5.1 AI-first interaction

The primary user interaction is conversational.

Users can communicate naturally in Moroccan Darija, including:

- Darija written in Arabic script
- Darija written in Latin characters
- Darija mixed with French
- Darija mixed with English
- Common Moroccan technical terminology

Examples:

> "bghit enseigne dyal restaurant 6 metres"

> "dir lia façade b alucobond noir"

> "ch7al ghadi n7taj dyal l7did?"

> "bdel had llogo"

The application should understand the user's intent without requiring the user to translate requirements into English.

### 5.2 AI is an orchestrator, not the source of truth

The AI should:

- Understand intent
- Ask questions
- Collect information
- Extract structured data
- Propose changes
- Call controlled application tools
- Explain results

The AI should not be responsible for authoritative arithmetic, ownership decisions, authorization, or production calculations.

### 5.3 Deterministic calculations

Business-critical calculations must be performed by deterministic application code.

This includes:

- Dimensions
- Material quantities
- Purchase counts
- Waste
- Cutting plans
- Costs
- Taxes
- Margins

AI-generated numbers must never be accepted as final calculation results without validation through the relevant engine.

### 5.4 Approval before important actions

The AI must ask for missing information and obtain user approval before important downstream actions.

The AI should not silently:

- Finalize a project specification
- Change important dimensions
- Substitute a material
- Change a cost assumption
- Generate final production documentation
- Generate a final client quotation

---

## 6. Project Workflow

The canonical workflow is:

1. User creates a project.
2. User starts a conversation in Moroccan Darija or another supported language.
3. User describes the project.
4. User uploads photos, logos, sketches, inspiration images, and other references.
5. AI identifies missing information.
6. AI asks targeted questions.
7. AI creates or updates a structured project specification.
8. AI summarizes the specification.
9. User explicitly approves the specification.
10. The application creates a version snapshot.
11. The user and AI iterate on the visual/project concept.
12. User approves the relevant project design/specification.
13. The application calculates required materials.
14. Cutting optimization is performed where applicable.
15. Cost calculation is performed.
16. Technical drawings are generated from structured data.
17. Mockups can be generated.
18. Client quotation PDF is generated.
19. Production/fabrication PDF is generated.
20. All assets and versions remain attached to the project.

Not every project will require every step.

---

## 7. Input Types

The application should support:

### Text

Natural-language project descriptions.

### Images

- Site photographs
- Restaurant/shop photographs
- Existing signs
- Inspiration images
- Logos
- Existing designs

### Sketches

Users can upload:

- Hand sketches
- Rough drawings
- Professional sketches

In the conversational workflow, sketches may help communicate shape and intent.

Precise geometric measurements must come from validated structured project data unless a future dedicated geometry-analysis system is introduced.

### Other files

The architecture should allow additional file types to be supported later.

---

## 8. Conversational AI

The AI conversation system should:

- Keep project context
- Understand Moroccan Darija
- Understand common technical vocabulary
- Ask only useful questions
- Avoid repeating already confirmed information
- Summarize current understanding
- Identify missing required fields
- Propose next steps
- Request approval
- Call project tools
- Explain calculation results clearly

The system should distinguish between:

- Information gathering
- Suggestions
- Proposed changes
- Approved changes
- Executed actions

---

## 9. Structured Project Specification

The project specification is the canonical structured representation of the project.

It should be able to evolve as the product grows.

Typical data may include:

- Project type
- Industry/domain
- Dimensions
- Components
- Materials requested
- Lighting
- Mounting method
- Location/site information
- Design requirements
- Notes
- Reference assets
- Geometry data when available

The schema should be extensible and versioned.

Chat messages are not the authoritative project state.

---

## 10. Smart Canvas

The Smart Canvas is the visual workspace for the project.

In the long term it should represent structured project objects rather than only displaying generated images.

It should be capable of displaying:

- Components
- Panels
- Frames
- Letters
- Materials
- Dimensions
- Labels
- Technical annotations
- Geometry
- Design versions

The user should be able to request changes through conversation, for example:

> "Make the sign 50 cm wider."

The resulting change should update the relevant structured project data and trigger downstream recalculation when necessary.

The exact canvas UX may evolve based on validation and usability research.

---

## 11. Material Library

Each user has a private material database.

Users should be able to define materials such as:

### Metals

- Steel tubes
- Square tubes
- Rectangular tubes
- Metal sheets
- Aluminum

### Wood

- MDF
- Plywood
- Natural wood

### Panels

- Alucobond
- PVC
- Acrylic
- Composite panels

### Signage materials

- LED modules
- Acrylic letters
- Vinyl
- Lighting components

Each material can contain:

- Name
- Category
- Supplier
- Standard dimensions
- Thickness
- Unit
- Purchase price
- Notes
- Optional technical properties
- Calculation-related properties where needed

Prices are user-specific.

---

## 12. Material Calculation

The calculation engine should calculate:

- Required quantity
- Standard purchase units
- Purchase quantity
- Purchased quantity
- Estimated waste
- Material cost

Example:

Required length: 25 m  
Standard bar: 6 m  
Bars to purchase: 5  
Purchased length: 30 m  
Estimated waste: 5 m

The engine should explain how the result was obtained.

---

## 13. Waste Reduction

The long-term product should provide material-efficiency recommendations.

Possible recommendations include:

- Alternative standard sizes
- Better material utilization
- Reduced waste
- Better purchasing quantities
- More efficient layouts

Recommendations are suggestions only.

The system must show the assumptions behind a recommendation and require user approval before changing project inputs.

---

## 14. Cutting Optimization

The cutting system should support sheet and eventually linear materials.

### Sheet materials

Examples:

- MDF
- Alucobond
- PVC
- Acrylic
- Wood
- Metal sheets

The engine should support:

- Sheet dimensions
- Piece dimensions
- Rotation
- Margins
- Kerf where configured
- Multiple sheets
- Waste percentage
- Visual cutting layouts

### Linear materials

Future versions should support:

- Steel bars
- Tubes
- Aluminum profiles
- Wood bars

The output should clearly distinguish between:

- Required material
- Material to purchase
- Cutting layout
- Waste

No unsupported optimization scenario should produce a fabricated answer.

---

## 15. Cost System

Internal business costing must be separated from client-facing pricing.

Possible internal cost categories include:

- Materials
- Labor
- Transport
- Installation
- Machines
- Design
- Other expenses
- Profit margin

Users should configure these rules in Settings.

Cost rules may support:

- Fixed amount
- Percentage
- Manual values

The internal breakdown is private.

The client quote should expose only the commercial values intended by the user.

---

## 16. Technical Drawings

The application should progressively evolve from simple template-driven drawings to more advanced structured technical documentation.

A project may eventually support:

- Front view
- Side view
- Top view
- Back view
- Sections
- Dimensions
- Component labels
- Material annotations
- Assembly references

Technical drawings must be generated from structured and validated project data.

AI-generated images are concept visuals and must not be treated as authoritative engineering drawings.

---

## 17. Mockups

The application should support two major visualization modes.

### Design concept

A clean visual representation of the proposed design.

### Real-environment mockup

The user provides a real site photograph.

The system generates a concept visualization of the proposed project in that environment.

These visualizations are presentation aids.

They should not be represented as production-accurate measurements or engineering renders.

---

## 18. Client Quotation

The application should generate a professional client-facing quotation PDF.

It may include:

- Company logo
- Company information
- Client information
- Quote number
- Date
- Project title
- Project description
- Line items
- Quantities
- Unit prices
- Totals
- Tax/TVA
- Payment information
- Validity period
- Terms
- Optional project mockup

The quote must never expose internal cost or profit data unless explicitly designed as a future feature and intentionally enabled by the business.

---

## 19. Production/Fabrication PDF

The production PDF is intended for the workshop/shop floor.

It should be visual and operational, not just a text report.

It should eventually include:

- Front view
- Side view
- Top view
- Back view
- Dimensions
- Material specifications
- Component list
- Cutting plans
- Waste information
- Assembly guidance
- Production notes

Every drawing and cutting instruction should be derived from structured project information.

---

## 20. Project Management

Users should be able to create and manage multiple projects.

A project can contain:

- AI conversation
- Requirements
- Uploaded files
- Reference images
- Sketches
- Structured specifications
- Design versions
- Canvas state
- Materials
- Calculations
- Cutting plans
- Costs
- Mockups
- Technical drawings
- Client quotations
- Production documents

Projects should support statuses such as:

- Intake
- Spec approved
- Calculated
- Quoted
- Production ready
- Archived

---

## 21. Version History

Projects should preserve important states.

Examples:

- Initial concept
- Spec approved
- Design revision
- Material revision
- Cost recalculation
- Client revision
- Final approved version

Each approval milestone should be capable of creating a reproducible project snapshot.

---

## 22. Privacy and Data Ownership

Users must only access their own projects, files, materials, and financial information unless a future team/workspace feature explicitly grants access.

Internal costs and margins are private business information.

Uploaded and generated project files should use secure storage and controlled access.

---

## 23. Future Multi-user Workspaces

Multi-user teams are part of the long-term vision but should be introduced as a dedicated architectural phase.

Future roles may include:

- Super Admin
- Business Owner
- Designer
- Salesperson
- Production Manager
- Worker

Future permissions may control:

- Project access
- Design editing
- Cost visibility
- Quote creation
- Production document access
- Material management

Do not add team functionality as an accidental side effect of another milestone. Introduce it deliberately when its architecture is defined.

---

## 24. Supported Industries

The initial implementation should focus on signage/fabrication.

The long-term platform should be extensible toward:

- Advertising
- Signage
- Commercial facades
- Restaurant/store branding
- Metal fabrication
- Woodworking
- MDF fabrication
- Alucobond/composite panel fabrication
- PVC/acrylic work
- Pergolas
- Custom installations

Industry-specific calculation rules should be isolated from reusable platform components.

---

## 25. UX Principles

The application should prioritize:

- AI-first interaction
- Mobile-first usability
- Clear visual feedback
- Fast project creation
- Minimal manual input
- Explicit approvals
- Strong error states
- Clear uncertainty
- Professional outputs
- Desktop productivity for advanced tasks
- Responsive behavior across devices

The application should not assume that users understand technical software.

---

## 26. Security and Authorization

All backend actions must validate:

- Authentication
- Ownership
- Authorization
- Input validity
- Resource existence

AI tool calls must execute through the same authorization boundaries as direct API calls.

The model must never be trusted for:

- User identity
- Resource ownership
- Authorization
- Financial authority
- Database permissions

The server remains authoritative.

---

## 27. Success Criteria

TARKIB should eventually reduce the time required to move from a customer request to a reliable commercial and production package.

Important success measures include:

- Reduced estimating time
- Reduced calculation errors
- Reduced material waste
- Faster quote generation
- Higher percentage of quotes requiring no external rework
- User confidence in generated calculations
- Continued weekly usage by fabrication businesses
- Successful use of production documents in real shops

Exact numeric targets should be established after pilot validation.

---

## 28. Risks and Assumptions

### AI accuracy

Users may not trust AI-derived specifications or calculations unless results are transparent and validated.

### Engineering accuracy

Technical output must be positioned according to its verified capabilities. Complex fabrication should not be represented as CAD-grade unless the system can actually guarantee it.

### Image generation quality

Mockup generation may be visually impressive without being dimensionally accurate. It must remain a visualization aid.

### Calculation complexity

Real shops use local conventions for kerf, waste, standard sizes, profiles, pricing, and fabrication practices. These rules must be configurable.

### Darija language quality

Moroccan Darija is highly variable and commonly mixed with French and English. The conversational system must be tested on real user language, not only translated benchmark prompts.

### Scope

The full platform is intentionally ambitious. Development must therefore remain milestone-driven with a stable core architecture.

---

## 29. Product Evolution Strategy

Build reusable platform capabilities first and add specialized fabrication capabilities progressively.

The roadmap should evolve through major phases such as:

1. Foundation
2. Authentication and project management
3. Darija conversational AI
4. Structured project specifications
5. Material library
6. Deterministic calculations
7. Smart Canvas
8. Cutting optimization
9. Cost and pricing
10. Technical drawing system
11. Mockups
12. Client quotations
13. Production documents
14. Version history
15. Advanced fabrication rules
16. Linear-material optimization
17. Waste reduction intelligence
18. Additional industries
19. Multi-user workspaces
20. Advanced collaboration and commercial features

The exact milestones should be maintained in ARCHITECTURE.md and updated as implementation evolves.

---

## 30. Final Product Concept

TARKIB should ultimately allow a professional to say:

> "bghit enseigne dyal restaurant, 8m l3ard, 3m l3لو, alucobond noir, letters LED, w 3andi had logo."

The system should understand the request, ask the required questions, inspect the provided references, create a structured specification, present a design concept, ask for approval, calculate the required materials using the user's material database, optimize cuts, calculate internal costs and client pricing, generate a realistic mockup, and produce the documents required by both the client and the production team.

The fundamental product principle is:

> AI understands the project.
> 
> Structured data represents the project.
> 
> Deterministic engines calculate the project.
> 
> The user approves important decisions.
> 
> The platform turns the approved project into commercial and production documents.
