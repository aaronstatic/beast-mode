---
name: plan-feature
description: "Plan a new feature by gathering requirements and creating an implementation plan. Usage: /plan-feature <feature-name> [initial requirements]"
argument-hint: "<feature-name> [initial requirements]"
user-invocable: true
---

You have been asked to plan a new feature with implementation documentation.

**Feature name:** First argument from `$ARGUMENTS`
**Initial requirements:** Remaining arguments from `$ARGUMENTS` (may be empty)

## Harness

This command runs on any agent harness. Read `.beast-mode/harness.md` first.
It maps the neutral terms in this command to the tools of this harness.
Terms include: ask the user to choose, delegate to an agent, search the web,
and the harness skills directory. Use the mapped tool. Do not use a tool name
from another harness.

## Epic awareness

This command is epic-aware. Before resolving `$ARGUMENTS` to a feature path,
read `.beast-mode/epic-resolution.md` and apply its rules: detect epics by
`epic-overview.md`, resolve `<epic>/<feature>` references, fuzzy-fall-back into
epic folders for bare names, and load epic context (the `epic-overview.md` + all sibling features) when the target is a feature inside an epic.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. When the target is a feature inside an epic (resolved via `<epic>/<feature>` or fuzzy fallback), load that epic's context per §4 before planning and pass it into the solution-architect prompt (see Step 3 and Step 7). This command's body is the planning workflow; it does **not** re-specify those rules.

## Process

### 1. Parse Arguments

Parse `$ARGUMENTS` to extract:
- **Feature name** (required): First word/phrase (use kebab-case format)
- **Initial prompt** (optional): Everything after the feature name

Examples:
- `/plan-feature user-authentication` → name: "user-authentication", prompt: empty
- `/plan-feature user-authentication Add OAuth support and 2FA` → name: "user-authentication", prompt: "Add OAuth support and 2FA"

If `$ARGUMENTS` is completely empty:
- Ask user for feature name
- Ask for initial requirements

### 2. Verify Feature Doesn't Already Exist

Check if `docs/features/<feature-name>/` already exists:
- If it exists with `implementation.md`, inform user and ask if they want to:
  - Overwrite the existing plan
  - Use `/start-feature` to work on it as-is
  - Use `/discover-feature` if they want to investigate it first
- If directory exists but no `implementation.md`, proceed with planning

### 3. Explore Project Context

Before asking questions, understand what you're working with:
- Read the project instruction file (`CLAUDE.md`, or `AGENTS.md` when present) and any project docs to understand the tech stack and architecture
- Check recent git commits to understand current development momentum
- Scan the codebase structure (key directories, existing patterns)
- Look at existing features in `docs/features/` for conventions and style

This context informs smarter questions and better approach recommendations.

**If the target is a feature inside an epic** (resolved to `<epic>/<feature>` per the Epic awareness block), also **load epic context per `.beast-mode/epic-resolution.md` §4** before continuing — read the epic's `docs/features/<epic>/epic-overview.md` and `epic-requirements.md` (if present) and **every sibling feature's** `implementation.md` + `context.md` (and `requirements.md` if the sibling is only planned). This tells you the epic's purpose, build order, integration notes, and what the sibling features already do, so the plan fits what comes before and after instead of contradicting it. Keep this epic context — it is passed into the solution-architect prompt in Step 7. (For a plain feature with no epic, skip this — there is nothing to load.)

### 4. Gather Requirements

**If initial prompt was provided:**
- Start with that as the base requirements

**If no initial prompt:**
- Check if `docs/features/<feature-name>/requirements.md` exists (created by `/suggest-feature`)
- If it exists, read it and use it as the base requirements — inform the user you found existing requirements and summarize them

**If no initial prompt AND no requirements.md:**
- Ask user: "What is this feature about? Describe what you want to build and why."
- Wait for response

**Plan interview.** Read `.beast-mode/interview.md`, and run the interview by its rules.
The facts come first, then the rounds, each with a stop check. The file holds the
question set of this command and the point where the round runs.
`.beast-mode/interview.md` is the single source of truth for the interview. This
command does not restate it.

### 4b. Assess Whether Research Is Needed

Before proposing approaches, judge whether this feature depends on **external knowledge you can't reliably answer from the codebase or general knowledge** — for example:

- Comparing competitor products or industry-standard approaches
- Choosing between unfamiliar libraries/services, or relying on current API/pricing/version details
- Regulatory, security, or compliance specifics that must be accurate
- Anything where a wrong external fact would send the architecture down the wrong path

Two constraints shape how you handle this:

- **All research happens here, before handoff.** The solution-architect agent can do a light fact check only. Gather every material external fact here, and pass it to the architect now.
- **Match the tool to the need — don't over-reach.** Most questions are answered by a quick web search; reserve deep research for genuinely high-stakes decisions where a wrong external fact would be costly to unwind. Don't reach for deep research when a simple search would do.

If you identify a research need, **ask the user first** — do not run research silently. Ask the user to choose:

```
This feature would benefit from some research on <topic> before I lock in scope/approach
(e.g. comparing <X> vs <Y>, current best practice for <Z>).

  • Quick web search now — fast, usually enough                        (recommended)
  • Deep research now — slower / more tokens, for high-stakes calls where a wrong fact is costly
  • No — proceed with what we know
```

- **"Quick web search now"** → search the web with focused queries, cross-check a couple of sources, and summarize the findings for the user.
- **"Deep research now"** → run the **`/deep-research`** command when the harness has it, with a focused question, and summarize the verified findings for the user. When the harness has no such command, search the web and cross-check more sources instead.
- **"No"** → continue normally.

Either way, **capture the findings** and: (a) let them inform the approach options in Step 5, and (b) pass them into the solution-architect prompt in Step 7 as a **Research Findings** block. Never ask the architect to research — it can't.

If no external research is needed (most features), skip this step silently.

### 5. Propose Approaches

Before jumping to a full plan, present **2-3 different approaches** to the user:

- Lead with your **recommended approach** and explain why
- Include **trade-offs** for each (complexity, performance, maintainability, time)
- Ground approaches in what you learned from the project context (existing patterns, tech stack)
- Scale this to complexity: a config change might get a single recommended approach with a brief rationale, while a major feature gets 2-3 detailed options

**Ask the user to choose** an approach (or to suggest their own).

Wait for the user to choose before proceeding to plan creation.

### 6. Create Feature Directory Structure

Create the directory structure:
```bash
mkdir -p docs/features/<feature-name>
```

### 7. Launch Solution-Architect Agent

Delegate to the `solution-architect` agent to create the implementation plan.

**Tool rules:** Read `.beast-mode/tool-rules.md` one time. Paste its `## Tool rules` section, word for word, at the top of the agent prompt. This is part 1 of the prompt shape in section 7 of `.beast-mode/phase-handoff.md`. The first lines of the template below are the paste slot and the source line.

**Slice rules:** Read section 11 of `.beast-mode/phase-handoff.md` one time. Paste it, word for word, into the Slice rules slot below.

**Agent prompt should include:**
```
<the `## Tool rules` section of `.beast-mode/tool-rules.md`, pasted word for word>

(Source of the block above: `.beast-mode/tool-rules.md`.)

Create an implementation plan for the following feature:

**Feature Name:** <feature-name>

**Requirements:**
<gathered requirements from step 4>

**Confirmed Assumptions (confirmed by the user in the interview of `.beast-mode/interview.md`):**
<the confirmed list, word for word, one item per line>
Do not change this block. Copy it word for word into Key Technical Decisions, under the
heading `### Confirmed Assumptions`, before the first decision. When the codebase
contradicts an item, keep the item, and write the conflict into Notes.

**Chosen Approach:**
<selected approach from step 5, with rationale>

**Research Findings (include ONLY if research was done in Step 4b; omit this whole block otherwise):**
<summary of the verified findings from the quick web search or deep research, with source URLs>
Treat these as authoritative external context, and cite them in Key Technical Decisions. The architect can do a light fact check only, so gather every fact here before handoff.

**Context:**
- Project: [Detected from the project instruction file or the project structure]
- Tech Stack: [Detected from project files]
- Existing Architecture: [Brief summary if relevant]
- Existing Patterns: [Relevant patterns found in project context exploration]

**Epic Context (include ONLY if this feature lives inside an epic — omit this whole block for a plain feature):**
This feature is part of the `<epic>` epic. Plan it to fit the epic's architecture, build order, and sibling features. From the epic context loaded in Step 3:
- Epic purpose & scope: [from epic-overview.md / epic-requirements.md]
- Build order & where this feature sits in it: [from epic-overview.md Build Order — what comes before/after]
- Sibling features and what they already do: [one line per sibling from its implementation.md / context.md]
- Integration points & shared conventions to respect: [from epic-overview.md Integration & Architecture]
- Known epic-level tech debt or constraints: [from epic-overview.md, if any]
Write the plan so it integrates with these siblings (reuse their patterns, honor the build order, don't duplicate or contradict their work).

**Slice rules (section 11 of `.beast-mode/phase-handoff.md`, pasted word for word):**
<section 11 of `.beast-mode/phase-handoff.md`>
Cut every phase by these rules. Each phase carries a Demo line and a Needs line.

**Output:**
Create a detailed implementation plan in `/docs/features/<feature-name>/implementation.md` following this structure:

1. **Quality Bar** - The quality target for this feature type
2. **Executive Summary** - Brief overview
3. **User Personas Alignment** - The users this feature serves
4. **Goals** - Primary goals and success criteria
5. **Architecture Overview** - High-level design
6. **Implementation Phases** - Slices per the Slice rules block. Each phase has a Demo line, a Needs line, tasks, estimates in steps, and acceptance criteria
7. **Key Technical Decisions** - Architecture decisions with rationale
8. **Risks & Mitigation** - Potential issues and how to address them
9. **Dependencies** - What this feature depends on
10. **Definition of Done** - Feature-level acceptance criteria (see below)
11. **Testing Strategy** - How to validate the feature
12. **Related Documentation** and **Notes**

**Definition of Done (IMPORTANT):**
The plan MUST include a "Definition of Done" section with concrete, testable acceptance criteria. These criteria will be used by a separate evaluator agent to verify the feature works correctly. Write them as specific, observable behaviors — not vague quality statements. Include:
- **Functional Criteria:** What the user can do and what should happen (e.g., "User can click 'Save' and see a success toast within 2 seconds")
- **Quality Criteria:** Error handling, loading states, no regressions
- **Integration Criteria:** How this feature connects with existing systems
- **Verification Method:** Step-by-step instructions for how an evaluator should test the feature (manual steps, API calls, or test commands)

**Status:** Planning
**Started:** [Today's date]
**Target Completion:** [Based on user input or TBD]
**Last Updated:** [Today's date with timestamp]

Use the existing implementation plans in this project as reference for format and style.
```

**IMPORTANT:** Tell the agent to:
- Write a file to create the implementation plan
- Be thorough but concise — scale detail to the feature's complexity
- Include specific technical details relevant to this project
- Break phases into granular tasks
- Apply YAGNI — only include what's needed for the chosen approach, no speculative features
- Build on existing project patterns rather than introducing new ones unnecessarily
- Set the **Quality Bar** section — tailor the quality descriptors to the feature type (UI-heavy features emphasize visual polish and interaction feel; backend features emphasize reliability and data integrity; full-stack features cover both)
- Write the **Definition of Done** with criteria specific enough that an independent evaluator with no implementation context could verify them
- Fill in the **Confirmed Assumptions** block above with the confirmed list of the interview, word for word. Never leave the block out
- Fill in the **Slice rules** block above with section 11 of `.beast-mode/phase-handoff.md`, word for word. Never leave the block out
- **If Step 4b produced research findings:** fill in the **Research Findings** block above with the summarized, sourced findings so the architect can cite them in its Key Technical Decisions. The architect can do a light fact check only. Gather every material fact here before handoff, and never instruct the architect to run research. Omit the block entirely if no research was done.
- **If this feature lives inside an epic:** fill in the **Epic Context** block above from the epic docs loaded in Step 3 (epic purpose, build order/position, sibling summaries, integration points, known tech debt) so the architect plans the feature to fit the epic. Omit that block entirely for a plain feature.
- Flag any phases that are major refactors or touch many integration points as needing an **advanced (opus, at the preset effort) dev agent**, so `/proceed` can route them correctly

### 8. Verify Plan Was Created

After agent completes:
- Check that `docs/features/<feature-name>/implementation.md` exists
- Read the first 50 lines to verify it has proper structure

If plan creation failed:
- Show error to user
- Offer to retry with more context

### 9. Present Plan to User

Show a summary:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ IMPLEMENTATION PLAN CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Feature: <feature-name>
📁 Location: docs/features/<feature-name>/implementation.md

📊 Plan Summary:
- Phases: [X slices, Y base phases]
  - Phase <n>: <name> - Demo: <the Demo line>
- Estimated Steps: [X steps]
- Key Technologies: [List]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Show one `Phase <n>` line for each phase of the plan, in order.

Then display the first ~30 lines of the plan so user can see the executive summary and goals.

### 10. Wait for Approval

Ask the user:

"Please review the implementation plan at `docs/features/<feature-name>/implementation.md`.

Would you like to:
1. **Start working on it** - I'll run `/start-feature <feature-name>` to set up dev docs
2. **Request changes** - Tell me what to adjust and I'll update the plan
3. **Cancel** - Discard this plan

What would you like to do?"

**If user chooses option 1 (Start):**
- Run the `/start-feature <feature-name>` command
- Wait for it to complete
- Show success message

**If user chooses option 2 (Changes):**
- Ask what changes they want
- Edit a file to update the plan, OR delegate to the `solution-architect` agent again with adjusted requirements
- A second architect run uses the prompt of Step 7. Paste the tool rules and the Slice rules, and put the change of the user into the Confirmed Assumptions block
- A direct edit of a confirmed item also edits that item under `### Confirmed Assumptions` in Key Technical Decisions
- Show updated summary
- Ask for approval again (repeat step 10)

**If user chooses option 3 (Cancel):**
- Ask if they want to delete the plan file
- If yes, remove it
- Confirm cancellation

## Important Notes

- **DO NOT** start implementing the feature - this command only creates the plan
- **DO** explore project context before asking questions
- **DO** involve the user in requirements gathering
- **DO** propose 2-3 approaches and get user buy-in before creating the plan
- **DO** use the solution-architect agent for plan creation (don't write it yourself)
- **DO** wait for explicit user approval before running /start-feature
- **DO** apply YAGNI - keep the approaches and the plan tight. The interview handles a speculative requirement
- **DO** scale the process to complexity - a simple feature gets a brief plan, not a novel

## Error Handling

- If feature name is invalid (special characters, spaces), suggest kebab-case alternative
- If solution-architect agent fails, offer to retry or let user create plan manually
- If /start-feature fails after approval, show error and let user fix manually
- If user cancels mid-process, clean up any partial files created

## Example Workflow

```
User: /plan-feature user-authentication Add OAuth and 2FA
Agent: I'll help plan the user-authentication feature.

Gathering requirements...
[Runs one interview round: Q1 to Q3, with the demo line of phase 1 as Q3, then the stop check as a plain chat message that lists the answers and the assumptions A1 to A4]

Creating implementation plan with solution-architect agent...

✅ Plan created at docs/features/user-authentication/implementation.md
Phase 1 is a slice with a Demo line: the user signs in with one OAuth provider

Would you like to start working on it?

User: Yes, start it

Agent: Running /start-feature user-authentication...
✅ Dev docs created! Ready to implement.
```

---

**Remember:** This command orchestrates the planning process but delegates the actual plan writing to the solution-architect agent. Your role is to facilitate, gather requirements, and coordinate the workflow.
