#!/usr/bin/env node
/**
 * Unit tests — hooks/track-edits.js and hooks/context-engine.js: ignore entries
 *
 * Both hooks keep AI workspace files (state.md, session-log.md, project-map.md,
 * known-issues.md, context-snapshot.json) out of `git status`. They must do it
 * without editing any file that git tracks, so an automatic run never finds an
 * uncommitted change that it did not make itself. Each test runs a hook as a
 * separate process on a temporary git repository and checks the repository
 * afterwards.
 *
 * Run: node tests/codex/test-git-exclude-hooks.js
 * No dependencies beyond Node.js stdlib and git.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', '..', 'hooks');
const TRACK_EDITS = path.join(HOOKS_DIR, 'track-edits.js');
const CONTEXT_ENGINE = path.join(HOOKS_DIR, 'context-engine.js');
const GITIGNORE = '.gitignore';
const STATE_FILE = 'state.md';
const KNOWN_ISSUES_FILE = 'known-issues.md';
// The four workspace files that the skills of the plugin write.
const WORKSPACE_FILES = [STATE_FILE, KNOWN_ISSUES_FILE, 'session-log.md', 'project-map.md'];
const DOCS_FOLDER = 'docs';
// A folder name that holds three characters with a meaning in a gitignore pattern.
const PATTERN_CHARACTERS_FOLDER = 'a[1]*?';
const SNAPSHOT_FILE = 'context-snapshot.json';
const FILE_TEXT = 'content\n';
const EMPTY_HOOK_OUTPUT = '{}';
const GITIGNORE_CREATED = '.gitignore was created';
const TEST_NAME = 'test';
const TEST_EMAIL = 'test@example.com';

// realpathSync: on macOS the temporary folder is reached through a symbolic link.
const WORK_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-exclude-hooks-')));
process.on('exit', () => fs.rmSync(WORK_ROOT, { recursive: true, force: true }));

// Isolate git from the developer's machine:
// - a global excludes file that already ignores state.md would make every test
//   pass without the hooks, so the global and system configuration are empty;
// - GIT_DIR and the other GIT_* variables (set when this runs inside a git hook)
//   would send every git command to another repository, so they are removed;
// - GIT_CEILING_DIRECTORIES stops git from finding a repository above WORK_ROOT.
const EMPTY_GLOBAL_CONFIG = path.join(WORK_ROOT, 'empty-gitconfig');
fs.writeFileSync(EMPTY_GLOBAL_CONFIG, '');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
Object.assign(ENV, {
  HOME: WORK_ROOT,
  USERPROFILE: WORK_ROOT,
  GIT_CONFIG_GLOBAL: EMPTY_GLOBAL_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CEILING_DIRECTORIES: path.dirname(WORK_ROOT),
  GIT_AUTHOR_NAME: TEST_NAME,
  GIT_AUTHOR_EMAIL: TEST_EMAIL,
  GIT_COMMITTER_NAME: TEST_NAME,
  GIT_COMMITTER_EMAIL: TEST_EMAIL,
});

let passed = 0;
let failed = 0;
let folderCount = 0;

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

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
}

function newFolder(kind) {
  folderCount++;
  const dir = path.join(WORK_ROOT, `${kind}-${folderCount}`);
  fs.mkdirSync(dir);
  return dir;
}

function commitFile(repo, relativePath, text) {
  const filePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
  git(repo, 'add', '--', relativePath);
  git(repo, 'commit', '-q', '-m', `add ${relativePath}`);
}

/** A new repository with one commit, so HEAD exists for context-engine. */
function makeRepo(...initArgs) {
  const dir = newFolder('repo');
  git(dir, 'init', '-q', ...initArgs);
  commitFile(dir, 'README.md', 'fixture\n');
  return dir;
}

function runHook(hookPath, cwd, input) {
  return execFileSync(process.execPath, [hookPath], {
    cwd,
    env: ENV,
    input: JSON.stringify(input),
    encoding: 'utf8',
    // context-engine prints git errors for a repository with one commit.
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

/** Write a file the way the Write tool does, then run track-edits on it. */
function writeWithTool(cwd, filePath) {
  const absolutePath = path.resolve(cwd, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, FILE_TEXT);
  return runHook(TRACK_EDITS, cwd, {
    tool_name: 'Write',
    tool_input: { file_path: absolutePath, content: FILE_TEXT },
    cwd,
    session_id: 'test-session',
  });
}

function status(cwd) {
  return git(cwd, 'status', '--porcelain', '--untracked-files=all');
}

/** The path as git prints it: with `/` between the folders, also on Windows. */
function gitPath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

/** The line that `git status --porcelain` prints for an untracked file. */
function untrackedLine(relativePath) {
  return `?? ${gitPath(relativePath)}\n`;
}

/**
 * Write the file with the tool, then check that the hook hid nothing: the
 * exclude file is unchanged and `git status` in `repo` lists the file at
 * `relativePath` (its real place in the repository) as untracked.
 */
function assertStaysVisible(repo, filePath, relativePath) {
  const excludeBefore = excludeContent(repo);
  assert.strictEqual(writeWithTool(repo, filePath), EMPTY_HOOK_OUTPUT);
  assert.strictEqual(excludeContent(repo), excludeBefore);
  assert.strictEqual(status(repo), untrackedLine(relativePath));
}

function excludePath(cwd) {
  return path.resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'info/exclude').trim());
}

function excludeContent(cwd) {
  const file = excludePath(cwd);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function isIgnored(cwd, relativePath) {
  try {
    git(cwd, 'check-ignore', '-q', '--', relativePath);
    return true;
  } catch {
    return false;
  }
}

console.log('\ntrack-edits.js');

test('an artifact at the repository root is ignored at that path only', () => {
  const repo = makeRepo();
  assert.strictEqual(writeWithTool(repo, STATE_FILE), EMPTY_HOOK_OUTPUT);
  assert.strictEqual(status(repo), '');
  assert.ok(!fs.existsSync(path.join(repo, GITIGNORE)), GITIGNORE_CREATED);
  assert.ok(!isIgnored(repo, path.join('sub', STATE_FILE)), 'sub/state.md is ignored too');
});

for (const name of WORKSPACE_FILES) {
  test(`${name} at the repository root gets an entry`, () => {
    const repo = makeRepo();
    writeWithTool(repo, name);
    assert.strictEqual(status(repo), '');
    assert.ok(isIgnored(repo, name), `${name} is not ignored`);
  });
}

// A file with the name of a workspace file in a subfolder is a document of the
// user's project. An entry would leave it out of `git add -A` with no message.
for (const relativePath of [
  path.join(DOCS_FOLDER, KNOWN_ISSUES_FILE),
  path.join(DOCS_FOLDER, 'guides', STATE_FILE),
]) {
  test(`${gitPath(relativePath)} gets no entry and stays in git status`, () => {
    const repo = makeRepo();
    assertStaysVisible(repo, relativePath, relativePath);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'add the document');
    assert.ok(
      git(repo, 'ls-files').split('\n').includes(gitPath(relativePath)),
      'the commit lacks the document'
    );
  });
}

test('a subfolder file gets no entry when the session folder is that subfolder', () => {
  const repo = makeRepo();
  const docs = path.join(repo, DOCS_FOLDER);
  fs.mkdirSync(docs);
  writeWithTool(docs, STATE_FILE);
  assert.strictEqual(status(repo), untrackedLine(path.join(DOCS_FOLDER, STATE_FILE)));
});

test('an existing exclude file keeps its entries, also when its last line has no newline', () => {
  const repo = makeRepo();
  fs.writeFileSync(excludePath(repo), 'keep.txt');
  fs.writeFileSync(path.join(repo, 'keep.txt'), FILE_TEXT);
  writeWithTool(repo, STATE_FILE);
  assert.strictEqual(status(repo), '');
  assert.ok(isIgnored(repo, 'keep.txt'), 'the existing entry was lost');
});

test('a repository without an info folder gets one', () => {
  const repo = makeRepo('--template=');
  writeWithTool(repo, STATE_FILE);
  assert.strictEqual(status(repo), '');
});

test('a second write of the same artifact adds no second entry', () => {
  const repo = makeRepo();
  writeWithTool(repo, STATE_FILE);
  const once = excludeContent(repo);
  writeWithTool(repo, STATE_FILE);
  assert.strictEqual(excludeContent(repo), once);
});

test('an artifact that .gitignore un-ignores gets one entry, not one per write', () => {
  const repo = makeRepo();
  commitFile(repo, GITIGNORE, `!${STATE_FILE}\n`);
  writeWithTool(repo, STATE_FILE);
  const once = excludeContent(repo);
  writeWithTool(repo, STATE_FILE);
  assert.strictEqual(excludeContent(repo), once);
});

test('an artifact already ignored by a committed .gitignore changes no file', () => {
  const repo = makeRepo();
  commitFile(repo, GITIGNORE, `# AI assistant artifacts\n${STATE_FILE}\n`);
  const excludeBefore = excludeContent(repo);
  writeWithTool(repo, STATE_FILE);
  assert.strictEqual(status(repo), '');
  assert.strictEqual(excludeContent(repo), excludeBefore);
});

test('a tracked artifact gets no entry, so it stays visible if it is untracked later', () => {
  const repo = makeRepo();
  commitFile(repo, STATE_FILE, FILE_TEXT);
  const excludeBefore = excludeContent(repo);
  writeWithTool(repo, STATE_FILE);
  writeWithTool(repo, STATE_FILE);
  assert.strictEqual(excludeContent(repo), excludeBefore);
});

test('a file that is not an AI artifact gets no ignore entry', () => {
  const repo = makeRepo();
  const excludeBefore = excludeContent(repo);
  writeWithTool(repo, 'notes.md');
  assert.strictEqual(excludeContent(repo), excludeBefore);
  assert.strictEqual(status(repo), '?? notes.md\n');
});

test('an artifact in a linked worktree is ignored there, and no .gitignore is created', () => {
  const repo = makeRepo();
  const worktree = `${repo}-linked`;
  git(repo, 'worktree', 'add', '-q', worktree);
  writeWithTool(worktree, STATE_FILE);
  assert.strictEqual(status(worktree), '');
  assert.ok(!fs.existsSync(path.join(worktree, GITIGNORE)), GITIGNORE_CREATED);
});

test('an artifact at the top level of a linked worktree inside the main work tree is ignored there', () => {
  const repo = makeRepo();
  const worktree = path.join(repo, '.worktrees', 'export');
  git(repo, 'worktree', 'add', '-q', worktree);
  writeWithTool(worktree, STATE_FILE);
  assert.strictEqual(status(worktree), '');
});

test('a subfolder file in a linked worktree gets no entry and stays in git status', () => {
  const repo = makeRepo();
  const worktree = `${repo}-linked`;
  git(repo, 'worktree', 'add', '-q', worktree);
  const relativePath = path.join(DOCS_FOLDER, KNOWN_ISSUES_FILE);
  assertStaysVisible(worktree, relativePath, relativePath);
});

test('an artifact at the repository root, reached through a symbolic link, is ignored in its repository', () => {
  const repo = makeRepo();
  const link = `${repo}-alias`;
  fs.symlinkSync(repo, link);
  writeWithTool(link, STATE_FILE);
  assert.strictEqual(status(repo), '');
  assert.ok(isIgnored(repo, STATE_FILE), 'the real path is not ignored');
  assert.ok(!fs.existsSync(path.join(WORK_ROOT, '.git')), 'a .git folder was created above the repository');
});

test('a subfolder file reached through a symbolic link gets no entry and stays in git status', () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, DOCS_FOLDER));
  // The link sits outside the repository, so the path of the file does not
  // show that the file is in a subfolder; only the real path shows it.
  const link = `${repo}-docs-alias`;
  fs.symlinkSync(path.join(repo, DOCS_FOLDER), link);
  assertStaysVisible(repo, path.join(link, STATE_FILE), path.join(DOCS_FOLDER, STATE_FILE));
});

test('an artifact inside the .git folder gets no entry', () => {
  const repo = makeRepo();
  const excludeBefore = excludeContent(repo);
  writeWithTool(repo, path.join('.git', STATE_FILE));
  assert.strictEqual(excludeContent(repo), excludeBefore);
});

test('an artifact in a folder whose name holds a newline creates no other file', () => {
  const repo = makeRepo();
  const folder = path.join(repo, 'line\nbreak');
  writeWithTool(repo, path.join(folder, STATE_FILE));
  assert.deepStrictEqual(fs.readdirSync(folder), [STATE_FILE]);
});

test('outside a git repository nothing is written besides the artifact', () => {
  const dir = newFolder('plain');
  assert.strictEqual(writeWithTool(dir, STATE_FILE), EMPTY_HOOK_OUTPUT);
  assert.deepStrictEqual(fs.readdirSync(dir), [STATE_FILE]);
});

console.log('\ncontext-engine.js');

test('the snapshot at the repository root is ignored, and no .gitignore is created', () => {
  const repo = makeRepo();
  assert.strictEqual(runHook(CONTEXT_ENGINE, repo, { cwd: repo }), EMPTY_HOOK_OUTPUT);
  assert.ok(fs.existsSync(path.join(repo, SNAPSHOT_FILE)), 'no snapshot was written');
  assert.strictEqual(status(repo), '');
  assert.ok(!fs.existsSync(path.join(repo, GITIGNORE)), GITIGNORE_CREATED);
});

test('a snapshot written from a subfolder is ignored, and a tracked .gitignore is unchanged', () => {
  const repo = makeRepo();
  const sub = path.join(repo, 'sub');
  fs.mkdirSync(sub);
  const gitignoreText = 'node_modules/\n';
  commitFile(repo, GITIGNORE, gitignoreText);
  runHook(CONTEXT_ENGINE, sub, { cwd: sub });
  assert.ok(fs.existsSync(path.join(sub, SNAPSHOT_FILE)), 'no snapshot was written');
  assert.strictEqual(status(repo), '');
  assert.strictEqual(fs.readFileSync(path.join(repo, GITIGNORE), 'utf8'), gitignoreText);
});

test('a folder name with gitignore pattern characters is matched literally', () => {
  const repo = makeRepo();
  const sub = path.join(repo, PATTERN_CHARACTERS_FOLDER);
  fs.mkdirSync(sub);
  runHook(CONTEXT_ENGINE, sub, { cwd: sub });
  assert.ok(fs.existsSync(path.join(sub, SNAPSHOT_FILE)), 'no snapshot was written');
  assert.strictEqual(status(repo), '');
  assert.ok(!isIgnored(repo, path.join('a1xy', SNAPSHOT_FILE)), 'the pattern matched another folder');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
