// dsh/test/project-map.test.js
//
// Covers the workspace-to-project map of implementation.md section 3.3
// (harness-support/dsh-web-panel, Phase 2): the slug rule, the collision
// suffix, the live workspace read, and the panel index installed flag.
//
// Every test runs with plain Node. No test starts dsh and no test opens a
// socket.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPanelIndex,
  buildProjectList,
  createWorkspaceProvider,
  projectNameFor,
} from '../lib/project-map.js';

test('projectNameFor keeps the allowed slug characters', () => {
  assert.equal(projectNameFor('beast-mode', 'id-1'), 'beast-mode');
  assert.equal(projectNameFor('My_Cool.Project', 'id-1'), 'My_Cool.Project');
});

test('projectNameFor collapses one disallowed run to one hyphen', () => {
  assert.equal(projectNameFor('My Cool  Project!!', 'id-1'), 'My-Cool-Project');
  assert.equal(projectNameFor('a/b\\c', 'id-1'), 'a-b-c');
});

test('projectNameFor trims a leading or trailing hyphen', () => {
  assert.equal(projectNameFor('  leading and trailing  ', 'id-1'), 'leading-and-trailing');
  assert.equal(projectNameFor('***only symbols***', 'id-1'), 'only-symbols');
});

test('projectNameFor falls back to the workspace id for an empty title', () => {
  assert.equal(projectNameFor('', 'workspace-empty-id'), 'workspace-empty-id');
  assert.equal(projectNameFor('###', 'workspace-symbol-id'), 'workspace-symbol-id');
});

test('buildProjectList gives a duplicate title a first-6-of-id suffix', () => {
  const workspaces = [
    { id: 'aaaaaa11', path: '/one', title: 'shared' },
    { id: 'bbbbbb22', path: '/two', title: 'shared' },
  ];
  const list = buildProjectList(workspaces);
  assert.equal(list[0].name, 'shared');
  assert.equal(list[1].name, 'shared-bbbbbb');
  assert.notEqual(list[0].name, list[1].name);
});

test('buildProjectList carries one entry per workspace, in order', () => {
  const workspaces = [
    { id: 'id-1', path: '/repo-1', title: 'repo-one' },
    { id: 'id-2', path: '/repo-2', title: 'repo-two' },
  ];
  const list = buildProjectList(workspaces);
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((entry) => entry.name),
    ['repo-one', 'repo-two']
  );
  assert.deepEqual(
    list.map((entry) => entry.path),
    ['/repo-1', '/repo-2']
  );
});

test('createWorkspaceProvider getAll() reads the registry on every call', () => {
  let workspaces = [{ id: 'id-1', path: '/repo-1', title: 'repo-one' }];
  const provider = createWorkspaceProvider(() => workspaces);

  assert.equal(provider.getAll().length, 1);

  // A workspace the fake registry adds after the provider exists must
  // appear with no restart — getAll() must call getWorkspaces() again.
  workspaces = [
    ...workspaces,
    { id: 'id-2', path: '/repo-2', title: 'repo-two' },
  ];
  const second = provider.getAll();
  assert.equal(second.length, 2);
  assert.ok(second.some((project) => project.name === 'repo-two'));
});

test('createWorkspaceProvider get() finds an entry by name, else undefined', () => {
  const workspaces = [{ id: 'id-1', path: '/repo-1', title: 'repo-one' }];
  const provider = createWorkspaceProvider(() => workspaces);
  assert.equal(provider.get('repo-one').path, '/repo-1');
  assert.equal(provider.get('no-such-project'), undefined);
});

test('createWorkspaceProvider resolvePath() returns the project path', () => {
  const provider = createWorkspaceProvider(() => []);
  assert.equal(provider.resolvePath({ path: '/some/path' }), '/some/path');
});

test('buildPanelIndex reports installed true when exists() reports true', () => {
  const workspaces = [{ id: 'id-1', path: '/repo-1', title: 'repo-one' }];
  const index = buildPanelIndex(workspaces, () => true);
  assert.equal(index.version, 1);
  assert.equal(index.workspaces.length, 1);
  assert.equal(index.workspaces[0].installed, true);
  assert.equal(index.workspaces[0].project, 'repo-one');
  assert.equal(index.workspaces[0].workspaceId, 'id-1');
  assert.equal(index.workspaces[0].title, 'repo-one');
});

test('buildPanelIndex reports installed false for a path with no docs/features', () => {
  const workspaces = [{ id: 'id-1', path: '/repo-1', title: 'repo-one' }];
  const index = buildPanelIndex(workspaces, () => false);
  assert.equal(index.workspaces[0].installed, false);
});

test('buildPanelIndex passes the docs/features path to exists()', () => {
  const workspaces = [{ id: 'id-1', path: '/repo-1', title: 'repo-one' }];
  const seenPaths = [];
  buildPanelIndex(workspaces, (path) => {
    seenPaths.push(path);
    return true;
  });
  assert.equal(seenPaths.length, 1);
  assert.ok(seenPaths[0].endsWith(`docs${seenPaths[0].includes('\\') ? '\\' : '/'}features`));
});
