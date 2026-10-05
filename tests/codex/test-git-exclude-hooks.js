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

// ── Letter case: a tracked file whose name differs only in letter case ───────
//
// On a file system that ignores letter case (the default on macOS and on
// Windows), `session-log.md` and `SESSION-LOG.md` are one file. When the
// project tracks that file, no route may give it an entry: the entry would
// hide the file with no message if the user untracks it later. On a file
// system that keeps letter case apart, the two names are two files, and the
// untracked one gets its entry.

console.log('\ntrack-edits.js: a tracked file with another letter case');

const FOLDS_LETTER_CASE = (() => {
  fs.writeFileSync(path.join(WORK_ROOT, 'Case-Probe'), '');
  return fs.existsSync(path.join(WORK_ROOT, 'case-probe'));
})();

/** After `act` on a repository that tracks `trackedName`: no entry where the two names are one file. */
function assertTrackedSpellingDecides(trackedName, name, act) {
  const repo = makeRepo();
  commitFile(repo, trackedName, FILE_TEXT);
  const excludeBefore = excludeContent(repo);
  act(repo);
  if (FOLDS_LETTER_CASE) {
    assert.strictEqual(excludeContent(repo), excludeBefore, `the tracked ${trackedName} got an entry`);
  } else {
    assert.ok(isIgnored(repo, name), `the untracked ${name} is a second file and got no entry`);
  }
}

test('after a Write of state.md, a tracked STATE.md gets no entry where letter case is ignored', () => {
  assertTrackedSpellingDecides('STATE.md', STATE_FILE, repo => writeWithTool(repo, STATE_FILE, repo));
});

test('after a Write of session-log.md, a tracked SESSION-LOG.md gets no entry where letter case is ignored', () => {
  assertTrackedSpellingDecides('SESSION-LOG.md', SESSION_LOG_FILE, repo => writeWithTool(repo, SESSION_LOG_FILE, repo));
});

// The hook follows git: with this setting git reads the two names as two
// files (the default on a file system that keeps letter case apart).
test('with core.ignorecase set to false, a tracked STATE.md does not stop the entry of state.md', () => {
  const repo = makeRepo();
  git(repo, 'config', 'core.ignorecase', 'false');
  commitFile(repo, 'STATE.md', FILE_TEXT);
  writeWithTool(repo, STATE_FILE, repo);
  assert.ok(excludeContent(repo).endsWith(`/${STATE_FILE}\n`), `no entry: ${excludeContent(repo)}`);
});

test('with core.ignorecase set to false, a tracked state.md still gets no entry', () => {
  const repo = makeRepo();
  git(repo, 'config', 'core.ignorecase', 'false');
  commitFile(repo, STATE_FILE, FILE_TEXT);
  const excludeBefore = excludeContent(repo);
  writeWithTool(repo, STATE_FILE, repo);
  assert.strictEqual(excludeContent(repo), excludeBefore);
});

// ── track-edits.js after a Bash call ─────────────────────────────────────────
//
// The save command of the context-management skill creates session-log.md
// through the Bash tool: `cat >> session-log.md <<'…'`. After a Bash call the
// hook gives an entry to one file only: a session-log.md that the command
// redirects output into (`>` or `>>`), and that exists in a folder that the
// folder rule accepts. A command that only names a workspace file writes
// nothing: the file can be a document of the user's project, and an entry
// would leave it out of `git add -A` and of the commit with no message.

console.log('\ntrack-edits.js after a Bash call');

const NO_ARTIFACT_COMMAND = 'npm test';
const SESSION_LOG_ENTRY = `/${SESSION_LOG_FILE}\n`;
const HERE_DOCUMENT_OPENER = '<<';
const SCRATCHPAD_FIELD = 'scratchpad_dir';
// A file of the user's project whose name is not a workspace file name.
const PROJECT_DOCUMENT = 'design.md';
const APPEND_TO_SESSION_LOG = `printf x >> ${SESSION_LOG_FILE}`;

/** The input that Claude Code gives the hook after a Bash call. */
function bashInput(toolInput, cwd) {
  return { tool_name: BASH_TOOL, tool_input: toolInput, cwd, session_id: TEST_SESSION };
}

/** Run track-edits after a Bash call that ended in the folder `cwd`. */
function afterBash(cwd, toolInput, projectDir) {
  return runHook(TRACK_EDITS, cwd, bashInput(toolInput, cwd), projectDir);
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

/** A file in `folder` that no tool call announced to the hook. */
function writeArtifact(folder, name = SESSION_LOG_FILE) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name), FILE_TEXT);
}

/** Run the hook with `input` and check that it changed neither the exclude file nor `git status`. */
function assertHookChangesNothing(repo, input, projectDir, processCwd = repo) {
  const excludeBefore = excludeContent(repo);
  const statusBefore = status(repo);
  assert.strictEqual(runHook(TRACK_EDITS, processCwd, input, projectDir), EMPTY_HOOK_OUTPUT);
  assert.strictEqual(excludeContent(repo), excludeBefore);
  assert.strictEqual(status(repo), statusBefore);
}

/** The same check for a Bash call that ended in the top folder of `repo`. */
function assertBashChangesNothing(repo, toolInput, projectDir) {
  assertHookChangesNothing(repo, bashInput(toolInput, repo), projectDir);
}

/** A new repository whose top folder holds the untracked files `names`. */
function makeRepoWith(...names) {
  const repo = makeRepo();
  for (const name of names) writeArtifact(repo, name);
  return repo;
}

const sharedRepos = new Map();

/**
 * One repository for all the tests that expect no change: its top folder holds
 * the untracked file `name`. This saves the creation of about 90 repositories.
 * When one of these tests fails, the hook has changed the shared repository,
 * and the tests after it can fail too.
 */
function sharedRepoWith(name) {
  if (!sharedRepos.has(name)) sharedRepos.set(name, makeRepoWith(name));
  return sharedRepos.get(name);
}

/** The command in one line, for a test label. */
function labelOf(command) {
  const text = JSON.stringify(command);
  return text.length > 90 ? `${text.slice(0, 87)}..."` : text;
}

test('hooks.json runs track-edits.js after Bash, Edit and Write', () => {
  const entries = JSON.parse(fs.readFileSync(HOOKS_CONFIG, 'utf8')).hooks.PostToolUse
    .filter(entry => entry.hooks.some(hook => hook.command.includes(TRACK_EDITS_NAME)));
  assert.strictEqual(entries.length, 1, 'Expected one PostToolUse entry for track-edits.js');
  assert.deepStrictEqual(entries[0].matcher.split('|').sort(), [BASH_TOOL, EDIT_TOOL, WRITE_TOOL]);
  assert.strictEqual(entries[0].hooks.length, 1, 'Another hook would run after Bash too');
});

// ── The save command of the skill ────────────────────────────────────────────

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

test('after a save, a tracked SESSION-LOG.md gets no entry where letter case is ignored', () => {
  assertTrackedSpellingDecides('SESSION-LOG.md', SESSION_LOG_FILE, repo => saveWithBash(repo, repo));
});

test('a save gives the entry also when the hook input holds no session id', () => {
  const repo = makeRepoWith(SESSION_LOG_FILE);
  const { session_id: _unused, ...input } = bashInput({ command: skillSaveCommand() }, repo);
  assert.strictEqual(runHook(TRACK_EDITS, repo, input, repo), EMPTY_HOOK_OUTPUT);
  assert.strictEqual(status(repo), '');
});

// ── Every form of a redirect into session-log.md gives the entry ─────────────

const LONG_TEXT = 'x'.repeat(300);
const REDIRECT_COMMANDS = [
  APPEND_TO_SESSION_LOG,
  'printf x >>session-log.md',
  'printf x > session-log.md',
  'printf x >session-log.md',
  'printf x >| session-log.md',
  'printf x >>\tsession-log.md',
  'printf x >> "session-log.md"',
  "printf x >> 'session-log.md'",
  'printf x >> ./session-log.md',
  'printf x 1>> session-log.md',
  'printf x 2>>session-log.md',
  'printf x &>> session-log.md',
  'printf x >>session-log.md&& ls',
  'LC_ALL=C cat >> session-log.md',
  // The line goes on after a backslash at its end.
  'printf x \\\n>> session-log.md',
  // The redirect stands after the here-document operator, on the same line.
  "cat <<'EOF' >> session-log.md\nbody\nEOF",
  // The redirect stands on the second line, and no here-document comes first.
  'cd .\nprintf x >> session-log.md',
  // The redirect stands after more than 200 characters.
  `printf '%s' "${LONG_TEXT}" >> session-log.md`,
  'wc -l README.md >> session-log.md',
  // The command holds a redirect into another file first.
  'printf x > notes.txt; printf y >> session-log.md',
  // `<<<` gives the next word to the command as input; no body follows it.
  'cat <<< text >> session-log.md',
  'cat <<< text\nprintf x >> session-log.md',
  'echo "it\'s done" >> session-log.md',
  'echo \'say "hi"\' >> session-log.md',
  "echo it\\'s >> session-log.md",
  'true && printf x >> session-log.md; ls',
  '(printf x) >> session-log.md',
  '{ printf x; } >> session-log.md',
  'echo a#b >> session-log.md',
];

for (const command of REDIRECT_COMMANDS) {
  test(`the redirect in ${labelOf(command)} gives session-log.md its entry`, () => {
    const repo = makeRepoWith(SESSION_LOG_FILE);
    assert.strictEqual(afterBash(repo, { command }, repo), EMPTY_HOOK_OUTPUT);
    assert.strictEqual(status(repo), '');
    assert.ok(excludeContent(repo).endsWith(SESSION_LOG_ENTRY), `no entry: ${excludeContent(repo)}`);
  });
}

// ── A command that only names a workspace file writes nothing ────────────────
//
// Each command ran while an untracked file with that name lay in the top
// folder. Before this rule, each one hid the file from `git status`.

const MENTION_COMMANDS = [
  name => `grep -rn "${name}" docs/`,
  name => `cat docs/app-${name}`,
  name => `git commit -m "docs: describe ${name}"`,
  name => `echo "the file ${name} is new"`,
  name => `cat > notes.txt <<'EOF'\n${name}\nEOF`,
  name => `git restore --staged ${name}`,
  name => `git rm --cached ${name}`,
  name => `cat ${name}`,
  name => `wc -l ${name}`,
  name => `wc -l < ${name}`,
  name => `grep -i hook ${name} | tail -20`,
  name => `ls ${name} > /dev/null`,
  // Not a redirect: the hook does not know the options of `tee`.
  name => `printf x | tee -a ${name}`,
];

for (const name of [STATE_FILE, KNOWN_ISSUES_FILE, SESSION_LOG_FILE]) {
  for (const commandOf of MENTION_COMMANDS) {
    const command = commandOf(name);
    test(`the command ${labelOf(command)} leaves an untracked ${name} in git status`, () => {
      const repo = sharedRepoWith(name);
      assertBashChangesNothing(repo, { command }, repo);
      assert.strictEqual(status(repo), untrackedLine(name));
    });
  }
}

// After a Bash call only session-log.md can get an entry: the skills write the
// other three workspace files with the Write tool.
for (const name of WORKSPACE_FILES.filter(file => file !== SESSION_LOG_FILE)) {
  test(`a redirect into ${name} writes no entry after a Bash call`, () => {
    const repo = sharedRepoWith(name);
    assertBashChangesNothing(repo, { command: `printf x >> ${name}` }, repo);
  });
}

// The text `>> session-log.md` is in the command, but the shell does not read
// it as a redirect into that file.
const NOT_A_REDIRECT_COMMANDS = [
  // The body of a here-document.
  "cat > notes.txt <<'EOF'\ncat >> session-log.md\nEOF",
  'cat > notes.txt <<EOF\nprintf x >> session-log.md\nEOF',
  "cat > notes.txt <<-'EOF'\n\tprintf x >> session-log.md\n\tEOF",
  "cat <<'EOF'\nprintf x >> session-log.md\nEOF",
  // The body of a here-document inside double quotes: the form of a commit
  // message. The second and the third message hold double quotes themselves.
  'git commit -m "$(cat <<\'EOF\'\nfix: the command cat >> session-log.md is seen\nEOF\n)"',
  'git commit -m "$(cat <<\'EOF\'\nfix: the "save" command, then cat >> session-log.md\nEOF\n)"',
  'git commit -m "$(cat <<\'EOF\'\nfix: a 5" disk >> session-log.md\nEOF\n)"',
  // A text in quotes, and a character after a backslash.
  'git commit -m "the command cat >> session-log.md leaves the file visible"',
  "echo '>> session-log.md'",
  'grep -n ">> session-log.md" README.md',
  'cat <<< ">> session-log.md"',
  'echo \\>\\> session-log.md',
  'echo "a \\" >> session-log.md"',
  // A comment.
  '# next step: cat >> session-log.md\nls',
  'ls # >> session-log.md',
  // Another file.
  'printf x >> session-log.md.bak',
  'printf x >> my-session-log.md',
  'printf x >> session-log.mdx',
  'printf x >> SESSION-LOG.md',
  'printf x >> Session-Log.md',
  'printf x >> session-log',
  'printf x > /dev/null; cat session-log.md',
  'printf x 2>&1 | grep session-log.md',
  // No target on the same line.
  'printf x >>\nsession-log.md',
  // An input redirect.
  'cat < session-log.md',
];

for (const command of NOT_A_REDIRECT_COMMANDS) {
  test(`the command ${labelOf(command)} is no redirect into session-log.md and changes nothing`, () => {
    const repo = sharedRepoWith(SESSION_LOG_FILE);
    assertBashChangesNothing(repo, { command }, repo);
  });
}

// Accepted limits. The hook cannot know the value of a variable, so it cannot
// know which file such a command wrote: it writes nothing. It reads a command
// only up to the end of the first line that holds `<<`, so a redirect on a
// later line is not seen; the reader does not test whether the `<<` opens a
// here-document. In each case the file stays visible until the next save in
// the form of the skill.
const UNREADABLE_REDIRECT_COMMANDS = [
  'printf x >> "$DIR/session-log.md"',
  'printf x >> $DIR/session-log.md',
  'printf x >> "${PWD}/session-log.md"',
  'printf x >> $(pwd)/session-log.md',
  'printf x >> `pwd`/session-log.md',
  'printf x >> ~/session-log.md',
  // Read as plain paths, these three would name the file of this folder.
  'printf x >> $DIR/../session-log.md',
  'printf x >> `pwd`/../session-log.md',
  'printf x >> ~/../session-log.md',
  'printf x >> session-log.m\\d',
  "cat > notes.txt <<'EOF'\nbody\nEOF\nprintf x >> session-log.md",
  'echo "a << b"\nprintf x >> session-log.md',
  'echo $((1<<2))\nprintf x >> session-log.md',
  'printf x >& session-log.md',
];

for (const command of UNREADABLE_REDIRECT_COMMANDS) {
  test(`limit: the redirect in ${labelOf(command)} is not read, and nothing changes`, () => {
    const repo = sharedRepoWith(SESSION_LOG_FILE);
    assertBashChangesNothing(repo, { command }, repo);
  });
}

test('a Bash command that names no workspace file changes nothing, also when such a file exists', () => {
  const repo = sharedRepoWith(SESSION_LOG_FILE);
  assertBashChangesNothing(repo, { command: NO_ARTIFACT_COMMAND }, repo);
});

test('a redirect into a file that is not a workspace file changes nothing', () => {
  const repo = makeRepoWith(PROJECT_DOCUMENT);
  assertBashChangesNothing(repo, { command: `printf x >> ${PROJECT_DOCUMENT}` }, repo);
});

// ── The state of the file decides ────────────────────────────────────────────

test('a redirect into a session log that does not exist changes nothing', () => {
  const repo = makeRepo();
  assertBashChangesNothing(repo, { command: APPEND_TO_SESSION_LOG }, repo);
  assert.ok(!fs.existsSync(path.join(repo, SESSION_LOG_FILE)), 'the hook created the file');
});

// An entry for a folder would hide every file in it.
test('a folder with the name session-log.md gets no entry, and its files stay in git status', () => {
  const repo = makeRepo();
  writeArtifact(path.join(repo, SESSION_LOG_FILE), PROJECT_DOCUMENT);
  assertBashChangesNothing(repo, { command: APPEND_TO_SESSION_LOG }, repo);
  assert.strictEqual(status(repo), untrackedLine(path.join(SESSION_LOG_FILE, PROJECT_DOCUMENT)));
});

// The Write route gives a symbolic link with this name its entry too.
test('a session log that is a symbolic link to a file gets its entry', () => {
  const repo = makeRepo();
  commitFile(repo, PROJECT_DOCUMENT, FILE_TEXT);
  fs.symlinkSync(PROJECT_DOCUMENT, path.join(repo, SESSION_LOG_FILE));
  afterBash(repo, { command: APPEND_TO_SESSION_LOG }, repo);
  assert.strictEqual(status(repo), '');
});

// ── The folder rule is the rule of the Write route ───────────────────────────

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

// The command names the file in the subfolder. The file in the top folder has
// the same name, but the command did not write it: both stay visible.
test('a redirect into docs/session-log.md gives no entry, also not to a session log in the top folder', () => {
  const repo = makeRepoWith(SESSION_LOG_FILE);
  writeArtifact(path.join(repo, DOCS_FOLDER));
  assertBashChangesNothing(repo, { command: `printf x >> ${DOCS_FOLDER}/${SESSION_LOG_FILE}` }, repo);
});

// The same state after `cd docs`: the hook input names the subfolder as `cwd`,
// and the project folder holds a session log that the command did not write.
test('a redirect in a subfolder gives no entry to the session log of the project folder', () => {
  const repo = makeRepoWith(SESSION_LOG_FILE);
  const docsFolder = path.join(repo, DOCS_FOLDER);
  fs.mkdirSync(docsFolder);
  // The hook process starts in the project folder, as Claude Code starts it.
  assertHookChangesNothing(repo, bashInput({ command: APPEND_TO_SESSION_LOG }, docsFolder), repo);
});

for (const [label, targetOf] of [
  ['a relative path', () => `../${SESSION_LOG_FILE}`],
  ['an absolute path in double quotes', repo => `"${path.join(repo, SESSION_LOG_FILE)}"`],
]) {
  test(`a redirect in a subfolder that names the session log of the top folder by ${label} gives the entry`, () => {
    const repo = makeRepoWith(SESSION_LOG_FILE);
    const docsFolder = path.join(repo, DOCS_FOLDER);
    fs.mkdirSync(docsFolder);
    afterBash(docsFolder, { command: `printf x >> ${targetOf(repo)}` }, repo);
    assert.strictEqual(status(repo), '');
  });
}

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

// A linked worktree shares the exclude file of the main checkout: an entry
// written for the worktree would hide the user's document in both.
test('a command in a linked worktree that names state.md hides it in neither work tree', () => {
  const repo = makeRepoWith(STATE_FILE);
  const worktree = `${repo}-linked`;
  git(repo, 'worktree', 'add', '-q', worktree);
  writeArtifact(worktree, STATE_FILE);
  assert.strictEqual(afterBash(worktree, { command: `grep -c x ${STATE_FILE}` }, repo), EMPTY_HOOK_OUTPUT);
  assert.strictEqual(status(repo), untrackedLine(STATE_FILE));
  assert.strictEqual(status(worktree), untrackedLine(STATE_FILE));
});

// ── The session scratchpad ───────────────────────────────────────────────────
//
// A repository inside the session scratchpad (the folder for throwaway files
// that the hook input names in `scratchpad_dir`) is a test fixture. The hook
// leaves its `git status` as the commands left it, after a Write and after
// Bash. A fixture repository in any other folder is a project for the hook.

/** A new repository in `repo` (a folder that exists) with an untracked session log. */
function makeFixture(repo) {
  git(repo, 'init', '-q');
  writeArtifact(repo);
  return repo;
}

const SESSION_LOG_TOOL_INPUTS = [
  [WRITE_TOOL, repo => ({ file_path: path.join(repo, SESSION_LOG_FILE), content: FILE_TEXT })],
  [BASH_TOOL, () => ({ command: APPEND_TO_SESSION_LOG })],
];

for (const [toolName, toolInputOf] of SESSION_LOG_TOOL_INPUTS) {
  for (const [label, repoOf] of [
    ['inside the scratchpad', scratchpadDir => path.join(scratchpadDir, 'fixture')],
    ['that is the scratchpad folder', scratchpadDir => scratchpadDir],
  ]) {
    test(`a session log in a repository ${label} gets no entry after ${toolName}`, () => {
      const scratchpadDir = newFolder('scratchpad');
      const repo = repoOf(scratchpadDir);
      fs.mkdirSync(repo, { recursive: true });
      makeFixture(repo);
      const input = { ...bashInput(toolInputOf(repo), repo), tool_name: toolName, [SCRATCHPAD_FIELD]: scratchpadDir };
      assertHookChangesNothing(repo, input, repo);
      assert.strictEqual(status(repo), untrackedLine(SESSION_LOG_FILE));
    });
  }
}

test('in a repository outside the scratchpad, a command that names state.md changes nothing and a save gives the entry', () => {
  const scratchpadDir = newFolder('scratchpad');
  const repo = makeRepoWith(STATE_FILE, SESSION_LOG_FILE);
  const inputOf = command => ({ ...bashInput({ command }, repo), [SCRATCHPAD_FIELD]: scratchpadDir });
  assertHookChangesNothing(repo, inputOf(`cat ${STATE_FILE}`), repo);
  runHook(TRACK_EDITS, repo, inputOf(APPEND_TO_SESSION_LOG), repo);
  assert.strictEqual(status(repo), untrackedLine(STATE_FILE));
});

// ── Input that the documented Bash call never holds ──────────────────────────

// None may make the hook fail, and none may be read as a redirect.
for (const [label, toolInput] of [
  ['no tool input', undefined],
  ['a tool input without a command', {}],
  ['a null command', { command: null }],
  ['a number as command', { command: 42 }],
  ['a list as command', { command: [APPEND_TO_SESSION_LOG] }],
  ['an object as command', { command: { text: APPEND_TO_SESSION_LOG } }],
]) {
  test(`a Bash input with ${label} changes nothing and does not fail`, () => {
    const repo = sharedRepoWith(SESSION_LOG_FILE);
    assertBashChangesNothing(repo, toolInput, repo);
  });
}

// Without a folder the hook cannot know which file a relative path means. The
// hook process starts in the repository, so a path resolved against the
// folder of the process would find the file.
for (const [label, cwd] of [['no cwd', undefined], ['an empty cwd', ''], ['a number as cwd', 7]]) {
  test(`a Bash input with ${label} changes nothing and does not fail`, () => {
    const repo = sharedRepoWith(SESSION_LOG_FILE);
    assertHookChangesNothing(repo, bashInput({ command: APPEND_TO_SESSION_LOG }, cwd), repo);
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
