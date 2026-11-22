import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks } from '../lib/orca/read.js';

const TASKS = `# Tasks
## Phase 9: Gate (5/5 complete)
- [x] **9.1** gate steps
- [x] **9.2** live gate
## Phase 11: DragonBones (5/5 complete)
- [x] **11.1** facts
## Phase 10 (DEFERRED -- optional formats, trigger-gated, not in scope for this run): excluded from the Progress denominator
Nothing here starts without its trigger:
- **Rive RML** -- a watch item.
- [ ] **A deferred task line** that must not count
## Phase 12 (skipped)
- [ ] **12.1** skipped
## Owner items
- [ ] an owner line counts nowhere
`;

test('a DEFERRED or SKIPPED phase is no phase of the run', () => {
  const { phases } = parseTasks(TASKS);
  assert.deepEqual(phases.map((p) => p.number), [9, 11]);
  assert.ok(phases.every((p) => p.done === p.total), 'no open line leaks in from the deferred phase');
});

test('a phase that only mentions the word in a task line still counts', () => {
  const { phases } = parseTasks('## Phase 1: Build\n- [ ] **1.1** remove the deferred queue\n');
  assert.equal(phases.length, 1);
  assert.equal(phases[0].open.length, 1);
});
