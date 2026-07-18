# Discord Bridge Setup Guide

The Beast Mode Discord Bridge lets you run Beast Mode workflow commands from any Discord channel and watch Claude Code work in real-time — all from your phone or desktop.

Join the Beast Mode community Discord: https://discord.gg/aWa6kasxYC

---

## Prerequisites

Before you start, you need:

- **Bun** runtime — the bot and channel both run on Bun
  Install: `curl -fsSL https://bun.sh/install | bash`
- **pm2** process manager — keeps the bot running 24/7
  Install: `npm install -g pm2` or `bun install -g pm2`
- A **Discord bot application** (see Guided Setup below)
- Claude Code with the Beast Mode plugin installed

---

## Quick Start (5 steps)

1. **Create a Discord bot** at https://discord.com/developers/applications
   - Bot tab: reset token, enable "Message Content Intent"
   - OAuth2: grant `bot` + `applications.commands` scopes, add Send Messages / Create Threads / Manage Threads / Read Message History permissions
   - Invite the bot to your server

2. **Run the setup wizard** in Claude Code:
   ```
   /setup-discord-bridge
   ```
   The wizard collects your bot token, server ID, channel mapping, user allowlist, generates an HMAC secret, installs dependencies, and starts the bot via pm2.

3. **Restart Claude Code** with the channel enabled:
   ```bash
   claude --dangerously-load-development-channels server:beast-mode-discord
   ```

4. **Verify** in Discord: run `/beast status` — your project should show as online.

5. **Try a command**: `/beast suggest` or `/beast plan <feature-name>`

---

## Architecture Overview

```
Discord Server
    |
    | (discord.js gateway — one connection per bot token)
    v
+-----------------------------------+
|   Central Bot  (always running)   |
|   pm2 process, port 3847          |
|   Handles: slash commands,        |
|   user auth, thread management,   |
|   health-check polling            |
+----------------+------------------+
                 | HTTP (localhost only, HMAC-signed)
          +------+------+
          |             |
          v             v
    +-----------+  +-----------+
    | Channel A |  | Channel B |  per-project MCP servers
    | port 3850 |  | port 3851 |  spawned by Claude Code
    | MCP stdio |  | MCP stdio |
    +-----+-----+  +-----+-----+
          |               |
      Claude Code     Claude Code
      Session A       Session B
```

- **Central bot** runs persistently via pm2. One bot handles all projects.
- **Per-project channels** run as MCP servers inside Claude Code. They start when Claude Code opens and stop when it closes.
- All communication between bot and channels is over localhost HTTP, signed with per-project HMAC secrets.

---

## Configuration Reference

### Bot configuration — `~/.config/beast-mode-discord/config.json`

```json
{
  "botToken": "MTIz...",
  "guildId": "846209781206941736",
  "channelProjects": {
    "DISCORD_CHANNEL_ID": "project-name"
  },
  "allowedUsers": ["USER_SNOWFLAKE_ID"],
  "adminUsers": ["USER_SNOWFLAKE_ID"],
  "botPort": 3847,
  "threadAutoArchive": 60
}
```

| Field | Description |
|-------|-------------|
| `botToken` | Discord bot token from the Developer Portal |
| `guildId` | Discord server (guild) ID |
| `channelProjects` | Maps Discord channel IDs to project names |
| `allowedUsers` | Discord user IDs who can run `/beast` commands |
| `adminUsers` | Discord user IDs with admin privileges (also included in allowed) |
| `botPort` | HTTP port the bot listens on (default: 3847) |
| `threadAutoArchive` | Thread auto-archive minutes: 60, 1440, 4320, or 10080 (default: 60) |
| `pathMappings` | Maps project names to local filesystem paths for remote projects (see [Remote Projects](#remote-projects-wsl--other-machines)) |

This file contains your bot token. Permissions are set to 600 (owner read-only) by the setup wizard.

### Per-project channel config — `.beast-mode-channel.json`

```json
{
  "projectName": "my-project",
  "channelPort": 3850,
  "botUrl": "http://127.0.0.1:3847",
  "hmacSecret": "a1b2c3d4..."
}
```

| Field | Description |
|-------|-------------|
| `projectName` | Unique slug for this project (must match `channelProjects` in bot config) |
| `channelPort` | HTTP port this channel listens on (bot must be able to reach it) |
| `botUrl` | Base URL for the central bot (default: `http://127.0.0.1:3847`) |
| `hmacSecret` | 64-char hex HMAC secret (must match the bot's stored secret for this project) |

This file contains the HMAC secret. It is added to `.gitignore` by the setup wizard.

### Auto-managed project registry — `~/.config/beast-mode-discord/projects.json`

Managed automatically by the bot. Lists all currently registered projects with their port, status, and last-seen timestamp. Do not edit manually.

### MCP server declaration — `.mcp.json` (project root)

```json
{
  "mcpServers": {
    "beast-mode-discord": {
      "command": "bun",
      "args": ["run", "/path/to/plugin/channel/server.ts"],
      "env": {}
    }
  }
}
```

This tells Claude Code how to spawn the channel server. You must also start Claude Code with the channel flag:

```bash
# During development / research preview:
claude --dangerously-load-development-channels server:beast-mode-discord

# Once on the official allowlist:
claude --channels server:beast-mode-discord
```

Being in `.mcp.json` alone is not enough — the `--channels` flag is required for channel notifications to be delivered.

---

## Available Discord Commands

After setup, these slash commands are available in mapped channels:

| Command | Description |
|---------|-------------|
| `/beast plan <feature>` | Plan a new feature (creates implementation docs) |
| `/beast start <feature>` | Begin implementation of a planned feature |
| `/beast proceed [feature]` | Continue current feature implementation |
| `/beast autorun [feature]` | Autonomously run a feature to completion (plan, build, review, docs); commits locally, stops before pushing |
| `/beast suggest` | Get a suggestion for the next feature to work on |
| `/beast review <feature>` | Run a code review on a feature |
| `/beast audit <feature>` | Run an architecture audit on a feature |
| `/beast status` | Show all registered projects and their online/offline status |
| `/beast update <feature>` | Update feature docs (context, tasks) |
| `/beast update-master [feature]` | Update the project master overview (`docs/overview.md`) with latest progress |
| `/beast discover <feature>` | Discover and document an existing feature |
| `/beast document <feature>` | Document a completed feature |
| `/beast evaluate <feature>` | Evaluate a feature against its Definition of Done criteria |
| `/beast review-ux [feature]` | Review UX quality of a feature or page |
| `/beast review-pr [pr]` | Independent review of a PR (GitHub PR by number, or local changes pre-submit) |
| `/beast continue <feature>` | Continue work on a feature from where you left off |
| `/beast fix [feature]` | Fix all open bugs for a feature (or all bugs) |
| `/beast fix-bug <bug>` | Fix a specific bug by ID |
| `/beast create-epic <epic> [prompt]` | Group existing prefixed features into an epic (move, un-prefix, rewrite references) |
| `/beast plan-epic <epic> [prompt]` | Plan an epic from scratch — define its constituent features and build order |
| `/beast update-epic [epic]` | Refresh an epic's overview and its single master-overview rollup row |
| `/beast review-epic <epic>` | Review an epic holistically across all its features (integration + per-feature tech debt) |
| `/beast upgrade` | Upgrade Beast Mode to the latest version |

Commands create a thread in the channel where all progress updates and responses appear.

---

## How Commands Work

1. User runs `/beast plan my-feature` in a mapped Discord channel
2. Bot validates the user is in the allowlist and the project is online
3. Bot creates a Discord thread named `beast: plan my-feature`
4. Bot POSTs the command to the channel's HTTP endpoint (HMAC-signed)
5. Channel emits a `notifications/claude/channel` notification (official channels protocol)
6. Claude Code receives it as a `<channel source="beast-mode-discord" command="plan-feature">` tag
7. Claude reads the command and executes the corresponding Beast Mode workflow
8. Claude calls `beast_progress` periodically — updates appear in the thread
9. If Claude needs input, it calls `beast_ask` — question appears in thread, Claude waits
10. Claude calls `beast_reply` with the final result — posted to thread
11. Bot releases the concurrency lock and shortens the thread archive window

**Important:** Claude Code must be started with `--dangerously-load-development-channels server:beast-mode-discord` for channel notifications to be delivered. Without this flag, the MCP server connects and its tools work, but channel messages won't arrive.

---

## Security Notes

### HMAC signing

Every HTTP request between the bot and a channel is signed with a per-project HMAC-SHA256 secret. The bot verifies the signature before processing any request. An attacker on localhost who doesn't know the secret cannot inject commands.

### User allowlists

Only Discord users listed in `allowedUsers` or `adminUsers` can run `/beast` commands. Non-allowlisted users receive an ephemeral "not authorised" message.

### Localhost-only networking

The bot HTTP server (port 3847) and all channel HTTP servers (port 3850+) listen on `127.0.0.1` only — they are not accessible from the network. All communication stays on the local machine.

### Rate limiting

- Per-user: max 10 commands per hour (rolling window)
- Per-project: max 1 concurrent command at a time

### Bot token

The bot token in `~/.config/beast-mode-discord/config.json` has file permissions `600`. Never commit this file to version control.

### HMAC secrets

The per-project HMAC secret in `.beast-mode-channel.json` is added to `.gitignore` automatically. Never commit this file.

---

## Troubleshooting

### Bot not showing as online after startup

```bash
# Check pm2 status
pm2 status

# Check bot logs
pm2 logs beast-mode-discord-bot --lines 50 --nostream

# Check health endpoint
curl http://127.0.0.1:3847/health
```

If `discordReady` is false in the health response, the bot is still connecting to Discord — wait 10-15 seconds. If it stays false, check:
- Bot token is valid (regenerate in Discord Developer Portal if unsure)
- "Message Content Intent" is enabled in the Bot tab of your application

### Slash commands not appearing in Discord

Discord can take 1-2 minutes to propagate new slash commands. If they don't appear after 5 minutes:
- Confirm `guildId` in `config.json` is the numeric server ID (not the server name)
- Check bot logs for "Registered slash command(s)" message
- Ensure the bot has `applications.commands` scope in the server

### Project shows as offline in `/beast status`

The bot polls each channel's health endpoint every 30 seconds. If a project shows offline:
- Confirm Claude Code is open in that project
- Confirm `.mcp.json` is configured and the channel is listed
- Check the channel started: look for "Registered project" in pm2 logs
- Confirm `channelPort` in `.beast-mode-channel.json` matches the port in the bot's project registry

### Channel can't reach bot on startup

The channel retries registration up to 10 times (every 30 seconds). If you start Claude Code before pm2 has started the bot, wait 5 minutes and it will reconnect automatically.

You can also check:
```bash
curl http://127.0.0.1:3847/health
```

### "Invalid signature" errors in channel logs

The HMAC secret in `.beast-mode-channel.json` does not match what the bot has stored for that project. This can happen if:
- The channel config was created manually with a different secret
- The bot's `projects.json` was edited manually

Solution: delete the project from `~/.config/beast-mode-discord/projects.json`, restart Claude Code, and the channel will re-register with the correct secret.

### Command gets stuck (no response in thread)

If a command is running for more than 30 minutes without a reply, the bot automatically releases the concurrency lock and posts a timeout error in the thread.

If a command gets stuck earlier:
- Check Claude Code is responsive (not waiting on user input in the terminal)
- Check for any errors in the thread
- You can restart the Claude Code session — the channel will re-register with the bot

### Multiple projects on the same machine

Each project needs a unique `channelPort`. Use 3850 for the first project, 3851 for the second, etc. The setup wizard auto-detects port conflicts.

Each project also needs a unique `projectName` and a corresponding entry in `channelProjects` in the bot config.

---

## Managing the Bot

```bash
# Start bot
pm2 start /path/to/plugin/bot/ecosystem.config.js

# Stop bot
pm2 stop beast-mode-discord-bot

# Restart bot
pm2 restart beast-mode-discord-bot

# View logs
pm2 logs beast-mode-discord-bot

# Monitor (live view)
pm2 monit

# Auto-start on system boot
pm2 startup
pm2 save
```

Logs are stored in the plugin's `logs/` directory:
- `logs/bot-out.log` — stdout (info/debug)
- `logs/bot-error.log` — stderr (warn/error)

Log entries are structured JSON with `ts`, `level`, `component`, and `msg` fields.

---

## Updating the Bot Config

To add a new project or channel mapping after initial setup:

1. Edit `~/.config/beast-mode-discord/config.json` — add to `channelProjects`
2. Create `.beast-mode-channel.json` in the new project
3. Restart the bot: `pm2 restart beast-mode-discord-bot`
4. Open Claude Code in the new project

To add a new allowed user:
1. Edit `~/.config/beast-mode-discord/config.json` — add the user's snowflake ID to `allowedUsers`
2. Restart the bot: `pm2 restart beast-mode-discord-bot`

---

## Remote Projects (WSL / other machines)

When a project runs on a different machine (e.g. WSL on a Windows PC), the Claude Code session and channel server work normally — commands arrive via Discord and Claude executes them on the remote machine. However, the **web app** can't access the project's files because the registered path is on the remote filesystem.

The solution is to mount the remote project directory on the bot machine and add a `pathMappings` entry to the bot config.

### 1. Enable SSH on the remote machine

For WSL2, first enable mirrored networking so WSL shares the Windows host IP. Add to `C:\Users\<you>\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Then `wsl --shutdown` and reopen WSL.

Install and start SSH (use a non-default port if Windows OpenSSH is already on port 22):

```bash
sudo apt install openssh-server
sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd -p 2222
```

To auto-start on WSL boot, add to `/etc/wsl.conf`:

```ini
[boot]
command = mkdir -p /run/sshd && /usr/sbin/sshd -p 2222
```

If the remote machine is Windows with WSL, open the port in Windows Firewall (elevated PowerShell):

```powershell
New-NetFirewallRule -DisplayName "WSL SSH" -Direction Inbound -LocalPort 2222 -Protocol TCP -Action Allow
```

### 2. Set up SSH key auth on the bot machine

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_wsl_remote -N ""
ssh-copy-id -i ~/.ssh/id_wsl_remote -p 2222 user@REMOTE_IP
```

Add a host entry to `~/.ssh/config` for convenience:

```
Host remote-wsl
    HostName REMOTE_IP
    Port 2222
    User your-username
    IdentityFile ~/.ssh/id_wsl_remote
```

Verify: `ssh remote-wsl` should connect without a password.

### 3. Mount the project directory with SSHFS

```bash
sudo mkdir -p /mnt/remote/my-project
sudo chown $(whoami):$(whoami) /mnt/remote/my-project
sshfs remote-wsl:/path/to/project /mnt/remote/my-project -o reconnect,ServerAliveInterval=15
```

Verify: `ls /mnt/remote/my-project` should show the project files. If the directory appears empty, `cd` out and back in.

To make the mount persistent, add to `/etc/fstab`:

```
user@REMOTE_IP:/path/to/project /mnt/remote/my-project fuse.sshfs port=2222,IdentityFile=/home/you/.ssh/id_wsl_remote,reconnect,ServerAliveInterval=15,_netdev,user,noauto 0 0
```

Then `mount /mnt/remote/my-project` when needed.

### 4. Add a path mapping to the bot config

Edit `~/.config/beast-mode-discord/config.json` and add a `pathMappings` entry mapping the project name to the local mount path:

```json
{
  "pathMappings": {
    "my-project": "/mnt/remote/my-project"
  }
}
```

Restart the bot: `pm2 restart beast-mode-discord-bot`

The web app will now use the mounted path to read features, bugs, and documentation for that project. Add more entries as needed for additional remote projects.
