---
name: orca-feature
description: "Run a feature to completion in Orca, one fresh agent tab per phase. A step script decides each step, and this tab ends its turn while a phase tab works. Epic-aware. Usage: /orca-feature <feature-name | epic/feature>"
argument-hint: "<feature-name | epic/feature>"
user-invocable: true
---

You have been asked to run a feature in Orca, one fresh agent tab per phase. This tab is the **coordinator** of the run. The step script decides, and the tabs work:

- `beast-mode orca next` reads the docs, git, the run record, and the Orca state. It prints the next step as one JSON action.
- You do that one action, and you call `next` again.
- An Orca agent tab runs each phase. That tab is the orchestrator of its phase.

You run no phase, no other Beast Mode command, and no git command. You run no Orca command, apart from the read command that a wake names.

**Feature name:** first argument from `$ARGUMENTS` (kebab-case). May be a plain feature, or a feature inside an epic referenced as `<epic>/<feature>`.

- `/orca-feature <feature-name>`: run that feature.
- `/orca-feature` (no argument): list the features whose `tasks.md` holds an open task, and ask which one, by the ask rule.

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
epic folders for bare names, and pass the nested `<epic>/<feature>` path to the step script when the target is a feature inside an epic. For a bare epic name, ask which child feature to run, or run `/orca-epic <epic>` for the whole epic.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. This command does **not** re-specify those rules. Two consequences for everything below:

- **The feature path.** `<path>` below is the resolved feature path: the feature name, or `<epic>/<feature>` for a feature inside an epic. When you fuzzy-resolve a bare name into an epic, **announce** the resolved `<epic>/<feature>` before the first step. You load no epic context, because each phase tab loads it.
- **A bare epic name is not a single feature.** When the argument is a folder that holds `epic-overview.md`, list the child features of the epic. Ask which child to run, by the ask rule. Recommend the first child in the build order of `epic-overview.md` that is not done, and offer "run the whole epic" as the last option. For a child, run this command on `<epic>/<feature>`. For the whole epic, run the `/orca-epic <epic>` command in place of this run.

---

## The loop

1. **Start.** Run a shell command: `beast-mode orca next --feature <path> --fresh`. When the shell finds no `beast-mode`, use the absolute form of the CLI from the `## Notes` section of `.beast-mode/harness.md`. Use the same form for every later `next` call.
2. **Read the action.** When the command exits with a code that is not 0, end the run, and show the output as it is. Else read the one JSON object that it prints. When its `schema` is not `1`, end the run by When to stop. Else show its `say` line, and act by the table.
3. **Act by the table.**

| Action | You do |
|---|---|
| `branch`, `start`, `send`, `commit`, `merge` | Run the `run` line by step 4. Then call `next` by step 5. |
| `close` | Print `show` as written, when it is not null. Run the `run` line by step 4. Then call `next` by step 5. |
| `wait` | End your turn. Orca wakes you, by The wake. |
| `ask` | Ask by the ask rule, and end your turn. |
| `stop` | Show `reason`, each line of `detail`, and `fix`. End the run. |
| `done` | Print `show`, the summary block, as written. End the run. |

4. **Run a `run` line.** Run a shell command with the `run` line exactly as written. Change no character, and add no flag. When the exit code is not 0, end the run, and show the output as it is. Else read the one JSON object that it prints, check its `schema` as in step 2, and show its `say`. A refusal (`"ok": false`) is a decided outcome: show its `detail` lines, and go on to step 5.
5. **Call `next`.** Run a shell command: `beast-mode orca next --feature <path>`, in the form of step 1. Then go to step 2.

Pass `--fresh` on the first call of a run only. A later `--fresh` call stops the run while the phase tab works.

---

## The stages

The script runs the stages of one feature in this order. You do not choose a stage. `next` names it in each `start` action, and the tab does the work.

1. **`plan`**: a plan tab, only when the feature has no plan. It runs `/plan-feature`, then `/start-feature`. The plan tab asks its questions in its own tab, so the user answers there. Wait while it waits on the person. A question wake comes from the other stages.
2. **`phase`**: for each phase, a phase tab. It builds the phase by `.beast-mode/phase-handoff.md`. Then the phase steps and the phase commit run. The phase commits only after a `PASS` verdict.
   - `stages.verify` equal to `stages.implement`: the phase tab verifies the phase itself.
   - A different agent: a **verify tab** of that agent runs after the phase tab. It checks the phase, and it writes the verdict file (`PASS`, `FAIL`, or `BLOCKED`, with the evidence and a last `Demo:` line).
   - A `FAIL` starts a **fix tab** of the build agent (`stages.implement`). Then the verify tab runs again. The run makes at most three fix rounds for one phase.
   - After the fourth `FAIL`, the ask `verify-fail-cap` offers stop (recommended), or one more fix round. A `BLOCKED` verdict gives the ask `verify-blocked`: stop, or retry. A verify tab that ends with no verdict gives the ask `verify-missing`, after one send.
   - The `close` action that ends the phase holds the **slice block** in `show`. It has a `Verifier: Demo <PASS|FAIL|MANUAL>` line. Print `show` as written.
3. **`review`**: the cross-phase review, after the last phase.
   - `stages.review` equal to `stages.implement`: the review runs in the last phase tab.
   - A different agent: a review tab (`/review-feature`, findings only), then a `review-fix` tab, then the review commit.
   - `stages.review` set to `false`: no review.
4. **`inbox`**: an inbox tab, only when `inbox.md` holds an open line.
5. **`docs`**: a docs tab. It runs `/update-feature`, `/update-epic`, and `/update-master`.
6. **`done`**: the summary block.

A `step` action runs one configured command in its own tab, with a verdict file. Treat it as any other `start` action. A `FAIL` or `BLOCKED` verdict gives an `ask` with the reason `step-failed`: stop (recommended), or go on (the step is recorded `overridden`). A step with `after: "epic"` runs only in `/orca-epic`.

---

## The wake

After `wait`, your turn ends. Orca wakes this tab with each message of a worker. A wake comes from Orca. It holds the message, or it names a read command. A message names its kind, such as `worker_done` or `escalation`, and its sender, the dispatch id of the worker.

- **A report.** Any worker message that is not a `question`. Run a shell command: `beast-mode orca next --feature <path> --wake <kind> --dispatch <id>`, in the form of step 1. Pass the kind word for word, and the bare dispatch id with no `dispatch:` prefix. Leave out `--dispatch` when the message names no dispatch. Then go on at step 2 of the loop.
- **A wake that names a read command.** In a terminal, or for a message too long for the chat, the wake names a read command in place of the message. Run that command once, exactly as written. It is the one Orca command of this command. Then act on each message of its output, in order. Show every question of the output before your turn ends.
- **A question.** A `question` message asks for an answer. Its sender is a worker tab, and it holds a message id. Show the question in one plain chat message, by the ask rule: number the options, and put the recommended option first. Then end your turn. Do not answer in the tab of the worker.
- **A message from the user.** An answer to a question wake goes on by The answer to a question. An answer to your own question goes on by the ask rule. Any other message goes on by The message from the user.

### The message from the user

Check each user message at any point of the run, also while a phase tab works. A message that is not a wake and not an answer goes on by section 12 rule 3 of `.beast-mode/phase-handoff.md`:

- **A fault, a change, or guidance.** Pick the kind: `bug` for a fault, `note` for guidance, and `change-small`, `change-medium`, or `change-large` for a change by its size. Then:
  1. Write the text of the user, word for word, to `.beast-mode/briefs/orca/note.md`. Write the file again for each message.
  2. Run a shell command: `beast-mode orca note --feature <path> --kind <kind> --text-file .beast-mode/briefs/orca/note.md`, in the form of step 1 of the loop.
  3. Check the exit code and read the JSON object, as in step 4 of the loop. A code that is not 0 ends the run. A refusal (`"ok": false`) shows its `code` and `detail` lines.
  4. Answer `Noted, handled after this phase.` and end your turn. The `delivery` field of the result tells where the text went: `send` is the running tab, and `inbox` is one line in `inbox.md`. A refused send falls back to the inbox line, so you do nothing more.
- **A question.** Give a short answer from the last `next` output. Write no line, and call no step. End your turn.
- **A stop request.** Run a shell command: `beast-mode orca next --feature <path> --stop`, in the form of step 1 of the loop, and go on at step 2 of the loop. When the action is `wait`, pass `--stop` on each later `next` call of this run, the wake call too.

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

For an `ask` action, the question is `question`, and the options are the `label` of each entry in `options`. The entry whose `key` equals `recommended` goes first. The `reason` of the ask is one of `dirty-start`, `start-failed`, `escalation-cap`, `worker-gone`, `send-back-cap`, `verify-fail-cap`, `verify-blocked`, `verify-missing`, or `start-unknown`. Ask each one the same way. Then act on the answer:

- An option with a `run` line: run that line by step 4 of the loop, then call `next` by step 5.
- An option with a null `run`: end the run. `next` asks the same question again until the cause changes.
- An answer that matches no option: ask again.

---

## Safety rules (never violate)

1. **Run only the lines of the script.** Run `next`, the `run` line of an action or of a chosen option, the `reply` command of an answer, the `note` command of a user message, and the read command of a wake. Compose no other command. Run the command of a `fix` only when the user asks for it.
2. **No git command.** The script owns every git call. It commits only at a cadence point of `.beast-mode/orca.json`, and it never pushes.
3. **No phase work.** Build nothing, verify nothing, and edit or write no file, except the answer file `.beast-mode/briefs/orca/answer.md` and the note file `.beast-mode/briefs/orca/note.md`. The phase tab does the work, and `next` confirms it in `tasks.md`.
4. **No other Beast Mode command.** The tabs run them. The whole-epic choice of a bare epic name is the one exception, before the first step.
5. **No Orca command of your own.** The script starts, reads, and closes each tab. You run only the read command that a wake names, `reply` for an answer, and `note` for a user message.
6. **No wait loop.** End your turn, and Orca wakes you. No poll, no sleep, no watch script, and no background command.
7. **Never touch a shared or production environment.** No deploy, no build on a server, and no service restart.

---

## When to stop

End the run in these cases:

- `next` gives `stop`. Show `reason`, each line of `detail`, and `fix`.
- `next` gives `done`. Print `show` as written.
- A JSON object holds a `schema` that is not `1`. Show the output, and tell the user to run `/upgrade-beast-mode`. The skills of the project fall behind the plugin.
- A command exits with a code that is not 0. Show the output as it is. Exit 2 is a usage error. Exit 1 is an internal error.
- The user picks an option with a null `run`.
- The shell finds neither `beast-mode` nor the absolute form of the CLI. Tell the user to install the Beast Mode plugin.
- The user picks the whole epic, and the `/orca-epic` command is missing. Tell the user that the whole epic needs it.

To end the run, state what ran, what the output says, and the smallest next step for the user. Then end your turn, and call no further step. A wake after the end moves nothing. Show its message, and say that `/orca-feature <path>` continues the run.

---

## Notes

- This command is resumable. When the run ends, or when this tab closes, run `/orca-feature <path>` again. `next` reads the docs, git, and the run record, and goes on from the real state. The docs and git are the state of record. While a tab of the feature still works, a second run stops with `tab-still-runs` and names that tab.
- A start with uncommitted changes gives an `ask` with the reason `dirty-start`. The go-on option holds a `next ... --fresh --accept-dirty` line. Run it by step 4 of the loop, then call `next`. The stop option has a null `run`, so it ends the run.
- Run `start --retry` only from the retry option of a `start-failed` ask.
- A `start-unknown` ask means that Orca gave no answer to a start, so a tab can be open. The options are stop (recommended) and clear. Both say "Check Orca for a new tab of <work> first". Tell the user to check Orca before the answer. Never offer a retry for it.
- A project command of `orca.json` starts the tab of that agent. The `start` action names `path` (`agent` or `command`) and `command`, and its `say` names the command. Run the `run` line as written: the loop does not change. A start result with `readyState` `ready-unconfirmed` is not a fault. Show its `say`, and call `next`. A failed start leaves its terminal open. Show its detail line, which tells the user to close it in Orca.
- A dsh tab can keep its prompt as a draft, so the `start` step presses Enter in the tab until the turn starts. A start result with `submit` `unconfirmed` is not a fault. Show its `say`, and call `next`.
- A dsh tab that waits on its own subagent is left alone: `next` gives `wait`, and the run sends it nothing. When a dsh tab stays idle and no subagent runs, the user can say "resume". Then run a shell command: `beast-mode orca next --feature <path> --wake escalation`, in the form of step 1 of the loop, and go on at step 2.
- `next` decides from the state, not from the message. So a duplicate wake does no harm.
- A `run` line names the absolute `node`, the absolute CLI path, and `--project`. It needs no `beast-mode` on the path. Compose no `run` line yourself.
- Keep your context lean. Show `say` and `show`, not the whole JSON.
- This command starts no subagent, so it holds no Phase handoff block. Each phase tab applies `.beast-mode/phase-handoff.md` itself.
