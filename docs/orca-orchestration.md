# Orca Orchestration

Orca orchestration runs Beast Mode work as Orca agent tabs. One fresh tab builds each phase of a feature. A step script decides each step. The tab that you start the command in only does the one action that the script names, then asks the script again.

Three commands make up the feature:

| Command | Does |
|---------|------|
| `/orca-setup` | Writes the `orchestration` settings of the project |
| `/orca-feature <feature-name \| epic/feature>` | Builds one feature, one tab per phase |
| `/orca-epic <epic-name>` | Builds a whole epic on its own branch, one feature after the other or side by side |

> **Status.** The step script has a full test suite over fixtures and temporary git repositories. The live Orca runs are `MANUAL`: no desktop has proven them yet (source facts O1 to O16 of the plan). Run one small feature first.

---

## What you need

1. **The Orca CLI.** The `orca` command must be on `PATH`, or `ORCA_CLI_COMMAND` must name it. The Orca app must run, because the tabs live in it.
2. **A coordinator in an Orca agent tab.** Start `/orca-feature` or `/orca-epic` in an agent tab of Orca. Orca wakes that tab when a worker tab reports. A coordinator outside Orca gets no wake, and the run cannot go on.
3. **Git.** The script creates one branch per run and commits on it.
4. **Node 20 or later.** The script is part of the `beast-mode` installer CLI (`beast-mode orca`).
5. **Beast Mode in the project, for each harness that a tab uses.** Each worker tab needs the Beast Mode files of its harness. `/orca-setup` offers only the agents that are installed and on `PATH`.

---

## `/orca-setup`

Run `/orca-setup` one time per project. A run command stops with `orchestration-missing` until the settings exist.

1. The command runs `beast-mode orca detect`. It finds the Orca CLI, the installed harnesses, and the current settings.
2. It asks which agent runs each stage, how often a commit runs, and whether lanes run side by side.
3. It suggests custom steps (see "Custom steps").
4. It writes the `orchestration` object of `.beast-mode/orca.json` with `beast-mode orca config --write`. The writer keeps every other key of the file in place, such as the `agents` of the launch settings. It refuses a bad value and leaves the file unchanged.

Commit `.beast-mode/orca.json`, so the team shares the settings.

### The `orchestration` object

```json
{
  "version": 1,
  "agents": { "dsh": { "command": "dsh-personal" } },
  "orchestration": {
    "stages": { "plan": "claude", "implement": "dsh", "verify": "dsh", "review": "claude", "docs": "dsh" },
    "commit": "phase",
    "concurrent": true,
    "backstopSeconds": 600,
    "statusEveryMinutes": 30,
    "steps": [
      { "after": "feature", "command": "/review-ux {feature}", "agent": "claude" }
    ]
  }
}
```

| Key | Value | Default | Problem code |
|---|---|---|---|
| `stages` | an object with only the five keys below | every default | `stages-not-object`, `stage-unknown` |
| `stages.plan` | `"claude"` or `"dsh"` | `"claude"` | `stage-agent` |
| `stages.implement` | `"claude"` or `"dsh"` | `"dsh"` | `stage-agent` |
| `stages.verify` | `"claude"` or `"dsh"` | the `implement` value | `stage-agent` |
| `stages.review` | `"claude"`, `"dsh"`, or `false` (no review) | `"claude"` | `stage-agent` |
| `stages.docs` | `"claude"` or `"dsh"` | the `implement` value | `stage-agent` |
| `commit` | `"phase"` or `"feature"` | `"phase"` | `commit-value` |
| `concurrent` | `true` or `false` | `true` | `concurrent-value` |
| `steps` | an array of at most 16 lines | `[]` | `steps-not-array`, `steps-too-many` |
| `steps[i]` | an object with exactly `after`, `command`, `agent` | none | `step-not-object`, `step-unknown-key` |
| `steps[i].after` | `"phase"`, `"feature"`, or `"epic"` | none | `step-after` |
| `steps[i].command` | 1 to 200 characters, starts with `/`, one line | none | `step-command` |
| tokens in `command` | see "Custom steps" | none | `step-token` |
| `steps[i].agent` | `"claude"` or `"dsh"` | none | `step-agent` |
| `backstopSeconds` | a whole number of seconds, 60 to 86400: the backstop timer of every wait | `600` | `backstop-value` |
| `statusEveryMinutes` | a whole number of minutes, 1 to 1440: the most often a quiet timer check posts a "still working" line | `30` | `status-every-value` |
| any other key in `orchestration` | refused | none | `orchestration-unknown-key` |

- `verify` and `docs` follow `implement` when the file names no value. A changed build agent therefore opens no surprise verify tab.
- The file rules shared with the launch settings keep their codes: `config-too-large` (64 KiB), `not-json`, `not-object`, `version` (exactly `1`), and for `agents.claude` and `agents.dsh` the codes `agents-not-object`, `agent-not-object`, `agent-env`, `agent-args`, and `agent-command`.
- The reader stops at 20 problems. Each problem names a code and a JSON path, such as `$.orchestration.stages.verify`.
- A file with no `orchestration` key is valid. A file with a problem makes `/orca-setup` show the problems and stop. Fix the file, or delete it, and run `/orca-setup` again.

---

## The stage order and where each stage runs

**One feature:**

1. The plan tab, when the feature has no plan.
2. Each phase: the phase tab, the verify and fix tabs (only for a split verify), the phase steps, and the phase commit.
3. The cross-phase review.
4. The feature steps, then the inbox tab when an inbox line is open.
5. The docs tab, then the summary.

**One epic:**

1. The epic branch.
2. For each Build Order item, each feature through the feature order. A lane then writes its feature docs, commits the feature end, and merges.
3. The epic steps, then the epic docs tab.
4. The summary, with no epic commit.

| Stage | Agent | Work |
|---|---|---|
| `plan` | `stages.plan` | `/plan-feature`, then `/start-feature`. The plan tab asks its questions in its own tab, so the user answers there. The coordinator waits. A question wake comes from the other stages |
| `phase` | `stages.implement` | One phase, by `.beast-mode/phase-handoff.md`. The phase tab is itself an orchestrator: it splits the phase into task groups and delegates each group to a project agent |
| `verify` | `stages.verify`, only when it differs from `implement` | The verification brief of the phase, then a verdict file |
| `fix` | `stages.implement` | The evidence of a `FAIL` verdict as the fix brief |
| `review` | `stages.review`, only when it differs from `implement` | `/review-feature`, findings only |
| `review-fix` | `stages.implement` | The open findings, fixed by group, with one verifier |
| `inbox` | `stages.implement` | The open lines of `inbox.md` |
| `step` | the `agent` of the step | One custom command, then a verdict file |
| `docs` | `stages.docs` | `/update-feature`, `/update-epic`, and `/update-master`. In an epic lane: `/update-feature` only |
| `epic-docs` | `stages.docs` | `/update-epic <epic>`, then `/update-master` |

- When `verify` equals `implement`, the phase tab verifies the phase itself. When they differ, a verify tab of the other agent checks the phase and writes the verdict (`PASS`, `FAIL`, or `BLOCKED`, the evidence, and a last `Demo:` line).
- A `FAIL` starts a fix tab, then a new verify tab. One phase gets at most three fix rounds. After the fourth `FAIL`, the run asks: stop, or one more round.
- A phase commits only after a `PASS`. A phase tab of the same agent that writes no verdict still commits. Only a `FAIL` or a `BLOCKED` verdict holds the commit back.
- When `review` equals `implement`, the review runs in the last phase tab. When it differs, a review tab and a review-fix tab run, then the review commit. `"review": false` runs no review.

---

## The cadence

`commit` sets when the script commits.

- **`phase`** (default). One commit after each phase, plus one commit for the review fixes. The subjects are `feat: <path> phase <n>` and `fix: <path> cross-phase review`.
- **`feature`**. `/orca-feature` makes no commit. The run ends with the changes uncommitted, and the summary lists them. In `/orca-epic`, a lane still commits once at its feature end, `feat: <epic>/<feature>`, because the merge needs a commit.

The script commits only through the cadence. It stages every change except the helper files under `.beast-mode/briefs/`.

---

## Branches and merges

| Run | Branch | From | Commits | Merge |
|---|---|---|---|---|
| `/orca-feature` | `feat/<epic>/<feature>` or `feat/<feature>` | the default branch | by the cadence | none |
| `/orca-epic` | `epic/<epic>` | the default branch | one `docs:` commit per merged feature that adds human tests | receives every lane |
| a lane, built one after the other | `feat/<epic>/<feature>` | `epic/<epic>` | as `/orca-feature`, plus the feature end | `--no-ff` into `epic/<epic>` |
| a lane, built side by side | the branch that Orca names for the child worktree | `epic/<epic>` | as above, inside the worktree | `--no-ff` into `epic/<epic>`, then the worktree goes away |

- The merge subject is `Merge <epic>/<feature> into epic/<epic>`. The human test commit is `docs: <epic>/<feature> human testing`.
- The default branch is the target of `origin/HEAD`, else `main`, else `master`. With none of them, the run stops `no-default-branch`.
- **A foreign branch.** A run that starts on a branch of its own work, or on a `feat/<epic>/<feature>` branch that `epic/<epic>` does not hold, stops `branch-foreign`.
- **A dirty tree.** A start with uncommitted changes asks first: go on with them, or stop.
- **A merge conflict.** The script aborts the merge, stops `merge-conflict`, and names the files. You resolve the conflict by hand.
- Each lane branch carries git config keys (`beast-mode-base`, `beast-mode-epic`, `beast-mode-feature`, `beast-mode-merged`). They tell a later run which lane is merged.
- The feature branches stay after the merge, for you to delete.
- `/orca-epic` adds each feature with human tests to `human-testing.md` of the epic as the lane merges, and it adds the demo line of each slice.

---

## Concurrency and the Build Order rule

`/orca-epic` reads the numbered items of the `## Build Order / Dependencies` section of `epic-overview.md`.

- One numbered item is one group. The bold names in the item are the features of the group.
- The groups run in order. The features of one group build at the same time when `concurrent` is `true` and the group holds two or more features left to build.
- Each side-by-side feature builds in its own child worktree, on its own branch from `epic/<epic>`. The conductor merges every lane of a group into `epic/<epic>` and removes its worktree before the next group starts.
- `/plan-epic` writes the Build Order in this form, and `/update-epic` keeps it. Put the features that need nothing from each other in one item.
- A feature folder that no item names, or a name in two items, stops the run with `build-order`. Fix `epic-overview.md` and run again.
- A feature built outside the run, with its tasks at 100 percent and no branch, leaves the run list.

A group builds one feature after the other, in the main workspace, in these cases:

- `concurrent` is `false`.
- The group holds one feature.
- Orca refuses to create a worktree. The run then stops `lane-worktree-refused`, and the fix line names the command that clears the mark. The marked lane builds in the main workspace, and its whole group builds in sequence. The mark stays until you delete the lane record.

A side-by-side lane needs `.beast-mode/phase-handoff.md` committed on `epic/<epic>`, because the worktree holds only committed files. A project that does not commit `.beast-mode/` stops `beast-mode-uncommitted`. Commit the directory (the briefs folder stays out), or set `"concurrent": false`.

---

## Custom steps and tokens

A **step** is one command that a worker tab runs at a point of the run. The tab writes a verdict file. A line of `steps` holds three parts:

| Part | Rule |
|---|---|
| `after` | `phase`, `feature`, or `epic` |
| `command` | Starts with `/`, one line, 1 to 200 characters. May hold tokens |
| `agent` | `claude` or `dsh` |

| Token | Valid after |
|---|---|
| `{feature}` | `phase`, `feature` |
| `{phase}` | `phase` |
| `{epic}` | `epic` |

Example: `{ "after": "feature", "command": "/review-ux {feature}", "agent": "claude" }`.

- A phase step runs after the verify gate and before the phase commit. A feature step runs after the review commit and before the inbox. An epic step runs after the last lane merge and before the epic docs tab. A step with `after: "epic"` runs only in `/orca-epic`.
- The tab writes a verdict file. A `PASS` verdict closes the step. A `FAIL` or a `BLOCKED` verdict asks you: stop, or go on (the step is recorded `overridden`).
- A step that has run is not run again. A start of new work for a phase clears the step marks of that phase, so its steps run again.
- `/orca-setup` suggests steps from the current lines, the project skills, the lines that you added to an edited autorun skill, and the Beast Mode review commands.

---

## Project agent commands

The `agents` object of `.beast-mode/orca.json` belongs to the launch settings of the Orca panel. A project command there changes how a tab starts:

```json
{ "version": 1, "agents": { "dsh": { "command": "dsh-personal" } } }
```

- With `agents.dsh.command` set, the tab of the `dsh` agent starts a terminal with that command, waits until it is ready, and attaches the worker to it. This is how a dsh profile reaches the tab.
- `/orca-setup` asks no question about commands. Edit `agents` by hand or in the launch settings.
- A start result `ready-unconfirmed` means that Orca did not confirm the ready state. It is not a fault, and the run goes on.
- A failed start leaves its terminal open. Close it in Orca.
- Each first start gives the Orca Task a short title (`--task-title`), and Orca shows it as the tab title, for example `nebula-light: Phase 2 implement`, `nebula-light: review fixes`, or `map-view: epic docs`. The feature name comes first, so the tabs of one run sort together, and the title has at most 60 characters. Orca opens the worker tab of the agent path with the fixed title `worker-<taskId>`, and that title protects the tab from the Task title. So after every good start that has a terminal handle, the step runs `terminal rename` with the same title, and the result holds `tabTitled: true` or `false`. A failed rename never fails the start. On the command path, the rename runs after the Enter loop of a dsh tab, so it never delays the prompt. A retry opens a new tab, and the step renames it too. A start with no terminal handle runs no rename. The rename does not change the agent status of the worker.
- Orca does not own a terminal that the project command opened, so it leaves the tab open after `worker-release`. The `close` step (and the `merge` step of a lane) closes that terminal with `terminal close --terminal <handle>`, only when the run record shows that the start opened it. A start, a retry, and an agent-path tab never close a terminal. When the close fails, or when Orca refuses to release the dispatch (the worker can still run), the step stays good, closes no terminal, names the tab, and says that the tab stays open for you to close in Orca.

A dsh tab refuses Enter until its session opens, and it keeps the prompt as a draft. Orca presses Enter only one time. So after each good start of a dsh tab, with or without a project command, `start` reads the tab and presses Enter every 2 seconds until the turn starts. It stops after 45 seconds, and it presses nothing while the tab waits on a person. A Claude Code tab gets no extra Enter. The start result names `submit`: `confirmed` or `unconfirmed`. `unconfirmed` is not a fault. When the prompt is still a draft in the tab, press Enter there yourself.

A dsh tab that starts a subagent ends its turn at once. dsh brings the result in as a new turn later, often after 15 minutes or more, and Orca reports the turn end as an escalation. So before `next` sends the resume text to an idle dsh tab with open work, it reads the file times of the session folders of that workspace in the dsh home. When a subagent session of the tab wrote in the last 10 minutes, `next` gives `wait`, sends nothing, and counts no escalation. The session of the tab, an older session, and the session of a coordinator on dsh never count. The dsh home is the first `DSH_HOME=` line of the script that `agents.dsh.command` names on PATH, for example `export DSH_HOME="$HOME/.dsh-personal"`, else the `DSH_HOME` of the environment, else `~/.dsh`. The launch rules refuse an `env` key in `agents.dsh` (`agent-env`), so set the home in that script. When a dsh tab stays idle and no subagent runs, say "resume" to the coordinator.

---

## The steps and the actions of `beast-mode orca`

You never run these steps by hand in a normal run. The commands run them. They are here for debugging.

Every step prints one JSON object with `"schema": 1` and nothing else. Every decided outcome exits 0, a refusal included. A usage error exits 2.

| Step | Does |
|---|---|
| `next` | Reads the docs, git, the run record, and the Orca state. Prints the next action. Writes nothing |
| `branch` | Creates or switches to the run branch, and writes the config keys |
| `start` | Writes the spec of a stage and starts its tab |
| `close` | Releases a tab and records its end |
| `commit` | Stages and commits by the cadence |
| `merge` | Merges a lane into the epic branch and removes its worktree |
| `send` | Sends a worker a message: open tasks, a resume, a report request, or a missing verdict |
| `reply` | Answers a question of a worker |
| `note` | Writes a user message to the inbox, or sends it to the running tab. A tab that has ended its work (Orca reads its worker settled) gets no send, so no follow-up dispatch starts behind an ask or a close |
| `detect` | Reads the machine and the settings for `/orca-setup` |
| `config` | Prints the settings. With `--write <file>`, writes the `orchestration` object |

Every step takes `--project <dir>` and `--plugin-root <dir>`.

`next` answers with one action:

| Action | The coordinator does |
|---|---|
| `branch`, `start`, `send`, `commit`, `merge` | Runs the `run` line, then calls `next` |
| `close` | Prints the slice block, runs the `run` line, then calls `next` |
| `wait` | Ends its turn. Orca wakes it when a worker reports |
| `ask` | Asks you in one plain chat message, ends its turn, and runs the line of the option that you pick |
| `question` | A tab asked a question that has no answer yet. Shows it to you as a question wake, ends its turn, and sends your answer with `reply` |
| `stop` | Shows the reason, the detail lines, and the fix, and ends the run |
| `done` | Prints the summary, and ends the run |

The coordinator never composes a command. It runs a line that the script gives it. It starts no tab of its own, and it uses no git command.

A step refuses with `"ok": false` and a `code`. These refusals guard the tab and the record:

- `start`, `commit`, and `merge` refuse `tab-active` while a tab of the work still runs. A refused `merge` releases no tab.
- `record-unreadable`: the run record exists and cannot be read or parsed. A step never reads it as absent.
- `record-unwritable`: the run record cannot be written after a good start. The step exits 1. The result names the dispatch, the Task, and the agent. The coordinator ends the run, and you check Orca for the tab.

### The run summary

The `done` action prints the summary. Each phase line ends with the verify result, for example `verified PASS after 2 fix rounds`. A `Steps:` block lists the result of each custom step, and a step recorded `overridden` comes first. The epic summary holds the same `Steps:` block, and a `Verify:` block with one line for each phase.

### Your messages during a run

Type a fault, a change, or guidance at any point of a run. The coordinator writes one line to `inbox.md` (or sends the text to the running tab) and answers `Noted, handled after this phase.` It never interrupts a tab. A question gets a short answer and no line. A request to stop calls `next --stop`: the run stops at the next safe point. A medium or a large change becomes a question or a stop, by `.beast-mode/phase-handoff.md`.

---

## Resume

The docs, git, and the Orca state are the state of record. The run record under `.beast-mode/briefs/` is a helper that names the active tab. An absent record costs at most one repeated stage. A record that exists and cannot be read or parsed stops the run (`record-unreadable`). It never reads as absent, because a new start would open a second tab on the same work.

- When the run ends, or the coordinator tab closes, run the same command again: `/orca-feature <path>` or `/orca-epic <epic>`. The script reads the real state and goes on.
- While a tab of the run still works, a second run stops `tab-still-runs` and names the tab. Wait for that tab, then run the command again.
- A tab that Orca lost gives a question: open a new tab for the work, or stop.
- A failed start gives a question: retry, or stop. After three failed starts of one chain, the run stops `circuit-broken`.
- A start with an unknown result gives the question `start-unknown`: stop (recommended), or clear. The start timed out, or the record write failed after a good start, so a tab can be open. Check Orca for a new tab of the work first. The run offers no retry, because a retry can open a second tab.
- A worker that sends more than one escalation gets a stop or a new tab, by the proof in the docs. When its open items dropped since the last resume text, the count starts again, so a worker that makes progress gets the resume text again.
- A deleted run record loses the guard against a second tab that still works. Check Orca for open tabs before you run again. Move an unreadable record away only after that check.

---

## What the run never does

- No push, pull, fetch, rebase, reset, stash, clean, or tag. No branch deletion.
- No `--force` and no `--no-verify`.
- No merge into the default branch, and no commit on it.
- No change to a shared or production environment.
- No git command by the coordinator. The script owns every git call. A static test pins the verbs `push`, `pull`, `fetch`, `rebase`, `reset`, `stash`, `clean`, and `tag`, the delete flags, `--force`, `--no-verify`, and `shell: true`. A runtime test checks every argument of every git and Orca call. The static list does not hold `checkout` of a path.
- No other Beast Mode command by the coordinator. The tabs run them.
- No wait loop. The end of the coordinator turn is the wait.
- No call from an autorun flow. `/autorun-feature` and `/autorun-epic` do not call these commands.

You push the branch and open the pull request yourself.

---

See also: [Command Reference](command-reference.md), [Multi-harness guide](multi-harness.md), and the command bodies in `templates/skills/orca-setup/SKILL.md`, `templates/skills/orca-feature/SKILL.md`, and `templates/skills/orca-epic/SKILL.md`.
