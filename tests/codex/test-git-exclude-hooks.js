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
 * track-edits.js runs after the Edit tool, after the Write tool and after the
 * Bash tool. The save command of the context-management skill creates
 * session-log.md through Bash, so the last group of tests gives the hook the
 * input of a Bash call.
 *
 * Run: node tests/codex/test-git-exclude-hooks.js
 * No dependencies beyond Node.js stdlib, git and bash.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_DIR = path.join(REPO_ROOT, 'hooks');
const TRACK_EDITS_NAME = 'track-edits.js';
const TRACK_EDITS = path.join(HOOKS_DIR, TRACK_EDITS_NAME);
const CONTEXT_ENGINE = path.join(HOOKS_DIR, 'context-engine.js');
// The file that tells Claude Code which hook runs after which tool.
const HOOKS_CONFIG = path.join(HOOKS_DIR, 'hooks.json');
const SKILL_FILE = path.join(REPO_ROOT, 'skills', 'context-management', 'SKILL.md');
const GITIGNORE = '.gitignore';
const STATE_FILE = 'state.md';
const KNOWN_ISSUES_FILE = 'known-issues.md';
const SESSION_LOG_FILE = 'session-log.md';
// The four workspace files that the skills of the plugin write.
const WORKSPACE_FILES = [STATE_FILE, KNOWN_ISSUES_FILE, SESSION_LOG_FILE, 'project-map.md'];
const BASH_TOOL = 'Bash';
const EDIT_TOOL = 'Edit';
const WRITE_TOOL = 'Write';
const TEST_SESSION = 'test-session';
const DOCS_FOLDER = 'docs';
// A package folder of a repository that holds several packages.
const PACKAGE_FOLDER = path.join('packages', 'app');
// Claude Code sets this variable for a hook: the folder where the session started.
const PROJECT_DIR_VARIABLE = 'CLAUDE_PROJECT_DIR';
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
// - GIT_CEILING_DIRECTORIES stops git from finding a repository above WORK_ROOT;
// - XDG_CONFIG_HOME names the folder of a second global ignore file
//   (`git/ignore` inside it), so it points to a folder that does not exist.
// The project folder variable is removed too: a test that needs it sets it,
// and a value inherited from a Claude Code session would name another folder.
const EMPTY_GLOBAL_CONFIG = path.join(WORK_ROOT, 'empty-gitconfig');
fs.writeFileSync(EMPTY_GLOBAL_CONFIG, '');
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== PROJECT_DIR_VARIABLE)
);
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

/** `projectDir`, when given, is the project folder that Claude Code would name. */
function runHook(hookPath, cwd, input, projectDir) {
  return execFileSync(process.execPath, [hookPath], {
    cwd,
    env: projectDir ? { ...ENV, [PROJECT_DIR_VARIABLE]: projectDir } : ENV,
    input: JSON.stringify(input),
    encoding: 'utf8',
    // context-engine prints git errors for a repository with one commit.
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

/** Write a file the way the Write tool does, then run track-edits on it. */
function writeWithTool(cwd, filePath, projectDir) {
  const absolutePath = path.resolve(cwd, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, FILE_TEXT);
  return runHook(
    TRACK_EDITS,
    cwd,
    {
      tool_name: WRITE_TOOL,
      tool_input: { file_path: absolutePath, content: FILE_TEXT },
      cwd,
      session_id: TEST_SESSION,
    },
    projectDir
  );
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
function assertStaysVisible(repo, filePath, relativePath, projectDir) {
  const excludeBefore = excludeContent(repo);
  assert.strictEqual(writeWithTool(repo, filePath, projectDir), EMPTY_HOOK_OUTPUT);
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
// user's project when the session started in another folder. An entry would
// leave it out of `git add -A` with no message.
for (const relativePath of [
  path.join(DOCS_FOLDER, KNOWN_ISSUES_FILE),
  path.join(DOCS_FOLDER, 'guides', STATE_FILE),
  path.join(PACKAGE_FOLDER, STATE_FILE),
]) {
  test(`${gitPath(relativePath)} gets no entry when the project folder is the repository root`, () => {
    const repo = makeRepo();
    assertStaysVisible(repo, relativePath, relativePath, repo);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'add the document');
    assert.ok(
      git(repo, 'ls-files').split('\n').includes(gitPath(relativePath)),
      'the commit lacks the document'
    );
  });
}

// A session that starts in a package folder keeps its workspace files there:
// the other hooks read them from the session folder.
test('an artifact in the project folder of the session gets an entry when that folder is a subfolder', () => {
  const repo = makeRepo();
  const relativePath = path.join(PACKAGE_FOLDER, STATE_FILE);
  writeWithTool(repo, relativePath, path.join(repo, PACKAGE_FOLDER));
  assert.strictEqual(status(repo), '');
  assert.ok(isIgnored(repo, relativePath), `${gitPath(relativePath)} is not ignored`);
});

// The `cwd` field of the hook input follows a `cd` of the assistant, so it
// does not name the project folder.
test('without the project folder variable, a subfolder file gets no entry, also when cwd is that subfolder', () => {
  const repo = makeRepo();
  const packageFolder = path.join(repo, PACKAGE_FOLDER);
  fs.mkdirSync(packageFolder, { recursive: true });
  writeWithTool(packageFolder, STATE_FILE);
  assert.strictEqual(status(repo), untrackedLine(path.join(PACKAGE_FOLDER, STATE_FILE)));
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
});

// The project folder is named by its real path and the file by a path through
// a symbolic link: only a comparison of real paths finds that they agree. The
// link lies two folders above its target, so an exclude path that is resolved
// against the link, not against the real folder, ends above the repository.
test('an artifact in the project folder, reached through a symbolic link to that subfolder, is ignored in its repository', () => {
  const repo = makeRepo();
  const realFolder = path.join(repo, 'real', 'deep');
  fs.mkdirSync(realFolder, { recursive: true });
  const link = path.join(repo, 'alias');
  fs.symlinkSync(realFolder, link);
  writeWithTool(repo, path.join(link, STATE_FILE), realFolder);
  assert.ok(isIgnored(repo, path.join('real', 'deep', STATE_FILE)), 'the real path is not ignored');
  assert.ok(!fs.existsSync(path.join(WORK_ROOT, '.git')), 'a .git folder was created above the repository');
});

// The reverse case: the variable names the project folder through a symbolic
// link (on macOS the temporary folder has two names), the file has its real path.
test('an artifact in a project folder that the variable names through a symbolic link is ignored', () => {
  const repo = makeRepo();
  const relativePath = path.join(PACKAGE_FOLDER, STATE_FILE);
  fs.mkdirSync(path.join(repo, PACKAGE_FOLDER), { recursive: true });
  const link = `${repo}-package-alias`;
  fs.symlinkSync(path.join(repo, PACKAGE_FOLDER), link);
  writeWithTool(repo, relativePath, link);
  assert.strictEqual(status(repo), '');
});

test('a subfolder file reached through a symbolic link gets no entry and stays in git status', () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, DOCS_FOLDER));
  // The link sits outside the repository, so the text of the path does not
  // show that the file is in a subfolder. Git starts in the folder that the
  // operating system resolves, so this test passes with or without a
  // real-path call in the hook; no fixture exists in which that call decides
  // this case.
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

// ── track-edits.js after a Bash call ─────────────────────────────────────────
//
// The Bash tool can create a workspace file: the save command of the
// context-management skill appends to session-log.md with `cat >>`. The hook
// reads the text of the command. For each workspace file name in that text, it
// looks for the file in the `cwd` of the hook input and in the project folder,
// and it gives an existing file the same entry as after a Write of that file.

console.log('\ntrack-edits.js after a Bash call');

const NO_ARTIFACT_COMMAND = 'npm test';
const SESSION_LOG_ENTRY = `/${SESSION_LOG_FILE}\n`;
const HERE_DOCUMENT_OPENER = '<<';
const SCRATCHPAD_FIELD = 'scratchpad_dir';
// A file of the user's project whose name is not a workspace file name.
const PROJECT_DOCUMENT = 'design.md';

/** Run track-edits with the input that Claude Code gives it after a Bash call. */
function afterBash(cwd, toolInput, projectDir) {
  return runHook(
    TRACK_EDITS,
    cwd,
    { tool_name: BASH_TOOL, tool_input: toolInput, cwd, session_id: TEST_SESSION },
    projectDir
  );
}

/** The save command of the skill: its one bash block that opens a here-document. */
function skillSaveCommand() {
  const blocks = [...fs.readFileSync(SKILL_FILE, 'utf8').matchAll(/```bash\n([\s\S]*?)```/g)]
    .map(match => match[1])
    .filter(block => block.includes(HERE_DOCUMENT_OPENER));
  assert.strictEqual(blocks.length, 1, `Expected one here-document command in the skill, found ${blocks.length}`);
  return blocks[0];
}

/** Run the save command of the skill in `cwd` with bash, then the hook with the same command. */
function saveWithBash(cwd, projectDir) {
  const command = skillSaveCommand();
  execFileSync('bash', ['-c', command], { cwd, env: ENV, stdio: 'ignore' });
  assert.ok(fs.existsSync(path.join(cwd, SESSION_LOG_FILE)), 'the save command did not create the session log');
  return afterBash(cwd, { command }, projectDir);
}

/** A workspace file in `folder` that no tool call announced to the hook. */
function writeArtifact(folder, name = SESSION_LOG_FILE) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name), FILE_TEXT);
}

/** Run the hook after a Bash call and check that it changed neither the exclude file nor `git status`. */
function assertBashChangesNothing(repo, toolInput, projectDir, cwd = repo) {
  const excludeBefore = excludeContent(repo);
  const statusBefore = status(repo);
  assert.strictEqual(afterBash(cwd, toolInput, projectDir), EMPTY_HOOK_OUTPUT);
  assert.strictEqual(excludeContent(repo), excludeBefore);
  assert.strictEqual(status(repo), statusBefore);
}

test('hooks.json runs track-edits.js after Bash, Edit and Write', () => {
  const entries = JSON.parse(fs.readFileSync(HOOKS_CONFIG, 'utf8')).hooks.PostToolUse
    .filter(entry => entry.hooks.some(hook => hook.command.includes(TRACK_EDITS_NAME)));
  assert.strictEqual(entries.length, 1, 'Expected one PostToolUse entry for track-edits.js');
  assert.deepStrictEqual(entries[0].matcher.split('|').sort(), [BASH_TOOL, EDIT_TOOL, WRITE_TOOL]);
  assert.strictEqual(entries[0].hooks.length, 1, 'Another hook would run after Bash too');
});

test('the save command of the skill gives session-log.md its entry and prints nothing', () => {
  const repo = makeRepo();
  assert.strictEqual(saveWithBash(repo, repo), EMPTY_HOOK_OUTPUT);
  assert.strictEqual(status(repo), '');
  assert.ok(excludeContent(repo).endsWith(SESSION_LOG_ENTRY), `no entry: ${excludeContent(repo)}`);
  assert.ok(!fs.existsSync(path.join(repo, GITIGNORE)), GITIGNORE_CREATED);
});

test('a second save adds no second entry', () => {
  const repo = makeRepo();
  saveWithBash(repo, repo);
  const once = excludeContent(repo);
  saveWithBash(repo, repo);
  assert.strictEqual(excludeContent(repo), once);
});

test('a session log that the project tracks gets no entry after a save', () => {
  const repo = makeRepo();
  commitFile(repo, SESSION_LOG_FILE, FILE_TEXT);
  const excludeBefore = excludeContent(repo);
  saveWithBash(repo, repo);
  assert.strictEqual(excludeContent(repo), excludeBefore);
  assert.strictEqual(status(repo), ` M ${SESSION_LOG_FILE}\n`);
});

for (const name of WORKSPACE_FILES) {
  test(`a Bash command that names ${name} gives the existing file its entry`, () => {
    const repo = makeRepo();
    writeArtifact(repo, name);
    assert.strictEqual(afterBash(repo, { command: `printf x >> ${name}` }, repo), EMPTY_HOOK_OUTPUT);
    assert.strictEqual(status(repo), '');
    assert.ok(isIgnored(repo, name), `${name} is not ignored`);
  });
}

test('a Bash command that names two workspace files gives each one its entry', () => {
  const repo = makeRepo();
  writeArtifact(repo, STATE_FILE);
  writeArtifact(repo, SESSION_LOG_FILE);
  afterBash(repo, { command: `cat ${STATE_FILE} ${SESSION_LOG_FILE}` }, repo);
  assert.strictEqual(status(repo), '');
});

// The same three folder cases as for a Write: the folder rule is not changed.
test('a save in the project folder of the session gets an entry when that folder is a subfolder', () => {
  const repo = makeRepo();
  const packageFolder = path.join(repo, PACKAGE_FOLDER);
  fs.mkdirSync(packageFolder, { recursive: true });
  saveWithBash(packageFolder, packageFolder);
  assert.strictEqual(status(repo), '');
  assert.ok(isIgnored(repo, path.join(PACKAGE_FOLDER, SESSION_LOG_FILE)), 'the session log is not ignored');
});

test('without the project folder variable, a save in a subfolder gets no entry', () => {
  const repo = makeRepo();
  const packageFolder = path.join(repo, PACKAGE_FOLDER);
  fs.mkdirSync(packageFolder, { recursive: true });
  const excludeBefore = excludeContent(repo);
  saveWithBash(packageFolder);
  assert.strictEqual(excludeContent(repo), excludeBefore);
  assert.strictEqual(status(repo), untrackedLine(path.join(PACKAGE_FOLDER, SESSION_LOG_FILE)));
});

// The assistant ran `cd docs` before the save: the file is not a workspace
// file of the session, and it stays visible, as after a Write.
test('a save in a subfolder that is not the project folder gets no entry', () => {
  const repo = makeRepo();
  const docsFolder = path.join(repo, DOCS_FOLDER);
  fs.mkdirSync(docsFolder);
  const excludeBefore = excludeContent(repo);
  saveWithBash(docsFolder, repo);
  assert.strictEqual(excludeContent(repo), excludeBefore);
  assert.strictEqual(status(repo), untrackedLine(path.join(DOCS_FOLDER, SESSION_LOG_FILE)));
});

// The command ran in a subfolder and named the file of the project folder by a
// path. The `cwd` of the hook input holds no such file; the project folder does.
test('a Bash command in a subfolder that names the file of the project folder gives that file its entry', () => {
  const repo = makeRepo();
  const docsFolder = path.join(repo, DOCS_FOLDER);
  fs.mkdirSync(docsFolder);
  writeArtifact(repo);
  afterBash(docsFolder, { command: `printf x >> ../${SESSION_LOG_FILE}` }, repo);
  assert.strictEqual(status(repo), '');
});

for (const [label, projectDirOf] of [
  ['the session started in the worktree', worktree => worktree],
  ['the session started in the main checkout', (worktree, repo) => repo],
  ['no project folder is named', () => undefined],
]) {
  test(`a save at the top level of a linked worktree is ignored there (${label})`, () => {
    const repo = makeRepo();
    const worktree = `${repo}-linked`;
    git(repo, 'worktree', 'add', '-q', worktree);
    saveWithBash(worktree, projectDirOf(worktree, repo));
    assert.strictEqual(status(worktree), '');
    assert.ok(!fs.existsSync(path.join(worktree, GITIGNORE)), GITIGNORE_CREATED);
  });
}

test('a Bash command that names no workspace file changes nothing, also when such a file exists', () => {
  const repo = makeRepo();
  writeArtifact(repo);
  assertBashChangesNothing(repo, { command: NO_ARTIFACT_COMMAND }, repo);
});

test('a Bash command that names a workspace file that does not exist changes nothing', () => {
  const repo = makeRepo();
  assertBashChangesNothing(repo, { command: `cat ${SESSION_LOG_FILE}` }, repo);
  assert.ok(!fs.existsSync(path.join(repo, SESSION_LOG_FILE)), 'the hook created the file');
});

// An entry for a folder would hide every file in it.
test('a folder with the name of a workspace file gets no entry, and its files stay in git status', () => {
  const repo = makeRepo();
  writeArtifact(path.join(repo, STATE_FILE), PROJECT_DOCUMENT);
  assertBashChangesNothing(repo, { command: `ls ${STATE_FILE}` }, repo);
  assert.strictEqual(status(repo), untrackedLine(path.join(STATE_FILE, PROJECT_DOCUMENT)));
});

// Decision: the entry depends on the state of the file, not on what the
// command does with it. An existing, untracked workspace file in an accepted
// folder gets its entry after any command that names it, as it does after a
// Write or an Edit of the same file. A file that an older plugin version left
// visible is hidden in this way by the `grep` that the skill runs before a save.
test('a Bash command that only reads an existing workspace file gives it the entry that a Write gives', () => {
  const afterWrite = makeRepo();
  writeWithTool(afterWrite, SESSION_LOG_FILE, afterWrite);
  const afterRead = makeRepo();
  writeArtifact(afterRead);
  afterBash(afterRead, { command: `grep -i hook ${SESSION_LOG_FILE} | tail -20` }, afterRead);
  assert.strictEqual(excludeContent(afterRead), excludeContent(afterWrite));
  assert.strictEqual(status(afterRead), '');
});

// The command must hold the full file name with the same letter case; the
// Write route compares the file name in the same way.
for (const command of [
  'cat SESSION-LOG.md',
  'cat Session-Log.MD',
  'cat session-log',
  'cat session-log.txt',
  'cat session log.md',
  'cat session-log.m',
]) {
  test(`the command "${command}" does not name session-log.md and changes nothing`, () => {
    const repo = makeRepo();
    writeArtifact(repo);
    assertBashChangesNothing(repo, { command }, repo);
  });
}

test('a Bash command that names a file that is not a workspace file changes nothing', () => {
  const repo = makeRepo();
  writeArtifact(repo, PROJECT_DOCUMENT);
  assertBashChangesNothing(repo, { command: `printf x >> ${PROJECT_DOCUMENT}` }, repo);
});

// Values that the documented input of a Bash call never holds. None may make
// the hook fail, and none may be read as a command that names the file.
for (const [label, toolInput] of [
  ['no tool input', undefined],
  ['a tool input without a command', {}],
  ['a null command', { command: null }],
  ['a number as command', { command: 42 }],
  ['a list as command', { command: [SESSION_LOG_FILE] }],
  ['an object as command', { command: { text: SESSION_LOG_FILE } }],
]) {
  test(`a Bash input with ${label} changes nothing and does not fail`, () => {
    const repo = makeRepo();
    writeArtifact(repo);
    assertBashChangesNothing(repo, toolInput, repo);
  });
}

test('a Bash input without cwd uses the project folder only', () => {
  const repo = makeRepo();
  writeArtifact(repo);
  const output = runHook(
    TRACK_EDITS,
    repo,
    { tool_name: BASH_TOOL, tool_input: { command: `cat ${SESSION_LOG_FILE}` }, session_id: TEST_SESSION },
    repo
  );
  assert.strictEqual(output, EMPTY_HOOK_OUTPUT);
  assert.strictEqual(status(repo), '');
});

test('a Bash input without cwd and without a project folder changes nothing', () => {
  const repo = makeRepo();
  writeArtifact(repo);
  const output = runHook(
    TRACK_EDITS,
    repo,
    { tool_name: BASH_TOOL, tool_input: { command: `cat ${SESSION_LOG_FILE}` }, session_id: TEST_SESSION }
  );
  assert.strictEqual(output, EMPTY_HOOK_OUTPUT);
  assert.strictEqual(status(repo), untrackedLine(SESSION_LOG_FILE));
});

// A repository inside the session scratchpad (the folder for throwaway files
// that the hook input names in `scratchpad_dir`) is a test fixture. The hook
// leaves its `git status` as the commands left it, after a Write and after Bash.
for (const [toolName, toolInputOf] of [
  [WRITE_TOOL, repo => ({ file_path: path.join(repo, SESSION_LOG_FILE), content: FILE_TEXT })],
  [BASH_TOOL, () => ({ command: `printf x >> ${SESSION_LOG_FILE}` })],
]) {
  test(`a session log in a repository inside the scratchpad gets no entry after ${toolName}`, () => {
    const scratchpadDir = newFolder('scratchpad');
    const repo = path.join(scratchpadDir, 'fixture');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    writeArtifact(repo);
    const excludeBefore = excludeContent(repo);
    const input = { tool_name: toolName, tool_input: toolInputOf(repo), cwd: repo, session_id: TEST_SESSION, [SCRATCHPAD_FIELD]: scratchpadDir };
    assert.strictEqual(runHook(TRACK_EDITS, repo, input, repo), EMPTY_HOOK_OUTPUT);
    assert.strictEqual(excludeContent(repo), excludeBefore);
    assert.strictEqual(status(repo), untrackedLine(SESSION_LOG_FILE));
  });
}

test('a save outside a git repository writes nothing besides the session log', () => {
  const dir = newFolder('plain');
  assert.strictEqual(saveWithBash(dir, dir), EMPTY_HOOK_OUTPUT);
  assert.deepStrictEqual(fs.readdirSync(dir), [SESSION_LOG_FILE]);
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
