---
description: "Upgrade Beast Mode installation in this project with latest templates, commands, and improvements from the plugin. Usage: /upgrade-beast-mode"
---

You have been asked to upgrade the Beast Mode installation in this project.

## Process

### 0. Pull Latest Plugin

Before doing anything else, pull the latest version of the plugin repository:

```bash
git -C "${CLAUDE_PLUGIN_ROOT}" pull --ff-only 2>&1
```

- If the pull succeeds, show: `✅ Plugin updated to latest`
- If the pull fails (e.g. no remote, local changes, network error), show a warning but **continue with the upgrade** using whatever version is currently on disk:
  ```
  ⚠️ Could not auto-update plugin (git pull failed). Continuing with local version.
  ```
- Do NOT abort the upgrade if the pull fails — the user may have manually updated or may be offline

### 1. Verify Beast Mode is Installed

Beast Mode has two install layouts. Detect the one this project uses:

- **Layout v5** (Beast Mode 5.0.0 and later): `.claude/skills/start-feature/SKILL.md` exists. The shared files live in `.beast-mode/`.
- **Layout v4** (Beast Mode 4.1.2 and earlier): `.claude/commands/start-feature.md` exists. The shared files live in `.claude/`.

Beast Mode is installed when either marker exists. `docs/features/` usually exists as well, but a project with no feature yet is still a valid install.

**Report the layout you found.** For layout v5:
```
✅ Beast Mode detected. Layout v5 (shared files in .beast-mode/)
```

For layout v4:
```
✅ Beast Mode detected. Layout v4 (shared files in .claude/)
   Step 8b moves this project onto layout v5.
```

**When both markers exist,** treat the project as layout v4. A leftover `.claude/commands/<name>.md` and a `.claude/skills/<name>/SKILL.md` both answer `/<name>`, so Step 8b removes the old copy.

If neither marker exists:
```
❌ Beast Mode not detected in this project.

Run /install-beast-mode to set up Beast Mode first.
```

### 2. Check Current Version

Look for `.claude/.beast-mode-version` file:
- If exists, read current version
- If doesn't exist, assume version "1.0.0" (original installation)

**Show current version:**
```
Current Beast Mode version: [X.X.X]
```

### 3. Read Plugin Version and Changelog

Read from plugin:
- Plugin version: `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` → `version` field
- Changelog: `${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md`

Parse CHANGELOG.md to find all versions newer than current project version.

**If project is up to date (versions match):**
- Do NOT exit yet — continue to step 5 to check for missing files
- Files may have been added in patch releases or missed during a previous install
- If step 5 finds no missing or outdated files, THEN show "already up to date" and exit

**If upgrade available (version mismatch):**
Continue to step 4.

### 4. Show What's New

Display changelog entries for versions between current and latest:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 UPGRADE AVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current version: [old version]
Latest version: [new version]

📋 What's New:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Include full changelog entries for all versions between current and latest]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5. Analyze What Will Be Updated

The installer CLI computes the update plan. Run the Node check first, because this step makes the first CLI call:

```bash
node --version
node ${CLAUDE_PLUGIN_ROOT}/installer/bin/beast-mode.js upgrade claude --dry-run
```

**If `node --version` fails,** the machine has no Node.js. Show this message and stop the upgrade. Copy no file by hand:

```
❌ Beast Mode cannot upgrade: Node.js is missing.

The Beast Mode installer runs on Node.js 20 or later.
Install Node.js from https://nodejs.org, then run
/upgrade-beast-mode again.
```

The CLI itself checks the Node.js version. When it finds an older Node.js than 20, it exits 2 with a cause and a fix line naming https://nodejs.org. Show those lines and stop.

The dry run reads every shipped template, compares it with the project, and prints the full plan. It changes no file and it writes no manifest. Do not compare any file yourself, and do not build a file list.

**The manifest rule.** `.claude/.beast-mode-manifest.json` lists every file Beast Mode wrote and the sha256 of the written content. The CLI compares that hash against the file on disk:

- The hashes match, so Beast Mode owns the file. The CLI updates it when the plugin file differs, and it backs the old copy up first.
- The hashes differ, so you edited the file. The CLI skips it and reports it. Your file stays exactly as it is.

The manifest replaces the old CUSTOMIZED guess. No file category is customized by default any more, agents included.

**A project with no manifest.** Beast Mode 5.0.0 installed with a bash script and wrote no manifest. On the first upgrade the CLI has no ownership record, so it compares the disk against the plugin only. An equal file is adopted, a missing file is added, and every file that differs is skipped and reported. The run writes the manifest, so the next upgrade has the full record. The CLI prints this note in its summary:

```
ℹ This project held no Beast Mode manifest before this run.
  Beast Mode cannot tell a file you edited from a file the plugin changed,
  so it skipped every file that differs and it changed nothing.
```

**On a layout v4 project the shared files still sit in `.claude/`.** That project has no `.claude/skills/`, no `.beast-mode/templates/`, and no `.beast-mode/` reference file, so the dry run reports every file as `🆕 Added`. That is expected. Step 8b moves the old copies first, and Step 10 then runs the CLI over the layout it creates.

**Hooks are no longer part of Beast Mode.** Earlier versions installed three hooks
(`skill-reminder`, `edit-tracker`, `build-check`) and a `skill-rules.json`. These have
been removed from the plugin — the CLI ships no hook template, and the upgrade
does **not** touch any hook files already present in the project. If `.claude/hooks/` or
`.claude/skills/skill-rules.json` exist from a previous install, leave them exactly as
they are (do not update, do not delete). See the note in Step 6.

**If the CLI exits non-zero,** it prints three lines: what failed, why it failed, and what to do next. Show those three lines and stop the upgrade. The codes you are most likely to see:

- `4` — a guard refused the run. A Beast Mode directory is a symlink, or the project root is the Beast Mode plugin repo itself. Never work around a guard.
- `5` — `.claude/.beast-mode-manifest.json` is unreadable, holds another harness, or names a path outside the project. Ask the user to move that file aside, then run the dry run again.
- `1` — a plugin template failed validation. Reinstall the plugin, then run `/upgrade-beast-mode` again.

### 6. Show Update Plan

The dry run of Step 5 is the update plan. Print its output to the user. Do not rebuild it, and do not summarize it away.

The output opens with this banner:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 UPGRADE PLAN (dry run)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ This is a preview. The dry run changes no file and writes no manifest.
```

Then it lists one line per planned action, under the same section headings the install uses. It closes with the counts:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 UPGRADE PLAN SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🆕 Added: 0
  🆕 Restored: 0
  ✅ Updated: 0
  ✅ Forced: 0
  ✓ Adopted: 0
  ✓ Up to date: 38
  ⏭️ Skipped: 0
  🗑️ Pruned: 0
  ⚠ Kept: 0

  📦 Backup: none needed
  📄 Manifest would be written to: .claude/.beast-mode-manifest.json
```

**When the plan reports a skip,** the CLI prints an `⏭️ Skipped files` section above the summary. Those files carry your edits, so the upgrade leaves them alone. Step 10 offers the force run for them.

**When every count reads 0 apart from `✓ Up to date`,** and Step 3 found no newer version, the project is current. Show this and exit:

```
✅ Beast Mode is already up to date.
```

**Hooks removed (note for the user):** If the project still has a `.claude/hooks/`
directory or `.claude/skills/skill-rules.json` from an earlier Beast Mode version,
include this note in the plan:

```
ℹ️  Hooks are no longer part of Beast Mode.
Earlier versions installed hooks (skill-reminder, edit-tracker, build-check) and a
skill-rules.json. Skills now load natively from each skill's SKILL.md `description`,
so the auto-reminder hook is no longer needed. Your existing hook files are left
untouched — remove .claude/hooks/ and .claude/skills/skill-rules.json yourself if
you no longer want them.
```

### 7. Ask for Confirmation

Use **AskUserQuestion** tool:

**Question:** "Ready to upgrade Beast Mode?"
**Header:** "Upgrade"
**MultiSelect:** false
**Options:**
1. **label:** "Yes, upgrade now"
   **description:** "Backup existing files and install updates"
2. **label:** "Show me what changed"
   **description:** "View diffs for updated files before proceeding"
3. **label:** "Cancel"
   **description:** "Keep current version"

**If "Show me what changed":**
- For each file the plan marks `✅ Updated`:
  - Show brief diff or description of changes from changelog
  - Reference specific CHANGELOG entries
- Then ask again (return to step 7)

**If "Cancel":**
- Exit command with message:
  ```
  Upgrade cancelled. Run /upgrade-beast-mode when you're ready.
  ```

**If "Yes, upgrade now":**
- Continue to step 8

### 8. Handle v1 → v2 Migration (if applicable)

**Check if upgrading from v1.x to v2.x:**
- If current version starts with "1." and new version starts with "2."
- This is a major version upgrade requiring migration

**If v1 → v2 migration needed:**

Show migration notice:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  MAJOR VERSION UPGRADE: v1 → v2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Beast Mode v2.0 removes the /dev folder and consolidates
everything into docs/features/ for Cursor compatibility.

Migration will:
  1. Copy all features from dev/active/ → docs/features/
  2. Copy all features from dev/completed/ → docs/features/
  3. Rename plan.md → implementation.md in each feature
  4. Create backup of /dev folder
  5. Delete /dev folder

This is automatic and safe (backup created first).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Run migration script:**
```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-v1-to-v2.sh
```

**Wait for script to complete** - it will:
- Create backup automatically
- Migrate all features
- Ask user before deleting /dev (automated)
- Show migration summary

**If migration script succeeds:**
- Continue to step 8b (the layout v4 to v5 migration)

**If migration script fails:**
- Show error
- Stop upgrade process
- Provide recovery instructions

**If NOT v1 → v2 migration:**
- Skip to step 8b directly

### 8b. Layout v4 to v5 Migration

**When to run this step:** `.claude/commands/start-feature.md` exists. That file marks layout v4. Otherwise skip to Step 9.

Beast Mode v5 ships every command as a skill and keeps the shared files in one harness-neutral directory. This step moves the project onto that layout. **The bash migration runs before the installer CLI:** this step creates the v5 directories, and the CLI in Step 10 then writes the current files into them.

**1. Show the migration notice:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  LAYOUT CHANGE: v4 → v5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Beast Mode v5 ships each command as a skill and keeps
the shared files in .beast-mode/, where every harness
reads them.

The migration will:
1. Back up the Beast Mode files under .claude/ into
   .claude/.beast-mode-backup-<timestamp>/: the commands/
   directory, the templates/ directory, and the 5 format
   references
2. Move the feature doc templates out of .claude/ into
   .beast-mode/templates/
3. Move epic-resolution.md, agent-structure-example.md,
   skill-structure-example.md, mission-statement-template.md,
   and technical-design-template.md from .claude/ → .beast-mode/
4. Delete the Beast Mode command files in .claude/commands/,
   one per command the plugin ships. Step 10 installs the same
   commands as skills in .claude/skills/

What the migration never touches:
  • A command file you wrote yourself stays in .claude/commands/
  • A skill folder in .claude/skills/ that Beast Mode does not ship
  • .claude/agents/, .claude/hooks/, and docs/features/

Command names, arguments, and output paths do not change.
The backup holds every original.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**2. Run the migration script** from the project root:
```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-v4-to-v5.sh ${CLAUDE_PLUGIN_ROOT}
```

Argument one is the plugin root. The script reads the shipped command names from `${CLAUDE_PLUGIN_ROOT}/templates/skills/`, and it deletes a command file only when that list holds the name.

**3. Read the script summary.** It reports the number of shared files moved, the number of command files deleted, the number of your own command files kept, and the backup path. Show that summary to the user.

**If the script exits 0:** continue to Step 9.

**If the script exits 1:** show its error, stop the upgrade, and name the backup path. The script makes the backup before the first move, and it makes no change at all when a guard fires, so the project stays usable.

The script refuses to run in three cases. Report the cause to the user rather than working around it:
- A Beast Mode directory is a symlink. The script checks `.claude/skills`, `.claude/commands`, the layout v4 template directory in `.claude/`, `.beast-mode`, and `.beast-mode/templates`. A project that links into another source tree needs a manual move.
- The project root is the Beast Mode plugin itself.
- The plugin holds no `templates/skills/` directory, so the script cannot tell a Beast Mode command from a command the user wrote.

The installer CLI refuses the first two cases as well, in Step 5 and in Step 10, and it exits 4. Never run either tool inside the Beast Mode plugin repo.

**4. User skill protection.** The manifest implements this rule. The installer CLI writes only a destination that the plugin ships, and it overwrites a file only when the manifest hash still matches your copy. `--force` is the one exception, and it backs your copy up first. These rules hold for every upgrade:
- The upgrade never deletes a skill folder in `.claude/skills/` that Beast Mode does not ship. Only the plugin's own skill names are ever written or removed.
- Layout v4 kept the Beast Mode commands in `.claude/commands/`, so every folder in `.claude/skills/` of a v4 project belongs to the user.
- When a folder there carries a shipped command name, the CLI reports `⏭️ Skipped (yours)` in Step 10 and keeps the user's file. Report the collision with the message below. The migration script reports the same collision.

```
⚠️  Name clash: .claude/skills/<name>/ is yours, and Beast Mode ships a
    command with that name.
    Kept your skill. Beast Mode installed no skill of that name.
    The Beast Mode version stays in the plugin at
    ${CLAUDE_PLUGIN_ROOT}/templates/skills/<name>/SKILL.md
    Rename your skill to run both.
```

### 9. Create Backup

The installer CLI creates the backup in Step 10. Copy nothing by hand.

The CLI copies a file before every overwrite, every forced write, and every prune. It creates no directory when the run needs no backup. The backup keeps the project layout inside itself:

```
.claude/.beast-mode-backup-<YYYYMMDD-HHMMSS>/
├── .claude/skills/plan-feature/SKILL.md
└── .beast-mode/epic-resolution.md
```

Read the path from the CLI summary in Step 10 and show it to the user:

```
📦 Backup: .claude/.beast-mode-backup-20260910-080452/
```

The summary reads `📦 Backup: none needed` when the run replaced no file.

Step 8b wrote its own backup when the project was on layout v4. Keep both directories.

### 10. Update Files

Run the installer CLI without `--dry-run`. It applies the plan the user just approved:

```bash
node ${CLAUDE_PLUGIN_ROOT}/installer/bin/beast-mode.js upgrade claude
```

The CLI backs each file up, writes the new files, prunes a file the plugin stopped shipping, checks for a stale command file, and writes the manifest last. It creates every directory it needs, and it writes no `.claude/commands/` directory. Copy nothing by hand.

**Read the summary and show it to the user.** A finished run ends like this:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ UPGRADE COMPLETE!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🆕 Added: 0
  🆕 Restored: 0
  ✅ Updated: 0
  ✅ Forced: 0
  ✓ Adopted: 0
  ✓ Up to date: 37
  ⏭️ Skipped: 1
  🗑️ Pruned: 0
  ⚠ Kept: 0

  ✓ Version file (v5.4.0)
  📦 Backup: .claude/.beast-mode-backup-20260910-080452/
  📄 Manifest: .claude/.beast-mode-manifest.json
```

Report the counts, the backup path, and the manifest path. Show the same backup path again in the Step 14 summary.

**If the CLI exits non-zero,** show the three lines it printed, stop the upgrade, and name the backup path when the output holds one. The CLI backs a file up before it writes that file, so a stopped run leaves the old copy in the backup directory. Exit 4 means a guard refused the run, and Step 8b lists the two causes.

**If the summary reports a skip,** the CLI printed an `⏭️ Skipped files` section above the `✅ UPGRADE COMPLETE!` banner:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏭️ Skipped files
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Beast Mode changed none of these files:
  ⏭️ Skipped (you edited it): .claude/skills/plan-feature/SKILL.md
```

A skip never changes the exit code, so the run still exits 0 and the upgrade continues. Show the skip list, then offer the force run with `AskUserQuestion`:

**Question:** "Take the plugin version of the skipped files?"
**Header:** "Skipped"
**Options:**
1. **label:** "Keep my versions"
   **description:** "(DEFAULT) The files stay as they are. Merge the plugin changes yourself later"
2. **label:** "Take the plugin version"
   **description:** "Back each file up, then write the plugin version"

**If "Take the plugin version":** run the force pass and show its summary. The CLI copies each old file into the backup directory before it writes, so nothing is lost:

```bash
node ${CLAUDE_PLUGIN_ROOT}/installer/bin/beast-mode.js upgrade claude --force
```

`--force` reaches a file you edited and a file the CLI never owned. It never touches a file it kept, because a kept file names a template the plugin stopped shipping.

**The stale-install warning.** The CLI compares every other harness this project holds against the plugin version, and prints a warning after a real upgrade:

```
⚠ 1 other harness in this project is behind the plugin version:
    dsh (.agents/) holds v5.3.0. The plugin ships v5.4.0.
ℹ Run `beast-mode upgrade` to upgrade every installed harness in this project.
```

Show the warning and name the other harness. This upgrade still only touches `.claude/`. Offer `beast-mode upgrade` (no harness) as an optional extra step, for the user to run later.

### 10b. v2 → v3 Migration: Effort System & Advanced Agents

**When to run this step:** if the upgrade crosses into v3 (current version starts with `1.` or `2.` and new version starts with `3.`) **OR** the project's existing agents have no `effort:` field in their frontmatter. Otherwise continue to Step 10b2.

This is a **major upgrade**. v3 introduces per-agent `model`/`effort` tuning and a second "advanced" tier of dev agents. The installer CLI in Step 10 skips an agent you edited, so migrate those agents here by editing frontmatter in place — **preserving each agent's custom system prompt.**

**1. Show the v3 notice:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  MAJOR VERSION UPGRADE: v2 → v3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Beast Mode v3 adds agent effort tuning (3 presets).
One preset value sets the effort of every agent.
The role sets the model:
  • solution-architect → opus
  • advanced dev agents (NEW) → opus
  • review & evaluation agents → opus
  • standard dev agents → sonnet

I ask you for one preset, then:
  • add effort fields to your existing agents
  • create matching *-advanced agents
  • install the new /proceed-advanced command

Your custom agent prompts are preserved — only the
frontmatter (model/effort) changes.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**2. Ask for the effort preset** — identical to Step 4b of `/install-beast-mode`. Present the three presets in a single `AskUserQuestion` (`High` recommended and first, then `Max`, then `Medium`). One preset value sets the effort of every agent. The role sets the model: a standard dev agent runs on `sonnet`, and every other agent runs on `opus`. From the choice, derive `<EFFORT>`, the one effort value of every agent:

  | Preset | solution-architect | Standard dev | Advanced dev | Review |
  |--------|--------------------|--------------|--------------|--------|
  | `Max` | `opus` @ `xhigh` | `sonnet` @ `xhigh` | `opus` @ `xhigh` | `opus` @ `xhigh` |
  | `High` (default, recommended) | `opus` @ `high` | `sonnet` @ `high` | `opus` @ `high` | `opus` @ `high` |
  | `Medium` | `opus` @ `medium` | `sonnet` @ `medium` | `opus` @ `medium` | `opus` @ `medium` |

**3. Migrate existing agents** in `.claude/agents/`:

- **Exclusion:** never change `model` or `effort` in `feature-orchestrator.md`. Both values are fixed. This exclusion applies to the "any planner/architect agent" bullet below and to the dev agent sweep.
- **solution-architect** (and any planner/architect agent): set `model: opus` and `effort: <EFFORT>` in the frontmatter. (Leave the system prompt as-is. Note in the summary that the v3 template also adds optional `/deep-research` guidance they can pull in manually if wanted.)
- **Each standard dev agent** (e.g. `frontend-dev`, `backend-dev`, `ml-dev`, `dev`, `game-dev`, and any project-specific dev agents that are NOT already `*-advanced`): set `model: sonnet` and set `effort: <EFFORT>`. Add the `effort:` line to the frontmatter when the line is missing. Replace the line when the line exists.
- **Any code-review / PR-review / evaluator agent** the project has: set `model: opus` and `effort: <EFFORT>`.

**4. Create advanced agents** — for each standard dev agent found, create a `<name>-advanced.md` if it doesn't already exist:
- Copy the standard agent's system prompt verbatim.
- Frontmatter: `name: <name>-advanced`, `model: opus`, `effort: <EFFORT>`, keep the same `color` and `tools`, and update the `description` to "Heavyweight … for major refactors, integration-heavy, or high-risk phases. Used by /proceed-advanced, or by /proceed when the user opts in."
- Append a short "Advanced agent" note to the prompt: trace integration points before touching shared code, prefer incremental verifiable steps, call out migration risks, "you run on the strongest model — use it."

**5. Confirm `/proceed-advanced` is installed** — Step 10 should have copied it as a NEW command skill (`.claude/skills/proceed-advanced/SKILL.md`). If it is missing, copy the folder now from `${CLAUDE_PLUGIN_ROOT}/templates/skills/proceed-advanced/`.

**6. Show what changed:**
```
🔧 v3 agent migration:
  Preset: <Preset> (every agent at <EFFORT> effort)
  ✅ solution-architect.md      → opus, effort=<EFFORT>
  ⏭️  feature-orchestrator.md    → opus, effort=xhigh (fixed, unchanged)
  ✅ frontend-dev.md            → sonnet, effort=<EFFORT>
  🆕 frontend-dev-advanced.md   → opus, effort=<EFFORT>
  ✅ backend-dev.md             → sonnet, effort=<EFFORT>
  🆕 backend-dev-advanced.md    → opus, effort=<EFFORT>
  🆕 /proceed-advanced command installed
```

### 10b2. Dev Agent Tool-Rules Suggestion

**When to run this step:** always, on every upgrade. This step finds a dev agent that still reads three whole feature files. It offers an edit. It never edits a dev agent without an answer from the user, because a dev agent is a file that the user owns.

**1. Search the harness agents directory for a dev agent whose Load Context step reads a whole `implementation.md` file, a whole `context.md` file, and a whole `tasks.md` file.**

**2. When the search finds one or more such agents, show this block, then ask the question below it:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 DEV AGENT TOOL-RULES SUGGESTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These dev agents still read three whole feature files:
  [one agent path per line]

I can change the Load Context step of each agent. The new
step reads the phase brief and the project instruction file.
I can also add a line that names .beast-mode/tool-rules.md.

This edit is optional. A decline leaves every agent as it is.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Question:** "Do I edit these dev agents?" **Header:** "Dev agents".
**Options** (option 1 is the default):
1. **"Not now (Recommended)"** — skip every agent, and ask again on the next upgrade.
2. **"Show me the agents"** — list every agent path, then ask the question again.
3. **"Edit each agent"** — apply the two changes of `agent-structure-example.md` to every named agent.

**3. For option 3, edit one dev agent at a time.** Read the agent file first. Change its Load Context step. Add the Tool rules line. Show the path of each file that this step changed.

Continue to Step 10b3 when this step finds no such agent, or when the user declines.

### 10b3. Agent Effort Preset Check

**When to run this step:** always, on every upgrade. **One exception:** skip this step when Step 10b ran in this same upgrade. Step 10b already asked the preset question and already wrote the values, so this step never asks a second question in one run.

This step reads the current values of the project, names the preset that they match, and offers a change. It edits no agent file before the answer. A dev agent is a file that the user owns.

**1. Read the current values.** Read the frontmatter of each agent file in `.claude/agents/`. Record the `name`, the `model`, and the `effort` of each one. An agent with no `effort` line holds a missing value.

**2. Group the agents by role:**

| Role | Match rule | Model of the role |
|------|------------|-------------------|
| Architect | `solution-architect`, and any planner or architect agent | `opus` |
| Advanced dev | a name that ends with `-advanced` | `opus` |
| Standard dev | a dev agent whose name does not end with `-advanced` | `sonnet` |
| Review | a code-review agent, a PR-review agent, or an evaluator agent | `opus` |
| Excluded | `feature-orchestrator` | fixed. Read it for the table only, and never change it |

**3. Name the current state.** Compare every grouped agent against the preset table:

  | Preset | solution-architect | Standard dev | Advanced dev | Review |
  |--------|--------------------|--------------|--------------|--------|
  | `Max` | `opus` @ `xhigh` | `sonnet` @ `xhigh` | `opus` @ `xhigh` | `opus` @ `xhigh` |
  | `High` (default, recommended) | `opus` @ `high` | `sonnet` @ `high` | `opus` @ `high` | `opus` @ `high` |
  | `Medium` | `opus` @ `medium` | `sonnet` @ `medium` | `opus` @ `medium` | `opus` @ `medium` |

- **A preset name** — every grouped agent matches one row of the table. Name that row: `High`, `Max`, or `Medium`.
- **The old policy** — every grouped agent runs on `opus`, each standard dev agent holds `medium`, and the architect, the advanced dev agents, and the review agents hold one higher value. Beast Mode v3 and v4 wrote these values. Name the state "the old policy", and name the two effort values that the project holds.
- **Custom** — the values match no row of the table and no old policy. Name the state "custom", and change no value before the answer.

**4. Show the current values.** Print one line for each agent, and name the state of Step 3:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENT EFFORT PRESET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current: High

  Agent                    Model   Effort
  ───────────────────────  ──────  ──────
  solution-architect       opus    high
  frontend-dev             sonnet  high
  frontend-dev-advanced    opus    high
  code-reviewer            opus    high
  feature-orchestrator     opus    xhigh   (fixed)

  Preset   Effort of every agent
  ───────  ────────────────────────────────────
  Max      xhigh    ← strongest results
  High     high     ← default, recommended
  Medium   medium   ← leanest token use
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The `Current:` line holds the preset name, or `the old policy (opus everywhere, dev at medium)`, or `custom`.

**5. Ask one question.** Use `AskUserQuestion`:

**Question:** "Which agent effort preset do I apply?" **Header:** "Effort preset".
**Options** (option 1 is the default):
1. **"High (Recommended)"** — "Every agent at high effort. A standard dev agent runs on sonnet. Every other agent runs on opus."
2. **"Max"** — "Every agent at xhigh effort. The strongest results, at the highest token cost."
3. **"Medium"** — "Every agent at medium effort. The leanest token use."
4. **"Keep the current values"** — "This step changes no file."

When Step 3 named a preset, add the text `(current)` to the front of the description of that preset. Add this text for no other option. A custom state and the old policy show no `(current)` text.

**6. Apply the answer.**

- **"Keep the current values":** change no file. Print `⏭️ Agent effort preset: no change.` and continue to Step 10c.
- **A preset:** edit the `model` line and the `effort` line of each grouped agent. Change no other line of the file, and keep the system prompt of each agent. Write the model of the role from the table of Step 2, and write the effort value of the chosen preset.
- Add the `effort` line below the `model` line when the `effort` line is missing.
- Skip an agent that already holds both correct values, and report it as up to date.
- **Never change `model` or `effort` in `feature-orchestrator.md`.** Both values are fixed.

**7. Show what changed:**

```
🔧 Agent effort preset: High (every agent at high effort)
  ✅ solution-architect.md      → opus, effort=high
  ✅ frontend-dev.md            → sonnet, effort=high
  ✅ frontend-dev-advanced.md   → opus, effort=high
  ✅ code-reviewer.md           → opus, effort=high
  ⏭️  feature-orchestrator.md    → opus, effort=xhigh (fixed, unchanged)
```

### 10c. Epic Migration Suggestion (v3.1+)

**When to run this step:** always, on every upgrade — this is a lightweight, non-destructive scan that fires a suggestion only when relevant grouped features are detected. It never modifies any files.

**Note:** Epics need no destructive migration script. `/create-epic`'s own preview/confirm flow IS the migration path — no script equivalent to `migrate-v1-to-v2.sh` is needed or provided for epics.

**1. Detect prefix-sharing feature groups:**

```bash
# List all dirs in docs/features/ that are NOT already epics
# (an epic has an epic-overview.md inside it)
for dir in docs/features/*/; do
  name=$(basename "$dir")
  if [ ! -f "$dir/epic-overview.md" ]; then
    echo "$name"
  fi
done
```

From the resulting list of plain (non-epic) feature names, find **prefix-sharing groups**: two or more feature names that share a common `<prefix>-` stem.

**Heuristic (apply exactly):**
- For each feature name, extract the **first hyphen-delimited segment** as its candidate prefix stem (e.g. `discord-bridge` → stem `discord`; `discord-message-queue` → stem `discord`; `web-app-auth` → stem `web-app` is not right — use only the *first* segment: stem `web`).
  - **Exception:** if the first segment is very short (≤3 characters, e.g. `ui`, `api`, `web`), use the first **two** hyphen-delimited segments as the stem instead (e.g. `web-app-auth` → `web-app`, `web-app-dashboard` → `web-app`).
- Group feature names by stem. A group is **actionable** when it has **≥ 2 members**.
- Skip any dir that already has `epic-overview.md` (it is already an epic).

**Practical bash snippet to list candidate groups:**

```bash
declare -A groups
for dir in docs/features/*/; do
  name=$(basename "$dir")
  # skip existing epics
  [ -f "$dir/epic-overview.md" ] && continue
  # derive stem: first segment; if ≤3 chars, use first two segments
  first=$(echo "$name" | cut -d'-' -f1)
  if [ ${#first} -le 3 ]; then
    stem=$(echo "$name" | cut -d'-' -f1-2)
  else
    stem="$first"
  fi
  groups["$stem"]+=" $name"
done
# print only groups with ≥2 members
for stem in "${!groups[@]}"; do
  count=$(echo ${groups[$stem]} | wc -w)
  if [ "$count" -ge 2 ]; then
    echo "  $stem: ${groups[$stem]}"
  fi
done
```

**2. If no prefix-sharing groups are found:** skip the rest of this step entirely. No prompt is shown — the upgrade continues silently to Step 11.

**3. For each detected group, suggest running `/create-epic`:**

For every actionable group (stem + member list), use **`AskUserQuestion`** to offer the suggestion. Present groups one at a time if there are multiple.

**Question text** (adapt stem/members to actual values):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 EPIC GROUPING SUGGESTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I noticed these features share the "<stem>" prefix:
  [list each member, one per line]

You could group them into a "<stem>" epic:
  /create-epic <stem> "<one-line description of what this group covers>"

What /create-epic does (IMPORTANT — it is safe):
  • Computes and PREVIEWS the full plan first (folder moves,
    un-prefixing, reference rewrites, overview migration)
  • Modifies NOTHING until you explicitly confirm
  • Declining the preview leaves everything exactly as-is

This is OPTIONAL and RECOMMENDED for large projects, but
your current flat workflow continues working unchanged whether
you do this now, later, or never.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**`AskUserQuestion` options** (default: option 1 — the non-destructive choice):

```
• Remind me later   — (DEFAULT) skip for now; ask again on the next upgrade
• Show me how       — print the exact /create-epic command to run manually
• Never suggest     — don't prompt about this group again
```

**Important:** Do **NOT** run `/create-epic` automatically under any circumstance. The only thing this step does is inform the user and offer the suggestion. Applying the migration is always 100% the user's choice, and `/create-epic` will re-confirm with its own detailed preview/confirm before changing anything.

**If "Remind me later":** continue to Step 11. The suggestion will appear again next time `/upgrade-beast-mode` is run (no state is written).

**If "Show me how":** display the exact command to run:
```
To group these features into an epic, run:
  /create-epic <stem> "<description>"

/create-epic will show you a full preview of all changes
before touching anything. You can cancel at any time.
```
Then continue to Step 11.

**If "Never suggest":** continue to Step 11. (Since no persistent state is written by this command, this behaves identically to "Remind me later" in practice — note this if the user asks.)

### 11. Update Version File

The installer CLI wrote `.claude/.beast-mode-version` in Step 10. Its summary line reads:

```
  ✓ Version file (v5.4.0)
```

Confirm the file holds the plugin version of Step 3. Write the file by hand only when the CLI summary shows no version line.

### 12. Update .gitignore if Needed

The installer CLI writes the v5 `.gitignore` block in Step 10. It creates `.gitignore` when the project has none. It owns two lines: the backup directory of this harness, and `.beast-mode/briefs/`. It tests each line on its own, and it appends only a line that the file does not hold, under the `# Beast Mode - Backups` header. A project of an earlier version therefore gains the briefs line here, and a second run appends nothing. Its output holds one of these two lines:

```
✓ Added Beast Mode entries to .gitignore
ℹ Beast Mode entries already in .gitignore
```

**For a v1 to v2 upgrade the old `/dev` entries still need a pass.** Remove them:
```bash
sed -i '/dev\/active\//d' .gitignore
sed -i '/dev\/completed\//d' .gitignore
```

### 13. Check for Mission Statement & Technical Design

Check if `docs/mission-statement.md` and `docs/technical-design.md` exist.

**If either file is missing:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 PROJECT DOCS CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Beast Mode now creates foundational project
docs during installation. Your project is
missing:

  [List missing files]

These give Claude deep context about your
project's mission, audience, and technical
architecture.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use `AskUserQuestion`: "Would you like me to create the missing project docs now?"
- Options: "Yes, create them" / "No, skip for now"

**If yes:**

Follow the same process as Step 5 in `/install-beast-mode`:

1. Read templates from:
   - `${CLAUDE_PLUGIN_ROOT}/templates/formats/mission-statement-template.md`
   - `${CLAUDE_PLUGIN_ROOT}/templates/formats/technical-design-template.md`

2. **Gather information automatically:**
   - Read `README.md` or any existing documentation
   - Read `CLAUDE.md` if it exists
   - Scan `package.json`, `pyproject.toml`, or equivalent for project metadata
   - Explore the source tree structure
   - Read key source files to understand architecture and patterns
   - Check git log for project history

3. **Identify gaps** and ask the user focused questions for anything not derivable from the code.

4. **Generate the missing documents:**
   - Write `docs/mission-statement.md` if missing
   - Write `docs/technical-design.md` if missing
   - Follow the template structure but adapt to the project
   - These must feel project-specific, not boilerplate

5. Show a brief summary and ask the user to review.

**If no or both files exist:** Continue to step 14.

### 14. Show Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ UPGRADE COMPLETE!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Upgraded: v[old] → v[new]

📊 Changes Applied (the counts from the installer CLI summary):
  🆕 Added: [X]
  ✅ Updated: [Y]
  ⏭️  Skipped (you edited them): [Z]
  🗑️  Pruned: [P]

📦 Backup location:
  .claude/.beast-mode-backup-[timestamp]/
  (omit this line when the CLI reported "Backup: none needed")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 New Features Available:
  [List new slash commands or major features from changelog]

**For v6.2 upgrade, add:**

🚀 NEW - Orca orchestration:
  • /orca-setup chooses the agent for each stage and adds custom steps.
    It writes the orchestration object into .beast-mode/orca.json.
  • /orca-feature <name> builds one feature with Orca agent tabs.
    /orca-epic <name> builds every feature of an epic the same way.
  • beast-mode orca is the step script of these commands. Run
    "beast-mode orca detect" to see the state of the Orca CLI and
    the settings file.
  • No project needs an upgrade step. The upgrade adds the three
    command skills. A project with no Orca CLI sees no change.

**For v6.0 upgrade, add:**

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
  • The glossary has a new term: "send a message to an agent". It maps
    to the real tool of your harness.
  • /review-session is the 27th command skill. It reads the log of one
    session and proposes a pointer, a check, or a rule line.
  • beast-mode transcript prints the numbered steps of one session.
    /review-session writes them to
    .beast-mode/briefs/review-session/<session-id>.txt.
  • No project needs an upgrade step. The upgrade adds the new files.
    It skips a file you edited, so a project that edited plan-feature
    keeps the old interview.

**For v5.1 upgrade, add:**

🚀 NEW - The installer CLI and the install manifest:
  • Beast Mode installs and upgrades through a Node.js CLI now:
      installer/bin/beast-mode.js
    A Claude Code install needs Node.js 20 or later.
  • .claude/.beast-mode-manifest.json records every file Beast Mode
    wrote and its hash. The upgrade updates a file Beast Mode owns,
    and it skips a file you edited. No file category is "customized"
    by default any more.
  • The upgrade prunes a file that the plugin stopped shipping, but
    only when your copy still matches the hash. It backs the file up
    before it deletes it, and it keeps a file you edited.
  • Every replaced file lands in
      .claude/.beast-mode-backup-<timestamp>/
    Run the upgrade again with --force to take the plugin version of
    a skipped file. A backup runs first.

**For v5.0 upgrade, add:**

🚀 MAJOR CHANGE - Harness-neutral layout:
  • Every command now ships as a skill:
      .claude/skills/<name>/SKILL.md
    Layout v4 kept the same commands in .claude/commands/.
    Those files are gone, and the backup holds them.
  • The shared Beast Mode files moved to .beast-mode/:
      epic-resolution.md and the 7 other format references
      templates/    the feature doc templates
      harness.md    the tool glossary of this harness
  • Commit .beast-mode/ with the project. Every harness reads it,
    the same way .claude/commands/ was committed before.
  • Your own command files and your own skills stayed as they were.
  • Backup of the layout v4 files:
      .claude/.beast-mode-backup-[timestamp]/
  • Command names, arguments, and docs/features/ output do not
    change. The migration ran with no manual step.

**For v3.1 upgrade, add:**

🚀 EPICS — Group Related Features:
  • /create-epic <name> <prompt>  — migrate existing prefixed features into
    an epic folder (move + un-prefix + rewrite references); mandatory
    preview/confirm before any change
  • /suggest-epic                 — suggest the next epic to build
  • /plan-epic <name> [prompt]    — plan a new epic from scratch; creates
    epic-overview.md, epic-requirements.md, and ordered feature subfolders
    each with a requirements.md ready for /plan-feature
  • /update-epic [name]           — refresh the epic's epic-overview.md
    (Features table, build order, integration notes) and the epic's single
    rollup row in docs/overview.md
  • /review-epic <name>           — holistic cross-feature review: integration
    gaps, architecture risks, per-feature tech debt; writes findings into
    epic-overview.md and affected child context.md files

  All existing commands are epic-aware: /continue-feature, /plan-feature,
  /start-feature, /proceed, /update-master, and all /review-* commands
  handle <epic>/<feature> references and operate across an epic when given
  an epic name. With no epics in a project, every command behaves exactly
  as in v3.0 — zero regressions.

**For v3.0 upgrade, add:**

🚀 MAJOR CHANGE - Agent Effort Tuning:
  • Agents now carry model + effort. One preset value sets the
    effort of every agent. The role sets the model: a standard
    dev agent runs on sonnet, and every other agent runs on opus
  • NEW advanced dev agents (frontend-dev-advanced, etc.) created
    for major refactors and high-risk phases
  • /proceed now asks before using an advanced agent on heavy phases
  • NEW /proceed-advanced — forces advanced agents, one phase at a time
  • /plan-feature, /suggest-feature & solution-architect can use
    /deep-research (optional, always asks first) for external research
  • New review commands from contributors: /review-ui (live browser
    audit), enhanced /review-ux, three-way boundary tables

  Every upgrade names the current preset and offers a change
  (Step 10b3). Run /upgrade-beast-mode again to change it.

**For v2.0 upgrade, add:**

🚀 MAJOR CHANGE - Simplified Workflow:
  • All features now in docs/features/ (no more /dev folder!)
  • Use /update-feature instead of /dev-docs-update
  • Same workflow works in Claude Code and Cursor
  • /dev folder migrated and backed up

Try the updated commands:
  /plan-feature <name> - Plan new features
  /start-feature <name> - Start implementation
  /update-feature <name> - Update docs before compacting
  /update-skills <name> - Document patterns in skills

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  IMPORTANT:
Every file you edited was preserved. The CLI listed each one
under "Skipped files".

**If the project still has hooks from an older version, add:**
  • Hooks are no longer part of Beast Mode — your .claude/hooks/ and
    .claude/skills/skill-rules.json were left untouched. Remove them
    yourself if you no longer want them.

**For v2.0 migration:**
  • Old /dev folder backed up and deleted
  • All features migrated to docs/features/
  • Verify migration: ls -la docs/features/

Review the backup if you need to merge changes manually.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 14b. Offer Orca Setup

Run this step after the completion summary. It checks for the Orca CLI.

1. Run the detect step with `Bash`:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/installer/bin/beast-mode.js orca detect
   ```
   It prints one JSON object. Read the `offer` key.

2. **If `"offer"` is `"none"`:** show nothing and go to Step 15. The Orca CLI is absent, or `orca.json` already holds a valid `orchestration` object.

3. **If `"offer"` is `"setup"`:** use `AskUserQuestion`: "The Orca CLI is installed. Set up Orca orchestration now?"
   - Options: "Set it up now (recommended)" / "Later"

4. **If now:**
   - **IMPORTANT:** Do NOT use the Skill tool to run `/orca-setup`. A command skill that the upgrade just added is not visible until Claude restarts. Read the skill directly from the plugin:
     ```
     Read file: ${CLAUDE_PLUGIN_ROOT}/templates/skills/orca-setup/SKILL.md
     ```
   - Follow the instructions in that template inline.

5. **If later:** tell the user they can run `/orca-setup` after Claude Code restarts (e.g. `claude -c`).

### 15. Post-Upgrade Checks

Optionally offer to:
1. Verify slash commands are registered
2. Check feature docs structure is intact (docs/features/)
3. **For v2.0:** Verify /dev folder deleted and features migrated
4. **For v5.0:** Verify `.claude/commands/` holds no Beast Mode command file, and verify `.beast-mode/epic-resolution.md` and `.beast-mode/harness.md` exist
5. **For v5.1:** Verify `.claude/.beast-mode-manifest.json` exists and parses as JSON. The next upgrade reads it to tell a Beast Mode file from a file you edited
6. **For v5.1:** Check for `.beast-mode/templates/README.md` and `.beast-mode/templates/plan.md`. A project installed before 5.1.0 keeps these two stale files. The CLI cannot prove Beast Mode wrote them, so it never deletes them. Offer to delete them by hand
7. **For v5.4:** Verify `.beast-mode/version.json` exists and lists every installed harness with its root and its version

## Important Notes

- **DO** create backups before making changes
- **DO** show clear diff/changelog information
- **DO** wait for user confirmation before applying changes
- **DO** preserve user's custom skills and agents
- **DO** only update Beast Mode system files (templates, commands, etc.)
- **DO NOT** touch any `.claude/hooks/` or `.claude/skills/skill-rules.json` left over from an older version — hooks are no longer part of Beast Mode; leave those files for the user to remove

## File Detection Logic

The installer CLI owns this decision. It reads three hashes for every file: the hash the manifest records, the hash of the file on disk, and the hash of the file the plugin ships now. Do not compare files yourself, and do not treat a whole category as customized.

Four outcomes reach the user:

1. **Up to date.** Your copy matches the plugin copy. The CLI changes nothing and stays quiet.
2. **Updated.** Beast Mode owns the file and the plugin changed it. The CLI backs the old copy up, then writes the new one. It reports `✅ Updated`.
3. **Skipped.** You edited the file. The CLI changes nothing and reports `⏭️ Skipped (you edited it)`. The run still exits 0. Only `--force` overwrites it, and that pass backs your copy up first.
4. **Pruned or kept.** The plugin stopped shipping the file. The CLI backs it up and deletes it when your copy still matches the manifest hash, and reports `🗑️ Pruned`. It keeps the file and reports `⚠ Kept (you edited it)` when the hashes differ.

A project with no manifest takes one extra path on its first upgrade. Ownership is unknown there, so an equal file is adopted, a missing file is added, and every file that differs is skipped and reported. That run writes the manifest, and every later upgrade uses the four outcomes above.

**Conservative approach:** the CLI skips whenever it cannot prove ownership, and it reports every skip.

## Edge Cases

### Case 1: Very Old Version (pre-1.0)
If no version file exists, treat as 1.0.0 and upgrade from there.

### Case 2: User Modified a Command Skill
The CLI answers this case on its own. It skips the file, reports it under
`⏭️ Skipped files`, and exits 0. Show the skip list, offer the `--force` pass of Step 10,
and recommend that the user move the customization into a skill of their own name.

### Case 3: Broken Installation
If Beast Mode files are partially missing:
- Offer to repair installation
- Run upgrade to restore missing files

### Case 4: Future Versions Require Migration
If changelog indicates breaking changes or migration needed:
- Show special migration instructions
- Offer to run migration steps
- Warn about compatibility issues

## Error Handling

- If plugin CHANGELOG.md not found, warn but continue (assume safe to update files)
- If `node` is missing, stop and point the user at https://nodejs.org (see Step 5)
- If the installer CLI exits non-zero, show its three lines (what failed, why, what to do next) and stop the upgrade
- If the version file can't be written, warn but don't fail

## Rollback Support

The installer CLI writes every backup to `.claude/.beast-mode-backup-<YYYYMMDD-HHMMSS>/`, and it keeps the project layout inside that directory. `.beast-mode/epic-resolution.md` therefore backs up to `.claude/.beast-mode-backup-<timestamp>/.beast-mode/epic-resolution.md`.

If user wants to rollback after upgrade:
```
To rollback:
1. Find the newest .claude/.beast-mode-backup-<timestamp>/ directory
2. Copy each file back to the same path under the project root. The
   backup mirrors the project, so
     <backup>/.claude/skills/plan-feature/SKILL.md
   restores to
     .claude/skills/plan-feature/SKILL.md
3. A layout v4 backup from Step 8b has a different shape: it holds
   commands/ and templates/ at its root. Restore both directories
   under .claude/, and move the format references back to .claude/
4. Delete .beast-mode/ when you restore a layout v4 backup
5. Delete .claude/.beast-mode-manifest.json and
   .claude/.beast-mode-version. The manifest describes the version
   you removed, so leaving it makes the next upgrade skip files
```

## Integration with Dev Docs

Reference the `claude-code/plugin` feature dev docs:
- Context from: `docs/features/claude-code/plugin/context.md`
- Tasks from: `docs/features/claude-code/plugin/tasks.md`
- Changelog: `${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md`

This ensures upgrade process benefits from the development history and decisions documented in this project.

---

**Remember:** This command manages the Beast Mode system files only. User's custom skills, agents, and feature documentation remain untouched — as do any hook files left over from an older version (hooks are no longer part of Beast Mode).
