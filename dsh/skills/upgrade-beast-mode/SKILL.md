---
name: upgrade-beast-mode
description: "Upgrade the Beast Mode installation in this project. Usage: /upgrade-beast-mode"
user-invocable: true
---

# Upgrade Beast Mode

You upgrade the Beast Mode installation in this project. Follow the eleven steps in order.

When you copied this file by hand, replace `{{BEAST_MODE_ROOT}}` with the absolute path of the beast-mode package.

## Step 0: Update the Beast Mode package

This skill never runs the package update. The update changes the running profile, and it needs a profile name that this session does not hold.

Print this block.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 UPDATE THE BEAST MODE PACKAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run this in a terminal, with the profile that you
use for this project:

  dsh plugin --profile <name> update beast-mode

Start a new dsh session after the update. This
session keeps the package that it loaded.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Call the `ask_user_question` tool with one question.

- Question: "Did you update the Beast Mode package?" Header: "Package".
- Option 1: "I ran it (Recommended)". Description: "Upgrade with the package on disk."
- Option 2: "Skip". Description: "Continue with the package that this session loaded."

Continue with either answer. Every later step reads the package on disk.

## Step 1: Confirm the install

Read `.agents/.beast-mode-manifest.json`. That file marks a Beast Mode install for this harness, and it lists every file that Beast Mode wrote.

When the file exists, print `✅ Beast Mode detected.` and continue.

When the file is absent, look for `.agents/skills/start-feature/SKILL.md`. That folder marks an install that wrote no manifest. Continue, and let Step 5 report every file that the CLI cannot prove.

When both are absent, print this block and stop.

```
❌ Beast Mode is not installed in this project.
Run /install-beast-mode to set it up first.
```

## Step 2: Read the installed version

Read `.agents/.beast-mode-version`. Print `Current Beast Mode version: [version]`.

When the file is absent, treat the install as `5.2.0`. That is the first version that ships this harness.

## Step 3: Read the package version and the changelog

Read the `version` field of `{{BEAST_MODE_ROOT}}/.claude-plugin/plugin.json`. That field is the package version.

Read `{{BEAST_MODE_ROOT}}/CHANGELOG.md`. Find every entry that is newer than the version of Step 2.

When the two versions match, continue to Step 5. A past run can still leave a missing file or a stale file.

## Step 4: Show what is new

Print the newer entries. Skip this step when Step 3 found no newer entry.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 UPGRADE AVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current version: [installed version]
Package version: [package version]

📋 What is new:
[every changelog entry between the two versions]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**For v6.0 upgrade**, when the upgrade crosses 6.0.0, add this block to the output:

```
🚀 NEW - The deterministic loop:
  • .beast-mode/interview.md holds the plan interview rules. /plan-feature
    and /plan-epic ask their questions in rounds of up to four, and a
    stop check lists the assumptions before the plan starts.
  • A phase is a slice now. Each phase carries a Demo line and a Needs
    line. After each phase, the post-phase step verifies, records, and
    shows a test prompt. It runs up to three fix rounds for one fault.
  • docs/features/<feature>/inbox.md is the feature inbox. A fault, a
    change, or guidance that you send during a run gets one line. The
    command acts on it after the phase.
  • The glossary in .beast-mode/harness.md has a new term: "send a
    message to an agent". It maps to send_message on dsh.
  • /review-session is the 27th command skill. It lives under
    .agents/skills/. It reads the log of one session and proposes a
    pointer in AGENTS.md, a check, or a rule line.
  • beast-mode transcript reads a dsh session log, and it prints the
    numbered steps of one session. /review-session writes them to
    .beast-mode/briefs/review-session/<session-id>.txt.
  • No project needs an upgrade step. The upgrade adds the new files.
    It skips a file you edited, so a project that edited plan-feature
    keeps the old interview.
```

## Step 5: Run the dry run

Run the two commands below with the `bash` tool.

```bash
node --version
node {{BEAST_MODE_ROOT}}/installer/bin/beast-mode.js upgrade dsh --dry-run
```

The installer needs Node.js 20 or later. When `node --version` fails, print this block and stop.

```
❌ Beast Mode cannot upgrade: Node.js is missing.
The installer runs on Node.js 20 or later. Install it
from https://nodejs.org, then run this command again.
```

The dry run reads every shipped template, compares it with the project, and prints the full plan. It changes no file, and it writes no manifest. Compare no file yourself, and build no file list.

Print the plan to the user. Do not rebuild it, and do not summarize it away. The output opens with the `🔍 UPGRADE PLAN (dry run)` banner, lists one line per planned action, and closes with the `📋 UPGRADE PLAN SUMMARY` counts.

When every count reads 0 apart from `✓ Up to date`, and Step 3 found no newer version, print `✅ Beast Mode is already up to date.` and stop.

When the CLI exits non-zero, it prints three lines: what failed, why it failed, and what to do next. Show the three lines and stop. These three exit codes are the likely ones.

| Exit | Meaning | Action |
| --- | --- | --- |
| 1 | Source invalid. A template failed validation | Reinstall the package, then run `/upgrade-beast-mode` again |
| 4 | Guard refusal. A Beast Mode path is a symlink, or the project is the Beast Mode repo | Stop. Work around no guard |
| 5 | Manifest conflict. The manifest is unreadable, or it names another harness | Ask the user to move that file aside, then run the dry run again |

## Step 6: Ask for confirmation

Call the `ask_user_question` tool with one question.

- Question: "Do I apply this upgrade now?" Header: "Upgrade".
- Option 1: "Yes, upgrade now (Recommended)". Description: "Back up every replaced file, then write the new files."
- Option 2: "Show me what changed". Description: "List the changelog entry of each updated file."
- Option 3: "Cancel". Description: "Keep the current version."

For option 2, name the changelog entry of each file that the plan marks `✅ Updated`, then ask again.

For option 3, print `Upgrade cancelled. Run /upgrade-beast-mode when you are ready.` and stop.

## Step 7: Apply the upgrade

Run this command with the `bash` tool.

```bash
node {{BEAST_MODE_ROOT}}/installer/bin/beast-mode.js upgrade dsh
```

The CLI backs up each file that it replaces, and it writes the new files. It prunes a file that the package stopped shipping, and it writes the manifest last. Copy nothing by hand.

Print the summary to the user. A finished run ends with the `✅ UPGRADE COMPLETE!` banner, the nine counts, the version line, the backup path, and the manifest path. The CLI states its own rules, so restate none of them.

When the CLI exits non-zero, show its three lines and stop. Name the backup path when the output holds one. The CLI backs a file up before it writes that file, so a stopped run leaves the old copy in the backup directory.

**The stale warning.** The CLI may print this after the upgrade, naming a harness that falls behind:
```
⚠ 1 other harness in this project is behind the plugin version:
    claude (.claude/) holds v5.3.0. The plugin ships v5.4.0.
```
Show it. Name `beast-mode upgrade` with no harness as the fix for every harness.

## Step 8: Offer the force pass

A skip never changes the exit code. The run exits 0, and the upgrade continues.

When the summary counts one or more skipped files, the CLI printed an `⏭️ Skipped files` section above the banner. Those files hold your edits. Show that list, then call the `ask_user_question` tool.

- Question: "Do I take the package version of the skipped files?" Header: "Skipped".
- Option 1: "Keep my versions (Recommended)". Description: "The files stay as they are. Merge the changes yourself later."
- Option 2: "Take the package version". Description: "Back each file up, then write the package version."

For option 2, run the command below and print its summary. A backup runs first, so the old copy of each forced file lands in the backup directory.

```bash
node {{BEAST_MODE_ROOT}}/installer/bin/beast-mode.js upgrade dsh --force
```

## Step 9: Confirm the result

Read `.agents/.beast-mode-version`. It must hold the package version of Step 3. Write that file by hand only when the CLI summary showed no version line.

Read `.beast-mode/harness.md`. It must hold a section for `dsh`. The core composes this file from the harness set on every upgrade, and it backs the old copy up first when the bytes change. A user edit does not survive that pass, and `--force` reaches no shared row. When the dsh section is absent, run `beast-mode install dsh` to add it.

Print the closing block.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ BEAST MODE UPGRADED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Version: v[old] to v[new]
Backup:  [the path from the CLI summary, or none needed]
Skipped: [the count of the files that you edited]

New in this version:
  [one line per changelog headline of Step 4]

Commit .beast-mode/ with the project. Every harness reads it.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 10: Offer the Orca setup

Run this step last, after the closing block.

1. Run this command with the `bash` tool.

   ```bash
   node {{BEAST_MODE_ROOT}}/installer/bin/beast-mode.js orca detect
   ```

   It prints one JSON object. Read the `offer` key.
2. When `offer` is `"none"`, show nothing and end. The Orca CLI is absent, or `orca.json` already holds a valid `orchestration` object.
3. When `offer` is `"setup"`, call the `ask_user_question` tool with one question.
   - Question: "The Orca CLI is installed. Do I set up Orca orchestration now?" Header: "Orca setup".
   - Option 1: "Set it up now (Recommended)". Description: "Choose the agent for each stage and add custom steps."
   - Option 2: "Later". Description: "Run `/orca-setup` at any later time."
4. For now, load the `orca-setup` skill with the `skill` tool and follow it. dsh needs no restart. When the catalog lists no such skill yet, read `.agents/skills/orca-setup/SKILL.md` and follow it inline.
5. For later, name `/orca-setup` as the command to run.

## Rules

- Run the dry run of Step 5 before every apply. Never apply an unseen plan.
- Print the CLI output. Compare no file yourself, and copy no file by hand.
- Put the recommended option first in every `ask_user_question` call. Add `(Recommended)` to its label.
- Report a CLI failure with the three lines that the CLI printed. Work around no guard.
- Offer to change a dev agent whose Load Context step reads three whole feature files. Name `.beast-mode/tool-rules.md`, and edit the agent only after the user answers.
- Offer the `subagent-model-selection` setting and the route line for a standard dev agent that holds none. Print the settings card steps of Step 5 of the install skill. Write the line in the same form, `**Model route:**` plus the provider and the model in backticks. Edit an agent only after the user answers.
- Write no file outside this project. Never write `settings.yaml`.
- Keep every file that the user edited. `--force` is the one exception, and the user asks for it in Step 8.
- Put shared project guidance in `AGENTS.md` at the project root. Add one line to `CLAUDE.md`: `@AGENTS.md`. dsh reads both files and drops a byte-identical duplicate, so the guidance stays in one place.
