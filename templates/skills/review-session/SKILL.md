---
name: review-session
description: "Review a session log, not the code. Rank findings that each point to one step, and apply the ones you pick as a check, a rule, or a pointer. Usage: /review-session [session-id]"
argument-hint: "[session-id]"
user-invocable: true
---

This command reviews the log of one session, not the code, and `/review-feature` and `/review-pr` review the code.

**Session id:** `$ARGUMENTS`

## Harness

This command runs on any agent harness. Read `.beast-mode/harness.md` first.
It maps the neutral terms in this command to the tools of this harness.
Terms include: ask the user to choose, delegate to an agent, search the web,
and the harness skills directory. Use the mapped tool. Do not use a tool name
from another harness.

## Epic awareness

This command is epic-aware. It takes a session id, not a feature name, so it
needs no epic-reference resolution for `$ARGUMENTS`. Detect epics by
`epic-overview.md` only to resolve a feature path that the log names, as
`<epic>/<feature>`.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. This command's body is the review-session workflow; it does **not** re-specify those rules.

## Process

### 1. Write the transcript

Run a shell command: run `beast-mode transcript <id> --out .beast-mode/briefs/review-session`. The id is the first word of `$ARGUMENTS`. When `$ARGUMENTS` is empty, leave out the id. The CLI then reads the current session. That is the session that the harness names, else the newest parent log of this project.

When the shell does not find the command, read the `## Notes` section of `.beast-mode/harness.md`. It gives the absolute path form of the CLI. Run that form, as `/token-report` does.

Show the summary lines with no change. When the output holds no `Transcript:` line, show the note or the error. Name `/token-report` as the command that lists the session ids. Then stop.

When `$ARGUMENTS` is empty and the `Steps:` line shows `1 user messages`, the current session holds only this command. Tell the user to run `/review-session <session-id>`. Name `/token-report` as the command that lists the session ids. Then stop.

### 2. Delegate the review

Read `.beast-mode/tool-rules.md` one time. Delegate the review to a fresh agent. When the harness can set the model of the delegate, run the agent on opus at the preset effort. Read no line of the transcript in this step.

Write the prompt from the block below. Paste the `## Tool rules` section into the first slot, word for word. Put the transcript path and the summary lines of step 1 into their slots. Send the rest of the block word for word.

```text
<the ## Tool rules section of .beast-mode/tool-rules.md, word for word>
(Source of the block above: `.beast-mode/tool-rules.md`.)

You review one session log of this project. You do not review the code. You change no file. You cannot ask the user a question.

Transcript: <the path of the Transcript: line>
<the summary lines of step 1>

Read the transcript in ranges of 300 lines or fewer. Read the project instruction file.
Read the check files of the project: the package manifest, the lint, test, and type-check configs, and the hook files. Read no source file for review.
Read `.beast-mode/tool-rules.md` and `.beast-mode/phase-handoff.md`.
For each path of the Features line, read `docs/features/<path>/inbox.md` and `context.md` when they exist.
Ignore the steps from the last `/review-session` user message on.

Ask these questions of the log.
1. **Navigation.** How easily did the agent find the right files? Look for searches and reads before the first read of the file that the task needed. Route: pointer.
2. **Checks.** Which error would a lint, a type-check, a test, or a pre-commit hook catch? Route: check. A project with no check at all is a finding. It points to the first step that changed a file.
3. **Steering.** Which line of the project instruction file is a navigation pointer, and which line belongs in a check? A line that a check can hold is a finding when a step shows it. Route: check, then delete the line.
4. **Rules.** Which judgement call belongs in `.beast-mode/tool-rules.md` or `.beast-mode/phase-handoff.md`? Route: rule.

A finding follows these rules.
- It points to one step. Quote the step line word for word, with its number.
- A generic best practice is not a finding.
- HIGH: the mistake repeats at two or more steps, breaks the gate, or loses work. The no-check finding is HIGH.
- MEDIUM: one moment that costs five or more steps.
- LOW: one moment that costs fewer than five steps.
- Rank by severity, then by the steps that the moment cost, then by the step number.
- Return at most 8 findings. Return `No finding.` when the log shows none.
- An inbox line of the session ties to the user step with the same text. Add it as the `Inbox:` line.
- An inbox line reads `- [ ] <kind> <YYYY-MM-DD HH:MM> | <the text>`. A done line starts with `- [x]` and ends with `| done: <the outcome>`. Its time shows the moment of the session.

Return each finding in this shape, and no other text.

F<n> | <HIGH, MEDIUM, or LOW> | <navigation, checks, steering, or rules> | <pointer, check, or rule> | <the target file>
Step: <the step line, word for word>
Finding: <one sentence>
Change: <the exact line, and the line that it replaces, or the check and the command that runs it>
Inbox: <the inbox line, word for word, only when one ties to the step>

At 100 tool calls, return the findings that you have.
```

### 3. Show the findings

When the agent returns `No finding.`, tell the user that the session shows no finding, and stop.

Run one shell command that prints the transcript line of each `Step:` number, for example `grep -E '^(12|57) ' <the file>`. Drop a finding whose `Step:` line differs from its transcript line. Tell the user the count of dropped findings. When the check drops every finding, tell the user that no finding passed the check, and stop.

Show each finding block that the check keeps, as the agent returned it, in rank order.

### 4. Ask for the pick

Ask the user to choose, with the header `Pick` and the question `Which findings do I apply?`. Allow several choices. The options are the first four findings, each as `F<n>` with its `Finding:` sentence. With one finding, add the option `none`. The free-text answer takes any other finding number, or `none`.

With `none`, or with no choice, change no file, and stop.

### 5. Apply each pick

Apply the picks in rank order, one at a time. Each pick follows the route that the first line of its finding names. Skip a pick whose target line an earlier pick removed, and tell the user.

- **The pointer route.** Edit the project instruction file. Replace the line that `Change:` names, or add the one line under the heading of the nearest topic. Add no heading. Add no line that the file holds already. A pointer is one line that names a path and what the path holds. When the project has no instruction file, write the project instruction file with the one line.

- **The check route.** Delegate to the dev agent that matches the domain of the check, for example `backend-dev`. With no such agent, delegate to a fresh agent. Run one check agent at a time, and wait for its result. Write the prompt from the block below. Paste the `## Tool rules` section and the finding block into their slots, word for word. After a rule pick of this run edits `.beast-mode/tool-rules.md`, paste the section as the edit left it. Send the rest of the block word for word.

  ```text
  <the ## Tool rules section of .beast-mode/tool-rules.md, word for word>
  (Source of the block above: `.beast-mode/tool-rules.md`.)

  <the finding block of the pick, word for word>

  Do these steps in order.
  1. Add the check of `Change:` to the gate of the project.
  2. Copy the mistake of the step into a scratch file. Run the check, and see it fail.
  3. Always delete the scratch file.
  4. Run the check on the tree, and see it pass. Change no source file to make it pass.
  5. Return `PASS` with the check command and the last lines of both runs. On any other result, restore every file that you changed, and delete every file that you added. Then return `FAIL` with the last 30 lines and the restored files.

  At 100 tool calls, return what you have.
  ```

  Show the whole result to the user.

  - After a `PASS` of a steering finding, edit the project instruction file. Delete the line that the check replaces.
  - After a `PASS` of the no-check finding, add one pointer line that names the check command. Add it as the pointer route adds a line. Add no line when the project instruction file names a check command already.
  - After a `FAIL`, change nothing more for the pick.

- **The rule route.** Edit the target file that the first line of the finding names. The route edits only `.beast-mode/tool-rules.md` and `.beast-mode/phase-handoff.md`. For another target file, change no file, and tell the user.

  In `.beast-mode/tool-rules.md`, replace or reword one of the seven rules of the `## Tool rules` section, as `Change:` names. Keep the rule on one line, with its number. Never add an eighth rule. When `Change:` adds a rule, or changes a line outside the seven rules, change no file, and tell the user.

  After that edit, run a shell command one time: `awk '/^## Tool rules/{s=1} s{w+=NF} s&&/^[0-9]+\. /{r++} END{print w" words, "r" rules"}' .beast-mode/tool-rules.md`. It prints the word count and the rule count of the section. The section must stay under 200 words and hold seven rules. When a limit fails, restore the old line. Tell the user the two counts and any restore.

  In `.beast-mode/phase-handoff.md`, add or reword one line in the section that `Change:` names. Never edit section 13, and never add a section. When `Change:` names section 13 or a new section, change no file, and tell the user. Add a new numbered rule at the end of the list in its section, with the next number. Renumber no rule, because other text names a rule by its number. Also update the count sentence in its section, for example `Six rules keep the parent small.`

  When an edit stays in the file, tell the user the upgrade note below. Put the path of the file into the `<file>` slot.

  ```text
  <file> is a Beast Mode file. The next beast-mode upgrade keeps your edit and skips this file. Merge a new release of the file by hand.
  ```

### 6. Report

Show the report in the block below. Write one line for each applied pick. Under a check pick, add the `Check:` line with the check command and its result. When a check pick also edits the project instruction file, name that edit in the change. End with the path of the transcript.

Under a rule pick, add the `Upgrade:` line with the upgrade note of step 5. When the count of step 5 restores the old line, name the restore in the change. Then add no `Upgrade:` line.

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SESSION REVIEW COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

F<n>: <route> <file> - <the change, in short>
  Check: <the check command> - <PASS or FAIL>
  Upgrade: <the upgrade note of step 5>

Transcript: <the path of the transcript>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Important Notes

- **DO** show every finding before any change.
- **DO** apply only the picks of the user.
- **DO** show the check command and the result of each check pick.
- **DO** show the upgrade note for each rule edit that stays in the file.
- **DO NOT** review the code or read a source file for review.
- **DO NOT** read the transcript into this context, apart from the lines of the moment check.
- **DO NOT** write a new standards file.
- No other command calls `/review-session`.
