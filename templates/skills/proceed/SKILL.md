---
name: proceed
description: "Proceed work on the current feature. Usage: /proceed"
user-invocable: true
---

You have been asked to continue work on the current feature. You should know which feature this is and this command should be run after /start-feature, /continue-feature, or /review-feature.

If the current feature is unclear, ask the user to run one of these commands first.

## Harness

This command runs on any agent harness. Read `.beast-mode/harness.md` first.
It maps the neutral terms in this command to the tools of this harness.
Terms include: ask the user to choose, delegate to an agent, search the web,
and the harness skills directory. Use the mapped tool. Do not use a tool name
from another harness.

## Epic awareness

This command is epic-aware. Before resolving `$ARGUMENTS` to a feature path,
read `.beast-mode/epic-resolution.md` and apply its rules: detect epics by
`epic-overview.md`, resolve `<epic>/<feature>` references, fuzzy-fall-back into
epic folders for bare names, and resolve the current feature's nested `<epic>/<feature>` path when it lives inside an epic.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. When the current feature lives inside an epic, every `docs/features/<feature-name>/...` path below resolves to its nested `docs/features/<epic>/<feature>/...` location. This command's body is the proceed workflow; it does **not** re-specify those rules.

## Phase handoff

Before you start a subagent, read `.beast-mode/phase-handoff.md` and apply its rules:
split the phase into task groups, write the phase brief, and put the stop rule and
the tool rules into the prompt. Read `.beast-mode/tool-rules.md` once per run, and
paste its `## Tool rules` section into every subagent prompt. Apply its delegator
rules and its verification brief too.
`.beast-mode/phase-handoff.md` is the single source of truth for the handoff; this
command does not restate those rules.

## Determine Work Source

By default, `/proceed` uses the **implementation workflow** from `tasks.md`.

The **code review workflow** is only used when `/review-feature` was run earlier in this conversation and the `code-review.md` content is already loaded into context. In that case, proceed with code review fixes.

If unsure which workflow is active, check the conversation history:
- Was `/review-feature` the most recent feature command? → **Code review workflow**
- Was `/continue-feature` or `/start-feature` the most recent? → **Implementation workflow**

---

## Implementation Workflow

Read `docs/features/<feature-name>/tasks.md` and `docs/features/<feature-name>/context.md`, and find the next incomplete phase.

Delegate all of the implementation work, and keep your own context clear for the orchestration. Run one phase at a time, in these four steps:

1. Split the phase into task groups, and write one brief for each group, per `.beast-mode/phase-handoff.md`.
2. Delegate each task group to one agent, per `.beast-mode/phase-handoff.md`.
3. Run the post-phase step of section 10 of `.beast-mode/phase-handoff.md`, with the verifier, the docs, and the test of a person. Run up to three fix rounds for one fault. If the fault stays, stop, and show the error text to the user.
4. Start the next phase when the post-phase step of section 10 ends. A large change stops the feature, per section 12 rule 10. Start no next phase then.

Apply section 12 rule 3 of `.beast-mode/phase-handoff.md` to each user message of the run. Apply it also to the free text of a test prompt answer. For each item, write the inbox line, give the answer of rule 3, and keep the agent running.

### Agent Selection: Standard vs. Advanced

Beast Mode creates two tiers of dev agent for each domain:

- **Standard** (e.g. `frontend-dev`, `backend-dev`) — `model: sonnet`, at the preset effort. The default for routine implementation work, because the architecture and decisions already live in the plan (written by the high-effort solution-architect).
- **Advanced** (e.g. `frontend-dev-advanced`, `backend-dev-advanced`) — `model: opus`, at the preset effort. For phases that are genuinely hard to get right.

Before spawning an agent for a phase, **assess whether it warrants the advanced agent.** Signals that it does:

- It's a **major refactor** or rewrite, not additive work
- It **touches many integration points** / crosses module or service boundaries
- It involves **tricky concurrency, data migration, or state management**
- The plan itself flags it as high-risk, or the solution-architect marked it as needing an advanced agent
- Getting it wrong would be **expensive to unwind** (schema changes, public APIs, auth)

If the phase looks routine, just use the standard agent and proceed.

**If you judge that the advanced agent is warranted, do NOT silently use it — ASK the user first.** Ask the user to choose, and name the specific reasons:

```
This next phase (<phase name>) looks like a good candidate for an advanced agent
(opus, at the preset effort) rather than the standard one, because:
  • <reason 1, e.g. it refactors the auth layer touched by 6 modules>
  • <reason 2, e.g. a mistake here breaks existing sessions>

Advanced agents use more tokens but I recommend it here. Options:
  • Use the advanced agent for this phase  (recommended)
  • Use the standard agent
```

Respect the user's choice. If they decline, use the standard agent. If they'd rather drive it phase-by-phase at the advanced tier, point them at `/proceed-advanced` (forces advanced agents, one phase at a time).

---

## Code Review Workflow

This workflow is only active when `/review-feature` was run earlier in this conversation and the `code-review.md` is loaded into context.

When proceeding with code review fixes from `code-review.md`:

### 1. Determine Next Fix

- Read `docs/features/<feature-name>/code-review.md`
- Find the first unchecked item in the **Progress** section (`- [ ] CR-N`)
- Cross-reference with the **Recommended Fix Order** table to confirm priority
- Read the full finding details (severity, file, problem, fix)

### 2. Prepare Agent Context

**Group the findings first**, per section 6 of `.beast-mode/phase-handoff.md`. For example:
- CR-10 + CR-11 (both quick cleanups in the same file)
- CR-5 + CR-9 (both improve BoxDimensionField)

Then write one brief for the group, per `.beast-mode/phase-handoff.md`. The brief carries:
- The number, the title, the **Problem** section, and the **Fix** section of each finding
- The file and the line numbers of each finding
- The code snippets of the review, which show the current state and the wanted state
- The rule that each finding names

### 3. Spawn Agent

Delegate to the dev agent that matches the domain of the fix, for example `frontend-dev`. For **CRITICAL/HIGH findings that require redesign or cross many integration points**, apply the same Standard-vs-Advanced judgment as the implementation workflow — ask the user before using the `*-advanced` (opus, at the preset effort) agent.

Write the prompt per `.beast-mode/phase-handoff.md`. Give the agent two more instructions:
- Run the project type-check after the change
- Change nothing outside the scope of the group

### 4. Verify and Update

After the agent completes:
- Verify the changes make sense from the agent result
- When the agent reports no type-check result, delegate the gate to a verifier subagent per `.beast-mode/phase-handoff.md`
- Mark the finding as resolved in `code-review.md`: change `- [ ] CR-N` to `- [x] CR-N`
- Update the **Status** line at the top: increment resolved count
- Determine if the user should test before continuing:
  - **CRITICAL/HIGH** fixes: Suggest testing
  - **MEDIUM/LOW** fixes: May continue to next fix

### 5. Report and Continue

After each fix:
```
Fixed CR-[N]: [title]
Progress: [X]/[Y] findings resolved

Next: CR-[M]: [title] ([severity], [effort])
[Brief description]

Continue with /proceed or tell me which finding to tackle next.
```

If the user hasn't intervened, proceed to the next fix automatically for LOW/MEDIUM severity items.

---

## Important Notes

**DO NOT** Implement the tasks yourself, always use agents
**DO NOT** Ask agents to implement more than one phase/finding at a time (unless grouping related fixes in the same file)
**DO** Choose the best agent for the current task — standard (sonnet, at the preset effort) by default, advanced (opus, at the preset effort) for major/integration-heavy/high-risk phases
**DO** Ask the user before switching to an advanced agent, naming the specific reasons and noting the higher token cost
**DO** Show the test prompt after every slice, per section 10 of `.beast-mode/phase-handoff.md`, and wait for the answer
**DO** Write each inbox item of the run into the inbox, per section 12 of `.beast-mode/phase-handoff.md`, and keep the agent running
**DO** Update `tasks.md` and `context.md` between each phase, when the agent did not
**DO** Group related code review fixes that touch the same file
**DO** Point the user at `/proceed-advanced` if they want to force advanced agents one phase at a time
