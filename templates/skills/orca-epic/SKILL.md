---
name: orca-epic
description: "Run a whole epic to completion in Orca. A step script builds each feature of the Build Order on its own branch, one fresh agent tab per phase, and merges it into epic/<epic>. This tab ends its turn while a tab works. Usage: /orca-epic <epic-name>"
argument-hint: "<epic-name>"
user-invocable: true
---

You have been asked to run a whole **epic** in Orca, one fresh agent tab per phase. This tab is the **conductor** of the run. The step script decides, and the tabs work:

- `beast-mode orca next --epic <epic>` reads the docs, git, the run records, and the Orca state. It prints the next step as one JSON action.
- You do that one action, and you call `next` again.
- An Orca agent tab runs each stage of each feature. That tab is the orchestrator of its stage.

The script builds the features in the Build Order of `epic-overview.md`. Each feature builds on its own branch, and the script merges that branch into `epic/<epic>`. The default branch does not move.

You run no phase, no other Beast Mode command, and no git command. You run no Orca command, apart from the read command that a wake names.

**Epic name:** first argument from `$ARGUMENTS` (kebab-case, for example `editor`). The target is an epic folder, not a feature.

- `/orca-epic <epic-name>`: run that epic.
- `/orca-epic` (no argument): list every folder of `docs/features/` that holds `epic-overview.md`, and ask which one, by the ask rule. With no such folder, end the run, and point the user at `/plan-epic` or `/create-epic`.

Run this command in an Orca agent tab. Run every command from the project root.

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
epic folders for bare names. The target of this command is an epic: a folder that holds `epic-overview.md`. Pass the bare epic name to the step script. The script builds the child features in the Build Order of `epic-overview.md`. It builds the features of one Build Order item side by side when the `concurrent` setting of `.beast-mode/orca.json` allows it. A plain feature or an `<epic>/<feature>` reference stops with a pointer to `/orca-feature`.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. This command does **not** re-specify those rules. Two consequences for everything below:

- **The epic name.** `<epic>` below is the name of the epic folder. Pass it bare, as `--epic <epic>`. You load no epic context, because each tab loads it.
- **A feature is not an epic.** When the argument names a feature, end the run before the first step. Point the user at `/orca-feature <path>`, with the resolved path. These arguments name a feature:
  - an `<epic>/<feature>` reference.
  - a plain feature, a folder with no `epic-overview.md`.
  - a bare name that the fuzzy fallback finds inside an epic.

---

## The loop

1. **Start.** Run a shell command: `beast-mode orca next --epic <epic> --fresh`. When the shell finds no `beast-mode`, use the absolute form of the CLI from the `## Notes` section of `.beast-mode/harness.md`. Use the same form for every later `next` call.
2. **Read the action.** When the command exits with a code that is not 0, end the run, and show the output as it is. Else read the one JSON object that it prints. When its `schema` is not `1`, end the run by When to stop. Else show its `say` line, keep the inbox feature by The message from the user, and act by the table.
3. **Act by the table.**

| Action | You do |
|---|---|
| `branch`, `start`, `send`, `commit`, `merge` | Run the `run` line by step 4. Then call `next` by step 5. |
| `close` | Print `show` as written, when it is not null. Run the `run` line by step 4. Then call `next` by step 5. |
| `wait` | Show each running tab: its `feature`, `stage`, `phase`, and `worktree`. Then end your turn. Orca wakes you, by The wake. |
| `ask` | Ask by the ask rule, and end your turn. |
| `stop` | Show `reason`, each line of `detail`, and `fix`. End the run. |
| `done` | Print `show`, the summary block, as written. It lists the worktrees in its `Worktrees:` block. End the run. |

4. **Run a `run` line.** Run a shell command with the `run` line exactly as written. Change no character, and add no flag. When the exit code is not 0, end the run, and show the output as it is. Else read the one JSON object that it prints, check its `schema` as in step 2, and show its `say`. A refusal (`"ok": false`) is a decided outcome: show its `detail` lines, and go on to step 5.
5. **Call `next`.** Run a shell command: `beast-mode orca next --epic <epic>`, in the form of step 1. Then go to step 2.

Pass `--fresh` on the first call of a run only. A later `--fresh` call stops the run while a tab works.

Several tabs can run at once, one for each feature of a Build Order item. One `wait` action lists every running tab in `workers`. Each entry holds `feature`, `stage`, `phase`, `agent`, `dispatchId`, and `worktree` (an absolute path, or null). Each tab after the first runs in its own worktree.

Every action holds the epic name in its `epic` field. An action of one feature holds the `<epic>/<feature>` path in its `feature` field. An action of the epic itself holds no feature path: the `branch` action of `epic/<epic>`, and each action of the epic docs tab.

---

## The run order

The script runs the epic in this order. You do not choose a feature or a stage. `next` names them in each action, and the tabs do the work.

1. **The epic branch.** `branch` creates `epic/<epic>` from the default branch, or switches to it.
2. **The features.** The script reads the Build Order of `epic-overview.md`. A merged feature leaves the run list, and so does a feature built outside this run. For each feature of the run list, in Build Order:
   1. `branch` creates the lane branch `feat/<epic>/<feature>` from `epic/<epic>`, or switches to it.
   2. The tabs of the feature run: a plan tab when the feature has no plan (it asks its questions in its own tab, so the user answers there, and you wait), a tab for each phase, the review, and an inbox tab. The docs tab of a feature runs `/update-feature` only. Each phase follows the verify rules below.
   3. `commit` makes the feature-end commit, `feat: <epic>/<feature>`, when the work tree holds changes.
   4. `merge` merges the lane branch into `epic/<epic>`, with `--no-ff`. For a lane in a worktree, `merge` also removes the worktree. When Orca refuses the removal, the run goes on, and the result says to remove it in Orca. Then it adds the open human tests of the feature to `docs/features/<epic>/human-testing.md`, and commits them.
3. **The epic docs.** An epic docs tab runs `/update-epic <epic>`, then `/update-master <epic>`. It makes no commit.
4. **`done`.** The summary block. The run makes no epic commit, and it never merges into the default branch. The user merges `epic/<epic>`.

**The verify rules of a phase.** They are the same in each lane:

- `stages.verify` equal to `stages.implement`: the phase tab verifies the phase itself.
- A different agent: a **verify tab** of that agent runs after the phase tab. It writes the verdict file (`PASS`, `FAIL`, or `BLOCKED`, with the evidence and a last `Demo:` line).
- A `FAIL` starts a **fix tab** of the build agent (`stages.implement`). Then the verify tab runs again. The run makes at most three fix rounds for one phase.
- After the fourth `FAIL`, the ask `verify-fail-cap` offers stop (recommended), or one more fix round. A `BLOCKED` verdict gives the ask `verify-blocked`: stop, or retry. A verify tab that ends with no verdict gives the ask `verify-missing`, after one send.
- The phase commits only after a `PASS` verdict.
- The `close` action that ends a phase holds the **slice block** in `show`. It has a `Verifier: Demo <PASS|FAIL|MANUAL>` line. Print `show` as written.

A `start` action of the stage `step` runs one configured command in its own tab, with a verdict file. Treat it as any other `start` action. A `FAIL` or `BLOCKED` verdict gives an `ask` with the reason `step-failed`: stop (recommended), or go on (the step is recorded `overridden`). A step with `after: "epic"` runs only in this command, one time, before the epic docs.

---

## The wake

After `wait`, your turn ends. Orca wakes this tab with each message of a worker. A wake comes from Orca. It holds the message, or it names a read command. A message names its kind, such as `worker_done` or `escalation`, and its sender, the dispatch id of the worker.

- **A report.** Any worker message that is not a `question`. Run a shell command: `beast-mode orca next --epic <epic> --wake <kind> --dispatch <id>`, in the form of step 1. Pass the kind word for word, and the bare dispatch id with no `dispatch:` prefix. Leave out `--dispatch` when the message names no dispatch. Then go on at step 2 of the loop.
- **A wake that names a read command.** In a terminal, or for a message too long for the chat, the wake names a read command in place of the message. Run that command once, exactly as written. It is the one Orca command of this command. Then act on each message of its output, in order. Show every question of the output before your turn ends.
- **A question.** A `question` message asks for an answer. Its sender is a worker tab, and it holds a message id. The question starts with a tag that names its feature, such as `[editor/ux phase 2]`, or `[editor epic-docs]` for the epic docs tab. With several tabs, each question names its own feature, so keep the tag at the start of each one. Show the question in one plain chat message, by the ask rule, and keep the tag at its start. Number the options, and put the recommended option first. Then end your turn. Do not answer in the tab of the worker.
- **A message from the user.** An answer to a question wake goes on by The answer to a question. An answer to your own question goes on by the ask rule. Any other message goes on by The message from the user.

### The message from the user

Check each user message at any point of the run, also while a tab works. A message that is not a wake and not an answer goes on by section 12 rule 12 of `.beast-mode/phase-handoff.md`. That rule applies rule 3 to the conductor of an epic.

- **The inbox feature.** Each line goes into the inbox of one feature. Keep that `<epic>/<feature>` path through the run:
  1. When the message names one feature of the running tabs, use that feature. When it names none, and more than one tab runs, ask which feature, by the ask rule, and end your turn.
  2. After a `start`, `wait`, or `close` action, keep the path that it names. That is its `feature` field. For `wait` with one tab, it is the `feature` of its `workers` entry.
  3. A null path names the epic docs tab, after the last feature. Keep the path from before, the last feature.
  4. Before the first of these actions, use the `feature` of the last action that names one.
  5. With no path at all, use the last feature of the Build Order of `epic-overview.md`.
- **A fault, a change, or guidance.** Pick the kind: `bug` for a fault, `note` for guidance, and `change-small`, `change-medium`, or `change-large` for a change by its size. Then:
  1. Write the text of the user, word for word, to `.beast-mode/briefs/orca/note.md`. Write the file again for each message.
  2. Run a shell command: `beast-mode orca note --feature <epic>/<feature> --kind <kind> --text-file .beast-mode/briefs/orca/note.md`, in the form of step 1 of the loop. `<epic>/<feature>` is the inbox feature. Pass no `--epic` flag.
  3. Check the exit code and read the JSON object, as in step 4 of the loop. A code that is not 0 ends the run. A refusal (`"ok": false`) shows its `code` and `detail` lines.
  4. Answer `Noted, handled after this phase.` and end your turn. The `delivery` field of the result tells where the text went: `send` is the running tab of the feature, and `inbox` is one line in its `inbox.md`. A refused send falls back to the inbox line, so you do nothing more.
- **A question.** Give a short answer from the last `next` output. Write no line, and call no step. End your turn.
- **A stop request.** Run a shell command: `beast-mode orca next --epic <epic> --stop`, in the form of step 1 of the loop, and go on at step 2 of the loop. When the action is `wait`, pass `--stop` on each later `next` call of this run, the wake call too.

A line that you write while the epic docs tab works stays open in the inbox of the last feature. When the run ends, name each such line and the path of its inbox.

Never interrupt a running tab. Never act on the message yourself.

### The answer to a question

When the user answers a question wake:

1. Write the answer, word for word, to `.beast-mode/briefs/orca/answer.md`. Write the file again for each answer.
2. Run a shell command: `beast-mode orca reply --id <message-id> --body-file .beast-mode/briefs/orca/answer.md`, in the form of step 1 of the loop. Use the message id of the question, as the wake names it.
3. Check the exit code and read the JSON object, as in step 4 of the loop. A code that is not 0 ends the run. A refusal (`"ok": false`) shows its `code` and `detail` lines.
4. Call `next`, by step 5 of the loop. Go on at step 2.

When one wake holds more than one question, show all of them in one message, and end your turn. Answer each one by the steps above.

Do not poll, and do not sleep. Start no watch script and no background command. Never read the mail on your own: a read takes the mail, and then Orca has nothing to wake you with. The end of your turn is the wait.

---

## The ask rule

Ask every question of this command in one plain chat message, then end your turn:

1. The question, on the first line.
2. The options, as a numbered list. Put the recommended option first, and mark it `(recommended)`.

The user answers with the number. Never make a call to ask the user to choose while a tab runs. That call holds your turn open, and it can block a wake. Use the plain message for every question of this command, so no question blocks a wake.

For an `ask` action, the question is `question`, and the options are the `label` of each entry in `options`. The entry whose `key` equals `recommended` goes first. The question starts with a tag that names its feature, or the epic docs tab. Keep the tag. The `reason` of the ask is one of `dirty-start`, `start-failed`, `escalation-cap`, `worker-gone`, `send-back-cap`, `verify-fail-cap`, `verify-blocked`, `verify-missing`, or `start-unknown`. Ask each one the same way. Then act on the answer:

- An option with a `run` line: run that line by step 4 of the loop, then call `next` by step 5.
- An option with a null `run`: end the run. `next` asks the same question again until the cause changes.
- An answer that matches no option: ask again.

---

## Safety rules (never violate)

1. **Run only the lines of the script.** Run `next`, the `run` line of an action or of a chosen option, the `reply` command of an answer, the `note` command of a user message, and the read command of a wake. Compose no other command. Run the command of a `fix` only when the user asks for it.
2. **No git command.** The step lines own every git call: each branch, each commit, and each merge into `epic/<epic>`. Run no git command yourself. Resolve no merge conflict, because the user does that.
3. **The default branch does not move.** Never rebase, never pass `--force`, never push, and never pull. Never merge into the default branch, and never pass `--no-verify`. No `fix` and no user request lifts this rule.
4. **No phase work.** Build nothing, verify nothing, and edit or write no file, except the answer file `.beast-mode/briefs/orca/answer.md` and the note file `.beast-mode/briefs/orca/note.md`. The tabs do the work, and `next` confirms it in `tasks.md`.
5. **No other Beast Mode command.** The tabs run them. For one feature, point the user at `/orca-feature`, and do not run it yourself.
6. **No Orca command of your own.** The script starts, reads, and closes each tab. You run only the read command that a wake names, `reply` for an answer, and `note` for a user message.
7. **No wait loop.** End your turn, and Orca wakes you. No poll, no sleep, no watch script, and no background command.
8. **Never touch a shared or production environment.** No deploy, no build on a server, and no service restart.

---

## When to stop

End the run in these cases:

- `next` gives `stop`. Show `reason`, each line of `detail`, and `fix`.
- `next` gives `done`. Print `show` as written.
- A JSON object holds a `schema` that is not `1`. Show the output, and tell the user to run `/upgrade-beast-mode`. The skills of the project fall behind the plugin.
- A command exits with a code that is not 0. Show the output as it is. Exit 2 is a usage error. Exit 1 is an internal error.
- The user picks an option with a null `run`.
- The shell finds neither `beast-mode` nor the absolute form of the CLI. Tell the user to install the Beast Mode plugin.
- The argument names a feature, not an epic. Point the user at `/orca-feature <path>`.
- No folder of `docs/features/` holds `epic-overview.md`. Point the user at `/plan-epic` or `/create-epic`.

To end the run, state what ran, what the output says, and the smallest next step for the user. Name each inbox line that you wrote while the epic docs tab worked. Then end your turn, and call no further step. A wake after the end moves nothing. Show its message, and say that `/orca-epic <epic>` continues the run.

---

## Notes

- This command is resumable. When the run ends, or when this tab closes, run `/orca-epic <epic>` again. `next` reads the docs, git, and the run records, and goes on from the real state. A merged feature stays merged, and an open feature goes on from its lane branch. While a tab of the epic still works, a second run stops with `tab-still-runs` and names that tab.
- A start with uncommitted changes on a lane branch gives an `ask` with the reason `dirty-start`. The go-on option holds a `next --epic <epic> --fresh --accept-dirty` line. Run it by step 4 of the loop, then call `next`. The stop option has a null `run`, so it ends the run. On `epic/<epic>`, uncommitted changes stop the run with `dirty-tree` at the next branch switch.
- A merge conflict stops the run with `merge-conflict`. The merge step aborts the merge first, so the work tree stays clean. The user resolves the conflict on the lane branch, by the `fix`, and runs `/orca-epic <epic>` again.
- A `feat/<epic>/<feature>` branch that this run did not make, and that `epic/<epic>` does not hold, stops the run with `branch-foreign`. The stop comes before any feature builds. The branch of an `/orca-feature` run is not a branch of this run.
- Run `start --retry` only from the retry option of a `start-failed` ask.
- A `start-unknown` ask means that Orca gave no answer to a start, so a tab can be open. The options are stop (recommended) and clear. Both say "Check Orca for a new tab of <work> first". Tell the user to check Orca before the answer. Never offer a retry for it.
- A project command of `orca.json` starts the tab of that agent, in a lane tab and in the epic docs tab too. The `start` action names `path` (`agent` or `command`) and `command`, and its `say` names the command. Run the `run` line as written: the loop does not change. A start result with `readyState` `ready-unconfirmed` is not a fault. Show its `say`, and call `next`. A failed start leaves its terminal open. Show its detail line, which tells the user to close it in Orca.
- A dsh tab can keep its prompt as a draft, so the `start` step presses Enter in the tab until the turn starts. A start result with `submit` `unconfirmed` is not a fault. Show its `say`, and call `next`.
- A dsh tab that waits on its own subagent is left alone: `next` gives `wait`, and the run sends it nothing. When a dsh tab stays idle and no subagent runs, the user can say "resume". Then run a shell command: `beast-mode orca next --epic <epic> --wake escalation`, in the form of step 1 of the loop, and go on at step 2.
- When Orca refuses to make the worktree of a lane, the next call stops with `lane-worktree-refused`. Show the `fix` line. The lane, and its whole group, then build in sequence, in the main workspace. The mark stays until the user deletes the lane record.
- `next` decides from the state, not from the message. So a duplicate wake does no harm.
- A `run` line names the absolute `node`, the absolute CLI path, and `--project`. It needs no `beast-mode` on the path. Compose no `run` line yourself.
- The run leaves `epic/<epic>` for the user. The `done` summary names the uncommitted files, the worktrees, the human tests, and the merge into the default branch. The feature branches stay for the user to delete.
- Keep your context lean. Show `say` and `show`, not the whole JSON.
- This command starts no subagent, so it holds no Phase handoff block. Each phase tab applies `.beast-mode/phase-handoff.md` itself.
