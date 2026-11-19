# Beast Mode — Several Harnesses on One Project

Beast Mode installs into the same project for more than one agent harness — Claude Code and DeepSeek Harness (dsh), for example. Each harness gets its own rendered tree. One shared directory, `.beast-mode/`, serves every harness that this project holds.

---

## The layout

```
<project>/
├── .beast-mode/
│   ├── version.json     # the shared version marker, every installed harness
│   └── harness.md        # the composed glossary, one section per harness
├── .claude/               # Claude Code only
│   └── skills/<name>/SKILL.md
└── .agents/                # dsh only
    └── skills/<name>/SKILL.md
```

A harness root holds the rendered skills and agents of one harness. `.beast-mode/` holds the files every harness reads. Commit `.beast-mode/` and every harness root with the project.

---

## The version marker

`.beast-mode/version.json` is the one record of the installed harness set. Beast Mode writes it after every real install and every real upgrade. It carries no manifest entry — a run rebuilds it from the per-harness manifests when it cannot read it.

```json
{
  "schema": 1,
  "beastModeVersion": "5.4.0",
  "generated": "2026-09-15T11:04:12.318Z",
  "harnesses": {
    "claude": { "harnessRoot": ".claude", "version": "5.4.0", "installed": "...", "updated": "..." },
    "dsh":    { "harnessRoot": ".agents", "version": "5.3.0", "installed": "...", "updated": "..." }
  }
}
```

The marker owns the harness list and each harness root. `<harnessRoot>/.beast-mode-version` still owns the version of that one harness — the marker only caches it. See `docs/harness-neutral-source.md` section 3 for the full contract.

---

## Remove a harness

Beast Mode ships no `beast-mode remove <harness>` command yet. To drop a harness from a project by hand:

1. Delete the harness root (`.claude/` or `.agents/`).
2. Delete that harness entry from `.beast-mode/version.json`.
3. Run `beast-mode upgrade` to recompose the glossary.

A deleted harness root leaves a stale entry in the marker until step 2. A stale marker entry keeps its section in the composed glossary until step 3.

---

## The composed glossary

`.beast-mode/harness.md` maps the seventeen neutral terms of every command to the real tools of each installed harness.

**One harness.** The file equals `templates/harness/<id>.md` byte for byte. No preamble.

**Two or more harnesses.** The file holds a preamble that names every harness, then one section per harness in adapter id sort order:

```markdown
# Harness Glossary - 2 harnesses

**Harnesses:** claude (.claude/), dsh (.agents/)

This project holds a Beast Mode install for more than one harness. One section below
belongs to each harness. Read the section of the harness that you run in. Ignore every
other section. To find your section, look at the directory that holds the skill that you
run now. Use only the tools of your own section.

<!-- beast-mode:harness claude -->

# Harness Glossary - Claude Code
...

<!-- beast-mode:harness dsh -->

# Harness Glossary - DeepSeek Harness
...
```

The full seven format rules live in `docs/harness-neutral-source.md` section 7.

---

## Upgrading every harness at once

```
beast-mode upgrade
```

With no harness argument, the CLI upgrades every harness the marker names, one after another, and prints one roll-up section:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 UPGRADE SUMMARY (ALL HARNESSES)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ claude (.claude): exit 0
✓ dsh (.agents): exit 0
```

A guard refusal or a broken manifest on one harness never stops the other. The batch exits with the highest per-harness exit code. Run `beast-mode upgrade <harness>` to upgrade one harness only.

---

## `beast-mode status`

```
beast-mode status
```

`status` reports the install state of a project and writes nothing:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 BEAST MODE STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Plugin version:  5.4.0
Project:         /home/me/app
Marker:          .beast-mode/version.json

Installed harnesses:
✓ claude   .claude    v5.4.0   up to date
⚠ dsh      .agents    v5.3.0   stale

⚠ 1 harness is behind the plugin version.
ℹ Run `beast-mode upgrade` to upgrade every installed harness.
```

A harness with no version file of its own prints `unknown`, with no `v` prefix, in the version column.

An `install <harness>` or an `upgrade <harness>` run prints the same stale warning on its own, naming the other harness that fell behind:

```
⚠ 1 other harness in this project is behind the plugin version:
    dsh (.agents/) holds v5.3.0. The plugin ships v5.4.0.
ℹ Run `beast-mode upgrade` to upgrade every installed harness in this project.
```

---

## Shared project guidance

Put shared project guidance in `AGENTS.md` at the project root. Add one line to `CLAUDE.md`:

```
@AGENTS.md
```

Claude Code expands that import. dsh reads both files and drops a byte-identical duplicate, so the guidance stays in one place and the second file stays one line long. Beast Mode writes neither file.

---

## The fixed agent models

`feature-orchestrator` carries `model: opus` and `effort: xhigh` in its frontmatter. The effort presets never change it. `installer/test/conformance.test.js` checks both keys in each render.

- **Claude Code** reads both keys. The orchestrator runs on Opus at the xhigh effort level.
- **dsh** keeps both keys in `.agents/skills/feature-orchestrator.md`, but it does not read them. A dsh agent runs on the model of the parent session, unless its body holds a `**Model route:**` line. The dsh install writes no route line into `feature-orchestrator` or `solution-architect`. So on dsh, the orchestrator runs on the parent model.

---

## The conformance procedure

Two harnesses run the same neutral command body. The conformance procedure proves both produce the same document structure.

**The static test**, `installer/test/conformance.test.js`, renders both harnesses with no project and asserts the skill set, the agent set, and the glossary shape match. It runs in every `node --test installer/test/*.test.js` pass.

**The live script**, `scripts/conformance-live.sh`, builds a two-harness fixture project, installs both harnesses, and prints the steps to run one small feature request on each harness by hand. A harness session needs a human, so the script drives no harness itself. Step A.4 restores `requirements.md` into the fixture after the Claude Code run, so the dsh run starts from the same file set.

**The diff script**, `scripts/conformance-diff.sh <runA> <runB>`, compares the two `docs/features/` outputs by structure:

| Compared | Rule |
| --- | --- |
| The file set | The relative path list must match exactly |
| The H1 and H2 headings | The heading text list of each file must match exactly |
| `implementation.md`, `context.md`, `tasks.md` | Both runs hold the required sections of the template |

The diff never compares body text. Model prose differs between two runs, and a prose diff would fail every time.
