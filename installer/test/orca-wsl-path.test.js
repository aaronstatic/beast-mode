import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  windowsPathForWsl,
  orcaArgsForHost,
  orcaCalls,
  orcaHostOf,
  findLauncher,
  resolveOrcaHost,
  wrongHostSentence,
} from '../lib/orca/exec.js';

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

// The real Linux launcher shape (~/.orca/cli/bin/orca), with placeholder paths.
const LINUX_LAUNCHER = `#!/usr/bin/env sh
set -eu
export ORCA_USER_DATA_PATH='/home/u/.orca'
unset NODE_OPTIONS NODE_REPL_EXTERNAL_MODULE ELECTRON_RUN_AS_NODE
exec '/home/u/.orca/orcad-artifacts/linux-x64-glibc/runtimes/node-abc/bin/node' '/home/u/.orca/orcad-artifacts/linux-x64-glibc/0.1.0+abc/out/cli/index.js' "$@"
`;

// A plausible Windows launcher (wsl-managed-cli/<id>/orca-ide): it forwards to orca.exe.
const WINDOWS_LAUNCHER = `#!/bin/sh
cd "$(wslpath -w "$PWD")" 2>/dev/null || true
exec '/mnt/c/Users/u/AppData/Local/Programs/orca/orca.exe' "$@"
`;

test('orcaHostOf: a Linux launcher text, an ELF header, and a data path alone give linux', () => {
  assert.equal(orcaHostOf(LINUX_LAUNCHER, '/home/u/.orca/cli/bin/orca'), 'linux');
  assert.equal(orcaHostOf('\x7fELF\x02\x01\x01\x00', '/usr/local/bin/orca'), 'linux');
  assert.equal(orcaHostOf("export ORCA_USER_DATA_PATH='/home/u/.orca'\nrun-it\n", ''), 'linux');
  assert.equal(orcaHostOf('exec /opt/o/bin/node /opt/o/out/cli/index.js "$@"\n', ''), 'linux');
});

test('orcaHostOf: a Windows launcher, a drive mount path, and wsl-managed-cli give windows', () => {
  assert.equal(orcaHostOf(WINDOWS_LAUNCHER, '/home/u/.local/bin/orca-ide'), 'windows');
  assert.equal(orcaHostOf('#!/bin/sh\nexec orca.exe "$@"\n', ''), 'windows');
  assert.equal(orcaHostOf('anything', '/mnt/c/Users/u/orca/bin/orca'), 'windows');
  assert.equal(orcaHostOf('anything', '/home/u/orca.exe'), 'windows');
  assert.equal(orcaHostOf('anything', '/mnt/c/Users/u/AppData/Roaming/orca/wsl-managed-cli/ab/orca-ide'), 'windows');
  assert.equal(orcaHostOf('anything', '/x/wsl-managed-cli/ab/orca-ide'), 'windows');
});

test('orcaHostOf: other text gives unknown, and a node under /mnt is no Linux sign', () => {
  assert.equal(orcaHostOf('#!/bin/sh\necho hello\n', '/usr/bin/orca'), 'unknown');
  assert.equal(orcaHostOf('', ''), 'unknown');
  assert.equal(orcaHostOf("exec '/mnt/c/n/bin/node' '/mnt/c/o/out/cli/index.js'\n", ''), 'unknown');
  assert.equal(orcaHostOf("export ORCA_USER_DATA_PATH='/mnt/c/Users/u/orca'\n", ''), 'unknown');
});

test('orcaArgsForHost: a linux host keeps the Linux spec path, windows and unknown convert', () => {
  const call = orcaCalls.workerStart({ specFile: '/home/u/dev/bitwig-cli/.beast-mode/briefs/p/orca-plan.md', agent: 'claude' });
  const env = { WSL_DISTRO_NAME: 'Ubuntu' };
  assert.equal(orcaArgsForHost(call.args, env, 'linux', 'linux'), call.args, 'the Linux orcad CLI reads the Linux path');
  for (const host of ['windows', 'unknown', undefined]) {
    const out = orcaArgsForHost(call.args, env, 'linux', host);
    assert.equal(out[out.indexOf('--spec-file') + 1], '\\\\wsl.localhost\\Ubuntu\\home\\u\\dev\\bitwig-cli\\.beast-mode\\briefs\\p\\orca-plan.md', String(host));
  }
  assert.equal(orcaArgsForHost(call.args, { ...env, ORCA_DEV_REPO_ROOT: '/r' }, 'linux', 'windows'), call.args);
  assert.equal(orcaArgsForHost(call.args, {}, 'linux', 'windows'), call.args, 'not WSL');
});

/** @param {Record<string, { text: string, link?: string }>} files */
function fakeIo(files) {
  const real = (p) => files[p]?.link ?? p;
  return {
    statSync: (p) => {
      if (!files[p]) throw new Error('ENOENT');
      return { isFile: () => true };
    },
    realpathSync: real,
    readHead: (p) => {
      const file = files[p];
      if (!file) throw new Error('ENOENT');
      return file.text;
    },
  };
}

test('findLauncher: a path with a slash is used as it is, a bare name is the first file on PATH', () => {
  const io = fakeIo({ '/b/orca': { text: 'x' }, '/c/orca': { text: 'y' } });
  assert.equal(findLauncher('/c/orca', { PATH: '/b' }, io), '/c/orca');
  assert.equal(findLauncher('/missing/orca', { PATH: '/b' }, io), null);
  assert.equal(findLauncher('orca', { PATH: '/a::/b:/c' }, io), '/b/orca');
  assert.equal(findLauncher('orca', { PATH: '/a' }, io), null);
  assert.equal(findLauncher('orca', {}, io), null);
});

test('resolveOrcaHost: probes the launcher on WSL, follows a symlink, and answers unknown on any error', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu', PATH: '/bin:/usr/bin' };
  const io = fakeIo({
    '/usr/bin/orca-ide': { text: '', link: '/home/u/.orca/cli/bin/orca' },
    '/home/u/.orca/cli/bin/orca': { text: LINUX_LAUNCHER },
    '/usr/bin/orca-win': { text: WINDOWS_LAUNCHER },
  });
  assert.equal(resolveOrcaHost('orca-ide', env, 'linux', io), 'linux');
  assert.equal(resolveOrcaHost('orca-win', env, 'linux', io), 'windows');
  assert.equal(resolveOrcaHost('orca-none', env, 'linux', io), 'unknown', 'not on PATH');
  assert.equal(resolveOrcaHost('orca-win', env, 'linux', { ...io, readHead: () => { throw new Error('EACCES'); } }), 'unknown');
  // No read at all outside WSL.
  const spy = { ...io, statSync: () => { throw new Error('must not probe'); } };
  assert.equal(resolveOrcaHost('orca-ide', { PATH: '/usr/bin' }, 'linux', spy), 'unknown');
  assert.equal(resolveOrcaHost('orca-ide', env, 'darwin', spy), 'unknown');
});

test('resolveOrcaHost: BEAST_MODE_ORCA_HOST wins over the probe', () => {
  const io = fakeIo({ '/usr/bin/orca-ide': { text: LINUX_LAUNCHER } });
  const env = { WSL_DISTRO_NAME: 'Ubuntu', PATH: '/usr/bin' };
  assert.equal(resolveOrcaHost('orca-ide', { ...env, BEAST_MODE_ORCA_HOST: 'windows' }, 'linux', io), 'windows');
  assert.equal(resolveOrcaHost('orca-ide', { ...env, BEAST_MODE_ORCA_HOST: ' Linux ' }, 'linux', io), 'linux');
  assert.equal(resolveOrcaHost('orca-ide', { ...env, BEAST_MODE_ORCA_HOST: 'bogus' }, 'linux', io), 'linux', 'a bad value is ignored');
});

test('resolveOrcaHost: reads the real file on disk, 8 KiB at most', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-orca-host-'));
  try {
    fs.writeFileSync(path.join(dir, 'real'), LINUX_LAUNCHER + 'x'.repeat(20000));
    fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'orca-ide'));
    const env = { WSL_DISTRO_NAME: 'Ubuntu', PATH: `${dir}` };
    assert.equal(resolveOrcaHost('orca-ide', env, 'linux'), 'linux');
    assert.equal(resolveOrcaHost(path.join(dir, 'real'), env, 'linux'), 'linux');
    assert.equal(resolveOrcaHost(dir, env, 'linux'), 'unknown', 'a directory is no launcher');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wrongHostSentence: names ORCA_CLI_COMMAND and the host after a wrong-form spec path, else says nothing', () => {
  const unc = ['Could not read /home/u/dev/bitwig-cli/\\\\wsl.localhost\\Ubuntu\\home\\u\\dev\\bitwig-cli\\.beast-mode\\briefs\\p\\orca-plan.md: ENOENT'];
  const sentence = wrongHostSentence(unc, 'unknown');
  assert.match(sentence, /ORCA_CLI_COMMAND/);
  assert.match(sentence, /detected host: unknown/);
  assert.match(sentence, /runs on linux/);
  const win = wrongHostSentence(['invalid_argument: Could not read C:\\home\\u\\p\\orca-plan.md: ENOENT'], 'linux');
  assert.match(win, /runs on windows/);
  assert.match(win, /detected host: linux/);
  assert.equal(wrongHostSentence(['Could not read /home/u/p/x.md: ENOENT'], 'linux'), '');
  assert.equal(wrongHostSentence(['runtime_unavailable'], 'linux'), '');
  assert.equal(wrongHostSentence([], 'linux'), '');
});
