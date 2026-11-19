---
name: autorun-feature
description: "Autonomously run a feature to completion: plan (if needed), start, then per phase implement, verify (the browser automation tool for UI), end with a cross-phase review, /update-feature, and /update-master. Epic-aware;Usage: /autorun-feature <feature-name | epic/feature>"
argument-hint: "<feature-name | epic/feature>"
user-invocable: true
---

You have been asked to run a feature to completion autonomously. This command drives the full lifecycle — plan (if needed) → start → phase-by-phase build → cross-phase review → docs — end to end, with as little human intervention as possible, stopping only when genuinely blocked.

**Feature name:** first argument from `$ARGUMENTS` (kebab-case). May be a plain feature, or a feature inside an epic referenced as `<epic>/<feature>`.

- `/autorun-feature <feature-name>` — run that feature.
- `/autorun-feature` (no arg) — use the current in-progress feature from this conversation. If unclear, list `docs/features/*/` directories whose `tasks.md` is not 100% complete and ask which one.

---

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
epic folders for bare names, and load epic context (the `epic-overview.md` + all sibling features) when the target is a feature inside an epic.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution — this command does **not** re-specify those rules. Two consequences for everything below:

- **Path rewriting.** When the target feature lives inside an epic, **every `docs/features/<feature-name>/...` path in this command resolves to its nested `docs/features/<epic>/<feature>/...` location** — the precondition checks, `requirements.md`, `implementation.md`/`context.md`/`tasks.md`, `code-review.md`, and all verification reads/writes use the nested path. When you fuzzy-resolve a bare name into an epic, **announce** the resolved `<epic>/<feature>` before proceeding.
- **A bare epic name is not a single buildable feature.** If the argument is a folder that has `epic-overview.md`, list the epic's child features and ask the user to choose — in a **single** batched question — which child to run, offering the option "run the whole epic in build order" as well. This is the one allowed scope-clarification stop before the build. After the answer, proceed autonomously: a single child → run `<epic>/<feature>`; whole-epic → run the `/autorun-epic <epic>` command, which runs the whole epic in build order. `/update-master` still rolls the epic up to a **single** row (never lists its child features individually). In the called mode a bare epic name is an error: write it into the `Blockers` section of the report, and end the run.

---

## Phase handoff

Before you start a subagent, read `.beast-mode/phase-handoff.md` and apply its rules:
split the phase into task groups, write the phase brief, and put the stop rule and
the tool rules into the prompt. Read `.beast-mode/tool-rules.md` once per run, and
paste its `## Tool rules` section into every subagent prompt. Apply its delegator
rules and its verification brief too.
`.beast-mode/phase-handoff.md` is the single source of truth for the handoff; this
command does not restate those rules.

---

## CRITICAL SAFETY RULES (read first, never violate)

These override any momentum to "just finish":

1. **Never rebuild, restart, or touch any shared/production environment.** No restarting services, no building or deploying to a server. Local type-check / lint / test / build for verification only.
2. **Stop and prompt the user** the moment you hit a true blocker (see "When to stop and prompt"). Do not guess past irreversible or ambiguous situations.

---

## Operating mode

This command runs in **autonomous mode**:

- **Do not stop between phases to wait for the user to test.** Verify each phase yourself. Show the test prompt of each slice per step 5e, then move on. Do not wait.
- **Do not pause for confirmation between routine steps.** Make the reasonable call and continue.
- **Reasonable defaults beat questions.** If a small choice comes up mid-implementation, pick the option most consistent with the plan and existing patterns, and continue.
- **Advanced-agent selection is never a stop reason.** When the plan marks a phase ADVANCED (or a task is load-bearing), use the advanced tier and keep going — do **not** ask. This is the key difference from `/proceed`, which stops to confirm before going advanced; the user opted into the full autonomous run, advanced token spend included.
- **Keep the inbox.** Apply section 12 rule 3 of `.beast-mode/phase-handoff.md` to each user message of the run. For each item, write the inbox line, give the answer of rule 3, and go on.
- **Only stop if something genuinely blocks you** — see "When to stop and prompt" below.

---

## Orchestration model (same discipline as /proceed)

- **DO NOT implement phases yourself.** Always delegate implementation to agents, to keep your own context clear for orchestration.
- **One agent at a time.** No parallel implementation agents within a phase. One agent runs one task group, and the groups of a phase run in order. You may spawn short read-only agents for lookups.
- **Choose the best agent for the work** — match it to your project's available agents (e.g. a backend agent for server work, a frontend agent for UI, a testing/integration agent for E2E, or a general-purpose agent for mixed/architectural work). Beast Mode projects expose two tiers per domain: a **standard** agent (`sonnet`, at the preset effort) and an **advanced** `*-advanced` variant (`opus`, at the preset effort).
- **Follow the plan's tier.** `implementation.md` marks each phase `Agent tier: ADVANCED (opus)` or `STANDARD (sonnet)` and `tasks.md` flags advanced phases in the header. Load-bearing work (sync engines, auth/security, concurrency, schema/data-consistency) and any phase the plan marks ADVANCED MUST route to the matched **`*-advanced`** agent — automatically, no prompt. If the project has **no** `*-advanced` variant for that domain, fall back to the standard agent, note the fallback in `context.md`, continue, and mention `/upgrade-beast-mode` (which creates the advanced agents) in the final report. A missing advanced agent is **not** a blocker.
- **Update `tasks.md` and `context.md` between every phase** if the agent did not.

---

## Process

### 1. Verify preconditions (HARD STOP if any fail)

- **Feature folder exists.** `docs/features/<feature-name>/` must exist. If not, stop and tell the user exactly what's missing and where it should live.
- **A starting point exists.** The feature needs **either** `requirements.md` (this command will plan from it) **or** an existing `implementation.md` (already planned). If neither exists, stop and tell the user to write `requirements.md` (or run `/plan-feature <feature-name>`) first — do **not** invent requirements yourself.
- **A feature branch is checked out.** The feature gets its own branch. The working tree must be clean and up to date with the remote. When the branch does not exist, create it from the default branch: `feat/<epic>/<feature>` for a feature inside an epic, else `feat/<feature-name>`. **Make no commit and no push.** The user commits, pushes, and opens the PR.

The browser automation tool is **not** a hard precondition — it's checked lazily, only when a phase actually has UI to verify (step 5c). Backend-only / library / CLI features never need it.

If preconditions pass, briefly confirm what you found and continue. Do not ask permission to proceed — the user invoked the command, that *is* the permission.

### 2. Read the plan (or requirements)

Read the feature's docs end-to-end to load the phase structure and decisions:

- If `implementation.md`, `tasks.md`, and `context.md` exist, read all three.
- Otherwise read `requirements.md`.
- Read the project instruction file (`CLAUDE.md`, or `AGENTS.md` when present) for project conventions (dev URL, test credentials, tech stack, commit conventions, browser rules).
- Glance at `docs/features/` siblings to learn the project's feature-doc conventions.
- **If the feature lives inside an epic** (resolved above), load the epic context per `.beast-mode/epic-resolution.md` §4 first — the epic's `epic-overview.md` + `epic-requirements.md` and **every sibling feature's** `implementation.md`/`context.md` — so planning and verification respect the epic's build order and don't contradict siblings.

### 3. Plan (only if no `implementation.md`)

**If `implementation.md` already exists:** skip to step 4. Trust the existing plan; do not re-plan.

**If it does NOT exist:** run the project's `/plan-feature <feature-name>` skill, using the requirements you just read as the initial prompt. The interview of `/plan-feature` asks the open set in rounds, per `.beast-mode/interview.md`, and it ends with the stop check. Ask no other planning question. The research choice and the approach choice of `/plan-feature` are control choices, per section 3 of `.beast-mode/interview.md`. They run as written. When `/plan-feature` produces a plan, **do not** stop at its "wait for approval" step — treat the plan as approved and continue (this command's contract is to build the whole feature in one go).

### 4. Start the feature (only if no `tasks.md`)

If `context.md` and `tasks.md` don't yet exist, run the project's `/start-feature <feature-name>` skill to scaffold them from `implementation.md` and flip the status to In Progress. If they already exist, treat the feature as resumed — do **not** overwrite; continue from the first incomplete phase.

### 5. The per-phase loop

Repeat for each incomplete phase in `tasks.md`, **in order**:

**5a. Implement.** Split the phase into task groups, and write one brief for each group, per `.beast-mode/phase-handoff.md`. Delegate to the best agent at the plan's tier, one agent for one task group. The prompt names the brief path, and it holds the pasted `## Tool rules` section and the stop rule. It also holds the inbox sentence, per part 5 of section 7 of `.beast-mode/phase-handoff.md`. Tell the agent to run the project's type-check or build, and to stay inside the scope of the brief. Start the agent of the next group only after the first agent returns.

**5b. Automated gate (must pass before continuing).** You run no gate command yourself. First, run the fix brief of the open `bug` lines, per part 1 of section 10 of `.beast-mode/phase-handoff.md`. Delegate it to the phase agent. Then write the verification brief of the phase, per `.beast-mode/phase-handoff.md`, and delegate it to one verifier subagent. The brief names:
- The project's type-check / lint / build for every package or area touched, and the relevant tests for the touched code.
- For UI phases, a production build or dev-server boot with no errors, and the relevant dev log for compilation errors / runtime exceptions introduced by the phase.
- The Demo line of the phase, under `## Demo`.
- The UI check of 5c, when the phase has one.

The verifier returns `PASS`, `FAIL` with the error text, or `BLOCKED`. It also returns one demo result, per section 9 of `.beast-mode/phase-handoff.md`. A `FAIL` follows part 1 of section 10. Run up to three fix rounds, with the verifier after each round. Do not read the source to find the cause yourself. If it still fails and the verifier cannot determine the fix, STOP and prompt with the exact error.

**5c. UI verification with the browser automation tool.** When the phase added or changed user-facing UI, the verifier subagent does this check. It reads the `## UI check` section of the brief. Put these items into that section:
- The acceptance criteria of the phase from `implementation.md`, which name a screen or an interaction. The verifier opens that screen with the browser automation tool. It confirms that the screen renders, it reads the console and the network log for errors, and it exercises the key interaction of the phase.
- The documented method of the project to bring the dev environment up, when it is not up already.
- **The browser rules of the project instruction file** (`CLAUDE.md`, or `AGENTS.md` when present): the dev URL, the test credentials, the tab reuse rule for a browser prone to OOM, the memory limits, and when to close the browser. The verifier opens the browser for this check only, and it closes the browser when done.
- One note: a preview with "no data" or a 401 is usually an auth gap, not a bug. The verifier signs in to the app in the same browser (same-origin session).

**When the verifier returns BLOCKED** (no browser automation tool in this session, the feature is not reachable, a sign-in it cannot complete, or an ambiguous result that needs a human eye), STOP and prompt. Say what the verifier checked, what blocked it, and the smallest thing you need (for example "log in to the app in your browser", "deploy this branch to a preview", "confirm the layout looks right"). Resume once unblocked.

A backend-only phase skips this step. The brief names targeted API or `curl` calls, or a focused integration test, instead.

**5d. Update docs.** Mark the phase's tasks `[x]` in `tasks.md`, update the `Progress:` count/percent, and update `context.md` (What's Done / What's Next / a session note + any non-obvious decisions). Use the edit tool for both files, never a whole file write. Add each item that still needs a human eye to the `## Needs Human Verification` section of `context.md`, as one `- [ ]` line. Add the section when the file has none.

**5e. Hand the slice to a person.** Run part 3 of section 10 of `.beast-mode/phase-handoff.md`, in its autorun form. Add no demo line that `context.md` already holds. A phase with no demo follows part 4 of section 10.

**5f. Read the inbox.** Run part 5 of section 10 of `.beast-mode/phase-handoff.md`. When part 5 sends the step back to part 1, run steps 5b to 5f again.

**5g. Next phase.** Repeat until all phases in `tasks.md` are complete.

### 6. After the final phase

1. **Cross-phase review.** Run the `/review-feature <feature-name>` command against the whole feature. It writes `code-review.md` with `CR-N` findings.
   - Work every unchecked finding in priority order. Split the findings into the code review groups of `.beast-mode/phase-handoff.md`, and write one fix brief per group. The brief file name is `review-g<n>.md`, in the brief folder of the feature. Delegate one agent at a time, as in 5a.
   - A finding that you do not fix (a false positive, or out of scope) gets a reason in `code-review.md`. Then check it off. Never skip a finding silently.
   - After the last group, run the verifier once, as in 5b and 5c. A `FAIL` goes through the fix rounds of 5b.
   - Mark each fixed finding `- [x] CR-N` in `code-review.md`.
2. **Read the inbox once more.** Right before `/update-feature`, run step 5f once more. It acts on each line written after the last step 5f, per section 12 rule 3. When it leaves an open task in `tasks.md`, go back to step 5. Run this item again last, right before the final summary or the report, for each line written after it.
3. **`/update-feature <feature-name>`** — refresh the feature docs with the final state (set `implementation.md` `Status:` to the project's done state, e.g. `Ready for Review`).
4. **`/update-epic`** — update the epic overview if this feature is in an epic.
5. **`/update-master`** — update the project master overview / index / changelog (an epic rolls up to a single row).
6. **Final summary** to the user:
   - Phases completed, with the demo result of each slice.
   - The review findings fixed, and the findings left with a reason.
   - The inbox: the lines done in the run, and each open line.
   - What was UI-verified with the browser automation tool vs the `## Needs Human Verification` section of `context.md`.
   - Any phase completed with caveats, and any remaining open items / tech debt logged. Surface anything you couldn't auto-fix as a clearly labelled "⚠️ Known issues" list rather than silently shipping.
   - **Next steps for the user:** test the `## Needs Human Verification` items, then commit, `git push`, and open a PR. This command makes no commit and no push on purpose. The branch is yours to ship.

---

## When called by /autorun-epic

`/autorun-epic` delegates one feature to a `feature-orchestrator` agent, and that agent runs this command. The caller prompt states the sentence "You are called by `/autorun-epic`". That sentence is the only signal of **the called mode**. Every step above runs as written, apart from the seven differences below.

1. **No git write.** Make no commit, no branch, and no push. The caller owns every git action. The caller created the branch and checked it out, and the tree can hold work in progress — a resumed `/autorun-epic` run delegates on a dirty tree on purpose. **Treat precondition 3 of step 1, the feature branch, as met, and check no tree state.**
2. **Draft the next plan.** When the caller names a next feature, delegate to the `solution-architect` agent after the cross-phase review of step 6, before `/update-feature`. **Delegate only when `docs/features/<epic>/<next-feature>/implementation.md` does not exist** — a plan that exists stays as it is, and the report's `Next feature draft` section reads `written`. Give the architect the epic context, the `requirements.md` of the next feature, and the real state of the feature that just finished. Paste section 11 of `.beast-mode/phase-handoff.md` into the prompt, word for word, as the **Slice rules** block of `/plan-feature` Step 7. The architect writes `docs/features/<epic>/<next-feature>/implementation.md`. Collect the open scope questions of the draft for the report.
3. **Ask nothing.** You run inside an agent, and an agent has no way to reach the user. Where a step above stops and asks, write the ask into the `Blockers` section of the report, and end the run.
4. **End with the report.** Return the report shape that the `feature-orchestrator` agent file states: the eight sections, in that order, with the word `none` in an empty section. Write no final summary of step 6, and no next-step line.
5. **Skip the rollup.** In step 6, run the cross-phase review, the inbox read, and `/update-feature` only. Skip `/update-epic` and `/update-master`. Step 7 of `/autorun-epic` runs both once, at the end of the run.
6. **Show no test prompt.** In step 5e, run the called-mode form of part 3 of section 10 of `.beast-mode/phase-handoff.md`. Append the demo line of each slice to `docs/features/<epic>/human-testing.md`, as that form states.
7. **Keep the plan.** In step 5f, a medium or a large change becomes a blocker, per section 12 rule 11. Never edit `implementation.md` for an item.

---

## When to stop and prompt the user

Stop the autonomous loop and ask, rather than guessing, when:

- **A precondition fails** (no feature folder; neither `requirements.md` nor `implementation.md`).
- **Planning needs user input** at the interview of step 3, which `/plan-feature` runs per `.beast-mode/interview.md`. Ask no other planning question, and proceed when the interview ends.
- **A bare epic name** needs a child/whole-epic choice (the one allowed scope stop before the build — see Epic awareness).
- **Browser verification is blocked** (the browser automation tool is unavailable, the app is unreachable, login is needed, or an ambiguous result needs a human eye) — per step 5c.
- **The automated gate keeps failing** after three fix rounds on the same root cause and you cannot determine the cause.
- A phase needs a **credential, external account, or manual prerequisite** that is not in place (mock or defer it, and flag it).
- An action would be **irreversible or outward-facing** (any commit, push, tag, deploy, external API write to a real account, or deleting/overwriting something you did not create).
- A `git pull`/rebase hits a **conflict**, or the working tree has **unexpected unrelated changes**.
- **The plan is fundamentally wrong** for the requirements — revisit planning rather than power through.
- **An inbox change needs the user** at step 5f. A medium change needs its scope answer, per section 12 rule 9. A large change stops the feature, per section 12 rule 10.
- A depended-on skill is **missing** (`/plan-feature`, `/start-feature`, `/review-feature`, `/update-feature`, `/update-master`) — tell the user this command depends on it.
- **In the called mode, a stop is a blocker.** Write the ask into the `Blockers` section of the report, then end the run. Do not ask the user.

When you stop, state precisely: what you were doing, what blocked you, and the smallest thing you need from the user to continue. Then wait.

---

## Notes

- Keep the orchestrator context lean: delegate, summarise agent results, do not paste whole files back. The delegator rules of `.beast-mode/phase-handoff.md` state what you read and run yourself.
- **Orchestrator, not coder** — you run the loop and keep context clean; agents write the feature, one at a time.
- Honour all standing project rules in the project instruction file (`CLAUDE.md`, or `AGENTS.md` when present) — commit conventions, no hardcoded config values, migration checks, and code style. Mirror existing patterns. Use the project's own skills (`/plan-feature`, `/start-feature`, …) — don't reimplement them inline.
- **Honor `requirements.md`/`implementation.md` as the source of truth.** If you find yourself drifting outside scope, stop and check with the user before expanding.
- This command is resumable: if interrupted, re-invoking `/autorun-feature <feature-name>` picks up from the first incomplete phase in `tasks.md`.
