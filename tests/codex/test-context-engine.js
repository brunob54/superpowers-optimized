#!/usr/bin/env node
/**
 * Unit tests — hooks/context-engine.js
 *
 * Verifies:
 *   - Per-project watermark: different cwds produce different filenames
 *   - getLastHeadFile returns a path containing a hash of cwd
 *   - Module loads without error
 *   - Behaviour on a temporary git repository (the hook runs as a separate
 *     process): a file name is never read as shell syntax or as a git
 *     pattern or option, every name is written to the snapshot unchanged, the
 *     diff starts at the commit of the previous session start, and the
 *     snapshot is never written through a symbolic link
 *
 * Run: node tests/codex/test-context-engine.js
 * No dependencies beyond Node.js stdlib and git.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  \u2713 ${label}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Load module ──────────────────────────────────────────────────────────────

// context-engine.js runs main() on require — it expects stdin JSON.
// We can't require() it directly without piping stdin.
// Instead, test the key logic by reading the source and verifying structural properties.

const SOURCE_PATH = path.join(__dirname, '..', '..', 'hooks', 'context-engine.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

console.log('\nModule structure');

test('context-engine.js exists and is readable', () => {
  assert.ok(source.length > 0, 'File is empty');
});

test('Uses createHash for per-project watermark', () => {
  assert.ok(source.includes('createHash'), 'Missing createHash import');
  assert.ok(source.includes("createHash('md5')"), 'Missing md5 hash of cwd');
});

test('getLastHeadFile function exists', () => {
  assert.ok(source.includes('function getLastHeadFile(cwd)'), 'Missing getLastHeadFile function');
});

test('No longer uses global LAST_HEAD_FILE constant', () => {
  // Should not have `const LAST_HEAD_FILE = path.join(` anymore
  assert.ok(!source.includes('const LAST_HEAD_FILE'), 'Still using global LAST_HEAD_FILE constant');
});

test('Uses getLastHeadFile(cwd) for watermark read', () => {
  assert.ok(source.includes('getLastHeadFile(cwd)'), 'Not calling getLastHeadFile with cwd');
});

// ── Per-project watermark logic ──────────────────────────────────────────────

console.log('\nPer-project watermark');

test('Different cwds produce different watermark filenames', () => {
  const hash1 = createHash('md5').update('/project/alpha').digest('hex').slice(0, 12);
  const hash2 = createHash('md5').update('/project/beta').digest('hex').slice(0, 12);
  assert.notStrictEqual(hash1, hash2, 'Two different paths produced the same hash');
});

test('Same cwd always produces same watermark filename', () => {
  const hash1 = createHash('md5').update('/project/alpha').digest('hex').slice(0, 12);
  const hash2 = createHash('md5').update('/project/alpha').digest('hex').slice(0, 12);
  assert.strictEqual(hash1, hash2, 'Same path produced different hashes');
});

test('Hash is 12 characters (truncated md5)', () => {
  const hash = createHash('md5').update('/any/path').digest('hex').slice(0, 12);
  assert.strictEqual(hash.length, 12, `Expected 12-char hash, got ${hash.length}`);
});

test('Watermark filename includes hash suffix', () => {
  // Verify the pattern: last-session-head-<hash>.txt
  assert.ok(source.includes('`last-session-head-${hash}.txt`'),
    'Watermark filename does not use hash suffix pattern');
});

// ── Cross-session watermark as diff base ─────────────────────────────────────

console.log('\nCross-session diff base');

test('Uses watermark as diff base when available', () => {
  assert.ok(source.includes('useWatermark'), 'Missing useWatermark variable');
  assert.ok(source.includes('diffBase'), 'Missing diffBase variable');
});

test('Falls back to HEAD~1 when no watermark', () => {
  assert.ok(source.includes("'HEAD~1'"), 'Missing HEAD~1 fallback');
});

// ── Blast radius import filtering ────────────────────────────────────────────

console.log('\nBlast radius import filtering');

test('Has import pattern filtering for blast radius', () => {
  assert.ok(source.includes('importPatterns'), 'Missing importPatterns for blast radius filtering');
});

test('Checks for import/require/from patterns', () => {
  assert.ok(source.includes('import|require|from'), 'Missing import/require/from pattern');
});

// ── BASENAME_DENYLIST ────────────────────────────────────────────────────────

console.log('\nBasename denylist');

test('BASENAME_DENYLIST blocks common generic names', () => {
  assert.ok(source.includes("'index'"), 'Missing index in denylist');
  assert.ok(source.includes("'config'"), 'Missing config in denylist');
  assert.ok(source.includes("'utils'"), 'Missing utils in denylist');
});

// ── Behaviour on a fixture repository ────────────────────────────────────────
//
// Each test below runs the hook as a separate process on a temporary git
// repository. It then reads context-snapshot.json and lists the folder.

const SNAPSHOT_FILE = 'context-snapshot.json';
const EMPTY_HOOK_OUTPUT = '{}';
const CHANGED_BASE = 'widget';
const IMPORT_EXTENSION = '.js';
const PROSE_EXTENSION = '.txt';
const CHANGED_FILE = CHANGED_BASE + IMPORT_EXTENSION;
const CHANGED_TEXT = 'module.exports = {};\n';
/** Text that names a file in a sentence. This is not a reference to the file. */
const proseText = base => `See ${base} for details.\n`;
/** Text that loads a file. This is a reference to the file. */
const importText = base => `const dependency = require('./${base}');\n`;
const PROSE_TEXT = proseText(CHANGED_BASE);
const IMPORT_TEXT = importText(CHANGED_BASE);
const TEST_NAME = 'test';
const TEST_EMAIL = 'test@example.com';
const WINDOWS = process.platform === 'win32';

// realpathSync: on macOS the temporary folder is reached through a symbolic link.
const WORK_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'context-engine-')));
process.on('exit', () => fs.rmSync(WORK_ROOT, { recursive: true, force: true }));

// Isolate the hook and git from the developer's machine:
// - HOME and USERPROFILE point into WORK_ROOT, so the hook writes its file
//   with the commit of the previous session start there;
// - the global and system git configuration are empty, so core.quotePath has
//   its default value;
// - XDG_CONFIG_HOME points into WORK_ROOT, so git does not read the developer's
//   own ignore file ($XDG_CONFIG_HOME/git/ignore), which can hide fixture files;
// - GIT_DIR and the other GIT_* variables (set when this runs inside a git
//   hook) would send every git command to another repository, so they are
//   removed;
// - GIT_CEILING_DIRECTORIES stops git from finding a repository above WORK_ROOT.
const EMPTY_GLOBAL_CONFIG = path.join(WORK_ROOT, 'empty-gitconfig');
fs.writeFileSync(EMPTY_GLOBAL_CONFIG, '');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
Object.assign(ENV, {
  HOME: WORK_ROOT,
  USERPROFILE: WORK_ROOT,
  XDG_CONFIG_HOME: path.join(WORK_ROOT, 'xdg-config'),
  GIT_CONFIG_GLOBAL: EMPTY_GLOBAL_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CEILING_DIRECTORIES: path.dirname(WORK_ROOT),
  GIT_AUTHOR_NAME: TEST_NAME,
  GIT_AUTHOR_EMAIL: TEST_EMAIL,
  GIT_COMMITTER_NAME: TEST_NAME,
  GIT_COMMITTER_EMAIL: TEST_EMAIL,
});

let repoCount = 0;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
}

/** Write the files (a map from file name to text) and commit them as one commit. */
function commitFiles(repo, files) {
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(repo, name), text);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'fixture commit');
}

/**
 * A new repository with two commits. The first commit holds `otherFiles`, the
 * last commit adds `changedFiles` (each a map from file name to text). So the
 * hook reports the files of the last commit as changed and searches the other
 * files for their names.
 */
function makeRepo(otherFiles, changedFiles = { [CHANGED_FILE]: CHANGED_TEXT }) {
  repoCount++;
  const repo = path.join(WORK_ROOT, `repo-${repoCount}`);
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  commitFiles(repo, otherFiles);
  commitFiles(repo, changedFiles);
  return repo;
}

/** Run the hook in the repository and return what it printed. */
function runHookProcess(repo) {
  return execFileSync(process.execPath, [SOURCE_PATH], {
    cwd: repo,
    env: ENV,
    input: JSON.stringify({ cwd: repo }),
    encoding: 'utf8',
    // The hook lets git print its error messages; they are not part of the result.
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

/** Run the hook in the repository and return the snapshot that it wrote. */
function runHook(repo) {
  assert.strictEqual(runHookProcess(repo), EMPTY_HOOK_OUTPUT);
  return JSON.parse(fs.readFileSync(path.join(repo, SNAPSHOT_FILE), 'utf8'));
}

/** Like test(), but on Windows the case does not run and one line names it. */
function testExceptOnWindows(label, reason, fn) {
  if (!WINDOWS) return test(label, fn);
  console.log(`  - skipped on Windows (${reason}): ${label}`);
}

/**
 * The same names in one fixed order and one Unicode form. Some file systems
 * store an accented letter as two code points; NFC (Normalization Form C) is
 * the form with one code point.
 */
function normalized(names) {
  return names.map(name => name.normalize('NFC')).sort();
}

/** Run the hook; fail when it created any file besides the snapshot. */
function runHookWithoutSideEffects(repo) {
  const before = fs.readdirSync(repo);
  const snapshot = runHook(repo);
  assert.deepStrictEqual(
    normalized(fs.readdirSync(repo)),
    // A Set: the snapshot of an earlier run is already in `before`.
    normalized([...new Set([...before, SNAPSHOT_FILE])]),
    'the hook created a file besides the snapshot'
  );
  return snapshot;
}

function dependentsOf(snapshot, changedFile = CHANGED_FILE) {
  return normalized(snapshot.blast_radius[changedFile]);
}

/**
 * Run the hook once and return the path of the file in which it stored the
 * commit of that session start. The file is found as the one new file in the
 * hook's log folder, so this helper does not repeat how the hook builds the name.
 */
function storedCommitFileAfterFirstRun(repo) {
  const logFolder = path.join(WORK_ROOT, '.claude', 'hooks-logs');
  const before = new Set(fs.existsSync(logFolder) ? fs.readdirSync(logFolder) : []);
  runHook(repo);
  const created = fs.readdirSync(logFolder).filter(name => !before.has(name));
  assert.strictEqual(created.length, 1, 'the first run did not create exactly one file in the log folder');
  return path.join(logFolder, created[0]);
}

/** The text of the repository's local exclude file, or '' when there is none. */
function excludeContent(repo) {
  const file = path.join(repo, '.git', 'info', 'exclude');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

console.log('\nFile names in the list of dependents');

// Each entry: what the name holds, the name without its extension, and whether
// Windows allows the name. A name with a leading dash looks like an option. é is the letter e with an acute accent.
const FILE_NAME_STEMS = [
  ['only ordinary characters', 'consumer', true],
  ['a space', 'plain notes', true],
  ['a shell command substitution', 'notes $(touch INJECTED_BY_SUBSTITUTION)', true],
  ['a backtick pair', 'notes `touch INJECTED_BY_BACKTICK`', true],
  ['a shell variable (route.$id.js)', 'route.$id', true],
  ['a single quote', "it's notes", true],
  ['a leading dash', '-notes', true],
  ['a non-ASCII letter', 'résumé', true],
  ['a double quote', 'say "hello"', false],
  ['a line break', 'line\nbreak', false],
];

for (const [what, stem, onWindows] of FILE_NAME_STEMS) {
  const label = `a name with ${what}: the importing file is a dependent, the prose file is not, no file is created`;
  const check = () => {
    const proseFile = stem + PROSE_EXTENSION;
    const importingFile = stem + IMPORT_EXTENSION;
    const repo = makeRepo({ [proseFile]: PROSE_TEXT, [importingFile]: IMPORT_TEXT });
    const snapshot = runHookWithoutSideEffects(repo);
    assert.deepStrictEqual(dependentsOf(snapshot), normalized([importingFile]));
  };
  if (onWindows) test(label, check);
  else testExceptOnWindows(label, 'the file system does not allow the name', check);
}

test('a name with git pattern characters is checked as that file only, not as a pattern', () => {
  // As a git pattern, "note[s].txt" also matches "notes.txt", which imports the changed file.
  const repo = makeRepo({ 'note[s].txt': PROSE_TEXT, 'notes.txt': IMPORT_TEXT });
  assert.deepStrictEqual(dependentsOf(runHook(repo)), ['notes.txt']);
});

test('a changed file with a leading dash in its name keeps its dependent and gains no prose file', () => {
  const changedBase = `-${CHANGED_BASE}`;
  const changedFile = changedBase + IMPORT_EXTENSION;
  const repo = makeRepo(
    { 'consumer.js': importText(changedBase), 'notes.txt': proseText(changedBase) },
    { [changedFile]: CHANGED_TEXT }
  );
  assert.deepStrictEqual(dependentsOf(runHook(repo), changedFile), ['consumer.js']);
});

test('a lock file, a minified file and a source map are never dependents', () => {
  const repo = makeRepo({
    'consumer.js': IMPORT_TEXT,
    'yarn.lock': IMPORT_TEXT,
    'package-lock.json': IMPORT_TEXT,
    'bundle.min.js': IMPORT_TEXT,
    'bundle.js.map': IMPORT_TEXT,
  });
  assert.deepStrictEqual(dependentsOf(runHook(repo)), ['consumer.js']);
});

test('a changed file that names itself is not its own dependent', () => {
  const repo = makeRepo({}, { [CHANGED_FILE]: IMPORT_TEXT });
  assert.deepStrictEqual(dependentsOf(runHook(repo)), []);
});

test('a file whose content check fails stays a dependent', () => {
  // The hook accepts at most 1 MiB (1,048,576 bytes) of output from one git
  // command. The matching lines of this file are larger, so the check of its
  // content fails. The hook then keeps the file, although it holds prose only.
  const longFile = 'long notes.txt';
  const repo = makeRepo({ [longFile]: PROSE_TEXT.repeat(100000) });
  assert.deepStrictEqual(dependentsOf(runHook(repo)), [longFile]);
});

console.log('\nFile names in the list of changed files');

test('a changed file with a non-ASCII name and a space is listed under its real name', () => {
  const changedFile = 'café menu.js';
  const repo = makeRepo({}, { [changedFile]: CHANGED_TEXT });
  const snapshot = runHook(repo);
  assert.deepStrictEqual(normalized(snapshot.changed_files), [changedFile]);
  assert.deepStrictEqual(normalized(Object.keys(snapshot.blast_radius)), [changedFile]);
});

test('the second session start lists every file changed since the first one', () => {
  const repo = makeRepo({});
  runHook(repo);
  const newFiles = ['first $(touch INJECTED_BY_CHANGED_FILE).js', 'secondé.js'];
  for (const name of newFiles) commitFiles(repo, { [name]: CHANGED_TEXT });
  const snapshot = runHookWithoutSideEffects(repo);
  assert.deepStrictEqual(normalized(snapshot.changed_files), normalized(newFiles));
  assert.deepStrictEqual(normalized(snapshot.cross_session_files), normalized(newFiles));
  assert.strictEqual(snapshot.cross_session_commit_count, newFiles.length);
});

test('a tracked file with the name of the revision range does not empty the list of changed files', () => {
  const repo = makeRepo({ 'HEAD~1..HEAD': PROSE_TEXT });
  const snapshot = runHook(repo);
  assert.deepStrictEqual(snapshot.changed_files, [CHANGED_FILE]);
  assert.ok(snapshot.change_stat.includes('1 file changed'), `change_stat is "${snapshot.change_stat}"`);
});

console.log('\nThe file with the commit of the previous session start');

test('text in that file is never run as a command', () => {
  const repo = makeRepo({});
  fs.writeFileSync(storedCommitFileAfterFirstRun(repo), 'HEAD~1; touch INJECTED_BY_STORED_COMMIT');
  const snapshot = runHookWithoutSideEffects(repo);
  assert.deepStrictEqual(snapshot.changed_files, [CHANGED_FILE]);
});

console.log('\nWriting the snapshot');

const OUTSIDE_TEXT = 'a file outside the repository\n';

for (const state of ['tracked', 'untracked']) {
  testExceptOnWindows(
    `a symbolic link with the snapshot's name (${state}) is not written through, and gets no exclude entry`,
    'creating a symbolic link needs a special right',
    () => {
      const repo = makeRepo({});
      const target = path.join(WORK_ROOT, `outside-${repoCount}.txt`);
      fs.writeFileSync(target, OUTSIDE_TEXT);
      const link = path.join(repo, SNAPSHOT_FILE);
      fs.symlinkSync(target, link);
      // `git add -A` inside commitFiles adds the link.
      if (state === 'tracked') commitFiles(repo, {});
      const excludeBefore = excludeContent(repo);
      assert.strictEqual(runHookProcess(repo), EMPTY_HOOK_OUTPUT);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), OUTSIDE_TEXT, 'the file outside the repository was changed');
      assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link was replaced');
      assert.strictEqual(excludeContent(repo), excludeBefore, 'an exclude entry was added');
    }
  );
}

test('an existing plain snapshot file is replaced by the new snapshot', () => {
  const repo = makeRepo({});
  fs.writeFileSync(path.join(repo, SNAPSHOT_FILE), 'old text');
  assert.strictEqual(runHook(repo).git_hash, git(repo, 'rev-parse', 'HEAD').trim());
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`context-engine: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
