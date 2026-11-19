# Beast Mode Plugin

Beast Mode is a **human-in-the-loop workflow for AI-assisted, spec-driven development**. It is explicitly not "vibe coding." Every feature is planned and approved before implementation begins, and built-in review and evaluation gates keep you in the loop throughout. The workflow is: plan → approve → implement → test → review. You can ask Claude Code to drive the whole cycle autonomously, but the default is a workflow designed to keep you informed and in control at every step.

Based on the Reddit post: **"Claude Code is a beast: Tips from 6 months of hardcore use"**

---

## Installation

**Prerequisite:** Node.js 20 or later. The installer CLI that `/install-beast-mode` runs is a Node script.

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

This sets up your project with command skills in `.claude/skills/`, agents, and a shared `.beast-mode/` directory of doc templates and reference files.

---

## What's Included

**31 command skills** covering a full feature-development lifecycle — planning, implementation, review, evaluation, bug tracking, epics, token reporting, session review, and Orca orchestration. See [Command Reference](docs/command-reference.md) for the full list.

**Feature Docs** — Three Markdown files per feature (`implementation.md`, `context.md`, `tasks.md`) keep Claude's context alive across sessions. Nothing is lost between conversations.

**Skills System** — Auto-activating best-practice libraries for your tech stack, built incrementally as you complete features via `/document-feature`.

**Agents** — Specialized sub-agents tuned by model and effort level (solution-architect on opus, standard dev on sonnet, advanced dev on opus for high-risk work).

**Epics** — Group related features into tracked epics with `/create-epic`, `/plan-epic`, `/update-epic`, `/review-epic`.

**Token Reports** — See the token and step use of every session, and find the session that carries a flag, with `/token-report`.

**Session Review** — Read the log of one session, not the code, with `/review-session`. It ranks findings that each quote one step, and it applies the ones you pick: a pointer, a check, or a rule line.

**Orca Orchestration** — Run a feature or an epic as Orca agent tabs, one fresh tab per phase, with `/orca-feature`, `/orca-epic`, and `/orca-setup`. See [Orca Orchestration](docs/orca-orchestration.md).

**Feature Pane** — In Claude Code 2.1.287 or later, `/feature [name]` opens a pane that shows the path, the status, the progress, the current phase with its tasks, and the open bugs of a feature. The pane redraws after an edit of the shown docs, and it starts no model request. An older release keeps every skill and command.

**Dashboard Pane** — In Claude Code 2.1.287 or later, `/dashboard` opens a pane with four views: the project, an epic, a feature, and a bug. A Back button returns to the last view. A button fills the prompt with the next Beast Mode command, and it never sends the prompt. The pane redraws after an edit of a shown doc, and it starts no model request.

---

## Docs

- [New Project Quick Start](docs/new-project-quick-start.md) — starting a brand new project with Beast Mode
- [Existing Project Quick Start](docs/existing-project-quick-start.md) — adding Beast Mode to a project that already has code
- [Command Reference](docs/command-reference.md) — all 31 command skills
- [Orca Orchestration](docs/orca-orchestration.md) — run a feature or an epic as Orca agent tabs
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

## DeepSeek Harness

Beast Mode also runs on DeepSeek Harness (dsh), pinned to `0.1.5-rc.1`.

```
dsh plugin --profile <name> add beast-mode
```

Then run `/install-beast-mode`. Files land in `.agents/skills/` and the shared `.beast-mode/` directory.

A dsh web session also shows a "Beast Mode" tab beside the Chat tab. The tab holds the whole dashboard: seven run buttons on a feature page, three on an epic page, and a plain textarea editor in place of the rich one. Each button starts a new session and queues the matching command. Update the panel with `dsh plugin --profile <name> update beast-mode`, then reload the web UI. See [The dsh web panel](docs/dsh-web-panel.md) for the full guide.

## Several harnesses on one project

Install Beast Mode for Claude Code and for dsh in the same project. `.beast-mode/version.json` records both harnesses, and `.beast-mode/harness.md` holds one section per harness so each reads only its own tools. Run `beast-mode upgrade` with no harness to upgrade every installed harness in one run, and `beast-mode status` to see them all at a glance. See [Several harnesses on one project](docs/multi-harness.md) for the full guide.

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
