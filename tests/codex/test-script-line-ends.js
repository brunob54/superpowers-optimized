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
 * `crlfScripts(root, extraFiles)` lists the tracked files of the git
 * repository `root` that start with "#!", and adds the paths of `extraFiles`.
 * For each one, it asks git for the text that a checkout with
 * `core.autocrlf=true` writes (`git cat-file --filters`, which applies the
 * `.gitattributes` rules of the working tree). It returns the paths whose text
 * holds a carriage return. The tests run it on this repository, and on a small
 * repository with a new script, so the check is seen to catch a script that
 * no rule covers. The git calls ignore the settings of the user's own git
 * configuration that changed this result (see NEUTRAL_SETTINGS). A last test
 * checks that `.gitattributes` does not change a binary file in the scripts
 * folder.
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
const GITATTRIBUTES = '.gitattributes';
const SDD_SCRIPTS_DIR = 'skills/subagent-driven-development/scripts';
const SHEBANG = '#!';
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;
const AUTOCRLF_ON = ['-c', 'core.autocrlf=true'];
// The name git reads in the folders $XDG_CONFIG_HOME/git and .git/info.
const ATTRIBUTES_FILE = 'attributes';
// A rule that gives every file eol=lf. In an attributes file of the user, it
// hides a script that no rule of the repository covers.
const LF_FOR_ALL_RULE = '* text eol=lf\n';
// Files that must keep LF line ends although they do not start with "#!", so
// the "#!" search does not find them. Both cmd.exe and bash read
// hooks/run-hook.cmd: on macOS and Linux, bash runs it as a script, and a
// carriage return at the end of each line breaks the bash part.
const LF_FILES_WITHOUT_SHEBANG = ['hooks/run-hook.cmd'];
// A git command can print more than the default 1 MB of output (a large file).
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'script-line-ends-'));
process.on('exit', () => fs.rmSync(WORK_ROOT, { recursive: true, force: true }));

// Three settings of the user's own git configuration changed the result of
// these tests (measured). The git calls below replace them:
// - A global attributes file (core.attributesFile, or the default file
//   $XDG_CONFIG_HOME/git/attributes) with a rule for every file, such as
//   "* text eol=lf" or "* -text", hides a script that no rule of the
//   repository covers. An empty file replaces it.
// - core.safecrlf=true together with core.autocrlf=true makes `git add` of a
//   new script fail.
// - A template folder (init.templateDir) can copy an info/attributes file
//   into each new repository. `newRepository` gives `git init` an empty
//   template folder.
// core.eol does not change the result: git ignores it when core.autocrlf is
// true.
const EMPTY_ATTRIBUTES = path.join(WORK_ROOT, 'empty-attributes');
fs.writeFileSync(EMPTY_ATTRIBUTES, '');
const EMPTY_TEMPLATES = path.join(WORK_ROOT, 'empty-templates');
fs.mkdirSync(EMPTY_TEMPLATES);
const NEUTRAL_SETTINGS = ['-c', `core.attributesFile=${EMPTY_ATTRIBUTES}`, '-c', 'core.safecrlf=false'];

const git = (root, args) => execFileSync('git', [...NEUTRAL_SETTINGS, ...args], { cwd: root, maxBuffer: MAX_OUTPUT_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });

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

function crlfScripts(root, extraFiles = []) {
  const tracked = git(root, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
  const scripts = tracked.filter((file) => startsWithShebang(path.join(root, file)));
  return [...scripts, ...extraFiles].filter((file) => git(root, [...AUTOCRLF_ON, 'cat-file', '--filters', `:${file}`]).includes(CARRIAGE_RETURN));
}

function newRepository(name) {
  const root = path.join(WORK_ROOT, name);
  fs.mkdirSync(root);
  git(root, ['init', '--quiet', `--template=${EMPTY_TEMPLATES}`]);
  return root;
}

// A new script without an eol rule is reported. Once a rule gives it eol=lf,
// it is no longer reported.
function checkNewScript(root) {
  const script = 'new-script';
  fs.writeFileSync(path.join(root, script), `${SHEBANG}/usr/bin/env bash\necho started\n`);
  git(root, ['add', script]);
  assert.deepStrictEqual(crlfScripts(root), [script]);
  fs.writeFileSync(path.join(root, GITATTRIBUTES), `${script} text eol=lf\n`);
  assert.deepStrictEqual(crlfScripts(root), []);
}

// Runs fn with some environment variables changed, and then restores them.
// The git commands that fn starts read the changed values.
function withEnvironment(changes, fn) {
  const saved = Object.keys(changes).map((name) => [name, process.env[name]]);
  Object.assign(process.env, changes);
  try {
    fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

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

test('every tracked "#!" file and every file of LF_FILES_WITHOUT_SHEBANG is checked out with LF under core.autocrlf=true', () => {
  assert.deepStrictEqual(crlfScripts(REPO_ROOT, LF_FILES_WITHOUT_SHEBANG), []);
});

test('a new script without an eol rule is reported, and is no longer reported once a rule gives it eol=lf', () => {
  checkNewScript(newRepository('default-settings'));
});

test('the global git settings of the user do not change the result', () => {
  // A home folder with the three settings that NEUTRAL_SETTINGS and
  // newRepository replace.
  const home = path.join(WORK_ROOT, 'hostile-home');
  const templates = path.join(home, 'templates');
  const templateInfo = path.join(templates, 'info');
  const xdgGit = path.join(home, 'git');
  fs.mkdirSync(templateInfo, { recursive: true });
  fs.mkdirSync(xdgGit);
  for (const folder of [templateInfo, xdgGit]) fs.writeFileSync(path.join(folder, ATTRIBUTES_FILE), LF_FOR_ALL_RULE);
  const config = path.join(home, '.gitconfig');
  const settings = [['core.autocrlf', 'true'], ['core.safecrlf', 'true'], ['init.templateDir', templates]];
  for (const [key, value] of settings) git(home, ['config', '--file', config, key, value]);
  withEnvironment({ HOME: home, XDG_CONFIG_HOME: home }, () => checkNewScript(newRepository('hostile-settings')));
});

test('a binary file put into the scripts folder of subagent-driven-development is stored unchanged', () => {
  const root = newRepository('binary-file');
  fs.copyFileSync(path.join(REPO_ROOT, GITATTRIBUTES), path.join(root, GITATTRIBUTES));
  const file = `${SDD_SCRIPTS_DIR}/icon.ico`;
  // The first bytes of an icon file, and a CRLF pair: binary data that a text
  // rule would change.
  const content = Buffer.from([0x00, 0x00, 0x01, 0x00, CARRIAGE_RETURN, LINE_FEED]);
  fs.mkdirSync(path.join(root, SDD_SCRIPTS_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  git(root, ['add', file]);
  assert.deepStrictEqual(git(root, ['cat-file', 'blob', `:${file}`]), content);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
