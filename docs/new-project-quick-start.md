# Beast Mode — New Project Quick Start

A step-by-step guide to starting a brand new project with Beast Mode from day one. Covers initial setup, planning your first features, building with the workflow, and growing your project over time.

*For Beast Mode v3.1+*

---

## Table of Contents

1. [What Beast Mode Does](#1-what-beast-mode-does)
2. [Prerequisites](#2-prerequisites)
3. [Setting Up Your Project](#3-setting-up-your-project)
4. [Planning Your First Feature](#4-planning-your-first-feature)
5. [Building Your Feature](#5-building-your-feature)
6. [Your Daily Workflow](#6-your-daily-workflow)
7. [Growing Your Project](#7-growing-your-project)
8. [Quality & Review Commands](#8-quality--review-commands)
9. [Bug Tracking & Fixes](#9-bug-tracking--fixes)
10. [Quick Command Reference](#10-quick-command-reference)
11. [Tips & Best Practices](#11-tips--best-practices)

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
> When you type something like `/plan-feature user-auth` in Claude Code, it tells Claude to follow a specific workflow. Claude reads files, asks you questions, creates documentation, and guides you through each step.

---

## 2. Prerequisites

Before you begin, make sure you have:

- **Claude Code** installed and working
- **Beast Mode plugin** installed:
  ```
  /plugin marketplace add aaronstatic/beast-mode
  /plugin install beast-mode@aaronstatic
  ```

Questions? Join the community: https://discord.gg/aWa6kasxYC

---

## 3. Setting Up Your Project

### Step 1: Create Your Project Directory

Start with an empty directory (or a freshly scaffolded project):

```bash
mkdir my-project
cd my-project
git init
```

### Step 2: Install Beast Mode

Open Claude Code in your project directory and run:

```
/install-beast-mode
```

Claude will:

1. **Ask about your project** — What are you building? What tech stack? What's the scope?
2. **Set up the folder structure** — Creates `.claude/commands/`, `docs/features/`, agents, and templates
3. **Create dev agents** — Generates agents tailored to your tech stack (e.g. `frontend-dev`, `backend-dev`)
4. **Create project docs** — Generates `docs/mission-statement.md` and `docs/technical-design.md`

After installation, you're ready to start developing immediately.

### What You Should Have Now

```
my-project/
  .claude/
    commands/              # The slash commands
    agents/                # solution-architect + dev agents
    skills/                # Knowledge base (grows as you build)
    templates/             # Doc templates
  docs/
    features/              # One folder per feature
    templates/             # Doc templates
    mission-statement.md   # Project mission
    technical-design.md    # Technical design
  .gitignore               # Updated with Beast Mode entries
```

---

## 4. Planning Your First Feature

Now that your project is set up, it's time to build something.

### Option A: Get a Suggestion

If you're not sure where to start:

```
/suggest-feature
```

Claude looks at your project's mission statement, technical design, and current state, then suggests 2-4 features that make sense to build first. It considers dependencies and what delivers the most value early.

### Option B: Plan a Specific Feature

If you already know what you want to build:

```
/plan-feature user-auth
```

Or with a description to give Claude more context:

```
/plan-feature user-auth Email/password login with JWT tokens and refresh flow
```

### The Planning Process

Claude will:

1. **Ask clarifying questions** — scope, constraints, user expectations
2. **Propose 2-3 approaches** — each with trade-offs clearly explained
3. **Create an implementation plan** — after you pick an approach
4. **Define acceptance criteria** — a "Definition of Done" that can be evaluated later
5. **Ask for your approval** — nothing starts until you say go

The plan gets saved to `docs/features/user-auth/implementation.md`.

> **Take Your Time Planning**
>
> The planning phase is where you have the most leverage. A clear plan with good acceptance criteria means Claude can implement with confidence and you can verify the result with `/evaluate-feature`. Don't rush this step.

---

## 5. Building Your Feature

### Step 1: Start the Feature

Once you approve the plan:

```
/start-feature user-auth
```

This creates `context.md` and `tasks.md` with a detailed task breakdown organized by phase. The feature status changes to "In Progress".

### Step 2: Build with /proceed

```
/proceed
```

Claude looks at the task list, picks up the next task, and uses specialized agents to implement it. It works through tasks one phase at a time.

- For **backend tasks**, Claude writes code, creates files, and sets up infrastructure
- For **frontend tasks**, Claude builds components and asks you to test in the browser
- For **integration tasks**, Claude connects pieces together and verifies they work

Keep typing `/proceed` to continue through the task list. Claude will pause when it needs your input or when you should test something.

### Step 3: Save Progress

Before ending your session (or when the conversation is getting long):

```
/update-feature user-auth
```

This saves everything to the docs so your next session picks up right where you left off.

---

## 6. Your Daily Workflow

Once you have features set up, here's how a typical day looks:

```
/continue-feature  -->  /proceed  -->  Work, work, work...  -->  /update-feature
Start your session      Build things                              Save your progress
```

### Starting Your Session: /continue-feature

```
/continue-feature user-auth
```

Claude reads all the feature docs and gives you a status summary:

- What phase you're in
- What's already been done
- What's next on the task list
- Any blockers or important decisions

If you don't remember what features exist, just type `/continue-feature` with no name and Claude will list them for you.

### Doing the Work: /proceed

```
/proceed
```

Claude picks up the next task and implements it. You can also tell Claude specifically what you want to work on instead of following the task list.

### Saving Your Progress: /update-feature

> **Always Run This Before Ending a Session**
>
> Claude Code conversations have a limited context window. When the conversation gets long, Claude may need to "compact" (summarize) older messages. Before this happens, run `/update-feature` to save everything to the docs.

```
/update-feature user-auth
```

---

## 7. Growing Your Project

As your project grows, Beast Mode helps you manage multiple features and keep the big picture clear.

### Planning the Next Feature

After completing a feature (or while one is in progress), plan the next one:

```
/suggest-feature
```

Claude analyses your project state, existing features, and mission statement to suggest what to build next. Pick one, then:

```
/plan-feature <suggested-name>
```

### Keeping the Big Picture Updated

The master overview (`docs/overview.md`) tracks all your features in one place:

```
/update-master
```

Run this after completing a feature or finishing a major milestone. Claude scans all feature docs, updates the status table, notes cross-feature connections, and adds a changelog entry.

### Building a Knowledge Base

When a feature is complete, extract what you learned:

```
/document-feature user-auth
```

This creates skills in `.claude/skills/` with reusable patterns from your feature. Claude Code surfaces each skill automatically based on its `SKILL.md` `description`, so future features benefit from these patterns.

### Typical Feature Lifecycle

```
/suggest-feature          # What should I build next?
/plan-feature <name>      # Create the implementation plan
/start-feature <name>     # Set up docs, start building
/proceed                  # Implement tasks (repeat)
/update-feature <name>    # Save progress between sessions
/continue-feature <name>  # Resume in new sessions
/evaluate-feature <name>  # Verify it meets acceptance criteria
/review-feature <name>    # Check code quality
/document-feature <name>  # Extract reusable patterns
/update-master            # Update the big picture
```

---

## 8. Quality & Review Commands

Use these when a feature is complete or when you want to improve your code.

### /review-feature

```
/review-feature user-auth
```

Reviews a feature's code against best practices. Creates a detailed report with findings ranked by severity, plus a recommended fix order. After reviewing, use `/proceed` to implement fixes one by one.

### /audit-feature

```
/audit-feature user-auth
```

A higher-level review that looks at architecture, integration with other features, duplication, and developer experience. Great for finding cross-cutting improvements after you've built several features.

### /evaluate-feature

```
/evaluate-feature user-auth
```

Evaluates a feature against its Definition of Done acceptance criteria using an independent evaluator agent. Unlike `/review-feature` (which checks code quality), this checks whether the feature actually works as specified. Produces a structured report with PASS/FAIL verdicts per criterion.

### /document-feature

```
/document-feature user-auth
```

Extracts reusable patterns from a completed feature and adds them to the project's skill system. Run this after completing a feature to build your project's knowledge base.

---

## 9. Bug Tracking & Fixes

Beast Mode includes a built-in bug tracking system stored as Markdown files in `docs/bugs/`.

### /fix-bug

```
/fix-bug BUG-001
```

Fix a specific bug by ID. Claude loads the bug details, any linked feature context, implements the fix, and asks you to verify before closing the bug.

### /fix-feature

```
/fix-feature user-auth
```

Fix all open bugs linked to a feature. Claude groups bugs by priority (critical first), loads the feature context once, and works through each bug. After each group, you test and confirm which fixes are good.

Without a feature name, `/fix-feature` processes all open bugs across the project.

---

## 10. Quick Command Reference

| Command | When to Use | What It Does |
|---------|-------------|-------------|
| `/suggest-feature` | Need ideas | Suggests 2-4 features to build next based on project state. |
| `/plan-feature <name>` | New feature | Gathers requirements, proposes approaches, creates implementation plan. |
| `/start-feature <name>` | After plan approved | Creates context.md and tasks.md from the plan. Sets status to "In Progress". |
| `/continue-feature <name>` | Start of session | Loads feature context and shows status summary. |
| `/proceed` | During work | Picks up the next task and implements it using agents. |
| `/update-feature <name>` | End of session | Saves progress to docs. **Always run before ending a session.** |
| `/update-master` | After milestones | Updates the master overview with all feature progress. |
| `/discover-feature <name>` | Existing code | Documents an existing feature by analyzing its code. |
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

## 11. Tips & Best Practices

### New Project Checklist

1. Run `/install-beast-mode` to set up the workflow (creates agents, project docs, and templates)
2. Run `/suggest-feature` to get recommendations for your first feature
3. Run `/plan-feature` to create a plan, then `/start-feature` to begin building

### Context Window Management

Claude Code has a context window (like short-term memory). Long conversations fill it up. Beast Mode's docs are Claude's long-term memory.

- **Always** run `/update-feature` before ending a session or when the conversation is getting long
- **Always** run `/continue-feature` at the start of a new session
- This ensures nothing is lost between conversations

### Feature Naming

- Use **kebab-case**: `user-auth`, `payment-flow`, `dark-mode`
- Keep names short and descriptive
- Think of them as the "topic" of that part of your app

### Build in Phases

When planning features, break them into clear phases:

1. **Phase 1: Core** — The minimum that makes the feature work
2. **Phase 2: Polish** — Error handling, edge cases, UX improvements
3. **Phase 3: Integration** — Connecting with other features

This lets you ship something working quickly and iterate from there.

### When to Use What

| Situation | Command |
|-----------|---------|
| Starting a brand new project | `/install-beast-mode` |
| Not sure what to build first | `/suggest-feature` |
| Ready to plan a feature | `/plan-feature` |
| Plan is approved, start building | `/start-feature` then `/proceed` |
| Resuming work from yesterday | `/continue-feature` |
| Want Claude to keep building | `/proceed` |
| Done for the day | `/update-feature` |
| Feature complete, want it reviewed | `/review-feature` |
| Want to check a feature works as specified | `/evaluate-feature` |
| Finished a big feature | `/document-feature` then `/update-master` |
| Need to fix a bug | `/fix-bug` or `/fix-feature` |

> **Remember:** Beast Mode is just a workflow layer on top of Claude Code. All the docs it creates are plain Markdown files you can read and edit yourself at any time. You're always in control.

---

**Beast Mode** — Battle-tested Claude Code workflow system

Based on "Claude Code is a beast: Tips from 6 months of hardcore use"
