---
name: orca-setup
description: "Set up the orchestration settings of /orca-feature and /orca-epic: which agent plans, builds, verifies, reviews, and writes the docs, how often a commit runs, and whether lanes run side by side. Writes .beast-mode/orca.json. Usage: /orca-setup"
user-invocable: true
---

You have been asked to set up the orchestration settings of this project. The settings tell `/orca-feature` and `/orca-epic` which agent runs each stage. You find out what the machine can run, ask a few questions, and write the `orchestration` object of `.beast-mode/orca.json`.

- `beast-mode orca detect` reads the machine and the settings file. It prints one JSON object.
- `beast-mode orca config --write <file>` writes the answers. The writer owns the file, keeps every other key, and refuses a bad value.

You change no other file. You start no Orca tab, and you run no other Orca command. Run every command from the project root.

---

## Harness

This command runs on any agent harness. Read `.beast-mode/harness.md` first.
It maps the neutral terms in this command to the tools of this harness.
Terms include: ask the user to choose, delegate to an agent, search the web,
and the harness skills directory. Use the mapped tool. Do not use a tool name
from another harness.

## Epic awareness

This command is epic-aware. It takes no argument and writes `.beast-mode/orca.json`
only, so it needs no epic-reference resolution and it reads no feature path.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. This command's body is the setup workflow; it does **not** re-specify those rules.

---

## Process

### 1. Detect

Run a shell command: `beast-mode orca detect`. When the shell finds no `beast-mode`, read the `## Notes` section of `.beast-mode/harness.md` for the absolute form of the CLI, and use that form for every command below.

When the command exits with a code that is not 0, end the run, and show the output as it is. Else read the one JSON object that it prints. When its `schema` is not `1`, end the run, and tell the user to upgrade Beast Mode. Else show its `say` line.

The object holds these fields:

- `orca`: `found`, `running`, `detail`.
- `harnesses`: each installed harness, with `id`, `command`, `onPath`, and `usable`.
- `usable`: the ids that you may offer.
- `config`: `file`, `state`, `problems`, `hasOrchestration`, `orchestration`, `resolved`, `launchTable`.
- `suggested`: `stages` and `source`.
- `projectSkills`: the skills of the project, each with `harness`, `name`, `description`, and `path`. A skill that Beast Mode ships is not in the list.
- `editedAutoruns`: each autorun skill that the user edited, with `harness`, `skill`, `path`, `sourceFound`, `added` (the lines that the user added), and `more` (true when the list was cut).
- `offer`: `"setup"` or `"none"`.

### 2. Stops

Check these in order. On the first one that applies, show the text, and end the run. Offer no write.

1. **No Orca CLI** (`orca.found` is false): show each line of `orca.detail`. Tell the user to install Orca and to run `/orca-setup` again.
2. **No usable harness** (`usable` is empty): list each harness of `harnesses` with its `command` and its `onPath` value. Tell the user to install a harness with `beast-mode install <harness>`, and to put its command on `PATH`. Then end the run.
3. **An invalid file** (`config.state` is `invalid`): show `config.file` and each entry of `config.problems`, as its `code` and its `at` path. Tell the user to fix the file or to delete it, and to run `/orca-setup` again. The writer refuses an invalid file, so do not try to write over it.

An Orca app that does not run (`orca.running` is false) is not a stop. Show a warning line: the settings are written now, and a run needs the app.

### 3. Show the current state

Show a short block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ORCA SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Settings file: <config.file> (<config.state>)
Usable agents: <usable, with commas>
Commands: <each harness id with its command, such as claude=claude, dsh=dsh-personal>
Plan / Build / Verify / Review / Docs: <the five values>
Commit: <phase | feature>    Concurrent: <true | false>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Take each command from `harnesses[].command`. It is the first word of `agents.<id>.command` in `config.agents`, else the id. A project command of `orca.json` starts the tab of that agent. Ask no question about commands: the user edits `agents` by hand or in the launch settings.

Take the five values from `config.resolved.stages`, the commit value from `config.resolved.commit`, and the concurrent value from `config.resolved.concurrent`, when `config.hasOrchestration` is true. Else take the stages from `suggested.stages` and say where they come from: `suggested.source` is `launch-table` (the nine-button table of the launch settings) or `defaults`. Name the commit value as `phase` and the concurrent value as `true`, the defaults.

---

## The questions

Use two calls of "ask the user to choose" for the agents, then the steps round below. Put the **current** value first in each option list, and mark it as the recommended option. With no current value, put the **suggested** value first. Offer only ids from `usable`. When `usable` holds one id, still ask, with that one id.

### Call 1: the four agents

| Question | Options | Meaning |
|---|---|---|
| Plan | the usable ids | The agent that runs `/plan-feature` and `/start-feature`. |
| Build | the usable ids | The agent that builds each phase. The key is `implement`. |
| Verify | the usable ids | The agent that verifies a phase and fixes it. The same id as Build means no separate verify tab. |
| Review | the usable ids, then `off` | The agent that runs the cross-phase review. `off` means no review. |

For Review, the same id as Build means the review runs in the last phase tab. `off` is an option in every list, and it is never the first one, unless the current value is `false`.

### Call 2: docs, commit, and concurrency

| Question | Options | Meaning |
|---|---|---|
| Docs | the usable ids | The agent that writes the docs at the end of a feature. Put the Build answer first. |
| Commit | `phase`, `feature` | `phase` commits after each phase. `feature` commits one time at the end. Recommend the current value, else `phase`. |
| Concurrent | `true`, `false` | `true` lets the lanes of an epic run side by side. `false` runs one lane at a time. Recommend the current value, else `true`. |

---

## The steps round

A **step** is one command that a worker tab runs at a point of the run, and that writes a verdict. This round suggests step lines. Run it after call 2.

### Name the candidates

1. **The current lines.** Each line of `config.orchestration.steps`. These come first.
2. **Project skills.** Each entry of `projectSkills`. Use its `description` to judge the point. A skill that reviews or checks work fits after a phase or a feature.
3. **Added lines of an edited autorun.** Each entry of `editedAutoruns` with a non-empty `added` list. Read the lines in `added`. When a line runs a command that the user added, such as a review, a check, or a test, suggest that command as a step. When `sourceFound` is false, say that the plugin source was not found, and suggest nothing from that entry. When `more` is true, say that the list was cut.
4. **Beast Mode review commands.** `/review-ux`, `/review-ui`, `/review-mobile`, `/review-pr`, `/review-feature`, and `/review-epic`. Suggest a command only when it makes sense for the project, such as `/review-mobile` for a mobile project.

Suggest at most 16 lines in all, with the current lines counted.

### Make each suggestion

Show each candidate as one step line with three parts:

| Part | Rule |
|---|---|
| Point (`after`) | `phase`, `feature`, or `epic`. A review of one feature fits `feature`. A review of an epic fits `epic`. A check of one phase fits `phase`. |
| Command | Starts with `/`, one line, 1 to 200 characters. Put tokens in it: `{feature}` and `{phase}` after a phase, `{feature}` after a feature, `{epic}` after the epic. No other token is valid. |
| Agent | `claude` or `dsh`. Use an id from `usable`. Recommend the Review agent of call 1. |

Example: `{ "after": "feature", "command": "/review-ux {feature}", "agent": "claude" }`.

### Ask

Use one call of "ask the user to choose", with multi-select. Each option is one suggested line. Put the current lines first, and mark them as the recommended options. Add the option `no steps`. The user may also name a line by hand. Check a hand-written line against the table above before you use it.

The writer replaces the whole `orchestration` object, so a patch with no `steps` key removes the current lines. Always put `steps` into the patch. When the user picks `no steps`, write `"steps": []`.

---

## The write

1. **Build the patch.** Write a file `.beast-mode/briefs/orca-setup/orchestration.json`. It holds only the `orchestration` object, with this shape:

```json
{
  "stages": {
    "plan": "claude",
    "implement": "dsh",
    "verify": "dsh",
    "review": "claude",
    "docs": "dsh"
  },
  "commit": "phase",
  "concurrent": true,
  "steps": [
    { "after": "feature", "command": "/review-ux {feature}", "agent": "claude" }
  ]
}
```

   Write the answers as given. Write `"review": false` for the answer `off`. Write `concurrent` as a JSON boolean, not as a string. Write `steps` as the array of the chosen lines, each with exactly `after`, `command`, and `agent`. Write `"steps": []` when the user chose no line.

2. **Run the writer.** Run a shell command: `beast-mode orca config --write .beast-mode/briefs/orca-setup/orchestration.json`. Use the same form of the CLI as in step 1.
3. **Read the result.** When the command exits with a code that is not 0, end the run, and show the output as it is. Else read the one JSON object that it prints.
   - `"ok": false` is a refusal. Show its `say`, each line of `detail`, and its `code`. Show each entry of `problems` when it holds any. The settings file did not change. Offer to ask the questions again, and end the run.
   - `"written": true` is a success. Show its `say`, and show the new `resolved` values as in the block of step 3.
4. **Next commands.** Tell the user:
   - Commit `.beast-mode/orca.json`, so the team shares the settings.
   - Run `/orca-feature <feature>` to build one feature, or `/orca-epic <epic>` to build an epic.
   - Run `/orca-setup` again to change a value.

---

## When to stop

Stop when the user ends the run, when a stop of step 2 applies, or after the result of the writer. Do not retry a refused write with the same patch.

## Notes

- Offer only usable ids. A usable id is an installed harness whose command is on `PATH`. The worker tab needs the Beast Mode files of its harness, and the CLI must start.
- The writer keeps unknown keys and their order, so the launch settings of the Orca panel and this command share the file.
- `verify` and `docs` follow `implement` when the file names no value. A changed Build answer therefore opens no surprise verify tab.
- Use only the neutral terms of `.beast-mode/harness.md`. Name no tool of a harness.
