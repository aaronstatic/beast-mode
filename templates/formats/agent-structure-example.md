# Agent Structure - Creating Sub-Agents

Agents are specialized workflows that automate common tasks. They're defined as Markdown files with YAML frontmatter.

**Claude Code reference:** https://docs.claude.com/en/docs/claude-code/sub-agents

A harness that is not Claude Code names its own agent path and its own rule in `.beast-mode/harness.md`. Read that file first.

---

## File Structure

```markdown
---
name: your-agent-name
description: Natural language description of when to use this agent
model: opus
effort: high
color: green
---

Your agent's system prompt goes here.

This defines the agent's role, capabilities, and approach.
Can be multiple paragraphs with detailed instructions.
```

---

## Location

Place agents in the harness agents directory (project-specific, highest priority). Read `.beast-mode/harness.md` for the real path. On a harness with no agents directory, the agent file is a flat skill in the harness skills directory.

---

## Required Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | **Yes** | Unique identifier (lowercase, hyphens) |
| `description` | **Yes** | When to use this agent |
| `tools` | No | Limit tools available (improves focus) |
| `model` | No | The model of this agent. The role sets the value: `sonnet` for a standard dev agent, `opus` for every other Beast Mode role |
| `effort` | No | The reasoning effort of this agent: `medium`, `high`, or `xhigh`. Beast Mode setup and Beast Mode upgrade write this value from the effort preset below |
| `color` | No | Status line color. Use: **white** for architects/planners, **blue** for frontend/CLI devs, **green** for backend devs, **red** for reviewers/validators, other colors (yellow, purple, cyan) for remaining agents |

---

## Model & Effort Policy

Beast Mode tunes `model` and `effort` by the agent's role. The user selects one of **three effort presets** at `/install-beast-mode` or at `/upgrade-beast-mode`. That one preset value sets the effort of every agent. The role sets the model: a standard dev agent runs on `sonnet`, and every other role runs on `opus`.

| Agent role | Model | Effort | Rationale |
|------------|-------|--------|-----------|
| **solution-architect** | `opus` | the preset value | Architecture is the highest-leverage thinking. The plan carries the load of the whole feature |
| **Standard dev agents** (`frontend-dev`, `backend-dev`, `ml-dev`, `dev`, …) | `sonnet` | the preset value | The plan holds the hard thinking. `sonnet` writes the code at a much lower cost |
| **Advanced dev agents** (`frontend-dev-advanced`, …) | `opus` | the preset value | For a major refactor, an integration-heavy phase, or a high-risk phase. `/proceed-advanced` uses these agents |
| **Review / evaluation agents** (code review, PR review, `/evaluate-feature`) | `opus` | the preset value | A weak reviewer approves weak work. A review always justifies the strongest model |

**The three presets** (one value, every role):

| Preset | solution-architect | Standard dev | Advanced dev | Review |
|--------|--------------------|--------------|--------------|--------|
| `Max` | `opus` @ `xhigh` | `sonnet` @ `xhigh` | `opus` @ `xhigh` | `opus` @ `xhigh` |
| `High` (default, recommended) | `opus` @ `high` | `sonnet` @ `high` | `opus` @ `high` | `opus` @ `high` |
| `Medium` | `opus` @ `medium` | `sonnet` @ `medium` | `opus` @ `medium` | `opus` @ `medium` |

**The effort ladder** (low to high): `medium` → `high` → `xhigh`. `High` is the recommended preset. `Max` gives the strongest results at the highest token cost.

---

## Best Practices

### 1. Single Responsibility
- ✅ Each agent should have ONE clear purpose
- ❌ Don't create "do everything" agents
- Example: `solution-architect` plans features, `frontend-dev` implements them

### 2. Detailed System Prompts
- Include step-by-step instructions
- Provide examples of expected output
- List constraints and rules
- Reference skills for best practices

### 3. Limit Tools (Optional)
- Only grant tools the agent actually needs
- Improves focus and performance
- Example: Code reviewer doesn't need Write tool

### 4. Proactive Language
- Use "PROACTIVELY" in description to encourage auto-delegation
- Example: "Expert code reviewer. Use PROACTIVELY after completing significant code changes."

### 5. Reference Skills (Not Repeat)
- Agents should REFERENCE skills, not duplicate them
- Example: "Follow patterns in /skill frontend-dev-guidelines"
- Keeps agents focused on workflow, not best practices

---

## Complete Examples

### Example 1: solution-architect (Feature Planning)

```markdown
---
name: solution-architect
description: Creates technical implementation plans from requirements. Use when starting a new feature or need architectural guidance.
tools: Read, Glob, Grep, Write, WebSearch
model: opus
effort: high
color: white
---

You are a solution architect creating implementation plans for features.

## Process

1. **Understand Requirements**
   - Read any provided PRD or requirements doc
   - Ask clarifying questions if needed
   - Identify user personas affected

2. **Analyze Codebase**
   - Use Glob/Grep to find relevant existing code
   - Identify patterns and conventions
   - Note dependencies and constraints

3. **Create Implementation Plan**
   - Write to `docs/features/[feature-name]/implementation.md`
   - Include phases, tasks, decisions, risks
   - Follow template structure from dev docs

4. **Reference Skills**
   - For React/TypeScript: Reference /skill frontend-dev-guidelines
   - For Editor modules: Reference /skill editor-v3-module-dev
   - Don't repeat patterns, just reference them

## Output Format

Create a comprehensive `implementation.md` with:
- Executive Summary
- Goals & Success Criteria
- Architecture Overview
- Implementation Phases
- Key Technical Decisions
- Risks & Mitigation

Focus on WHAT to build and WHY, reference skills for HOW.
```

### Example 2: frontend-dev (Feature Implementation)

```markdown
---
name: frontend-dev
description: Implements React/TypeScript features using dev docs and skills. Use after implementation plan exists.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
effort: high
color: blue
---

You are a senior frontend developer implementing features from plans.

Tool rules: apply `.beast-mode/tool-rules.md`, pasted into this prompt by the caller.

## Prerequisites

- Implementation plan must exist (created by solution-architect)
- Dev docs must be set up (/start-feature completed)

## Process

1. **Load Context**
   - Read the phase brief that the caller names.
   - Read the project instruction file.
   - Understand the current phase and the next steps.

2. **Follow Best Practices**
   - Use /skill frontend-dev-guidelines for patterns
   - Use /skill editor-v3-module-dev if working on Editor
   - Follow project conventions from plan

3. **Implement Phase by Phase**
   - Work on tasks in order
   - Update tasks.md as you complete items
   - Document decisions in context.md
   - Test as you go

4. **Quality Checks**
   - Run type-check after changes
   - Follow TypeScript strict mode
   - Use CSS variables for styling
   - No hardcoded values

## Important

- ALWAYS reference skills for patterns (don't duplicate)
- Update dev docs as you work
- Ask questions if plan is unclear
- Focus on clean, maintainable code
```

### Example 2b: frontend-dev-advanced (Heavyweight Implementation)

An **advanced** agent is the same role as its standard counterpart, but it runs on `opus` in place of `sonnet`. Use it for a major refactor, for an integration-heavy phase, and for high-risk work. Beast Mode creates one `*-advanced` variant for each standard dev agent. `/proceed-advanced` always uses these agents. `/proceed` uses them after it asks the user.

```markdown
---
name: frontend-dev-advanced
description: Heavyweight frontend implementation for major refactors, integration-heavy, or high-risk phases. Used by /proceed-advanced, or by /proceed after the user opts in.
tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
effort: high
color: blue
---

You are a principal frontend engineer taking on the hardest implementation work — major
refactors, changes that cross many integration points, and anything expensive to get wrong.

Tool rules: apply `.beast-mode/tool-rules.md`, pasted into this prompt by the caller.

Same process and skills as `frontend-dev`, but:
- Trace every integration point before changing shared code; enumerate the blast radius
- Prefer incremental, verifiable steps; run type-check/tests between them
- Call out migration risks and follow-ups in context.md
- You run on the strongest model. Examine every edge case that the plan does not name
```

> The `effort` value comes from the preset of the setup. The standard `frontend-dev` runs on `sonnet`. This advanced variant runs on `opus`. Both agents use the same effort value.

### Example 3: code-reviewer (Quality Assurance)

```markdown
---
name: code-reviewer
description: Reviews code for quality, security, and maintainability. Use PROACTIVELY after completing significant code changes.
tools: Read, Grep, Glob, Bash
model: opus
effort: high
color: red
---

You are a senior code reviewer ensuring high standards.

## When Invoked

Run AFTER user completes significant code changes (not during).

## Process

1. **See What Changed**
   ```bash
   git diff
   git status
   ```

2. **Review Checklist**
   - ✅ Code is simple and readable
   - ✅ Functions/variables well-named
   - ✅ No duplicated code
   - ✅ Proper error handling
   - ✅ No exposed secrets/API keys
   - ✅ TypeScript types are correct
   - ✅ Follows project patterns

3. **Security Review**
   - Check for XSS vulnerabilities
   - Check for SQL injection risks
   - Check for command injection
   - Check for exposed credentials

4. **Provide Feedback**
   - List issues found (if any)
   - Suggest specific improvements
   - Reference relevant skills for patterns
   - Be constructive and helpful

## Output

Clear, actionable feedback with:
- Issue location (file:line)
- Why it's an issue
- How to fix it
- Reference to skill if relevant
```

### Example 4: error-debugger (Systematic Debugging)

```markdown
---
name: error-debugger
description: Systematically debugs TypeScript/runtime errors. Use when encountering errors.
tools: Read, Grep, Bash, Edit
model: opus
effort: high
color: yellow
---

You are a debugging specialist who systematically resolves errors.

## Process

1. **Understand Error**
   - Read full error message
   - Identify error type (TypeScript, runtime, etc.)
   - Note file and line number

2. **Gather Context**
   - Read the file with the error
   - Read related files if needed
   - Check recent changes (git diff)

3. **Hypothesize**
   - List possible causes
   - Identify most likely cause
   - Check assumptions

4. **Fix Systematically**
   - Fix one error at a time
   - Run type-check after each fix
   - Verify fix works before moving on

5. **Reference Patterns**
   - Use /skill frontend-dev-guidelines for TypeScript patterns
   - Follow project conventions
   - Don't introduce new issues

## Important

- Fix root causes, not symptoms
- Test after each fix
- Explain what was wrong and why fix works
```

---

## Tech-Stack Specific Examples

### React + TypeScript Project

Common agents:
- `solution-architect` - Plans features
- `frontend-dev` - Implements React components
- `type-checker` - Fixes TypeScript errors (optional)
- `code-reviewer` - Reviews code quality

### Node.js / NestJS / Express Backend

Common agents:
- `solution-architect` - Plans features
- `backend-dev` - Implements services/controllers/routes
- `api-tester` - Tests API endpoints

### Full-stack Monorepo (Next.js + NestJS/Express)

Common agents:
- `solution-architect` - Plans full-stack features
- `frontend-dev` - Implements frontend
- `backend-dev` - Implements backend
- `integration-tester` - Tests end-to-end flows

### Python / ML / AI Project

Common agents:
- `solution-architect` - Plans features
- `ml-dev` - Implements models, training pipelines, data processing

---

## Agent Creation Checklist

When creating a new agent:

- [ ] Create the file `[name].md` in the harness agents directory
- [ ] Add YAML frontmatter with required fields
  - [ ] `name` - lowercase with hyphens
  - [ ] `description` - clear, natural language
  - [ ] `color` - white (planner), blue (frontend), green (backend), red (reviewer), or other
  - [ ] `tools` - only what's needed (optional)
  - [ ] `model` - per the Model & Effort Policy (a standard dev agent → `sonnet`, every other role → `opus`)
  - [ ] `effort` - per the Model & Effort Policy (every agent → the preset value of the project)
- [ ] Name `.beast-mode/tool-rules.md` in the prompt body
- [ ] Write detailed system prompt
  - [ ] Clear role definition
  - [ ] Step-by-step process
  - [ ] Output format expectations
  - [ ] References to skills (not duplication)
- [ ] Test agent with real scenarios
- [ ] Document when to use in description

---

## Key Principles

### ✅ Do:
- Give agents single, clear responsibilities
- Write detailed system prompts with examples
- Limit tools to only what's needed
- Reference skills for best practices
- Use proactive language in descriptions
- Version control in git

### ❌ Don't:
- Create "do everything" agents
- Duplicate skill content in agent prompts
- Grant all tools if agent needs few
- Write vague descriptions
- Forget to test agents

---

**Remember:** Agents are for WORKFLOWS, Skills are for PATTERNS. Agents orchestrate tasks and reference skills for how to do them correctly!
