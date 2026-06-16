# Beast Mode — Desktop MCP Setup

The Beast Mode Desktop MCP Server exposes your project data as 13 MCP tools for any MCP-capable client — Claude Desktop, Cursor, Windsurf, or similar. It connects to a running Beast Mode Discord bot via its HTTP API and lets you query and manage features and bugs without opening Claude Code.

**Prerequisites:** The [Discord Bridge](discord-bridge-setup.md) must be set up and the bot must be running before using the Desktop MCP.

---

## Overview of Tools

The MCP server provides 13 tools:

| Category | Tools |
|----------|-------|
| Projects | `list_projects`, `get_project`, `get_project_doc` |
| Features | `list_features`, `get_feature`, `read_feature_file`, `write_feature_file`, `create_feature` |
| Bugs | `list_bugs`, `get_bug`, `create_bug`, `update_bug` |

---

## Step 1: Add an API Key to the Bot

The MCP server authenticates to the bot using a Bearer token. Add an API key to the bot's config file at `~/.config/beast-mode-discord/config.json`:

```json
{
  "botToken": "...",
  "guildId": "...",
  "apiKeys": ["my-desktop-key-abc123"]
}
```

- Multiple keys are supported. Each MCP client can have its own key.
- Keep this key private — it grants read/write access to all registered projects.
- Restart the bot after adding a key: `pm2 restart beast-mode-discord-bot`

---

## Step 2: Configure Your MCP Client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS:

```json
{
  "mcpServers": {
    "beast-mode": {
      "command": "bun",
      "args": [
        "/path/to/beast-mode/bot/mcp-server.ts",
        "--bot-url=https://your-bot-domain.com",
        "--api-key=my-desktop-key-abc123"
      ]
    }
  }
}
```

For a local bot (bot and client on the same machine):

```json
{
  "mcpServers": {
    "beast-mode": {
      "command": "bun",
      "args": [
        "/home/user/.claude/plugins/beast-mode/bot/mcp-server.ts"
      ],
      "env": {
        "BEAST_BOT_URL": "http://localhost:3847",
        "BEAST_API_KEY": "my-desktop-key-abc123"
      }
    }
  }
}
```

Replace `/home/user/.claude/plugins/beast-mode/` with the actual path where Beast Mode is installed.

### Cursor / Windsurf / Other MCP Clients

Use the same pattern: `command: "bun"`, point `args` at `bot/mcp-server.ts`, and pass the bot URL and API key either as `args` or as `env` variables:

- `--bot-url=<url>` or env `BEAST_BOT_URL`
- `--api-key=<key>` or env `BEAST_API_KEY`

---

## Configuration Reference

### CLI Args / Environment Variables

| Arg | Env Var | Description |
|-----|---------|-------------|
| `--bot-url=<url>` | `BEAST_BOT_URL` | Base URL of the Beast Mode bot HTTP API (e.g. `http://localhost:3847`) |
| `--api-key=<key>` | `BEAST_API_KEY` | Bearer token from `config.apiKeys` in the bot config |

Both are required. The server exits with a clear error if either is missing.

### Authentication

Every request from the MCP server to the bot uses `Authorization: Bearer <key>`. A missing or invalid key returns HTTP 401, and the tool call returns an `isError: true` response.

---

## Verifying the Setup

After configuring your client, ask Claude to list your projects:

> "List my Beast Mode projects"

Claude should call `list_projects` and return your project names. If it fails, check:

1. The bot is running: `curl http://localhost:3847/health`
2. The API key in your client config matches an entry in `config.apiKeys`
3. The path to `bot/mcp-server.ts` in your client config is correct
4. `bun` is on your `PATH` (verify with `which bun`)

---

## Security Notes

- The API key grants read/write access to all features and bugs in all registered projects. Treat it like a password.
- Use a dedicated key per MCP client so you can rotate individual keys without affecting others.
- The bot's HTTP API is intended to be accessible externally (it's the same surface the web dashboard uses), so the key is the only protection. Do not share it.
