# Beast Mode Changelog

All notable changes to the Beast Mode plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [4.1.1] - 2026-07-18

Patch release. Replaces the per-agent effort ladder with **three effort presets** — `Max` (default, recommended), `High`, and `Medium` — tuned against the latest DeepSWE benchmark results. A single question at setup now sets how hard the high-leverage `opus` agents (solution-architect, advanced dev, reviewers) think; standard dev agents run on `sonnet` @ `high` in every preset. **Backwards-compatible:** existing installed agents are untouched until you re-run setup/upgrade.

### Changed

- **`/install-beast-mode` Step 4b** now asks a single "effort preset" question (`Max` → `opus` @ `max`, `High` → `opus` @ `xhigh`, `Medium` → `opus` @ `high`) instead of the two-step "pick MAX, then derive standard-dev effort" flow. Standard dev agents are fixed at `sonnet` @ `high`. The downstream `<MAX>`/`<DEV>` placeholders used in agent creation are unchanged, so agent frontmatter is written exactly as before.
- **`/upgrade-beast-mode`** mirrors the same preset question for the v2 → v3 agent migration.
- **Docs** — `agent-structure-example.md` (Model & Effort Policy) and the `solution-architect` template now describe the preset model. Dropped `ultracode` and the "2 steps below MAX" derivation from Beast Mode's effort guidance; the `Max` preset tops out at `max`.

---

## [4.1.0] - 2026-07-17

Minor release. Extracts Beast Mode's browser dashboard out of the Discord bot into a standalone, reusable, infrastructure-agnostic package — **`@beast-mode/web`** — adds a lightweight standalone server plus two plugin commands, and adds `/autorun-feature`. **Backwards-compatible:** the bridge-served dashboard, every `/api/*` contract, the `/auth/*` OAuth2 flow, and the desktop MCP server are unchanged; existing installs are untouched.

### Added

- **`@beast-mode/web` — reusable web-app package** (new repo-root `/web`). One package, three subpath exports: `@beast-mode/web/backend` (the dashboard's route handlers + feature/bug stores behind an injected `ProjectProvider` + optional `AuthMiddleware` — no bot/Discord/registry coupling and no module-global state), `@beast-mode/web/frontend` (the React dashboard behind `<BeastWebProvider>` with injectable API-client / auth / routing adapters; React·ReactDOM·react-router-dom as peers; Tailwind shipped as a preset + a prebuilt `@beast-mode/web/styles.css`), and `@beast-mode/web/server`. Built dual ESM+CJS with types (`publint` + `@arethetypeswrong/cli` clean); publish-ready but consumed locally in v1.

- **Standalone dashboard server** (`@beast-mode/web/server` + the `beast-web` CLI) — a lightweight Hono app that serves the dashboard on its own from a `.env` (`BEAST_PROJECTS`, `PORT`, `BEAST_HOST`, optional `BEAST_TOKEN` bearer gating), single- and multi-project, running under Node (`@hono/node-server`) or Bun. Filesystem state only; no database.

- **`/setup-web-app`** — plugin command that discovers the Beast Mode projects on your machine (or asks where to look), writes a `.env`, and installs an always-on background service for the standalone dashboard via your OS's service manager (launchd / `systemd --user` / Task Scheduler·NSSM·pm2). Idempotent; localhost-bound by default.

- **`/integrate-web-app`** — plugin command that scaffolds a `requirements.md` to embed the dashboard into your own app (detecting an admin section, placing the feature inside a dev-ops-like epic if one exists) and hands off to `/plan-feature`. Writes no implementation.

- **`/autorun-feature [feature-name]`** - Autonomously run a feature to completion with minimal human intervention, stopping only when genuinely blocked. Epic-aware and fully project-agnostic (`<epic>/<feature>` resolution; no hardcoded stack, tooling, agents, or URLs). Runs the whole lifecycle: if there's no `implementation.md` it plans from `requirements.md` via `/plan-feature` (batching any material scope gaps into a single question) and scaffolds docs via `/start-feature`, then drives the phase-by-phase loop from `tasks.md`. For each incomplete phase it delegates the implementation to an agent (one at a time, advanced tier for load-bearing / plan-flagged phases), runs the project's type-check/build/test gate, verifies user-facing UI via a browser MCP, updates `tasks.md`/`context.md`, commits the phase, then runs `/review-feature` and fixes every `CR-N` finding before moving on. After the final phase it does a cross-phase `/review-feature`, `/update-feature`, and `/update-master`. Strict safety rails: it commits locally on the feature branch only (never the main/default branch, tags, deploy, or release) and **stops before pushing** — it hands the branch back for the user to push / open the PR. Stops and prompts the user on any blocker (MCP unreachable, repeated gate failure, missing credential/prerequisite, irreversible/outward-facing action, merge conflict). Resumable: re-running it picks up from the first incomplete phase. Composes the existing `/plan-feature` -> `/start-feature` -> `/proceed` -> `/review-feature` -> `/update-feature` -> `/update-master` commands into one hands-off run. Also available over the Discord bridge as `/beast autorun [feature]`.

### Changed

- **The Discord bot is now a consumer of `@beast-mode/web`.** The bot's seven backend modules (`api-projects` / `api-features` / `api-epics` / `api-bugs` / `api-git`, `feature-store`, `bug-store`) and its `bot/web/src` React app were removed; `bot.ts` now mounts `@beast-mode/web/backend` — injecting its project registry as a `ProjectProvider` and its Discord OAuth2 as the auth gate — and `bot/web` is a thin shell around `@beast-mode/web/frontend`. Internal refactor only: the bridge-served dashboard, every `/api/*` URL and response shape, the `/auth/*` OAuth2 flow, and the desktop MCP server's contract are all unchanged.

---

## [4.0.0] - 2026-06-16

---

Initial public release

---

## [3.1.1] - 2026-06-05

---

### Fixed

Added type-awareness to various commands

## [3.1.0] - 2026-06-04

Minor release. Adds **epics** — the ability to group related features into a single folder under `docs/features/<epic>/`. Introduces four new commands, retrofits epic-awareness into all 19 existing slash commands without changing how they work for plain features, and adds a grouping suggestion to `/upgrade-beast-mode`. **Fully backwards-compatible:** with no epics in a project every command behaves identically to v3.0.0.

### Added

- **`/create-epic <name> <prompt>`** — Migrate existing prefixed features (e.g. `editor-base`, `editor-ux`) into an epic folder. Discovers candidate features by prefix/theme, computes the full plan (folder moves + un-prefixing + reference rewrites + master-overview migration), and requires an explicit preview/confirm via `AskUserQuestion` before touching a single file. Surfaces rename collisions and over-generic names (e.g. bare `base`) for the user to resolve; confirms nothing silently. After confirmation: moves folders with `git mv`, rewrites references, creates `epic-overview.md` from the template, and migrates `docs/overview.md` to a single epic row (targeted Edits only — never a whole-file rewrite).

- **`/plan-epic <name> [prompt]`** — Plan an epic from scratch. Reads `epic-requirements.md` if present (re-run = refine, not error), otherwise uses `<prompt>` or asks. Works with the user at the epic level to agree on the feature set and build order, then creates `epic-overview.md`, `epic-requirements.md`, and ordered feature subfolders each with a `requirements.md` in the exact shape `/plan-feature` consumes. Handoff lists the exact `/plan-feature <epic>/<feature>` commands in build order.

- **`/update-epic [name]`** — Refresh an epic's `epic-overview.md` (Features table, Build Order, Integration notes, Master Overview Rollup, timestamp) from session context or `git log` since the last update, then updates the epic's single rollup row in `docs/overview.md`. Uses targeted Edits only; the Tech Debt / Findings section is explicitly read-only here (owned by `/review-epic`).

- **`/review-epic <name>`** — Holistic cross-feature architecture/integration review of an epic (distinct from `/review-feature <epic>`, which is a deep code pass). Reads `epic-overview.md` + every child feature's docs; produces cross-feature integration/architecture findings and per-feature tech-debt items; writes them via targeted Edits into `epic-overview.md`'s Tech Debt / Findings section and into affected child `context.md` files.

- **Epic folder model** — An epic lives at `docs/features/<epic>/`, contains an `epic-overview.md` marker (the single machine-detectable signal), and holds one or more feature subfolders (`implementation.md` / `context.md` / `tasks.md`). Epics do not nest; `<epic>/<feature>` is the deepest reference path.

- **`templates/formats/epic-resolution.md`** (installed to `.claude/epic-resolution.md`) — the single source of truth for epic detection (marker rule), reference resolution (`<epic>/<feature>` slash; bare epic name; fuzzy fallback for a bare feature name not at the top level), epic-context-loading rule, and the `/create-epic` reference-rewrite convention. All 23 commands point to this file via a small, standard "Epic awareness" block; no epic logic is duplicated across commands.

- **`templates/dev-docs/epic-overview.md`** — template for the `epic-overview.md` marker file (Purpose, Features table, Build Order/Dependencies, Integration & Architecture, Tech Debt/Findings, Master Overview Rollup, timestamp).

- **`templates/dev-docs/epic-requirements.md`** — template for epic-level requirements (mirrors the per-feature `requirements.md` shape plus a Planned Features build-order list).

### Changed

- **All 19 existing slash commands are now epic-aware** via a standard "Epic awareness" block that instructs Claude to read `.claude/epic-resolution.md` and apply its rules. Changes are additive (zero deletions in the 15 retrofitted files), gated on the presence of `epic-overview.md`, and verified backwards-compatible:
  - `continue-feature` — adds whole-epic summary mode (bare epic name → read `epic-overview.md` + all child statuses, summarize, suggest next steps) and feature-in-epic context load.
  - `plan-feature` — loads epic context (epic-overview + all sibling `implementation.md`/`context.md`) before planning when the target is inside an epic; passes that context into the solution-architect prompt.
  - `start-feature` — resolves `<epic>/<feature>` to the nested path; loads epic context.
  - `proceed`, `proceed-advanced` — resolve the current feature's nested path.
  - `update-feature` — resolves `<epic>/<feature>`; auto-detect may land on a nested feature.
  - `update-master` — epics roll up to one row (reads `epic-overview.md` Master Overview Rollup; child features are never listed individually); flat index buckets an epic as one aggregate entry.
  - `review-feature`, `review-ux`, `review-ui`, `review-mobile` — each gained an Epic-scope mode: when the target is an epic, review runs across all the epic's features with per-feature attribution preserved (namespaced finding IDs, one aggregated report per command).

- **`/upgrade-beast-mode`** — added **Step 10c** (epic migration suggestion): after the v3 migration step, scans `docs/features/*` for prefix-sharing groups (≥2 features sharing a `<prefix>-` stem; skips dirs that are already epics). For each group found, suggests running `/create-epic <prefix> ...` via `AskUserQuestion` (default: "Remind me later"). Never runs `/create-epic` automatically; declining leaves everything working exactly as before. Silent when no prefix-sharing groups are found.

- **`/install-beast-mode`** — Step 9 summary now lists the four epic commands.

### Out of Scope / Deferred

- **Web App epic support** and **Discord bridge epic support** — the `epic-overview.md` marker design accommodates these (both will use the same `test -f` contract), but the implementations are deferred to a later feature. Existing Web App and Discord bridge functionality is unchanged.
- **Nested epics** — by design, epics contain features only (no sub-epics). `<epic>/<feature>` is the deepest reference path.

---

## [3.0.0] - 2026-06-02

Major release. Adds per-agent **model + effort tuning**, a second **"advanced" tier** of dev agents, smarter `/proceed` routing, the new `/proceed-advanced` command, optional **`/deep-research`** integration, and a new set of review commands. **Existing projects must run `/upgrade-beast-mode`** to migrate their agents (the upgrade asks for effort levels, adds `effort` fields, and creates the advanced agents).

### Added

- **Agent effort system** — every agent now carries an `effort` field (`low` → `medium` → `high` → `xhigh` → `max` → `ultracode`, the last being opus-only). `/install-beast-mode` and `/upgrade-beast-mode` ask the user for a **MAX effort level** (recommend `ultracode`, with a token-cost warning) and derive the standard dev-agent default at **2 steps below MAX** (user-adjustable).
  - **solution-architect** → `model: opus` at the chosen MAX (architecture is the highest-leverage work; do it at full strength so the plan carries the load)
  - **standard dev agents** (`frontend-dev`, `backend-dev`, …) → `model: sonnet` at 2-below-MAX
  - **review & evaluation agents** (code review, PR review, `/evaluate-feature`) → `model: opus` at MAX

- **Advanced dev agents** — setup/upgrade now creates a heavyweight `*-advanced` variant for every standard dev agent (e.g. `frontend-dev-advanced`), running `model: opus` at MAX effort. For major refactors, integration-heavy work, and high-risk phases.

- **`/proceed-advanced`** — new command. Like `/proceed` but **forces the advanced (opus, max-effort) agents** and runs **exactly one phase, then stops** so the user decides whether the next phase also warrants advanced agents. Works for both the implementation and code-review workflows.

- **`/deep-research` integration** (optional, always asks first) — leverages Claude Code's deep-research command to reduce hallucination on external facts:
  - **solution-architect** uses it when the main thread asks (e.g. comparing libraries, standards, competitors), citing verified findings in Key Technical Decisions
  - **`/plan-feature`** identifies when a feature hinges on external knowledge and offers to research before scoping — or to delegate the research to the solution-architect
  - **`/suggest-feature`** offers it when there's no clear next-feature signal and the decision depends on competitors/industry standards

- **`/review-ui`** — new command (contributed by @FACTERINVURT). Reviews UI code with a **Live Browser Audit** pattern and live MCP-driven inspection of the running app.

### Changed

- **`/proceed`** now assesses each phase and, for **major refactors / integration-heavy / high-risk** phases, **asks the user** before switching to an advanced agent — naming the specific reasons and noting the higher token cost. Routine phases continue to use the standard agent silently.

- **`/review-ux`** substantially enhanced (contributed by @FACTERINVURT) — persona-first flow, scoring rubrics, a friction inventory, and a live MCP audit of the running UI.

- **`/review-feature`, `/review-ui`, `/review-ux`** gained a **three-way boundary table** (contributed by @FACTERINVURT) clarifying what each review command covers vs. the others, so the three stay complementary rather than overlapping.

- **`/evaluate-feature`** now spawns its independent evaluator on opus at maximum effort (a weak evaluator rubber-stamps weak work).

- **`agent-structure-example.md`** documents the new `effort` field, the Model & Effort Policy table, the 2-steps-below-MAX ladder, and an advanced-agent example.

- **`/upgrade-beast-mode`** gained a **v2 → v3 migration step** that asks for effort levels, edits existing agents' frontmatter in place (preserving custom system prompts), creates the `*-advanced` variants, and installs `/proceed-advanced`.

### Breaking Changes

- Agents created before v3 have no `model`/`effort` tuning and no advanced tier. They keep working, but `/proceed-advanced` and the advanced-agent routing in `/proceed` require the v3 migration. **Run `/upgrade-beast-mode`** to migrate — it preserves your custom agent prompts and only updates frontmatter.

---

## [2.8.1] - 2026-05-07

### Added

- **`/install-statusline`** — One-shot deploy of the Beast Mode statusline into `~/.claude/settings.json`
  - **Line 1** — `📁 folder 🌿 branch +staged ~modified ?untracked` with cyan/green/yellow/red coloring; cached for 5s per session and invalidated on cwd change
  - **Line 2** — `🧠 context  ⏳ 5h-limit reset-in  📅 7d-limit reset-in` progress bars with green/yellow/red thresholds at 70/90% and compact countdowns (`25m`, `3h45m`, `5d12h`)
  - Anchored to `workspace.project_dir`, not `cwd`, so the statusline stays put when Claude's working directory changes
  - Rate-limit segments are skipped when `rate_limits` is absent (free tier)
  - Script (`scripts/statusline.sh`) runs standalone for iteration: falls back to `docs/status.json` when stdin is empty or a TTY
  - Command merges via `jq` (preserves other settings fields) and writes the resolved absolute script path so `${CLAUDE_PLUGIN_ROOT}` doesn't need to be set when the statusline is later spawned

---

## [2.8.0] - 2026-04-20

### Added

- **`/review-pr [PR-number]`** — Independent PR review with two modes
  - **GitHub-PR mode** (PR number given) — clean-repo preflight, checkout the PR branch, full review with build verification, structured findings, selective `gh pr comment` posting, deferred items written to `docs/features/<feature>/pr-notes.md` for post-merge follow-up
  - **Pre-submit mode** (no PR number) — lighter review of local changes, offers to fix findings in place, enforces `feat/<feature-name>[/<suffix>]` branch naming, rebases against `origin/main`, creates the PR via `gh pr create`
  - **Context gate** — refuses to run if the session already has substantial prior work, so the review stays unbiased (user is prompted to `/clear` and re-run)
  - Discord: exposed as `/beast review-pr` with optional `pr` string option
  - Taxonomy: Blockers → Security → Architecture → Test coverage → Smaller issues
  - Never auto-posts: user always selects which findings become PR comments

---

## [2.6.0] - 2026-03-30

### Added

- **`/evaluate-feature`** - Evaluate a feature against its acceptance criteria using a fresh evaluator agent
  - Implements the **generator/evaluator separation** pattern from Anthropic's agentic design research
  - Spawns an independent agent with clean context (no implementation bias) to verify the feature works
  - Evaluates against the Definition of Done criteria in `implementation.md`
  - Reads actual source files and runs tests — doesn't just check documentation
  - Produces `evaluation.md` with structured report: criteria tables with PASS/FAIL verdicts, file:line evidence, issues with severity
  - Three verdicts: **PASS** (100%), **PARTIAL** (60-99%), **FAIL** (<60%)
  - On PARTIAL/FAIL, creates new tasks in `tasks.md` for failing criteria
  - Distinct from `/review-feature` (code quality) — this checks feature completeness and correctness

- **Definition of Done** section in implementation plan template
  - Three criteria categories: Functional, Quality, Integration
  - Verification Method with step-by-step evaluator instructions
  - Designed to be testable by an independent agent with no implementation context

- **Quality Bar** section in implementation plan template
  - Production-grade quality descriptors across UI, Code, and Integration dimensions
  - Shapes output quality from the first iteration (inspired by Anthropic's finding that aspirational language in criteria improves results even before evaluation feedback)

### Changed

#### Enhanced `/plan-feature`
- **NEW:** Solution-architect now generates **Definition of Done** acceptance criteria as part of every implementation plan
- **NEW:** Solution-architect tailors the **Quality Bar** descriptors to the feature type (UI-heavy, backend, full-stack)
- Acceptance criteria must be specific enough for an independent evaluator to verify without implementation context

---

## [2.5.0] - 2026-03-24

### Added

- **`/fix-bug`** - Fix a specific bug by ID
  - MCP-first with silent fallback to direct `docs/bugs/*.md` file I/O
  - Loads linked feature context (`implementation.md`, `context.md`) automatically
  - Status management: `open` → `in-progress` → `closed` with user confirmation
  - Graceful error handling: missing bugs, already closed, missing feature context

- **`/fix-feature`** - Fix all open bugs linked to a feature (or all bugs if no feature specified)
  - Groups bugs by `linkedFeature`, sorts by priority (critical → high → medium → low)
  - Loads feature context per group for informed fixes
  - Group-then-confirm workflow: fixes all bugs in a feature, asks user to test once per group
  - "All" mode processes every open bug, unlinked bugs last
  - Supports partial rejection: close confirmed bugs, leave broken ones in-progress
  - Final summary of all bugs fixed, remaining, and errors

- **Discord bot commands** for bugfix workflows
  - `/beast fix [feature]` — maps to `/fix-feature`
  - `/beast fix-bug <bug>` — maps to `/fix-bug`

---

## [2.3.0] - 2026-03-19

### Added

- **`/suggest-feature`** - Suggest the next feature to develop based on project state
  - Reads `CLAUDE.md`, `docs/mission-statement.md`, `docs/technical-design.md`, and existing feature docs
  - Determines current development phase from project docs or assesses project maturity
  - Presents 2-4 feature suggestions with a recommended pick
  - Creates `requirements.md` for the chosen feature, feeding into `/plan-feature`
  - Gracefully handles missing docs files

- **`/update-master`** - Update project master overview with latest feature progress
  - Syncs `docs/overview.md` with individual feature docs in `docs/features/*/`
  - Scans all features for changes by comparing "Last Updated" timestamps
  - Can focus on a single feature (`/update-master feature-name`) or scan all
  - Extracts task counts, completion percentages, decisions, and integration points
  - Maintains a versioned changelog in the overview
  - Auto-creates `docs/overview.md` with full feature status table if it doesn't exist
  - Checks git log for changes not yet reflected in feature docs
  - Adapted from a community contribution (KuraFlow project) into a generic, project-agnostic command

### Changed

#### Dynamic Template Installation
- **FIXED:** `install-templates.sh` no longer hardcodes filenames — now dynamically copies all files from each template directory
  - Fixes 4 missing commands on fresh install (`document-feature`, `proceed`, `review-feature`, `audit-feature`)
  - Root cause: script referenced nonexistent `update-skills.md`, causing `set -e` abort before remaining commands were copied
  - New templates added to the plugin are now automatically installed without touching the script

#### Skills Philosophy — No Speculative Skills
- **CHANGED:** `/install-beast-mode` no longer generates skills or skill-rules during initial setup
  - Skills are strictly for documenting **existing, implemented code** — not aspirational patterns
  - Dev-ops plan now initializes an empty `skill-rules.json` instead of creating skills from scratch
  - Skills are created incrementally using `/document-feature` as features are completed
  - Agents (solution-architect + dev agent) are still created during setup

#### Enhanced `/plan-feature`
- **IMPROVED:** Now checks for `docs/features/<feature-name>/requirements.md` when no requirements are provided in the prompt
  - Seamlessly picks up requirements created by `/suggest-feature`
  - Workflow: `/suggest-feature` → pick feature → `/plan-feature <name>` uses existing requirements

#### Enhanced `/upgrade-beast-mode`
- **FIXED:** No longer exits early when versions match — now checks for missing files even when up to date
  - Replaced hardcoded file lists with dynamic template directory enumeration
  - Ensures files added in patch releases are not missed

### Fixed

- Removed stale `/dev-docs-update` references (renamed to `/update-feature` in v2.0)
- Removed phantom `update-skills.md` reference from install script (command was replaced by `/document-feature` in v2.1.0)

---

## [2.2.0] - 2026-02-12

### Added

- **`/review-feature`** - Review a feature's code against Vercel best practices
  - Reviews all key files from `context.md` against Vercel React Best Practices and Composition Patterns skills
  - Checks rules organized by priority: CRITICAL (bundle/async), HIGH (composition), MEDIUM (re-renders, rendering, React 19), LOW-MEDIUM (JS performance)
  - Writes findings to `docs/features/<feature-name>/code-review.md` with severity, rule, file, problem, fix, and effort for each finding
  - Documents what's already good alongside findings
  - Creates a Recommended Fix Order table sorted by impact-to-effort ratio
  - Includes a Progress checklist for tracking resolved findings
  - Resumes from existing `code-review.md` if one already exists
  - Integrates with `/proceed` for iterative fix implementation

### Changed

#### Enhanced `/proceed` Command
- **NEW:** Now supports two workflows: **Implementation** and **Code Review**
  - **Implementation workflow** (default): Uses `tasks.md` as before
  - **Code review workflow**: Activates when `/review-feature` was run earlier in the conversation
- Code review workflow features:
  - Picks up the next unchecked finding from `code-review.md` Progress section
  - Groups related fixes that affect the same file into a single agent task
  - Spawns agents with full context (CR number, file, problem, fix, Vercel rule)
  - Marks findings as resolved and updates status after each fix
  - Auto-continues for LOW/MEDIUM severity items, suggests testing for CRITICAL/HIGH
- Workflow detection based on most recent feature command in conversation history

---

## [2.1.1] - 2025-12-12

### Changed

#### Enhanced `/discover-feature` Command
- **NEW:** Now creates `context.md` and `tasks.md` stubs alongside `implementation.md`
  - `context.md` - Context stub marked as "Documented (Existing Feature)"
  - `tasks.md` - Task stub with original implementation marked complete
- **NEW:** Identifies reusable patterns during discovery and suggests `/document-feature`
  - Shows "REUSABLE PATTERNS IDENTIFIED" section in summary when applicable
  - Adds option 5 to run `/document-feature` for skill extraction
  - Only suggests when generalizable patterns are found
- Updated example workflow to reflect new output format
- Improved handling of partially documented features

---

## [2.1.0] - 2025-12-10

### Changed

#### Replaced `/update-skills` with `/document-feature`
- **REMOVED:** `/update-skills` command
- **ADDED:** `/document-feature` command - A more comprehensive approach to extracting reusable knowledge from features

### Added

- **`/document-feature`** - Document reusable skills and patterns from completed features
  - Works with context from `/continue-feature` or accepts feature name argument
  - Analyzes features for reusable patterns, systems, and gotchas
  - Creates/updates skills in `.claude/skills/` using progressive disclosure pattern
  - Updates `skill-rules.json` for auto-activation via keywords
  - Follows the same workflow as Cursor's document-feature command but adapted for Beast Mode
  - Only documents patterns that will help future features (not feature-specific details)
  - Removes outdated/deprecated patterns instead of marking them deprecated

### Removed

- **`/update-skills`** - Replaced by the more comprehensive `/document-feature` command

---

## [2.0.1] - 2025-12-10

### Fixed

- **skill-rules.template.json:** Updated JSON structure to match what skill-reminder.ts hook expects (`skills` object with `promptTriggers.keywords` format instead of `rules` array)

### Added

- **`/proceed`** - New slash command to continue work on the current feature using agents for implementation
  - Continues from where `/start-feature` or `/continue-feature` left off
  - Uses agents for implementation (one at a time, not parallel)
  - Prompts for user testing when frontend UI changes are made
  - Updates `tasks.md` and `context.md` between phases

---

## [2.0.0] - 2025-12-08

### 🎯 Major Simplification - Unified docs/features/ Structure

This release removes the `/dev` folder entirely and consolidates everything into `docs/features/`. This makes Beast Mode compatible with both Claude Code and Cursor workflows interchangeably.

### Breaking Changes

#### Removed `/dev` Folder Structure
- **REMOVED:** `/dev/active/` - features in progress
- **REMOVED:** `/dev/completed/` - completed features  
- **REMOVED:** `/dev/templates/` - doc templates
- **NEW:** All features now live in `docs/features/` only
- **NEW:** Templates moved to `.claude/templates/`

#### Slash Command Changes
- **RENAMED:** `/dev-docs-update` → `/update-feature`
- **CHANGED:** `/start-feature` no longer copies plan, just creates context.md and tasks.md
- **CHANGED:** `/start-feature` sets implementation.md status to "In Progress"
- **CHANGED:** `/continue-feature` loads from `docs/features/` and uses `implementation.md` (not `plan.md`)
- **CHANGED:** All commands updated to use `docs/features/` paths

### Migration

#### Automatic Migration
When upgrading from v1.x to v2.0.0, run `/upgrade-beast-mode`:
1. Copies all features from `/dev/active/` → `docs/features/`
2. Copies all features from `/dev/completed/` → `docs/features/`
3. Renames `plan.md` → `implementation.md` for each feature
4. Deletes old `implementation.md` files (v1 had both, v2 only needs one)
5. Creates backup in `.claude/.beast-mode-backup-*/dev/`
6. Deletes `/dev` folder after confirmation

#### Migration Script
Alternatively, run the migration script directly:
```bash
bash ~/.claude/plugins/beast-mode/scripts/migrate-v1-to-v2.sh
```

### Added

- **Migration script:** `scripts/migrate-v1-to-v2.sh` for automated v1 → v2 migration
- **New template location:** `.claude/templates/` for context.md, tasks.md templates
- **Simplified workflow:** Single source of truth in `docs/features/`

### Changed

#### Workflow Simplification
- Features stay in `docs/features/` throughout their lifecycle
- No more moving between `dev/active/` and `dev/completed/`
- Feature completion tracked by implementation.md status field
- Simpler mental model: one location for all feature docs

#### Template Locations
- **OLD:** `dev/templates/plan.md` → **REMOVED** (not needed, implementation.md stays in place)
- **OLD:** `dev/templates/context.md` → **NEW:** `.claude/templates/context.md`
- **OLD:** `dev/templates/tasks.md` → **NEW:** `.claude/templates/tasks.md`
- **OLD:** `dev/README.md` → **NEW:** `.claude/templates/README.md`

#### Installation Changes
- Install script no longer creates `/dev` folders
- Install script creates `.claude/templates/` instead
- `.gitignore` no longer excludes `dev/active/` and `dev/completed/`
- `.gitignore` now excludes `.claude/.beast-mode-backup-*/`

### Removed

- **Removed:** Entire `/dev` folder structure
- **Removed:** Separate `plan.md` files (only `implementation.md` exists now)
- **Removed:** Concept of "active" vs "completed" folders
- **Removed:** `/dev-docs-update` command (renamed to `/update-feature`)

### Why This Change?

**Cursor Compatibility:** This aligns Beast Mode with Cursor's simpler workflow where everything lives in `docs/features/`.

**Reduced Complexity:** One location instead of three (`docs/features/implementation.md`, `dev/active/feature/plan.md`, `dev/active/feature/context.md`).

**Better Git History:** All feature docs in one stable location means cleaner git history.

**Platform Agnostic:** Same workflow works in both Claude Code and Cursor without modification.

---

## [1.2.0] - 2025-11-05

### Added

#### New Slash Commands
- **`/update-skills`** - Update skills system after feature completion to create self-improving knowledge base
  - Analyzes completed feature to extract reusable patterns
  - Determines which existing skills should be updated
  - Creates feature documentation in relevant skill directories
  - Updates skill SKILL.md files with references to new patterns
  - Updates skill-rules.json for auto-activation of new patterns
  - Ensures future agents benefit from newly discovered patterns
  - Perfect for closing the loop after completing features

#### Skills System Integration
- Structured approach to documenting completed features in skills
- Template for creating feature documentation files
- Guidelines for determining which skills to update
- Pattern extraction from dev docs and implementation
- Automatic skill-rules.json updates for new keywords/file patterns

### Changed

#### Documentation Improvements
- Enhanced workflow guidance to include skills update step
- Added examples for frontend, backend, and editor feature documentation
- Clarified when to create new skills vs. update existing ones

---

## [1.1.0] - 2025-11-05

### Added

#### New Slash Commands
- **`/plan-feature`** - Plan new features by gathering requirements and using solution-architect agent to create implementation plans
  - Asks clarifying questions to understand requirements
  - Delegates plan creation to solution-architect agent
  - Waits for user approval before starting feature
  - Perfect for starting new features from scratch

- **`/discover-feature`** - Document existing legacy features that weren't developed with Beast Mode
  - Investigates codebase to understand how feature works
  - Creates retrospective implementation plan
  - Checks if plan already exists before creating
  - Great for bringing legacy code into Beast Mode workflow

- **`/upgrade-beast-mode`** (Plugin command) - Upgrade Beast Mode installation with latest templates and commands
  - Compares current version with plugin version
  - Shows changelog of what's new
  - Backs up existing files before upgrading
  - Preserves customized files (like build-check.ts)
  - Provides rollback instructions
  - **Note:** This is a plugin command, not copied to projects

#### Version Tracking
- Added `.beast-mode-version` file to track installed version in projects
- Added comprehensive CHANGELOG.md to document all changes
- Version number in plugin.json for tracking releases

### Fixed

#### `/start-feature` Bug Fix
- **CRITICAL FIX:** Command now properly copies implementation plan instead of rewriting it
  - Uses `cp` command to copy file
  - Uses `Edit` tool (not Write) to update only status header lines
  - Preserves entire plan content exactly as written
  - Only changes: Status, Started date, Last Updated timestamp
  - This was causing plans to be regenerated and losing original content

### Changed

#### Documentation Improvements
- Enhanced `/start-feature` command with explicit instructions to use Edit tool
- Added clear examples in all new commands
- Improved error handling and edge case documentation

---

## [1.0.0] - 2025-10-31

### Added

#### Initial Release
- Complete Beast Mode plugin with battle-tested workflow system
- Universal templates that work across all project types

#### Slash Commands
- `/start-feature` - Create dev docs structure from implementation plan
- `/continue-feature` - Resume work on existing feature with full context
- `/dev-docs-update` - Update dev docs before compacting conversations

#### Dev Doc Templates
- `plan.md` - Implementation plan structure
- `context.md` - Context tracking and decisions
- `tasks.md` - Task checklist with progress tracking
- `README.md` - Complete workflow guide (558 lines)

#### Hook Templates
- `edit-tracker.ts/.js` - Track edited files during session
- `skill-reminder.ts/.js` - Suggest relevant skills based on keywords
- `build-check.ts` - Run build checks after changes (customizable)

#### Format References
- `skill-rules.template.json` - Skill auto-activation patterns
- `session-edits.schema.json` - Session tracking schema
- `skill-structure-example.md` - Progressive disclosure pattern guide
- `agent-structure-example.md` - Agent creation guide
- `settings.hooks.json` - Hook registration template

#### Installation
- `/install-beast-mode` command for project setup
  - Detects project structure and tech stack
  - Asks clarifying questions about preferences
  - Generates customized implementation plan
  - Installs all universal templates
  - Creates dev docs directory structure
  - Updates .gitignore automatically

#### Installation Script
- `install-templates.sh` - Bash script for copying templates
  - Creates all necessary directories
  - Copies all template files
  - Makes hooks executable
  - Updates .gitignore
  - Checks for tsx installation
  - Shows hook registration instructions

#### Documentation
- Comprehensive README.md with:
  - Installation instructions
  - Usage workflows
  - Tech stack support guide
  - Troubleshooting section
  - Progressive disclosure pattern explanation
  - Agent creation guide
  - Philosophy and best practices

#### Plugin System
- Proper plugin.json manifest
- Organized directory structure
- Ready for Claude Code plugin marketplace

---

## Release Notes

### Upgrading from 1.1.0 to 1.2.0

**What you get:**
- New `/update-skills` command to close the workflow loop
- Skills system becomes self-improving as features are completed
- Structured approach to documenting patterns for future reuse
- Auto-activation rules for newly discovered patterns

**How to upgrade:**
1. Run `/upgrade-beast-mode` in any project with Beast Mode installed
2. Review the changes (new /update-skills command added)
3. Approve the upgrade
4. Your customizations are automatically preserved

**Breaking Changes:**
- None! This is a backward-compatible release

**Migration Notes:**
- No migration needed
- New `/update-skills` command is immediately available after upgrade
- Recommended workflow: Complete feature → `/dev-docs-update` → `/update-skills` → Archive

**New Workflow:**
```
1. /plan-feature → Create implementation plan
2. /start-feature → Begin development
3. [Development work...]
4. /dev-docs-update → Update context before compacting
5. /update-skills → Document patterns in skills system ← NEW!
6. Move to dev/completed/ (manual or future /archive-feature)
```

---

### Upgrading from 1.0.0 to 1.1.0

**What you get:**
- 3 powerful new slash commands for better feature planning and legacy code integration
- Critical bug fix for `/start-feature` that preserves your implementation plans
- Version tracking for future upgrades
- Comprehensive changelog for transparency

**How to upgrade:**
1. Run `/upgrade-beast-mode` in any project with Beast Mode installed
2. Review the changes that will be applied
3. Approve the upgrade
4. Your customizations (like build-check.ts) are automatically preserved

**Breaking Changes:**
- None! This is a backward-compatible release

**Migration Notes:**
- No migration needed
- Existing dev docs and features continue to work as-is
- New commands are immediately available after upgrade

---

## Versioning Strategy

Beast Mode follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes that require migration
- **MINOR** (1.X.0): New features, backward-compatible
- **PATCH** (1.0.X): Bug fixes, backward-compatible

---

## Future Roadmap

### Planned
- `/archive-feature` - Archive completed features
- Enhanced project detection for more languages and frameworks
- Template customization during installation
- Automated testing workflows

### Planned for 2.0.0
- Interactive setup wizard
- Built-in skill/agent marketplace
- Auto-update mechanism
- Multi-language support
- CI/CD integration templates

---

## Credits

Based on the Reddit post: **"Claude Code is a beast: Tips from 6 months of hardcore use"**

Developed to make battle-tested Claude Code workflow patterns easy to deploy across any project.

---

**Note:** To see the changelog for your current installation, check `.claude/.beast-mode-version` for your version number, then review the relevant sections above.
