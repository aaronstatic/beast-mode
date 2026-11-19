# Tool Rules — Shared Reference

**This file is the single source of truth for the tool rules of a Beast Mode subagent.** The installer writes it to **`.beast-mode/tool-rules.md`**. A delegator command reads it one time per run, and it copies the `## Tool rules` section into every subagent prompt, word for word. The rules live here and **only** here — a command never restates them.

Each rule names a neutral term, and `.beast-mode/harness.md` maps the term to the real tool of this harness. A rule names no tool of one harness, so the same block works on every harness.

A paste is the rule, not a pointer. A subagent can skip an instruction to open a file, and the rules must arrive before the first tool call.

Three rules govern the block.

1. The block stays under 200 words. A delegator pastes it into every subagent prompt, so each word costs tokens in every run.
2. The `## Tool rules` section stays last in this file. A reader copies from the heading to the end of the file.
3. A new rule replaces one of the seven rules. The block does not grow.

---

## Tool rules

Apply these seven rules to every tool call.

1. Always edit a file for a change inside a file. Always write a file for a new file. Use no shell heredoc and no script. Write no report file. Put the report only in the hand-back message.
2. For a file over 300 lines, read a file range.
3. Do not read the same file two times. After a failed edit, read the file again.
4. Run a shell command in the foreground, one time for a group of related steps. Chain the steps inside that one command. Start no background command and no wait on one. Split a run over 10 minutes into several foreground runs. Hand back only after the last run ends.
5. Filter the output of a build, a type check, and a test. Print the last 30 lines, or search the output for `error`.
6. Evaluate in the browser for a small value, in place of a page snapshot.
7. Take a page snapshot one time for each page state.
