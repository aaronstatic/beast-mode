---
description: "Connect the current project to the Beast Mode Discord Bridge. Requires the bot to already be running. Usage: /connect-discord"
---

You are connecting the **current project** to an existing Beast Mode Discord Bridge bot.

The bot must already be running via pm2 (set up with `/setup-discord-bridge`). This command configures the per-project channel only.

---

## Process

### Step 1: Determine if Remote

Ask the user whether the bot is running on this machine or a different one:

> Is the Discord bot running on this machine, or on a remote server?

**Options:**
- "This machine (localhost)"
- "Remote server"

**If remote:**
- Ask: "What is the IP address or hostname of the machine running the bot?"
- Store this as `BOT_HOST` (e.g., `192.168.1.100`, `my-server.local`)
- The bot URL will be `http://<BOT_HOST>:3847` (or custom port if specified)

**If local:**
- Set `BOT_HOST` to `127.0.0.1`
- The bot URL will be `http://127.0.0.1:3847`

### Step 2: Verify Bot is Running

Check the bot is reachable using the determined `BOT_HOST`:

```bash
curl -s http://<BOT_HOST>:3847/health 2>/dev/null
```

If it fails, tell the user:
> The Discord bot is not reachable at `http://<BOT_HOST>:3847`. Make sure the bot is running and the port is accessible from this machine.

For remote setups, suggest checking:
- Firewall rules allow port 3847 from this machine's IP
- The bot is listening on `0.0.0.0` not just `127.0.0.1`

Then stop.

If it succeeds, continue.

### Step 3: Check if Already Connected

Check if `.beast-mode-channel.json` already exists in the current directory:

```bash
test -f .beast-mode-channel.json && echo "exists" || echo "missing"
```

If it exists, read it and ask:
> This project is already configured as `<projectName>` on port `<channelPort>`. Do you want to reconfigure it?

If the user says no, stop.

### Step 4: Gather Information

Ask the user for:

1. **Project name** — A short slug for this project (e.g., `my-app`, `website`). Suggest using the current directory name.
   ```bash
   basename "$(pwd)"
   ```

2. **Discord channel ID** — The Discord channel to link to this project. Tell them:
   > Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click the channel and select "Copy Channel ID".

### Step 5: Find a Free Port

**If local (BOT_HOST is 127.0.0.1):**

Check which ports are already in use by scanning the bot's project registry:

```bash
cat ~/.config/beast-mode-discord/projects.json 2>/dev/null
```

Find the next available port starting from 3850. Also verify the port isn't in use locally:

```bash
ss -tlnp 2>/dev/null | grep :<port> || lsof -i :<port> 2>/dev/null | grep LISTEN
```

**If remote:**

Query the bot's `/next-port` endpoint to find the next available port:

```bash
curl -s http://<BOT_HOST>:3847/next-port
```

This returns `{"port": <number>}`. Use that port number.

Then verify the port isn't in use locally on this machine:

```bash
ss -tlnp 2>/dev/null | grep :<port> || lsof -i :<port> 2>/dev/null | grep LISTEN
```

If the port IS in use locally, increment and check again until a free one is found.

### Step 6: Generate HMAC Secret

```bash
openssl rand -hex 32
```

Store the result for use in the config files.

### Step 7: Determine Channel Host

The `channelHost` is the IP address the bot will use to reach this machine's channel server.

**If local:**
- Set `channelHost` to `127.0.0.1`

**If remote:**
- Ask the user: "What IP address should the bot use to reach this machine? (This machine's LAN/public IP as seen from the bot server)"
- Store as `channelHost`
- Example: if this machine is at `192.168.1.50` and the bot is at `192.168.1.100`, use `192.168.1.50`

### Step 8: Write Channel Config

Write `.beast-mode-channel.json` in the current directory:

```json
{
  "projectName": "<project-name>",
  "channelPort": <port>,
  "channelHost": "<channelHost>",
  "botUrl": "http://<BOT_HOST>:3847",
  "hmacSecret": "<generated-secret>"
}
```

### Step 9: Create claude-agent.sh

Use the Write tool to create `claude-agent.sh` in the current project directory with this content:

```bash
#!/bin/bash

claude --enable-auto-mode --dangerously-load-development-channels server:beast-mode-discord
```

Then make it executable with owner-only permissions:

```bash
chmod 700 ./claude-agent.sh
```

The `700` permission ensures only the file owner can read, write, and execute it — no group or other access.

### Step 10: Add to .gitignore

Ensure `.beast-mode-channel.json`, `.mcp.json`, and `claude-agent.sh` are all in `.gitignore`. For each one, check if it's already present and append if not:

```bash
grep -qxF '.beast-mode-channel.json' .gitignore 2>/dev/null || echo '.beast-mode-channel.json' >> .gitignore
grep -qxF '.mcp.json' .gitignore 2>/dev/null || echo '.mcp.json' >> .gitignore
grep -qxF 'claude-agent.sh' .gitignore 2>/dev/null || echo 'claude-agent.sh' >> .gitignore
```

### Step 11: Register the MCP Server

Find the absolute path to bun and the channel server:
```bash
which bun
ls ~/.claude/plugins/*/beast-mode/channel/server.ts ~/.claude/plugins/beast-mode/channel/server.ts 2>/dev/null | head -1
```

**IMPORTANT — detect a plugin source checkout first.** If the current directory is itself an installed Claude Code plugin (it contains `.claude-plugin/plugin.json`), then a root `.mcp.json` is loaded by Claude Code as a **plugin-level** MCP server (`plugin:<name>:beast-mode-discord`) that is injected into **every** project in every directory. Because the channel server binds a **fixed** port, all those sessions then collide on it and report `✗ Failed to connect`. So in that case we must NOT write `.mcp.json` — we register the server at **local scope** instead.

```bash
test -f .claude-plugin/plugin.json && echo "plugin-checkout" || echo "normal-project"
```

**Case A — normal project** (no `.claude-plugin/plugin.json`):

Check if `.mcp.json` already exists. If it does, read it and merge in the `beast-mode-discord` server entry. If it doesn't, create it:

```json
{
  "mcpServers": {
    "beast-mode-discord": {
      "command": "<absolute-path-to-bun>",
      "args": [
        "<absolute-path-to-channel/server.ts>",
        "--config=<absolute-path-to-project>/.beast-mode-channel.json"
      ],
      "env": {}
    }
  }
}
```

**Case B — plugin source checkout** (`.claude-plugin/plugin.json` is present):

Do NOT create `.mcp.json`. Register the server at **local scope** instead — this stores the definition in `~/.claude.json` keyed to this directory's path, so Claude Code never treats it as a plugin MCP and it only loads in this directory:

```bash
claude mcp add beast-mode-discord -s local -- \
  <absolute-path-to-bun> \
  <absolute-path-to-channel/server.ts> \
  --config=<absolute-path-to-project>/.beast-mode-channel.json
```

(The `--` separator is required so the `--config=…` flag is passed to the server, not parsed by `claude`. `claude-agent.sh` and `.beast-mode-channel.json` are unchanged — `server:beast-mode-discord` resolves to the local-scoped server.)

If a leaking `plugin:…:beast-mode-discord` already exists from a previous run (verify by running `claude mcp list` from an unrelated directory such as `/tmp` — if it appears there, it is leaking globally), delete the offending root `.mcp.json` from the plugin checkout before adding the local-scoped server.

### Step 12: Update Bot Config

The bot config at `~/.config/beast-mode-discord/config.json` needs the new channel mapping.

**IMPORTANT:** The `channelProjects` object is a simple map of `"DISCORD_CHANNEL_ID": "project-name"`. Do NOT nest objects — each entry is just a string value. Example:

```json
"channelProjects": {
  "123456789": "existing-project",
  "987654321": "new-project"
}
```

**If the bot is on the same machine (local)**, read and update the config:
```bash
cat ~/.config/beast-mode-discord/config.json
```

Use the Edit tool to add the new entry to `channelProjects`, then restart:
```bash
pm2 restart beast-mode-discord-bot
```

**If the bot is on a different machine (remote)**, tell the user exactly what to add:

```
On the machine running the bot, edit ~/.config/beast-mode-discord/config.json
and add this entry to the "channelProjects" object:

  "<discord-channel-id>": "<project-name>"

Then restart the bot: pm2 restart beast-mode-discord-bot
```

### Step 13: Verify

Wait a few seconds for the bot to restart, then check:

```bash
sleep 3 && curl -s http://<BOT_HOST>:3847/health
```

### Step 14: Summary

**For local setup:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DISCORD BRIDGE CONNECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Project: <project-name>
Channel Port: <port>
Discord Channel: <channel-id>

Files created:
  .beast-mode-channel.json (channel config)
  claude-agent.sh (launcher script, owner-only permissions)
  .gitignore (updated)

MCP server registered as beast-mode-discord
  normal project   → .mcp.json (project scope)
  plugin checkout  → ~/.claude.json (local scope, no .mcp.json)

Bot config updated:
  ~/.config/beast-mode-discord/config.json

To start using the bridge:
  ./claude-agent.sh

Then try typing a message in your Discord channel!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**For remote setup:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DISCORD BRIDGE CONNECTED (REMOTE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Project: <project-name>
Channel Port: <port>
Channel Host: <channelHost>
Bot URL: http://<BOT_HOST>:3847
Discord Channel: <channel-id>

Files created:
  .beast-mode-channel.json (channel config)
  claude-agent.sh (launcher script, owner-only permissions)
  .gitignore (updated)

MCP server registered as beast-mode-discord
  normal project   → .mcp.json (project scope)
  plugin checkout  → ~/.claude.json (local scope, no .mcp.json)

IMPORTANT — Remote setup requires:

  1. Ensure port <port> is accessible from the bot
     server (<BOT_HOST>) to this machine (<channelHost>)

  2. On the bot server, edit:
     ~/.config/beast-mode-discord/config.json
     Add to "channelProjects":
       "<discord-channel-id>": "<project-name>"

  3. Restart the bot:
     pm2 restart beast-mode-discord-bot

Once configured, start the bridge:
  ./claude-agent.sh

Then try typing a message in your Discord channel!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
