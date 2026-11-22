// installer/lib/orca/spec.js
//
// The worker specs of an orca run. `start` renders the spec of its stage,
// writes it under `.beast-mode/briefs/<path>/`, and passes the file to
// `worker-start` with `--spec-file` (Research Finding 1). The phase spec is
// the model. Every other spec keeps its header, its read list, and its
// rules, and it changes the work part and the done proof (the worker spec
// section of the plan, Decision 9). Pure: no file and no process.
//
// The texts that `send` and `note` pass to a running tab live here too
// (P2-11): the open items, the resume text, the report text, the verdict
// note, and a user message with the inbox instruction.
//
// A spec names no harness tool and no harness path. The terms of
// `.beast-mode/harness.md` carry every harness action, so one text serves a
// Claude Code worker and a dsh worker. orca.test.js pins the parts and the
// neutrality of every spec and every message.

/**
 * @typedef {Object} SpecParts
 * @property {string} feature The feature path, for example "editor/ux".
 * @property {string | null} epic The epic of a feature inside an epic.
 * @property {string} title The heading text after the feature path.
 * @property {string} role The intro sentence after "your report. ".
 * @property {string[]} read Item 4 of the read list, with its indent.
 * @property {string} heading The heading of the work part, for example "Run the phase:".
 * @property {string[]} work The work part.
 * @property {string[]} ask The lines that end the ask rule. They name the question prefix.
 * @property {string[]} inbox The inbox rule.
 * @property {string[]} done The done proof.
 * @property {string[]} [askRule] A full replacement of the ask rule. The plan spec sets it.
 */

/** The inbox rule of the phase spec: the phase tab acts on the line at part 5 of section 10. */
const PHASE_INBOX = [
  '- A user message that reaches you is an inbox item of section 12 rule 3. Write its line, and act on',
  '  it at part 5 of section 10. Every agent prompt that you write holds the inbox sentence of',
  '  section 12 rule 4.',
];

/** The inbox rule of every other spec: the tab writes the line, and a later stage acts on it. */
const STAGE_INBOX = [
  '- A user message that reaches you is an inbox item of section 12 rule 3. Write its line in',
  '  `inbox.md`. Every agent prompt that you write holds the inbox sentence of section 12 rule 4.',
];

/** The inbox rule of the inbox spec: the tab writes the line, and it acts on the line itself. */
const INBOX_TAB_INBOX = [
  '- A user message that reaches you is an inbox item of section 12 rule 3. Write its line in',
  '  `inbox.md`, and act on it by step 1. Every agent prompt that you write holds the inbox sentence of',
  '  section 12 rule 4.',
];

/**
 * @param {string} tag The question prefix without its brackets, for example "demo plan".
 * @returns {string[]} The end of the ask rule of every spec but the phase spec.
 */
function askTail(tag) {
  return [`  preamble. Start the question with \`[${tag}]\`, then end your turn.`];
}

/**
 * The ask rule of the plan spec: the plan tab asks the user in its own tab,
 * as a normal run of `/plan-feature` does, and the person answers there.
 */
const PLAN_ASK_RULE = [
  '- Ask the user in your own tab, as a normal run of the command does: ask the user to choose, with the',
  '  tool that `.beast-mode/harness.md` names. The person answers in this tab. Do not run the `ask` command',
  '  of your worker preamble for a question. Wait for each answer. A wait on a person is not a stop.',
];

/**
 * The delegate rule of every spec. A worker that starts a helper of its own
 * through Orca, and then ends its turn to wait, waits on mail that Orca
 * queues until its next turn. An idle tab gets no next turn, so the run
 * stalls. The delegate term of `.beast-mode/harness.md` returns the result
 * of the agent in the same turn on every harness.
 */
const DELEGATE_RULE = [
  '- Start no Orca worker and no Orca task of your own. Delegate only by the term "delegate to the',
  '  `<name>` agent" of `.beast-mode/harness.md`, in the form whose call returns the result of the agent',
  '  in the same turn. Never end your turn while an agent that you started still works.',
];

/**
 * Render one spec: the header, the read list, the work part, the five
 * rules, and the done proof.
 *
 * @param {SpecParts} parts
 * @returns {string}
 */
function render(parts) {
  const lines = [
    `# Beast Mode orca worker - ${parts.feature}, ${parts.title}`,
    '',
    'You are a worker of a Beast Mode orca run. The coordinator started you through Orca, and it waits for',
    `your report. ${parts.role}`,
    '',
    'Read first:',
    '1. `.beast-mode/harness.md`. It maps each neutral term below to a tool of your harness.',
    '2. The project instruction file.',
    '3. `.beast-mode/phase-handoff.md`. It is the single source of truth for this work.',
    ...parts.read,
  ];
  if (parts.epic) {
    lines.push(
      `The feature is part of the epic \`${parts.epic}\`. Load the epic context by section 4 of`,
      '`.beast-mode/epic-resolution.md`.'
    );
  }
  lines.push(
    '',
    parts.heading,
    ...parts.work,
    '',
    'Rules:',
    '- Make no git write. No commit, branch, merge, stash, reset, or push. The coordinator owns git.',
    ...(parts.askRule ?? [
      '- Ask the user nothing directly. For an answer that you need, run the `ask` command of your worker',
      ...parts.ask,
    ]),
    ...parts.inbox,
    ...DELEGATE_RULE,
    '- Touch no shared or production environment.',
    '',
    ...parts.done,
    ''
  );
  return lines.join('\n');
}

/**
 * The commands of the docs tab of `/orca-feature`: `/update-feature`, then
 * `/update-epic` for a feature inside an epic, then `/update-master`. The
 * master overview carries an epic as one row, so a feature inside an epic
 * updates the row of its epic.
 *
 * A lane of `/orca-epic` runs `/update-feature` only (P2-12): the epic
 * docs tab runs `/update-epic` and `/update-master` once, after the last
 * merge.
 *
 * @param {string} feature
 * @param {string | null} epic
 * @param {boolean} [lane] The feature builds in a lane of `/orca-epic`.
 * @returns {string[]}
 */
export function docsCommands(feature, epic, lane = false) {
  if (lane) return [`/update-feature ${feature}`];
  return [`/update-feature ${feature}`, ...(epic ? [`/update-epic ${epic}`] : []), `/update-master ${epic ?? feature}`];
}

/**
 * The commands of the epic docs tab of `/orca-epic`: `/update-epic`, then
 * `/update-master`, after the last merge.
 *
 * @param {string} epic
 * @returns {string[]}
 */
export function epicDocsCommands(epic) {
  return [`/update-epic ${epic}`, `/update-master ${epic}`];
}

/**
 * The verdict step of the phase spec and the verify spec: the words of line 1
 * and the demo result of the last line (section 9).
 *
 * @param {string} file The project path of the verdict file.
 * @param {string} first The first words of the step, with its number.
 * @returns {string[]}
 */
function verdictStep(file, first) {
  return [
    `${first} Write the verdict file \`${file}\`.`,
    '   Line 1 is `PASS` when the gate, the demo, and the UI check pass. Line 1 is `FAIL` when the verifier',
    '   found a fault, and `BLOCKED` when it could not check. After',
    '   line 1, write the evidence, one item for each fault. The last line is the demo result of section 9:',
    '   `Demo: PASS`, `Demo: FAIL`, `Demo: MANUAL`, or `Demo: none`.',
  ];
}

/**
 * The spec of one phase tab. With `review`, the tab of the last phase also
 * runs the cross-phase review and fixes its findings, because the review
 * agent equals the implement agent (Decision 8). `verdictFile` is the verdict
 * path of a phase that the tab verifies itself (the verify agent equals the
 * implement agent): the tab writes the verdict, and the slice block shows
 * its demo result. `briefFile` is the path of the verification brief of a
 * split verify (the verify agent differs): the tab writes the brief of
 * section 9 and runs no verifier, because a verify tab runs it. The epic
 * form (`lane`) writes no line to `human-testing.md`: `merge` copies the
 * open human tests of `context.md` there after the merge (Decision 11).
 *
 * @param {{ feature: string, epic: string | null, phase: { number: number, name: string }, review?: boolean, lane?: boolean, verdictFile?: string | null, briefFile?: string | null }} facts
 * @returns {string}
 */
export function phaseSpec({ feature, epic, phase, review = false, lane = false, verdictFile = null, briefFile = null }) {
  const n = phase.number;
  const split = typeof briefFile === 'string' && briefFile.length > 0;
  const work = [
    `1. Split the open tasks of Phase ${n} into task groups by section 1. Write one brief per group by`,
    '   sections 4 and 5. Delegate each group to the best project agent at the tier that the phase names,',
    '   one agent at a time, by sections 2 and 7.',
    ...(split
      ? [
          '2. Run the post-phase step of section 10, without part 1: run no verifier and no fix round. Write the',
          `   verification brief of section 9 at \`${briefFile}\`. A verify tab of another agent runs it.`,
          '   Part 2 records `tasks.md` and `context.md`. Part 3 takes its called-mode form with one change: add',
          '   the demo line to `context.md` only. Part 5 reads the inbox by section 12 rule 11.',
        ]
      : [
          '2. Run the post-phase step of section 10. Part 1 verifies, with up to three fix rounds. Part 2 records',
          '   `tasks.md` and `context.md`. Part 3 takes its called-mode form with one change: add the demo line',
          '   to `context.md` only. Part 5 reads the inbox by section 12 rule 11.',
        ]),
  ];
  if (lane) {
    work.push(
      '   Write no line to `human-testing.md`. The coordinator copies the open human tests of `context.md`',
      '   there after it merges this feature into the epic branch.'
    );
  }
  if (review) {
    work.push(
      `3. Then run the \`/review-feature ${feature}\` command. Fix every open finding by the code review groups`,
      split
        ? '   of section 6, one agent at a time. Run no verifier, because the verify tab checks the fixes. Mark each'
        : '   of section 6, one agent at a time. Run one verifier. Mark each fixed finding `- [x] CR-<n>` in',
      split ? '   fixed finding `- [x] CR-<n>` in `code-review.md`.' : '   `code-review.md`.',
      `When every task of Phase ${n} already reads \`[x]\`, skip steps 1 and 2.`
    );
  }
  if (!split && verdictFile) work.push(...verdictStep(verdictFile, review ? '4.' : '3.'));
  const done = review
    ? [
        `Done proof: run \`worker_done\` from your worker preamble only when every task of Phase ${n} in`,
        '`tasks.md` reads `[x]`, and `code-review.md` holds no open finding. The coordinator reads those files',
        'before it accepts the report, and it sends you back when a task or a finding is open. Name the task',
        split
          ? 'groups, the demo result, and the review findings in the report.'
          : 'groups, the verifier result, the demo result, and the review findings in the report.',
      ]
    : [
        `Done proof: run \`worker_done\` from your worker preamble only when every task of Phase ${n} in`,
        '`tasks.md` reads `[x]`. The coordinator reads those files before it accepts the report, and it sends',
        split
          ? 'you back when a task is open. Name the task groups and the demo result in the report.'
          : 'you back when a task is open. Name the task groups, the verifier result, and the demo result in the',
        ...(split ? [] : ['report.']),
      ];
  return render({
    feature,
    epic,
    title: phase.name ? `Phase ${n}: ${phase.name}` : `Phase ${n}`,
    role: 'You run one phase of one feature, and you are the orchestrator of that phase.',
    read: [
      `4. In \`docs/features/${feature}/\`: the Phase ${n} section of \`implementation.md\`, \`tasks.md\`,`,
      '   `context.md`, and `inbox.md`.',
    ],
    heading: 'Run the phase:',
    work,
    ask: [
      `  preamble. Start the question with \`[${feature} phase ${n}]\`, then end your turn. A medium or a`,
      '  large inbox change is such a question.',
    ],
    inbox: PHASE_INBOX,
    done,
  });
}

/**
 * The spec of the verify tab of a split verify (rule F16): it reads the
 * verification brief that the phase tab wrote, runs one verifier, and writes
 * the verdict file. It changes no source file.
 *
 * @param {{ feature: string, epic: string | null, phase: { number: number, name: string }, verdictFile: string, briefFile: string }} facts
 * @returns {string}
 */
export function verifySpec({ feature, epic, phase, verdictFile, briefFile }) {
  const n = phase.number;
  return render({
    feature,
    epic,
    title: `Phase ${n} verification`,
    role: 'You verify one finished phase of one feature, and you write the verdict. You edit no source file.',
    read: [
      `4. In \`docs/features/${feature}/\`: the Phase ${n} section of \`implementation.md\`, \`tasks.md\`, and`,
      '   `context.md`.',
    ],
    heading: 'Run the verification:',
    work: [
      `1. Read the verification brief \`${briefFile}\`. When the file does not exist, write it first by`,
      `   section 9, from the Phase ${n} section of \`implementation.md\`.`,
      '2. Run one verifier with the brief, by sections 7 and 9. Run no gate command yourself, and read no source',
      '   file yourself, by section 8.',
      ...verdictStep(verdictFile, '3.'),
      '4. Fix nothing. A fault goes into the evidence, and a fix tab of the implement agent repairs it.',
    ],
    ask: askTail(`${feature} phase ${n} verify`),
    inbox: STAGE_INBOX,
    done: [
      `Done proof: run \`worker_done\` from your worker preamble only when \`${verdictFile}\` exists and line 1`,
      'names the verdict. The coordinator reads the file before it accepts the report, and it sends you back',
      'when the file is missing. Name the verdict and the evidence in the report.',
    ],
  });
}

/**
 * The spec of the fix tab (rule F16): the evidence of the verdict as the fix
 * brief. `verifies` is true when the verify agent equals the implement agent:
 * no verify tab follows, so the fix tab runs the verifier and writes the new
 * verdict. Else a verify tab checks the fix.
 *
 * @param {{ feature: string, epic: string | null, phase: { number: number, name: string }, round: number, evidence: string, verdictFile: string, verifies: boolean }} facts
 * @returns {string}
 */
export function fixSpec({ feature, epic, phase, round, evidence, verdictFile, verifies }) {
  const n = phase.number;
  const fault = evidence.trim().length > 0
    ? ['   The verifier wrote this evidence. Fix every fault in it:', ...evidence.trim().split(/\r?\n/).map((line) => `   > ${line}`)]
    : ['   The earlier verdict holds no evidence. Run the verification brief of section 9 first, then fix every fault.'];
  return render({
    feature,
    epic,
    title: `Phase ${n} fix, round ${round}`,
    role: 'You fix the faults that the verifier found in one phase, and you are the orchestrator of that fix.',
    read: [
      `4. In \`docs/features/${feature}/\`: the Phase ${n} section of \`implementation.md\`, \`tasks.md\`,`,
      '   `context.md`, and `inbox.md`.',
    ],
    heading: 'Run the fix:',
    work: [
      `1. Phase ${n} is complete, and its verdict is not PASS (fix round ${round}).`,
      ...fault,
      '2. Write one fix brief for the faults by sections 4 and 5. Delegate it to the best project agent, one',
      '   agent at a time, by sections 2 and 7. Add no new task to `tasks.md`.',
      ...(verifies
        ? [
            `3. Then run one verifier with the verification brief of section 9, and write the verdict file`,
            `   \`${verdictFile}\`. Line 1 is \`PASS\`, \`FAIL\`, or \`BLOCKED\`. After line 1, write the evidence. The`,
            '   last line is the demo result of section 9: `Demo: PASS`, `Demo: FAIL`, `Demo: MANUAL`, or `Demo: none`.',
          ]
        : ['3. Run no verifier. A verify tab of another agent checks the fix after you report.']),
    ],
    ask: askTail(`${feature} phase ${n} fix`),
    inbox: STAGE_INBOX,
    done: verifies
      ? [
          `Done proof: run \`worker_done\` from your worker preamble only when \`${verdictFile}\` exists and line 1`,
          'names the verdict. The coordinator reads the file before it accepts the report, and it sends you back',
          'when the file is missing. Name the fixed faults and the verdict in the report.',
        ]
      : [
          'Done proof: run `worker_done` from your worker preamble when the faults are fixed. The coordinator',
          'accepts the report as it is. Name each fixed fault in the report.',
        ],
  });
}

/**
 * The spec of the plan tab. The full form runs `/plan-feature`, then
 * `/start-feature`. The start form, for a feature whose `implementation.md`
 * exists, runs `/start-feature` only. The tab asks every question in its
 * own tab with the native ask tool, and it does not wait at the approval
 * step.
 *
 * @param {{ feature: string, epic: string | null, form: 'full' | 'start' }} facts
 * @returns {string}
 */
export function planSpec({ feature, epic, form }) {
  const full = form !== 'start';
  const start = `the \`/start-feature ${feature}\` command. It writes \`tasks.md\`, \`context.md\`, and \`inbox.md\`.`;
  const work = full
    ? [
        `1. Run the \`/plan-feature ${feature}\` command as it is written, with the plan interview and its`,
        '   stop check. Ask each question in your own tab by the ask rule below.',
        '2. Do not wait at the approval step of `/plan-feature`. This run is the approval, so go on at once.',
        `3. Run ${start}`,
        '   Ask each question of this command in your own tab too.',
      ]
    : [
        '1. `implementation.md` exists, so the plan is written. Write no new plan.',
        `2. Run ${start}`,
        '   Ask each question of the command in your own tab by the ask rule below.',
      ];
  return render({
    feature,
    epic,
    title: 'Plan',
    role: full
      ? 'You plan one feature, and you set up its dev docs.'
      : 'You set up the dev docs of one planned feature.',
    read: [
      `4. In \`docs/features/${feature}/\`: every doc that exists, \`requirements.md\` and \`implementation.md\``,
      '   first.',
    ],
    heading: 'Run the plan:',
    work,
    ask: [],
    askRule: PLAN_ASK_RULE,
    inbox: STAGE_INBOX,
    done: [
      'Done proof: run `worker_done` from your worker preamble only when `implementation.md` and `tasks.md`',
      `exist in \`docs/features/${feature}/\`, and \`tasks.md\` holds a \`## Phase\` section. The coordinator`,
      'reads those files before it accepts the report, and it sends you back when one is missing. Name the',
      'phases and their demo lines in the report.',
    ],
  });
}

/**
 * The spec of the review tab of a split review: `/review-feature`, findings
 * only. The fixes stay with the implement agent (Decision 8).
 *
 * @param {{ feature: string, epic: string | null }} facts
 * @returns {string}
 */
export function reviewSpec({ feature, epic }) {
  return render({
    feature,
    epic,
    title: 'Cross-phase review',
    role: 'You review the code of one feature, and you write the findings only.',
    read: [`4. In \`docs/features/${feature}/\`: \`implementation.md\`, \`context.md\`, and \`tasks.md\`.`],
    heading: 'Run the review:',
    work: [
      `1. Run the \`/review-feature ${feature}\` command. It reviews the code of every phase and writes`,
      '   `code-review.md`.',
      '2. Write the findings only. Fix nothing, and edit no source file.',
      '3. List each finding as one open line, `- [ ] CR-<n>: <title>`, under `## Progress` of `code-review.md`.',
    ],
    ask: askTail(`${feature} review`),
    inbox: STAGE_INBOX,
    done: [
      `Done proof: run \`worker_done\` from your worker preamble only when \`docs/features/${feature}/code-review.md\``,
      'exists. The coordinator reads the file before it accepts the report. Name the count of findings by',
      'severity in the report.',
    ],
  });
}

/**
 * The spec of the review-fix tab of a split review: the open findings by
 * the code review groups of section 6, one verifier, and each fixed finding
 * marked in code-review.md.
 *
 * @param {{ feature: string, epic: string | null }} facts
 * @returns {string}
 */
export function reviewFixSpec({ feature, epic }) {
  return render({
    feature,
    epic,
    title: 'Review fixes',
    role: 'You fix the open findings of one feature, and you are the orchestrator of the fixes.',
    read: [
      `4. In \`docs/features/${feature}/\`: \`code-review.md\`, \`context.md\`, \`tasks.md\`, and`,
      '   `inbox.md`.',
    ],
    heading: 'Run the fixes:',
    work: [
      '1. Split the open findings of `code-review.md` into code review groups by section 6. Write one brief',
      '   per group by sections 4 and 5. Delegate each group to the best project agent, one agent at a time,',
      '   by sections 2 and 7.',
      '2. After the last group, run one verifier with the verification brief of section 9.',
      '3. Mark each fixed finding `- [x] CR-<n>` in `code-review.md`.',
    ],
    ask: askTail(`${feature} review-fix`),
    inbox: STAGE_INBOX,
    done: [
      'Done proof: run `worker_done` from your worker preamble only when `code-review.md` holds no open',
      '`CR-<n>` line. The coordinator reads the file before it accepts the report, and it sends you back',
      'when a finding is open. Name the groups, the verifier result, and each fixed finding in the report.',
    ],
  });
}

/**
 * The spec of the inbox tab (rule F20): part 5 of section 10 for each open
 * line, and part 1 when part 5 sends the step there. A medium or a large
 * change goes through `ask`. A task that a medium change adds stays open
 * for a phase tab. After a large change that writes a new requirements.md,
 * the tab acts on no other line.
 *
 * @param {{ feature: string, epic: string | null }} facts
 * @returns {string}
 */
export function inboxSpec({ feature, epic }) {
  return render({
    feature,
    epic,
    title: 'Inbox',
    role: 'You act on the open lines of the inbox of one feature, and you are the orchestrator of that work.',
    read: [
      `4. In \`docs/features/${feature}/\`: \`inbox.md\`, \`implementation.md\`, \`tasks.md\`, and`,
      '   `context.md`.',
    ],
    heading: 'Run the inbox:',
    work: [
      '1. Run part 5 of the post-phase step of section 10 for each open line of `inbox.md`, by the rule of',
      '   its kind in section 12. Act on a large change first.',
      '2. When part 5 sends the step back to part 1, run part 1 of section 10: one fix brief for the open',
      '   `bug` lines, then one verifier, with up to three fix rounds. Then run part 5 again.',
      '3. A medium or a large change is a question for the user. Ask it by the ask rule below, and act on the',
      '   answer by section 12 rule 9 or rule 10.',
      '4. Build no task of `tasks.md`. A task that a medium change adds stays open, and the coordinator starts',
      '   a phase tab for it.',
      '5. After a large change that writes a new `requirements.md`, act on no other line. Report at once.',
    ],
    ask: [
      `  preamble. Start the question with \`[${feature} inbox]\`, then end your turn. A medium or a large`,
      '  change is such a question.',
    ],
    inbox: INBOX_TAB_INBOX,
    done: [
      'Done proof: run `worker_done` from your worker preamble only when `inbox.md` holds no open `bug` or',
      '`change` line, or when a large change line reads `done: new requirements.md`. The coordinator reads',
      'the file before it accepts the report, and it sends you back when a line is open. Name each line and',
      'its outcome in the report.',
    ],
  });
}

/** The reasons of `beast-mode orca send`. */
export const SEND_REASONS = ['open-tasks', 'escalation', 'report', 'missing-verdict'];

/**
 * The subject and the body of one `send` (P2-11). `open-tasks` lists the
 * open items of the stage word for word: the open tasks of a phase, the
 * open findings of a review fix, or the open lines of the inbox stage.
 * `escalation` is the resume text, `report` asks for the report, and
 * `missing-verdict` asks for the verdict file. Pure.
 *
 * @param {{ label: string, reason: string, open: string[], spec: string | null, mail?: number, dispatchId?: string | null }} facts
 *   `label` names the work, for example "Phase 2 of demo". `spec` is the spec path of the tab. `mail` counts the
 *   undelivered messages of the tab (fix 7): a resume or a report text then names them.
 * @returns {{ subject: string, body: string }}
 */
export function sendText({ label, reason, open, spec, mail = 0, dispatchId = null }) {
  const items = open.map((item) => `- ${item}`);
  const mailLines = mail > 0 ? mailText(mail, dispatchId) : [];
  if (reason === 'open-tasks') {
    return {
      subject: `Open items: ${label}`,
      body: [
        `The coordinator read the files of ${label}, and these items are still open:`,
        ...items,
        '',
        'Finish each open item by your spec, and mark it done. Then run `worker_done` from your worker',
        'preamble again.',
      ].join('\n'),
    };
  }
  if (reason === 'escalation') {
    return {
      subject: `Resume: ${label}`,
      body: [
        `Your turn ended, or it was interrupted, with no report. Go on from where you stopped: resume the work of ${label} by your spec${spec ? `, \`${spec}\`` : ''}.`,
        'For an answer that you need, run the `ask` command of your worker preamble, then end your turn.',
        'Run `worker_done` from your worker preamble when the done proof of your spec holds.',
        ...mailLines,
        ...(items.length > 0 ? ['', 'These items are still open:', ...items] : []),
      ].join('\n'),
    };
  }
  if (reason === 'report') {
    return {
      subject: `Report: ${label}`,
      body: [
        `The coordinator read the files of ${label}, and the done proof of your spec holds.`,
        'Run `worker_done` from your worker preamble now, and name the work in the report.',
        ...mailLines,
      ].join('\n'),
    };
  }
  return {
    subject: `Verdict: ${label}`,
    body: [
      `Your report of ${label} came with no verdict file. Write the verdict file that your spec names.`,
      'Line 1 is `PASS`, `FAIL`, or `BLOCKED`. Then run `worker_done` from your worker preamble again.',
    ].join('\n'),
  };
}

/**
 * The mail line of a resume or a report send (fix 7): the tab has mail that
 * Orca has not delivered, most often the report of a helper that the tab
 * waits for. A message that the tab already marked read stays out of a
 * plain `check`, so the line names the mailbox for `inbox` too.
 *
 * @param {number} mail The undelivered messages.
 * @param {string | null} dispatchId
 * @returns {string[]}
 */
function mailText(mail, dispatchId) {
  const box = dispatchId ? `\`dispatch:${dispatchId}\`` : 'your mailbox';
  return [
    '',
    `You have unread orchestration mail: ${mail === 1 ? '1 message' : `${mail} messages`} that Orca has not delivered to you.`,
    'Read it now with the `check` command of your worker preamble, and act on it. When `check` returns',
    `nothing, list the mail with the \`inbox\` command of Orca for ${box}, with \`--full\`.`,
  ];
}

/**
 * The subject and the body of a user message that `note` sends to a
 * running tab (Decision 14): the text of the user word for word, then the
 * inbox instruction. Pure.
 *
 * @param {{ feature: string, kind: string, text: string }} facts `kind` is the inbox kind, for example "change small".
 * @returns {{ subject: string, body: string }}
 */
export function noteText({ feature, kind, text }) {
  return {
    subject: `User message (${kind})`,
    body: [
      text,
      '',
      '---',
      `This is a user message for the run of ${feature}, of the kind \`${kind}\`. It is an inbox item of`,
      'section 12 rule 3 of `.beast-mode/phase-handoff.md`. Write it as one line at the end of `## Items` in',
      `\`docs/features/${feature}/inbox.md\`, by section 12 rule 2, with the text word for word. Do not stop`,
      'your work for it. Act on the line when your spec says so.',
    ].join('\n'),
  };
}

/**
 * The spec of the docs tab of `/orca-feature`: `/update-feature`, plus
 * `/update-epic` for a feature inside an epic, plus `/update-master`. The
 * report is the done proof.
 *
 * The lane form runs `/update-feature` only.
 *
 * @param {{ feature: string, epic: string | null, lane?: boolean }} facts
 * @returns {string}
 */
export function docsSpec({ feature, epic, lane = false }) {
  const commands = docsCommands(feature, epic, lane).map((command, i) => `${i + 1}. Run the \`${command}\` command.`);
  return render({
    feature,
    epic,
    title: 'Docs',
    role: 'You update the docs of one feature after its build.',
    read: [
      `4. In \`docs/features/${feature}/\`: \`implementation.md\`, \`context.md\`, \`tasks.md\`, and`,
      '   `inbox.md`.',
    ],
    heading: 'Run the docs:',
    work: [...commands, 'Change no source file.'],
    ask: askTail(`${feature} docs`),
    inbox: STAGE_INBOX,
    done: [
      'Done proof: run `worker_done` from your worker preamble when the commands are done. The coordinator',
      'accepts the report as it is. Name each command and the files that it changed in the report.',
    ],
  });
}

/** The inbox rule of the epic docs tab: every feature has merged, so the tab names the message in its report. */
const EPIC_INBOX = [
  '- A user message that reaches you is an inbox item of section 12 rule 3. Name it in your report, word',
  '  for word. Every agent prompt that you write holds the inbox sentence of section 12 rule 4.',
];

/**
 * The spec of the epic docs tab of `/orca-epic`: `/update-epic`, then
 * `/update-master`, after the last merge, in the main workspace on the
 * epic branch. The tab makes no git write: the epic docs stay uncommitted
 * for the user (Decision 10). The report is the done proof.
 *
 * @param {{ epic: string }} facts
 * @returns {string}
 */
export function epicDocsSpec({ epic }) {
  const commands = epicDocsCommands(epic).map((command, i) => `${i + 1}. Run the \`${command}\` command.`);
  return render({
    feature: epic,
    epic: null,
    title: 'Epic docs',
    role: 'You update the docs of one epic after its last feature merged.',
    read: [
      `4. In \`docs/features/${epic}/\`: \`epic-overview.md\`, \`epic-requirements.md\`, and \`human-testing.md\`.`,
      '   Load the context of the epic by section 4 of `.beast-mode/epic-resolution.md`.',
    ],
    heading: 'Run the docs:',
    work: [...commands, 'Change no source file. Leave every change uncommitted for the user.'],
    ask: askTail(`${epic} epic-docs`),
    inbox: EPIC_INBOX,
    done: [
      'Done proof: run `worker_done` from your worker preamble when the commands are done. The coordinator',
      'accepts the report as it is. Name each command and the files that it changed in the report.',
    ],
  });
}

/**
 * The spec of one custom step tab (Decision 17): the command of the line
 * with its tokens filled, no git write, a verdict file, and then
 * `worker_done`. `point` is `epic` for a step after the epic: its tab runs
 * in the main workspace on the epic branch, and `target` is the epic name.
 *
 * @param {{ target: string, epic: string | null, point: string, command: string, verdictFile: string }} facts
 *   `target` is the feature path, or the epic name for the epic point. `command` has its tokens filled.
 *   `verdictFile` is the project path of the verdict file.
 * @returns {string}
 */
export function stepSpec({ target, epic, point, command, verdictFile }) {
  const atEpic = point === 'epic';
  return render({
    feature: target,
    epic: atEpic ? null : epic,
    title: 'Step',
    role: 'You run one custom step of the run, and you write its verdict.',
    read: atEpic
      ? [
          `4. In \`docs/features/${target}/\`: \`epic-overview.md\` and \`epic-requirements.md\`.`,
          '   Load the context of the epic by section 4 of `.beast-mode/epic-resolution.md`.',
        ]
      : [`4. In \`docs/features/${target}/\`: \`implementation.md\`, \`context.md\`, and \`tasks.md\`.`],
    heading: 'Run the step:',
    work: [
      `1. Run the \`${command}\` command. Change a file only when the command itself needs it.`,
      `2. Write the verdict file \`${verdictFile}\`. Line 1 is \`PASS\`, \`FAIL\`, or \`BLOCKED\`, and nothing else.`,
      '   Write `PASS` when the command found no fault. Write `FAIL` when it found a fault. Write `BLOCKED`',
      '   when the command could not run or could not check.',
      '3. After line 1, write the evidence: the result of the command, one item for each fault.',
    ],
    ask: askTail(`${target} step`),
    inbox: atEpic ? EPIC_INBOX : STAGE_INBOX,
    done: [
      `Done proof: run \`worker_done\` from your worker preamble only when \`${verdictFile}\` exists and line 1`,
      'names the verdict. The coordinator reads the file before it accepts the report, and it sends you back',
      'when the file is missing. Name the verdict and the evidence in the report.',
    ],
  });
}

/** The longest tab title (fix 5). */
export const TASK_TITLE_MAX = 60;

/**
 * The title of the Orca Task of a first start (fix 5): `<leaf>: <work>`.
 * Orca shows it as the tab title (`getAgentRowPrimaryText` reads the Task
 * title). The leaf of the feature comes first, so the tabs of one run sort
 * together. A step command that is too long ends in an ellipsis, so the
 * title stays within TASK_TITLE_MAX characters. Phase 0 is a real phase.
 *
 * @param {{ feature: string, stage: string, phase?: number | null, round?: number | null, command?: string | null }} facts
 *   `feature`: the feature path, or the epic name. `stage`: the stage of the start, or `epic-docs`. `round`: the fix round.
 *   `command`: the step command, with its tokens filled.
 * @returns {string}
 */
export function taskTitleOf({ feature, stage, phase = null, round = null, command = null }) {
  const leaf = feature.split('/').filter(Boolean).pop() ?? feature;
  const numbered = Number.isInteger(phase) && /** @type {number} */ (phase) >= 0;
  /** @type {string} */
  let work;
  if (stage === 'phase' && numbered) work = `Phase ${phase} implement`;
  else if (stage === 'verify' && numbered) work = `Phase ${phase} verify`;
  else if (stage === 'fix' && numbered) work = Number.isInteger(round) && /** @type {number} */ (round) > 0 ? `Phase ${phase} fix ${round}` : `Phase ${phase} fix`;
  else if (stage === 'review-fix') work = 'review fixes';
  else if (stage === 'epic-docs') work = 'epic docs';
  else if (stage === 'step') work = `step ${(command ?? '').replace(/\s+/g, ' ').trim()}`.trim();
  else work = stage;
  const head = `${leaf}: `;
  const room = TASK_TITLE_MAX - head.length;
  if (work.length > room) work = room > 1 ? `${work.slice(0, room - 1).trimEnd()}…` : work.slice(0, Math.max(room, 0));
  return `${head}${work}`.slice(0, TASK_TITLE_MAX);
}
