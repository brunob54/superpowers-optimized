#!/usr/bin/env node
/**
 * Unit tests — every tracked script that starts with "#!" is checked out with
 * LF line ends, also with `core.autocrlf=true`
 *
 * On Windows, git is often set with `core.autocrlf=true`. With that setting,
 * git writes a text file into the working tree with CRLF line ends (a carriage
 * return before each line feed), unless a `.gitattributes` rule gives the file
 * `eol=lf`. A script with CRLF line ends does not start: the system reads the
 * first line "#!/usr/bin/env bash" with a carriage return at its end, and the
 * call fails with "env: bash\r: No such file or directory". In v7.62.0 the
 * three scripts in skills/subagent-driven-development/scripts/ have no file
 * name extension, so no rule of `.gitattributes` matched them.
 *
 * `crlfScripts(root)` lists the tracked files of the git repository `root`
 * that start with "#!". For each one, it asks git for the text that a checkout
 * with `core.autocrlf=true` writes (`git cat-file --filters`, which applies the
 * `.gitattributes` rules of the working tree). It returns the paths whose text
 * holds a carriage return. The tests run it on this repository, and on a small
 * repository with a new script, so the check is seen to catch a script that
 * no rule covers.
 *
 * Run: node tests/codex/test-script-line-ends.js
 * Requirements: Node.js >= 16 and git; no other dependencies.
 */

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SHEBANG = '#!';
const CARRIAGE_RETURN = 0x0d;
const AUTOCRLF_ON = ['-c', 'core.autocrlf=true'];
// A git command can print more than the default 1 MB of output (a large file).
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: MAX_OUTPUT_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });

// A tracked path can be absent from the working tree (deleted, and the
// deletion not yet staged). Git does not check such a path out, so it is not
// a script to check. A symbolic link is not a script file either.
function startsWithShebang(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return false;
  const head = Buffer.alloc(SHEBANG.length);
  const fd = fs.openSync(file, 'r');
  try {
    const length = fs.readSync(fd, head, 0, head.length, 0);
    return head.toString('utf8', 0, length) === SHEBANG;
  } finally {
    fs.closeSync(fd);
  }
}

function crlfScripts(root) {
  const tracked = git(root, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
  const scripts = tracked.filter((file) => startsWithShebang(path.join(root, file)));
  return scripts.filter((file) => git(root, [...AUTOCRLF_ON, 'cat-file', '--filters', `:${file}`]).includes(CARRIAGE_RETURN));
}

const WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'script-line-ends-'));
process.on('exit', () => fs.rmSync(WORK_ROOT, { recursive: true, force: true }));

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('script line ends');

test('every tracked "#!" file of this repository is checked out with LF under core.autocrlf=true', () => {
  assert.deepStrictEqual(crlfScripts(REPO_ROOT), []);
});

test('a new script without an eol rule is reported, and is no longer reported once a rule gives it eol=lf', () => {
  const script = 'new-script';
  git(WORK_ROOT, ['init', '--quiet']);
  fs.writeFileSync(path.join(WORK_ROOT, script), `${SHEBANG}/usr/bin/env bash\necho started\n`);
  git(WORK_ROOT, ['add', script]);
  assert.deepStrictEqual(crlfScripts(WORK_ROOT), [script]);
  fs.writeFileSync(path.join(WORK_ROOT, '.gitattributes'), `${script} text eol=lf\n`);
  assert.deepStrictEqual(crlfScripts(WORK_ROOT), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
