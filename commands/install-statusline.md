---
description: Install the Beast Mode statusline into the user's Claude Code settings. Adds a custom status bar showing folder + git status on line 1 and context/rate-limit progress bars on line 2. Usage: /install-statusline
---

You are installing the **Beast Mode statusline** into the user's Claude Code settings (`~/.claude/settings.json`).

The statusline displays:

- **Line 1** — `📁 folder 🌿 branch +staged ~modified ?untracked` (cached for 5s)
- **Line 2** — `🧠 context-bar  ⏳ 5h-bar reset-in  📅 7d-bar reset-in`

Bar colors are threshold-driven (green <70%, yellow 70–89%, red 90%+).

The statusline script lives at `${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh`. This command writes its absolute path into the user's settings.

---

## Process

### Step 1: Verify Prerequisites

The script depends on `jq`. Check that it's installed:

```bash
command -v jq >/dev/null && echo "ok" || echo "missing"
```

If missing, tell the user how to install it (`apt install jq` / `brew install jq`) and stop.

### Step 2: Resolve Absolute Script Path

`${CLAUDE_PLUGIN_ROOT}` is set in this slash command's environment, but **not** when Claude Code later spawns the statusline. Resolve to an absolute path now:

```bash
realpath "${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh"
```

Store the result as `SCRIPT_PATH`. Also confirm it's executable:

```bash
test -x "$SCRIPT_PATH" && echo "ok" || echo "not-executable"
```

If not executable, run `chmod +x "$SCRIPT_PATH"`.

### Step 3: Check Existing Settings

Read `~/.claude/settings.json`:

```bash
cat ~/.claude/settings.json 2>/dev/null
```

Three cases:

1. **File missing** — create a new minimal settings.json in Step 4.
2. **File exists, no `statusLine` field** — merge the new field in.
3. **File exists with `statusLine` already set** — show the current value and ask via `AskUserQuestion`:

   - Question: "A statusLine is already configured. Replace it with the Beast Mode statusline?"
   - Options: "Replace it" / "Keep existing"

   If the user keeps the existing one, stop.

### Step 4: Write Settings

Use `jq` to merge the new block in without disturbing other fields. This is safer than hand-editing JSON.

**If the settings file exists:**

```bash
tmp=$(mktemp)
jq --arg cmd "$SCRIPT_PATH" \
   '.statusLine = {type: "command", command: $cmd, padding: 2}' \
   ~/.claude/settings.json > "$tmp" && mv "$tmp" ~/.claude/settings.json
```

**If the settings file is missing:**

```bash
jq -n --arg cmd "$SCRIPT_PATH" \
   '{statusLine: {type: "command", command: $cmd, padding: 2}}' \
   > ~/.claude/settings.json
```

After writing, verify it's still valid JSON:

```bash
jq . ~/.claude/settings.json >/dev/null && echo "ok" || echo "invalid"
```

If invalid, restore from a backup (always make `~/.claude/settings.json.bak` before the merge).

### Step 5: Smoke Test the Script

Run the script once with no stdin so it falls back to the bundled test JSON. This confirms it produces output before Claude Code calls it for real:

```bash
"$SCRIPT_PATH"
```

Expect two lines of output. If the script errors, surface the error and tell the user to check `jq` is installed and the script path is readable.

### Step 6: Summary

Display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BEAST MODE STATUSLINE INSTALLED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Settings updated: ~/.claude/settings.json
Script path:     <SCRIPT_PATH>

Settings reload automatically — the statusline
will appear at the bottom of the interface on
your next message.

To remove later: delete the "statusLine" block
from ~/.claude/settings.json, or run
/statusline delete.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Important Notes

- **Always back up** `~/.claude/settings.json` to `~/.claude/settings.json.bak` before modifying it. Restore from the backup if `jq` validation fails after the merge.
- **Do not expand `${CLAUDE_PLUGIN_ROOT}` literally** into settings.json — that env var isn't set when Claude Code spawns the statusline command. Always write the resolved absolute path.
- **Do not edit settings.json by string substitution.** Use `jq` so other fields (`permissions`, `enabledPlugins`, `hooks`, etc.) are preserved exactly.
- The statusline only runs after the user accepts the workspace trust dialog. If they see `statusline skipped · restart to fix`, they need to restart Claude Code and accept the prompt.
