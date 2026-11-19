# Harness Glossary - Claude Code

**Harness:** claude-code
**Targets:** Claude Code 2.1.267 and later
**Last Updated:** 2026-10-07 01:30

This file maps each neutral term of a Beast Mode command to a tool of Claude Code. Read the row before you act on the term. Use the mapped tool, and use no tool name from another harness.

## Term map

| Neutral term | This harness |
| --- | --- |
| ask the user to choose | Use the `AskUserQuestion` tool. |
| delegate to the `<name>` agent | Use the `Task` tool (also called the Agent tool) with `subagent_type` set to the agent name. |
| run the `/<name>` command | Use the `SlashCommand` tool, or load the skill of the same name with the `Skill` tool. |
| load the `<name>` skill | Use the `Skill` tool with the skill name. |
| search the web | Use the `WebSearch` tool. |
| the harness skills directory | Use the path `.claude/skills/`. |
| the harness agents directory | Use the path `.claude/agents/`. |
| the project instruction file | Read `CLAUDE.md` at the project root. |
| the browser automation tool | Use Playwright MCP, when the project installs it. |
| the arguments token `$ARGUMENTS` | Read `$ARGUMENTS` where it stands, because the harness substitutes it. |
| edit a file | Use the `Edit` tool. |
| write a file | Use the `Write` tool. |
| read a file range | Use the `Read` tool with `offset` and `limit`. |
| run a shell command | Use the `Bash` tool. |
| evaluate in the browser | Use `mcp__playwright__browser_evaluate`. |
| take a page snapshot | Use `mcp__playwright__browser_snapshot`. |
| send a message to an agent | Use the `SendMessage` tool, with `to` set to the agent id. Send it only to an agent that still runs. A message to a finished agent starts it again in the background. Skip the step when the session shows no `SendMessage` tool. |

## Notes

- `$ARGUMENTS` holds the text after the command name. The harness substitutes it before the command runs.
- The Beast Mode shared files live in `.beast-mode/`. Never write a harness path into them.
- A command skill stays one folder deep, at `.claude/skills/<name>/SKILL.md`.
- The Beast Mode CLI runs as `node <plugin root>/installer/bin/beast-mode.js`. Use that form when the shell does not find the name `beast-mode`. The plugin root is the directory that `${CLAUDE_PLUGIN_ROOT}` names.
- The `Read` result carries line numbers, so `sed -n` is never needed to read a file range, and a read after an edit is not needed.
