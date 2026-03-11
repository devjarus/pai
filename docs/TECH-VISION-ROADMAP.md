# Tech Vision Roadmap for `pai`

Date: 2026-03-08

Reference note: this is the long-form strategy rationale for `pai`. The operational source of truth for day-to-day work remains `docs/PRODUCT-CHARTER.md`, `docs/PRIMITIVES.md`, `docs/ARCHITECTURE-BOUNDARIES.md`, and `docs/DEFINITION-OF-DONE.md`.

## 1. Executive Summary

`pai` should stop positioning itself as a broad personal AI platform and instead become a self-hosted recurring decision agent with trustworthy memory.

That means the product promise is not "an AI OS that does everything." The promise is: `pai` learns what matters about the user, watches the world in the background, and delivers recommendations, briefs, and follow-through that reflect the user's actual preferences and constraints.

The strongest existing assets already point in that direction:

- persistent evolving memory
- background schedules and job execution
- research and analysis pipelines
- structured report and artifact delivery
- Inbox as the home surface
- Telegram as a mobile companion
- local-first, self-hosted trust posture

The main problem is not missing capability. The problem is product symmetry. Too many surfaces, too many nouns, and too much equal emphasis make the system feel like a bag of features instead of one opinionated product.

That does not mean the need behind `Grid` is fake. `Grid` is evidence that users want a faster way to scan what matters without clicking through every section. The fix should be to absorb that overview behavior into `Home` and Program summaries, not keep `Grid` as a peer product destination.

The recommendation is to make a hard shift:

- Publicly position `pai` as a recurring decision agent.
- Treat the memory runtime as the technical moat and internal platform.
- Treat "personal AI OS" as a future horizon, not the current product category.
- Make web Inbox/Briefs, Decision Programs, Chat, and Memory Trust the first-class experience.
- Demote or hide Grid, Timeline, raw Jobs, top-level Knowledge management, and most execution-detail concepts from the main user journey.
- Merge research and swarm into one user-facing concept: analysis depth.
- Keep Telegram, CLI, and MCP, but stop treating them as equal product pillars.

The next year should be about cleanup before expansion:

- clarify the product
- simplify the information architecture
- fix memory trust and correction workflows
- unify the object model around recurring decision programs and brief runs
- strengthen report/action UX
- only then broaden integrations or "AI OS" ambitions

The tradeoff is clear: some breadth and feature glamour will be deprioritized. The upside is a much stronger product identity, a more trustworthy core loop, and a significantly better chance that users understand why `pai` exists.

## 2. Product Thesis

### Position

For the next 12 months, `pai` should not be positioned as a hybrid.

Externally, it should have one category:

**`pai` is an AI that keeps track of ongoing decisions and briefs you with your preferences in mind.**

Internally, `watch-and-brief` is still the right operating concept because it keeps the roadmap honest about background follow-through and recurring value.

It should be treated as an operating model, not the main user-facing label.

Two other things can remain true:

- the memory runtime is the technical moat
- a broader personal AI OS is the long-term ambition

Neither of those should lead marketing, onboarding, or product navigation right now.

### Product Thesis

`pai` should help a user set a recurring question once, then receive better answers over time because the system remembers preferences, gathers fresh evidence, and learns from correction.

The core operating loop is:

1. The user names an ongoing decision or commitment, or asks a question that reveals an ongoing decision.
2. `pai` captures durable preferences, constraints, and context.
3. `pai` gathers fresh evidence in the background on a stated cadence or when something material changes.
4. `pai` delivers a brief at the right pace for that decision, with recommendation, evidence, assumptions, and next actions.
5. The user acts or corrects.
6. `pai` improves the next brief.

What matters is not the word "watch." What matters is that the loop persists over time.

In practice, `Ask` should remain the main entry point. `pai` answers first, then offers `Keep watching this` or implicitly creates a lightweight Program when recurring value is clear.

The user should feel:

- "Keep track of this for me"
- "Remember how I make this decision"
- "Brief me at the right pace for this decision"
- "Tell me when something materially changes"
- "Do not make me restart the context every time"

Cadence should be lightweight to configure, ideally in chat. Some Programs may need multiple updates a day, some a weekly sweep, and some only a brief when something changed materially.

### Initial Beachhead

The wedge still needs tighter scope than "all recurring decisions."

For the next year, `pai` should focus on two repeatable job-story families:

- **Work programs**: ongoing decisions like vendor selection, launch readiness, competitor tracking, role search, hiring pipeline, or market monitoring
- **Personal programs**: ongoing decisions like a Japan trip, a used EV purchase, a flight window, a move, or another preference-sensitive purchase

These are not meant to be broad product modes. They are example families of the same core loop.

One-off deep analysis should exist only to seed or support a watch. It should not become a separate product category with its own surface and roadmap.

### First ICP

The first ICP should be:

- technical individual users
- information-dense daily life and work
- repeated monitoring or re-checking tasks
- high value on context continuity and remembered constraints
- willing to self-host or tolerate setup friction for better control

That positioning will invite comparison to other self-hosted assistants. The differentiation should not be "we are also self-hosted." It should be that `pai` is brief-first, memory-trust-heavy, correction-driven, and optimized for recurring decisions rather than broad assistant breadth.

Examples:

- engineers, product leaders, founders, investors, analysts, and other technical power users
- privacy-conscious users who want an AI that remembers context without handing it to a hosted consumer product

Excluded for now:

- casual consumers who want zero-setup convenience first
- enterprise teams and collaborative decision workflows
- users expecting fully autonomous end-to-end action-taking
- users who need polished mobile-native experience before they need remembered context

### What `pai` Is

- A self-hosted system for ongoing decisions, shaped internally around watch-and-brief loops.
- A memory layer that keeps durable preferences, constraints, and corrections over time.
- A background engine that turns watches into recurring briefs.
- A conversation interface for setup, repair, and follow-up.
- A local-first control center for trust, review, and action.

### What `pai` Is Not

- Not a full personal AI OS in-market.
- Not a generic research workbench.
- Not a new task manager.
- Not a broad multi-surface product where every interface gets equal emphasis.
- Not a product that keeps adding new domain types to stay interesting.
- Not a platform story first.

### Major Recommendation and Tradeoff

Recommendation: choose one public category and force the roadmap to serve it.

Tradeoff:

- You lose some short-term breadth and some contributor-facing optionality.
- You gain a product users can explain in one sentence and adopt for a recurring job.

## 3. Current State Diagnosis

### What Is Working

`pai` already has unusually strong technical foundations for the chosen wedge:

- The memory model is not shallow. It has reinforcement, contradiction handling, decay, synthesis, provenance links, and audit history.
- The background model is real. Briefings, research, swarm runs, schedules, and learning all already exist.
- The report pipeline is getting stronger. Structured rendering, artifacts, visuals, export, Telegram document delivery, and Inbox detail views are in place.
- The product is local-first and self-hosted by default, which directly supports the trust story.
- The system already treats "memory over time" as a product primitive rather than a bolt-on.

### Where the Product Is Drifting

#### 1. Surface area is too symmetric

The current navigation exposes too many top-level destinations:

- Inbox
- Grid
- Chat
- Memory
- Knowledge
- Tasks
- Jobs
- Schedules
- Timeline
- Settings

That is a platform navigation, not a product navigation. It tells the user that every internal subsystem matters equally.

#### 2. The landing story is feature inventory, not product identity

The public-facing story currently leads with a wide feature set: memory, web learning, search, deep research, tasks, code execution, multi-surface access. That describes capability breadth, but it does not answer the strategic question: why should someone adopt `pai` instead of a chatbot plus notes plus tasks plus RSS plus Telegram?

#### 3. Internal implementation nouns leak into the product

Users should care about:

- a brief
- a recommendation
- a watch or program
- a follow-up action
- a correction

Users should not need to care about:

- swarm
- job queues
- blackboards
- scheduling internals
- analysis lane pressure

Those are valuable internal systems, but they are not product nouns.

#### 4. Memory trust is stronger in the backend than in the product

Internally, the system tracks:

- belief changes
- linked episodes
- supersession relationships
- contradiction outcomes
- confidence and stability

Externally, the user mostly sees:

- statement
- type
- confidence
- edit
- forget

That gap is the biggest trust risk in the product. The system can already reason about provenance and contradictions more deeply than the UI exposes.

#### 5. The object model is fragmented

Today the user conceptually interacts with:

- threads
- beliefs
- knowledge sources
- tasks
- goals
- briefings
- research jobs
- swarm jobs
- schedules

These are all valid technical entities, but they do not reduce cleanly to a single mental model. A product with limited resources needs a much tighter top-level object model.

#### 6. Mobile is overloaded

The mobile web experience mirrors the desktop IA too closely. The bottom tab bar still implies a broad destination model, and the "More" menu carries a second wave of destinations. Telegram also carries command and report surfaces that partially duplicate web instead of clearly playing a companion role.

#### 7. CLI and MCP are strategically useful, but not equal user pillars

The CLI and MCP interfaces are good leverage:

- they make `pai` useful to power users
- they help establish the memory/runtime story
- they create distribution through coding agents

But they should not distort the primary product shape. They are leverage channels, not the main everyday experience for most users.

### Diagnosis Summary

`pai` does not have a capability deficit. It has a product concentration deficit.

The current system is richer than its identity. The next move is not "add more agentic capability." The next move is "make the existing strength legible and trustworthy."

## 4. Strategic Principles

| Principle | What It Means | Tradeoff |
|---|---|---|
| Narrow the promise | Every roadmap item must strengthen the recurring decision loop | Some interesting side features pause |
| Trust before autonomy | Provenance, correction, freshness, and explainability ship before broader action-taking | Less flashy automation in the short term |
| Background is the feature | Scheduled and triggered briefs matter more than chat cleverness | Chat may look less "magical" as a standalone demo |
| One top-level object model | The user should think in Programs and Briefs, not jobs and tools | Requires data-model and route cleanup |
| Channels have roles | Web is the control center, Telegram is the companion, CLI/MCP are power-user surfaces | Surface parity is intentionally reduced |
| Hide internal complexity | Swarm, queues, blackboards, and debug traces become advanced detail | Power users need an explicit advanced mode |
| Reports are product, not residue | Structured briefs with evidence and actions become the main artifact | More schema and rendering work |
| Memory must be governed | Beliefs need inspectable reasons, corrections, scopes, and sensitivity controls | Adds UX and data-model complexity |
| Local-first must still feel managed | Self-hosted should not mean operator-heavy or confusing | Fewer optional knobs in the main path |

## 5. North Star Product Shape

### North Star Statement

`pai` should feel like a system that keeps track of ongoing decisions, remembers what matters, and brings the next decision-ready brief without forcing the user to restart context every time.

### The First-Class Experience

For the next 12 months, the primary navigation should be:

- Home
- Programs
- Ask
- Memory
- Settings

Anything else is secondary, transitional, or advanced.

#### 1. Home

The user lands in a brief feed, not a tool gallery.

Each brief should answer:

- what changed
- why it matters now
- what `pai` recommends
- what evidence supports that recommendation
- what memory assumptions influenced it
- what the user can do next
- what to correct if the system got something wrong

#### 2. Programs

A Program is the top-level system object for recurring work.

It should not always be the first thing the user sees or configures.

Default creation flow:

1. the user asks a question in `Ask`
2. `pai` answers
3. if the question is ongoing, `pai` offers `Keep watching this`
4. the Program becomes visible after the user opts in or after the first recurring brief

Programs should be explicit in the system model and lightweight in the user experience.

Do not start with a broad template gallery or a heavy "create Program" form.

The abstraction should remain mostly implicit until value appears.

The user should usually encounter a concrete Program, not a category label.

Good examples:

- `Japan trip in October`
- `Buy a used EV this spring`
- `Project Atlas launch readiness`
- `AI SDK vendor decision`

Avoid making the primary mental model:

- `Travel Watch`
- `Work Watch`
- `Buying Watch`

Those are internal templates or onboarding shortcuts at most, not the product pillars.

Start with three lightweight template families only:

- Work
- Buying
- Travel

They should help seed a Program, not define the product.

Each Program owns:

- goal
- cadence
- relevant preferences and constraints
- source set
- last brief
- next run
- open actions
- recent corrections

Programs should absorb what is currently spread across schedules, parts of tasks/goals, and recurring research entry points.

What a Program should actually do must be obvious from the example.

Example: `Japan trip in October`

- remembers budget, airport preferences, points balances, hotel style, trip window, pace, and must-do constraints
- monitors flights, hotel pricing, seasonal demand, holidays, exchange rate, visa or entry changes, and itinerary options
- shifts phases over time from `Explore` to `Book` to `Prepare`
- sends briefs only when something changed materially or action is due
- produces outputs like: "Flights from SFO to Tokyo dropped below your $1,000 target for Oct 12-24. Based on your nonstop preference and current seasonal pricing, this is a strong booking window."

Example: `Project Atlas launch readiness`

- remembers launch date, blockers, stakeholders, release criteria, risk tolerance, and preferred escalation style
- monitors issues, docs, incidents, deadlines, dependencies, and changes in launch criteria
- notices deltas rather than repeating status noise
- produces outputs like: "The launch is no longer blocked on API reliability, but docs signoff remains open and the rollback plan is still missing. Recommendation: do not declare ready this week."

#### 3. Ask

`Ask` is chat with a narrower role than the current product gives it.

It exists to:

- create or refine a Program
- ask follow-up questions about a brief
- capture new preferences or constraints
- correct bad memory
- request a one-off deep analysis
- create an action from a brief

It should not be the main container of product value. Value should persist in Programs, Briefs, and Memory.

#### 4. Memory

Memory should become a trust console, not a searchable card gallery.

The user should be able to inspect:

- what `pai` thinks is true
- why it thinks that
- how stable it is
- what contradicted it
- what updated it
- whether it was observed, inferred, or synthesized
- how to correct it

Trust UX should follow a strict depth rule:

- default: simple explanation in plain language
- expand: deeper provenance and freshness detail
- advanced: full history, contradiction trail, and linked evidence

If trust UX skips this layering, the product will collapse into a governance console.

### The Secondary Experience

These should still exist, but not lead the product:

- Actions/task list as a transitional supporting surface
- source management as an admin/support surface
- run history and jobs as advanced detail
- diagnostics as advanced/admin
- CLI and MCP as power-user and developer leverage

Grid and Timeline should not be re-skinned or elevated as peer product surfaces. Their useful behavior should be absorbed into `Home`, Program summaries, and History so users keep the fast overview without carrying more top-level destinations.

### Mobile UX Recommendation

Mobile should focus on three jobs:

- read a brief
- respond or correct
- act on a recommendation

That implies:

- mobile web should collapse to `Home`, `Ask`, `Programs`, and `Profile`
- advanced pages should not be first-class mobile destinations
- Telegram should remain first-class as a companion delivery surface
- Telegram should prioritize notifications, quick replies, corrections, approvals, and action creation

Telegram should not try to replicate the full control plane.

Tradeoff:

- power users lose some mobile admin depth
- the product becomes much faster to understand and use on the move

### Report and Artifact UX Recommendation

Reports should become the main product artifact.

Every meaningful brief or deep analysis should use the same skeleton:

1. recommendation
2. what changed
3. evidence and citations
4. memory assumptions
5. next actions
6. optional appendix and exports

Artifacts and exports belong in the appendix, not above the recommendation.

Tradeoff:

- the schema will feel restrictive
- the restriction is necessary if briefs are going to be readable, comparable, and actionable

### Workflow Clarity Recommendation

Reduce the user-facing nouns to four:

- Program
- Brief
- Action
- Memory

Everything else is either support material or internal machinery.

| Current Product Noun | Recommended User-Facing Noun | Action |
|---|---|---|
| Briefing / Inbox item | Brief | Keep, simplify |
| Schedule | Program cadence | Fold into Programs |
| Task | Action | Fold into Briefs and Programs |
| Goal | Program objective | Fold into Programs |
| Research job / swarm job | Run | Hide behind Program history |
| Swarm | Deep analysis | Hide as internal implementation |
| Knowledge source | Source | Keep, but secondary |
| Job / blackboard | Execution details | Advanced mode only |
| Timeline | History | Fold into Memory and Program history |

## 6. North Star Technical Architecture

### Architectural Thesis

The future architecture should support one dominant product loop:

Capture -> Govern memory -> Run analysis -> Produce brief -> Act or correct -> Learn

The important correction is this:

Do **not** start with a clean-sheet architecture.

The current package architecture is good enough to support the product shift if the team makes a few focused changes. The next 180 days should be evolutionary, not a rewrite.

### Phase 1 Product Model

| Entity | Purpose | Current State | Required Change |
|---|---|---|---|
| Beliefs | Durable facts, preferences, and constraints | Already exists | Add provenance and correction metadata |
| Programs | Recurring watches | Split across schedules, tasks, briefings | Add thin `programs` layer |
| Briefs | User-facing outputs | Split across briefings and research/swarm presentation | Standardize schema before changing storage |
| Actions | Follow-through items | Currently tasks/goals | Attach to Briefs and Programs |
| Sources | External evidence references | Spread across knowledge, search, and artifacts | Link to Briefs and Beliefs cleanly |

Research jobs, swarm jobs, schedules, and raw briefing rows should remain backend implementation details in phase 1.

### Minimal Execution Architecture

#### 1. Programs as a Thin Wrapper

Add `programs` as the product object.

In phase 1, a Program can be a thin wrapper over:

- existing scheduled jobs
- linked preferences/constraints
- latest brief
- linked actions
- source references

Do not wait for a perfect unified backend model.

#### 2. Briefs Before Runs

Standardize the brief payload first.

Do not build a canonical `runs` system before the product proves it needs one. For the next phase:

- keep `briefings`, `research_jobs`, and `swarm_jobs`
- add a read model or adapter that makes them look unified in the UI
- hide the backend split from normal users

This is cheaper and safer than introducing a new top-level execution model immediately.

#### 3. Analysis Depth as a Mode Flag

User-facing execution should have two shapes:

- `answer`
- `brief`

`deep` should be a mode flag on a brief or Program run, not a separate product category.

Internally, the existing research and swarm pipelines can remain the engines.

#### 4. Memory Governance Layer

This is the moat. It needs to be upgraded from backend sophistication to visible product behavior.

For the next phase, every durable belief should carry:

- origin: `user-said`, `document`, `web`, `inferred`, `synthesized`
- evidence refs: linked episodes, source IDs, artifact IDs, or brief IDs
- confidence
- freshness
- stability
- subject
- correction state

Recommended correction states:

- `active`
- `confirmed`
- `corrected`
- `invalidated`

Do not start with a large review-state machine.

Add a simple `sensitive` flag for beliefs that touch identity, finances, credentials, or health-like personal data. Leave a more complex review model for later.

#### 5. Evidence Layer

Knowledge, web search, browser tools, and artifacts should all become evidence providers.

The product must distinguish:

- durable memory about the user
- external evidence about the world
- synthesized inferences derived from both

That distinction should appear in both storage and UI.

Do not invest in standalone knowledge-management depth until this distinction is visible in briefs.

#### 6. Presentation Layer

Keep investing in the structured report pipeline.

Every major output surface should consume the same brief contract:

- recommendation block
- what changed
- evidence list
- memory assumptions
- actions
- correction hooks
- optional visuals and appendix

#### 7. Operations Layer

Telemetry and queueing are valuable, but should remain mostly operational.

Keep:

- diagnostics
- background dispatcher
- traffic shaping
- queue visibility
- artifact retention

Expose them:

- in Settings advanced
- in admin/debug views
- in developer docs

Do not make them front-and-center user workflows.

### Constraints the Architecture Must Respect

These risks were underweighted in the original roadmap and should directly constrain implementation:

- LLM quality is uneven across providers and local setups, so the core brief loop must degrade gracefully.
- Browser, sandbox, finance, and search sidecars are optional; the product cannot require them to feel coherent.
- Self-hosted users will run partially configured systems; phase 1 must work without every advanced subsystem.
- Migration budget is small; adapters and read models are safer than canonical rewrites.
- Trust UX can become too heavy; provenance must be visible without turning the product into a governance dashboard.
- Program creation must not become workflow ceremony; the architecture has to support implicit creation from chat.

### Memory Governance, Provenance, Correction, and Trust

This is the most important architecture recommendation in the document.

`pai` only wins if users trust that:

- it remembers the right things
- it can explain why
- it changes its mind when corrected
- it distinguishes memory from inference
- it does not quietly turn weak signals into durable truths

Recommended rules:

#### Governance Rules

- Observed user preferences and durable constraints can auto-save.
- Inferred beliefs must be labeled and easier to remove than observed beliefs.
- Sensitive beliefs should not silently become durable without clear visibility.
- Synthesized meta-beliefs should never be presented as direct user facts.
- Contradicted beliefs should remain inspectable, not vanish silently.

#### Product Trust Rules

- Every recommendation should show which memories influenced it.
- Every world claim should have a source or a "not verified" label.
- Every editable memory should show its origin and last meaningful update.
- A user should be able to say "this is wrong" from any brief, chat message, memory card, or Telegram summary.

#### Correction Flow Rules

When a user corrects memory:

1. mark the old belief as corrected or invalidated
2. create the replacement belief
3. record the correction event explicitly
4. prevent the old belief from being used in future recommendations
5. show the correction in memory history and program history

Tradeoff:

- this adds product and data-model complexity
- it is still cheaper than trying to earn trust through better prompts alone

### Recommendation and Tradeoff

Recommendation: make the smallest architecture change that makes Programs and Memory Trust visible.

Tradeoff:

- some backend duplication will remain for a while
- that is preferable to stalling shipping on a full model rewrite

## 7. Core vs Secondary Capability Matrix

| Capability | Priority | Product Status | Recommendation |
|---|---|---|---|
| Memory governance and trust | P0 core | First-class | Invest heavily |
| Recurring briefs and report delivery | P0 core | First-class | Invest heavily |
| Background scheduling and follow-through | P0 core | First-class via Programs | Invest heavily |
| Chat | P0 core | First-class entry surface | Keep |
| Programs / watches / recurring contexts | P0 core | First-class | Add as primary model |
| Tasks / actions | P1 supporting | First-class only inside Programs and Briefs | Keep, narrow |
| Knowledge ingestion and retrieval | P1 supporting | Background or contextual | Keep, de-emphasize |
| Web search | P1 supporting | Invisible except citations | Keep |
| Research engine | P1 supporting | User-facing only as brief/deep analysis | Keep, rename |
| Swarm / sub-agents | P2 internal leverage | Hidden behind analysis depth | Keep, hide brand |
| Web UI | P0 core | Primary control center | Keep primary |
| Telegram | P1 companion | Companion surface | Keep, focus |
| CLI | P2 power-user | Secondary | Keep |
| MCP | P2 developer leverage | Secondary | Keep and strengthen for builders |
| Jobs page | P2 advanced | Advanced only | Hide from primary nav |
| Blackboard detail | P3 internal | Debug only | Hide |
| Timeline | P3 de-emphasize | Fold into History | Remove as top-level |
| Grid | P2 supporting | Absorb useful overview patterns into `Home` | Merge, do not keep standalone |
| Goals | P3 de-emphasize | Fold into Programs or Actions | Hide from primary path |
| Diagnostics | P2 admin | Settings advanced | Keep hidden |
| Knowledge page | P2 admin/support | Advanced or embedded in Programs | De-emphasize |

### Explicit Recommendation on Surface Prominence

Telegram, CLI, MCP, swarm, and research should not remain equally prominent.

Recommended prominence:

- Web UI: primary
- Telegram: companion first-class
- Chat: primary interaction mode within web and Telegram
- Research: execution capability, not category identity
- Swarm: internal leverage, not product category
- CLI: power-user/admin surface
- MCP: developer/platform surface

Tradeoff:

- Some existing users may miss direct access to internal systems.
- The product becomes legible to far more users.

## 8. Technical Debt and Cleanup Plan

### Cleanup Goal

The cleanup plan should remove product ambiguity by cutting surfaces and freezing low-value work, not by inventing cleaner names for everything.

### Immediate Stop-Doing List

For the next 90 days:

- no new top-level pages
- no new channel surfaces
- no new domain-specific analysis categories
- no new investment in Grid as a standalone surface
- no new investment in Timeline
- no new investment in standalone Goals
- no new investment in raw Jobs UX beyond maintenance
- no separate end-user roadmap for CLI or MCP

### A. Product Vocabulary Cleanup

Action:

- Stop leading with `swarm`.
- Stop leading with `jobs`.
- Stop leading with `knowledge` as a product category.
- Rename user-facing "research" and "analysis" around output depth, not engine type.

Specific changes:

- `Inbox` becomes `Briefs`
- `Schedules` becomes `Programs`
- `Tasks` becomes `Actions`
- `Goals` becomes `Program objectives`
- `Jobs` becomes hidden execution detail
- `Timeline` becomes history inside Memory or Program detail

Tradeoff:

- Existing docs and some UI copy need migration.
- The product language becomes far more coherent.

### B. Information Architecture Cleanup

Recommended primary nav:

- Home
- Programs
- Ask
- Memory
- Settings

Everything else moves behind:

- Program detail
- Memory detail
- advanced mode

Remove from primary nav immediately:

- Grid
- Jobs
- Schedules
- Timeline
- Knowledge
- Tasks

Tradeoff:

- Advanced users click one layer deeper.
- Most users stop facing an internal-system map on first use.

### C. Domain Model Cleanup

Action:

- introduce `programs`
- attach actions to Briefs and Programs
- unify execution history through a read model, not a new canonical table
- stop proliferating user-facing nouns without a shared top-level model

Pragmatic approach:

- do not immediately delete current tables
- do not build canonical `runs`, `recommendations`, or `evidence` systems yet
- migrate UI first and storage second

Tradeoff:

- Temporary duality in the codebase.
- Much lower migration risk.

### D. Memory Trust Cleanup

Action:

- add provenance surfaces
- add explicit correction APIs
- add confidence/freshness labels
- distinguish observed vs inferred vs synthesized beliefs
- expose belief history in UI and Telegram flows

Tradeoff:

- More complexity in memory UX.
- Massive increase in trust and debuggability.

### E. Report and Action Cleanup

Action:

- standardize every brief around recommendation, evidence, actions, correction
- make actions the primary follow-through mechanism
- make exports and artifacts secondary, not the primary interaction
- treat calendar integration as a later follow-through sink for Actions, not a phase-1 product pillar

Tradeoff:

- Requires schema discipline.
- Converts report output into a habit-forming workflow.

### F. Channel Cleanup

Action:

- Web: full control plane
- Telegram: concise delivery, correction, follow-up, approve/reject, create action
- CLI: admin and power-user workflows
- MCP: builder and agent integrations

Tradeoff:

- Less channel parity.
- More coherent channel roles.

### G. Retire / Transition / Hide

#### Retire

- Timeline as a top-level concept
- `swarm` as a public-facing noun

#### Transition

- Grid into `Home` overview patterns
- Tasks into Actions
- Goals into Program objectives
- Schedules into Programs
- Knowledge into Sources attached to Programs or Memory

#### Hide

- blackboard internals
- raw queue mechanics
- advanced diagnostics
- most jobs detail from non-advanced users

### Cleanup Rule

No feature expansion until all of these are true:

- memory correction flow ships
- primary IA is simplified
- `Ask` creates or updates Programs in the main flow instead of exposing raw schedules as the recurring abstraction
- report/action UX is standardized
- active usage is concentrated on Home, Programs, Ask, and Memory

## 9. 30 / 90 / 180 / 365 Day Roadmap

### 30 Days: Decide and Simplify

Objective: remove ambiguity about what `pai` is.

Ship:

- positioning rewrite across landing, README, onboarding, and app copy
- wireframes for `Home`, `Programs`, `Ask`, `Memory`, and `Settings` that prove complexity is actually reduced
- nav reduction to Home, Programs, Ask, Memory, Settings
- remove Grid, Timeline, Jobs, Knowledge, Schedules, and Tasks from primary nav while preserving the useful overview behavior in `Home`
- rename user-facing research/swarm language around brief depth
- define Programs as a thin product wrapper over existing schedules
- instrument trust and decision-loop metrics
- freeze new domain and channel expansion

Do not ship:

- new domain types
- new channel surfaces
- new major integrations

Tradeoff:

- Less visible momentum in breadth.
- Much higher strategic clarity.

### 90 Days: Ship the New Core Loop

Objective: make the product loop visibly better than generic chat.

Ship:

- Programs v1
- Briefs v2 with recommendation, evidence, actions, and correction hooks
- Memory provenance and correction UI/API v1
- Telegram companion flows for brief delivery and quick correction
- actions attached to Briefs and Programs
- transition standalone Tasks into supporting, not primary, UX
- chat-configurable Program cadence with at least interval-based control and a clear material-change mode

Do not ship:

- public "AI OS" expansion
- heavy third-party action integrations
- canonical `runs` architecture rewrite

Tradeoff:

- More migration work than feature launch work.
- A real product loop becomes operational.

### 180 Days: Strengthen Trust and Follow-Through

Objective: make recurring use habitual.

Ship:

- program templates for the 2-3 beachhead watch types only
- comparative brief UX with better option ranking
- freshness and provenance labels everywhere they matter
- mobile web simplification around brief reading and action
- correction history and lightweight review for sensitive beliefs
- program-linked actions and reminders, including calendar-linked follow-through if it improves completion
- advanced run history only if users actually need it

Tradeoff:

- More opinionated product behavior.
- Stronger repeat usage and trust.

### 365 Days: Expand from a Strong Center

Objective: earn the right to broaden.

Ship:

- mature watch-and-brief runtime with stable Programs, Briefs, Actions, and Corrections
- stronger developer/runtime story for MCP and agent integrations
- selective external integrations only where they strengthen follow-through
- broader platform packaging only if the core loop is already strong

Tradeoff:

- Slower platform breadth.
- A much higher chance that broader expansion is built on a real product rather than accumulated subsystems.

## 10. Metrics and Success Criteria

### North Star Metric

Use one north star metric:

**Trusted Decision Loops per Week**

Definition:

A Trusted Decision Loop occurs when a generated brief is opened and then leads to at least one of the following within 72 hours:

- the user accepts or marks the recommendation useful
- the user creates or completes an action from the brief
- the user corrects memory or evidence attached to the brief
- the user asks a follow-up tied to the same Program or Brief

Why this is the right metric:

- it measures recurring use
- it measures trust, because corrections count
- it measures follow-through, not just content consumption

### Supporting Product Metrics

| Metric | 90-Day Target | 180-Day Target | 365-Day Target |
|---|---:|---:|---:|
| Brief open rate | 60%+ | 70%+ | 75%+ |
| Trusted Decision Loop rate per generated brief | 25%+ | 40%+ | 50%+ |
| Weekly active Programs per active user | 1.5+ | 2.5+ | 3.5+ |
| Actions created from briefs | 15%+ of briefs | 25%+ | 35%+ |
| Follow-up questions on briefs | 20%+ | 30%+ | 35%+ |

### Trust Metrics

| Metric | 90-Day Target | 180-Day Target | 365-Day Target |
|---|---:|---:|---:|
| Beliefs shown in recommendations with inspectable provenance | 80%+ | 95%+ | 98%+ |
| World claims in briefs with explicit citation or "not verified" label | 90%+ | 97%+ | 99%+ |
| Median correction latency | < 1 session | < 1 hour | effectively immediate |
| 30-day reversal rate on durable auto-saved beliefs | < 15% | < 10% | < 5% |
| User-confirmed high-impact beliefs | tracked | 50%+ | 75%+ |

### Workflow Clarity Metrics

| Metric | Target |
|---|---:|
| Sessions concentrated on core surfaces (Home, Programs, Ask, Memory) | 80%+ |
| Advanced surface usage from non-advanced users | steadily down |
| Number of top-level primary nav destinations | 5 or fewer |
| New user time to first meaningful brief | under 24h in 90 days, under 2h in 180 days |

### System Metrics

| Metric | 90-Day Target | 180-Day Target | 365-Day Target |
|---|---:|---:|---:|
| Background run completion rate | 90%+ | 95%+ | 97%+ |
| Interactive p95 queue wait | < 30s | < 20s | < 10s |
| Background p95 queue wait | < 15m | < 10m | < 5m |
| Artifact/report render success | 95%+ | 98%+ | 99%+ |

### Validation Harness and Release Gates

Metrics are not enough. `pai` needs a standing validation harness because the product is memory-heavy, agent-heavy, and loop-heavy.

#### Release blockers

The following should block release for core-loop changes:

- a corrected belief still influences a later brief
- a brief is missing recommendation, evidence, or action sections in the standard schema
- provenance is absent for beliefs or claims that are surfaced in a recommendation path
- a recurring Program run fails to produce a readable brief in the default degraded environment
- a Program created from chat cannot be resumed or updated from the main surfaces

#### Warn-only signals

These should warn, not block, unless they persist:

- queue wait regressions
- lower artifact generation success when optional sidecars are enabled
- citation coverage dips on non-critical brief sections
- optional browser or sandbox failures when the brief still completes coherently

#### Evidence required before claiming progress

Do not declare a roadmap milestone complete unless there is:

- baseline and post-change product data for the relevant loop
- at least 10 realistic sample briefs reviewed for recommendation quality and trust clarity
- regression results for memory correction, recurring runs, and brief rendering
- one real user path or dogfood path showing the intended loop end to end

#### Required regression suite

The core recurring loop should have explicit checks for:

- belief correction and suppression in future context packing
- provenance presence for surfaced memories and evidence-backed claims
- brief schema completeness and rendering
- Program creation from chat and follow-up brief delivery
- degraded-mode execution with optional subsystems disabled

#### Agent feedback loop

Agent use should feed the harness, not replace it.

Use agents to:

- critique sample briefs
- identify missing citations or provenance
- classify correction handling failures
- summarize regression output into operator-facing release notes

Do not let agent-written evaluations stand alone without deterministic checks and explicit sample review.

## 11. Key Open Questions and Experiments

| Question | Experiment | Decision Threshold |
|---|---|---|
| Will users understand explicit Programs better than free-form schedules? | Test chat-created schedule flow against explicit Program creation with the same users | If Programs improve repeat use and brief follow-up, make them the primary object immediately |
| Is Telegram enough as the mobile companion, or is mobile web doing too much? | Track response and action rates for Telegram-delivered briefs versus mobile web opens | If Telegram drives materially higher response rates, optimize it as the default companion surface |
| Do users want standalone tasks and goals, or actions generated from briefs? | Compare task page usage against brief-generated action usage | If brief actions dominate, fold standalone goals deeper into the product |
| How much memory should auto-save without confirmation? | Add belief sensitivity tiers and measure correction rates by tier | If sensitive/high-impact auto-saved beliefs have high correction rates, require confirmation |
| Does showing execution detail improve trust or create noise? | Test simplified brief detail against verbose execution detail in advanced mode | Keep detailed execution behind advanced mode unless it materially increases trust without reducing action rate |
| Are domain-specific templates a growth lever or a distraction? | Launch a small set of lightweight Program templates and compare activation/completion against concrete example-led chat creation | Keep templates only if they increase Program creation and repeat brief use without becoming the primary mental model |
| Is the memory-runtime story worth productizing for developers now? | Measure MCP/CLI usage, repo interest, and builder workflows | Separate runtime packaging only after the end-user loop is coherent |
| Does public language around "ongoing decisions" outperform "watch-and-brief" wording? | Test homepage and onboarding copy variants against activation and Program opt-in | Use the language that improves comprehension and opt-in, even if internal strategy language stays different |

### Recommended Experiment Order

Run these first:

1. Programs versus schedules
2. Telegram companion versus mobile web emphasis
3. action blocks versus standalone task management
4. memory auto-save sensitivity thresholds

## 12. Final Recommendation

The product should become:

**An AI that keeps track of ongoing decisions and briefs you with your preferences in mind.**

That is the clearest wedge, the best use of the existing architecture, and the path with the highest leverage under limited resources.

For the next 12 months, do not market `pai` as a hybrid.

The product should not position itself as:

- a full personal AI OS
- a broad agent platform
- a research lab
- a developer runtime first

Those can remain true internally:

- "personal AI OS" is the long-term ambition
- "memory runtime for agents" is the technical architecture and developer leverage story
- "watch-and-brief" is the internal product-shaping concept
- "ongoing decisions with your preferences in mind" is the better default external framing unless usage testing says otherwise

### Focused Product Cuts

#### 1. Make Programs, Briefs, Ask, and Memory the only first-class product loop

Why:

- they form a coherent recurring loop
- they map to the strongest existing systems
- they create a habit-forming product

Tradeoff:

- some current pages lose prominence

#### 2. Hide research/swarm mechanics behind one brief-depth concept

Why:

- users want good answers and good briefs, not orchestration vocabulary

Tradeoff:

- some implementation detail becomes less visible

#### 3. Keep Telegram, but only as a companion

Why:

- mobile matters for recurring brief delivery and quick responses
- Telegram is already a strong leverage surface

Tradeoff:

- Telegram will not mirror the entire web app

#### 4. Keep CLI and MCP, but stop letting them shape the core product

Why:

- they are valuable distribution and power-user leverage
- they reinforce the memory/runtime story

Tradeoff:

- they stop shaping the everyday-product IA

#### 5. Pause expansion until the trust loop works in the beachhead use cases

Why:

- new features added into a diffuse shape will deepen drift

Tradeoff:

- short-term roadmap looks more like refinement than expansion

### Bottom Line

`pai` should treat the next 12 months as a focus window, with the visible product cutover happening in the next 60-90 days and the rest of the year spent proving the recurring loop in real use.

That means:

- fewer nouns
- fewer top-level surfaces
- more trust
- more background follow-through
- more actionability
- better mobile companionship
- clearer product concentration

If the product cannot produce repeat trusted decision loops in the beachhead use cases by day 180, it should not broaden into AI OS or runtime packaging work.

---

## Founder Memo

Stop trying to prove that `pai` can do everything.

It already has enough technical substance to impress the wrong audience. The next challenge is to become obvious and indispensable to the right audience.

The product's most differentiated truth is not that it has chat, tasks, knowledge, Telegram, MCP, swarms, and CLI. Plenty of projects can assemble that list. The differentiated truth is that `pai` can know a user's durable preferences, revisit them over time, gather fresh evidence in the background, and turn that into recurring guidance.

That is a real product.

Do not let the technical architecture dictate the product narrative. The plugin system, background dispatcher, blackboard, and telemetry are real strengths. They are not the reason a user adopts `pai`.

The user adopts `pai` if it can answer:

- "What should I pay attention to now?"
- "Why do you think that?"
- "Did you remember what matters to me?"
- "Can I correct you when you're wrong?"
- "Will you keep watching this for me?"

If `pai` can do those five things reliably, you have a wedge.

If you keep broadening the surface area before tightening that loop, the product will stay technically impressive and strategically blurry.

Pick the wedge. Kill the symmetry. Make trust visible.

## Team Alignment Memo

For the next 90 days, the team is not building a broader AI platform.

The team is building a clearer and more trustworthy recurring decision product.

This changes how we evaluate work:

- A feature is good if it strengthens the Program -> Brief -> Action/Correction loop.
- A feature is bad if it adds another peer surface, another internal noun, or another category that the user has to understand.
- Memory work is product work, not backend work.
- Report UX is product work, not rendering polish.
- Mobile and Telegram work are product work, not distribution edge cases.

Default questions for every proposal:

1. Does this make `pai` better at recurring decision support?
2. Does this improve trust, provenance, correction, or follow-through?
3. Does this reduce or increase product ambiguity?
4. Could this remain internal leverage instead of a first-class surface?

If the answer to those questions is weak, the work should probably wait.

## Cleanup Checklist

- [ ] Rewrite product positioning across landing page, README, onboarding, and docs
- [ ] Replace public-facing "swarm" language with brief depth or deep analysis wording
- [ ] Replace public-facing "jobs" with hidden execution detail or advanced run history
- [ ] Add first-class `Programs` as a thin wrapper over schedules
- [ ] Make Program creation implicit from chat wherever possible
- [ ] Reduce primary navigation to five or fewer items
- [ ] Remove Grid from primary navigation
- [ ] Remove Tasks from primary navigation
- [ ] Remove Knowledge from primary navigation
- [ ] Remove Schedules from primary navigation
- [ ] Remove Jobs from primary navigation
- [ ] Remove Timeline from primary navigation
- [ ] Freeze new top-level pages, new channels, and new domain categories for 90 days
- [ ] Fold Goals into Program objectives or Actions
- [ ] Add memory provenance UI
- [ ] Add explicit memory correction workflow
- [ ] Add observed/inferred/synthesized labeling for beliefs
- [ ] Add belief history and supersession visibility
- [ ] Add memory-influence section to briefs
- [ ] Standardize brief schema around recommendation, evidence, actions, correction
- [ ] Attach actions directly to Briefs and Programs
- [ ] Simplify Telegram into notify, reply, correct, approve, act
- [ ] Define and instrument Trusted Decision Loops metric
- [ ] Add release blockers, warn-only signals, and recurring-loop regression checks
- [ ] Keep CLI and MCP on maintenance plus leverage work, not core product IA work

## 90-Day Execution Plan

### Stream 1: Product Cutover

Milestones:

- Days 1-3: lock positioning, user-facing nouns, and primary nav
- Days 3-7: produce wireframes for `Home`, `Programs`, `Ask`, `Memory`, and `Settings`, including how `Grid` use cases collapse into `Home`
- Week 2-3: rewrite landing, README, onboarding, and in-product copy
- Week 2-6: remove Grid, Timeline, Jobs, Knowledge, Schedules, and Tasks from primary nav
- Week 5-8: introduce `Programs` as the primary recurring object
- Week 8-12: route recurring creation flows through Programs, not schedules

Exit criteria:

- users can explain `pai` as an AI that keeps track of ongoing decisions and briefs them with their preferences in mind
- primary nav is Home, Programs, Ask, Memory, Settings
- `Ask` remains the main creation entry point, while recurring setup and follow-through resolve to Programs rather than raw schedules

### Stream 2: Trust Loop

Milestones:

- Week 1-3: define provenance fields and simplified correction states
- Week 3-6: ship Briefs v2 with recommendation, evidence, memory assumptions, and actions
- Week 5-8: ship Memory Trust UI with origin, freshness, and history
- Week 7-10: add correction entry points from Briefs, Ask, and Memory
- Week 9-12: ensure corrected beliefs stop influencing future briefs immediately

Exit criteria:

- every major brief shows why it reached its recommendation
- users can correct memory from the main surfaces
- corrected beliefs are suppressed in future recommendation paths

### Stream 3: Companion, Validation, and Measurement

Milestones:

- Week 1-2: define Trusted Decision Loops and a minimal trust metric set
- Week 2-5: instrument key events across web and Telegram
- Week 2-6: define release blockers, warn-only signals, and the recurring-loop regression pack
- Week 4-8: simplify Telegram into notify, reply, correct, and act
- Week 6-10: add sample-brief review workflow and degraded-mode checks
- Week 8-12: validate the two beachhead watch types with real usage

Exit criteria:

- north star and trust metrics are live
- Telegram supports brief consumption and correction cleanly
- the team has baseline data for brief opens, actions, and corrections
- release gates exist for memory correction, brief completeness, and recurring Program execution

### 90-Day Milestone Summary

By day 90, `pai` should be able to demonstrate one clean loop:

1. A user creates a Program.
2. `pai` remembers relevant preferences and constraints.
3. `pai` runs analysis in the background.
4. `pai` delivers a brief with recommendation, evidence, and action.
5. The user acts or corrects.
6. The next brief reflects that correction.

If that loop does not work, no new domain types, new channels, or platform expansion should be prioritized.
