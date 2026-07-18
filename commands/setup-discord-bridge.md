---
description: "Guided first-time setup for the Beast Mode Discord Bridge. Configures the central bot, per-project channel, and starts services. Usage: /setup-discord-bridge"
---

You are setting up the **Beast Mode Discord Bridge** — a two-way connection between Discord and Claude Code sessions.

When complete, users will be able to run `/beast plan <feature>` from Discord, watch phase-by-phase progress in a thread, answer questions, and approve/deny tool use, all from their phone or desktop Discord client.

---

## Setup Process

Work through each step in order. Ask the user for information as needed. If a step fails, explain what went wrong and how to fix it before continuing.

---

### Step 1: Welcome & Prerequisites

Display this welcome message:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEAST MODE DISCORD BRIDGE SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This will configure:
  - Central Discord bot (runs persistently via pm2)
  - Per-project MCP channel (runs inside Claude Code)
  - Secure HMAC authentication between them

Prerequisites needed:
  - A Discord bot token and server (guild) ID
  - bun runtime installed
  - pm2 process manager installed

Let's check prerequisites first.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Check prerequisites:**

Run these commands:
```bash
which bun
which pm2
```

If `bun` is not found:
- Tell the user: "bun is required. Install it with: `curl -fsSL https://bun.sh/install | bash`"
- After install instructions, ask: "Have you installed bun? Run `which bun` to confirm, then continue."

If `pm2` is not found:
- Tell the user: "pm2 is required. Install it with: `npm install -g pm2` or `bun install -g pm2`"
- After install instructions, ask: "Have you installed pm2? Run `which pm2` to confirm, then continue."

Show a pass/fail for each:
```
Prerequisites:
  bun:  [FOUND at /path/to/bun]  OR  [MISSING - install required]
  pm2:  [FOUND at /path/to/pm2]  OR  [MISSING - install required]
```

Do not continue if either prerequisite is missing.

---

### Step 2: Discord Bot Information

Tell the user what they need to gather before proceeding:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISCORD BOT SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You need a Discord bot application. If you haven't created one:

1. Go to https://discord.com/developers/applications
2. Click "New Application", give it a name (e.g. "Beast Mode")
3. Go to "Bot" tab, click "Reset Token" to get your bot token
4. Enable these Privileged Gateway Intents:
   - MESSAGE CONTENT INTENT
5. Go to "OAuth2 > URL Generator":
   - Scopes: bot, applications.commands
   - Bot Permissions: Send Messages, Create Public Threads,
     Send Messages in Threads, Manage Threads, Read Message History
6. Copy the generated URL, open it, and add the bot to your server

You will also need:
- Your Discord server (guild) ID
  (Right-click your server name > "Copy Server ID" — enable Developer Mode first
   via User Settings > Advanced > Developer Mode)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Ask the user:
1. "Paste your Discord bot token:" — store as `botToken`
2. "Paste your Discord server (guild) ID:" — store as `guildId`

Validate that `botToken` looks like a Discord token (contains dots, is at least 50 chars).
Validate that `guildId` is a numeric string (Discord snowflake, 17-20 digits).

---

### Step 3: Channel-to-Project Mapping

Explain to the user:

```
Each Discord text channel can be mapped to one project.
When a user runs /beast commands in that channel,
the commands are routed to that project's Claude Code session.

You can map multiple channels to different projects.
```

Ask the user:
1. "Paste the Discord channel ID for THIS project:"
   (Right-click a channel > "Copy Channel ID")
   Store as `channelId`

2. "What is the project name for this channel?"
   (This should be a short slug, e.g. "my-project" or "beast-mode")
   Store as `projectName`

Validate that `channelId` is a numeric string (17-20 digits).
Validate that `projectName` contains only letters, numbers, and hyphens.

Build the `channelProjects` mapping: `{ [channelId]: projectName }`

Ask: "Do you want to map more channels to other projects? (yes/no)"
If yes, repeat this step to collect additional mappings.

---

### Step 4: User Allowlist

Explain:

```
Beast Mode commands require an allowlist — only listed users can
invoke /beast commands. Admins can also run admin-only commands.

To find your Discord user ID:
  Right-click your username > "Copy User ID"
  (Requires Developer Mode enabled)
```

Ask:
1. "Paste the Discord user IDs to allow (one per line, or comma-separated):"
   Parse into an array `allowedUsers`

2. "Which of these users should be admins? (paste IDs, or press Enter if none):"
   Parse into an array `adminUsers`

Validate all IDs are numeric strings (17-20 digits).

---

### Step 5: Generate HMAC Secret & Port

Tell the user: "Generating a random HMAC secret for secure bot-channel communication..."

Run:
```bash
openssl rand -hex 32
```

Store the output as `hmacSecret`. If openssl is not available, use this alternative:
```bash
bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

For the bot port, use `3847` as default. For this project's channel port, use `3850`.

Check if port 3850 is available:
```bash
ss -tlnp 2>/dev/null | grep :3850 || lsof -i :3850 2>/dev/null | grep LISTEN
```

If port 3850 is in use, increment to find a free port (3851, 3852, etc.).

---

### Step 6: Write Configuration Files

**6a. Bot configuration**

Create the directory:
```bash
mkdir -p ~/.config/beast-mode-discord
```

Write the bot config to `~/.config/beast-mode-discord/config.json`:
```json
{
  "botToken": "<botToken from step 2>",
  "guildId": "<guildId from step 2>",
  "channelProjects": {
    "<channelId>": "<projectName>"
  },
  "allowedUsers": ["<user IDs from step 4>"],
  "adminUsers": ["<admin IDs from step 4>"],
  "botPort": 3847
}
```

Set restrictive permissions on the config file (it contains the bot token):
```bash
chmod 600 ~/.config/beast-mode-discord/config.json
```

Show: "Bot config written to ~/.config/beast-mode-discord/config.json"

**6b. Per-project channel config**

Write `.beast-mode-channel.json` in the current project directory (cwd):
```json
{
  "projectName": "<projectName from step 3>",
  "channelPort": <port from step 5>,
  "botUrl": "http://127.0.0.1:3847",
  "hmacSecret": "<hmacSecret from step 5>"
}
```

Show: "Channel config written to .beast-mode-channel.json"

**6c. Update .gitignore**

Check if `.gitignore` exists. If it does, add `.beast-mode-channel.json` to it (if not already present) — this file contains the HMAC secret and should not be committed.

If `.gitignore` does not exist, create it with:
```
.beast-mode-channel.json
```

Show: ".beast-mode-channel.json added to .gitignore (contains HMAC secret)"

---

### Step 7: Install Dependencies

**7a. Bot dependencies**

Find the plugin root via `${CLAUDE_PLUGIN_ROOT}` and install bot dependencies:
```bash
cd ${CLAUDE_PLUGIN_ROOT}/bot && bun install
```

Show the output. If it fails, show the error and stop.

**7b. Channel dependencies**

```bash
cd ${CLAUDE_PLUGIN_ROOT}/channel && bun install
```

Show the output. If it fails, show the error and stop.

---

### Step 8: Start the Bot via pm2

```bash
pm2 start ${CLAUDE_PLUGIN_ROOT}/bot/ecosystem.config.cjs
```

Wait a moment, then check if it started:
```bash
pm2 status beast-mode-discord-bot
```

If status shows `online`, continue.

If status shows `error` or `stopped`, run:
```bash
pm2 logs beast-mode-discord-bot --lines 20 --nostream
```

Show the logs and tell the user what likely went wrong (bad bot token, network issue, etc.).

**Save pm2 startup config** so the bot restarts on reboot:
```bash
pm2 save
```

Then show:
```bash
pm2 startup
```

Tell the user: "To make pm2 auto-start on system boot, run the command shown above (it requires sudo)."

---

### Step 9: Verify Bot Health

Check the bot's health endpoint:
```bash
curl -s http://127.0.0.1:3847/health
```

Expected response:
```json
{"status":"ok","uptime":...,"projects":0,"discordReady":true}
```

If `discordReady` is false, the bot is still connecting to Discord. Wait 5 seconds and try again.

If the health check fails entirely, the bot HTTP server is not running. Check pm2 logs again.

---

### Step 10: Add Channel to Claude Code MCP Config

The per-project channel runs as an MCP server inside Claude Code. You need to add it to Claude Code's MCP configuration.

The MCP channel runs as an MCP server inside Claude Code. It needs to be declared in `.mcp.json`.

**Important:** The command must use the **absolute path** to bun (Claude Code's subprocess PATH may not include `~/.bun/bin`), and must pass `--config=` pointing to the project's `.beast-mode-channel.json`.

Find the absolute path to bun:
```bash
which bun
```

Get the absolute path to the current project directory:
```bash
pwd
```

Check if `.mcp.json` already exists. If it does, read it and merge the `beast-mode-discord` entry into `mcpServers`. If it doesn't, create it:

```json
{
  "mcpServers": {
    "beast-mode-discord": {
      "command": "<absolute-path-to-bun>",
      "args": [
        "${CLAUDE_PLUGIN_ROOT}/channel/server.ts",
        "--config=<absolute-path-to-project>/.beast-mode-channel.json"
      ],
      "env": {}
    }
  }
}
```

If `.mcp.json` already exists with other servers, merge the new entry — do NOT overwrite existing entries.

---

### Step 11: Connection Test

Tell the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONNECTION TEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To complete setup, restart Claude Code with the channel enabled:

  claude --dangerously-load-development-channels server:beast-mode-discord

This flag is required during the research preview to enable
custom channel notifications. Without it, the MCP server connects
but channel messages won't be delivered.

Once running:
1. The channel will auto-register with the bot on startup
2. Run: /beast status  in your Discord server
   You should see your project listed as "online"
3. Try typing a message in your Discord channel!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Tell the user what to look for:
- In pm2 logs: `[registry] Registered project: <name> on port <port>`
- In Discord: `/beast status` should show the project with a green dot

---

### Step 12: Summary

Display final summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISCORD BRIDGE SETUP COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What was configured:
  Bot config:     ~/.config/beast-mode-discord/config.json
  Channel config: .beast-mode-channel.json
  Bot process:    running via pm2 (beast-mode-discord-bot)
  Dependencies:   bot/ and channel/ packages installed

Channel mapping:
  Discord channel <channelId> → project "<projectName>"

Allowlisted users:
  <list user IDs>

Next steps:
  1. Start Claude Code with the channel flag:
     claude --dangerously-load-development-channels server:beast-mode-discord
  2. In Discord, run: /beast status
  3. Verify your project shows as "online"
  4. Try typing a message in your Discord channel!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Commands available in Discord:
  /beast plan <feature>     Plan a new feature
  /beast start <feature>    Start implementation
  /beast proceed            Continue current feature
  /beast suggest            Get next feature suggestion
  /beast review <feature>   Code review
  /beast audit <feature>    Architecture audit
  /beast status             Show registered projects
  /beast update <feature>   Update feature docs
  /beast discover <feature> Discover existing feature
  /beast document <feature> Document a feature
  /beast continue <feature> Continue work on feature
  /beast upgrade            Upgrade Beast Mode

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Logs:
  Bot logs:  pm2 logs beast-mode-discord-bot
  Health:    curl http://127.0.0.1:3847/health

Troubleshooting: docs/discord-bridge-setup.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Error Recovery

**If pm2 start fails:**
- Check bot token is valid (try the Discord developer portal)
- Check port 3847 is not in use: `ss -tlnp | grep 3847`
- Check logs: `pm2 logs beast-mode-discord-bot --lines 50 --nostream`

**If bot is online but discordReady is false:**
- Wait 10-15 seconds for Discord gateway connection
- If still false after 30 seconds, check bot token and intents in Discord developer portal

**If channel can't connect to bot:**
- Confirm bot is running: `pm2 status`
- Confirm port matches: `curl http://127.0.0.1:3847/health`
- Confirm hmacSecret matches between config.json and .beast-mode-channel.json

**If /beast commands don't appear in Discord:**
- The bot registers slash commands on startup — wait 1-2 minutes for Discord to propagate
- Check the guildId is correct (numeric server ID, not server name)

---

## Important Notes

- The HMAC secret in `.beast-mode-channel.json` must match the one the bot uses for this project. The setup wizard generates a matching pair automatically.
- The bot token is stored in `~/.config/beast-mode-discord/config.json` with 600 permissions. Do not commit this file.
- `.beast-mode-channel.json` is added to `.gitignore` automatically because it contains the per-project HMAC secret.
- The central bot needs to run 24/7 — pm2 handles this with auto-restart. The channel only runs when Claude Code is open.
- For the full architecture overview and troubleshooting guide, see `docs/discord-bridge-setup.md`.
