# Harness-Neutral Source - The Layout Contract

**This file is the single source of truth for the Beast Mode source layout.** It states the directories, the frontmatter keys, the seventeen neutral terms, the canonical `## Harness` block, and the glossary file format. `installer-cli` reads this contract and renders the source into a harness layout. A harness author reads this contract and writes one new glossary. No command file restates a rule from here.

---

## 1. Purpose

Beast Mode holds one copy of each command, agent, and reference file. That copy names no harness tool and no harness path. It writes a neutral term instead. A per-harness glossary at `.beast-mode/harness.md` maps each term to a real tool of the running harness. A new harness therefore costs one glossary file, not 31 command edits. A Claude Code install stays a plain file copy, so the symlink dogfooding in this repo keeps working.

---

## 2. The source layout in this repo

```
beast-mode/
├── .claude-plugin/plugin.json          # plugin manifest, "commands": "./commands"
├── commands/                           # Claude Code plugin commands, harness-owned
│   ├── install-beast-mode.md, upgrade-beast-mode.md, install-statusline.md
│   └── connect-discord.md, setup-*.md, integrate-web-app.md
├── templates/
│   ├── skills/                         # 31 command skills, the canonical command source
│   │   ├── plan-feature/SKILL.md
│   │   ├── start-feature/SKILL.md
│   │   └── ...                         # one folder per command, folder name = skill name
│   ├── agents/
│   │   ├── solution-architect.md       # shipped agent, flat file
│   │   └── feature-orchestrator.md     # shipped agent, flat file
│   ├── dev-docs/                       # feature doc templates
│   ├── formats/                        # shared reference files
│   └── harness/                        # one glossary per harness
│       ├── claude.md
│       └── dsh.md
├── dev/agents/                         # repo-only agents, never shipped
├── installer/                          # the renderer: reads this contract, writes a harness layout
│   ├── adapters/<id>.js                # one file per harness, id = templates/harness/<id>.md basename
│   └── ...                             # bin/, lib/, test/ — see CLAUDE.md
├── dsh/                                # the dsh bundle: patch, provider, and the two dsh-owned skills
├── package.json                        # root npm package, declares the dsh bundle patch
├── scripts/
│   ├── migrate-v4-to-v5.sh             # old install layout -> new install layout
│   └── dev-link.sh                     # rebuilds this repo's dogfood symlinks
└── docs/harness-neutral-source.md      # this file
```

`templates/slash-commands/` is the version 4 shape. Version 5.0.0 replaces it with `templates/skills/`.

---

## 3. The installed layout in a consumer project

```
<project>/
├── .beast-mode/                        # SHARED. every harness reads this.
│   ├── harness.md                      # composed from templates/harness/<harness-id>.md
│   ├── version.json                    # the shared version marker, core-owned, no manifest entry
│   ├── epic-resolution.md              # from templates/formats/, one file per reference
│   ├── agent-structure-example.md, skill-structure-example.md
│   ├── mission-statement-template.md, technical-design-template.md
│   ├── tool-rules.md, phase-handoff.md, interview.md
│   └── templates/                      # from templates/dev-docs/
│       └── implementation.md, context.md, tasks.md, epic-overview.md, epic-requirements.md, human-testing.md, inbox.md
├── .claude/                            # HARNESS-OWNED. Claude Code only.
│   ├── skills/<name>/SKILL.md          # the 31 command skills
│   ├── agents/*.md                     # the shipped agents plus project agents
│   └── .beast-mode-version
└── docs/features/                      # the workflow output, unchanged
```

Five rules follow from this split.

1. `.beast-mode/` holds the files that every harness reads. A command never writes a harness path into a shared file.
2. `.claude/` holds the rendered files of one harness. Only `install-beast-mode`, `upgrade-beast-mode`, and `install-statusline` name it.
3. `.beast-mode/` belongs in version control. A consumer project commits it. Only the backup directories and `.beast-mode/briefs/` stay ignored, because both hold derived data.
4. `.beast-mode/version.json` owns the installed harness list and the root of each harness. `<harnessRoot>/.beast-mode-version` keeps its current path, and it alone owns the version of one harness.
5. `.beast-mode/version.json` holds no manifest entry, the same way `.beast-mode/harness.md` holds none. A run rebuilds a version marker it cannot read from the per-harness manifests, so a broken marker never blocks an install.

---

## 4. The command skill format

Each command is one file at `templates/skills/<name>/SKILL.md`. The body carries the whole command, because a slash command loads in full when the user runs it. Progressive disclosure applies to the skills that `/document-feature` writes in a user project. It does not apply to a command skill.

```yaml
---
name: plan-feature
description: "Plan a new feature by gathering requirements and creating an implementation plan. Usage: /plan-feature <feature-name> [initial requirements]"
argument-hint: "<feature-name> [initial requirements]"
user-invocable: true
---
```

Five rules.

1. `name` equals the folder name. Both are kebab-case and match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
2. `description` keeps the shipped text, including the `Usage:` sentence.
3. `argument-hint` appears only when the command takes arguments. Its value is the argument part of the `Usage:` sentence.
4. `user-invocable: true` with no `disable-model-invocation` key lets both the user and the model run the command. Beast Mode commands run other commands, so the model needs invocation access too.
5. `$ARGUMENTS` stays in the body as the one token. The glossary states what the running harness does with it.

---

## 5. The agent format

Each agent is a flat markdown file. `templates/agents/<name>.md` holds a shipped agent. `dev/agents/<name>.md` holds a repo-only agent.

```yaml
---
name: solution-architect
description: Creates technical implementation plans from requirements. Use when starting a new feature or need architectural guidance.
tools: Read, Glob, Grep, Write, WebSearch
model: opus
effort: high
color: white
---
```

Four rules.

1. Keep the file flat. A harness that reads only skills reads a flat `<name>.md` at the top level of a skill root.
2. Keep the frontmatter superset above. A harness ignores a key that it does not know.
3. Apply the neutral vocabulary to the body prose only. The `tools:` line keeps the Claude tool names, because it is metadata.
4. Write no `disable-model-invocation` key. A parent agent loads an agent body to build a delegate prompt.

---

## 6. The neutral vocabulary

### 6.1 The seventeen terms

The vocabulary is a closed list, in the canonical order below. A command writes the term. The glossary maps the term to a tool. Every glossary lists these seventeen terms in this order. No file invents an eighteenth term.

The list holds two groups. Terms 1 to 10 and term 17 are the workflow terms. Each one names a step of the Beast Mode workflow, for example a question to the user or a delegation to an agent. Terms 11 to 16 are the tool terms. Each one names one tool call against a file, a shell, or a browser page. `templates/formats/tool-rules.md` writes its seven rules with the tool terms, and a command body uses a tool term the same way it uses a workflow term. Term 17 comes last, so terms 1 to 16 keep their numbers.

1. **ask the user to choose** - Show the user a short list of named options and wait for the answer.
2. **delegate to the `<name>` agent** - Run a subagent whose prompt starts with the body of the `<name>` agent file.
3. **run the `/<name>` command** - Run another Beast Mode command by name and follow it to the end.
4. **load the `<name>` skill** - Read a named skill into the current context and apply it.
5. **search the web** - Query the public web for current information.
6. **the harness skills directory** - The directory where the running harness discovers skills.
7. **the harness agents directory** - The directory where the running harness discovers agent files.
8. **the project instruction file** - The markdown file that the harness loads for the project rules.
9. **the browser automation tool** - The tool that drives a real browser for a user interface check.
10. **the arguments token `$ARGUMENTS`** - The text that the user typed after the command name.
11. **edit a file** - Change part of a file that exists.
12. **write a file** - Create a file, or replace a whole file.
13. **read a file range** - Read a named line range of one file.
14. **run a shell command** - Run one shell command, and read its output.
15. **evaluate in the browser** - Run one expression in the page, and return a small value.
16. **take a page snapshot** - Capture the accessibility tree or the page structure.
17. **send a message to an agent** - Pass a short text to an agent that still runs, by the id that its delegation returned.

### 6.2 The canonical Harness block

Every command carries the block below, directly above its `## Epic awareness` block. The text is identical in all 31 files. Copy it with no per-command change.

```markdown
## Harness

This command runs on any agent harness. Read `.beast-mode/harness.md` first.
It maps the neutral terms in this command to the tools of this harness.
Terms include: ask the user to choose, delegate to an agent, search the web,
and the harness skills directory. Use the mapped tool. Do not use a tool name
from another harness.
```

This file holds the canonical text of the block. A glossary does not hold it, because a glossary is per-harness and the block is not. The `## Epic awareness` block differs on one point. The model re-reads `epic-resolution.md` at run time, and the model never re-reads the block text at run time.

---

## 7. The glossary file format

`templates/harness/<harness-id>.md` holds one glossary per harness. `installer-cli` validates the shape below, then composes `.beast-mode/harness.md` from the glossary of every harness this project holds.

**The one-harness base case.** With one harness installed, `.beast-mode/harness.md` equals `templates/harness/<harness-id>.md` byte for byte. No preamble. No marker comment. This rule keeps an upgrade of a one-harness project quiet.

**The composed format, two or more harnesses.** The composed file holds a preamble, then one section per harness, in adapter id sort order. Seven rules govern it.

1. One harness produces the source bytes and nothing else.
2. Two or more harnesses produce the preamble first, then one section per harness, sorted by adapter id.
3. A section starts with the line `<!-- beast-mode:harness <adapter-id> -->`, then one blank line, then the source glossary text.
4. A section text ends with exactly one newline. One blank line separates a section from the next marker line.
5. The preamble names each harness as `<adapter-id> (<harnessRoot>/)`, from `.beast-mode/version.json`.
6. A section carries the `**Harness:**` line, the `## Term map` table, and the `## Notes` section of its source, unchanged.
7. `parse(compose(sections))` returns the same section texts. The conformance test asserts this round trip.

The shape below is the contract that `installer-cli` checks against each source file before it composes anything.

```markdown
# Harness Glossary - Claude Code

**Harness:** claude-code
**Targets:** Claude Code 2.1.267 and later
**Last Updated:** 2026-09-10 05:05

## Term map

| Neutral term | This harness |
| --- | --- |
| ask the user to choose | Use the `AskUserQuestion` tool. |
| ...                    | one row per term of section 6.1, in the canonical order |

## Notes

- One bullet per fact that does not fit a table row.
```

Five contract rules.

1. The file starts with one H1 title.
2. The file carries a `**Harness:**` line with a kebab-case harness id.
3. The file carries a `## Term map` table with the columns `Neutral term` and `This harness`.
4. The left column holds every term of section 6.1, in the canonical order, with no extra row.
5. A `## Notes` section holds anything that does not fit a row.

Write one imperative sentence in each right-hand cell, for example "Use the `AskUserQuestion` tool." Name the real tool or the real path of that harness. Split a cell into two short sentences when one sentence runs past 20 words. Mark an unfinished glossary with a `**Status:** Draft` line under the `**Targets:**` line.

---

## 8. What installer-cli reads

`installer-cli` reads four source directories under the plugin root. It reads `templates/harness/` as well, for the glossary of the target harness.

| Source directory | Content | Destination |
| --- | --- | --- |
| `templates/skills/` | one command skill per folder | the harness skills directory |
| `templates/agents/` | one shipped agent per file | the harness agents directory |
| `templates/dev-docs/` | the feature doc templates | `.beast-mode/templates/` |
| `templates/formats/` | the shared reference files | `.beast-mode/` |
| `templates/harness/` | one glossary per harness | `.beast-mode/harness.md` |

The installer writes one output root per harness, plus one shared output root.

1. The harness root holds the rendered skills and agents. Claude Code takes `.claude/`. The adapter of the harness names its own root.
2. The shared root is always `.beast-mode/`. The installer creates it once per project. Every harness install reads the same shared root.
3. The installer copies a skill folder whole. It renames no file inside the folder. The core reads `.beast-mode/version.json`, composes the glossary of every harness it names per section 7, and writes the result as `.beast-mode/harness.md`.
4. `installer-cli` owns the render step, the adapters, and the manifests. This contract owns the input shape only.
5. The CLI writes one manifest per harness inside the harness root, at `<harnessRoot>/.beast-mode-manifest.json`. The manifest lists every source-backed file the CLI wrote, with a sha256. Three files carry no manifest entry, because the core synthesizes them rather than copying a source file: the version marker at `<harnessRoot>/.beast-mode-version`, `.beast-mode/harness.md`, and `.beast-mode/version.json`.
6. A harness adapter lives at `installer/adapters/<id>.js`, where `<id>` is the basename of `templates/harness/<id>.md`. It implements `destination`, `mapFrontmatter`, `renderBody`, `extraFiles`, and `check`.
7. The Claude adapter renders into `.claude/`. The dsh adapter renders into `.agents/`. A dsh agent renders as a flat skill, `.agents/skills/<name>.md`, with `user-invocable: false`.

---

## 9. Rules for command authors

1. Write only the seventeen terms of section 6.1. Do not invent a term.
2. Name no harness tool in a command body. The glossary names the tool.
3. Name no `.claude/` path in a command body. Write `.beast-mode/<file>` for a shared file, and write the term of section 6.1 for a harness path.
4. Keep a command skill one folder deep, at `templates/skills/<name>/SKILL.md`. dsh does not discover a nested skill.
5. Paste the Harness block of section 6.2 above the `## Epic awareness` block. Change no word.
6. Keep `$ARGUMENTS` as the one token. Add no second token.
7. Write `Agent:` in an example transcript. Do not name a harness product there.
8. Keep the `━━━` banner blocks, the emoji status markers, and the section order of the command.
9. The file tool names `Read`, `Write`, `Edit`, `Glob`, `Grep`, and `Bash` are portable and stay as they are.
