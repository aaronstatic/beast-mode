# Phase Handoff — Shared Reference

**This file is the single source of truth for the handoff from a delegator command to an implementation subagent.** The installer writes it to **`.beast-mode/phase-handoff.md`**. It holds the task group split, the one agent at a time rule, the stop rule, the phase brief format, the brief path, the code review grouping, the subagent prompt shape, the delegator rules, and the verification brief. It also holds the post-phase step, the slice, and the inbox. A delegator command names this file through a small "Phase handoff" pointer block (see the bottom of this file). The rules live here and **only** here — a command never duplicates them.

> **Who reads this file:** the parent context of `/proceed`, `/proceed-advanced`, and `/autorun-feature`. In an epic run, the `feature-orchestrator` agent runs `/autorun-feature`, so that agent is the parent. A phase subagent never reads it. A phase subagent receives the brief and the pasted tool rules instead. In `/orca-feature` and `/orca-epic`, the phase worker (the agent tab of a phase) is the parent, and it reads this file.
>
> **Who reads section 11:** `/plan-feature` reads section 11, and it pastes the section into the prompt of the `solution-architect` agent. In the called mode of `/autorun-feature`, the parent does the same for the draft of the next plan. The `solution-architect` agent reads section 11 only when its prompt holds no Slice rules block.
>
> **Who reads section 12:** every reader of this file, `/autorun-epic` (rules 3, 9, 10, and 12), and `/update-feature` (rule 7). A phase subagent never reads section 12. It gets the inbox sentence of rule 4 through its prompt.

---

## 1. The task group split

The delegator reads the open tasks of the next phase from `tasks.md`. It then splits the phase into task groups, and it runs one subagent for each group.

Three rules define a group.

1. One task costs about six steps: one read, one or two edits, and one check.
2. A group holds at most 12 tasks, and it touches at most 6 files.
3. A phase over either limit splits at a file boundary. Two tasks that change the same file stay in the same group.

Two groups of 6 tasks therefore land near 40 to 80 steps each. A subagent of that size finishes its group in one context, and its prompt stays small to the last step.

---

## 2. One agent at a time

The parent starts the next subagent only after the first subagent returns. The parent runs no two implementation agents in parallel. This rule does not change, and every delegator command already states it.

---

## 3. The stop rule

The subagent prompt and the phase brief both hold this sentence, word for word:

> At 100 tool calls, write the state to `context.md`, list the open tasks of the group, and return.

The parent then starts a fresh subagent for the rest of the group, with a new brief. The new brief holds the open tasks only. A group that needs a second subagent two times is too large, so the delegator splits it further.

---

## 4. The phase brief format

The delegator writes one brief for each group, before it starts the subagent. The brief is one markdown file with six headings, in this order.

```markdown
# <feature> - Phase <n> - Group <k>

## Goal
<up to three sentences from the phase section of implementation.md>

## Tasks
<the open tasks of this group, word for word from tasks.md, and the open inbox changes of section 12 rule 8>

## Files
<one path per line, the files this group changes>

## Decisions
<only the context.md decisions that touch those files, and the open inbox notes of section 12>

## Acceptance
<the acceptance criteria of the phase>

## Stop rule
<the sentence of section 3 above>
```

The cap is 6k tokens, about 24k characters. The trim order is fixed.

1. Drop the prose of the phase section.
2. Drop a decision that names no file of the group.
3. Cut the goal to one sentence.

The brief always keeps the task text, the file list, and the acceptance criteria. When the brief is still over the cap after the trim, the delegator splits the group again.

The delegator adds the open inbox notes to each brief of the phase, per section 12. It adds each open small change to one brief only. The trim never drops them.

---

## 5. The brief path

| Case | Path |
| --- | --- |
| a plain feature | `.beast-mode/briefs/<feature>/<phase>.md` |
| a feature inside an epic | `.beast-mode/briefs/<epic>/<feature>/<phase>.md` |

The brief path mirrors the docs path, so the brief of `editor/base` lands under `.beast-mode/briefs/editor/base/`. The file name is the phase slug, for example `phase-3.md`. A phase that splits into more than one group adds a group suffix, for example `phase-3-g2.md`. A brief is derived data, so `.beast-mode/briefs/` belongs in `.gitignore`.

The delegator keeps every brief. It does not delete a brief after the subagent returns. A resumed run and a bug report can read the brief. A new brief for the same phase and group replaces the old file.

---

## 6. The code review grouping

A code review group holds at most three findings. Every finding of the group names the same file. A finding in another file goes into another group, and into another subagent.

---

## 7. The subagent prompt shape

A subagent prompt holds five parts, in this order.

1. The `## Tool rules` section of `.beast-mode/tool-rules.md`, pasted word for word. The prompt also names that file as the source of the block.
2. The path of the phase brief of this group.
3. One instruction: read the brief and the project instruction file.
4. The stop rule sentence of section 3.
5. The inbox sentence of section 12 rule 4, word for word.

The verifier prompt of section 9 and the prompt of a fix subagent hold part 5 too. A verifier puts its `Inbox:` line before its demo result line, so the demo result line stays last. Add the sentence below to the verifier prompt, after part 5, word for word.

```text
Put the `Inbox:` line before the demo result line.
```

The brief replaces the read list of the old prompt. A prompt therefore names no whole `implementation.md`, no whole `context.md`, and no whole `tasks.md`. The subagent reads the brief first, and it reads a source file when it changes that file.

---

## 8. The delegator rules

The parent context is the most expensive context of a run. Every step of the parent resends the whole run so far. A measured run put 59 percent of its prompt tokens in the parent, because the parent ran the tests, wrote its own browser probes, and read source files to find a fix. Six rules keep the parent small.

1. The parent reads the feature docs, the reference files, and the result of an agent. It reads no source file and no test file.
2. The parent runs no type-check, no lint, no build, no test, and no browser check. It delegates the gate to a verifier subagent, per section 9.
3. A failed gate goes to a fix subagent. The fix brief holds the error text, word for word. The parent does not search for the cause itself.
4. The parent updates `tasks.md` and `context.md` with the edit tool. It writes no whole file that exists.
5. The parent keeps the summary of an agent result, and it pastes no whole file and no whole log into its context.
6. The parent waits for an agent result with the blocking form of the delegation tool of the harness. It runs no sleep and no poll loop, because every poll step resends the whole parent context. A notice can say that a child waits on its own background work. The child then still runs. End no turn with text only. Run one foreground wait on the output file of the notice, until the child hands back.

A shell command of the parent serves the orchestration only: the git state, the branch, a file list, or a line count.

---

## 9. The verification brief

After the last group of a phase returns, the delegator writes one verification brief, and it starts one verifier subagent. The verifier changes no file. It returns one word, `PASS`, `FAIL`, or `BLOCKED`, and then the evidence.

```markdown
# <feature> - Phase <n> - Verify

## Gate
<the type-check, lint, build, and test commands of the project, one per line>

## Demo
<the Demo line of the phase, word for word, or the word "none">
Run the demo the way a person does. Use the browser automation tool for a UI slice, with the rules of `## UI check`. For any other slice, use a command, an API call, or a test.

## UI check
<the acceptance criteria of the phase that name a screen or an interaction, or the word "none">
<the dev URL, the sign-in method, and the browser rules of the project instruction file>

## Files
<one path per line, the files the phase changed>

## Return
PASS, or FAIL with the last 30 lines of each failed command and the path of each failed file.
A blocked UI check returns BLOCKED with the reason and the smallest thing a person must do.
A failed demo makes the whole result FAIL.
End with one demo result: Demo: PASS, Demo: FAIL with the evidence, Demo: MANUAL with the reason, or Demo: none.
Use Demo: MANUAL only when a person must run the demo. Examples are a live harness session, a device, and a sign-in that the project instruction file does not give.
```

The path is the brief path of section 5, with the suffix `-verify`, for example `phase-3-verify.md`. A fix brief takes the suffix `-fix<n>`, for example `phase-3-fix1.md`, and it holds the error text of the verifier under `## Tasks`. A phase with no UI keeps the `## UI check` heading with the word `none`. The verifier prompt follows the shape of section 7: the pasted tool rules, the brief path, one read instruction, and the stop rule.

The `## Demo` and `## Return` lines carry the demo rules, because the verifier reads only the brief. Two rules apply to the delegator.

1. A `Demo: MANUAL` result does not stop the run.
2. A phase with no Demo line keeps the `## Demo` heading with the word `none`. So does a phase with a Demo line that starts with `none`.

---

## 10. The post-phase step

After the last group of a phase returns, the delegator runs parts 1 to 3 below, in this order. Part 4 is the rule for a phase with no demo. Part 5 runs last, after part 3 or part 4.

1. **Verify.** First, put every open `bug` line into one fix brief, and delegate it, per section 12 rule 6. Skip the fix brief when no `bug` line is open. Then write the verification brief of section 9, and start one verifier subagent. A `PASS` marks the bug lines of the pass done.

   A `FAIL` becomes an open `bug` line, per section 12 rule 6, and part 1 runs again. The next fix brief also holds the error text of the verifier, word for word, per section 8 rule 3. The `FAIL` gets no other fix brief. Each delegator command states its count of fix rounds.

   With an open large change, part 1 writes no fix brief, as an exception to section 12 rule 6. The verifier still runs, and every `bug` line stays open. After a `FAIL`, the step goes on to part 2, not back to part 1. The fix-round stop of the command does not apply.

   A `BLOCKED` result stops the step. Show the reason and the smallest thing that a person must do. Start the verifier again after the person acts.
2. **Record.** Edit `tasks.md` and `context.md`, per section 8 rule 4.
3. **Hand the slice to a person.** Run this part only when the Demo line does not start with `none`. The test prompt is the text below.

   ```text
   Slice ready: Phase <n> - <phase name>
   Demo: <the Demo line>
   Verifier: Demo <PASS, FAIL, or MANUAL>
   ```

   - **A manual run** (`/proceed`, `/proceed-advanced`). Show the test prompt. Then ask the user to choose, with the header `Slice test` and two options: `It works` and `Something broke`. The second option asks for the fault in the free-text answer. `It works` goes on to part 5. A fault becomes a `bug` line with the words of the person, per section 12 rule 6. Then the step runs again from part 1. With an open large change, the step goes on to part 5 instead. Any other fault, change, or guidance in the answer is an inbox item, per section 12 rule 3.
   - **An autorun** (`/autorun-feature`). Show the test prompt with one more line at the end: `The run goes on. Try the demo when you can.` Ask nothing. Add `- [ ] Phase <n> demo: <the Demo line>` to the `## Needs Human Verification` section of `context.md`. Add the section when the file has none.
   - **The called mode** of `/autorun-feature`. Show nothing, because no person sees the output of an agent. Add the same line to `context.md`. Also append it to the `## <feature>` section of `docs/features/<epic>/human-testing.md`. Create the file from `.beast-mode/templates/human-testing.md` when it does not exist. Add the section when the file has none. Do not add a line that the section already holds.
4. **A phase with no demo.** Part 3 does not run for a phase with no Demo line. It also does not run for a base phase, or for any Demo line that starts with `none`. For such a phase, a manual run asks for a test only when the phase has a UI. For any other such phase, the step shows no test prompt. An autorun adds no demo line to `context.md`.
5. **Read the inbox.** Act on each open line of `inbox.md` by the rule of its kind in section 12. Act on a large change first. That action stops the feature and ends the post-phase step, and every other line stays open. With no large change, act on a medium change first, and then on the rest. After that, an open `bug` line or an inbox brief of rule 8 sends the step back to part 1. In all other cases, the post-phase step ends, and the command goes on by its own steps.

---

## 11. The slice

A phase of `implementation.md` is a slice, or a base phase when rule 6 applies. Twelve rules define a slice.

1. **Complete.** A phase works end to end for one path, through every layer that the path needs.
2. **Narrow.** A phase takes one path, not all paths. Validation, edge cases, and polish go into a later slice.
3. **Sized.** A phase fits one or two task groups of section 1. A group holds at most 12 tasks, and it touches at most 6 files.
4. **The first slice.** Phase 1 is the smallest path that proves the idea. A base phase comes first only when no slice can run without it.
5. **The order.** The later phases come in the order of their value to the user.
6. **A base phase.** Work that cannot be a slice is a base phase. Examples are a data migration and a pure refactor. Its heading ends with `(Base)`. Its Demo line reads `none (base phase: <the reason>)`.
7. **The exit.** A feature under about 8 tasks stays one phase. That phase is a slice with a Demo line.
8. **The Demo line.** Put `**Demo:** <one action and one result that a person can check>` right after the `**Goal:**` line of the phase. An example is `**Demo:** the user opens the list and sees one row`.
9. **The Needs line.** Put `**Needs:** <the phases that this phase waits on, or none>` right after the Demo line. The phases still run in order. No command reads the line.
10. **Never a task.** The Demo line and the Needs line are plain bold lines. They are never a list item and never a checkbox, so the task counts stay the same.
11. **The confirmed demo.** When the Confirmed Assumptions block names the demo of phase 1, phase 1 uses that demo.
12. **A draft with no interview.** The requirements can leave the demo of phase 1 open. Then add an open scope question to Notes. Its options are Demo lines for phase 1, with the recommended line first. Phase 1 uses the recommended line.

---

## 12. The inbox

The inbox is one file per feature. It records each item that reaches a run at any point: a bug, a change, or a note. During a run, only the parent writes the inbox. A phase subagent never writes it. A done line stays in the file. The rules below define the inbox.

1. **The file.** The inbox of a feature is `docs/features/<feature>/inbox.md`. In an epic, it is `docs/features/<epic>/<feature>/inbox.md`. `/start-feature` creates the file from `.beast-mode/templates/inbox.md`. When the file does not exist, the first write creates it from that template. It puts the feature name in the H1. No file means no open line.
2. **The line.** Each item is one line. Edit a file to append the line at the end of `## Items`. Never rewrite the file, and never delete a line.

   ```text
   - [ ] <kind> <YYYY-MM-DD HH:MM> | <the text, word for word>
   - [x] <kind> <YYYY-MM-DD HH:MM> | <the text, word for word> | done: <the outcome>
   ```

   The kind is `bug`, `note`, `change small`, `change medium`, or `change large`. The time is the write time. To mark a line done, tick its box and append the outcome. At part 5 of section 10, the parent can correct a wrong kind on an open line.
3. **Write.** A user message can reach a run at any point. The message is an item when it reports a fault, asks for a change, or gives guidance. A run is `/proceed`, `/proceed-advanced`, `/autorun-feature`, `/autorun-epic`, `/orca-feature`, or `/orca-epic`, from its first step to its last step.

   The parent writes one open line for each item, and it answers `Noted, handled after this phase.` The kind is `bug` for a fault, `note` for guidance, and `change` with its level for a change. The parent never stops or interrupts a running agent for an item. A question gets a short answer and no line. A request to stop the run is not an item. Stop the run after the current agent returns.

   "At any point" covers four cases.

   - **While an agent runs.** The harness gives the message to the parent after the agent returns, or it gives the message to the agent. Rule 4 covers the agent.
   - **With the answer to a test prompt or another question of the parent.** The choice is the answer, not an item: `It works`, `Something broke`, or a scope option. Text that explains or limits the choice belongs to the answer. Any other fault, change, or guidance in the answer is an item. The fault of `Something broke` follows rule 6.
   - **Between two phases.** The line waits for the next read. The briefs of the next phase take a note or a small change, per section 4. The next post-phase step acts on the rest.
   - **Before the run ends.** A line written after the last part 5 of the run still gets its action. Run part 5 one more time for that line before the command ends. `/autorun-feature` runs it in step 6, before `/update-feature` and again before the final summary or the report.
4. **A message that reaches a subagent.** Every prompt of section 7 holds the inbox sentence below, word for word, as part 5 of section 7.

   ```text
   A user message can reach you during the task. Do not act on it. End your result with `Inbox:` and the message, word for word.
   ```

   The parent writes each `Inbox:` message of a result as a line, per rule 3. A result with an `Inbox:` line is not a fault, and the parent keeps the work of the agent.
5. **A note.** Each brief of the next phase carries each open note under `## Decisions`, as `- Inbox note: <the text>`, word for word. Mark the line done when the briefs exist: `done: <the brief names>`. With no open phase in `tasks.md`, mark it `done: no brief follows`.
6. **A bug.** Part 1 of section 10 puts every open `bug` line into one fix brief before the verifier, word for word, under `## Tasks`. The brief takes the `-fix<n>` suffix of section 9. After a `FAIL`, the brief also holds the error text of the verifier, word for word, per section 8 rule 3.

   A verifier `FAIL` writes one line: `Verifier FAIL: <the failed check, in one line>`. When an open line already names the same check, the `FAIL` writes no new line. A fault from the slice test writes one line: `Slice test: <the words of the person>`.

   A `PASS` marks each bug line of the pass done: `done: <the fix brief name>`. The bug lines of the pass are the open lines of the last fix brief. A line that no fix brief holds stays open. The command applies its count of fix rounds to each line. A `Slice test:` line that repeats a fault of the phase keeps the fix-round count of that fault. So the cap of three rounds still stops it.
7. **The feature end.** `/update-feature` reads the inbox on every run. No file means no step. It does the three actions below, in this order.

   - When every task of `tasks.md` is done, it promotes each open `bug` line. For each line, it writes a file: `docs/bugs/BUG-<NNN>.md`. `<NNN>` is the highest number in `docs/bugs/` at write time, plus one, in three digits. With no bug file, it is `001`.

     The frontmatter holds the fields that `/fix-bug` reads: `id`, `title`, `status: open`, `priority: medium`, `linkedFeature`, `createdAt`, and `updatedAt`. The `id` is `BUG-<NNN>`. The `title` is the text, cut to one line, in double quotes. A backslash in the text becomes `\\`, and then a double quote becomes `\"`. The `linkedFeature` is the feature path, `<epic>/<feature>` in an epic. `createdAt` and `updatedAt` are in ISO 8601.

     The body holds the text, word for word, and then one line: `From the inbox of <feature>, <the time>.` There, `<feature>` is the feature path, and `<the time>` is the time of the line. Then it marks the line `done: BUG-<NNN>`.
   - Then it adds one line for each done item to the new session note of `context.md`: `- Inbox <kind>: <the text> (<the outcome>)`. It skips an item whose text `context.md` already holds.
   - The summary names each `note` or `change` line that stays open.
8. **A small change.** A small change moves a button, changes an icon, or fixes a label. No plan decision waits on it. Do not edit `implementation.md` for a small change.

   One brief of the next phase carries each open small change under `## Tasks`, as `- Inbox change: <the text>`, word for word. Use the brief whose `## Files` list holds the file of the change, or else the first brief. With no open phase in `tasks.md`, write one inbox brief, `<phase>-inbox.md`, in the brief folder of section 5. It holds each open small change under `## Tasks`. Delegate it to an agent at the tier that ran the last phase.

   Mark the line done when the agent of that brief returns: `done: <the brief name>`. After an inbox brief, run the step again from part 1, even with no open `bug` line.
9. **A medium change.** A medium change shifts the architecture or the idea. Ask the user to choose: one scope question, two to four options, and the recommended option first. When the answer keeps the plan, mark the line `done: declined`.

   For any other answer, edit the lines of `implementation.md` and `tasks.md` that the change touches. Record a decision in `context.md`. Edit each brief that exists and has not run. When an agent of the changed work still runs, send a message to an agent with the change. Send it only to an agent that still runs. Mark the line `done: <the answer>`.
10. **A large change.** A large change moves the goal. Stop the feature after part 5, and start no next phase.

    Ask the user to choose, with the open questions in one call. Ask at most four questions, each with the recommended option first. When the answers keep the goal, mark the line `done: declined`. Then tell the user to run the same command again to go on, and skip the rest of this rule. When `requirements.md` exists, read it, and write a file, `requirements-<YYYY-MM-DD>.md`, with the same text. When that name exists, add the next free number, for example `requirements-<YYYY-MM-DD>-2.md`. Then write a file, the new `requirements.md`, from the change and the answers. This write is an exception to section 8 rule 4.

    Mark the line `done: new requirements.md`. Tell the user to run `/plan-feature <feature>` next.
11. **The called mode.** The orchestrator never implements an item, and it never edits the plan. A phase agent gets each note, bug, and small change through a brief, per rules 5, 6, and 8.

    A medium or a large change becomes a blocker, and its line stays open. When a large change is open, only the large change becomes a blocker, and every other line stays open. The `Blockers` section holds the kind, the text, and the scope question with its options. The run ends after part 5. Then `/autorun-epic` runs rule 9 or rule 10, and the user answers there.
12. **The conductor.** Rule 3 applies to each user message that reaches `/autorun-epic`. The message can come while an orchestrator runs, or with the answer to a scope question. It can also come between two features, or before the run ends.

    In the answer to a scope question, the choice is not an item. Any other fault, change, or guidance in the answer is an item. Write each line into the inbox of the feature that Step 4 builds now or next. After the last feature, write it into the inbox of the last feature. The Step 7 summary names that line, in place of the part 5 run of rule 3.

---

## 13. The canonical "Phase handoff" command block

Every delegator command holds the block below, in the style of the `## Epic awareness` block. The text is identical in each file. Copy it with no per-command change, and change the wording here when a rule changes. The block sits directly after `## Epic awareness`, before the command's own workflow sections.

```markdown
## Phase handoff

Before you start a subagent, read `.beast-mode/phase-handoff.md` and apply its rules:
split the phase into task groups, write the phase brief, and put the stop rule and
the tool rules into the prompt. Read `.beast-mode/tool-rules.md` once per run, and
paste its `## Tool rules` section into every subagent prompt. Apply its delegator
rules and its verification brief too.
`.beast-mode/phase-handoff.md` is the single source of truth for the handoff; this
command does not restate those rules.
```
