# Beast Mode — Command Reference

All 31 slash commands installed by `/install-beast-mode`, grouped by category.

---

## Feature Development

| Command | Description |
|---------|-------------|
| `/suggest-feature` | Suggests 2–4 features to build next based on project state, mission, and technical design |
| `/plan-feature <name>` | Runs a plan interview (rounds of numbered questions, then a stop check that lists the assumptions), proposes 2–3 approaches with trade-offs, creates an implementation plan that cuts its phases into slices, each with a demo line and acceptance criteria |
| `/start-feature <name>` | Creates `context.md` and `tasks.md` from the approved plan. Sets status to "In Progress". Carries the demo line of each slice into `tasks.md`. It also creates `inbox.md` for the input of a run |
| `/continue-feature <name>` | Loads feature context and shows a status summary — use at the start of each session |
| `/proceed` | Picks up the next task and implements it using specialized agents; asks before using an advanced agent on major or high-risk phases. After each slice, it shows the demo line and waits for your test. Type guidance, a bug, or a change at any point of the run. It notes the item in the feature inbox and acts on it after the phase |
| `/proceed-advanced` | Forces advanced (opus, at the preset effort) agents, one phase at a time. It shows the demo line for your test, then stops. It notes the fault, change, or guidance of each user message in the feature inbox and acts on them after the phase |
| `/autorun-feature [name]` | Runs a whole feature to completion autonomously: plans (if no `implementation.md`) and starts it, then per phase implements, gates, verifies UI via browser MCP, and runs `/review-feature` + fixes all findings; ends with `/update-feature` and `/update-master`. Epic-aware. Makes no commit and no push — you commit and push. Shows the demo line of each slice for your test, and goes on. It notes the fault, change, or guidance of each user message in the feature inbox and acts on them after each phase. A medium change asks one scope question. Stops and prompts on any blocker. Resumable |
| `/update-feature <name>` | Saves progress to docs — **always run before ending a session**. It folds the done inbox items into `context.md`. At the feature end, it files each open inbox bug in `docs/bugs/` |
| `/update-master` | Updates `docs/overview.md` with all feature progress and cross-feature connections |
| `/discover-feature <name>` | Documents an existing feature by analyzing its code; does not change code |

---

## Quality & Review

| Command | Description |
|---------|-------------|
| `/review-feature <name>` | Reviews code against best practices; creates a findings report with severity rankings |
| `/review-pr [PR-number]` | Independent PR review — GitHub-PR mode (with a number) or pre-submit mode (no number) |
| `/audit-feature <name>` | Higher-level architecture, integration, and DX audit |
| `/evaluate-feature <name>` | Evaluates a feature against its Definition of Done acceptance criteria using an independent evaluator agent |
| `/document-feature <name>` | Extracts reusable patterns from a completed feature into the skills system |
| `/review-ui` | Reviews UI code with a Live Browser Audit of the running app (visual, layout, accessibility) |
| `/review-ux` | Persona-first UX review with rubrics, a friction inventory, and a live MCP audit |
| `/review-mobile` | Mobile-specific review covering responsiveness, touch targets, and performance |

---

## Bug Tracking

| Command | Description |
|---------|-------------|
| `/fix-bug <id>` | Fixes a specific bug by ID with linked feature context |
| `/fix-feature [name]` | Fixes all open bugs for a feature (or all bugs), grouped by priority |

---

## Epics

Epics group related features into a single tracked folder. A folder is an epic when it contains `epic-overview.md`.

| Command | Description |
|---------|-------------|
| `/create-epic <name>` | Creates a new epic folder with `epic-overview.md` and `epic-requirements.md` |
| `/suggest-epic` | Suggests 2–4 epics to build next based on project state, mission, and technical design. A pick writes `epic-requirements.md` and hands off to `/plan-epic` |
| `/plan-epic <name>` | Runs a plan interview (rounds of numbered questions, then a stop check) over a draft feature set and a draft build order, sets the build order, and writes one `requirements.md` for each feature, not a plan |
| `/update-epic <name>` | Updates `epic-overview.md` with current status across all child features |
| `/review-epic <name>` | Reviews all features in an epic holistically — integration, consistency, and completeness |
| `/autorun-epic <epic-name>` | Runs a whole epic to completion. Plans each feature, delegates the build to a fresh agent, then commits, fast-forwards the base branch, and pushes per feature. Adds the demo line of each slice to the human testing checklist as the slice lands. Ends with that checklist. A medium inbox change stops the feature, asks one scope question, and builds the feature on. A large change ends the run |

---

## Reporting

| Command | Description |
|---------|-------------|
| `/token-report` | Reports the token and step use of every session, and names every flagged session |
| `/review-session [session-id]` | Reads the log of a session, not the code. Ranks findings that each quote one step, and applies the ones you pick: a pointer in the project instruction file, a new check, or one rule line. With no id, it reads the current session. No autorun calls it. |

---

## Orca Orchestration

These commands run Beast Mode work as Orca agent tabs, one fresh tab per phase. They need the Orca CLI. See [Orca Orchestration](orca-orchestration.md).

| Command | Description |
|---------|-------------|
| `/orca-setup` | Detects the agents of the machine, asks which agent plans, builds, verifies, reviews, and writes the docs, how often a commit runs, whether lanes run side by side, and which custom steps run. Writes the `orchestration` object of `.beast-mode/orca.json` |
| `/orca-feature <feature-name \| epic/feature>` | Runs a feature to completion in Orca. A step script decides each step, and this tab ends its turn while a phase tab works. Commits each phase on a feature branch. Epic-aware. Resumable. Never pushes |
| `/orca-epic <epic-name>` | Runs a whole epic in Orca on the branch `epic/<epic>`. Builds each feature of the Build Order on its own branch and merges it into the epic branch. Features of one Build Order item build side by side in child worktrees when the settings allow it. Never merges into the default branch, and never pushes |

---

## Claude Code Mods

These commands need Claude Code 2.1.287 or later.

| Command | Description |
|---------|-------------|
| `/feature [name]` | Shows a pane for a feature. The pane holds the path, the status, the progress, the current phase with its tasks, and the open bugs. With no name, it shows the feature with the newest `**Last Updated:**` stamp. This command is a mod, not a command skill. It starts no model request. Where no pane draws, it answers as text |
| `/dashboard` | Opens a pane with four views: the project, an epic, a feature, and a bug. A Back button (hotkey `b`) returns to the last view. This command is a mod, not a command skill. It starts no model request. A button fills the prompt with a Beast Mode command and never sends it. Where no pane draws, it answers with the project view as text |

---

## Daily Workflow

The most common sequence:

```
/continue-feature <name>   # start a session
/proceed                   # implement the next task (repeat)
/update-feature <name>     # save before ending a session
```

For a new feature:

```
/suggest-feature           # get ideas
/plan-feature <name>       # create a plan and get your approval
/start-feature <name>      # set up docs and begin
/proceed                   # build (repeat)
/evaluate-feature <name>   # verify against acceptance criteria
/document-feature <name>   # extract patterns into skills
/update-master             # update the big picture
```
