# Beast Mode — Existing Project Quick Start

A step-by-step guide to adding Beast Mode to a project that already has code. Covers discovering existing features, daily development, planning new features, and keeping everything organized.

*For Beast Mode v3.1+*

---

## Table of Contents

1. [What Beast Mode Does](#1-what-beast-mode-does)
2. [How Your Project Is Organized](#2-how-your-project-is-organized)
3. [Getting Started: Discovering Your Existing Code](#3-getting-started-discovering-your-existing-code)
4. [Your Daily Workflow](#4-your-daily-workflow)
5. [Planning & Building New Features](#5-planning--building-new-features)
6. [Keeping the Big Picture Updated](#6-keeping-the-big-picture-updated)
7. [Quality & Review Commands](#7-quality--review-commands)
8. [Bug Tracking & Fixes](#8-bug-tracking--fixes)
9. [Quick Command Reference](#9-quick-command-reference)
10. [Tips & Best Practices](#10-tips--best-practices)

---

## Installing Beast Mode

```
/plugin marketplace add aaronstatic/beast-mode
/plugin install beast-mode@aaronstatic
```

Then, in any project:

```
/install-beast-mode
```

Questions? Join the community: https://discord.gg/aWa6kasxYC

---

## 1. What Beast Mode Does

Beast Mode gives Claude Code a structured workflow for managing features in your project. Instead of Claude losing context between conversations, Beast Mode keeps track of:

- **What each feature does** — architecture, files, decisions
- **What work has been done** — task checklists with progress
- **What to do next** — clear next steps so you can pick up where you left off
- **The big picture** — a master overview of all features and how they connect

Everything is stored as simple Markdown files in your project's `docs/` folder. You control the workflow through **slash commands** — short commands you type in Claude Code that start with `/`.

> **How Slash Commands Work**
>
> When you type something like `/discover-feature user-auth` in Claude Code, it tells Claude to follow a specific workflow. Claude reads files, asks you questions, creates documentation, and guides you through each step.

---

## 2. How Your Project Is Organized

After running `/install-beast-mode`, your project has these new folders:

```
your-project/
  .claude/
    commands/          # Slash commands (the workflows)
    skills/            # Knowledge base for your tech stack
    agents/            # Specialized AI agents for tasks
  docs/
    features/          # One folder per feature (the important part!)
      feature-name/
        implementation.md   # The plan: what to build & how
        context.md          # Decisions, key files, current state
        tasks.md            # Task checklist with progress %
    overview.md        # Master overview of ALL features
    templates/         # Doc templates
```

The `docs/features/` folder is where the magic happens. Each feature gets three files that track everything about it.

| File | What It Contains |
|------|-----------------|
| `implementation.md` | The implementation plan — goals, architecture, phases, technical decisions. This is the single source of truth for *what* was built and *why*. |
| `context.md` | Living document — current status, key files, important decisions made during development, gotchas, and what to work on next. |
| `tasks.md` | Task checklist organized by phase. Shows completion percentage and tracks what's done, in progress, and remaining. |

---

## 3. Getting Started: Discovering Your Existing Code

Since you already have a project with existing features, the first thing to do is **document what already exists**. This is what `/discover-feature` is for.

### What /discover-feature Does

It looks at your existing code, understands how a feature works, and creates documentation for it — as if the feature had been planned with Beast Mode from the start. It **does not change any code**, it only creates docs.

### Step-by-Step: Discovering Your First Feature

**Step 1: Think about the main parts of your app**

Break your app into logical features. For example, a web app might have: `user-auth`, `dashboard`, `notifications`, `settings`, `payments`, etc. Use short, kebab-case names (lowercase with dashes).

**Step 2: Run the discover command**

```
/discover-feature user-auth
```

Replace `user-auth` with your actual feature name.

**Step 3: Answer Claude's questions**

Claude will ask you:

- **Where is the code?** — Give file paths or directory names (e.g. `src/components/Auth/`)
- **What does it do?** — Describe it in your own words
- **How is it used?** — The user workflow
- **Any known issues?** — Bugs, tech debt, things you want to improve

You can be as brief or detailed as you like. Claude investigates the code to fill in gaps.

**Step 4: Review the results**

Claude will show you what it found and create the three documentation files. It will also identify any reusable patterns and potential improvements.

**Step 5: Choose what to do next**

Claude will ask if you want to:

- **Start working on improvements** — jump right into enhancing the feature
- **Just document for now** — keep the docs as reference, move on
- **Request adjustments** — fix anything Claude got wrong

> **Tip: Document Everything First**
>
> Choose "Just document for now" for each feature until you've discovered all the major parts of your app. This gives Claude a complete picture of your codebase before you start making changes. You can always come back to improve things later.

### Discovering All Your Features

Repeat the process for each major part of your app:

```
/discover-feature user-auth
/discover-feature dashboard
/discover-feature notifications
/discover-feature settings
/discover-feature payments
```

After discovering all features, run `/update-master` to create the master overview (more on this in Section 6).

---

## 4. Your Daily Workflow

Once your features are documented, here's how a typical day looks:

```
/continue-feature  -->  /proceed  -->  Work, work, work...  -->  /update-feature
Start your session      Build things                              Save your progress
```

### Starting Your Session: /continue-feature

When you sit down to work, tell Claude which feature you're working on:

```
/continue-feature dashboard
```

Claude reads all the feature docs and gives you a status summary:

- What phase you're in
- What's already been done
- What's next on the task list
- Any blockers or important decisions

If you don't remember what features exist, just type `/continue-feature` with no name and Claude will list them for you.

### Doing the Work: /proceed

Once you've loaded a feature with `/continue-feature`, type:

```
/proceed
```

Claude looks at the task list, picks up the next task, and uses specialized agents to implement it. It works through tasks one phase at a time. If a task involves UI changes, Claude will pause and ask you to test before moving on.

You can keep typing `/proceed` to continue through the task list, or tell Claude specifically what you want to work on.

### Saving Your Progress: /update-feature

> **Always Run This Before Ending a Session**
>
> Claude Code conversations have a limited context window. When the conversation gets long, Claude may need to "compact" (summarize) older messages. Before this happens, run `/update-feature` to save everything to the docs.

```
/update-feature dashboard
```

This updates all three feature files with:

- Tasks marked as complete
- New decisions documented
- Progress percentage updated
- Clear "next steps" for your next session

After running this, you can safely start a new conversation. Next time, `/continue-feature dashboard` picks up right where you left off.

---

## 5. Planning & Building New Features

When you want to add something new to your app, Beast Mode has a structured flow:

```
/suggest-feature  -->  /plan-feature  -->  /start-feature  -->  /proceed
Get ideas              Create a plan       Set up docs          Build it
```

### Step 1: Get Suggestions (Optional)

If you're not sure what to work on next:

```
/suggest-feature
```

Claude looks at your project's current state, what features exist, and suggests 2-4 features that would make sense to build next. It considers dependencies (what needs to exist first) and what delivers the most value.

### Step 2: Plan the Feature

```
/plan-feature dark-mode
```

Or with a description:

```
/plan-feature dark-mode Add a dark/light theme toggle to the app
```

Claude will:

1. Ask you clarifying questions about what you want
2. Propose 2-3 different approaches with trade-offs
3. Create a detailed implementation plan after you pick an approach
4. Ask you to review and approve the plan

The plan gets saved to `docs/features/dark-mode/implementation.md`.

### Step 3: Start the Feature

Once you approve the plan, Claude runs:

```
/start-feature dark-mode
```

This creates the `context.md` and `tasks.md` files with a detailed task breakdown. The feature status changes to "In Progress".

### Step 4: Build It

Now use the daily workflow:

- `/proceed` to work through tasks
- `/update-feature dark-mode` to save progress
- `/continue-feature dark-mode` to resume in new sessions

---

## 6. Keeping the Big Picture Updated

### /update-master

The master overview (`docs/overview.md`) tracks all your features in one place — their status, progress, and how they connect to each other.

```
/update-master
```

Run this after you've made significant progress on features. Claude will:

- Scan all feature docs for recent changes
- Update the feature status table
- Note cross-feature connections
- Add a changelog entry

You can also update for a specific feature:

```
/update-master dashboard
```

> **When to Run /update-master**
>
> Run it after completing a feature, finishing a major milestone, or after discovering all your existing features. You don't need to run it every session — just when the big picture has meaningfully changed.

---

## 7. Quality & Review Commands

These commands help you keep your code clean and well-organized. Use them when a feature is complete or when you want to improve existing code.

### /review-feature

```
/review-feature dashboard
```

Reviews a feature's code against best practices. Creates a detailed report with findings ranked by severity, plus a recommended fix order. After reviewing, use `/proceed` to implement fixes one by one.

### /audit-feature

```
/audit-feature dashboard
```

A higher-level review that looks at architecture, integration with other features, duplication, and developer experience. Great for finding cross-cutting improvements after you've built several features.

### /evaluate-feature

```
/evaluate-feature dashboard
```

Evaluates a feature against its Definition of Done acceptance criteria using an independent evaluator agent. Unlike `/review-feature` (which checks code quality), this checks whether the feature actually works as specified. Produces a structured report with PASS/FAIL verdicts per criterion.

### /document-feature

```
/document-feature dashboard
```

Extracts reusable patterns from a completed feature and adds them to the project's skill system (`.claude/skills/`). This builds a knowledge base so future features benefit from lessons learned. Run this after completing a feature.

---

## 8. Bug Tracking & Fixes

Beast Mode includes a built-in bug tracking system stored as Markdown files in `docs/bugs/`.

### /fix-bug

```
/fix-bug BUG-001
```

Fix a specific bug by ID. Claude loads the bug details, any linked feature context, implements the fix, and asks you to verify before closing the bug.

### /fix-feature

```
/fix-feature dashboard
```

Fix all open bugs linked to a feature. Claude groups bugs by priority (critical first), loads the feature context once, and works through each bug. After each group, you test and confirm which fixes are good.

Without a feature name, `/fix-feature` processes all open bugs across the project.

---

## 9. Quick Command Reference

| Command | When to Use | What It Does |
|---------|-------------|-------------|
| `/discover-feature <name>` | First time setup | Documents an existing feature by analyzing its code. Does not change code. |
| `/suggest-feature` | Need ideas | Suggests 2-4 features to build next based on project state. |
| `/plan-feature <name>` | New feature | Gathers requirements, proposes approaches, creates implementation plan. |
| `/start-feature <name>` | After plan approved | Creates context.md and tasks.md from the plan. Sets status to "In Progress". |
| `/continue-feature <name>` | Start of session | Loads feature context and shows status summary. Use at the start of each work session. |
| `/proceed` | During work | Picks up the next task and implements it using agents. |
| `/update-feature <name>` | End of session | Saves progress to docs. **Always run before ending a session.** |
| `/update-master` | After milestones | Updates the master overview with all feature progress. |
| `/review-feature <name>` | Quality check | Reviews code against best practices. Creates findings report. |
| `/audit-feature <name>` | Architecture review | Audits architecture, integration, and code quality. |
| `/evaluate-feature <name>` | Acceptance testing | Evaluates feature against Definition of Done criteria. |
| `/document-feature <name>` | Feature complete | Extracts reusable patterns into the skills system. |
| `/fix-bug <id>` | Bug fix | Fixes a specific bug by ID with feature context. |
| `/fix-feature [name]` | Batch bug fix | Fixes all open bugs for a feature (or all bugs). |
| `/create-epic <name>` | Group features | Creates a new epic to group related features together. |
| `/plan-epic <name>` | Plan epic | Plans all features inside an epic and sets the build order. |
| `/update-epic <name>` | Epic progress | Updates epic overview with current status across all child features. |
| `/review-epic <name>` | Epic review | Reviews all features in an epic for integration and completeness. |

---

## 10. Tips & Best Practices

### Getting Started Checklist

1. Run `/discover-feature` for each major part of your app
2. Choose "Just document for now" each time
3. Run `/update-master` to create the master overview
4. You're ready to start working on features!

### Context Window Management

Claude Code has a context window (like short-term memory). Long conversations fill it up. Beast Mode's docs are Claude's long-term memory.

- **Always** run `/update-feature` before ending a session or when the conversation is getting long
- **Always** run `/continue-feature` at the start of a new session
- This ensures nothing is lost between conversations

### Feature Naming

- Use **kebab-case**: `user-auth`, `payment-flow`, `dark-mode`
- Keep names short and descriptive
- Think of them as the "topic" of that part of your app

### When to Use What

| Situation | Command |
|-----------|---------|
| You have existing code that's not documented | `/discover-feature` |
| You want to build something new | `/plan-feature` |
| You're resuming work from yesterday | `/continue-feature` |
| You want Claude to keep building | `/proceed` |
| You're done for the day | `/update-feature` |
| A feature is done, you want it reviewed | `/review-feature` |
| You want to check a feature actually works | `/evaluate-feature` |
| You finished a big feature | `/document-feature` then `/update-master` |
| Not sure what to build next | `/suggest-feature` |
| You need to fix a bug | `/fix-bug` or `/fix-feature` |

> **Remember:** Beast Mode is just a workflow layer on top of Claude Code. All the docs it creates are plain Markdown files you can read and edit yourself at any time. You're always in control.

---

**Beast Mode** — Battle-tested Claude Code workflow system

Based on "Claude Code is a beast: Tips from 6 months of hardcore use"
