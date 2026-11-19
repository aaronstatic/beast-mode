import type { FeatureTree } from '../hooks/lib/features'

// Shared test data: the scratch tree of plan section 3.7, and the tasks.md and
// bug shapes of sections 3.4 and 3.5. No Node import: lines are joined here.

export const ROOT = '/work/project'

/** One doc: the lines joined with `\n`, and a final newline, as `printf` writes it. */
export function doc(...docLines: string[]): string {
  return docLines.join('\n') + '\n'
}

const DEMO_TASKS = doc(
  '# Demo - Task Checklist',
  '',
  '**Last Updated:** 2026-10-01 09:00',
  '**Progress:** 3/3 tasks complete (100%)',
  '',
  '## Phase 1: Setup (3/3 complete)',
  '',
  '- [x] ✅ **1.1 Make the folder**',
  '- [x] ✅ **1.2 Add the readme**',
  '- [x] ✅ **1.3 Add the notes**',
)

const CART_TASKS = doc(
  '# Cart - Task Checklist',
  '',
  '**Last Updated:** 2026-10-02 10:30\\',
  '**Progress:** 1/4 tasks complete (25%)\\',
  '',
  '## Phase 1: The model (1/1 complete)',
  '',
  '- \\[x\\] ✅ **1.1 Write the cart type**',
  '',
  '## Phase 2: The view (0/3 complete) - ADVANCED (`tooling-dev-advanced`)',
  '',
  '- \\[ \\] **2.1 Draw the cart row**',
  '  - Description: One row per item',
  '- \\[ \\] ⏸️ **2.2 Draw the total** (waits for a person)',
  '- \\[ \\] **2.3 Draw the empty state**',
  '',
  '---',
  '',
  '## Task Status Legend',
  '',
  '- [ ] Not started',
  '- [x] ✅ Completed',
)

export const BUG_001 = doc(
  '---',
  'id: BUG-001',
  'title: "The \\"Total\\" row overflows"',
  'status: open',
  'priority: high',
  'linkedFeature: cart',
  '---',
  '',
  'The total row is too wide.',
)

export const BUG_002 = doc(
  '---',
  'id: BUG-002',
  'title: "A closed cart bug"',
  'status: closed',
  'linkedFeature: shop/cart',
  '---',
)

export const BUG_003 = doc(
  '---',
  'id: BUG-003',
  'title: "A demo bug"',
  'status: in-progress',
  'linkedFeature: demo',
  '---',
)

/** The real BUG-005 of this repo: a quoted title with escaped quotes. */
export const BUG_005 = doc(
  '---',
  'id: BUG-005',
  'title: "\\"New Bug\\" doesnt pre-fill epic + feature"',
  'status: closed',
  'priority: medium',
  'linkedFeature: web-app/core',
  'createdAt: 2026-06-11T05:54:37.431Z',
  'updatedAt: 2026-06-11T15:45:00.000Z',
  '---',
  '',
  'When using the "New Bug" button within an epic.',
)

/** The scratch tree of section 3.7: absolute path to text. Folders are implied. */
export const SCRATCH_TREE: Record<string, string> = {
  [`${ROOT}/docs/features/shop/epic-overview.md`]: doc('# Shop - Epic Overview'),
  [`${ROOT}/docs/features/shop/cart/context.md`]: doc('**Status:** 🟡 In Progress'),
  [`${ROOT}/docs/features/demo/tasks.md`]: DEMO_TASKS,
  [`${ROOT}/docs/features/shop/cart/tasks.md`]: CART_TASKS,
  [`${ROOT}/docs/bugs/BUG-001.md`]: BUG_001,
  [`${ROOT}/docs/bugs/BUG-002.md`]: BUG_002,
  [`${ROOT}/docs/bugs/BUG-003.md`]: BUG_003,
}

/** The shape of `templates/dev-docs/tasks.md`, trimmed: every checkbox section kind it holds. */
export const TEMPLATE_TASKS = doc(
  '# [Feature Name] - Task Checklist',
  '',
  '**Last Updated:** YYYY-MM-DD HH:MM',
  '**Progress:** 0/20 tasks complete (0%)',
  '',
  '---',
  '',
  '## Phase 1: [Phase Name] (0/5 complete)',
  '',
  '- [ ] **Task 1 Title**',
  '  - Description: [What needs to be done]',
  '  - File(s): `src/path/to/file.ts`',
  '  - Estimate: X hours',
  '',
  '- [ ] **Task 2 Title**',
  '  - Description: [What needs to be done]',
  '',
  '---',
  '',
  '## Phase 2: [Phase Name] (0/7 complete)',
  '',
  '- [ ] **Task 1 Title**',
  '',
  '---',
  '',
  '## Bugs & Issues',
  '',
  '**Active Bugs:**',
  '- [ ] 🐛 **[Bug Title]** - Priority: High/Medium/Low',
  '',
  '**Fixed Bugs:**',
  '- [x] ✅ 🐛 **[Fixed Bug]** - Fixed YYYY-MM-DD',
  '',
  '---',
  '',
  '## Testing Tasks',
  '',
  '- [ ] **Manual testing checklist**',
  '  - [ ] Test scenario 1',
  '',
  '---',
  '',
  '## Task Status Legend',
  '',
  '- [ ] Not started',
  '- [ ] 🔄 In progress',
  '- [ ] ⏸️ Blocked (waiting on something)',
  '- [x] ✅ Completed',
  '- [x] ❌ Cancelled/Won\'t do',
)

/** Last Updated values, with the stamp key each one gives. */
export const STAMP_CASES: ReadonlyArray<readonly [string, string | null]> = [
  ['2026-09-23 00:20', '2026-09-23 00:20'],
  ['2026-09-17 (Phase 6, part 3: the tests)', '2026-09-17 00:00'],
  ['2026-09-18 15:44 UTC', '2026-09-18 15:44'],
  ['2026-06-16', '2026-06-16 00:00'],
  ['2026-06-16T9:05', '2026-06-16 09:05'],
  ['YYYY-MM-DD HH:MM', null],
  ['', null],
  ['yesterday', null],
]

/** Phase headings, with the title each one gives, or null when the line opens no phase. */
export const HEADING_CASES: ReadonlyArray<readonly [string, string | null]> = [
  ['## Phase 5b: The reader', 'Phase 5b: The reader'],
  ['## Phase A: Setup', 'Phase A: Setup'],
  ['## PHASE 3: Loud', 'PHASE 3: Loud'],
  [
    '## Phase 1: The dsh reader and its tests (9/9 complete) - ADVANCED (`prompt-developer-advanced`)',
    'Phase 1: The dsh reader and its tests',
  ],
  ['## Phase 8: The runbook (2/6 complete, 4 wait for a person) - STANDARD', 'Phase 8: The runbook'],
  ['## Phase 9: No count', 'Phase 9: No count'],
  ['## Phases of the moon', null],
  ['## Phase', null],
  ['### Phase 2: Too deep', null],
  ['## Bugs & Issues', null],
  ['## Task Status Legend', null],
]

/** A tasks.md with a fenced example, a second heading level, and every task shape. */
export const REAL_SHAPES_TASKS = doc(
  '# Optimization - Task Checklist',
  '',
  '**Last Updated:** 2026-09-23 00:20\\',
  '**Progress:** 69/73 tasks complete (95%)\\',
  '**Advanced phases:** Phase 1, Phase 2',
  '',
  '```',
  '## Phase 0: Inside a fence',
  '- [ ] A task inside a fence',
  '```',
  '',
  '## Phase 5b: Escaped boxes (2/3 complete)',
  '',
  '- \\[x\\] ✅ **5b.1 Write the tool rules file**',
  '- [x] ❌ **5b.2 Drop the old reader**',
  '- \\[ \\] ⏸️ **5b.3 Run the before measurement on each harness (live, a person)**',
  '  - [ ] An indented box is no task',
  '',
  '### A sub heading',
  '',
  '- [ ] **5b.4 Under a sub heading**',
  '',
  '## Phase A: Plain boxes (0/1 complete)',
  '',
  '* [ ] **A.1 Star bullet** with `code`',
  '',
  '## Bugs & Issues',
  '',
  '- [ ] 🐛 **Not a phase task**',
)

/** The tree that `readTree` gives for the scratch tree of section 3.7 (tree order: A to Z). */
export const SCRATCH_FEATURE_TREE: FeatureTree = {
  exists: true,
  top: [
    { name: 'demo', files: ['tasks.md'], tasksMtime: 100, children: [] },
    {
      name: 'shop',
      files: ['epic-overview.md'],
      tasksMtime: 0,
      children: [{ name: 'cart', files: ['context.md', 'tasks.md'], tasksMtime: 200 }],
    },
  ],
}

/** The `tasks.md` texts of the two scratch candidates, by path, as `pickActive` takes them. */
export const SCRATCH_TASKS_TEXTS: ReadonlyMap<string, string | null> = new Map([
  ['demo', SCRATCH_TREE[`${ROOT}/docs/features/demo/tasks.md`] ?? null],
  ['shop/cart', SCRATCH_TREE[`${ROOT}/docs/features/shop/cart/tasks.md`] ?? null],
])

// The dashboard fixtures: the scratch tree of section 3.12, the name cases of
// section 3.4, and the expected lines of section 3.12.

export const DASH_OVERVIEW = doc(
  '# Scratch - Overview',
  '',
  '**Last Updated:** 2026-10-05',
  '',
  '## Feature Status',
  '',
  '| Feature | Status | Tasks | Notes |',
  '|---------|--------|-------|-------|',
  '| shop (epic) | In Progress | 1/4 (25%) | The shop epic |',
  '| demo | Complete | 3/3 (100%) | The demo feature |',
  '| ghost | Planned | — | A row with no folder |',
)

export const DASH_EPIC_OVERVIEW = doc(
  '# Shop - Epic Overview',
  '',
  '**Epic:** shop',
  '**Status:** 🟡 In Progress',
  '**Last Updated:** 2026-10-05 07:57',
  '',
  '## Features',
  '',
  '| # | Feature | Status | Tasks | Description |',
  '|---|---------|--------|-------|-------------|',
  '| 1 | cart | In Progress | 1/4 (25%) | The cart |',
  '| 2 | checkout | Planned | — | The checkout |',
)

export const DASH_DEMO_TASKS = doc(
  '# Demo - Task Checklist',
  '',
  '**Last Updated:** 2026-10-05 07:57',
  '**Progress:** 3/3 tasks complete (100%)',
  '',
  '## Phase 1: Setup (3/3 complete)',
  '',
  '- [x] ✅ **1.1 Make the folder**',
  '- [x] ✅ **1.2 Add the readme**',
  '- [x] ✅ **1.3 Add the notes**',
)

export const DASH_CART_TASKS = doc(
  '# Cart - Task Checklist',
  '',
  '**Last Updated:** 2026-10-05 07:57',
  '**Progress:** 1/4 tasks complete (25%)\\',
  '',
  '## Phase 1: The model (1/1 complete)',
  '',
  '- \\[x\\] ✅ **1.1 Write the cart type**',
  '',
  '## Phase 2: The view (0/3 complete) - ADVANCED (`tooling-dev-advanced`)',
  '',
  '- \\[ \\] **2.1 Draw the cart row**',
  '  - Description: One row per item',
  '- \\[ \\] ⏸️ **2.2 Draw the total** (waits for a person)',
  '- \\[ \\] **2.3 Draw the empty state**',
)

/** The scratch tree of section 3.12: absolute path to text, under `ROOT`. Folders are implied. */
export const DASH_TREE: Record<string, string> = {
  [`${ROOT}/docs/overview.md`]: DASH_OVERVIEW,
  [`${ROOT}/docs/features/shop/epic-overview.md`]: DASH_EPIC_OVERVIEW,
  [`${ROOT}/docs/features/notes/requirements.md`]: doc('# Notes - Requirements'),
  [`${ROOT}/docs/features/shop/cart/context.md`]: doc('**Status:** 🟡 In Progress'),
  [`${ROOT}/docs/features/demo/tasks.md`]: DASH_DEMO_TASKS,
  [`${ROOT}/docs/features/shop/cart/tasks.md`]: DASH_CART_TASKS,
  [`${ROOT}/docs/bugs/BUG-001.md`]: BUG_001,
  [`${ROOT}/docs/bugs/BUG-002.md`]: BUG_002,
  [`${ROOT}/docs/bugs/BUG-003.md`]: BUG_003,
}

/** The tree that `readTree` gives for `DASH_TREE` (tree order: A to Z). `checkout` has no folder. */
export const DASH_FEATURE_TREE: FeatureTree = {
  exists: true,
  top: [
    { name: 'demo', files: ['tasks.md'], tasksMtime: 100, children: [] },
    { name: 'notes', files: ['requirements.md'], tasksMtime: 0, children: [] },
    {
      name: 'shop',
      files: ['epic-overview.md'],
      tasksMtime: 0,
      children: [{ name: 'cart', files: ['context.md', 'tasks.md'], tasksMtime: 200 }],
    },
  ],
}

/** Feature cells of a status table, with the epic of the table, and the name each one gives (section 3.4). */
export const NAME_CASES: ReadonlyArray<readonly [string, string | undefined, string]> = [
  ['claude-code (epic)', undefined, 'claude-code'],
  ['shop (EPIC)', undefined, 'shop'],
  ['**`cart`**', undefined, 'cart'],
  ['[cart](docs/features/shop/cart/)', undefined, 'cart'],
  ['shop/', undefined, 'shop'],
  ['shop/cart', 'shop', 'cart'],
  ['shop/cart', undefined, 'shop/cart'],
  ['cart', 'shop', 'cart'],
  ['other/cart', 'shop', 'other/cart'],
  ['   ', undefined, ''],
]

/** `/dashboard` over `DASH_TREE`: the project view (section 3.12). Line 0 is the folder name of the root. */
export const DASH_LINES_PROJECT: readonly string[] = [
  'project',
  'From docs/overview.md, updated 2026-10-05',
  '',
  'shop  epic',
  '  ███░░░░░░░ 25%  1 open bug  In Progress',
  'demo',
  '  ██████████ 100%  1 open bug  Complete',
  'ghost  no folder',
  '  Planned',
  'notes',
  '  not in docs/overview.md',
]

/** The epic view of `shop`. */
export const DASH_LINES_EPIC: readonly string[] = [
  'b: Back  shop',
  'Status: 🟡 In Progress',
  'From epic-overview.md, updated 2026-10-05 07:57',
  'a: Autorun  u: Update',
  '',
  'cart  Autorun',
  '  ███░░░░░░░ 25%  1 open bug  In Progress',
  'checkout  no folder',
  '  Planned',
]

/** The feature view of `shop/cart`, with phase 2 open. */
export const DASH_LINES_FEATURE: readonly string[] = [
  'b: Back  shop/cart',
  'Status: 🟡 In Progress',
  'Progress:  ███░░░░░░░ 1/4 tasks complete (25%)',
  'a: Autorun  p: Proceed  c: Continue  u: Update',
  '',
  'Phases (2)',
  '+  ██████████  Phase 1: The model (1/1)',
  '-  ░░░░░░░░░░  Phase 2: The view (0/3)',
  '    [ ] 2.1 Draw the cart row',
  '    [ ] ⏸️ 2.2 Draw the total (waits for a person)',
  '    [ ] 2.3 Draw the empty state',
  '',
  'Open bugs (1)',
  'BUG-001  The "Total" row overflows',
]

/** The bug view of `BUG-001.md`. */
export const DASH_LINES_BUG: readonly string[] = [
  'b: Back  BUG-001',
  'The "Total" row overflows',
  'f: Fix',
  '',
  'status: open',
  'priority: high',
  'linkedFeature: cart',
  '',
  'The total row is too wide.',
]

/** The project view of a copy of `DASH_TREE` with no `docs/overview.md`. Every folder is unlisted, A to Z. */
export const DASH_LINES_NO_OVERVIEW: readonly string[] = [
  'project',
  'No docs/overview.md. Run /update-master to make one.',
  '',
  'demo',
  '  1 open bug  not in docs/overview.md',
  'notes',
  '  not in docs/overview.md',
  'shop  epic',
  '  1 open bug  not in docs/overview.md',
]

/** The project view of an empty folder. */
export const DASH_LINES_EMPTY: readonly string[] = [
  'project',
  'No docs/overview.md. Run /update-master to make one.',
  '',
  'No feature folder in docs/features/. Run /plan-feature <name> to start one.',
]
