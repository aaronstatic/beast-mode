---
description: Upgrade Beast Mode installation in this project with latest templates, commands, and improvements from the plugin. Usage: /upgrade-beast-mode
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

Check for Beast Mode presence:
- `.claude/commands/start-feature.md` exists
- `.claude/templates/` directory exists
- `docs/features/` directory exists

If not found:
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

Compare project files with plugin templates to determine what needs updating:

**Check these components:**

1. **Slash Commands** (`.claude/commands/`)
   - Dynamically enumerate all `.md` files in `${CLAUDE_PLUGIN_ROOT}/templates/slash-commands/`
   - Compare each against the project's `.claude/commands/` directory

2. **Agent Templates** (`.claude/agents/`)
   - Dynamically enumerate all `.md` files in `${CLAUDE_PLUGIN_ROOT}/templates/agents/`
   - Compare each against the project's `.claude/agents/` directory
   - **NOTE:** Agents are often customized per-project. Treat any agent that exists and differs as CUSTOMIZED by default.

3. **Dev Doc Templates** (`.claude/templates/`)
   - Dynamically enumerate all `.md` files in `${CLAUDE_PLUGIN_ROOT}/templates/dev-docs/`
   - Compare each against the project's `.claude/templates/` directory

4. **Format References** (`.claude/`)
   - Dynamically enumerate all files in `${CLAUDE_PLUGIN_ROOT}/templates/formats/`
   - Compare each against the project's `.claude/` directory

For each category, list all files found in the plugin templates — do NOT use a hardcoded list.

**Hooks are no longer part of Beast Mode.** Earlier versions installed three hooks
(`skill-reminder`, `edit-tracker`, `build-check`) and a `skill-rules.json`. These have
been removed from the plugin — there are no hook templates to enumerate, and the upgrade
does **not** touch any hook files already present in the project. If `.claude/hooks/` or
`.claude/skills/skill-rules.json` exist from a previous install, leave them exactly as
they are (do not update, do not delete). See the note in Step 6.

**For each file:**
- If doesn't exist in project: Mark as "NEW"
- If exists: Compare with plugin version
  - If identical: Mark as "UP TO DATE"
  - If different: Mark as "UPDATE AVAILABLE"
  - If project version is modified: Mark as "CUSTOMIZED"

### 6. Show Update Plan

Display what will be updated:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 UPDATE PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Slash Commands:
  [List each .md file found in plugin templates/slash-commands/ with status]

🤖 Agent Templates:
  [List each .md file found in plugin templates/agents/ with status]

📝 Dev Doc Templates:
  [List each .md file found in plugin templates/dev-docs/ with status]

📚 Format References:
  [List each file found in plugin templates/formats/ with status]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  CUSTOMIZED FILES:
Any agent or other file with local modifications will NOT be overwritten.
You can manually merge changes if needed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
- For each file marked "UPDATE AVAILABLE":
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
- Continue to step 9 (Create Backup of templates)

**If migration script fails:**
- Show error
- Stop upgrade process
- Provide recovery instructions

**If NOT v1 → v2 migration:**
- Skip to step 9 directly

### 9. Create Backup

Create backup of files that will be updated:

```bash
mkdir -p .claude/.beast-mode-backup-[timestamp]
```

Copy existing files to backup:
```bash
cp .claude/commands/start-feature.md .claude/.beast-mode-backup-[timestamp]/
# ... etc for all files being updated
```

Show:
```
📦 Backup created: .claude/.beast-mode-backup-[timestamp]/
```

### 10. Update Files

For each file marked for update or new:

**If NEW file:**
- Copy from plugin: `cp ${CLAUDE_PLUGIN_ROOT}/templates/... .claude/...`
- Show: `🆕 Added: [filename]`

**If UPDATE AVAILABLE:**
- Copy from plugin (overwrite): `cp ${CLAUDE_PLUGIN_ROOT}/templates/... .claude/...`
- Show: `✅ Updated: [filename]`

**If CUSTOMIZED:**
- Skip (do not overwrite)
- Show: `⏭️  Skipped: [filename] (customized)`

### 10b. v2 → v3 Migration: Effort System & Advanced Agents

**When to run this step:** if the upgrade crosses into v3 (current version starts with `1.` or `2.` and new version starts with `3.`) **OR** the project's existing agents have no `effort:` field in their frontmatter. Otherwise skip to Step 11.

This is a **major upgrade**. v3 introduces per-agent `model`/`effort` tuning and a second "advanced" tier of dev agents. The normal file-sync in Step 10 does **not** touch existing agents (they're treated as CUSTOMIZED), so migrate them here by editing frontmatter in place — **preserving each agent's custom system prompt.**

**1. Show the v3 notice:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  MAJOR VERSION UPGRADE: v2 → v3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Beast Mode v3 adds agent effort tuning:
  • solution-architect → opus, at your MAX effort
  • advanced dev agents (NEW) → opus, at your MAX effort
  • review & evaluation agents → opus, at your MAX effort
  • standard dev agents → sonnet, a couple steps lower

I'll ask you to pick effort levels, then:
  • add effort fields to your existing agents
  • create matching *-advanced agents
  • install the new /proceed-advanced command

Your custom agent prompts are preserved — only the
frontmatter (model/effort) changes.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**2. Ask for effort levels** — identical to Step 4b of `/install-beast-mode`:
- Ask for the **MAX** effort level (4 options only — `AskUserQuestion` max is 4: `ultracode` *(recommended)*, `max`, `xhigh`, `high`; `medium`/`low` via the auto-provided "Other"). This applies to solution-architect, advanced dev agents, and reviewers.
- Derive the **DEV** default as **2 steps below MAX** on the ladder `low → medium → high → xhigh → max → ultracode` (clamped to `low`, never `ultracode`):

  | MAX | DEV default |
  |-----|-------------|
  | `ultracode` | `xhigh` |
  | `max` | `high` |
  | `xhigh` | `medium` |
  | `high` | `low` |
  | `medium` | `low` |
  | `low` | `low` |

  Confirm or let the user override DEV (sonnet-valid levels only).

**3. Migrate existing agents** in `.claude/agents/`:

- **solution-architect** (and any planner/architect agent): set `model: opus` and `effort: <MAX>` in the frontmatter. (Leave the system prompt as-is. Note in the summary that the v3 template also adds optional `/deep-research` guidance they can pull in manually if wanted.)
- **Each standard dev agent** (e.g. `frontend-dev`, `backend-dev`, `ml-dev`, `dev`, `game-dev`, and any project-specific dev agents that are NOT already `*-advanced`): ensure `model: sonnet` and set/add `effort: <DEV>`. Add the `effort:` line to the frontmatter if it's missing; otherwise update it.
- **Any code-review / PR-review / evaluator agent** the project has: set `model: opus` and `effort: <MAX>`.

**4. Create advanced agents** — for each standard dev agent found, create a `<name>-advanced.md` if it doesn't already exist:
- Copy the standard agent's system prompt verbatim.
- Frontmatter: `name: <name>-advanced`, `model: opus`, `effort: <MAX>`, keep the same `color` and `tools`, and update the `description` to "Heavyweight … for major refactors, integration-heavy, or high-risk phases. Used by /proceed-advanced, or by /proceed when the user opts in."
- Append a short "Advanced agent" note to the prompt: trace integration points before touching shared code, prefer incremental verifiable steps, call out migration risks, "you run at maximum effort — use it."

**5. Confirm `/proceed-advanced` is installed** — Step 10 should have copied it as a NEW command (`.claude/commands/proceed-advanced.md`). If it's missing, copy it now from `${CLAUDE_PLUGIN_ROOT}/templates/slash-commands/proceed-advanced.md`.

**6. Show what changed:**
```
🔧 v3 agent migration:
  Effort: MAX=<MAX>, standard dev=<DEV>
  ✅ solution-architect.md      → opus, effort=<MAX>
  ✅ frontend-dev.md            → sonnet, effort=<DEV>
  🆕 frontend-dev-advanced.md   → opus, effort=<MAX>
  ✅ backend-dev.md             → sonnet, effort=<DEV>
  🆕 backend-dev-advanced.md    → opus, effort=<MAX>
  🆕 /proceed-advanced command installed
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

Create or update `.claude/.beast-mode-version`:
```
[new version number]
```

### 12. Update .gitignore if Needed

Check if `.gitignore` needs new entries from recent versions.

**For v2.0 upgrade:**
- Remove old `/dev` entries (dev/active/, dev/completed/)
- Add new backup entries (.claude/.beast-mode-backup-*/)

If upgrading to v2.0, update .gitignore:
```bash
# Remove old entries
sed -i '/dev\/active\//d' .gitignore
sed -i '/dev\/completed\//d' .gitignore

# Add new entries if not present
if ! grep -q ".beast-mode-backup" .gitignore; then
    echo "" >> .gitignore
    echo "# Beast Mode - Backups" >> .gitignore
    echo ".claude/.beast-mode-backup-*/" >> .gitignore
fi
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

📊 Changes Applied:
  🆕 New files: [X]
  ✅ Updated files: [Y]
  ⏭️  Skipped (customized): [Z]

📦 Backup location:
  .claude/.beast-mode-backup-[timestamp]/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 New Features Available:
  [List new slash commands or major features from changelog]

**For v3.1 upgrade, add:**

🚀 EPICS — Group Related Features:
  • /create-epic <name> <prompt>  — migrate existing prefixed features into
    an epic folder (move + un-prefix + rewrite references); mandatory
    preview/confirm before any change
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
  • Agents now carry model + effort: solution-architect, advanced
    dev agents, and reviewers run on opus at your MAX effort;
    standard dev agents run on sonnet a couple steps lower
  • NEW advanced dev agents (frontend-dev-advanced, etc.) created
    for major refactors and high-risk phases
  • /proceed now asks before using an advanced agent on heavy phases
  • NEW /proceed-advanced — forces advanced agents, one phase at a time
  • /plan-feature, /suggest-feature & solution-architect can use
    /deep-research (optional, always asks first) for external research
  • New review commands from contributors: /review-ui (live browser
    audit), enhanced /review-ux, three-way boundary tables

  Re-run effort setup any time by running /upgrade-beast-mode again.

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
Customized files (agents, etc.) were preserved.

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

### 15. Post-Upgrade Checks

Optionally offer to:
1. Verify slash commands are registered
2. Check feature docs structure is intact (docs/features/)
3. **For v2.0:** Verify /dev folder deleted and features migrated

## Important Notes

- **DO** create backups before making changes
- **DO** show clear diff/changelog information
- **DO** wait for user confirmation before applying changes
- **DO** preserve user's custom skills and agents
- **DO** only update Beast Mode system files (templates, commands, etc.)
- **DO NOT** touch any `.claude/hooks/` or `.claude/skills/skill-rules.json` left over from an older version — hooks are no longer part of Beast Mode; leave those files for the user to remove

## File Detection Logic

**How to detect if file is CUSTOMIZED:**

1. **Agent templates:** If file exists and differs, treat as CUSTOMIZED (agents are often project-specific). Only install NEW agents that don't exist yet.
2. **Dev docs templates:** Generally safe to update (rarely customized)
3. **Slash commands:** Safe to update (system files)
4. **Format references:** Safe to update (reference files)

**Conservative approach:** When in doubt, mark as CUSTOMIZED and skip.

## Edge Cases

### Case 1: Very Old Version (pre-1.0)
If no version file exists, treat as 1.0.0 and upgrade from there.

### Case 2: User Modified Slash Command
If user has customized a slash command:
- Warn them
- Create backup
- Offer to skip or overwrite
- Recommend they migrate customizations to custom commands

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
- If backup fails, stop and show error
- If file copy fails, show error but continue with other files
- If version file can't be written, warn but don't fail

## Rollback Support

If user wants to rollback after upgrade:
```
To rollback:
1. Copy files from: .claude/.beast-mode-backup-[timestamp]/
2. Restore to: .claude/commands/, dev/templates/, etc.
3. Delete .claude/.beast-mode-version
```

## Integration with Dev Docs

Reference the `claude-code-plugin` feature dev docs:
- Context from: `dev/active/claude-code-plugin/context.md`
- Tasks from: `dev/active/claude-code-plugin/tasks.md`
- Changelog: `${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md`

This ensures upgrade process benefits from the development history and decisions documented in this project.

---

**Remember:** This command manages the Beast Mode system files only. User's custom skills, agents, and feature documentation remain untouched — as do any hook files left over from an older version (hooks are no longer part of Beast Mode).
