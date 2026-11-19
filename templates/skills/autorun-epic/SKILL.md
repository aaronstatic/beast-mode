---
name: autorun-epic
description: "Run a whole epic to completion: plan each feature, delegate each feature build to a fresh orchestrator agent, and collect a human testing list. It commits, fast-forwards the base branch, and pushes per feature. Usage: /autorun-epic <epic-name>"
argument-hint: "<epic-name>"
user-invocable: true
---

You have been asked to run a whole **epic** to completion. You build every feature of the epic, one at a time, in the build order of `epic-overview.md`. The user answers a planning question only.

**Epic name:** first argument from `$ARGUMENTS` (kebab-case, for example `checkout`). With no argument, list every folder that holds an `epic-overview.md`, and ask the user to choose.

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
epic folders for bare names. The target of this command is an epic. Run its child features one at a time, in the build order of `epic-overview.md`.
If no epics exist in `docs/features/`, behave exactly as before.

`.beast-mode/epic-resolution.md` is the single source of truth for epic detection and resolution. The body of this command is the autorun-epic workflow. It does **not** re-specify those rules.

## Operating mode

You are the **conductor** of this run. Apart from the inbox below, you do six things and nothing else:

1. **Check.** Confirm the five preconditions of Step 1.
2. **Plan.** Hold the human gate for the first plan, and for each later plan.
3. **Delegate.** Give one feature to one fresh `feature-orchestrator` agent.
4. **Read the report.** The agent returns eight sections. Act on them in the order of Step 5.
5. **Do the git work.** Every commit, every merge, and every push runs here.
6. **Repeat.** Take the next feature of the run list.

**You implement no phase.** You write no feature code, and you run no phase agent yourself. The orchestrator owns the feature loop, and a phase agent writes the code. Keep your own context lean: one report per feature, and no file content.

**Keep the inbox.** Apply section 12 rule 12 of `.beast-mode/phase-handoff.md` to each user message of the run. Each item goes into an inbox, with the answer of rule 3.

## Safety rules

These override any momentum to "just finish". Stop and ask the user the moment you reach a true blocker.

1. **Never rebase.** Run no `git rebase` at any point of this command.
2. **Never merge without `--ff-only`.** A merge that is not a fast-forward is a stop.
3. **Never pass `--force`.** No git command of this run takes `--force` or `--force-with-lease`.
4. **Never rebuild, restart, or touch a shared or production environment.** No service restart, and no deploy. A local type check, lint, test, or build runs for verification only.

---

## Process

### Step 1 — Check the preconditions (HARD STOP on each failure)

Run the five checks below, in order. The resume pre-check is not one of the five. It runs before check 5.

```bash
# 1. The target is an epic.
test -f "docs/features/<epic>/epic-overview.md"
# 2. The epic holds two or more feature subfolders.
ls -d docs/features/<epic>/*/ | wc -l                  # must print 2 or more
# 3. Each feature subfolder holds requirements.md or implementation.md.
for d in docs/features/<epic>/*/; do
  test -f "$d/requirements.md" || test -f "$d/implementation.md" || echo "NO PLAN: $d"
done                                                   # must print nothing
# 4. The Build Order section names every feature subfolder.
awk '/^## Build Order/{f=1;next} f&&/^## /{exit} f' docs/features/<epic>/epic-overview.md
```

**Resume pre-check.** Run these three lines before check 5. A `HEAD` of `feat/<epic>/<feature>`, for a feature of this epic, means a resumed run. The last run stopped inside that feature, and it left the tree dirty.

```bash
git rev-parse --abbrev-ref HEAD                                   # a feat/<epic>/* branch means a resumed run
git config --get "branch.$(git rev-parse --abbrev-ref HEAD).autorun-epic-base"   # the recorded base branch
git symbolic-ref --short refs/remotes/origin/HEAD                 # fallback: origin's default branch, drop the origin/ prefix
```

1. The base branch is the recorded value of `branch.<branch>.autorun-epic-base`. With no recorded value, use the default branch of `origin`. With no `origin/HEAD`, use `main` when it exists, else `master`. Announce the resumed feature and the base branch in one line.
2. Check 5 records no base branch. The pre-check already set it.
3. Check 5 skips the clean-tree check, because the dirty tree is the resume point. It counts ahead and behind on the base branch, not on `HEAD`. Run `git rev-list --left-right --count <base-branch>...<base-branch>@{upstream}`, which must print `0	0`.
4. Step 2 keeps the resumed feature in the run list, also when its `tasks.md` is complete. Step 4a reuses its branch.

```bash
# 5. Fresh run only: the working tree is clean, and the branch matches its remote.
git rev-parse --abbrev-ref HEAD
git status --porcelain                     # must print nothing
git fetch
git rev-list --left-right --count HEAD...@{upstream}   # must print "0	0"
```

A failure ends the run at once. State the action in progress, the named cause below, and the smallest thing the user must do.

1. The folder holds no `epic-overview.md`, so it is not an epic. Point the user at `/plan-epic` or `/create-epic`.
2. An epic with one feature needs `/autorun-feature <epic>/<feature>` instead.
3. Name each folder that check 3 printed. The user writes a `requirements.md` for it, or runs `/plan-feature`.
4. Compare those names with the subfolder list of check 2. A subfolder that the build order does not name is a stop, because the run has no place for it.
5. Name the dirty file, or the count of the commits ahead and behind. The user commits, stashes, or pulls first. `git rev-list` exits with 128 when the base branch has no upstream. Step 5c pushes, so the user sets the upstream first.

In a fresh run, the **base branch** is the branch name from check 5. In a resumed run, it is the branch of the resume pre-check. Every merge of Step 5 returns to it.

### Step 2 — Build the run list

1. Read the Build Order section of `epic-overview.md`.
2. Read `tasks.md` of each feature. A feature with a 100 percent complete `tasks.md` leaves the run list. The resumed feature of Step 1 stays in the run list.
3. The run list is the build order minus every complete feature. The resumed feature of Step 1 stays, and it goes first. The other features follow in the build order.
4. A build order that marks two features as parallel still runs them one at a time. Name the pair and continue.
5. An empty run list ends the run. Report that every feature is complete, and name the path of `human-testing.md`.

Announce the run list and the skipped features in one block:

```
Epic: {epic-name}   —   base branch {base-branch}

Run list ({N} of {M} features):
  1. Resumed: {feature}   — the work in progress on its branch
  2. {feature}   — planned, ready to build
  3. {feature}   — no implementation.md, plan first
Skipped (already complete):
  - {feature}   — tasks.md 100%
```

### Step 3 — Plan the first feature of the run list

This step runs only when the first feature of the run list holds no `implementation.md`. A first feature that already holds a plan goes straight to Step 4.

1. Run the `/plan-feature <epic>/<feature>` command in the main thread.
2. The interview of `/plan-feature` asks the open scope questions, per `.beast-mode/interview.md`, and it ends with the stop check. Ask no other planning question. The research choice and the approach choice of `/plan-feature` are control choices, per section 3 of `.beast-mode/interview.md`. They run as written.
3. **Do not wait at the approval step of `/plan-feature`.** Treat the plan as accepted and continue.
4. The user may stop the run at the interview. A stop answer ends the run, with no git write.

Every later feature gets its draft plan from the orchestrator of the feature before it. Step 5d holds that gate.

### Step 4 — Build the current feature

**4a. Put the branch in place.** Reuse a branch that already exists. Never recreate it, and never drop its commits.

```bash
git rev-parse --verify --quiet "feat/<epic>/<feature>"   # exists?
git checkout -b "feat/<epic>/<feature>"                  # when it does not exist
git checkout "feat/<epic>/<feature>"                     # when it exists
git config "branch.feat/<epic>/<feature>.autorun-epic-base" "<base-branch>"   # save it for a resumed run
```

The last line records the base branch on the feature branch, and the resume pre-check of Step 1 reads it.

**4b. Delegate to the `feature-orchestrator` agent.** The prompt states these six facts, in the shape of the example below:

1. The feature reference, `<epic>/<feature>`.
2. The branch name, `feat/<epic>/<feature>`.
3. The sentence "You are called by `/autorun-epic`".
4. The name of the next feature of the run list, or the word `none`.
5. The path of the epic folder, `docs/features/<epic>/`.
6. The base branch name from Step 1.

```
Build one feature of an epic to the end.
1. Feature: editor/ux
2. Branch: feat/editor/ux — it exists and is checked out. Stay on it.
3. You are called by /autorun-epic.
4. Next feature: editor/toolbar
5. Epic folder: docs/features/editor/
6. Base branch: main
Make no git write. Return the eight report sections in order.
```

**4c. Wait for the report.** Start no second orchestrator. One feature builds at a time.

### Step 5 — Read the report and act

The report holds eight sections, always in this order: `Feature`, `Phases`, `Findings fixed`, `Needs human verification`, `Next feature draft`, `Open scope questions`, `Blockers`, `Notes`. An empty section holds the word `none`. The `feature-orchestrator` agent file holds the template, and this command does **not** restate it.

Read `Feature` and `Phases` for the state of the run. Keep the count of `Findings fixed` and the lines of `Notes` for the summary of Step 7. Then act in the four steps below, in this order.

**5a. Blockers.** A `Blockers` section that does not read `none` stops the loop.

1. Show the ask to the user, in the words of the report. Ask the user to choose: fix it and retry the feature, or end the run.
2. Wait for the answer. On a retry, first wait until no child agent of the last orchestrator runs. Then delegate the same feature to a **fresh** `feature-orchestrator` agent, from Step 4b.
3. Make no commit and no merge for a blocked feature. Never go to the next feature with an open blocker.
4. A blocker can name a medium or a large change from the inbox. Run this item for that blocker, in place of items 1 and 2. For a medium change, run section 12 rule 9 of `.beast-mode/phase-handoff.md` on the plan and `tasks.md` of the feature. Rule 9 asks the scope question of the blocker and marks the line done. Wait until no child agent of the last orchestrator runs. Then delegate the feature to a **fresh** `feature-orchestrator` agent, from Step 4b. For a large change, run section 12 rule 10, then end the run. The user may stop the run at the question.

**5b. Needs human verification.** Append each item to `docs/features/<epic>/human-testing.md`. Create the file from the template at `.beast-mode/templates/human-testing.md` when it does not exist. Add one `## <feature>` section per feature, with one `- [ ] <item>` line per item. The orchestrator already appended one `Phase <n> demo:` line per slice, per section 10 of `.beast-mode/phase-handoff.md`.

1. Append only. Never rewrite a section that already exists.
2. When the section of the feature exists, append the new items to it. Skip an item whose text already appears in that section, such as each demo line that the orchestrator appended.
3. The file holds manual test items only. The `context.md` of the feature keeps its own `## Needs Human Verification` section, which `/autorun-feature` writes.

**5c. Git.** Read `tasks.md` of the feature first. A report that reads `Complete` above an incomplete `tasks.md` is a mismatch. Commit the work, and name the mismatch in the summary. That feature stays in the run list of the next run.

```bash
git add -A
git commit -m "feat: <epic>/<feature>"
git checkout <base-branch>
git merge --ff-only "feat/<epic>/<feature>"
git push
git branch -d "feat/<epic>/<feature>"
```

1. One commit per feature. The subject is `feat: <epic>/<feature>`. The body follows the commit convention that the project instruction file states.
2. `--ff-only` is mandatory. A non-zero exit is a stop.
3. A failed `push` is a stop.
4. Never run `rebase`, never run `merge` without `--ff-only`, and never pass `--force` to any command.
5. A stop leaves the branch and the commit in place. The user fixes the conflict and runs `/autorun-epic <epic>` again.

**5d. Open scope questions.** Read `Open scope questions` and `Next feature draft`.

1. `none` needs no question. Accept the draft plan of the next feature as written, and go to Step 6.
2. Otherwise ask every listed question in one batched question. Ask the user to choose between the options of the report, and name the one that the report recommends.
3. Revise `docs/features/<epic>/<next-feature>/implementation.md` where an answer changes the scope. Make targeted edits only, and treat the revised plan as accepted.
4. A `Next feature draft` that reads `not written` means the next feature holds no plan. Run Step 3 for it before Step 4.
5. The user may stop the run at this question.

### Step 6 — Take the next feature

Repeat Step 4 and Step 5 for each feature of the run list, in order. End the loop when the run list is empty. Summarize each finished feature in one line, and drop the rest of its report.

### Step 7 — Close the epic

1. Run the `/update-epic <epic>` command. It refreshes `epic-overview.md` and the single row of the epic in the master overview.
2. Run the `/update-master` command.
3. Commit the refreshed docs. This commit lands on the base branch, and the banner names it. The three rules of Step 5c hold: no rebase, no merge without `--ff-only`, and no `--force`.

```bash
git add -A
git commit -m "docs: <epic> epic rollup"
git push
```

4. Show the summary below. **Run no `/review-epic` here.** The user runs it when they want it.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EPIC RUN COMPLETE: {epic-name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Base branch: {base-branch}   Commits: {N}   Findings fixed: {F}

Features:
  ✅ {feature}   — feat: {epic}/{feature}
  ⏭  {feature}   — skipped, already complete
  ⚠️ {feature}   — stopped: {one-line cause}
  📄 docs        — docs: {epic} epic rollup

Notes:
  {feature}: {note, or none}

Human testing ({K} items):
  docs/features/{epic}/human-testing.md

Inbox ({I} open lines):
  docs/features/{epic}/{last-feature}/inbox.md
  {kind}: {the text}

Next steps:
  • Work through docs/features/{epic}/human-testing.md
  • /review-epic {epic}   — review the epic across all its features
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## When to stop and prompt the user

Stop the loop and ask the user, rather than guess, when:

1. **A check of Step 1 fails.** Name the check, and the file or the branch that failed it.
2. **The report holds a blocker.** Ask the smallest ask of the report, wait, then delegate that feature again. A blocker can be an inbox change that needs the scope answer of the user. A large change ends the run instead, per Step 5a item 4.
3. **A git command fails** — `git merge --ff-only`, `git push`, or a working tree with an unexpected change.
4. **A credential or an external prerequisite does not exist.** The report names it in `Blockers`.
5. **The user answers the interview or a batched question with a stop.** End the run. Leave every commit in place.
6. **A needed skill or agent does not exist** — `/plan-feature`, `/autorun-feature`, `/review-feature`, `/update-epic`, `/update-master`, or the `feature-orchestrator` agent. Tell the user that this command depends on it.

Every stop states three things: the action in progress, the cause, and the smallest thing the user must do. Then wait.

## Notes

- **Serial in this version.** One feature builds at a time, even where the build order marks a pair as parallel. A parallel build needs two working trees, and this version does not do that.
- **Resumable.** A second run of `/autorun-epic <epic>` starts at the resumed feature of Step 1. With no resumed feature, it starts at the first feature with no `implementation.md`, or with an incomplete `tasks.md`. It repeats no complete feature, apart from the resumed feature of Step 1. It reuses a branch that survived the last run. A run that stopped inside a feature resumes on that feature branch. The recorded base branch is the merge target.
- **One commit per feature.** The main thread makes every commit, every merge, and every push. The orchestrator and every phase agent make none.
- Honour the standing project rules of the project instruction file: the commit convention, the code style, and the migration checks.
