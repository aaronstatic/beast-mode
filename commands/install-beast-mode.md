# Install Beast Mode

You are setting up the **Beast Mode** workflow system in this project!

Beast Mode provides:
- **Dev docs workflow** - Never lose context on complex features
- **Slash commands** - `/start-feature`, `/continue-feature`, `/plan-feature`, `/discover-feature`
- **Agents** - Specialized workflows (solution-architect, frontend-dev, etc.)
- **Skills system** - Best practices for your tech stack, loaded natively from each skill's `description`

---

## Installation Process

Follow these steps to install Beast Mode in this project:

### Step 1: Welcome & Overview

Display this welcome message to the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEAST MODE INSTALLATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Welcome! I'll set up the Beast Mode workflow system.

What you'll get:
- Dev docs workflow - Never lose context
- Slash commands - Feature tracking & planning
- Agents - Specialized dev agents for your stack
- Skills - Best practices for your stack (added as you build)

Let's get started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Step 2: Detect Project Structure

Run project detection to understand the tech stack and project state:

**Detection Tasks:**
1. Check for `package.json` to detect JavaScript/TypeScript projects
2. Check for `requirements.txt`, `setup.py`, or `pyproject.toml` for Python
3. Detect frameworks from dependencies (React, Next.js, NestJS, Express, Vue, etc.)
4. Detect build tools (Vite, Webpack, npm, yarn, etc.)
5. Detect testing frameworks (Vitest, Jest, pytest, etc.)
6. Check for monorepo indicators (workspaces, lerna.json, etc.)
7. **Check if the project has existing code** - are there source files beyond config? This determines whether this is a "new project" or "existing project" (affects Step 7, the onboarding step)
8. **Check for existing README files** - `README.md`, `README`, `readme.md` etc. These contain valuable context for generating project docs

**Show Detection Results:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Language:        [Detected language]
Framework:       [Detected framework]
Build Tool:      [Detected build tool]
Package Manager: [npm/yarn/pnpm/pip/etc.]
Testing:         [Detected test framework]
Structure:       [Single repo / Monorepo / Backend / Frontend / Fullstack]
Project State:   [New (no source code) / Existing (has source code)]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Step 3: Confirm Detection

Use the `AskUserQuestion` tool:

**Question:** "Is this detection correct?"
**Options:**
  - "Yes, looks good"
  - "No, I'll provide details"

If the user corrects the detection, update your understanding accordingly.

---

### Step 4: Install Universal Templates

Run the installation script to copy all templates and set up directory structure:

**Command:**
```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/install-templates.sh
```

**What it does:**
1. Creates directory structure (`.claude/`, `.claude/templates/`, `docs/features/`)
2. Copies slash commands to `.claude/commands/`
3. Copies feature doc templates to `.claude/templates/`
4. Copies format references to `.claude/`
5. Updates `.gitignore` with Beast Mode entries
6. Writes version file (`.claude/.beast-mode-version`)

The script is safe - it won't overwrite existing files without confirmation and creates backups when needed.

**Alternative (if script fails):**
Manually copy files from `${CLAUDE_PLUGIN_ROOT}/templates/` to project using the Bash tool with `cp` commands.

---

### Step 4b: Choose Agent Effort Preset

Beast Mode tunes each agent's `model` and reasoning `effort` by role. Rather than a per-agent ladder, offer **three presets** (tuned against the latest DeepSWE benchmark results). With Opus 5, every agent runs on `opus`; standard dev agents always run at `medium` effort — the plan carries the architectural thinking, so extra effort there buys little. The presets differ only in how hard the high-leverage agents (solution-architect, advanced dev, reviewers) think. Explain it briefly:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENT EFFORT PRESET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Standard dev agents always run on opus @ medium effort
(the plan already carries the thinking). Pick how hard
the high-leverage agents think:

  Preset   solution-architect / advanced dev / review
  ───────  ───────────────────────────────────────────
  Max      opus @ max      ← default, best results
  High     opus @ xhigh
  Medium   opus @ high     ← leanest token use

Higher effort = better results, more tokens.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Ask for the preset.** Use `AskUserQuestion`:

- **Question:** "Which agent effort preset? This sets how hard the high-leverage agents (solution-architect, advanced dev, reviewers) think. Standard dev agents always run on opus @ medium."
- **Header:** "Effort preset"
- **Options:**
  1. `Max` — "opus @ max for high-leverage agents. Best results. **Recommended.**" *(recommended/first)*
  2. `High` — "opus @ xhigh. Strong results, somewhat leaner on tokens."
  3. `Medium` — "opus @ high. Leanest token use."

From the chosen preset, derive the two effort values used in Step 5 — **MAX** (the high-leverage agents: solution-architect, advanced dev, reviewers) and **DEV** (the standard dev agents, always `medium`). Every agent runs on `opus`:

| Preset | **MAX** (`opus`) | **DEV** (`opus`) |
|--------|------------------|------------------|
| `Max` (default) | `max` | `medium` |
| `High` | `xhigh` | `medium` |
| `Medium` | `high` | `medium` |

Remember the chosen preset's **MAX** and **DEV** values — you'll write them into agent frontmatter in Step 5.

---

### Step 5: Create Dev Agents

Based on the tech stack detected in Step 2, create project-specific dev agents in `.claude/agents/`. The solution-architect agent was already copied from templates — now tune it and create the dev agents (standard + advanced) tailored to this project, using the **MAX** and **DEV** effort levels chosen in Step 4b.

**First, tune the solution-architect** (`.claude/agents/solution-architect.md`, already copied): ensure `model: opus` and set `effort: <MAX>` in its frontmatter (edit the `effort:` line to match the user's choice).

**Read the agent structure guide first:**
```
Read file: ${CLAUDE_PLUGIN_ROOT}/templates/formats/agent-structure-example.md
```

**Agent creation rules:**
- Each agent is a Markdown file with YAML frontmatter in `.claude/agents/`
- Required frontmatter: `name`, `description`
- Always set `tools: Read, Write, Edit, Bash, Glob, Grep`
- Always assign a `color` (blue for frontend/CLI, green for backend/ML, yellow/other for the rest)
- System prompt should reference project skills (`.claude/skills/`) and follow project conventions
- Dev agents implement tasks from feature docs — they read `implementation.md`, `context.md`, and `tasks.md`

**Create TWO tiers for each detected domain:**

1. **Standard dev agent** — `model: opus`, `effort: <DEV>` (`medium`). The everyday workhorse.
2. **Advanced dev agent** — same `name` with an `-advanced` suffix, `model: opus`, `effort: <MAX>`. For major refactors, integration-heavy, or high-risk phases. Invoked by `/proceed-advanced`, or by `/proceed` after the user opts in.

So a full-stack project gets four dev agents: `frontend-dev`, `frontend-dev-advanced`, `backend-dev`, `backend-dev-advanced`.

**Create agents based on detected stack:**

| Project Type | Standard agent(s) | Advanced agent(s) |
|-------------|-------------------|-------------------|
| React / Next.js / Frontend | `frontend-dev` (blue) | `frontend-dev-advanced` (blue) |
| Node.js / Express / NestJS / Backend | `backend-dev` (green) | `backend-dev-advanced` (green) |
| Full-stack / Monorepo | `frontend-dev` (blue), `backend-dev` (green) | `frontend-dev-advanced`, `backend-dev-advanced` |
| Python / ML / AI | `ml-dev` (green) | `ml-dev-advanced` (green) |
| C# / Unity / Game Dev | `game-dev` (green) | `game-dev-advanced` (green) |
| CLI / Scripts | `dev` (green) | `dev-advanced` (green) |
| Other | One dev agent appropriate to the primary tech (green) | Its `-advanced` variant |

**Standard dev agent frontmatter:**
```yaml
---
name: frontend-dev
description: Implements <domain> features from the plan. Use after an implementation plan exists.
tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
effort: <DEV>        # standard dev = medium
color: blue
---
```

**Advanced dev agent frontmatter** (same role, heavyweight):
```yaml
---
name: frontend-dev-advanced
description: Heavyweight <domain> implementation for major refactors, integration-heavy, or high-risk phases. Used by /proceed-advanced, or by /proceed when the user opts in.
tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
effort: <MAX>        # the value chosen in Step 4b
color: blue
---
```

**Agent system prompt pattern** (applies to both tiers):
1. **Role** — "You are a senior [domain] developer implementing features from plans." (Advanced: "principal [domain] engineer taking on the hardest work — major refactors and high-risk, integration-heavy phases.")
2. **Process** — Load context from feature docs, follow implementation plan, update tasks.md
3. **Tech-specific guidance** — Mention the frameworks/libraries detected (e.g., "Use React hooks, TypeScript strict mode, Tailwind for styling")
4. **Quality standards** — Type-check after changes, follow existing patterns, reference skills
5. **Important rules** — Always update dev docs, ask questions if plan is unclear, focus on clean code
6. **Advanced agents only** — add: trace every integration point before touching shared code, prefer incremental verifiable steps, call out migration risks; "you run at maximum effort — use it on the edge cases the plan didn't anticipate."

The standard and advanced agents for a domain share the same system prompt body; both run on `opus`, so only the frontmatter (`name`, `effort`, `description`) and the extra "advanced" rules differ.

**Show the user what was created:**
```
Created dev agents (effort: standard=<DEV>, advanced=<MAX>):
  - .claude/agents/frontend-dev.md           (opus, blue)
  - .claude/agents/frontend-dev-advanced.md  (opus, blue)
  - .claude/agents/backend-dev.md            (opus, green)
  - .claude/agents/backend-dev-advanced.md   (opus, green)
Tuned:
  - .claude/agents/solution-architect.md     (opus, effort=<MAX>)
```

---

### Step 6: Create Mission Statement & Technical Design

This step creates the two foundational project documents that give Claude (and future contributors) deep context about the project.

**Templates are available at:**
- `${CLAUDE_PLUGIN_ROOT}/templates/formats/mission-statement-template.md`
- `${CLAUDE_PLUGIN_ROOT}/templates/formats/technical-design-template.md`

Read both templates to understand the expected structure.

#### For Existing Projects (has source code):

1. **Gather information automatically:**
   - Read `README.md` or any existing documentation
   - Read `CLAUDE.md` if it exists
   - Scan `package.json`, `pyproject.toml`, or equivalent for project metadata
   - Explore the source tree structure (use Glob to understand directory layout)
   - Read key source files to understand architecture and patterns
   - Check git log for project history and contributors

2. **Identify gaps** - After gathering, determine what you still need to know:
   - What is the project's core mission / purpose?
   - Who is the target audience?
   - What are the key design principles and trade-offs?
   - Are there any non-obvious architectural decisions?

3. **Ask the user to fill gaps** - Use `AskUserQuestion` or direct questions for anything you couldn't determine from the code. Keep questions focused and specific -- don't ask what you already know from reading the project.

4. **Generate both documents:**
   - Write `docs/mission-statement.md` following the template structure
   - Write `docs/technical-design.md` following the template structure
   - Adapt sections to fit the project -- remove sections that don't apply, add sections that do
   - For technical-design.md, include actual code examples for patterns found in the codebase

5. **Show the user a brief summary** of what was generated and ask them to review.

#### For New Projects (no source code):

1. **Ask the user foundational questions:**
   - "What are you building? Describe the project in a few sentences."
   - "Who is this for? Who will use it?"
   - "What tech stack are you planning to use?" (if not already detected from package.json etc.)
   - "What are your priorities? (e.g., speed of development, performance, simplicity, extensibility)"
   - "Is there anything this project explicitly should NOT be?"

   Use `AskUserQuestion` with options where possible (e.g., for tech stack choices).

2. **Generate both documents** based on the user's answers:
   - Write `docs/mission-statement.md` following the template structure
   - Write `docs/technical-design.md` following the template structure
   - For new projects, the technical design will be more aspirational -- document the planned architecture and stack decisions

3. **Show the user a brief summary** and ask them to review.

**IMPORTANT:** These documents should feel like they were written by someone who deeply understands the project. They are not boilerplate -- they should contain specific, opinionated content about THIS project.

---

### Step 7: Onboard Existing Features or Plan Project Setup

This step depends on whether the project has existing code.

#### For Existing Projects (has source code):

Offer to discover and document existing features:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXISTING CODE DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I can see this project already has code in it.
I can analyze the codebase and detect existing
features, then document each one so Beast Mode
knows about them going forward.

This will create retrospective implementation
docs for each feature found.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Process:**
1. Use `AskUserQuestion`: "Would you like me to detect and document your existing features?"
   - Options: "Yes, discover my features" / "No, I'll do it later"

2. **If yes:**
   - Analyze the codebase to identify distinct features/modules (look at directory structure, component boundaries, route handlers, major modules, etc.)
   - Present a list of detected features to the user:
     ```
     I found these features in your codebase:

     1. [feature-name-1] - [brief description]
     2. [feature-name-2] - [brief description]
     3. [feature-name-3] - [brief description]
     ...

     I'll run /discover-feature for each one to create
     retrospective documentation.
     ```
   - Ask user to confirm the list (they can remove or add entries)
   - **IMPORTANT:** Do NOT use the Skill tool to run `/discover-feature` — the newly copied slash commands won't be visible until Claude restarts. Instead, read the discover-feature template directly from the plugin:
     ```
     Read file: ${CLAUDE_PLUGIN_ROOT}/templates/slash-commands/discover-feature.md
     ```
   - Follow the instructions in that template inline for each confirmed feature, with `$ARGUMENTS` set to the feature name
   - For each discovery, follow the template's own user interaction flow

3. **If no:**
   - Tell the user they'll need to restart Claude Code first (e.g. `claude -c`) so the new slash commands are loaded
   - Remind them they can then run `/discover-feature <feature-name>` any time later

#### For New Projects (no source code):

Offer to plan the initial project setup:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEW PROJECT DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This looks like a fresh project. I can help
you plan the initial setup as your first
Beast Mode feature.

This will create an implementation plan for
getting the project scaffolded and ready
for development.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Process:**
1. Use `AskUserQuestion`: "Would you like me to plan the initial project setup?"
   - Options: "Yes, plan project setup" / "No, I'll start on my own"

2. **If yes:**
   - **IMPORTANT:** Do NOT use the Skill tool to run `/plan-feature` — the newly copied slash commands won't be visible until Claude restarts. Instead, read the plan-feature template directly from the plugin:
     ```
     Read file: ${CLAUDE_PLUGIN_ROOT}/templates/slash-commands/plan-feature.md
     ```
   - Follow the instructions in that template inline, with `$ARGUMENTS` set to `project-setup`
   - This will gather requirements and create an implementation plan for the project scaffolding

3. **If no:**
   - Tell the user they'll need to restart Claude Code first (e.g. `claude -c`) so the new slash commands are loaded
   - Remind them they can then run `/plan-feature <feature-name>` to plan their first feature

---

### Step 8: Summary & Next Steps

Display final summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEAST MODE INSTALLED!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What was installed:
  - Slash commands (.claude/commands/)
  - Agents (.claude/agents/) [solution-architect (opus) + standard dev (opus, medium) + advanced dev (opus, max)]
  - Feature doc templates (.claude/templates/)
  - Format references (.claude/)
  - Directory structure (docs/features/)
  - Mission statement (docs/mission-statement.md)
  - Technical design (docs/technical-design.md)
  - Version tracking (.claude/.beast-mode-version)

You're ready to start developing! Try:
  /plan-feature <feature-name>
  /discover-feature <feature-name>

To group related features into an epic:
  /create-epic <name> <prompt>    — migrate existing prefixed features
  /plan-epic <name> [prompt]      — plan a new epic from scratch
  /update-epic [name]             — refresh epic status + master rollup
  /review-epic <name>             — cross-feature architecture review

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Important Notes

**IMPORTANT BEHAVIORS:**

1. **Non-Destructive:**
   - If `.claude/` directory exists, ask before overwriting files
   - If files already exist, ask to confirm overwrite
   - Create backups of existing files before overwriting

2. **Error Handling:**
   - If detection fails, ask user to manually specify tech stack
   - If file copy fails, show clear error and continue with others
   - If question fails, use sensible defaults

3. **Tech Stack Detection:**
   - Be thorough but don't overdo it
   - Show confidence level in detection
   - Let user correct if wrong

4. **Mission Statement & Technical Design:**
   - These must feel project-specific, not boilerplate
   - For existing projects, derive as much as possible from the code before asking questions
   - For new projects, ask focused questions and generate opinionated docs
   - Always let the user review and adjust before proceeding

5. **Communication:**
   - Use clear formatting (boxes, sections)
   - Show progress at each step
   - Be concise

---

## Implementation Details

This command should:
1. Use the `Read` tool to detect project files
2. Use the `Glob` tool to find package.json, requirements.txt, etc.
3. Use the `AskUserQuestion` tool for structured choices
4. Use the `Write` tool to create the mission statement and technical design
5. Use the `Bash` tool to copy template files from plugin directory
6. Use the `Skill` tool to run `/discover-feature` or `/plan-feature` at the end
7. Use the `Edit` tool to update .gitignore if it exists

The plugin root is available via: `${CLAUDE_PLUGIN_ROOT}`

Template files are located at:
- `${CLAUDE_PLUGIN_ROOT}/templates/slash-commands/`
- `${CLAUDE_PLUGIN_ROOT}/templates/dev-docs/`
- `${CLAUDE_PLUGIN_ROOT}/templates/formats/`

---

**Remember:** This installation gets the user productive immediately with slash commands, agents, and dev docs. Skills are added later as features are completed (via `/document-feature`) and load natively from each skill's `SKILL.md` `description`.

**Version Tracking:** The install script writes the plugin version to `.claude/.beast-mode-version` so `/upgrade-beast-mode` knows you're on the latest version.
