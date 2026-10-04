#!/usr/bin/env node
/**
 * Unit tests — hooks/codex/session-start-adapter.js
 *
 * Verifies output shape, context assembly, graceful fallbacks, and the
 * condition of the update check (with local bare repositories as remotes;
 * the fetch from GitHub is not tested).
 *
 * Run: node tests/codex/test-session-start-adapter.js
 * No dependencies beyond Node.js stdlib.
 */

'use strict';

const { buildSessionContext } = require('../../hooks/codex/session-start-adapter');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function runAdapter(payload, cwd) {
  const previous = process.env.SUPERPOWERS_AUTO_UPDATE;
  process.env.SUPERPOWERS_AUTO_UPDATE = '0';

  const raw = buildSessionContext(cwd);
  let parsed = {};
  try {
    parsed = JSON.parse(raw.trim() || '{}');
  } catch {}
  parsed._rawPlainText = raw;
  if (previous === undefined) delete process.env.SUPERPOWERS_AUTO_UPDATE;
  else process.env.SUPERPOWERS_AUTO_UPDATE = previous;
  return parsed;
}

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

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ss-test-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ── Output shape ──────────────────────────────────────────────────────────────

console.log('\nOutput shape (Codex SessionStart spec)');

test('Output is plain-text context on stdout', () => {
  const dir = makeTempDir();
  try {
    const result = runAdapter({ session_id: 'test-123', source: 'startup' }, dir);
    assert.ok(typeof result._rawPlainText === 'string' && result._rawPlainText.length > 0,
      `Missing plain-text context: ${JSON.stringify(result)}`);
  } finally { cleanup(dir); }
});

test('Output does not require a JSON hook envelope', () => {
  const dir = makeTempDir();
  try {
    const result = runAdapter({ source: 'startup' }, dir);
    assert.ok(!result.hookSpecificOutput,
      `Unexpected hookSpecificOutput envelope: ${JSON.stringify(result)}`);
  } finally { cleanup(dir); }
});

test('No top-level additionalContext (Claude Code shape must not appear)', () => {
  const dir = makeTempDir();
  try {
    const result = runAdapter({ source: 'startup' }, dir);
    assert.ok(!result.additionalContext,
      'Top-level additionalContext found — this is the Claude Code shape, not Codex');
    assert.ok(!result.additional_context,
      'Top-level additional_context found — wrong output shape');
  } finally { cleanup(dir); }
});

// ── Context content ───────────────────────────────────────────────────────────

console.log('\nContext content');

test('Context contains EXTREMELY_IMPORTANT wrapper (plain text)', () => {
  const dir = makeTempDir();
  try {
    const result = runAdapter({ source: 'startup' }, dir);
    const plainText = result._rawPlainText || '';
    assert.ok(
      plainText.includes('EXTREMELY_IMPORTANT'),
      'Missing EXTREMELY_IMPORTANT block in context'
    );
  } finally { cleanup(dir); }
});

test('Context contains using-superpowers entry point instruction (plain text)', () => {
  const dir = makeTempDir();
  try {
    const result = runAdapter({ source: 'startup' }, dir);
    const plainText = result._rawPlainText || '';
    assert.ok(
      plainText.includes('using-superpowers') || plainText.includes('superpowers-orchestrator'),
      'Missing using-superpowers reference in context'
    );
  } finally { cleanup(dir); }
});

test('Context never emits a <superpowers-defaults> block (the Codex adapter embeds workspace files with no block appended after them)', () => {
  const dir = makeTempDir();
  try {
    const result = runAdapter({ source: 'startup' }, dir);
    const ctx = result._rawPlainText || '';
    assert.ok(ctx.length > 0,
      'Codex adapter context is empty — this assertion would examine nothing');
    // The regex splits the delimiter's final ">" into a bracket expression
    // so this test file itself does not spell a complete opening delimiter.
    assert.ok(!/<superpowers-defaults[>]/.test(ctx),
      'Codex adapter context contains a <superpowers-defaults opening delimiter — a block planted in an embedded workspace file would become the last complete block there');
  } finally { cleanup(dir); }
});

test('project-map.md injected when present', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'project-map.md'), '# Project Map\n\nThis is the map.');
    const result = runAdapter({ source: 'startup' }, dir);
    const ctx = result._rawPlainText || '';
    assert.ok(ctx.includes('<project-map>'),
      'project-map.md present but not injected');
    assert.ok(ctx.includes('This is the map.'),
      'project-map.md content not in context');
  } finally { cleanup(dir); }
});

test('project-map.md NOT injected when absent', () => {
  const dir = makeTempDir();
  try {
    const result = runAdapter({ source: 'startup' }, dir);
    const ctx = result._rawPlainText || '';
    assert.ok(!ctx.includes('<project-map>'),
      'project-map tag present despite no project-map.md file');
  } finally { cleanup(dir); }
});

test('state.md injected when present', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'state.md'), '## In Progress\nWorking on feature X');
    const result = runAdapter({ source: 'startup' }, dir);
    const ctx = result._rawPlainText || '';
    assert.ok(ctx.includes('<state>'),
      'state.md present but not injected');
    assert.ok(ctx.includes('Working on feature X'),
      'state.md content not in context');
  } finally { cleanup(dir); }
});

test('known-issues.md injected when present', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'known-issues.md'), '## Error XYZ\nRun npm ci first');
    const result = runAdapter({ source: 'startup' }, dir);
    const ctx = result._rawPlainText || '';
    assert.ok(ctx.includes('<known-issues>'),
      'known-issues.md present but not injected');
  } finally { cleanup(dir); }
});

test('session-log.md: only [saved] entries injected, not [auto]', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'session-log.md'), [
      '## 2026-01-01 10:00 [auto]',
      'Files: index.js',
      '',
      '## 2026-01-02 12:00 [saved]',
      'Goal: add feature Y',
      'Decision: used approach Z',
      '',
    ].join('\n'));
    const result = runAdapter({ source: 'startup' }, dir);
    const ctx = result._rawPlainText || '';
    assert.ok(ctx.includes('<session-log>'),
      'session-log.md present but not injected');
    assert.ok(ctx.includes('add feature Y'),
      '[saved] entry content not in context');
    assert.ok(!ctx.includes('Files: index.js'),
      '[auto] entry content incorrectly included');
  } finally { cleanup(dir); }
});

test('Large project-map.md (>200 lines) → truncated to key sections', () => {
  const dir = makeTempDir();
  try {
    // Must exceed 200 lines to trigger truncation path.
    // 1+1 (title/blank) + 1+1+160 (overview) + 1+1+1+50 (constraints) + 1+1+1 (hot files) = 220
    const lines = ['# Project Map', ''];
    lines.push('## Overview', 'Some overview text that should be cut.');
    for (let i = 0; i < 160; i++) lines.push(`Overview line ${i}`);
    lines.push('', '## Critical Constraints', 'Never delete production database.');
    for (let i = 0; i < 50; i++) lines.push(`Constraint ${i}`);
    lines.push('', '## Hot Files', 'src/core.js is the entry point.');
    fs.writeFileSync(path.join(dir, 'project-map.md'), lines.join('\n'));
    const result = runAdapter({ source: 'startup' }, dir);
    const ctx = result._rawPlainText || '';
    assert.ok(ctx.includes('Critical Constraints'),
      'Critical Constraints section missing from large map');
    assert.ok(ctx.includes('Hot Files'),
      'Hot Files section missing from large map');
    // Overview section (not a key section) should be trimmed
    assert.ok(!ctx.includes('Some overview text that should be cut.'),
      'Overview section incorrectly included in large map injection');
  } finally { cleanup(dir); }
});

// ── Resilience ────────────────────────────────────────────────────────────────

console.log('\nResilience');

test('Empty cwd payload → does not crash, returns text output', () => {
  const result = runAdapter({}, process.cwd());
  assert.ok(typeof result._rawPlainText === 'string', 'Did not return text output');
});

test('Missing stdin cwd → falls back to process.cwd(), does not crash', () => {
  const previous = process.env.SUPERPOWERS_AUTO_UPDATE;
  process.env.SUPERPOWERS_AUTO_UPDATE = '0';
  const raw = buildSessionContext(process.cwd());
  if (previous === undefined) delete process.env.SUPERPOWERS_AUTO_UPDATE;
  else process.env.SUPERPOWERS_AUTO_UPDATE = previous;
  assert.ok(raw.length > 0, 'No SessionStart context when cwd omitted from payload');
});

test('context-snapshot.json with bad JSON → silently skipped', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'context-snapshot.json'), 'NOT VALID JSON {{{');
    const result = runAdapter({ source: 'startup' }, dir);
    const ctx = result._rawPlainText || '';
    assert.ok(ctx.length > 0, 'Adapter crashed on bad context-snapshot.json');
    assert.ok(!ctx.includes('NOT VALID JSON'),
      'Bad JSON content leaked into context');
  } finally { cleanup(dir); }
});

// ── Update check ──────────────────────────────────────────────────────────────
// The adapter fetches and fast-forwards only a clone of the plugin: a plugin
// folder that is itself the top level of a git work tree and has branch main
// checked out. Without that condition, a plugin copy that lies inside the
// user's own repository made the adapter fetch and fast-forward that
// repository. Each test runs a copy of the adapter as a process, because the
// adapter takes its plugin folder from its own location. No network: every
// remote is a local bare repository.

console.log('\nUpdate check (only in a clone of the plugin with branch main checked out)');

const MAIN = 'main';
const MAIN_REF = `refs/heads/${MAIN}`;
const OLD_VERSION = '1.0.0';
const NEW_VERSION = '1.1.0';
const VERSION_FILE = 'VERSION';
const UPDATED_NOTICE_START = 'Superpowers Orchestrator has been updated';
const UPDATED_NOTICE = `${UPDATED_NOTICE_START} to v${NEW_VERSION}** (was v${OLD_VERSION})`;
const ADAPTER_DIR = path.join('hooks', 'codex');
const ADAPTER_FILES = ['session-start-adapter.js', 'utils.js'];
const TEST_NAME = 'fixture';
const TEST_EMAIL = 'fixture@example.invalid';

// realpathSync resolves macOS's /var -> /private/var symbolic link.
const WORK_ROOT = fs.realpathSync(makeTempDir());

// The environment of every git command and of every adapter run:
// - the system git configuration is not read, and the global one only names
//   the first branch of a new repository;
// - GIT_DIR and the other GIT_* variables (set when this runs inside a git
//   hook) would send every git command to another repository, so they are
//   removed;
// - GIT_CEILING_DIRECTORIES stops git from finding a repository above WORK_ROOT;
// - XDG_CONFIG_HOME is removed, so the adapter keeps the time of its last
//   check under the HOME of the test.
const FIXTURE_GLOBAL_CONFIG = path.join(WORK_ROOT, 'fixture-gitconfig');
fs.writeFileSync(FIXTURE_GLOBAL_CONFIG, `[init]\n\tdefaultBranch = ${MAIN}\n`);
const ENV = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !key.startsWith('GIT_') && key !== 'XDG_CONFIG_HOME'));
Object.assign(ENV, {
  HOME: WORK_ROOT,
  USERPROFILE: WORK_ROOT,
  GIT_CONFIG_GLOBAL: FIXTURE_GLOBAL_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CEILING_DIRECTORIES: path.dirname(WORK_ROOT),
  GIT_AUTHOR_NAME: TEST_NAME,
  GIT_AUTHOR_EMAIL: TEST_EMAIL,
  GIT_COMMITTER_NAME: TEST_NAME,
  GIT_COMMITTER_EMAIL: TEST_EMAIL,
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
}

function commitAll(repo, message) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

// Copies the adapter and the module it loads into pluginDir, with the same
// relative layout. The copy has no context-engine.js, so it starts no
// background process.
function copyAdapter(pluginDir) {
  const dest = path.join(pluginDir, ADAPTER_DIR);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of ADAPTER_FILES) {
    fs.copyFileSync(path.join(__dirname, '..', '..', ADAPTER_DIR, file), path.join(dest, file));
  }
}

// Gives the repository a local bare repository as "origin", pushes branch
// main to it, and adds one commit to origin's main from a second clone. That
// commit writes content to file. The repository is then one commit behind
// origin/main and has not fetched that commit. Returns the new commit.
function originOneCommitAhead(caseDir, repo, file, content) {
  const remote = path.join(caseDir, 'remote.git');
  const other = path.join(caseDir, 'other');
  git(caseDir, 'init', '-q', '--bare', remote);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', MAIN);
  git(caseDir, 'clone', '-q', remote, other);
  fs.writeFileSync(path.join(other, file), `${content}\n`);
  commitAll(other, 'a change made on another machine');
  git(other, 'push', '-q', 'origin', MAIN);
  return git(other, 'rev-parse', 'HEAD');
}

let caseCount = 0;

// A new folder for one test, with an empty HOME and an empty project folder.
function newCase() {
  const caseDir = path.join(WORK_ROOT, `case-${++caseCount}`);
  for (const name of ['home', 'project']) fs.mkdirSync(path.join(caseDir, name), { recursive: true });
  return caseDir;
}

// A clone of the plugin with VERSION OLD_VERSION on branch main. Its origin
// is one commit ahead, and that commit sets VERSION to NEW_VERSION.
function cloneFixture() {
  const caseDir = newCase();
  const plugin = path.join(caseDir, 'plugin');
  initRepo(plugin);
  copyAdapter(plugin);
  fs.writeFileSync(path.join(plugin, VERSION_FILE), `${OLD_VERSION}\n`);
  commitAll(plugin, `release ${OLD_VERSION}`);
  const remoteHead = originOneCommitAhead(caseDir, plugin, VERSION_FILE, NEW_VERSION);
  return { caseDir, plugin, repo: plugin, remoteHead };
}

// The user's own repository at ~/.claude, one commit behind its origin. It
// ignores the folder plugins, and a plain copy of the plugin (with no
// repository of its own) lies in that folder.
function userRepoFixture() {
  const caseDir = newCase();
  const repo = path.join(caseDir, 'home', '.claude');
  const settings = 'settings.json';
  initRepo(repo);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'plugins/\n');
  fs.writeFileSync(path.join(repo, settings), '{"theme":"dark"}\n');
  commitAll(repo, 'first commit');
  const remoteHead = originOneCommitAhead(caseDir, repo, settings, '{"theme":"light"}');
  const plugin = path.join(repo, 'plugins', 'cache', 'marketplace', 'plugin', OLD_VERSION);
  copyAdapter(plugin);
  return { caseDir, plugin, repo, remoteHead };
}

// The full reference name of the checked-out branch, or '' for a detached HEAD.
function checkedOutRef(repo) {
  try {
    return git(repo, 'symbolic-ref', '-q', 'HEAD');
  } catch {
    return '';
  }
}

// The state that the adapter must not change in a repository that is not a
// clone of the plugin on branch main: the checked-out branch, the commits of
// HEAD and of origin/main, the changed and untracked files, and whether a
// fetch ran (every fetch writes the file FETCH_HEAD).
function repoState(repo) {
  return [
    `ref=${checkedOutRef(repo)}`,
    `HEAD=${git(repo, 'rev-parse', 'HEAD')}`,
    `origin/main=${git(repo, 'rev-parse', `origin/${MAIN}`)}`,
    `status=[${git(repo, 'status', '--porcelain')}]`,
    `fetched=${fs.existsSync(path.join(repo, '.git', 'FETCH_HEAD'))}`,
  ].join(' ');
}

// Runs the adapter copy of the fixture with the update check enabled, and
// returns its output.
function runAdapterCopy(fixture) {
  const home = path.join(fixture.caseDir, 'home');
  const project = path.join(fixture.caseDir, 'project');
  return execFileSync(process.execPath, [path.join(fixture.plugin, ADAPTER_DIR, ADAPTER_FILES[0])], {
    cwd: project,
    env: { ...ENV, HOME: home, USERPROFILE: home, SUPERPOWERS_AUTO_UPDATE: '1' },
    input: JSON.stringify({ cwd: project }),
    encoding: 'utf8',
  });
}

function assertUntouched(fixture) {
  const before = repoState(fixture.repo);
  const output = runAdapterCopy(fixture);
  assert.strictEqual(repoState(fixture.repo), before, 'The adapter changed the repository or fetched in it');
  assert.ok(!output.includes(UPDATED_NOTICE_START), 'The adapter announced an update');
}

function assertUpdated(fixture) {
  const output = runAdapterCopy(fixture);
  assert.strictEqual(git(fixture.repo, 'rev-parse', 'HEAD'), fixture.remoteHead, 'HEAD is not the newest commit of origin');
  assert.strictEqual(checkedOutRef(fixture.repo), MAIN_REF, 'Branch main is no longer checked out');
  assert.strictEqual(fs.readFileSync(path.join(fixture.repo, VERSION_FILE), 'utf8').trim(), NEW_VERSION);
  assert.ok(output.includes(UPDATED_NOTICE), 'The adapter did not announce the update');
}

test('Plugin folder inside the user\'s own repository → that repository is unchanged, no fetch runs in it', () => {
  assertUntouched(userRepoFixture());
});

test('Control: clone of the plugin on branch main → fast-forwarded, the update is announced', () => {
  assertUpdated(cloneFixture());
});

test('Clone of the plugin on branch main with a tag named main → fast-forwarded', () => {
  const fixture = cloneFixture();
  git(fixture.repo, 'tag', MAIN);
  assertUpdated(fixture);
});

for (const branch of ['work', 'main-old', 'feature/main']) {
  test(`Clone of the plugin with branch ${branch} checked out → unchanged, no fetch runs in it`, () => {
    const fixture = cloneFixture();
    git(fixture.repo, 'checkout', '-q', '-b', branch);
    assertUntouched(fixture);
  });
}

test('Clone of the plugin with a detached HEAD → unchanged, no fetch runs in it', () => {
  const fixture = cloneFixture();
  git(fixture.repo, 'checkout', '-q', '--detach');
  assertUntouched(fixture);
});

cleanup(WORK_ROOT);

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`session-start-adapter: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
