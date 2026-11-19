# Plan Interview — Shared Reference

**This file is the single source of truth for the plan interview.** The installer writes it to **`.beast-mode/interview.md`**. Section 9 holds the pointer block of each plan command. The rules live here and **only** here, and a command never restates them.

> **Who reads this file:** the parent context of `/plan-feature` and `/plan-epic`, one time per run. `/autorun-feature` and `/autorun-epic` reach it through `/plan-feature`. A subagent never reads it.

`.beast-mode/harness.md` maps each neutral term.

---

## 1. The flow

The interview runs in order: the first message, the facts, one round, more rounds when needed, and the handoff.

The first message is the open question, in plain chat. The command holds it in its own text, and asks it only when no prompt and no requirements file exist. Every later question in the interview goes into a round.

## 2. Facts first

The command searches the codebase before each round.

1. A fact question asks what the code, the config, or the docs hold. Only a decision question, about what the plan must do, goes to the user.
2. When the command can name the one to three files with the answer, it searches and reads them itself.
3. When the answer spreads over more files, the command delegates the search to an agent. It asks for the answer and the file paths, not the file text.
4. No question asks for a fact that the prompt, the requirements file, or an earlier answer states.

## 3. The round

1. A round asks the whole open set at one time.
2. Each question gets a number: `Q1`, `Q2`, and so on. The numbers continue in a later round.
3. The question text ends with a why line: `Why: <the plan decision that waits on this answer>`. A question with no waiting decision stays out of the round.
4. Each question offers two to four options. The recommended option comes first, and its label ends with `(Recommended)`. Each option carries a one-line trade-off.
5. The header holds the number and one word, at most 12 characters, for example `Q2 Storage`.
6. A call to ask the user to choose holds at most four questions, on every harness. A round uses one call, or two calls for more questions. The stop check is not one of them. It is a plain chat message, per section 4.
7. A round holds at most seven open questions. When more stay open, the round asks the seven that block the most plan decisions. Each other question becomes an assumption with its recommended answer.
8. A nice-to-have item becomes a question whose recommended answer defers it.
9. The control choices of the command stay out of the round. They are the overwrite, research, and approach choices, the plan approval, and an error branch.

## 4. The stop check

1. The stop check is a plain chat message, after the last choose call of a round. The command never asks it through the tool to ask the user to choose. The dialog of that tool hides the list, and its question field is too small for the list.
2. The message holds, in this order: the state line, the answers of the round so far under `Answers so far`, and the assumption list under `Assumptions`. Each line is one item: `- Q<n> <the answer>` or `- A<n> <the assumption>`. A summary sentence about the list is not the list. A table is not the list.
3. The message ends with one line: `Reply "all hold", or give the item number and the change.` The command then stops and waits for the reply. It asks nothing else in that message.
4. An assumption is a choice that the plan rests on, and that no requirement and no answer states. Examples are a scope boundary, a default, and a codebase fact with its path. An item keeps its number in a later round.
5. The list holds ten items or fewer, and only an item that changes the plan when it is wrong.
6. A reply of "all hold" confirms every item. A reply with an item number and a change edits that item, and starts the next round per section 5.
7. An answer of the same round wins over an assumption that it contradicts. The command drops that assumption.
8. The stop check always runs, in an autorun too. A round with no open question holds the stop check message alone.

## 5. More rounds, and the end

1. A new question from the user, or a changed item, starts the next round.
2. The next round runs the same way, and its stop check shows the updated list.
3. The interview ends when the user confirms the list and asks no new question.
4. A later step, such as the research or approach choice, can contradict a confirmed item. One more round then asks about it before the handoff.

## 6. The confirmed list and the handoff

1. The confirmed list holds one line per item: the answers first, then the assumptions, each in number order.
2. A line reads `- Q<n> <the question in short>: <the answer>` or `- A<n> <the assumption>`, word for word as confirmed.
3. `/plan-feature` pastes the list into the `solution-architect` prompt as the Confirmed Assumptions block. The architect records it unchanged under Key Technical Decisions.
4. `/plan-epic` writes each item into the epic file that the item shapes. That is the Requirements or Out of Scope list of `epic-requirements.md`, the Build Order of `epic-overview.md`, or the `requirements.md` of one feature.
5. No other file holds the list.

## 7. When the round runs

- `/plan-feature`: after the requirements step, and before the research choice and the approach choice.
- `/plan-epic`: after the command drafts the feature set and the build order. The drafts go into the assumption list.

## 8. The question set

The round asks each topic below that the requirements and the codebase leave open. A new topic goes into this section, never into a command.

### `/plan-feature`

- The key use cases
- The user personas affected
- The technical constraints
- The integration points with existing systems
- The success criteria: what the user sees when the feature works
- The demo line of phase 1: what a person does and sees

### `/plan-epic`

- The primary outcome
- The scope, and what waits for later
- The existing features in `docs/features/` that belong in the epic: search first, then ask about the fit only
- The hardest part to build first
- The feature boundaries of the draft set
- The build order

## 9. The canonical "Plan interview" command block

`/plan-feature` and `/plan-epic` hold the block below, byte for byte, as the last paragraph of their requirements step. A wording change edits this file and both commands.

```markdown
**Plan interview.** Read `.beast-mode/interview.md`, and run the interview by its rules.
The facts come first, then the rounds, each with a stop check. The file holds the
question set of this command and the point where the round runs.
`.beast-mode/interview.md` is the single source of truth for the interview. This
command does not restate it.
```
