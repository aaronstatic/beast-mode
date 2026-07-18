---
description: "Stand up the @beast-mode/web standalone dashboard for all your Beast Mode projects, running always-on in the background via your OS's service manager. Usage: /setup-web-app"
---

You are setting up the **Beast Mode standalone web dashboard** — a lightweight server that shows every Beast Mode project on this machine (features, bugs, git status, epics) from one URL, with no Discord bridge required.

When complete, the user will have a background service that starts on login, survives reboots, and serves the dashboard at `http://<host>:<port>`.

---

## Setup Process

Work through each step in order. Ask the user for information as needed. If a step fails, explain what went wrong and how to fix it before continuing.

---

### Step 1: Welcome & Overview

Display this welcome message:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEAST MODE WEB APP SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This will:
  - Find every Beast Mode project on this machine
  - Write a .env for the standalone @beast-mode/web server
  - Install an always-on background service (your OS's
    native daemon mechanism) so the dashboard is available
    any time this machine is on
  - Start it and give you the dashboard URL

Binds to localhost by default. If you want it reachable
from other machines, you'll need a token — more on that
in Step 5.

Let's get started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Step 2: Verify the Package Is Built

The standalone server ships as part of the Beast Mode plugin at `${CLAUDE_PLUGIN_ROOT}/web`. Check that it's built:

```bash
ls ${CLAUDE_PLUGIN_ROOT}/web/dist/bin/beast-web.js
```

**If missing**, build it first:
```bash
cd ${CLAUDE_PLUGIN_ROOT}/web && bun run build
```

If the build fails, show the error and stop — nothing below will work without `dist/bin/beast-web.js`.

Also confirm a Node runtime is available (the daemon runs the compiled server under Node by default):
```bash
which node
```
If `node` is not found, tell the user Node 20+ is required and stop.

---

### Step 3: Discover Beast Mode Projects

Scan common code roots for Beast Mode installations (identified by `.claude/.beast-mode-version`):

```bash
for root in "$HOME" "$HOME/code" "$HOME/projects" "$HOME/dev" "$HOME/Developer" "$HOME/repos" "$HOME/work" "$HOME/src" "$HOME/git" "$PWD"; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 5 -type f -path "*/.claude/.beast-mode-version" -not -path "*/node_modules/*" 2>/dev/null
done | sort -u
```

For each hit, the project path is the directory two levels up from `.beast-mode-version` (strip `/.claude/.beast-mode-version`), and the project name defaults to that directory's basename.

Also check for projects already registered with the Discord bridge, which carries its own name → path registry:

```bash
cat ~/.config/beast-mode-discord/projects.json 2>/dev/null
```

If present, parse it (a JSON object keyed by project name, each with at least a `path`) and add every `{name, path}` pair to the candidate list.

**Merge both sources, de-duplicating by resolved absolute path** (prefer the Discord-bridge name if a path appears in both lists — it's the name the user already knows this project by).

**If the merged list is empty**, use `AskUserQuestion`:
- **Question:** "I couldn't find any Beast Mode projects automatically. Where should I look?"
- **Header:** "Search path"
- **Options:** offer a couple of sensible guesses if any partial signal exists (e.g. current directory), plus rely on the auto-provided "Other" for the user to type an absolute path.

Re-run the same `find` scan rooted at the path the user gives, then continue. If still nothing is found, ask again or offer to let the user type `name:path` pairs directly.

---

### Step 4: Confirm the Discovered Set

Show what was found:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECTS FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [name-1]  →  [/absolute/path/one]
  [name-2]  →  [/absolute/path/two]
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use `AskUserQuestion`:
- **Question:** "Use this project list for the dashboard?"
- **Header:** "Confirm projects"
- **Options:**
  1. "Yes, use these" — proceed as-is
  2. "Let me edit the list" — ask which to remove and/or collect additional `name:path` pairs to add

Keep asking follow-ups until the user is happy with the final list. **Every path must exist and be a directory** — validate with the Bash tool (`test -d "<path>"`) and drop or re-ask about any that don't.

---

### Step 5: Port, Host & Token

Ask the user (plain questions are fine, or `AskUserQuestion` where there's a clear default):

1. **Port** — default `4319`. Accept the default unless the user wants a different one.
2. **Bind beyond localhost?** Use `AskUserQuestion`:
   - **Question:** "Bind to localhost only, or make the dashboard reachable from other machines on the network?"
   - **Header:** "Network exposure"
   - **Options:**
     1. "Localhost only (recommended)" — `BEAST_HOST=127.0.0.1`, no token needed
     2. "Expose on the network" — `BEAST_HOST=0.0.0.0`, **requires** a `BEAST_TOKEN`

**If the user chooses to expose beyond localhost:**
```
⚠️  BEAST_TOKEN is REQUIRED once you bind beyond localhost — the
dashboard has no other authentication. Anyone who can reach the
port can read and modify your projects' docs, bugs, and git state.
```
Generate a token:
```bash
openssl rand -hex 32
```
(Fallback if `openssl` is unavailable: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.)

Tell the user the generated token and that they'll need it (`Authorization: Bearer <token>`) to call the API from anywhere. If they'd rather supply their own token, let them paste one instead.

**If localhost only:** skip token generation; `BEAST_TOKEN` stays unset.

---

### Step 6: Write `.env`

Write (or update) `${CLAUDE_PLUGIN_ROOT}/web/.env`:

```dotenv
BEAST_PROJECTS=<name-1>:<path-1>,<name-2>:<path-2>,...
PORT=<port>
BEAST_HOST=<127.0.0.1 or 0.0.0.0>
BEAST_TOKEN=<token, or omit the line entirely if localhost-only>
```

**This step is idempotent** — if `.env` already exists (a re-run), overwrite it with the newly confirmed values rather than creating a second file or appending. Show:
```
📝 Wrote ${CLAUDE_PLUGIN_ROOT}/web/.env
```

---

### Step 7: Detect OS & Install the Background Service

Detect the platform:
```bash
uname -s 2>/dev/null || echo Windows_NT
```

Find the absolute Node path (daemons run with a minimal `PATH`, so use the full path, not just `node`):
```bash
which node
```

#### macOS — launchd

Write `~/Library/LaunchAgents/com.beastmode.web.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.beastmode.web</string>
  <key>ProgramArguments</key>
  <array>
    <string><absolute-path-to-node></string>
    <string>${CLAUDE_PLUGIN_ROOT}/web/dist/bin/beast-web.js</string>
  </array>
  <key>WorkingDirectory</key><string>${CLAUDE_PLUGIN_ROOT}/web</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/beast-web.log</string>
  <key>StandardErrorPath</key><string>/tmp/beast-web.err.log</string>
</dict>
</plist>
```

**Idempotent install/reload:**
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.beastmode.web.plist 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.beastmode.web.plist
launchctl kickstart -k gui/$(id -u)/com.beastmode.web
```

#### Linux — systemd (user unit)

Write `~/.config/systemd/user/beast-web.service`:

```ini
[Unit]
Description=Beast Mode standalone web dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=${CLAUDE_PLUGIN_ROOT}/web
ExecStart=<absolute-path-to-node> ${CLAUDE_PLUGIN_ROOT}/web/dist/bin/beast-web.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

**Idempotent install/reload:**
```bash
mkdir -p ~/.config/systemd/user
systemctl --user daemon-reload
systemctl --user enable --now beast-web.service
systemctl --user restart beast-web.service
```

Mention (optional, don't do it automatically): running `loginctl enable-linger $USER` lets the service keep running after the user logs out, not just while a session is active.

#### Windows — Task Scheduler (default), or NSSM / pm2 if available

Check for alternatives first:
```bash
where nssm 2>nul
where pm2 2>nul
```

**Default (no extra tooling): Task Scheduler**, running at logon and restarting on failure:
```bash
schtasks /create /tn "BeastModeWeb" /tr "\"<absolute-path-to-node>\" \"${CLAUDE_PLUGIN_ROOT}\\web\\dist\\bin\\beast-web.js\"" /sc onlogon /rl highest /f
schtasks /run /tn "BeastModeWeb"
```
(`/f` forces overwrite of an existing task with the same name — this makes re-runs idempotent.)

**If `nssm` is available**, offer it as an alternative (it runs as a true Windows service, including before login):
```bash
nssm install BeastModeWeb "<absolute-path-to-node>" "${CLAUDE_PLUGIN_ROOT}\web\dist\bin\beast-web.js"
nssm set BeastModeWeb AppDirectory "${CLAUDE_PLUGIN_ROOT}\web"
nssm start BeastModeWeb
```

**If `pm2` is available** (likely already installed if the user has set up the Discord bridge):
```bash
pm2 start "<absolute-path-to-node>" --name beast-web --cwd "${CLAUDE_PLUGIN_ROOT}/web" -- "${CLAUDE_PLUGIN_ROOT}/web/dist/bin/beast-web.js"
pm2 save
```

If more than one option is available, ask the user which they'd prefer with `AskUserQuestion` (default: Task Scheduler — no extra dependencies).

---

### Step 8: Verify It's Running

Wait a couple of seconds, then check the dashboard responds:

```bash
curl -s -o /dev/null -w "%{http_code}" http://<BEAST_HOST>:<PORT>/
```

Expect `200`. If it doesn't respond:
- Check service status (`launchctl print gui/$(id -u)/com.beastmode.web`, `systemctl --user status beast-web.service`, or `schtasks /query /tn BeastModeWeb`)
- Check logs (macOS: `/tmp/beast-web.log` / `/tmp/beast-web.err.log`; Linux: `journalctl --user -u beast-web.service -n 50`)
- Most common cause: `.env` points at a project path that no longer exists, or the port is already in use — re-check Steps 4–6.

---

### Step 9: Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEAST MODE WEB APP IS RUNNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dashboard:      http://<host>:<port>
Projects:       [count] — [name-1], [name-2], ...
Config:         ${CLAUDE_PLUGIN_ROOT}/web/.env
Background service: [launchd label / systemd unit / scheduled task name]

[If a token was generated, show it again here and remind
 the user to keep it secret and pass it as
 "Authorization: Bearer <token>" from any external client.]

Managing the service:
  macOS:   launchctl kickstart -k gui/$(id -u)/com.beastmode.web
           launchctl bootout gui/$(id -u) com.beastmode.web   (to stop)
  Linux:   systemctl --user restart beast-web.service
           systemctl --user stop beast-web.service
  Windows: schtasks /run /tn BeastModeWeb
           schtasks /end /tn BeastModeWeb

Re-run /setup-web-app any time to add/remove projects, change
the port, or rotate the token — it updates the existing .env
and service instead of creating duplicates.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Important Notes

1. **Idempotent by design.** Every write in this command (the `.env` file, the launchd plist, the systemd unit, the scheduled task) targets a **fixed, well-known name/path**. Re-running this command updates those in place — it never creates a second `.env`, a second plist, or a second scheduled task.
2. **Localhost by default.** Never bind to `0.0.0.0` (or any non-loopback host) without a `BEAST_TOKEN` — warn clearly and require one if the user chooses network exposure (Step 5).
3. **No project discovered ≠ failure.** If discovery finds nothing, ask where to look (Step 3) rather than giving up — this is an explicit acceptance criterion, not an edge case to special-case away.
4. **Do not touch `bot/` or the Discord bridge.** This command only manages the standalone `@beast-mode/web/server`, wired from `${CLAUDE_PLUGIN_ROOT}/web`. It reads (never writes) `~/.config/beast-mode-discord/projects.json` purely as an extra discovery source.
5. **v1 runs the in-repo package directly** (`node ${CLAUDE_PLUGIN_ROOT}/web/dist/bin/beast-web.js`) — there is no global `beast-web` binary installed on `PATH` yet; that's a future step once the package is published.
