# Beast Mode — Command Reference

All 23 slash commands installed by `/install-beast-mode`, grouped by category.

---

## Feature Development

| Command | Description |
|---------|-------------|
| `/suggest-feature` | Suggests 2–4 features to build next based on project state, mission, and technical design |
| `/plan-feature <name>` | Gathers requirements, proposes 2–3 approaches with trade-offs, creates an implementation plan with acceptance criteria |
| `/start-feature <name>` | Creates `context.md` and `tasks.md` from the approved plan; sets status to "In Progress" |
| `/continue-feature <name>` | Loads feature context and shows a status summary — use at the start of each session |
| `/proceed` | Picks up the next task and implements it using specialized agents; asks before using an advanced agent on major or high-risk phases |
| `/proceed-advanced` | Forces advanced (opus, max-effort) agents, one phase at a time, then stops |
| `/update-feature <name>` | Saves progress to docs — **always run before ending a session** |
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
| `/plan-epic <name>` | Plans the features inside an epic, sets build order, and creates individual feature plans |
| `/update-epic <name>` | Updates `epic-overview.md` with current status across all child features |
| `/review-epic <name>` | Reviews all features in an epic holistically — integration, consistency, and completeness |

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
