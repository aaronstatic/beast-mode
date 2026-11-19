---
name: proceed-advanced
description: "Proceed on the current feature using ADVANCED (opus, at the preset effort) agents, one phase only. Usage: /proceed-advanced"
user-invocable: true
---

You have been asked to continue work on the current feature using the **advanced agents** — for a **single phase only**. This is the heavyweight sibling of `/proceed`: use it when the next phase is a major refactor, touches many integration points, or is otherwise high-risk and benefits from opus running at the preset effort.

This command should be run after `/start-feature`, `/continue-feature`, or `/review-feature`. If the current feature is unclear, ask the user to run one of these first.

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

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. When the current feature lives inside an epic, every `docs/features/<feature-name>/...` path below resolves to its nested `docs/features/<epic>/<feature>/...` location. This command's body is the advanced proceed workflow; it does **not** re-specify those rules.

## Phase handoff

Before you start a subagent, read `.beast-mode/phase-handoff.md` and apply its rules:
split the phase into task groups, write the phase brief, and put the stop rule and
the tool rules into the prompt. Read `.beast-mode/tool-rules.md` once per run, and
paste its `## Tool rules` section into every subagent prompt. Apply its delegator
rules and its verification brief too.
`.beast-mode/phase-handoff.md` is the single source of truth for the handoff; this
command does not restate those rules.

## How this differs from `/proceed`

| | `/proceed` | `/proceed-advanced` |
|---|---|---|
| Agent | Picks the best fit; asks before going advanced | **Always** the `*-advanced` (opus, at the preset effort) agent |
| Scope | May continue phase after phase | **Exactly one phase, then stops** |
| Use when | Routine implementation | Major refactor / integration-heavy / high-risk phase |

The single-phase stop is deliberate: after each advanced phase, **you hand control back to the user** so they can decide whether the *next* phase also warrants an advanced agent (`/proceed-advanced`) or can drop back to a standard agent (`/proceed`). This keeps token spend under the user's control.

## Determine Work Source

By default, `/proceed-advanced` uses the **implementation workflow** from `tasks.md`.

The **code review workflow** is used instead only when `/review-feature` was run earlier in this conversation and `code-review.md` is loaded into context.

## Implementation Workflow

1. Read `docs/features/<feature-name>/tasks.md` and `docs/features/<feature-name>/context.md` to determine the **next single phase**.
2. Select the **advanced agent** for the work. These are the `model: opus` agents, at the preset effort, created during setup — e.g. `frontend-dev-advanced`, `backend-dev-advanced`, `ml-dev-advanced`, `dev-advanced`. Choose the one matching the phase's domain.
   - If no matching `*-advanced` agent exists, tell the user and offer to either (a) run `/upgrade-beast-mode` to create the advanced agents, or (b) fall back to the standard agent for this phase.
3. Split the phase into task groups, and write one brief for each group, per `.beast-mode/phase-handoff.md`. Delegate each task group to an advanced agent, per `.beast-mode/phase-handoff.md`. Every group belongs to **that one phase**. Do NOT implement the phase yourself.
4. When the agent completes:
   - Run the post-phase step of section 10 of `.beast-mode/phase-handoff.md`.
   - After a verifier `FAIL` or an open `bug` line, delegate the fix brief to the advanced agent.
   - Run up to three fix rounds for one fault. If the fault stays, stop, and show the error text to the user. This stop replaces the report of step 5.
   - A large change ends the step, per section 12 rule 10. That stop replaces the report of step 5.
5. **STOP.** Report what was completed and explicitly hand back control:

```
✅ Advanced phase complete: <phase name>
Agent used: <name>-advanced (opus, at the preset effort)
Progress: <X>/<Y> phases done

Next phase: <next phase name>
  • Run /proceed-advanced again if this next phase is also major/integration-heavy
  • Run /proceed for a standard (sonnet, at the preset effort) agent if it's routine
```

Do not automatically continue to the next phase.

Apply section 12 rule 3 of `.beast-mode/phase-handoff.md` to each user message of the run. Apply it also to the free text of a test prompt answer. For each item, write the inbox line, give the answer of rule 3, and keep the agent running.

## Code Review Workflow

When `code-review.md` is loaded into context, apply the same single-phase, advanced-agent logic to the **next code-review finding (or group of related findings in the same file)**:

1. Read `docs/features/<feature-name>/code-review.md`, find the first unchecked `- [ ] CR-N`, and read the full finding (severity, file, problem, fix).
2. Group the findings first, per section 6 of `.beast-mode/phase-handoff.md`. Write one brief for the group, per `.beast-mode/phase-handoff.md`, with the file and the line numbers, the Problem and Fix sections, and the rule that each finding names. Delegate to the matching **advanced** dev agent (opus, at the preset effort), per `.beast-mode/phase-handoff.md`.
3. After the agent completes: verify from the agent result, delegate the type-check to a verifier subagent if the agent didn't run it, mark `- [ ] CR-N` → `- [x] CR-N`, and update the Status line.
4. **STOP** and report progress, then hand control back (offer `/proceed-advanced` for the next finding or `/proceed` for routine ones).

## Important Notes

**DO NOT** implement the work yourself — always use an advanced agent
**DO NOT** continue past a single phase/finding-group — always stop and hand back to the user
**DO** force the `*-advanced` agent even if the phase looks routine (that is the whole point of this command)
**DO** update `tasks.md` and `context.md` between phases if the agent has not
**DO** show the test prompt after every slice, per section 10 of `.beast-mode/phase-handoff.md`
**DO** write each inbox item of the run into the inbox, per section 12 of `.beast-mode/phase-handoff.md`, and keep the agent running
**DO** remind the user that advanced agents use more tokens, so they can choose `/proceed` for the next phase if appropriate
