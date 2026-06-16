# Beast Mode Plugin

Beast Mode is a **human-in-the-loop workflow for AI-assisted, spec-driven development**. It is explicitly not "vibe coding." Every feature is planned and approved before implementation begins, and built-in review and evaluation gates keep you in the loop throughout. The workflow is: plan → approve → implement → test → review. You can ask Claude Code to drive the whole cycle autonomously, but the default is a workflow designed to keep you informed and in control at every step.

Based on the Reddit post: **"Claude Code is a beast: Tips from 6 months of hardcore use"**

---

## Installation

### 1. Add the Beast Mode marketplace

```
/plugin marketplace add aaronstatic/beast-mode
```

### 2. Install Beast Mode

```
/plugin install beast-mode@aaronstatic
```

### 3. Set up your project

In any project directory, run:

```
/beast-mode:install-beast-mode
```

This sets up your project with slash commands, agents, doc templates, and a skills knowledge base.

---

## What's Included

**23 slash commands** covering a full feature-development lifecycle — planning, implementation, review, evaluation, bug tracking, and epics. See [Command Reference](docs/command-reference.md) for the full list.

**Feature Docs** — Three Markdown files per feature (`implementation.md`, `context.md`, `tasks.md`) keep Claude's context alive across sessions. Nothing is lost between conversations.

**Skills System** — Auto-activating best-practice libraries for your tech stack, built incrementally as you complete features via `/document-feature`.

**Agents** — Specialized sub-agents tuned by model and effort level (solution-architect on opus, standard dev on sonnet, advanced dev on opus for high-risk work).

**Epics** — Group related features into tracked epics with `/create-epic`, `/plan-epic`, `/update-epic`, `/review-epic`.

---

## Docs

- [New Project Quick Start](docs/new-project-quick-start.md) — starting a brand new project with Beast Mode
- [Existing Project Quick Start](docs/existing-project-quick-start.md) — adding Beast Mode to a project that already has code
- [Command Reference](docs/command-reference.md) — all 23 slash commands
- [Discord Bridge Setup](docs/discord-bridge-setup.md) — run Beast Mode workflows from any Discord channel
- [Desktop MCP Setup](docs/desktop-mcp-setup.md) — manage projects from Claude Desktop, Cursor, or Windsurf

---

## Discord Bridge

Run Beast Mode workflows remotely from any Discord channel — plan features, fix bugs, and check project status from your phone.

**Setup:** Run `/setup-discord-bridge` and follow the wizard. See [Discord Bridge Setup](docs/discord-bridge-setup.md).

---

## Web Dashboard

Browser-based interface for managing feature docs and bugs across all registered projects. Runs on the same port as the Discord bot — no additional setup required. Features: project sidebar with online/offline status, feature cards grouped by status, Tiptap WYSIWYG Markdown editor, per-project bug tracker, Discord OAuth2 auth, and mobile-responsive design.

---

## Desktop MCP Server

Exposes Beast Mode project data as 13 MCP tools for Claude Desktop, Cursor, Windsurf, or any MCP-compatible client. See [Desktop MCP Setup](docs/desktop-mcp-setup.md).

---

## Upgrading

```
/beast-mode:upgrade-beast-mode
```

Compares versions, shows what's new, and installs updated templates while preserving your customizations.

---

## Community

Join the Discord: https://discord.gg/aWa6kasxYC

---

## License

MIT

---

## Credits

Based on the Reddit post: **"Claude Code is a beast: Tips from 6 months of hardcore use"**

Created to make battle-tested Claude Code workflow patterns easy to deploy across any project.
