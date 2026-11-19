# Harness Glossary - DeepSeek Harness

**Harness:** dsh
**Targets:** DeepSeek Harness 0.2.1-rc.3 (npm @deepseek-ai/dsh@0.2.1-rc.3, git tag dsh-v0.2.1-rc.3)
**Last Updated:** 2026-11-18 19:58

This file maps each neutral term of a Beast Mode command to a tool of the DeepSeek Harness. Read the row before you act on the term. Use the mapped tool, and use no tool name from another harness.

## Term map

| Neutral term | This harness |
| --- | --- |
| ask the user to choose | Use the `ask_user_question` tool. |
| delegate to the `<name>` agent | Call the `subagent` tool. It starts the agent and returns at once. The runtime brings the result in as a new message when the agent finishes. End the turn and wait for that message. Do not poll, and do not start the same work again. Start its prompt with the body of the `<name>` agent file. Pass the model route of the `## Notes` rule. |
| run the `/<name>` command | Load the `<name>` skill with the `skill` tool, then follow it to the end. |
| load the `<name>` skill | Use the `skill` tool with the skill name. |
| search the web | Use the `web_search` tool. Use `web_fetch` to read one page. |
| the harness skills directory | Use the path `.agents/skills/`. |
| the harness agents directory | dsh has no agents directory. Read an agent file as a flat skill at `.agents/skills/<name>.md`. |
| the project instruction file | Read `AGENTS.md` at the project root. Read `CLAUDE.md` too, when the project holds one. |
| the browser automation tool | dsh attaches no browser tool by default. Ask the user to attach one through `dsh-mcp-client`, or skip the browser step. |
| the arguments token `$ARGUMENTS` | dsh does not substitute `$ARGUMENTS`. Read the text the user typed after `/<name>` in the same message. |
| edit a file | Use the `edit` tool. |
| write a file | Use the `write` tool. |
| read a file range | Use the `read` tool, and name the line range. |
| run a shell command | Use the `bash` tool. |
| evaluate in the browser | Use the evaluate call of the browser tool of row 9. dsh attaches no browser tool by default, so skip the step when the user attached none. |
| take a page snapshot | Use the snapshot call of the same browser tool. Skip the step when the user attached no browser tool. |
| send a message to an agent | Use the `send_message` tool with `agent_id` and `message`. It reaches a direct continuable child by its id. A working child receives the message at its next step. An idle child starts a new turn with it. The result is a delivery confirmation, not the answer of the child. |

## Notes

- dsh does not substitute `$ARGUMENTS`. Read the text after `/<name>` in the same user message instead.
- A shared file under `.beast-mode/` may name `$ARGUMENTS`. Apply the row of this table there too.
- The Beast Mode shared files live in `.beast-mode/`. Never write a harness path into them.
- A command skill stays one folder deep, at `.agents/skills/<name>/SKILL.md`. dsh does not discover a nested skill.
- dsh watches a skill root at depth 1. A new skill folder appears with no restart.
- The `skill` tool result states a base directory. Resolve a relative path against that directory.
- Read the `<name>` agent file at `.agents/skills/<name>.md` first. Put its full body before the task in the prompt.
- The `subagent` tool always starts the agent in the background and returns at once. It has no blocking option. The result arrives as a new message when the agent finishes. End the turn and wait for that message. Never wait with `sleep` or `list_agents`, because one measured run spent 15.6M prompt tokens in 67 poll steps.
- The `subagent` call needs a `description` of three to five words, and it passes the prompt with no parent history.
- A child agent cannot call `ask_user_question`. A child reports an open question in its result instead.
- The `read` tool result carries line numbers, so a read after an edit is not needed.
- The model route rule covers one case with a route. The `subagent` tool shows a `provider` field and a `model` field, the agent name carries no `-advanced` suffix, and the agent body holds a line that starts with `**Model route:**` and names a provider and a model in backticks. Read the two values from that line, and pass them as `provider` and `model`. Leave that line out of the prompt you send to the child.
- The model route rule covers three cases with no route. The agent name ends with `-advanced`, or the agent body holds no route line, or the `subagent` tool shows no `provider` field. Pass no `provider` and no `model`. The child then runs on the parent model. Report no error.
- The model route rule covers one failed call. The `subagent` call reports that the route is not allowed for this session, or that child model selection is disabled. Call it again with no `provider` and no `model`, and tell the user to start a new dsh session.
- dsh samples the `subagent-model-selection` setting when a fresh top-level session starts, and it gives the routes to each child. A later settings edit does not change a running session, so the user starts a new dsh session after a change.
- A user who attaches Playwright MCP with `serverName: playwright` gets two tools: `mcp__playwright__browser_evaluate` and `mcp__playwright__browser_snapshot`.
- dsh finds the project root at the nearest ancestor that holds `.git`.
- dsh reads `AGENTS.md` and `CLAUDE.md` from the project root down to the current directory. It removes byte-identical duplicates.
- The Beast Mode CLI runs as `node <plugin root>/installer/bin/beast-mode.js`. Use that form when the shell does not find the name `beast-mode`. The `install-beast-mode` skill of this bundle names the absolute plugin root in its own body.
