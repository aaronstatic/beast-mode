# Beast Mode Changelog

All notable changes to the Beast Mode plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

## [6.2.5] - 2026-11-24

Patch release. No migration script. `beast-mode upgrade` updates the orca skills (`/orca-feature`, `/orca-epic`, `/orca-setup`). `/orca-setup` can now set one new setting, `orchestration.stepRoundCap`. It has a default, so an existing `orca.json` needs no change.

### Fixed

- **A worker spec is found on WSL2 when the Orca CLI runs on Linux.** The fix of issue #10 sent `--spec-file` in the `\\wsl.localhost\<distro>\...` form on every WSL2 run. That is right for the Windows Orca app, but a Linux Orca CLI in WSL (`~/.orca/cli/bin/orca`) read it as a path under the working directory and failed with `ENOENT`. `beast-mode orca` now reads the first 8 KiB of the launcher once per step and converts the path only for a Windows launcher or an unknown one. A Linux launcher keeps the Linux path. If a start still fails on the form of the path, the step says which host it found and names `ORCA_CLI_COMMAND`, and it never retries the start. `BEAST_MODE_ORCA_HOST=windows|linux` overrides the probe.

- **A dropped tab no longer comes back beside the new one.** `close --discard` released the old tab with `worker-release`, which Orca refuses for a worker that is not settled (`dispatch_inactive`). The step cleared the record anyway ("Orca did not release ctx_..., and the record is clear"), so the old tab stayed a live `dispatched` worker with its terminal open. Seen 2026-11-23: a dsh Phase 6 tab hit a qwen 429 quota error. The coordinator dropped it with `close --discard` and started a fresh tab, and the fresh tab worked normally. Eight hours later the owner found the old, dead-looking tab and typed "continue" into it. It then took its old Resume mail with `check` and redid Phase 6 on the same checkout as the new tab, including overwriting the new tab's verify brief. `next` judges only the active dispatch, so it kept answering `wait` "works on dsh", and the timer wakes were right about the new tab. Fix 10: `close --discard` (feature and epic) now runs `orchestration worker-stop` for each dispatch that Orca refused as not settled. A gone dispatch gets no stop, and a plain `close` never stops one. A failed stop never fails the close, and the say line tells the coordinator that the tab can still work.

- **A failing feature step no longer loops for ever.** A feature step (or an epic step) that writes `FAIL` gives the `step-failed` ask. When the coordinator writes the findings to the inbox and goes on, the inbox tab starts, and that start clears every feature step mark (so a feature step runs again after new work). The step then ran again, found new findings, and failed again, with no count and no limit. Seen 2026-11-24: eleven rounds of `/review-game` on one feature (23, 9, 10, 10, 8, 11, 8, 6, 6, 9 findings, mostly MEDIUM and LOW), and the user was never asked. The verify loop of a phase has a cap (`verify-fail-cap`); the step loop had none. Fix 11:
  - **Count.** The run record counts the `FAIL` rounds of each step in `stepRounds` (for example `{ "feature:0": 2 }`), beside `done.steps` and not in it, so the starts that clear the step marks keep the count. Each `close --override` of a step tab counts one round. A `PASS` starts the count of its step again. A new Phase n tab starts it again for the steps of Phase n. No inbox, review, or review-fix start resets it.
  - **Ask.** Below the cap nothing changes: `step-failed`, stop or go on. At round `orchestration.stepRoundCap` (3 by default) the ask is `step-fail-cap`: the step has failed N rounds and the inbox fixes did not converge. Accept (recommended) runs `close --override --final`, which records `overridden-final`; no later start clears that mark, so the step does not run again in this run, and the run goes on to the inbox, the docs, and the commit. One more round runs `close --override`, so the step runs again after the next new work and the question comes back if it fails. Stop ends the run. The cap never skips a step that has not failed N real rounds, and it always asks.
  - **Show.** The `Steps:` block of the `done` summary (feature and epic) lists a step accepted at its cap first, as `overridden after N rounds`.
  - **Setting.** `orchestration.stepRoundCap` in `.beast-mode/orca.json`, a whole number from 1 to 20, default 3 (`step-round-cap-value`). `/orca-setup` asks for it with the backstop timer. An existing `orca.json` needs no change.

## [6.2.4] - 2026-11-22

Patch release. No migration script. `beast-mode upgrade` updates the orca skills (`/orca-feature`, `/orca-epic`, `/orca-setup`). `/orca-setup` can now set two new settings, `orchestration.backstopSeconds` and `orchestration.statusEveryMinutes`. Both have defaults, so an existing `orca.json` needs no change.

### Fixed

- **An Orca tab shows its task title.** Orca opens a worker tab with the fixed title `worker-<taskId>`, which blocks its generated title, so the `--task-title` of 6.2.3 never reached the tab. Each start now renames its tab to the task title with `terminal rename`, on both paths and on a retry. A failed rename never fails a start.

- **A dsh tab no longer stalls on the report of a helper that it started through Orca.** A dsh phase lead started its helper as an Orca worker and ended its turn to wait for the report. Orca queues mail to a tab until its next turn, and an idle dsh tab gets no next turn, so the `worker_done` of the helper stayed undelivered (`delivered_at` null) for 9 hours, and the coordinator got no wake. Five parts:
  - **Prevent.** Every worker spec gets a delegate rule: start no Orca worker and no Orca task of your own, delegate only by the "delegate to the `<name>` agent" term of `.beast-mode/harness.md` in the form that returns the result in the same turn, and never end the turn while an agent that you started still works. The spec stays harness-neutral.
  - **Detect.** `beast-mode orca next` reads the mailbox of an idle or busy dsh tab with `orchestration inbox --full` (it marks nothing read). Mail to `dispatch:<id>` that Orca has not delivered after `UNDELIVERED_MAIL_MS` (10 minutes) turns rule A4's wait, dsh wait, or busy wait into the resume send (or the report send) with `--mail`. `send --mail` adds a line that tells the tab to read its mail with the `check` command of its preamble, and records the message ids, so one stuck message gets one send. Still bound by the escalation cap. A failed read is no mail.
  - **Wake.** A `wait` holds a `timer` (600 s by default, and a `run` line). `/orca-feature` and `/orca-epic` start that one background `sleep`, and when it ends they run `next --wake timer`, which judges an idle tab as a fresh call does. The "no background command" rules name this one exception.
  - **Lost coordinator wakes.** Orca can fail to deliver wakes to the coordinator itself (seen after an Orca restart: every `worker_done` to `run:<id>` kept `delivered_at` null). Every `wait` now holds the backstop timer, for every agent. On a timer wake or a fresh call, `next` reads the mailbox of the Run with the same no-mark `inbox --full`: a `worker_done` for an active tab older than `COORDINATOR_MAIL_MS` (60 s) is taken as its report (the done check then judges it), and a lost escalation counts as the escalation wake of its tab, with its `stopReason`, once (a later resume send answers it). A settled worker still closes from its state with no mail at all. A failed read is no wake.
  - **Settings and quiet checks.** `orchestration.backstopSeconds` (default 600, 60 to 86400) sets the timer, and `orchestration.statusEveryMinutes` (default 30, 1 to 1440) sets the most often a timer check that changed nothing posts a "still working" line. `read.js` checks both (`backstop-value`, `status-every-value`), the `timer` of a wait carries both, and `/orca-setup` asks for them with the defaults shown. A timer check that changed nothing posts nothing, or at most that one line; the coordinator speaks when something goes wrong or a stage finishes.
- **A tab whose turn was interrupted no longer stalls the run.** Claude Code runs no Stop hook when the user interrupts a turn (Esc), so Orca kept a claude plan tab `working` for 45 minutes after its turn ended, sent no wake, and `next` (and `next --wake escalation`, the "resume" path) answered `wait`. Fix 8:
  - **Detect.** `next` reads how long a busy tab has sent no agent status (`lastActivity` of `worker-show --json`, or `projection.liveness.observedAt` of `--full`). A tab quiet for `STALE_TURN_MS` (15 minutes) counts as idle with no report: rule A4's resume send (or the report send), then the escalation cap asks. A user "resume" (an escalation wake with no dispatch) needs only `RESUME_QUIET_MS` (2 minutes). Any agent, not only claude.
  - **Wake.** Fix 8 adds no timer. It uses the backstop timer of fix 7, which every `wait` holds, so a timer wake finds a stale turn of any agent when Orca sends no wake.
- **A tab that asked a question no longer reads as stalled.** A claude plan tab got the resume send, ran the `ask` command of its preamble, and ended its turn to wait for the answer. Orca typed no wake for the question into the coordinator, so the backstop timer ran `next --wake timer`, and rule A4 saw an idle tab after one send: the `escalation-cap` ask, which recommended to stop and offered to drop the tab and its 7-answer plan interview. Fix 9:
  - **Detect.** For a tab that rule A4 would judge (idle, or busy with a stale turn), `next` reads the run mail with `orchestration inbox --run <runId> --full --json` (it marks nothing read). This read is wider than the Run mailbox read of fix 7 (`inbox --terminal run:<id>`), because it also lists the answers that `reply` sends to `dispatch:<id>`. A `question` from `dispatch:<id>` that no message answers (no row names it as its `thread_id`) is open. `read` and `delivered_at` do not tell. A failed read is no question. A tab whose `worker_done` reached only the Run (fix 7) reported, so `next` reads no question for it.
  - **Act.** A tab with an open question gets the new `question` action: its `questions` (`id`, `question`, `options`), and no `run` line. `/orca-feature` and `/orca-epic` show it as a question wake and answer it with `reply --id`, also on a timer check, which is otherwise quiet. No resume send, and no escalation-cap ask.
- **A note for a finished tab goes into the inbox.** `beast-mode orca note` sent a user message to the active tab even when that tab had already reported and the run waited on its ask or close. Orca then started a follow-up dispatch for the settled worker, the go-on line of the ask (`close --override`) closed it while it worked, and the same bug was worked twice (once by the orphaned follow-up, once by the inbox tab), or skipped. `note` now reads `worker-show` first: a worker that is done, failed, circuit-broken, or gone gets no send, and the message becomes an inbox line.
- **A close keeps a follow-up that a note started while it works.** When Orca refuses the release of such a follow-up as not settled (`dispatch_inactive`), `close` refuses `follow-up-working` and keeps the record. `--discard` drops it as before. Every other refused release still never blocks the clear.
- **A late wake after an Orca restart is documented, and a status question checks the run.** Orca holds a wake for an idle coordinator tab until it has seen that tab's agent status live again, so after an Orca update or restart the wake waits for the next user message. `/orca-feature` and `/orca-epic` now say so, and a user question about the state of the run while the run waits calls `next`, which reads the report from the files.

## [6.2.3] - 2026-11-20

Patch release. No migration script. `beast-mode upgrade` updates the orca skills (`/orca-feature`, `/orca-epic`); the other fixes are in the installer CLI.

### Fixed

- **A plan can start at Phase 0.** `beast-mode orca` accepts `--phase 0` and keeps Phase 0 as a real phase in the run record, the spec and verdict file names, the tab names, and the commit subject. Before, `next` named `--phase 0` and `start` refused it.
- **A dsh tab whose turn ended on an error is sent the resume text.** When an escalation said a dsh tab had stopped on an error (for example a provider 429) while one of its subagent sessions still wrote, `beast-mode orca next` applied the dsh wait (fix 2) and sent nothing. The subagent result does not restart a turn that failed, and Orca reports no later idle turn, so the run waited for ever. `next` now takes `--stop-reason`, and `/orca-feature` and `/orca-epic` pass the `stopReason` of the Orca message. An escalation with `--stop-reason errored` gets the resume send, still bound by the escalation cap. Any other stop reason keeps the dsh wait.
- **A deferred phase opens no tab.** A `## Phase <n>` heading of `tasks.md` that says DEFERRED, SKIPPED, NOT IN SCOPE, or OUT OF SCOPE is no phase of the run. Before, `next` started a worker tab for it after the last real phase.
- **A tab that stays open is named.** When Orca refuses the release of a tab that the run opened, the close step closes nothing and says that the tab stays open.

### Changed

- **Orca tabs get a short title.** Each new worker tab passes `--task-title`, so Orca shows a title such as `nebula-light: Phase 2 implement`, `nebula-light: review`, or `nebula-light: step /update-astrophysics` in place of the first sentence of the prompt. A retry keeps the title of its Task.

## [6.2.2] - 2026-11-19

Patch release. No migration script. `beast-mode upgrade` updates nothing on disk; the fix is in the installer CLI.

### Fixed

- **A worker spec is found on WSL2.** On WSL2, `beast-mode orca` passes `--spec-file` to the Windows Orca app in Windows form: `\\wsl.localhost\<distro>\...`, or a drive letter for `/mnt/<drive>/...`. The Windows app could not read the Linux path, so it did not find the worker spec. A call to `orca-dev` keeps the Linux path. Thanks to @FACTERINVURT (PR #11, issue #10).

## [6.2.1] - 2026-11-19

Patch release. No migration script. `beast-mode upgrade` updates the orca skills and the dsh glossary.

### Fixed

- **The plan tab asks its questions in its own tab.** The plan tab of `/orca-feature` and `/orca-epic` asks its planning questions in that tab, as a normal `/plan-feature` run does. It does not send them to the coordinator. A tab that waits on a person counts as busy, so the coordinator waits and sends no escalation.
- **A dsh tab submits the worker prompt.** dsh refuses Enter until its session opens, so the prompt stayed as a draft. `beast-mode orca start` now presses Enter every 2 seconds until the turn starts, for at most 45 seconds. It presses nothing when the tab waits on a person.
- **A dsh worker that waits on its own background subagent gets no resume and no escalation count.** The dsh `subagent` tool runs in the background, so the worker ends its turn while the subagent works. The coordinator now waits while a child dsh session of that workspace was written in the last 10 minutes. Progress (a drop in the open task count) resets the escalation count.
- **The dsh harness glossary describes the background `subagent` tool.** `templates/harness/dsh.md` says that the tool returns at once and that the result comes as a new message. It targets dsh 0.2.1-rc.3.
- **A finished worker tab closes.** Orca does not close a terminal that it did not create. `beast-mode orca start` opens a tab through a project agent command, so the tab stayed open after the worker finished. The close step now runs `orca terminal close` for that tab.

## [6.2.0] - 2026-11-18

Minor release. No migration script. `beast-mode upgrade` writes the three new skills.

The release carries the `orca-plugin` epic and its `orchestration` feature. The six `orca-plugin` entries sit below the three new entries. Each of them says "No version bump", because the version bump comes with this release.

### Added

- **`/orca-setup`, `/orca-feature`, and `/orca-epic`.** The 29th to 31st command skills. They run Beast Mode work as Orca agent tabs, one fresh tab per phase. `/orca-setup` writes the `orchestration` object of `.beast-mode/orca.json` (the agent of each stage, the commit rule, the lane rule, and the custom steps). `/orca-feature` builds one feature. `/orca-epic` builds a whole epic on its own branch. `/orca-feature` and `/orca-epic` take `$ARGUMENTS`, so the dsh adapter adds an arguments note to each. No autorun flow and no loop command calls them. A fresh manifest holds 48 entries. The live Orca runs are `MANUAL`: no desktop has proven them yet.
- **`beast-mode orca <step>`.** The seventh installer CLI command, in `installer/lib/orca/`. The steps are `next`, `branch`, `start`, `close`, `commit`, `merge`, `send`, `reply`, `note`, `detect`, and `config`. Each step prints one JSON object with `"schema": 1`. The coordinator tab runs the one action that `next` names, then calls `next` again. The scripts never push, pull, rebase, reset, or merge into the default branch.
- **The guide `docs/orca-orchestration.md`.** It lists what the run needs, the three commands, the `orchestration` settings, the custom steps, and the state rule.

- **Continuation reads for over-budget remote projects (`orca/src/remote/`, `orca/panel/index.html`, `orca/src/dev-scan.ts`)** — feature `orca-plugin/remote-continuation`, the follow-on of `remote-index`, shipped as a mini-epic feature. For a user, one thing changes: a big remote project now indexes to completion over a few automatic refresh rounds instead of showing the permanent `remote-budget` line — "The project needs more reads than the limit." — forever. A remote read is no longer all-or-nothing: each request drives at most one chunk of a continuation, the existing `pending` count answers carry the real remaining ("Scanning 499 more."), the tab drains hands-free, and the finished shard is what a single pass of the same tree would have written. No constant was raised (all four keep their values), there are no new settings, no new protocol member, no new storage key, and a project that fits today behaves byte-identically; the panel carries one two-operator change — the stall rule now stops on an EXACT equal pair, so an honest first exact count of a large tree keeps the loop draining while a genuine zero-progress cycle still shows the stalled line with Refresh. `node orca/src/dev-scan.ts` gains `--cycles n` for the headless drain proof. Suite 595/595 orca+web TS, npm 394/394, gate six PASS. No version bump — all three version fields stay `6.1.1` and the parity test holds.
- **The launch: nine command buttons, the project file, and the run ledger (`orca/src/launch/`, `web/src/backend/launch/`, `orca/panel/index.html`, `web/src/backend/index.ts`, `web/src/server/index.ts`)** — feature 5 of the `orca-plugin` epic. The Beast Mode tab gains an action row: `suggest-epic`/`suggest-feature` in the ready header, `plan-epic`/`autorun-epic` in each epic row, and the five feature commands in each Feature view — one press, the exact prompt `/<command> <target>`, submitted at once (epic decision 4). The worker resolves each agent in three layers — the project file `.beast-mode/orca.json`, the two family settings `planAgent`/`implementAgent`, the built-in table (plan family `claude`, implement family `dsh`) — and every button names its agent and layer. A remote project launches ON THE SERVER: one opt-in web-app route, `/api/launch/<project>`, that exists only with `BEAST_TOKEN` and runs the Orca CLI with argument arrays and no shell — the default `orca agent launch`, or for a project command the three-call `terminal create → wait --for tui-idle → send --enter` sequence, each outcome with its own honest line; a `GET` on the same path reads the server file for the view and the guard. A local project launches through `agent.launch`, and a project command rewrites THAT panel launch only, through a synchronous one-shot `agent.launch.before` table (the manifest's one `contributes.hooks` entry; the capability list still holds 8). The run ledger `runs/ledger` — the contract `runs-live` builds against — keeps one open run per target and checkout with the overlap rule, the 12-hour close on read, and Mark ended; blocked buttons go dark with a tooltip and a visible run line. Settings shows the resolved mapping read-only on remote, edits the local file merge-style (hand keys survive, a stale hash refuses, the ONE `node:fs` writer module renames a temp over the target), and saves the refresh interval and `notifyOnBlocked` through `settings.set`. A local workspace with no Beast Mode offers Install with Claude / Install with dsh. The protocol grows additively to fourteen requests; the shared rules live in one pure module with a byte-identical web copy pinned by test; a project whose file fails the schema gets disabled buttons and a problem list, never a guess. No version bump, no new capability, no dependency, no build step; no file under `templates/`, `installer/`, `commands/`, `dsh/`, or `hooks/` changes.
- **The web app as a second Orca panel index source, and the current-checkout tab rule (`orca/src/remote/`, `orca/src/docs/scan-project.ts`, `orca/src/view/handlers.ts`, `orca/panel/index.html`)** — feature 4 of the `orca-plugin` epic (closes BUG-026). With one `serverUrl` setting, the worker reads a running `@beast-mode/web` app with `GET` calls only — one origin, never a redirect — through a new reader seam under the core parser, so both sources share one parse path field for field. The tab now always shows the CURRENT project and worktree — the focused Orca workspace — for both sources: match by display name and branch, a storage-backed pick when the match cannot place it, focus following, and a local-first read when the workspace is on this machine. The Projects card list is gone. Every failure is a visible line; a stopped server still paints the cached index with its age; the bearer token lives in the Orca secrets store (`secrets:own`, the one sanctioned capability growth — the next load asks approval once) and appears in no answer, log, storage value, or painted text. New additive requests `source.token` and `source.pick`; dev commands `dev-scan --remote`, `--record`, `--check` with a committed recorded-answer fixture that detects web-API drift. No version bump, no dependency, no build step, no file under `web/`, `dsh/`, `templates/`, or `installer/` changes.
- **The Orca panel browse (`orca/panel/`, `orca/src/view/`, `orca/src/preview/`, `orca/src/dev-preview.ts`)** — feature 3 of the `orca-plugin` epic. The Beast Mode tab becomes a read-only browser over the core index: a Projects view (one card per readable Beast workspace, phase bar, open counts, every empty/loading/partial/error state with its own string), a Project view (the workspace list with the anchor marked, collapsed epic rows with summed tasks and built/bug counts, feature rows inside), a Feature view (phases with task bars, `**Demo:**`/`**Needs:**` lines, the current phase marked, open-item buckets), and one search box over `index.search` — a worker-ranked, capped hit list over the cached shards. `Open in Orca` and `Open file` ride two new never-rejecting worker requests whose every failure paints a visible line beside the press (desktop-only `unavailable` included); the panel still calls exactly one host method, `plugin.request`, all its painted strings live in one frozen `S` object, and every color comes from the 20 frame tokens. The protocol grows additively to seven requests (`view.project`, `open.workspace`, `open.file`, `index.search`); the manifest stays byte-identical. `node orca/src/dev-preview.ts` (`--serve <port> [--for <s>]`, `--theme`, `--hold`, `--query`) writes the browser-client preview page — the real panel bytes, the real srcdoc CSP and theme tokens, and a stub `window.orca` answering from the real request table — so a headless machine proves the panel over real answers; the live Orca tab stays a MANUAL line. No version bump, no capability, event, hook, or setting change, no dependency, no build step.
- **The Orca core index (`orca/src/docs/`, `orca/src/index/`)** — feature 2 of the `orca-plugin` epic. The marker rule (`.beast-mode/version.json`, `.claude/.beast-mode-version`, or the `docs/features/` fallback) classifies every workspace Orca can reach; a trimmed doc-parser copy inside `orca/` indexes epics (`epic-overview.md` as the sole marker), features, phase progress, `**Demo:**` lines, and open items — bugs, human-testing lines, inbox lines — as counts plus at most five trimmed lines per bucket, and never throws at a file. `index.snapshot` / `index.project` / `index.refresh` answer over one storage shard per project (`index/<sha1>`, 200 KiB self-limit, the trim ladder runs before the write, a 4 MiB prune line), with workspace-row folding, the lazy marker-mtime/TTL staleness rule, a per-request scan budget with visible `pending`, and the one-registration workspace-event fan-out `runs-live` reuses. The committed dev command `node orca/src/dev-scan.ts` (`<path>…` / `--discover` / `--snapshot` / `--fixture` / `--synthetic`) and the live-repo guard test pin the parser against this repo's own docs. One contributed setting, `indexRefreshMinutes` (default 10, 1…1440); no capability, no event, no version bump, no dependency, no build step.
- **The Orca plugin shell (`orca/`), the repo gate, and three-way version parity** — feature 1 of the `orca-plugin` epic. `orca/` boots as a real Orca plugin: manifest v2 (`trusted-worker`, the seven capabilities final at v1, the four-event budget), the `worker/main.ts` entry with one pure `index.snapshot` handler, one inline-HTML panel (`panel/index.html`, empty state + callout, no external fetch), and `src/protocol.ts` — the epic's frozen request contract with the `REQUEST_NAMES` drift guard. `scripts/orca-gate.sh` runs `orca plugin validate`/`check`, `tsc -p orca`, and the orca TS tests from `npm test`, each step one `PASS`/`FAIL`/`SKIP` line, skipping honestly per tool when `orca`, `tsc`, `node`, or Node type stripping is absent (bash ≥ 3.2; the npx tier probes `--no-install` and never downloads). `dsh/test/packaging.test.js` gains the three-way version-parity assertion: `package.json`, `.claude-plugin/plugin.json`, and `orca/orca-plugin.json` must bump together. No version bump, no install-footprint change, no new npm dependency.

### Changed

- **`/install-beast-mode`, `/upgrade-beast-mode`, and the two dsh skills.** Each offers `/orca-setup` when `beast-mode orca detect` reports `"offer": "setup"`.
- **`epic-resolution.md`.** It gains three rows in section 6.
- **`phase-handoff.md`.** It gains the reader note and a change to section 12 rule 3.
- **The epic overview template.** The Build Order section gains the group rule.
- **`plan-epic` and `update-epic`.** Both follow the group rule of the epic overview.
- **The installer tests.** `FOOTPRINT` expects 31 command skills and 48 manifest entries.
- **The version.** `.claude-plugin/plugin.json`, `package.json`, `package-lock.json`, and the `version` field of `orca/orca-plugin.json` read `6.2.0`. The `dsh/panel/` stamp reads `6.2.0`.

## [6.1.1] - 2026-10-21

Patch release. No migration script. `beast-mode upgrade` updates `tool-rules.md`, `phase-handoff.md`, `feature-orchestrator.md`, and `autorun-epic` when the user did not edit them.

### Fixed

- **A subagent runs each shell command in the foreground (BUG-022).** Rule 4 of `tool-rules.md` forbids a background command and a wait on one. A run over 10 minutes splits into several foreground runs. A child agent therefore does not end its turn while its own run goes on. The block keeps seven rules, at 177 words.
- **A subagent writes no report file (BUG-025).** Rule 1 of `tool-rules.md` puts the report only in the hand-back message. The harness blocked each report write, and each block cost a step.
- **The orchestrator waits for a child that waits on background work (BUG-023).** The new rule 7 of `feature-orchestrator.md` forbids a text-only turn while a child runs. On the notice, the orchestrator runs one foreground wait until the child hands back. Section 8 rule 6 of `phase-handoff.md` covers the same notice for every parent.
- **A retry of `/autorun-epic` waits for the last orchestrator (BUG-024).** Step 5a items 2 and 4 wait until no child agent of the last orchestrator runs. Only then does a fresh orchestrator start, so two agents do not edit the same files.

## [6.1.0] - 2026-10-09

Minor release. No migration script. `beast-mode upgrade` adds the `suggest-epic` skill, and it updates `epic-resolution.md` when the user did not edit it.

### Added

- **`/suggest-epic`.** The 28th command skill. It works like `/suggest-feature`, one level up. It surveys the project, treats each existing epic as one unit, and presents 2 to 4 new top-level epics, each with a draft list of child features. A pick creates `docs/features/<epic>/` and writes `epic-requirements.md` for `/plan-epic`. It never writes `epic-overview.md`, so the folder is not an epic until `/plan-epic` runs. A fresh manifest holds 45 entries.

### Changed

- **`epic-resolution.md`.** It gains the `suggest-epic` row.
- **The installer tests.** They expect 28 command skills and 45 manifest entries.
- **`/install-beast-mode` and the dsh install skill.** Both name 28 command skills, and both list `/suggest-epic` in the epic list.

## [6.0.1] - 2026-10-09

Patch release. No migration script. `beast-mode upgrade` updates `interview.md`, `plan-feature`, and `plan-epic` when the user did not edit them.

### Fixed

- **The stop check is a plain chat message.** Section 4 of `interview.md` no longer puts the stop check in a choose call. The dialog hid the assumption list, so the user saw `A1` to `A8` with no text. The command now prints the state line, the answers so far, and the assumptions, one line per item, and waits for the reply. Section 3 rule 6 no longer counts the stop check in the four-question limit per call.

## [6.0.0] - 2026-10-07

Major release. The `deterministic-loop` epic changes the loop in four features: `interview`, `slices`, `inbox`, and `review-session`. No migration script.

`beast-mode upgrade` adds `.beast-mode/interview.md` and updates the four changed skills and the architect when the user did not edit them. No project needs an upgrade step. A project that edited `plan-feature` keeps the old interview, and `interview.md` sits unused. The `slices` upgrade updates `phase-handoff.md`, `interview.md`, three doc templates, six skills, and the architect when the user did not edit them. A plan from before `slices` runs as before. A project that edited `phase-handoff.md` keeps the old file. There, section 10 is the command block, and no section 11 exists. Merge sections 4, 7, and 9 to 13 of the new file by hand. The `inbox` upgrade adds `.beast-mode/templates/inbox.md`, and it updates `phase-handoff.md`, six skills, and the orchestrator when the user did not edit them. The glossary in `.beast-mode/harness.md` always updates. A feature started before `inbox` has no `inbox.md`, and the first write creates it. The `review-session` upgrade adds the `review-session` skill, and it updates `epic-resolution.md` when the user did not edit it. A rule pick of `/review-session` edits `.beast-mode/tool-rules.md` or `.beast-mode/phase-handoff.md`, so a later upgrade skips that file.

### Added

- **The plan interview rules.** `templates/formats/interview.md` installs to `.beast-mode/interview.md`. A round holds at most four questions per call, and a stop check lists the assumptions before the plan starts. Section 8 holds the question set of each command. The install writes 8 format references.
- **The slice.** Section 11 of `phase-handoff.md` defines a phase as a slice: complete for one path, narrow, and sized to one or two task groups. It adds the base phase and the exit for a feature under about 8 tasks. Each phase carries a `**Demo:**` line and a `**Needs:**` line.
- **The post-phase step.** Section 10 of `phase-handoff.md` makes the verify, record, and hand-off steps one rule. The verifier ends with `Demo: PASS`, `FAIL`, `MANUAL`, or `none`. A manual run shows the test prompt, and an autorun shows it and goes on.
- **The inbox.** `docs/features/<feature>/inbox.md` is the inbox of a feature, from the new template `templates/dev-docs/inbox.md`. It holds one line per bug, note, or change (small, medium, or large). Section 12 of `phase-handoff.md` holds the rules, part 5 of section 10 acts on the lines, and the inbox sentence of section 7 goes into every subagent prompt. Section 12 rule 3 checks each user message at any point of a run: while an agent runs, with the answer to a test prompt, between two phases, and before the run ends. A fault, a change, or guidance gets one line and the answer `Noted, handled after this phase.` A question gets a short answer and no line. An open large change skips the fix rounds, and the feature stops at part 5.
- **The neutral term "send a message to an agent".** It maps to `SendMessage` on Claude Code and to `send_message` on dsh. The vocabulary holds 17 terms. The install writes 7 feature doc templates.
- **`/review-session`.** The 27th command skill. It reads the log of one session, not the code. A fresh agent ranks findings that each quote one step, and the command applies the picks as a pointer in the project instruction file, a check, or one rule line. No autorun flow calls it. A fresh manifest holds 44 entries.
- **`beast-mode transcript`.** The sixth CLI command, and the transcript mode of both readers. It prints the numbered steps of one session. With `--out <dir>`, it writes them to `<dir>/<session-id>.txt`. `/review-session` uses `.beast-mode/briefs/review-session/`. With no id, it takes the session that the harness names, else the newest parent log of this project. The token mode does not change.

### Changed

- **`/plan-feature` and `/plan-epic`.** An identical pointer block replaces the clarifying text. `/plan-epic` makes a draft feature set and a draft build order for the round.
- **The architect prompt of `/plan-feature`.** Step 7 pastes the tool rules and adds the Confirmed Assumptions block.
- **`solution-architect`.** The agent records the block as `### Confirmed Assumptions` under Key Technical Decisions.
- **`/autorun-feature` and `/autorun-epic`.** Neither command asks a planning question of its own. The interview of `/plan-feature` holds every planning question. Its research choice and approach choice run as before.
- **`/upgrade-beast-mode`.** The v4 notice names 5 format references, not 7. The v4 migration script holds a fixed list of five.
- **The installer tests.** They expect 27 command skills, 7 dev-doc templates, 8 format files, 44 manifest entries, and 17 terms.
- **The reader contract.** It gains the optional `transcript()`. A reader with no `transcript()` keeps serving `tokens`.
- **`epic-resolution.md`.** It gains the `review-session` row.
- **`/install-beast-mode` and the dsh install skill.** Both name 27 command skills, and both list `/review-session` in the start list.
- **The plan and task templates.** `implementation.md` and `tasks.md` carry the Demo line and the Needs line. They are plain lines, so no task count changes.
- **`/plan-feature` and `solution-architect`.** Step 7 pastes the Slice rules block. The architect cuts each phase into a slice and writes the Demo and Needs lines.
- **`interview.md`.** Section 8 asks the demo line of phase 1. A draft with no interview lists it as an open scope question.
- **`/start-feature`.** The command carries the Demo and Needs lines of each phase from the plan into `tasks.md`.
- **`/proceed` and `/proceed-advanced`.** After each slice, the command shows the test prompt and asks `It works` or `Something broke`. It runs up to three fix rounds for one fault. A phase with no demo and no UI shows no test prompt.
- **`/autorun-feature`.** The command shows the test prompt of each slice and goes on. It adds the demo to the human verification items of `context.md`.
- **`/autorun-epic` and `human-testing.md`.** Each slice adds a `- [ ] Phase <n> demo: <line>` item to the human testing checklist as the slice lands.
- **The post-phase step.** Part 1 runs every open bug line as one fix brief before the verifier, and a verifier `FAIL` writes a bug line. Part 3 treats any other fault, change, or guidance in a test answer as an inbox item. Part 4 no longer ends the step. Part 5 reads the inbox and acts on each open line. The canonical Phase handoff block moves to section 13.
- **`/start-feature`.** The command creates `inbox.md` from the new template.
- **`/proceed` and `/proceed-advanced`.** The commands note the fault, change, or guidance of each user message in the inbox, answer `Noted, handled after this phase.`, and act on the item after the phase.
- **`/update-feature`.** The command folds the done inbox lines into `context.md`. At the feature end, it files each open bug in `docs/bugs/`.
- **`/autorun-feature` and `feature-orchestrator`.** The command notes the fault, change, or guidance of each user message in the inbox and acts on them after each phase. The orchestrator never implements an item and never edits the plan, and a medium or a large change becomes a blocker.
- **`/autorun-epic`.** A medium inbox change stops the feature, asks one scope question, and builds the feature on. A large change ends the run. A resumed run keeps the resumed feature first in the run list, also when its `tasks.md` is complete.
- **`/install-beast-mode`.** The banner names 7 feature doc templates.

## [5.8.0] - 2026-10-06

Minor release. This is the second feature of the `claude-code` epic. The mod adds the `/dashboard` pane.

The mod needs Claude Code 2.1.287 or later. An older release keeps the skills and the commands. No project needs an upgrade step.

### Added

- **The `/dashboard` pane.** The command opens a docked pane with four views: the project, an epic, a feature, and a bug. A press on a row opens the next view. A Back button (hotkey `b`) returns to the last view. The view stack holds at most three routes. The project view mirrors the Feature Status table of `docs/overview.md`. The epic view mirrors the Features table of `epic-overview.md`. A folder that a table does not name shows as an unlisted row. The command starts no model request. Where no pane draws (`claude -p`, the VS Code chat panel), the command answers with the project view as text. `/dashboard` is a mod, not a command skill, so the count of 26 command skills does not change.
- **The progress bars.** The terminal shows a text bar. The other surfaces show one small `Svg` for each bar.
- **The action buttons.** A button fills the prompt with `/autorun-epic`, `/update-epic`, `/autorun-feature`, `/proceed`, `/continue-feature`, `/update-feature`, or `/fix-bug`. A button never submits the prompt. A press over typed text fills nothing and shows a toast.
- **The live redraw.** A second `tool.call` hook redraws the shown view after an Edit or a Write of a shown doc. The hook reads one file. The `/feature` pane keeps its own hook. The second `session.start` hook carries the matcher `{ isInteractive: [true, false] }`, because the host refuses a second hook on one event with no matcher.
- **The new lib files.** `hooks/lib/tables.ts`, `hooks/lib/bar.ts`, `hooks/lib/dashboard.ts`, `hooks/lib/moves.ts`, and `hooks/lib/layout.ts`. `hooks/read.ts` gains six loads.
- **The tests.** `claude plugin test .` runs 640 tests in 14 files. The count was 211 tests in 5 files.

## [5.7.0] - 2026-10-05

Minor release. This is the first feature of the `claude-code` epic. Beast Mode now ships a Claude Code mod. The mod adds the `/feature` pane.

The mod needs Claude Code 2.1.287 or later. An older release keeps the skills and the commands. No project needs an upgrade step.

### Added

- **The `/feature [name]` pane.** With no name, the pane shows the feature with the newest `**Last Updated:**` stamp in `tasks.md`. With a name, it resolves the name with the epic resolution rules. The pane shows the path, the status, the progress, the current phase with its tasks, and the open bugs. It redraws after an Edit or a Write of the shown docs or of a bug file. It starts no model request. Where no pane draws (`claude -p`, the VS Code chat panel), the command answers with the same lines as text. `/feature` is a mod, not a command skill, so the count of 26 command skills does not change.
- **The hooks module.** `hooks/hooks.json`, `hooks/register.tsx`, `hooks/read.ts`, and `hooks/lib/`. `register.tsx` holds the hooks and `readsOf($)`, the one place that touches `$.fs` (read, list, stat, no write). `read.ts` takes that `Fs` object and holds no `$`. `hooks/lib/` holds pure functions with no `$`. No file holds `import()`, `require`, or a `node:` import.
- **The contract `types/index.d.ts`.** It types the state under `PluginState['beast-mode']`, with the `FeaturePane` prefix and the `Shaped` tag.
- **The tests.** `tests/`, 211 tests in 5 files. Run them with `claude plugin test .`.
- **The gate.** At the plugin root: `claude plugin validate .`, `web/node_modules/.bin/tsc -p .`, and `claude plugin test .`. The root `tsconfig.json` holds the compiler settings.

### Changed

- **The manifest `types` key.** `.claude-plugin/plugin.json` gains `"types": "./types/index.d.ts"`. No fact 1 fallback was applied, so the manifest keys `discordBridge` and `desktopMcpServer` stay.
- **The deploy allowlist.** `scripts/deploy-public.sh` adds `hooks/`, `types/`, `tests/`, and `tsconfig.json`. The generated `.claude-plugin/types/` stays private.
- **`dsh/build.mjs`.** Both esbuild calls pass `tsconfigRaw: {}`, so the dsh build ignores the root `tsconfig.json`.

## [5.6.1] - 2026-09-22

Patch release. The delegator now stays out of the verification work. A measured dsh run on 5.6.0 put 59 percent of its prompt tokens in the parent context, because the parent ran the tests, wrote its own browser probes, and read source files to find a fix.

### Added

- **The delegator rules.** `templates/formats/phase-handoff.md` section 8. The parent reads no source file and no test file. It runs no type-check, no test, and no browser check. A failed gate goes to a fix subagent with the error text in the brief. The parent updates `tasks.md` and `context.md` with the edit tool.
- **The verification brief.** `templates/formats/phase-handoff.md` section 9. After the last group of a phase, the delegator writes one `<phase>-verify.md` brief and starts one verifier subagent. The verifier changes no file, and it returns `PASS`, `FAIL` with the error text, or `BLOCKED`. A fix brief takes the suffix `-fix<n>`.

### Changed

- **`/autorun-feature` steps 5b and 5c.** The verifier subagent runs the automated gate and the UI check. The parent writes the brief, reads the result, and delegates a fix. Step 5d uses the edit tool for the docs.
- **`/proceed` and `/proceed-advanced`.** Both delegate the gate to a verifier subagent, and neither runs the type-check itself. Both update the docs with the edit tool.
- **The dsh glossary row for delegation** states `run_in_background: false`. A measured run spent 15.6M prompt tokens in 67 `sleep` poll steps of the parent. Delegator rule 6 in `phase-handoff.md` states the blocking wait for every harness.
- **The `## Phase handoff` block** of the three delegator commands gains one sentence that names the delegator rules and the verification brief. The block stays identical in the three files.

## [5.6.0] - 2026-09-18

Minor release. This is the sixth feature of the `harness-support` epic. Beast Mode now tracks token use per session. Each subagent prompt now carries a short tool-rules block.

### Added

- **Two new shared reference files.** `templates/formats/tool-rules.md` and `templates/formats/phase-handoff.md`. They install to `.beast-mode/tool-rules.md` and `.beast-mode/phase-handoff.md`. The tool-rules file holds seven rules, under 200 words. The handoff file holds the task group split, the stop rule, the phase brief format, the brief path `.beast-mode/briefs/<feature>/<phase>.md`, and the code review grouping.
- **Six new neutral terms.** The vocabulary grows from ten terms to sixteen: edit a file, write a file, read a file range, run a shell command, evaluate in the browser, and take a page snapshot. Both glossaries hold 16 rows.
- **The `## Phase handoff` block.** `/proceed`, `/proceed-advanced`, and `/autorun-feature` hold one identical block. They split a phase into task groups, write a phase brief, and paste the tool rules into each subagent prompt. `/autorun-epic` gets the change through `/autorun-feature`.
- **`beast-mode tokens [--json] [--days <n>]`.** The fifth installer CLI command. It holds the reader contract, and it ships both the Claude reader and the dsh reader. Flags: `steps-over-100` and `final-prompt-over-300k`.
- **`/token-report`.** The 26th command skill.
- **The root `package.json` `bin` field**, for `beast-mode`.
- **The web Tokens tab.** `GET /api/tokens/:project`, the page `/projects/:name/tokens`, and the `BEAST_MODE_CLI` variable.
- **The Claude token reader**, `installer/readers/claude.js`. It reads the session logs under `~/.claude/projects/<project>`, and it reports the session count, the step count, and the token sums. **Three Playwright MCP glossary rows.** `templates/harness/claude.md` maps the browser terms of the tool-rules block to Playwright MCP.
- **The dsh token reader**, `installer/readers/dsh.js`. It reads the session logs under `~/.dsh/sessions/<project key>/`, and under `$DSH_HOME/sessions/<project key>/` when the user sets `DSH_HOME`. It reports the same session count, step count, and token sums. The dsh glossary adds the delegation rule that passes the model route to a child. The dsh install skill adds the model selection hint that asks the user which model the dev agents take.

### Changed

- **The installer appends `.beast-mode/briefs/` to `.gitignore`**, with a per line check.
- **The agent example, both install texts, and both upgrade texts** point a dev agent at the phase brief and at `.beast-mode/tool-rules.md`. The upgrade command offers the edit for an old dev agent. No project must regenerate a dev agent.
- **New effort presets.** Max (`xhigh`), High (`high`, the default), Medium (`medium`). A standard dev agent runs on `sonnet` at the preset effort. Every other role runs on `opus` at the preset effort. The upgrade command reads the current `model` and `effort` of each agent, names the current preset, and offers a switch. It changes an agent only after the answer. `feature-orchestrator.md` stays fixed.

## [5.5.0] - 2026-09-17

Minor release. This is the fifth feature of the `harness-support` epic. The Beast Mode dashboard now runs inside the dsh web UI.

### Added

- **The dsh web panel.** A "Beast Mode" tab appears on the conversation view of the dsh web UI. The tab shows the whole Beast Mode dashboard for the project of the current session's workspace.
- **Two host routes, behind the dsh web gate.** `/beast/api/` serves the Beast Mode API. `/beast/ui/` serves the prebuilt dashboard SPA. Both share the dsh origin, so no CORS header applies. Each route calls `requestRejection` on the dsh `connection` service first, so an unauthenticated caller reads neither route. A gate that is absent closes both routes with 503.
- **Ten run buttons.** A feature page shows seven buttons: Continue, Autorun, Update, Review, Evaluate, Fix, and Document. An epic page shows three: Autorun, Update, and Review. Each click starts a new dsh session and queues the matching command.
- **The plain editor mode.** A textarea with a Write and Preview toggle replaces the rich Tiptap editor inside the panel. Tiptap never mounts in this mode.
- **`dsh/build.mjs`.** The build script writes three artifacts into `dsh/panel/`: the API bundle, the SPA, and the client bundle. Git tracks every artifact, so a dsh install runs no build step.
- **Four additive `@beast-mode/web` seams.** A `runner` seam, a plain `editor` mode, a `basename` option, and a marker-first version read. Every seam stays inert for the Discord bot and for the standalone server.
- **`docs/dsh-web-panel.md`.** The guide to the tab, the two routes, the run protocol, and the build script.

### Changed

- **The root `package.json`.** It gains `exports`, `dsh.client`, and the `esbuild` devDependency. `dependencies` stays absent. The `files` array gains two negation entries, `!dsh/src/` and `!dsh/test/`, so the build inputs and the dsh test suite stay out of the npm tarball.
- **A Claude Code install and a consumer project change in no way.** The installer, the adapters, the 25 command skills, and the templates stay unchanged.

To update the panel on dsh: `dsh plugin --profile <name> update beast-mode`, then reload the web UI.

## [5.4.0] - 2026-09-15

Minor release. This is the fourth and final feature of the `harness-support` epic. Several harnesses now share one project with no conflict.

### Added

- **`.beast-mode/version.json`.** The shared marker records the installed harness set: each harness id, its root, and its version. The core owns the file. No harness owns it and no manifest lists it.
- **The composed glossary.** The core builds `.beast-mode/harness.md` from the glossary of every harness in the marker. One harness produces the source bytes unchanged. Two or more produce a preamble and one section per harness, in adapter id order.
- **`beast-mode upgrade` with no harness.** The command upgrades every installed harness in one run and prints one roll-up section. It exits with the highest per-harness exit code.
- **`beast-mode status`.** A fourth CLI command. It reports the plugin version, every installed harness, and a stale flag per harness. It writes nothing.
- **The stale-install warning.** `install <harness>` and `upgrade <harness>` name any other harness that falls behind the plugin version. Each warning names `beast-mode upgrade` as the fix.
- **The conformance test, `installer/test/conformance.test.js`.** It renders both harnesses. It asserts that the two outputs share the same skill set, the same agent set, and the same glossary shape.
- **`scripts/conformance-live.sh`** and **`scripts/conformance-diff.sh`.** The live script builds a two-harness fixture project. It prints the manual steps for a human to run one workflow on each harness. The diff script compares the two `docs/features/` outputs by file set, heading outline, and required sections only. It never compares body text.
- **`docs/multi-harness.md`.** The guide to the marker, the composed glossary, the all-harness upgrade, `status`, and the conformance procedure.

### Changed

- **The glossary leaves the manifest.** `.beast-mode/harness.md` is now a core-synthesized file with the kind `shared`. A fresh manifest holds 37 entries, one fewer than before.
- **A one-harness install sees no glossary change and needs no manual step.** The composed file stays byte-identical to `templates/harness/<id>.md`. A Claude Code upgrade from 5.3.0 reports no change to `harness.md`.
- **The instruction-file rule.** `AGENTS.md` holds shared project guidance. `CLAUDE.md` holds one line, `@AGENTS.md`.

This release closes CR-4, CR-15, and CR-21.

## [5.3.0] - 2026-09-14

Minor release. This is the fourth feature of the `epics` epic. Beast Mode can now build a whole epic in one command.

### Added

- **`/autorun-epic <epic-name>`.** The command skill runs a whole epic to completion. It plans each feature, delegates each feature build to a fresh agent, commits, fast-forwards the base branch, and pushes per feature, commits the epic rollup docs at the end, and asks the user at each planning gate only.
- **The `feature-orchestrator` agent.** The second shipped agent, at `templates/agents/feature-orchestrator.md`. One fresh agent builds one feature to the end and returns a structured report. Its `model` and `effort` are fixed at `opus` and `xhigh`.
- **`docs/features/<epic>/human-testing.md`.** `/autorun-epic` collects the manual test items of every feature into one checklist, appended per feature.

### Changed

- **The called mode of `/autorun-feature`.** When `/autorun-epic` calls the command, it makes no git write, drafts the plan of the next feature, asks nothing, and ends with the structured report. The standalone behavior of `/autorun-feature` does not change.
- **`templates/formats/epic-resolution.md`** gains one clause row for `autorun-epic`.
- **The whole-epic option of `/autorun-feature`** now runs the `/autorun-epic` command, instead of looping over the child features in one context.

The upgrade needs no manual step. An existing install gains the new skill folder and the new agent file through the normal upgrade path.

## [5.2.0] - 2026-09-10

Minor release. This is the third feature of the `harness-support` epic. Beast Mode now runs on DeepSeek Harness (dsh) as well as Claude Code. **A Claude Code install gains no file and loses no file.**

### Added

- **`installer/adapters/dsh.js`.** The second adapter of the installer CLI. It renders the 24 command skills into `.agents/skills/<name>/SKILL.md` and the shipped agent into the flat file `.agents/skills/solution-architect.md`.
- **The `dsh/` bundle.** `dsh/cordis.patch.yml` mounts an ES module skill provider at `dsh/lib/index.js`. A dsh user adds the bundle with `dsh plugin --profile <name> add beast-mode`.
- **Two dsh skills.** `dsh/skills/install-beast-mode/SKILL.md` and `dsh/skills/upgrade-beast-mode/SKILL.md` give a dsh user `/install-beast-mode` and `/upgrade-beast-mode`, the same entry points a Claude user has. Both call the installer CLI.
- **The root `beast-mode` npm package.** One `package.json` at the repo root names the package, declares `dsh.bundle.patch`, and lists the shipped paths. No copy step and no second package exist.
- **The finished dsh glossary.** `templates/harness/dsh.md` pins `DeepSeek Harness 0.1.5-rc.1` and names `web_search` and `web_fetch`.

### Changed

- **The dsh glossary leaves Draft state.** `templates/harness/dsh.md` now holds no `**Status:** Draft` line.
- **The repo now holds a root `package.json`.** Its version must match `.claude-plugin/plugin.json`, and a unit test asserts the pair.
- **Three core fixes in `installer/lib/plan.js`.** A `null` frontmatter map now keeps the source header bytes even when the body changes, the `.gitignore` backup line now derives from each harness root, and the install summary now names the real agent directory.
- **The Claude glossary drops the dsh mention.** `templates/harness/claude.md` no longer names dsh in its nested-skill note, so an upgrade from `5.1.0` reports one updated file.

To install on dsh: `dsh plugin --profile <name> add beast-mode`, then `/install-beast-mode`.

## [5.1.0] - 2026-09-10

Minor release. This is the second feature of the `harness-support` epic. It replaces the bash install script with a Node.js CLI, `installer/`, that any harness adapter can drive. **The upgrade runs automatically. It needs no manual step.**

### Added

- **`installer/`.** A Node.js CLI with zero dependencies, built for Node.js 20 or later. It reads the harness-neutral source under `templates/`, renders it through a per-harness adapter, and writes the result to a project.
- **Three commands.** `install <harness>` writes a fresh project layout. `upgrade <harness>` compares the project against the last install and updates only what changed. `render <harness> --out <dir>` writes the rendered tree into an arbitrary directory, for testing and for a future conformance check.
- **The adapter interface.** `destination`, `mapFrontmatter`, `renderBody`, `extraFiles`, and `check`. A harness author writes one adapter file and adds one registry line to add a new harness, with no core edit. The Claude Code adapter ships here, and it is copy-shaped: it changes no placeholder, no frontmatter key, and no byte.
- **A per-harness manifest.** `.claude/.beast-mode-manifest.json` lists every file the CLI wrote, plus the sha256 of the written content. An upgrade reads the manifest to tell a Beast Mode file from a file the user edited.
- **`--dry-run`.** `install` and `upgrade` both support it. It prints the full write plan and changes nothing, not even the manifest.
- **`--force`.** `upgrade` only. It overwrites a file the user edited, after it backs the old copy up.
- **The backup directory.** `.claude/.beast-mode-backup-<timestamp>/`. Every overwrite, every forced write, and every prune backs the old file up first.
- **A prune step.** `upgrade` deletes a file the plugin stopped shipping, when the file's hash still matches the manifest. It backs the file up first.
- **Seven exit codes.** Each one carries a cause and a fix line, so a calling command can branch on the result instead of parsing text.
- **Three guards.** A symlink guard, a plugin-repo guard, and a same-root guard. `install` and `upgrade` refuse to run in a repo that dogfoods Beast Mode through symlinks, or in the Beast Mode repo itself.

### Changed

- **`/install-beast-mode`** and **`/upgrade-beast-mode`** now call the installer CLI instead of a bash script. A Claude Code install now needs Node.js 20 or later.
- **`install`** exits 7 on a project that already holds a manifest, and it names `upgrade` as the next step.
- **The upgrade runs with no manual step.** The first upgrade after this release writes the manifest. On a project installed before `5.1.0`, that first upgrade adopts every file whose disk content already matches the plugin source, skips a file that differs, and reports the skip. It also names `upgrade claude --force` in its summary, which takes the plugin copy of every skipped file after it backs each one up.
- **`/upgrade-beast-mode` Step 15** now checks for `.beast-mode/templates/README.md` and `.beast-mode/templates/plan.md`. A project installed before `5.1.0` keeps these two stale files. The CLI cannot prove Beast Mode wrote them, so the step offers to delete them by hand.

### Removed

- **`scripts/install-templates.sh`.** The installer CLI replaces it. Run `node ${CLAUDE_PLUGIN_ROOT}/installer/bin/beast-mode.js install claude` in its place.

## [5.0.0] - 2026-09-10

Major release. This is the first feature of the `harness-support` epic. It converts every command, agent, and shared reference into a **harness-neutral** source. A non-Claude harness can now install Beast Mode from the same repo. **The upgrade runs automatically. It needs no manual step.**

### Added

- **`templates/skills/<name>/SKILL.md`.** All 24 commands now ship as Agent Skills bundles, one folder per command, in the Agent Skills format. Each `SKILL.md` carries `name`, `description`, `argument-hint` where it applies, and user-invocable command skills that the model can also run. This replaces `templates/slash-commands/<name>.md`, which no longer exists.
- **`.beast-mode/`.** This new shared project directory holds every file that a harness reads. It carries `epic-resolution.md`, the format references, the dev-doc templates under `.beast-mode/templates/`, and the new harness glossary at `.beast-mode/harness.md`. `.claude/` now holds only Claude Code output: `.claude/skills/`, `.claude/agents/`, and `.claude/.beast-mode-version`.
- **The harness glossary.** `templates/harness/claude.md` installs as `.beast-mode/harness.md`. A first `templates/harness/dsh.md` draft covers DeepSeek Harness. Each glossary maps ten neutral terms to the real tool names of one harness.
- **The ten-term neutral vocabulary and a `## Harness` block.** A command body now writes a neutral term. It no longer names a Claude tool. The ten terms: ask the user to choose, delegate to an agent, run a command, load a skill, search the web, the harness skills directory, the harness agents directory, the project instruction file, the browser automation tool, and `$ARGUMENTS`. A byte-identical `## Harness` block in all 24 skills points at `.beast-mode/harness.md`.
- **`docs/harness-neutral-source.md`.** This is the layout contract that a later `installer-cli` feature reads. It states the source tree, the installed tree, the skill and agent frontmatter contracts, the ten terms, the canonical `## Harness` block, and the glossary file format.
- **`scripts/dev-link.sh`.** This script rebuilds this repo's dogfood symlinks after the layout move: `.claude/skills`, `.claude/agents`, `.beast-mode/templates`, `.beast-mode/<format>.md`, and `.beast-mode/harness.md`.
- **`scripts/migrate-v4-to-v5.sh`.** `/upgrade-beast-mode` runs this script before the file copy, with no user action needed. It backs up `.claude/commands/`, `.claude/templates/`, and the format files into `.claude/.beast-mode-backup-<timestamp>/`. It moves the shared files into `.beast-mode/` and deletes only the command files that the plugin ships. It keeps every hand-written command file in place. A second run reports no work to do.

### Changed

- **`/install-beast-mode`** and **`/upgrade-beast-mode`** now write `.claude/skills/`, `.claude/agents/`, and `.beast-mode/`. Neither writes `.claude/commands/` or `.claude/templates/` on a fresh install.
- **`.claude-plugin/plugin.json`** now reads `5.0.0`.

### Removed

- **`templates/slash-commands/`,** the `.claude/commands/` install target, and the `.claude/templates/` install target. The 24 commands and the shared files now live at the paths named above.
- **`templates/dev-docs/README.md`** and **`templates/dev-docs/plan.md`.** Both described the `dev/active/` layout that v2.0 removed. Neither file had a reader left in the plugin.

## [4.1.2] - 2026-07-25

Patch release. Refines `/plan-feature`'s research step so it defaults to a lightweight web search and only escalates to deep research when the decision genuinely warrants it — and ensures **all research completes before the solution-architect handoff**, since that agent has no web/research access.

### Changed

- **`/plan-feature` Step 4b** now offers **quick web search** (recommended, via the `WebSearch` tool) vs **deep research** (via `/deep-research`, for high-stakes calls) vs **no research** — replacing the old "run deep research now / have the solution-architect do it / no" choice. It no longer defers research to the architect.
- **Research findings flow into the plan as data, not a delegated task.** Whatever research the main thread runs is summarized and passed into the solution-architect prompt as a new **Research Findings** block; the architect cites it in Key Technical Decisions.
- **`solution-architect` template** — its "Deep Research (when asked)" step is replaced with "Incorporate Provided Research": the agent is told it has no `/deep-research`/workflow access, works from the provided findings, and may only use `WebSearch` for light verification. Also updated the advanced-vs-standard routing hint to phrase the distinction as effort (both tiers are `opus`).

## [4.1.1] - 2026-07-18

Patch release. Replaces the per-agent effort ladder with **three effort presets** — `Max` (default, recommended), `High`, and `Medium` — tuned against the latest DeepSWE benchmark results. With **Opus 5** released, Beast Mode now runs **every agent on `opus`** and retires `sonnet`: standard dev agents run on `opus` @ `medium` in all three presets, and a single question at setup sets how hard the high-leverage agents (solution-architect, advanced dev, reviewers) think. **Backwards-compatible:** existing installed agents are untouched until you re-run setup/upgrade.

### Changed

- **All Beast Mode agents now run on `opus`; `sonnet` is retired.** Standard dev agents run at `medium` effort (the plan already carries the architectural thinking); the high-leverage agents run at the preset's effort.
- **`/install-beast-mode` Step 4b** now asks a single "effort preset" question — `Max` → `max`, `High` → `xhigh`, `Medium` → `high` for the high-leverage agents (standard dev fixed at `medium`) — instead of the two-step "pick MAX, then derive standard-dev effort" flow. The downstream `<MAX>`/`<DEV>` placeholders used in agent creation are unchanged.
- **`/upgrade-beast-mode`** mirrors the same preset question and migrates existing standard dev agents from `sonnet` to `opus` @ `medium`.
- **Docs** — `agent-structure-example.md` (Model & Effort Policy) and the `solution-architect` template now describe the preset model. Dropped `ultracode` and the "2 steps below MAX" derivation from Beast Mode's effort guidance; the `Max` preset tops out at `max`.

---

## [4.1.0] - 2026-07-17

Minor release. Extracts Beast Mode's browser dashboard out of the Discord bot into a standalone, reusable, infrastructure-agnostic package — **`@beast-mode/web`** — adds a lightweight standalone server plus two plugin commands, and adds `/autorun-feature`. **Backwards-compatible:** the bridge-served dashboard, every `/api/*` contract, the `/auth/*` OAuth2 flow, and the desktop MCP server are unchanged; existing installs are untouched.

### Added

- **`@beast-mode/web` — reusable web-app package** (new repo-root `/web`). One package, three subpath exports: `@beast-mode/web/backend` (the dashboard's route handlers + feature/bug stores behind an injected `ProjectProvider` + optional `AuthMiddleware` — no bot/Discord/registry coupling and no module-global state), `@beast-mode/web/frontend` (the React dashboard behind `<BeastWebProvider>` with injectable API-client / auth / routing adapters; React·ReactDOM·react-router-dom as peers; Tailwind shipped as a preset + a prebuilt `@beast-mode/web/styles.css`), and `@beast-mode/web/server`. Built dual ESM+CJS with types (`publint` + `@arethetypeswrong/cli` clean); publish-ready but consumed locally in v1.

- **Standalone dashboard server** (`@beast-mode/web/server` + the `beast-web` CLI) — a lightweight Hono app that serves the dashboard on its own from a `.env` (`BEAST_PROJECTS`, `PORT`, `BEAST_HOST`, optional `BEAST_TOKEN` bearer gating), single- and multi-project, running under Node (`@hono/node-server`) or Bun. Filesystem state only; no database.

- **`/setup-web-app`** — plugin command that discovers the Beast Mode projects on your machine (or asks where to look), writes a `.env`, and installs an always-on background service for the standalone dashboard via your OS's service manager (launchd / `systemd --user` / Task Scheduler·NSSM·pm2). Idempotent; localhost-bound by default.

- **`/integrate-web-app`** — plugin command that scaffolds a `requirements.md` to embed the dashboard into your own app (detecting an admin section, placing the feature inside a dev-ops-like epic if one exists) and hands off to `/plan-feature`. Writes no implementation.

- **`/autorun-feature [feature-name]`** - Autonomously run a feature to completion with minimal human intervention, stopping only when genuinely blocked. Epic-aware and fully project-agnostic (`<epic>/<feature>` resolution; no hardcoded stack, tooling, agents, or URLs). Runs the whole lifecycle: if there's no `implementation.md` it plans from `requirements.md` via `/plan-feature` (batching any material scope gaps into a single question) and scaffolds docs via `/start-feature`, then drives the phase-by-phase loop from `tasks.md`. For each incomplete phase it delegates the implementation to an agent (one at a time, advanced tier for load-bearing / plan-flagged phases), runs the project's type-check/build/test gate, verifies user-facing UI via a browser MCP, updates `tasks.md`/`context.md`, commits the phase, then runs `/review-feature` and fixes every `CR-N` finding before moving on. After the final phase it does a cross-phase `/review-feature`, `/update-feature`, and `/update-master`. Strict safety rails: it commits locally on the feature branch only (never the main/default branch, tags, deploy, or release) and **stops before pushing** — it hands the branch back for the user to push / open the PR. Stops and prompts the user on any blocker (MCP unreachable, repeated gate failure, missing credential/prerequisite, irreversible/outward-facing action, merge conflict). Resumable: re-running it picks up from the first incomplete phase. Composes the existing `/plan-feature` -> `/start-feature` -> `/proceed` -> `/review-feature` -> `/update-feature` -> `/update-master` commands into one hands-off run. Also available over the Discord bridge as `/beast autorun [feature]`.

### Changed

- **The Discord bot is now a consumer of `@beast-mode/web`.** The bot's seven backend modules (`api-projects` / `api-features` / `api-epics` / `api-bugs` / `api-git`, `feature-store`, `bug-store`) and its `bot/web/src` React app were removed; `bot.ts` now mounts `@beast-mode/web/backend` — injecting its project registry as a `ProjectProvider` and its Discord OAuth2 as the auth gate — and `bot/web` is a thin shell around `@beast-mode/web/frontend`. Internal refactor only: the bridge-served dashboard, every `/api/*` URL and response shape, the `/auth/*` OAuth2 flow, and the desktop MCP server's contract are all unchanged.

---

## [4.0.0] - 2026-06-16

---

Initial public release

---

## [3.1.1] - 2026-06-05

---

### Fixed

Added type-awareness to various commands

## [3.1.0] - 2026-06-04

Minor release. Adds **epics** — the ability to group related features into a single folder under `docs/features/<epic>/`. Introduces four new commands, retrofits epic-awareness into all 19 existing slash commands without changing how they work for plain features, and adds a grouping suggestion to `/upgrade-beast-mode`. **Fully backwards-compatible:** with no epics in a project every command behaves identically to v3.0.0.

### Added

- **`/create-epic <name> <prompt>`** — Migrate existing prefixed features (e.g. `editor-base`, `editor-ux`) into an epic folder. Discovers candidate features by prefix/theme, computes the full plan (folder moves + un-prefixing + reference rewrites + master-overview migration), and requires an explicit preview/confirm via `AskUserQuestion` before touching a single file. Surfaces rename collisions and over-generic names (e.g. bare `base`) for the user to resolve; confirms nothing silently. After confirmation: moves folders with `git mv`, rewrites references, creates `epic-overview.md` from the template, and migrates `docs/overview.md` to a single epic row (targeted Edits only — never a whole-file rewrite).

- **`/plan-epic <name> [prompt]`** — Plan an epic from scratch. Reads `epic-requirements.md` if present (re-run = refine, not error), otherwise uses `<prompt>` or asks. Works with the user at the epic level to agree on the feature set and build order, then creates `epic-overview.md`, `epic-requirements.md`, and ordered feature subfolders each with a `requirements.md` in the exact shape `/plan-feature` consumes. Handoff lists the exact `/plan-feature <epic>/<feature>` commands in build order.

- **`/update-epic [name]`** — Refresh an epic's `epic-overview.md` (Features table, Build Order, Integration notes, Master Overview Rollup, timestamp) from session context or `git log` since the last update, then updates the epic's single rollup row in `docs/overview.md`. Uses targeted Edits only; the Tech Debt / Findings section is explicitly read-only here (owned by `/review-epic`).

- **`/review-epic <name>`** — Holistic cross-feature architecture/integration review of an epic (distinct from `/review-feature <epic>`, which is a deep code pass). Reads `epic-overview.md` + every child feature's docs; produces cross-feature integration/architecture findings and per-feature tech-debt items; writes them via targeted Edits into `epic-overview.md`'s Tech Debt / Findings section and into affected child `context.md` files.

- **Epic folder model** — An epic lives at `docs/features/<epic>/`, contains an `epic-overview.md` marker (the single machine-detectable signal), and holds one or more feature subfolders (`implementation.md` / `context.md` / `tasks.md`). Epics do not nest; `<epic>/<feature>` is the deepest reference path.

- **`templates/formats/epic-resolution.md`** (installed to `.claude/epic-resolution.md`) — the single source of truth for epic detection (marker rule), reference resolution (`<epic>/<feature>` slash; bare epic name; fuzzy fallback for a bare feature name not at the top level), epic-context-loading rule, and the `/create-epic` reference-rewrite convention. All 23 commands point to this file via a small, standard "Epic awareness" block; no epic logic is duplicated across commands.

- **`templates/dev-docs/epic-overview.md`** — template for the `epic-overview.md` marker file (Purpose, Features table, Build Order/Dependencies, Integration & Architecture, Tech Debt/Findings, Master Overview Rollup, timestamp).

- **`templates/dev-docs/epic-requirements.md`** — template for epic-level requirements (mirrors the per-feature `requirements.md` shape plus a Planned Features build-order list).

### Changed

- **All 19 existing slash commands are now epic-aware** via a standard "Epic awareness" block that instructs Claude to read `.claude/epic-resolution.md` and apply its rules. Changes are additive (zero deletions in the 15 retrofitted files), gated on the presence of `epic-overview.md`, and verified backwards-compatible:
  - `continue-feature` — adds whole-epic summary mode (bare epic name → read `epic-overview.md` + all child statuses, summarize, suggest next steps) and feature-in-epic context load.
  - `plan-feature` — loads epic context (epic-overview + all sibling `implementation.md`/`context.md`) before planning when the target is inside an epic; passes that context into the solution-architect prompt.
  - `start-feature` — resolves `<epic>/<feature>` to the nested path; loads epic context.
  - `proceed`, `proceed-advanced` — resolve the current feature's nested path.
  - `update-feature` — resolves `<epic>/<feature>`; auto-detect may land on a nested feature.
  - `update-master` — epics roll up to one row (reads `epic-overview.md` Master Overview Rollup; child features are never listed individually); flat index buckets an epic as one aggregate entry.
  - `review-feature`, `review-ux`, `review-ui`, `review-mobile` — each gained an Epic-scope mode: when the target is an epic, review runs across all the epic's features with per-feature attribution preserved (namespaced finding IDs, one aggregated report per command).

- **`/upgrade-beast-mode`** — added **Step 10c** (epic migration suggestion): after the v3 migration step, scans `docs/features/*` for prefix-sharing groups (≥2 features sharing a `<prefix>-` stem; skips dirs that are already epics). For each group found, suggests running `/create-epic <prefix> ...` via `AskUserQuestion` (default: "Remind me later"). Never runs `/create-epic` automatically; declining leaves everything working exactly as before. Silent when no prefix-sharing groups are found.

- **`/install-beast-mode`** — Step 9 summary now lists the four epic commands.

### Out of Scope / Deferred

- **Web App epic support** and **Discord bridge epic support** — the `epic-overview.md` marker design accommodates these (both will use the same `test -f` contract), but the implementations are deferred to a later feature. Existing Web App and Discord bridge functionality is unchanged.
- **Nested epics** — by design, epics contain features only (no sub-epics). `<epic>/<feature>` is the deepest reference path.

---

## [3.0.0] - 2026-06-02

Major release. Adds per-agent **model + effort tuning**, a second **"advanced" tier** of dev agents, smarter `/proceed` routing, the new `/proceed-advanced` command, optional **`/deep-research`** integration, and a new set of review commands. **Existing projects must run `/upgrade-beast-mode`** to migrate their agents (the upgrade asks for effort levels, adds `effort` fields, and creates the advanced agents).

### Added

- **Agent effort system** — every agent now carries an `effort` field (`low` → `medium` → `high` → `xhigh` → `max` → `ultracode`, the last being opus-only). `/install-beast-mode` and `/upgrade-beast-mode` ask the user for a **MAX effort level** (recommend `ultracode`, with a token-cost warning) and derive the standard dev-agent default at **2 steps below MAX** (user-adjustable).
  - **solution-architect** → `model: opus` at the chosen MAX (architecture is the highest-leverage work; do it at full strength so the plan carries the load)
  - **standard dev agents** (`frontend-dev`, `backend-dev`, …) → `model: sonnet` at 2-below-MAX
  - **review & evaluation agents** (code review, PR review, `/evaluate-feature`) → `model: opus` at MAX

- **Advanced dev agents** — setup/upgrade now creates a heavyweight `*-advanced` variant for every standard dev agent (e.g. `frontend-dev-advanced`), running `model: opus` at MAX effort. For major refactors, integration-heavy work, and high-risk phases.

- **`/proceed-advanced`** — new command. Like `/proceed` but **forces the advanced (opus, max-effort) agents** and runs **exactly one phase, then stops** so the user decides whether the next phase also warrants advanced agents. Works for both the implementation and code-review workflows.

- **`/deep-research` integration** (optional, always asks first) — leverages Claude Code's deep-research command to reduce hallucination on external facts:
  - **solution-architect** uses it when the main thread asks (e.g. comparing libraries, standards, competitors), citing verified findings in Key Technical Decisions
  - **`/plan-feature`** identifies when a feature hinges on external knowledge and offers to research before scoping — or to delegate the research to the solution-architect
  - **`/suggest-feature`** offers it when there's no clear next-feature signal and the decision depends on competitors/industry standards

- **`/review-ui`** — new command (contributed by @FACTERINVURT). Reviews UI code with a **Live Browser Audit** pattern and live MCP-driven inspection of the running app.

### Changed

- **`/proceed`** now assesses each phase and, for **major refactors / integration-heavy / high-risk** phases, **asks the user** before switching to an advanced agent — naming the specific reasons and noting the higher token cost. Routine phases continue to use the standard agent silently.

- **`/review-ux`** substantially enhanced (contributed by @FACTERINVURT) — persona-first flow, scoring rubrics, a friction inventory, and a live MCP audit of the running UI.

- **`/review-feature`, `/review-ui`, `/review-ux`** gained a **three-way boundary table** (contributed by @FACTERINVURT) clarifying what each review command covers vs. the others, so the three stay complementary rather than overlapping.

- **`/evaluate-feature`** now spawns its independent evaluator on opus at maximum effort (a weak evaluator rubber-stamps weak work).

- **`agent-structure-example.md`** documents the new `effort` field, the Model & Effort Policy table, the 2-steps-below-MAX ladder, and an advanced-agent example.

- **`/upgrade-beast-mode`** gained a **v2 → v3 migration step** that asks for effort levels, edits existing agents' frontmatter in place (preserving custom system prompts), creates the `*-advanced` variants, and installs `/proceed-advanced`.

### Breaking Changes

- Agents created before v3 have no `model`/`effort` tuning and no advanced tier. They keep working, but `/proceed-advanced` and the advanced-agent routing in `/proceed` require the v3 migration. **Run `/upgrade-beast-mode`** to migrate — it preserves your custom agent prompts and only updates frontmatter.

---

## [2.8.1] - 2026-05-07

### Added

- **`/install-statusline`** — One-shot deploy of the Beast Mode statusline into `~/.claude/settings.json`
  - **Line 1** — `📁 folder 🌿 branch +staged ~modified ?untracked` with cyan/green/yellow/red coloring; cached for 5s per session and invalidated on cwd change
  - **Line 2** — `🧠 context  ⏳ 5h-limit reset-in  📅 7d-limit reset-in` progress bars with green/yellow/red thresholds at 70/90% and compact countdowns (`25m`, `3h45m`, `5d12h`)
  - Anchored to `workspace.project_dir`, not `cwd`, so the statusline stays put when Claude's working directory changes
  - Rate-limit segments are skipped when `rate_limits` is absent (free tier)
  - Script (`scripts/statusline.sh`) runs standalone for iteration: falls back to `docs/status.json` when stdin is empty or a TTY
  - Command merges via `jq` (preserves other settings fields) and writes the resolved absolute script path so `${CLAUDE_PLUGIN_ROOT}` doesn't need to be set when the statusline is later spawned

---

## [2.8.0] - 2026-04-20

### Added

- **`/review-pr [PR-number]`** — Independent PR review with two modes
  - **GitHub-PR mode** (PR number given) — clean-repo preflight, checkout the PR branch, full review with build verification, structured findings, selective `gh pr comment` posting, deferred items written to `docs/features/<feature>/pr-notes.md` for post-merge follow-up
  - **Pre-submit mode** (no PR number) — lighter review of local changes, offers to fix findings in place, enforces `feat/<feature-name>[/<suffix>]` branch naming, rebases against `origin/main`, creates the PR via `gh pr create`
  - **Context gate** — refuses to run if the session already has substantial prior work, so the review stays unbiased (user is prompted to `/clear` and re-run)
  - Discord: exposed as `/beast review-pr` with optional `pr` string option
  - Taxonomy: Blockers → Security → Architecture → Test coverage → Smaller issues
  - Never auto-posts: user always selects which findings become PR comments

---

## [2.6.0] - 2026-03-30

### Added

- **`/evaluate-feature`** - Evaluate a feature against its acceptance criteria using a fresh evaluator agent
  - Implements the **generator/evaluator separation** pattern from Anthropic's agentic design research
  - Spawns an independent agent with clean context (no implementation bias) to verify the feature works
  - Evaluates against the Definition of Done criteria in `implementation.md`
  - Reads actual source files and runs tests — doesn't just check documentation
  - Produces `evaluation.md` with structured report: criteria tables with PASS/FAIL verdicts, file:line evidence, issues with severity
  - Three verdicts: **PASS** (100%), **PARTIAL** (60-99%), **FAIL** (<60%)
  - On PARTIAL/FAIL, creates new tasks in `tasks.md` for failing criteria
  - Distinct from `/review-feature` (code quality) — this checks feature completeness and correctness

- **Definition of Done** section in implementation plan template
  - Three criteria categories: Functional, Quality, Integration
  - Verification Method with step-by-step evaluator instructions
  - Designed to be testable by an independent agent with no implementation context

- **Quality Bar** section in implementation plan template
  - Production-grade quality descriptors across UI, Code, and Integration dimensions
  - Shapes output quality from the first iteration (inspired by Anthropic's finding that aspirational language in criteria improves results even before evaluation feedback)

### Changed

#### Enhanced `/plan-feature`
- **NEW:** Solution-architect now generates **Definition of Done** acceptance criteria as part of every implementation plan
- **NEW:** Solution-architect tailors the **Quality Bar** descriptors to the feature type (UI-heavy, backend, full-stack)
- Acceptance criteria must be specific enough for an independent evaluator to verify without implementation context

---

## [2.5.0] - 2026-03-24

### Added

- **`/fix-bug`** - Fix a specific bug by ID
  - MCP-first with silent fallback to direct `docs/bugs/*.md` file I/O
  - Loads linked feature context (`implementation.md`, `context.md`) automatically
  - Status management: `open` → `in-progress` → `closed` with user confirmation
  - Graceful error handling: missing bugs, already closed, missing feature context

- **`/fix-feature`** - Fix all open bugs linked to a feature (or all bugs if no feature specified)
  - Groups bugs by `linkedFeature`, sorts by priority (critical → high → medium → low)
  - Loads feature context per group for informed fixes
  - Group-then-confirm workflow: fixes all bugs in a feature, asks user to test once per group
  - "All" mode processes every open bug, unlinked bugs last
  - Supports partial rejection: close confirmed bugs, leave broken ones in-progress
  - Final summary of all bugs fixed, remaining, and errors

- **Discord bot commands** for bugfix workflows
  - `/beast fix [feature]` — maps to `/fix-feature`
  - `/beast fix-bug <bug>` — maps to `/fix-bug`

---

## [2.3.0] - 2026-03-19

### Added

- **`/suggest-feature`** - Suggest the next feature to develop based on project state
  - Reads `CLAUDE.md`, `docs/mission-statement.md`, `docs/technical-design.md`, and existing feature docs
  - Determines current development phase from project docs or assesses project maturity
  - Presents 2-4 feature suggestions with a recommended pick
  - Creates `requirements.md` for the chosen feature, feeding into `/plan-feature`
  - Gracefully handles missing docs files

- **`/update-master`** - Update project master overview with latest feature progress
  - Syncs `docs/overview.md` with individual feature docs in `docs/features/*/`
  - Scans all features for changes by comparing "Last Updated" timestamps
  - Can focus on a single feature (`/update-master feature-name`) or scan all
  - Extracts task counts, completion percentages, decisions, and integration points
  - Maintains a versioned changelog in the overview
  - Auto-creates `docs/overview.md` with full feature status table if it doesn't exist
  - Checks git log for changes not yet reflected in feature docs
  - Adapted from a community contribution (KuraFlow project) into a generic, project-agnostic command

### Changed

#### Dynamic Template Installation
- **FIXED:** `install-templates.sh` no longer hardcodes filenames — now dynamically copies all files from each template directory
  - Fixes 4 missing commands on fresh install (`document-feature`, `proceed`, `review-feature`, `audit-feature`)
  - Root cause: script referenced nonexistent `update-skills.md`, causing `set -e` abort before remaining commands were copied
  - New templates added to the plugin are now automatically installed without touching the script

#### Skills Philosophy — No Speculative Skills
- **CHANGED:** `/install-beast-mode` no longer generates skills or skill-rules during initial setup
  - Skills are strictly for documenting **existing, implemented code** — not aspirational patterns
  - Dev-ops plan now initializes an empty `skill-rules.json` instead of creating skills from scratch
  - Skills are created incrementally using `/document-feature` as features are completed
  - Agents (solution-architect + dev agent) are still created during setup

#### Enhanced `/plan-feature`
- **IMPROVED:** Now checks for `docs/features/<feature-name>/requirements.md` when no requirements are provided in the prompt
  - Seamlessly picks up requirements created by `/suggest-feature`
  - Workflow: `/suggest-feature` → pick feature → `/plan-feature <name>` uses existing requirements

#### Enhanced `/upgrade-beast-mode`
- **FIXED:** No longer exits early when versions match — now checks for missing files even when up to date
  - Replaced hardcoded file lists with dynamic template directory enumeration
  - Ensures files added in patch releases are not missed

### Fixed

- Removed stale `/dev-docs-update` references (renamed to `/update-feature` in v2.0)
- Removed phantom `update-skills.md` reference from install script (command was replaced by `/document-feature` in v2.1.0)

---

## [2.2.0] - 2026-02-12

### Added

- **`/review-feature`** - Review a feature's code against Vercel best practices
  - Reviews all key files from `context.md` against Vercel React Best Practices and Composition Patterns skills
  - Checks rules organized by priority: CRITICAL (bundle/async), HIGH (composition), MEDIUM (re-renders, rendering, React 19), LOW-MEDIUM (JS performance)
  - Writes findings to `docs/features/<feature-name>/code-review.md` with severity, rule, file, problem, fix, and effort for each finding
  - Documents what's already good alongside findings
  - Creates a Recommended Fix Order table sorted by impact-to-effort ratio
  - Includes a Progress checklist for tracking resolved findings
  - Resumes from existing `code-review.md` if one already exists
  - Integrates with `/proceed` for iterative fix implementation

### Changed

#### Enhanced `/proceed` Command
- **NEW:** Now supports two workflows: **Implementation** and **Code Review**
  - **Implementation workflow** (default): Uses `tasks.md` as before
  - **Code review workflow**: Activates when `/review-feature` was run earlier in the conversation
- Code review workflow features:
  - Picks up the next unchecked finding from `code-review.md` Progress section
  - Groups related fixes that affect the same file into a single agent task
  - Spawns agents with full context (CR number, file, problem, fix, Vercel rule)
  - Marks findings as resolved and updates status after each fix
  - Auto-continues for LOW/MEDIUM severity items, suggests testing for CRITICAL/HIGH
- Workflow detection based on most recent feature command in conversation history

---

## [2.1.1] - 2025-12-12

### Changed

#### Enhanced `/discover-feature` Command
- **NEW:** Now creates `context.md` and `tasks.md` stubs alongside `implementation.md`
  - `context.md` - Context stub marked as "Documented (Existing Feature)"
  - `tasks.md` - Task stub with original implementation marked complete
- **NEW:** Identifies reusable patterns during discovery and suggests `/document-feature`
  - Shows "REUSABLE PATTERNS IDENTIFIED" section in summary when applicable
  - Adds option 5 to run `/document-feature` for skill extraction
  - Only suggests when generalizable patterns are found
- Updated example workflow to reflect new output format
- Improved handling of partially documented features

---

## [2.1.0] - 2025-12-10

### Changed

#### Replaced `/update-skills` with `/document-feature`
- **REMOVED:** `/update-skills` command
- **ADDED:** `/document-feature` command - A more comprehensive approach to extracting reusable knowledge from features

### Added

- **`/document-feature`** - Document reusable skills and patterns from completed features
  - Works with context from `/continue-feature` or accepts feature name argument
  - Analyzes features for reusable patterns, systems, and gotchas
  - Creates/updates skills in `.claude/skills/` using progressive disclosure pattern
  - Updates `skill-rules.json` for auto-activation via keywords
  - Follows the same workflow as Cursor's document-feature command but adapted for Beast Mode
  - Only documents patterns that will help future features (not feature-specific details)
  - Removes outdated/deprecated patterns instead of marking them deprecated

### Removed

- **`/update-skills`** - Replaced by the more comprehensive `/document-feature` command

---

## [2.0.1] - 2025-12-10

### Fixed

- **skill-rules.template.json:** Updated JSON structure to match what skill-reminder.ts hook expects (`skills` object with `promptTriggers.keywords` format instead of `rules` array)

### Added

- **`/proceed`** - New slash command to continue work on the current feature using agents for implementation
  - Continues from where `/start-feature` or `/continue-feature` left off
  - Uses agents for implementation (one at a time, not parallel)
  - Prompts for user testing when frontend UI changes are made
  - Updates `tasks.md` and `context.md` between phases

---

## [2.0.0] - 2025-12-08

### 🎯 Major Simplification - Unified docs/features/ Structure

This release removes the `/dev` folder entirely and consolidates everything into `docs/features/`. This makes Beast Mode compatible with both Claude Code and Cursor workflows interchangeably.

### Breaking Changes

#### Removed `/dev` Folder Structure
- **REMOVED:** `/dev/active/` - features in progress
- **REMOVED:** `/dev/completed/` - completed features  
- **REMOVED:** `/dev/templates/` - doc templates
- **NEW:** All features now live in `docs/features/` only
- **NEW:** Templates moved to `.claude/templates/`

#### Slash Command Changes
- **RENAMED:** `/dev-docs-update` → `/update-feature`
- **CHANGED:** `/start-feature` no longer copies plan, just creates context.md and tasks.md
- **CHANGED:** `/start-feature` sets implementation.md status to "In Progress"
- **CHANGED:** `/continue-feature` loads from `docs/features/` and uses `implementation.md` (not `plan.md`)
- **CHANGED:** All commands updated to use `docs/features/` paths

### Migration

#### Automatic Migration
When upgrading from v1.x to v2.0.0, run `/upgrade-beast-mode`:
1. Copies all features from `/dev/active/` → `docs/features/`
2. Copies all features from `/dev/completed/` → `docs/features/`
3. Renames `plan.md` → `implementation.md` for each feature
4. Deletes old `implementation.md` files (v1 had both, v2 only needs one)
5. Creates backup in `.claude/.beast-mode-backup-*/dev/`
6. Deletes `/dev` folder after confirmation

#### Migration Script
Alternatively, run the migration script directly:
```bash
bash ~/.claude/plugins/beast-mode/scripts/migrate-v1-to-v2.sh
```

### Added

- **Migration script:** `scripts/migrate-v1-to-v2.sh` for automated v1 → v2 migration
- **New template location:** `.claude/templates/` for context.md, tasks.md templates
- **Simplified workflow:** Single source of truth in `docs/features/`

### Changed

#### Workflow Simplification
- Features stay in `docs/features/` throughout their lifecycle
- No more moving between `dev/active/` and `dev/completed/`
- Feature completion tracked by implementation.md status field
- Simpler mental model: one location for all feature docs

#### Template Locations
- **OLD:** `dev/templates/plan.md` → **REMOVED** (not needed, implementation.md stays in place)
- **OLD:** `dev/templates/context.md` → **NEW:** `.claude/templates/context.md`
- **OLD:** `dev/templates/tasks.md` → **NEW:** `.claude/templates/tasks.md`
- **OLD:** `dev/README.md` → **NEW:** `.claude/templates/README.md`

#### Installation Changes
- Install script no longer creates `/dev` folders
- Install script creates `.claude/templates/` instead
- `.gitignore` no longer excludes `dev/active/` and `dev/completed/`
- `.gitignore` now excludes `.claude/.beast-mode-backup-*/`

### Removed

- **Removed:** Entire `/dev` folder structure
- **Removed:** Separate `plan.md` files (only `implementation.md` exists now)
- **Removed:** Concept of "active" vs "completed" folders
- **Removed:** `/dev-docs-update` command (renamed to `/update-feature`)

### Why This Change?

**Cursor Compatibility:** This aligns Beast Mode with Cursor's simpler workflow where everything lives in `docs/features/`.

**Reduced Complexity:** One location instead of three (`docs/features/implementation.md`, `dev/active/feature/plan.md`, `dev/active/feature/context.md`).

**Better Git History:** All feature docs in one stable location means cleaner git history.

**Platform Agnostic:** Same workflow works in both Claude Code and Cursor without modification.

---

## [1.2.0] - 2025-11-05

### Added

#### New Slash Commands
- **`/update-skills`** - Update skills system after feature completion to create self-improving knowledge base
  - Analyzes completed feature to extract reusable patterns
  - Determines which existing skills should be updated
  - Creates feature documentation in relevant skill directories
  - Updates skill SKILL.md files with references to new patterns
  - Updates skill-rules.json for auto-activation of new patterns
  - Ensures future agents benefit from newly discovered patterns
  - Perfect for closing the loop after completing features

#### Skills System Integration
- Structured approach to documenting completed features in skills
- Template for creating feature documentation files
- Guidelines for determining which skills to update
- Pattern extraction from dev docs and implementation
- Automatic skill-rules.json updates for new keywords/file patterns

### Changed

#### Documentation Improvements
- Enhanced workflow guidance to include skills update step
- Added examples for frontend, backend, and editor feature documentation
- Clarified when to create new skills vs. update existing ones

---

## [1.1.0] - 2025-11-05

### Added

#### New Slash Commands
- **`/plan-feature`** - Plan new features by gathering requirements and using solution-architect agent to create implementation plans
  - Asks clarifying questions to understand requirements
  - Delegates plan creation to solution-architect agent
  - Waits for user approval before starting feature
  - Perfect for starting new features from scratch

- **`/discover-feature`** - Document existing legacy features that weren't developed with Beast Mode
  - Investigates codebase to understand how feature works
  - Creates retrospective implementation plan
  - Checks if plan already exists before creating
  - Great for bringing legacy code into Beast Mode workflow

- **`/upgrade-beast-mode`** (Plugin command) - Upgrade Beast Mode installation with latest templates and commands
  - Compares current version with plugin version
  - Shows changelog of what's new
  - Backs up existing files before upgrading
  - Preserves customized files (like build-check.ts)
  - Provides rollback instructions
  - **Note:** This is a plugin command, not copied to projects

#### Version Tracking
- Added `.beast-mode-version` file to track installed version in projects
- Added comprehensive CHANGELOG.md to document all changes
- Version number in plugin.json for tracking releases

### Fixed

#### `/start-feature` Bug Fix
- **CRITICAL FIX:** Command now properly copies implementation plan instead of rewriting it
  - Uses `cp` command to copy file
  - Uses `Edit` tool (not Write) to update only status header lines
  - Preserves entire plan content exactly as written
  - Only changes: Status, Started date, Last Updated timestamp
  - This was causing plans to be regenerated and losing original content

### Changed

#### Documentation Improvements
- Enhanced `/start-feature` command with explicit instructions to use Edit tool
- Added clear examples in all new commands
- Improved error handling and edge case documentation

---

## [1.0.0] - 2025-10-31

### Added

#### Initial Release
- Complete Beast Mode plugin with battle-tested workflow system
- Universal templates that work across all project types

#### Slash Commands
- `/start-feature` - Create dev docs structure from implementation plan
- `/continue-feature` - Resume work on existing feature with full context
- `/dev-docs-update` - Update dev docs before compacting conversations

#### Dev Doc Templates
- `plan.md` - Implementation plan structure
- `context.md` - Context tracking and decisions
- `tasks.md` - Task checklist with progress tracking
- `README.md` - Complete workflow guide (558 lines)

#### Hook Templates
- `edit-tracker.ts/.js` - Track edited files during session
- `skill-reminder.ts/.js` - Suggest relevant skills based on keywords
- `build-check.ts` - Run build checks after changes (customizable)

#### Format References
- `skill-rules.template.json` - Skill auto-activation patterns
- `session-edits.schema.json` - Session tracking schema
- `skill-structure-example.md` - Progressive disclosure pattern guide
- `agent-structure-example.md` - Agent creation guide
- `settings.hooks.json` - Hook registration template

#### Installation
- `/install-beast-mode` command for project setup
  - Detects project structure and tech stack
  - Asks clarifying questions about preferences
  - Generates customized implementation plan
  - Installs all universal templates
  - Creates dev docs directory structure
  - Updates .gitignore automatically

#### Installation Script
- `install-templates.sh` - Bash script for copying templates
  - Creates all necessary directories
  - Copies all template files
  - Makes hooks executable
  - Updates .gitignore
  - Checks for tsx installation
  - Shows hook registration instructions

#### Documentation
- Comprehensive README.md with:
  - Installation instructions
  - Usage workflows
  - Tech stack support guide
  - Troubleshooting section
  - Progressive disclosure pattern explanation
  - Agent creation guide
  - Philosophy and best practices

#### Plugin System
- Proper plugin.json manifest
- Organized directory structure
- Ready for Claude Code plugin marketplace

---

## Release Notes

### Upgrading from 1.1.0 to 1.2.0

**What you get:**
- New `/update-skills` command to close the workflow loop
- Skills system becomes self-improving as features are completed
- Structured approach to documenting patterns for future reuse
- Auto-activation rules for newly discovered patterns

**How to upgrade:**
1. Run `/upgrade-beast-mode` in any project with Beast Mode installed
2. Review the changes (new /update-skills command added)
3. Approve the upgrade
4. Your customizations are automatically preserved

**Breaking Changes:**
- None! This is a backward-compatible release

**Migration Notes:**
- No migration needed
- New `/update-skills` command is immediately available after upgrade
- Recommended workflow: Complete feature → `/dev-docs-update` → `/update-skills` → Archive

**New Workflow:**
```
1. /plan-feature → Create implementation plan
2. /start-feature → Begin development
3. [Development work...]
4. /dev-docs-update → Update context before compacting
5. /update-skills → Document patterns in skills system ← NEW!
6. Move to dev/completed/ (manual or future /archive-feature)
```

---

### Upgrading from 1.0.0 to 1.1.0

**What you get:**
- 3 powerful new slash commands for better feature planning and legacy code integration
- Critical bug fix for `/start-feature` that preserves your implementation plans
- Version tracking for future upgrades
- Comprehensive changelog for transparency

**How to upgrade:**
1. Run `/upgrade-beast-mode` in any project with Beast Mode installed
2. Review the changes that will be applied
3. Approve the upgrade
4. Your customizations (like build-check.ts) are automatically preserved

**Breaking Changes:**
- None! This is a backward-compatible release

**Migration Notes:**
- No migration needed
- Existing dev docs and features continue to work as-is
- New commands are immediately available after upgrade

---

## Versioning Strategy

Beast Mode follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes that require migration
- **MINOR** (1.X.0): New features, backward-compatible
- **PATCH** (1.0.X): Bug fixes, backward-compatible

---

## Future Roadmap

### Planned
- `/archive-feature` - Archive completed features
- Enhanced project detection for more languages and frameworks
- Template customization during installation
- Automated testing workflows

### Planned for 2.0.0
- Interactive setup wizard
- Built-in skill/agent marketplace
- Auto-update mechanism
- Multi-language support
- CI/CD integration templates

---

## Credits

Based on the Reddit post: **"Claude Code is a beast: Tips from 6 months of hardcore use"**

Developed to make battle-tested Claude Code workflow patterns easy to deploy across any project.

---

**Note:** To see the changelog for your current installation, check `.claude/.beast-mode-version` for your version number, then review the relevant sections above.
