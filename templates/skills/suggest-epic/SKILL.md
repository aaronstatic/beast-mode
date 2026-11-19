---
name: suggest-epic
description: "Suggest the next epic to develop based on project state, mission statement, and technical design. Usage: /suggest-epic"
user-invocable: true
---

You have been asked to suggest what epic should be developed next. An epic is a group of related features that together deliver one coherent part of the system.

## Harness

This command runs on any agent harness. Read `.beast-mode/harness.md` first.
It maps the neutral terms in this command to the tools of this harness.
Terms include: ask the user to choose, delegate to an agent, search the web,
and the harness skills directory. Use the mapped tool. Do not use a tool name
from another harness.

## Epic awareness

This command is epic-aware. It takes no feature argument, but when surveying the project it must understand epics: read `.beast-mode/epic-resolution.md` for the rules, and detect epics by `epic-overview.md`.
When reading existing features, treat each **epic** as a unit — an epic directory has no `implementation.md` of its own, so read its `epic-overview.md` (purpose, Features table, build order, status) and descend into its child feature subfolders. A suggestion is always a **new top-level epic**. It never names a feature inside an existing epic, and it never nests an epic inside an epic.
If no epics exist in `docs/features/`, the survey reads plain features only, and the suggestions stay new top-level epics.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. This command's body is the suggest-epic workflow; it does **not** re-specify those rules.

## Process

### 1. Gather Project Context

Read the following to understand the current state of the project:

- `docs/overview.md` — master overview with feature status table, integration points, and changelog (if exists — this is the best starting point as it tracks all features and epics and their progress)
- The project instruction file (`CLAUDE.md`, or `AGENTS.md` when present) — project overview, architecture, development phases
- `docs/mission-statement.md` — product vision and goals (if exists)
- `docs/technical-design.md` — comprehensive technical specification (if exists)
- All existing feature docs in `docs/features/*/implementation.md` — what has been planned or built so far. **For epics** (a `docs/features/<dir>/` containing `epic-overview.md`), read its `epic-overview.md` instead (it rolls up the epic's features and status) and descend into the child feature subfolders' `implementation.md`.
- Scan the main source directories to see what code actually exists (not just planned)

If `docs/overview.md` exists, use it as your primary source for feature and epic status — it aggregates all progress in one place. Fall back to reading individual feature docs for details not captured in the overview.

If `docs/mission-statement.md` or `docs/technical-design.md` do not exist, rely on the project instruction file (`CLAUDE.md`, or `AGENTS.md` when present) and the codebase itself. You can still make useful suggestions without these files, but note their absence and suggest the user create them for better results.

### 2. Determine Current Phase

From the project instruction file (`CLAUDE.md`, or `AGENTS.md` when present) and/or `docs/technical-design.md`, identify if the project defines development phases or milestones.

- If phases are defined, determine which phase the project is currently in by cross-referencing with existing features, epics, and actual code
- If no phases are defined, assess project maturity by examining what exists: early (core infrastructure), mid (key features being built), or late (polish/optimization)

Cross-reference feature docs with actual code to determine what is truly complete vs. only planned.

### 3. Identify Candidates

Based on the current phase, what has been built, and any dependency chains from the technical design, identify the next logical epics. An epic candidate is a part of the system that needs **two or more features** to deliver. A need that one feature covers is not an epic — leave it to `/suggest-feature`. Consider:

- **Dependencies:** What must exist before other parts of the system can be built?
- **Cohesion:** Prefer a set of features that share one purpose, one area of the code, and one user outcome over a loose bundle
- **Phase boundaries:** Stay within the current phase unless it is complete
- **Technical design guidance:** Follow the architecture and system dependencies described in the tech design doc (if available)
- **Mission alignment:** Prioritize epics that advance the core product vision
- **Existing epics:** An area that an existing epic already owns is not a candidate. A new feature in that area belongs to `/suggest-feature`, which may place it inside the epic

### 3b. When the Path Isn't Clear: Offer Deep Research

Usually the next epics follow naturally from the phase, dependencies, and mission. But sometimes there's **no clear path** — the project is between phases, the mission is broad, or deciding what's next genuinely depends on **external context** like what competitors ship, current industry standards, or emerging best practices.

When that's the case, **ask the user before researching** — don't do it silently:

```
I don't have a strong next-epic signal from the project state alone — choosing well here
depends on outside context (e.g. what comparable products offer, current standards for <X>).
Do you want me to use deep research to look this up? It's slower and uses more tokens but
gives better-grounded suggestions.

  • Yes, run deep research
  • No, suggest based on what we have
```

If the user says yes, run the **`/deep-research`** command when the harness has it, with a focused question (competitor landscape, industry standards, etc.), then fold the verified findings into your candidate list in Step 4. When the harness has no such command, search the web instead. If no, proceed with project-state-based suggestions as normal.

Skip this step entirely when the next steps are already clear from the project.

### 4. Present Suggestions

Present **2-4 epic suggestions** using this format:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SUGGESTED NEXT EPICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current Phase: [Phase name or maturity assessment]
Completed: [Brief list of what exists, epics as one item each]

1. **epic-name** — One-sentence description of what it delivers.
   Features: feature-a, feature-b, feature-c

2. **epic-name** — One-sentence description of what it delivers.
   Features: feature-a, feature-b

3. **epic-name** — One-sentence description of what it delivers.
   Features: feature-a, feature-b, feature-c, feature-d

Recommended: #N — [Brief reason why this should come first]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Keep each suggestion to **two lines** — a kebab-case name with a short description, then the kebab-case names of two to five likely child features. No implementation details, no technical breakdown. The point is to help the user decide direction, not to pre-plan the epic. The feature list is a first draft. `/plan-epic` settles the final set and the build order.

If there is a clear dependency order (A must come before B), say so briefly.

### 5. Offer Next Steps

After presenting suggestions, **ask the user to choose**:

- Each suggestion as an option
- Options should include the epic name as the label and description as the description

Based on the user's choice:

**If the user picks an epic:**
1. Create the epic directory — `docs/features/<epic-name>/`. Do **not** create `epic-overview.md`. That file is the epic marker, and `/plan-epic` writes it. Without it, the folder is not yet an epic, so no command treats it as one before the plan exists.
2. Write `epic-requirements.md` in that directory, following `.beast-mode/templates/epic-requirements.md`, with a concise requirements summary:

```markdown
# <Epic Name> - Epic Requirements

**Created:** [Today's date]
**Phase:** [Current development phase]

## Overview

[2-3 sentence description of what this epic delivers as a whole, which part of the system it owns, and why these features belong together]

## Requirements

- [Bullet list of concrete, epic-level requirements derived from the technical design and mission statement]
- [Keep it focused — what must this epic achieve as a whole, not how]

## Planned Features

1. **[feature-name]** — [One-line description] — [Why it comes first / what it unblocks]
2. **[feature-name]** — [One-line description] — [What it depends on from #1]
3. **[feature-name]** — [One-line description] — [Ordering / dependency rationale]

## Dependencies

- [Epics, features, or systems that must exist first]

## Out of Scope

- [Things explicitly NOT included in this epic to keep scope tight]
```

Do not create a subfolder or a `requirements.md` for any child feature. `/plan-epic` creates them.

3. Tell the user they can now run `/plan-epic <epic-name>` to scope the feature set and scaffold the epic, and that the `epic-requirements.md` will provide context to the planning process.

**If the user wants more detail on a suggestion:**
- Give a brief (3-5 sentence) expansion of what the epic covers and how the features split, still without a full plan
- Then ask again if they want to proceed

## Important Notes

- **DO NOT** create `epic-overview.md`, feature subfolders, or implementation plans — that is `/plan-epic`'s job
- **DO NOT** write lengthy descriptions — keep suggestions concise
- **DO NOT** suggest an epic that one feature covers — point the user to `/suggest-feature` instead
- **DO** read actual code, not just feature docs, to understand true project state
- **DO** follow the dependency chain from the technical design (if available)
- **DO** stay within the current development phase unless it is complete
- **DO** treat each existing epic as one unit when you survey the project
