---
name: token-report
description: "Report the token and step use of every session, and name every session that carries a flag. Usage: /token-report"
user-invocable: true
---

You have been asked to report the token and step use of this project's sessions.

## Harness

This command runs on any agent harness. Read `.beast-mode/harness.md` first.
It maps the neutral terms in this command to the tools of this harness.
Terms include: ask the user to choose, delegate to an agent, search the web,
and the harness skills directory. Use the mapped tool. Do not use a tool name
from another harness.

## Epic awareness

This command is epic-aware. It takes no argument and reports on the whole
project, so it needs no epic-reference resolution. Detect epics by
`epic-overview.md` only to name each session against the feature or epic it
belongs to.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. This command's body is the token-report workflow; it does **not** re-specify those rules.

## Process

### 1. Run the token report

Run a shell command: run `beast-mode tokens`.

### 2. Fall back to the absolute path form

When the shell reports that the command is not found, read the `## Notes`
section of `.beast-mode/harness.md` for the absolute path form of the CLI,
and run that form instead.

### 3. Show the table

Show the table that the command prints, with no change. A harness that ships
a token reader prints a real table of sessions and tokens. When the command
prints the line `ℹ The plugin ships no token reader for the harness "<id>" yet.`
for another harness, show that line as it is.

### 4. Name every flagged session

Read the `flag` column of the table. Name every session that carries a flag,
with its id and its flag.

A flagged session points at one of two rules of `.beast-mode/phase-handoff.md`:

- **`steps-over-100`** — the task group split. The delegator splits a phase
  into smaller task groups, so a subagent finishes in fewer steps.
- **`final-prompt-over-300k`** — the stop rule. The subagent writes the state
  to `context.md`, lists the open tasks, and stops, before its prompt grows
  further.

State no threshold number that the command output does not print. Point the
user at `.beast-mode/phase-handoff.md` for the full rule text.
