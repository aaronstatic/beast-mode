import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowsPathForWsl, orcaArgsForHost, orcaCalls } from '../lib/orca/exec.js';

test('windowsPathForWsl maps a Linux path to the wsl.localhost UNC form', () => {
  assert.equal(windowsPathForWsl('/home/u/p/.beast-mode/briefs/e/f/orca-phase-9.md', 'Ubuntu'),
    '\\\\wsl.localhost\\Ubuntu\\home\\u\\p\\.beast-mode\\briefs\\e\\f\\orca-phase-9.md');
});

test('windowsPathForWsl maps /mnt/<drive> to a drive letter', () => {
  assert.equal(windowsPathForWsl('/mnt/c/Users/u/spec.md', 'Ubuntu'), 'C:\\Users\\u\\spec.md');
  assert.equal(windowsPathForWsl('/mnt/d', 'Ubuntu'), 'D:\\');
});

test('windowsPathForWsl leaves a relative path or a non-WSL run alone', () => {
  assert.equal(windowsPathForWsl('briefs/s.md', 'Ubuntu'), 'briefs/s.md');
  assert.equal(windowsPathForWsl('/home/u/s.md', undefined), '/home/u/s.md');
});

test('orcaArgsForHost rewrites only the --spec-file value, on WSL only', () => {
  const call = orcaCalls.workerStart({ specFile: '/home/u/p/s.md', agent: 'dsh' });
  const wsl = orcaArgsForHost(call.args, { WSL_DISTRO_NAME: 'Ubuntu' }, 'linux');
  assert.equal(wsl[wsl.indexOf('--spec-file') + 1], '\\\\wsl.localhost\\Ubuntu\\home\\u\\p\\s.md');
  assert.deepEqual(wsl.filter((a, i) => call.args[i] !== a).length, 1, 'one argument changes');
  assert.equal(orcaArgsForHost(call.args, {}, 'linux'), call.args, 'plain Linux keeps the args');
  assert.equal(orcaArgsForHost(call.args, { WSL_DISTRO_NAME: 'Ubuntu' }, 'darwin'), call.args);
  assert.equal(orcaArgsForHost(call.args, { WSL_DISTRO_NAME: 'Ubuntu', ORCA_DEV_REPO_ROOT: '/r' }, 'linux'), call.args, 'orca-dev runs in Linux');
});
