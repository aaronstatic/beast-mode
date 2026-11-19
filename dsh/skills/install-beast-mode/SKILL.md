---
name: install-beast-mode
description: "Install the Beast Mode workflow system in this project. Usage: /install-beast-mode"
user-invocable: true
---

# Install Beast Mode

You set up the Beast Mode workflow system in this project. Follow the nine steps in order.

When you copied this file by hand, replace `{{BEAST_MODE_ROOT}}` with the absolute path of the beast-mode package.

## Step 1: Show the welcome banner

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEAST MODE INSTALLATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
I set up the Beast Mode workflow system here.
You get a dev docs workflow, 31 command skills,
project dev agents, and a skills library.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 2: Detect the project stack

Read the project files and answer these five questions.

1. Which language and which framework does the project use? Read `package.json`, `requirements.txt`, `pyproject.toml`, or the equivalent manifest.
2. Which build tool, package manager, and test framework does the project use?
3. Does the project hold a monorepo marker, for example a workspace list or `lerna.json`?
4. Does the project hold source code beyond the config files? This answer decides Step 7.
5. Does the project hold a README file? A README carries context for Step 6.

Print the result.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Language:        [language]
Framework:       [framework]
Tooling:         [build tool] / [package manager] / [test framework]
Structure:       [Single repo / Monorepo / Backend / Frontend / Fullstack]
Project State:   [New (no source code) / Existing (has source code)]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 3: Confirm the detection

Call the `ask_user_question` tool with one question.

- Question: "Is this detection correct?" Header: "Detection".
- Option 1: "Yes, this is correct (Recommended)". Description: "Install with the stack above."
- Option 2: "No, I give the details". Description: "Correct the stack first."

Take the correction of the user, then continue.

## Step 4: Run the installer CLI

Run the two commands below with the `bash` tool.

```bash
node --version
node {{BEAST_MODE_ROOT}}/installer/bin/beast-mode.js install dsh
```

The installer needs Node.js 20 or later. When `node --version` fails, print this block and stop. Copy no file by hand.

```
❌ Beast Mode cannot install: Node.js is missing.
The installer runs on Node.js 20 or later. Install it
from https://nodejs.org, then run this command again.
```

Show the CLI output to the user. A successful run ends with the `✅ TEMPLATES INSTALLED!` banner and one line per installed group. Print that banner. The CLI states its own rules, so restate none of them.

When the CLI exits non-zero, it prints three lines: what failed, why it failed, and what to do next. Show the three lines, then take the action of the exit code.

| Exit | Meaning | Action |
| --- | --- | --- |
| 1 | Source invalid. A template failed validation | Show the file and the rule. Reinstall the package, then run `/install-beast-mode` again |
| 2 | Usage error, or a Node.js older than 20 | Show the fix line. A bad argument is a defect in this skill, so report it and stop |
| 3 | Unknown harness. The package ships no `dsh` adapter | Reinstall the package, then run `/install-beast-mode` again |
| 4 | Guard refusal. A Beast Mode path is a symlink, or the project is the Beast Mode repo | Show the paths and stop. Work around no guard |
| 5 | Manifest conflict. `.agents/.beast-mode-manifest.json` is unreadable | Ask the user to move that file aside, then run `/install-beast-mode` again |
| 6 | Write failure. A permission error, a full disk, or a directory in the place of a file | Show the path. Ask the user to fix it, then rerun the install |
| 7 | Install refused. The project already holds a manifest | Stop the install. Print the block below |

```
ℹ️  Beast Mode is already installed in this project.
Run /upgrade-beast-mode to move it to the current
package version. The upgrade keeps every file you
edited, and it backs up every file it replaces.
```

**The stale warning.** The CLI may print this after the install, naming a harness that falls behind:
```
⚠ 1 other harness in this project is behind the plugin version:
    claude (.claude/) holds v5.3.0. The plugin ships v5.4.0.
```
Show it. Name `beast-mode upgrade` with no harness as the fix for every harness.

## Step 5: Create the project dev agents

The install wrote the shipped agents, solution-architect and feature-orchestrator. Create the project dev agents now.

A dev agent is a flat skill file at `.agents/skills/<name>.md`. Give it a name that no command skill holds.

Start the file with a YAML frontmatter block. Write the three keys below between two fence lines of three hyphens. Add no fourth key, because dsh reads these three keys only.

```yaml
name: frontend-dev
description: Implements frontend features from an implementation plan. Load it before a task starts.
user-invocable: false
```

Create two tiers for each domain that Step 2 detected. The standard agent, for example `frontend-dev`, is the everyday workhorse. The advanced agent carries the same name plus the `-advanced` suffix. It takes a major refactor, an integration-heavy phase, or a high-risk phase. Create both tiers, because `/proceed` names the standard agent and `/proceed-advanced` names the advanced agent.

| Project type | Standard agent |
| --- | --- |
| React, Next.js, or another frontend | `frontend-dev` |
| Node.js, Express, NestJS, or another backend | `backend-dev` |
| Full stack or monorepo | `frontend-dev` and `backend-dev` |
| Python, machine learning, or AI | `ml-dev` |
| C#, Unity, or game development | `game-dev` |
| CLI or scripts | `dev` |
| Another stack | one name for the primary technology |

Write the same body in both tiers of one domain. Follow this pattern.

1. Role. "You are a senior <domain> developer. You implement features from a plan."
2. Process. Read the phase brief that the caller names. Read the project instruction file. Follow the plan. Update `tasks.md`.
3. Technology. Name the frameworks and the libraries that Step 2 found.
4. Quality and rules. Run the type check. Follow the project conventions. Update the dev docs. Ask a question when the plan is unclear. Name `.beast-mode/tool-rules.md` in the prompt.

Add three sentences to the advanced tier only. Trace every integration point before a change to shared code. Prefer a small verifiable step. Name every migration risk.

Show the user one line per created file, for example `.agents/skills/frontend-dev.md`.

**Model route (optional).** Call the `ask_user_question` tool with one question.

- Question: "Do I set a model route for a standard dev agent?" Header: "Model route".
- Option 1: "Skip (Recommended)". Description: "Every dev agent runs on the parent model."
- Option 2: "Yes, pick a route". Description: "Print the settings card steps, then name a provider and a model."

For Skip, write no `**Model route:**` line, and continue to Step 6.

For Yes, print this block.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODEL ROUTE FOR A DEV AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
dsh applies a route with the `subagent-model-selection`
setting on. Turn it on first.

1. Open the dsh settings UI.
2. Find the "Subagent Models" card.
3. Turn the setting on.
4. Add the provider and the model of each route you
   allow, then save the card.

Run `list_subagent_models` in a new dsh session to see
the allowed routes.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

For each standard dev agent that this step created, call the `ask_user_question` tool with one question.

- Question: "Which provider and which model does `<name>` take?" Header: "Model route".
- Option 1: "Skip this agent (Recommended)". Description: "This agent runs on the parent model."
- Option 2: "Name a route". Description: "Type the provider id and the exact model id of one route you saved in the card."

For Skip, write no line into that agent. For an answer that names a provider and a model, write this line into the body of that agent file, after the frontmatter.

```
**Model route:** provider `<provider>`, model `<model>`
```

Write a route line into no advanced agent, and into neither `solution-architect` nor `feature-orchestrator`. Tell the user to start a new dsh session, because dsh samples the setting when a fresh session starts.

## Step 6: Write the mission statement and the technical design

Read the two templates that the install wrote to the shared root.

- `.beast-mode/mission-statement-template.md`
- `.beast-mode/technical-design-template.md`

**When the project holds source code:** read the README, the project instruction file, and the package manifest. Read the directory tree, the key source files, and the git log. Then list what the code does not answer: the mission, the audience, the design principles, and the non-obvious decisions. Ask those open questions with the `ask_user_question` tool. Ask nothing that the code already answered.

**When the project holds no source code:** ask the user five questions with the `ask_user_question` tool. What does the project build? Who uses it? Which stack does it take? Which priorities rule? What must the project never become? Describe the planned architecture, because no code exists yet.

Write `docs/mission-statement.md` and `docs/technical-design.md` from the answers. Adapt each section to this project, and drop a section that does not apply. Write no boilerplate. Show the user a short summary, and ask for a review.

## Step 7: Discover the features, or plan the project setup

dsh watches the skill root one level deep, so the 31 new command skills need no restart.

**When the project holds source code:**

1. Call the `ask_user_question` tool: "Do I detect and document your existing features?" Option 1: "Yes, discover my features (Recommended)". Option 2: "No, I do it later".
2. For yes, read the code and list the features you found. Ask the user to confirm the list.
3. Load the `discover-feature` skill with the `skill` tool. Run it one time per confirmed feature, and state the feature name as the argument.
4. For no, tell the user to run `/discover-feature <feature-name>` at any later time.

**When the project holds no source code:**

1. Call the `ask_user_question` tool: "Do I plan the initial project setup?" Option 1: "Yes, plan the project setup (Recommended)". Option 2: "No, I start on my own".
2. For yes, load the `plan-feature` skill with the `skill` tool. State `project-setup` as the argument.
3. For no, name `/plan-feature <feature-name>` as the start of the first feature.

When the catalog lists no such skill yet, read `.agents/skills/<name>/SKILL.md` and follow it inline.

## Step 8: Show the summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEAST MODE INSTALLED!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What this install wrote:
  - 31 command skills, the solution-architect and
    feature-orchestrator agents, your dev agents, the
    version file, and the manifest (.agents/)
  - Feature doc templates, format references, and the
    harness glossary (.beast-mode/)
  - docs/features/, docs/mission-statement.md, and
    docs/technical-design.md

Commit .beast-mode/ with the project. Every harness reads it.

Start here:
  /plan-feature <name>            /discover-feature <name>
  /token-report
  /review-session

Group related features into an epic:
  /create-epic <name> <prompt>    /update-epic [name]
  /suggest-epic                   /plan-epic <name> [prompt]
  /review-epic <name>
  /autorun-epic <name>            build every feature to completion

Run a feature or an epic in Orca (needs the Orca CLI):
  /orca-setup                     /orca-feature <name>
  /orca-epic <name>

In a dsh profile that runs the web UI, a Beast Mode tab holds the dashboard.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 9: Offer the Orca setup

Run this step last, after the summary.

1. Run this command with the `bash` tool.

   ```bash
   node {{BEAST_MODE_ROOT}}/installer/bin/beast-mode.js orca detect
   ```

   It prints one JSON object. Read the `offer` key.
2. When `offer` is `"none"`, show nothing and end. The Orca CLI is absent, or `orca.json` already holds a valid `orchestration` object.
3. When `offer` is `"setup"`, call the `ask_user_question` tool with one question.
   - Question: "The Orca CLI is installed. Do I set up Orca orchestration now?" Header: "Orca setup".
   - Option 1: "Set it up now (Recommended)". Description: "Choose the agent for each stage and add custom steps."
   - Option 2: "Later". Description: "Run `/orca-setup` at any later time."
4. For now, load the `orca-setup` skill with the `skill` tool and follow it. dsh needs no restart. When the catalog lists no such skill yet, read `.agents/skills/orca-setup/SKILL.md` and follow it inline.
5. For later, name `/orca-setup` as the command to run.

## Rules

- Run the installer CLI one time. Copy no template file by hand.
- Put the recommended option first in every `ask_user_question` call. Add `(Recommended)` to its label.
- Report a CLI failure with the three lines that the CLI printed. Work around no guard.
- Keep every dev agent one level deep in `.agents/skills/`, because dsh finds no deeper file.
- Put shared project guidance in `AGENTS.md` at the project root. Add one line to `CLAUDE.md`: `@AGENTS.md`. dsh reads both files and drops a byte-identical duplicate, so the guidance stays in one place.
- Write no file outside this project. Never write `settings.yaml`.
