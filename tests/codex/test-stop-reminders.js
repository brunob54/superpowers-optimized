#!/usr/bin/env node
/**
 * Unit tests — hooks/stop-reminders.js (Claude Stop hook path)
 *
 * Validates the Stop output shape expected by Claude Code and guard behavior.
 * Run: node tests/codex/test-stop-reminders.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '../../hooks');
const HOOK_MODULE_PATH = path.join(HOOKS_DIR, 'stop-reminders.js');
const SAVE_MARKER_MODULE_PATH = path.join(HOOKS_DIR, 'save-marker.js');

// A user who sets this variable in the settings.json "env" block also passes
// it to every command the assistant runs, and so to this file. Every test
// expects the default (all reminders on) unless it sets the variable itself.
const REMINDERS_OFF_VARIABLE = 'SUPERPOWERS_STOP_REMINDERS_OFF';
delete process.env[REMINDERS_OFF_VARIABLE];

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

function makeTempDirs() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-stop-home-'));
  const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-stop-cwd-'));
  const logDir = path.join(homeDir, '.claude', 'hooks-logs');
  fs.mkdirSync(logDir, { recursive: true });
  return { homeDir, cwdDir, logDir };
}

function cleanup(...dirs) {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup for temp test dirs
    }
  }
}

function loadHookWithHome(homeDir) {
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  // Both modules compute the log folder from HOME when they load.
  for (const modulePath of [HOOK_MODULE_PATH, SAVE_MARKER_MODULE_PATH]) {
    delete require.cache[require.resolve(modulePath)];
  }
  const hook = { ...require(HOOK_MODULE_PATH), ...require(SAVE_MARKER_MODULE_PATH) };

  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;

  if (prevUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevUserProfile;

  return hook;
}

const TEST_SESSION_ID = 'test-session-abc123';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function editLogLine(sessionId, filePath, ageMs = 0) {
  return `${new Date(Date.now() - ageMs).toISOString()} | ${sessionId} | Edit | ${filePath}\n`;
}

function writeEditLog(logDir, lines) {
  fs.writeFileSync(path.join(logDir, 'edit-log.txt'), lines.join(''), 'utf8');
}

function writeRecentEdits(logDir, filePaths, ageMinutes = 0) {
  writeEditLog(logDir, filePaths.map(filePath =>
    editLogLine(TEST_SESSION_ID, filePath, ageMinutes * MINUTE_MS)));
}

function writeRecentEdit(logDir, filePath) {
  writeRecentEdits(logDir, [filePath]);
}

console.log('\nStop reminders output contract (Claude)');

test('Test-file detection recognizes tests/codex/test-*.js naming', () => {
  const { homeDir } = makeTempDirs();
  try {
    const { isTestFile } = loadHookWithHome(homeDir);
    assert.strictEqual(isTestFile('tests/codex/test-stop-reminders.js'), true,
      'Expected test-*.js under tests/ to be classified as a test file');
  } finally {
    cleanup(homeDir);
  }
});

test('When reminders exist: emits decision+reason, not Stop hookSpecificOutput', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, 'src/index.js');
    const { evaluatePayload } = loadHookWithHome(homeDir);

    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });

    assert.strictEqual(result.decision, 'block',
      `Expected decision=block, got: ${JSON.stringify(result)}`);
    assert.strictEqual(typeof result.reason, 'string',
      `Expected reason string, got: ${JSON.stringify(result)}`);
    assert.ok(result.reason.includes('<stop-hook-reminders>'),
      `Expected stop reminders tag in reason: ${result.reason}`);
    assert.ok(!result.hookSpecificOutput,
      `Stop output must not include hookSpecificOutput: ${JSON.stringify(result)}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Active guard suppresses reminder output', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, 'src/index.js');
    const { evaluatePayload, guardFile } = loadHookWithHome(homeDir);
    fs.writeFileSync(guardFile(TEST_SESSION_ID), new Date().toISOString(), 'utf8');

    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    assert.deepStrictEqual(result, {},
      `Expected empty output while guard is active, got: ${JSON.stringify(result)}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('No reminders available emits {}', () => {
  const { homeDir, cwdDir } = makeTempDirs();
  try {
    const { evaluatePayload } = loadHookWithHome(homeDir);
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    assert.deepStrictEqual(result, {},
      `Expected empty output without reminders, got: ${JSON.stringify(result)}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Stats-only session (skill invocations but no edits) emits {} — does not block', () => {
  // Regression test for v6.5.1 bug: stats summary alone must NOT trigger decision:block.
  // The user reported "Stop hook error: <stop-hook-reminders> Session summary: 6min,
  // 1 skill invocations [executing-plans (1x)]" after every stop — caused by the stop
  // hook blocking even when the only reminder was the informational stats summary.
  const { homeDir, cwdDir } = makeTempDirs();
  try {
    const hook = loadHookWithHome(homeDir);
    // Write the statistics file of this session: 1 skill call, no edits
    fs.writeFileSync(hook.statsFile(TEST_SESSION_ID), JSON.stringify({
      startedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(), // 6 min ago
      skillInvocations: { 'superpowers-orchestrator:executing-plans': 1 },
      totalSkillCalls: 1,
      hookBlocks: 0,
      filesEdited: 0,
      verificationsRun: 0,
    }), 'utf8');
    // No edit-log entries for this session (no edits made)

    // The summary exists, so the empty result below proves that it does not block.
    const reminders = hook.generateReminders([], cwdDir, TEST_SESSION_ID);
    assert.ok(reminders.some(reminder => reminder.startsWith('Session summary:')),
      `Expected the summary of this session, got: ${JSON.stringify(reminders)}`);
    const result = hook.evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });

    assert.deepStrictEqual(result, {},
      `Stats-only session must emit {}, got: ${JSON.stringify(result)}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Commit reminder suppressed when all session edits are committed (git clean)', () => {
  // Regression test for post-v6.5.2 fix: commit reminder must check actual git status,
  // not session edit count. A session that edited 5+ files but committed them all
  // must NOT emit a commit reminder.
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    // Simulate 6 session edits so the edit-count threshold (>=5) is crossed
    const editLog = path.join(logDir, 'edit-log.txt');
    const lines = ['a.js','b.js','c.js','d.js','e.js','f.js'].map(f =>
      `${new Date().toISOString()} | ${TEST_SESSION_ID} | Edit | /project/${f}\n`
    ).join('');
    fs.writeFileSync(editLog, lines, 'utf8');

    const { evaluatePayload } = loadHookWithHome(homeDir);
    // cwdDir is a temp dir with no git repo → getUncommittedCount returns 0 → no commit reminder
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });

    // May block for TDD reminder (source files, no tests), but must NOT mention "Commit reminder"
    const reason = result.reason || '';
    assert.ok(!reason.includes('Commit reminder'),
      `Commit reminder must not fire when git reports no uncommitted changes, got: ${reason}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

// ── isSignificantSession pattern coverage ────────────────────────────────────

console.log('\nisSignificantSession pattern coverage');

test('Detects SKILL.md edits', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, 'skills/debugging/SKILL.md');
    const { evaluatePayload } = loadHookWithHome(homeDir);
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    const reason = result.reason || '';
    assert.ok(reason.includes('Decision log'), `SKILL.md edit should trigger decision log: ${reason}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Detects hooks/*.js edits', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, '/project/hooks/context-engine.js');
    const { evaluatePayload } = loadHookWithHome(homeDir);
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    const reason = result.reason || '';
    assert.ok(reason.includes('Decision log'), `hooks/*.js edit should trigger decision log: ${reason}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Detects specs/*.md edits (new pattern)', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, 'docs/superpowers-orchestrator/2026-08-25-foo/specs/foo-design.md');
    const { evaluatePayload } = loadHookWithHome(homeDir);
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    const reason = result.reason || '';
    assert.ok(reason.includes('Decision log'), `specs/*.md edit should trigger decision log: ${reason}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Detects plans/*.md edits (new pattern)', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, 'docs/superpowers-orchestrator/2026-08-25-foo/plans/foo.md');
    const { evaluatePayload } = loadHookWithHome(homeDir);
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    const reason = result.reason || '';
    assert.ok(reason.includes('Decision log'), `plans/*.md edit should trigger decision log: ${reason}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Does NOT treat implementation/*.md edits as significant', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, 'docs/superpowers-orchestrator/2026-08-25-foo/implementation/foo-review-log.md');
    const { evaluatePayload } = loadHookWithHome(homeDir);
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    const reason = result.reason || '';
    assert.ok(!reason.includes('Decision log'),
      `implementation/*.md edit must not trigger the decision log: ${reason}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Detects plugin.universal.yaml edits (new pattern)', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, 'plugin.universal.yaml');
    const { evaluatePayload } = loadHookWithHome(homeDir);
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    const reason = result.reason || '';
    assert.ok(reason.includes('Decision log'), `plugin.universal.yaml edit should trigger decision log: ${reason}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

test('Does NOT trigger for regular source file edits', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdit(logDir, 'src/app.js');
    const { evaluatePayload } = loadHookWithHome(homeDir);
    const result = evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
    const reason = result.reason || '';
    assert.ok(!reason.includes('Decision log'), `Regular source file should NOT trigger decision log: ${reason}`);
  } finally {
    cleanup(homeDir, cwdDir);
  }
});

// ── Edits inside a subagent's own worktree ───────────────────────────────────
// Claude Code gives a subagent that runs with worktree isolation the folder
// `.claude/worktrees/agent-a<16 hexadecimal digits>/`. The edit log records
// those edits under the parent session's id. They are throwaway work (for
// example mutation testing), so no reminder may count them.

console.log('\nEdits inside a subagent worktree');

const AGENT_WORKTREE = '/project/.claude/worktrees/agent-a017948ab31bc3287';

function evaluateEdits(filePaths, ageMinutes = 0) {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    writeRecentEdits(logDir, filePaths, ageMinutes);
    const { evaluatePayload } = loadHookWithHome(homeDir);
    return evaluatePayload({ cwd: cwdDir, session_id: TEST_SESSION_ID });
  } finally {
    cleanup(homeDir, cwdDir);
  }
}

const IGNORED_WORKTREE_EDITS = [
  ['a SKILL.md edit', `${AGENT_WORKTREE}/skills/debugging/SKILL.md`],
  ['a hooks/*.js edit (also a source file for the test-first reminder)', `${AGENT_WORKTREE}/hooks/a.js`],
  ['a Windows path with backslashes', 'C:\\project\\.claude\\worktrees\\agent-a017948ab31bc3287\\skills\\x\\SKILL.md'],
  ['a relative path with no leading separator', '.claude/worktrees/agent-a017948ab31bc3287/skills/x/SKILL.md'],
];

for (const [label, filePath] of IGNORED_WORKTREE_EDITS) {
  test(`Ignores ${label} inside a subagent worktree`, () => {
    const result = evaluateEdits([filePath]);
    assert.deepStrictEqual(result, {},
      `Expected no reminder for ${filePath}, got: ${JSON.stringify(result)}`);
  });
}

const COUNTED_EDITS = [
  ['a main checkout edit that stands next to a subagent worktree edit',
    [`${AGENT_WORKTREE}/skills/x/SKILL.md`, '/project/skills/x/SKILL.md']],
  ['a worktree that the main session entered (the folder name is not an agent id)',
    ['/project/.claude/worktrees/feature-login/skills/x/SKILL.md']],
  ['a worktree folder that only begins like an agent id',
    ['/project/.claude/worktrees/agent-cafe/skills/x/SKILL.md']],
  ['an agent-id folder outside .claude/worktrees',
    ['/project/.worktrees/agent-a017948ab31bc3287/skills/x/SKILL.md']],
  ['an agent-id folder under a worktrees folder that is not inside .claude',
    ['/project/worktrees/agent-a017948ab31bc3287/skills/x/SKILL.md']],
  ['a folder name with 17 hexadecimal digits',
    ['/project/.claude/worktrees/agent-a017948ab31bc32870/skills/x/SKILL.md']],
  ['a folder name that continues after the agent id',
    ['/project/.claude/worktrees/agent-a017948ab31bc3287-notes/skills/x/SKILL.md']],
  ['a folder name with a letter that is not a hexadecimal digit',
    ['/project/.claude/worktrees/agent-a017948ab31bc328z/skills/x/SKILL.md']],
];

for (const [label, filePaths] of COUNTED_EDITS) {
  test(`Still counts ${label}`, () => {
    const reason = evaluateEdits(filePaths).reason || '';
    assert.ok(reason.includes('Decision log'),
      `Expected the decision log reminder for ${filePaths.join(', ')}: ${reason}`);
  });
}

// The reminder about source edits reads the edits of the last 30 minutes.
// Both tests write one source file edit and differ only in its age.
const SOURCE_EDIT = ['src/index.js'];

test('Counts a source edit that is 10 minutes old', () => {
  assert.strictEqual(evaluateEdits(SOURCE_EDIT, 10).decision, 'block',
    'Expected a reminder for an edit inside the 30-minute window');
});

test('Does not count a source edit that is 31 minutes old', () => {
  const result = evaluateEdits(SOURCE_EDIT, 31);
  assert.deepStrictEqual(result, {},
    `Expected no reminder for an edit outside the 30-minute window, got: ${JSON.stringify(result)}`);
});

// ── Save marker and stop guard of one session ────────────────────────────────
// Each session has its own save marker and its own stop guard. The old marker
// file that all sessions share is still honoured, because old skill text and
// old handoff documents still write it.

console.log('\nSave marker and stop guard of one session');

const OTHER_SESSION_ID = 'other-session-def456';
const SIGNIFICANT_FILE = '/project/skills/x/SKILL.md';
const DECISION_LOG = 'Decision log';

/**
 * Run one scenario: `arrange` prepares the log folder, then the stop hook
 * evaluates a stop of TEST_SESSION_ID. `inspect` runs after the stop, while
 * the temporary folders still exist. Returns the hook result. An object that
 * `arrange` returns is added to the payload of that last stop.
 */
function evaluateStop(arrange, inspect = () => {}) {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    const hook = loadHookWithHome(homeDir);
    const stop = (sessionId, extraFields = {}) =>
      hook.evaluatePayload({ cwd: cwdDir, session_id: sessionId, ...extraFields });
    const lastStopFields = arrange({ hook, logDir, cwdDir, stop });
    const result = stop(TEST_SESSION_ID, lastStopFields);
    inspect();
    return result;
  } finally {
    cleanup(homeDir, cwdDir);
  }
}

function writeTime(file, ageMs = 0) {
  fs.writeFileSync(file, new Date(Date.now() - ageMs).toISOString(), 'utf8');
}

function setFileAge(file, ageMs) {
  const time = new Date(Date.now() - ageMs);
  fs.utimesSync(file, time, time);
}

test('T2: the stop guard of another session does not silence this session', () => {
  const result = evaluateStop(({ logDir, stop }) => {
    writeEditLog(logDir, [
      editLogLine(OTHER_SESSION_ID, SIGNIFICANT_FILE),
      editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE),
    ]);
    assert.strictEqual(stop(OTHER_SESSION_ID).decision, 'block',
      'Expected the other session to be blocked first, which sets its guard');
  });
  assert.ok((result.reason || '').includes(DECISION_LOG),
    `Expected a block inside two minutes of the other session's block, got: ${JSON.stringify(result)}`);
});

test('T2b: the stop guard of this session still silences its next stop', () => {
  const result = evaluateStop(({ logDir, stop }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE)]);
    assert.strictEqual(stop(TEST_SESSION_ID).decision, 'block', 'Expected the first stop to be blocked');
  });
  assert.deepStrictEqual(result, {}, `Expected {} for the second stop, got: ${JSON.stringify(result)}`);
});

// `stop_hook_active` is the payload field that Claude Code sets to true when it
// is already continuing because a stop hook blocked. The hook stays silent when
// the field is true OR the guard file is young; the field can never add a block.
const CONTINUING = { stop_hook_active: true };
const GUARD_EXPIRED_MS = 3 * MINUTE_MS;

function arrangeDueBlock({ logDir }) {
  writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE)]);
}

test('T2c: stop_hook_active true silences the stop when no guard file exists, and writes none', () => {
  let guardWritten;
  let guardPath;
  const result = evaluateStop((context) => {
    arrangeDueBlock(context);
    guardPath = context.hook.guardFile(TEST_SESSION_ID);
    return CONTINUING;
  }, () => { guardWritten = fs.existsSync(guardPath); });
  assert.deepStrictEqual(result, {}, `Expected {} while Claude Code is continuing, got: ${JSON.stringify(result)}`);
  assert.strictEqual(guardWritten, false, 'A silent stop must not write the guard file');
});

test('T2d: stop_hook_active true silences a continuation that lasts longer than the guard', () => {
  const result = evaluateStop((context) => {
    arrangeDueBlock(context);
    assert.strictEqual(context.stop(TEST_SESSION_ID).decision, 'block', 'Expected the first stop to be blocked');
    setFileAge(context.hook.guardFile(TEST_SESSION_ID), GUARD_EXPIRED_MS);
    return CONTINUING;
  });
  assert.deepStrictEqual(result, {}, `Expected {} for the continuation stop, got: ${JSON.stringify(result)}`);
});

test('T2e: an expired guard and no field blocks again (a platform without the field)', () => {
  const result = evaluateStop((context) => {
    arrangeDueBlock(context);
    assert.strictEqual(context.stop(TEST_SESSION_ID).decision, 'block', 'Expected the first stop to be blocked');
    setFileAge(context.hook.guardFile(TEST_SESSION_ID), GUARD_EXPIRED_MS);
  });
  assert.strictEqual(result.decision, 'block', `Expected a block, got: ${JSON.stringify(result)}`);
});

for (const value of [false, 'true', 1]) {
  test(`T2f: stop_hook_active ${JSON.stringify(value)} is not "continuing": the stop is blocked`, () => {
    const result = evaluateStop((context) => {
      arrangeDueBlock(context);
      return { stop_hook_active: value };
    });
    assert.strictEqual(result.decision, 'block', `Expected a block, got: ${JSON.stringify(result)}`);
  });
}

test('T2g: stop_hook_active false does not switch the guard off', () => {
  const result = evaluateStop((context) => {
    arrangeDueBlock(context);
    assert.strictEqual(context.stop(TEST_SESSION_ID).decision, 'block', 'Expected the first stop to be blocked');
    return { stop_hook_active: false };
  });
  assert.deepStrictEqual(result, {}, `Expected {} inside two minutes of the block, got: ${JSON.stringify(result)}`);
});

test('T3: the save marker of this session clears its decision-log block', () => {
  const result = evaluateStop(({ hook, logDir }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE, MINUTE_MS)]);
    writeTime(hook.markerFile(TEST_SESSION_ID));
  });
  assert.deepStrictEqual(result, {}, `Expected no block after a save, got: ${JSON.stringify(result)}`);
});

test('T3b: the save marker of another session does not clear the block', () => {
  const result = evaluateStop(({ hook, logDir }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE, MINUTE_MS)]);
    writeTime(hook.markerFile(OTHER_SESSION_ID));
  });
  assert.ok((result.reason || '').includes(DECISION_LOG),
    `Expected the decision-log block, got: ${JSON.stringify(result)}`);
});

test('T3c: an edit later than the save marker is still reported', () => {
  const result = evaluateStop(({ hook, logDir }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE)]);
    writeTime(hook.markerFile(TEST_SESSION_ID), MINUTE_MS);
  });
  assert.ok((result.reason || '').includes(DECISION_LOG),
    `Expected the decision-log block, got: ${JSON.stringify(result)}`);
});

test('T4: the old shared save marker still clears the block', () => {
  const result = evaluateStop(({ hook, logDir }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE, MINUTE_MS)]);
    writeTime(hook.markerFile());
  });
  assert.deepStrictEqual(result, {}, `Expected no block, got: ${JSON.stringify(result)}`);
});

test('T4b: the later of the two markers counts', () => {
  const result = evaluateStop(({ hook, logDir }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE, MINUTE_MS)]);
    writeTime(hook.markerFile(TEST_SESSION_ID));
    writeTime(hook.markerFile(), DAY_MS);
  });
  assert.deepStrictEqual(result, {}, `Expected no block, got: ${JSON.stringify(result)}`);
});

test('T6: a block deletes per-session files older than 7 days and keeps all others', () => {
  let oldFiles;
  let keptFiles;
  const remaining = files => files.filter(file => fs.existsSync(file));
  const result = evaluateStop(({ hook, logDir }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE)]);
    const perSessionFiles = sessionId =>
      [hook.markerFile, hook.guardFile, hook.editLogFile, hook.statsFile].map(fileOf => fileOf(sessionId));
    const newFiles = perSessionFiles(OTHER_SESSION_ID);
    // Only the file age decides: the shared files are as old as the deleted ones.
    const sharedFiles = [hook.markerFile(), hook.guardFile(), hook.statsFile()];
    oldFiles = perSessionFiles('old-session');
    keptFiles = [...newFiles, ...sharedFiles];
    [...oldFiles, ...keptFiles].forEach(file => writeTime(file, 8 * DAY_MS));
    [...oldFiles, ...sharedFiles].forEach(file => setFileAge(file, 8 * DAY_MS));
    newFiles.forEach(file => setFileAge(file, 6 * DAY_MS));
  }, () => {
    oldFiles = remaining(oldFiles);
    keptFiles = [keptFiles.length, remaining(keptFiles).length];
  });
  assert.strictEqual(result.decision, 'block', `Expected a block, got: ${JSON.stringify(result)}`);
  assert.deepStrictEqual(oldFiles, [], 'Old per-session files must be deleted');
  assert.strictEqual(keptFiles[1], keptFiles[0], 'New per-session files and shared files must stay');
});

test('T7: an edit 8 days old with no save marker gives no decision-log block', () => {
  const result = evaluateStop(({ logDir }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE, 8 * DAY_MS)]);
  });
  assert.deepStrictEqual(result, {}, `Expected no block, got: ${JSON.stringify(result)}`);
});

test('T7b: an edit 6 days old with no save marker is still reported', () => {
  const result = evaluateStop(({ logDir }) => {
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE, 6 * DAY_MS)]);
  });
  assert.ok((result.reason || '').includes(DECISION_LOG),
    `Expected the decision-log block, got: ${JSON.stringify(result)}`);
});

test('The decision-log reminder prints the marker command', () => {
  let command;
  const result = evaluateStop(({ hook, logDir }) => {
    command = hook.MARKER_COMMAND;
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, SIGNIFICANT_FILE)]);
  });
  assert.ok(command && (result.reason || '').includes(command),
    `Expected the marker command in the reminder, got: ${result.reason}`);
});

// ── SUPERPOWERS_STOP_REMINDERS_OFF ───────────────────────────────────────────

console.log('\nSUPERPOWERS_STOP_REMINDERS_OFF switches single reminders off');


/** Run `fn` while the switch variable holds `value`; restore it afterwards. */
function withRemindersOff(value, fn) {
  const previous = process.env[REMINDERS_OFF_VARIABLE];
  process.env[REMINDERS_OFF_VARIABLE] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[REMINDERS_OFF_VARIABLE];
    else process.env[REMINDERS_OFF_VARIABLE] = previous;
  }
}

const OLD_STATE_MS = 10 * MINUTE_MS;
const LARGE_SESSION_LOG = '## 2026-04-15 [saved]\nGoal: Test\n' + 'x'.repeat(1600) + '\n';

// Each scenario makes exactly one reminder due, so a block with no reason
// left proves that the name switched off that reminder and nothing else.
const REMINDER_SCENARIOS = [
  {
    name: 'tdd',
    text: 'TDD reminder',
    arrange: ({ logDir }) => writeRecentEdit(logDir, 'src/index.js'),
  },
  {
    name: 'commit',
    text: 'Commit reminder',
    arrange: ({ logDir, cwdDir }) => {
      const files = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => `${name}.txt`);
      git(cwdDir, ['init', '-q']);
      for (const file of files) fs.writeFileSync(path.join(cwdDir, file), 'x', 'utf8');
      // Staged files are listed by `git status` even when the user's git
      // configuration hides untracked files (status.showUntrackedFiles=no).
      git(cwdDir, ['add', '.']);
      writeRecentEdits(logDir, files.map(file => path.join(cwdDir, file)));
    },
  },
  {
    name: 'decision-log',
    text: 'Decision log:',
    arrange: ({ logDir }) => writeRecentEdit(logDir, SIGNIFICANT_FILE),
  },
  {
    name: 'state-md',
    text: 'State.md sync',
    // The source edits also make the TDD reminder due; the test file edit
    // stops it, because a session that changed a test gets no TDD reminder.
    arrange: ({ logDir, cwdDir }) => {
      const stateFile = path.join(cwdDir, 'state.md');
      fs.writeFileSync(stateFile, '# state\n', 'utf8');
      setFileAge(stateFile, OLD_STATE_MS);
      writeRecentEdits(logDir, ['src/a.js', 'src/b.js', 'tests/test-a.js']);
    },
  },
  {
    name: 'session-log-size',
    text: 'Session-log size warning',
    arrange: ({ cwdDir }) =>
      fs.writeFileSync(path.join(cwdDir, 'session-log.md'), LARGE_SESSION_LOG, 'utf8'),
  },
];

for (const scenario of REMINDER_SCENARIOS) {
  test(`Without the switch, the "${scenario.name}" scenario blocks with its reminder`, () => {
    const result = evaluateStop(scenario.arrange);
    assert.ok((result.reason || '').includes(scenario.text),
      `Expected "${scenario.text}" in the block, got: ${JSON.stringify(result)}`);
  });

  test(`"${scenario.name}" in the switch removes that reminder and the block`, () => {
    const result = withRemindersOff(scenario.name, () => evaluateStop(scenario.arrange));
    assert.deepStrictEqual(result, {},
      `Expected no block with "${scenario.name}" switched off, got: ${JSON.stringify(result)}`);
  });
}

test('The commit reminder tells the assistant to ask when a project rule requires approval', () => {
  const result = evaluateStop(REMINDER_SCENARIOS.find(s => s.name === 'commit').arrange);
  assert.ok((result.reason || '').includes("requires the user's approval before a commit"),
    `Expected the approval sentence in the commit reminder, got: ${result.reason}`);
});

test('Names are trimmed and case-insensitive, unknown names are ignored, other reminders stay', () => {
  // The commit scenario plus one source edit makes two reminders due.
  const arrange = (context) => {
    REMINDER_SCENARIOS.find(s => s.name === 'commit').arrange(context);
    fs.appendFileSync(path.join(context.logDir, 'edit-log.txt'),
      editLogLine(TEST_SESSION_ID, 'src/index.js'), 'utf8');
  };
  const result = withRemindersOff(' Commit ,unknown ', () => evaluateStop(arrange));
  const reason = result.reason || '';
  assert.ok(!reason.includes('Commit reminder'),
    `Expected no commit reminder, got: ${reason}`);
  assert.ok(reason.includes('TDD reminder'),
    `Expected the TDD reminder to stay, got: ${reason}`);
});

const TDD_SCENARIO = REMINDER_SCENARIOS.find(s => s.name === 'tdd');
const UNKNOWN_NAME_WARNING = 'Unknown name in SUPERPOWERS_STOP_REMINDERS_OFF';

test('A block names each unknown name in the switch and lists the known names', () => {
  const result = withRemindersOff('commit,tdd commit, state.md', () => evaluateStop(TDD_SCENARIO.arrange));
  const reason = result.reason || '';
  assert.ok(reason.includes(UNKNOWN_NAME_WARNING), `Expected the warning, got: ${reason}`);
  assert.ok(reason.includes('"tdd commit"') && reason.includes('"state.md"'),
    `Expected both unknown names, got: ${reason}`);
  assert.ok(reason.includes('session-log-size'), `Expected the known names, got: ${reason}`);
});

test('Known names only: the block has no unknown-name warning', () => {
  const result = withRemindersOff('commit', () => evaluateStop(TDD_SCENARIO.arrange));
  assert.ok((result.reason || '').includes('TDD reminder'), `Expected a block, got: ${JSON.stringify(result)}`);
  assert.ok(!result.reason.includes(UNKNOWN_NAME_WARNING), `Expected no warning, got: ${result.reason}`);
});

test('An unknown name alone never makes the hook block', () => {
  const result = withRemindersOff('unknown', () => evaluateStop(() => {}));
  assert.deepStrictEqual(result, {}, `Expected no block, got: ${JSON.stringify(result)}`);
});

// ── TDD reminder names its files ─────────────────────────────────────────────

console.log('\nTDD reminder names the source files it counts');

// Reported by a user: a session edited a Markdown file, and the reminder said
// "1 source file(s)" without a name. The file counted was an earlier code
// edit of the same 30-minute window, but the reader could not see that.
test('The TDD reminder names the counted source file, relative to cwd, and not a Markdown file', () => {
  const result = evaluateStop(({ logDir, cwdDir }) =>
    writeRecentEdits(logDir, ['src/app.py', 'docs/notes.md'].map(file => path.join(cwdDir, file))));
  const reason = result.reason || '';
  assert.ok(reason.includes(`: ${path.join('src', 'app.py')}.`),
    `Expected the relative source path in the reminder, got: ${reason}`);
  assert.ok(!reason.includes('notes.md'), `Expected no Markdown file in the reminder, got: ${reason}`);
});

test('A source file outside cwd is named with its full path', () => {
  const outsidePath = path.join(os.tmpdir(), 'elsewhere', 'tool.py');
  const result = evaluateStop(({ logDir }) => writeRecentEdit(logDir, outsidePath));
  assert.ok((result.reason || '').includes(outsidePath),
    `Expected the full path in the reminder, got: ${result.reason}`);
});

test('The TDD reminder names at most five files and counts the rest', () => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => `${name}.js`);
  const result = evaluateStop(({ logDir, cwdDir }) =>
    writeRecentEdits(logDir, files.map(file => path.join(cwdDir, file))));
  const reason = result.reason || '';
  assert.ok(reason.includes('7 source file(s)') && reason.includes('a.js, b.js, c.js, d.js, e.js and 2 more.'),
    `Expected five names and "and 2 more", got: ${reason}`);
  assert.ok(!reason.includes('f.js'), `Expected no sixth name, got: ${reason}`);
});

// ── TDD reminder leaves out a file that is back at its committed state ───────
// Reported by a user: a session edited a source file and then removed the
// edit. `git diff` was empty, but every later stop inside the 30-minute window
// named the file again, because the reminder read the edit log only. The
// reminder now asks git. It leaves a file out only when git gives positive
// proof: git tracks the file, reports no change for it, and no commit on any
// branch changed it since the edit. A file that was committed without a test
// is still named, and so is every file that git cannot judge.

console.log('\nTDD reminder leaves out a file that is back at its committed state');

const SOURCE_NAME = path.join('src', 'app.js');
const OTHER_SOURCE_NAME = path.join('src', 'other.js');
const NEW_SOURCE_NAME = path.join('src', 'new.js');
const COMMITTED_TEXT = 'module.exports = 1;\n';
const EDITED_TEXT = 'module.exports = 2;\n';
const SECOND_MS = 1000;
// The edit record is 10 minutes old and the first commit is one hour old, so
// that commit is earlier than the edit. A commit that a test makes without a
// date gets the current time, which is later than the edit.
const EDIT_AGE_MINUTES = 10;
const FIRST_COMMIT_AGE_MS = 60 * MINUTE_MS;
// For a file with two edit records: the commit lies between the two edits.
const MIDDLE_COMMIT_AGE_MS = 15 * MINUTE_MS;
const EDIT_BEFORE_MIDDLE_COMMIT_MINUTES = 25;
const EDIT_AFTER_MIDDLE_COMMIT_MINUTES = 5;

function git(repoDir, args, env = {}) {
  const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

/** The date of a commit in the raw form of git: whole seconds and a time zone. */
function gitDate(timeMs) {
  return `${Math.floor(timeMs / SECOND_MS)} +0000`;
}

function initRepo(repoDir) {
  fs.mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init', '-q']);
  for (const [key, value] of [['user.email', 'test@example.com'], ['user.name', 'Test'], ['commit.gpgsign', 'false']]) {
    git(repoDir, ['config', key, value]);
  }
}

/** Write one file below repoDir, with its folders. Returns the full path. */
function writeRepoFile(repoDir, name, text = COMMITTED_TEXT) {
  const file = path.join(repoDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

/** Commit every file of repoDir. Without a time, the commit is made "now". */
function commitAll(repoDir, timeMs = Date.now()) {
  const date = gitDate(timeMs);
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-q', '-m', 'commit'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

/**
 * Make repoDir a repository whose only commit is one hour old and holds the
 * source file. Returns the full path of the source file.
 */
function repoWithCommittedSource(repoDir, name = SOURCE_NAME) {
  initRepo(repoDir);
  const file = writeRepoFile(repoDir, name);
  commitAll(repoDir, Date.now() - FIRST_COMMIT_AGE_MS);
  return file;
}

function recordEdits(logDir, files) {
  writeRecentEdits(logDir, files, EDIT_AGE_MINUTES);
}

/** Write one edit record per [file, age in minutes] pair. */
function recordEditsAtAges(logDir, fileAgePairs) {
  writeEditLog(logDir, fileAgePairs.map(([file, ageMinutes]) =>
    editLogLine(TEST_SESSION_ID, file, ageMinutes * MINUTE_MS)));
}

function assertNoReminder(result) {
  assert.deepStrictEqual(result, {}, `Expected no reminder, got: ${JSON.stringify(result)}`);
}

function assertReminderNames(result, name) {
  const reason = result.reason || '';
  assert.ok(reason.includes(TDD_SCENARIO.text) && reason.includes(`1 source file(s) modified without test changes: ${name}.`),
    `Expected the TDD reminder to name only ${name}, got: ${JSON.stringify(result)}`);
}

test('A tracked file that was edited and then restored gets no reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const file = repoWithCommittedSource(cwdDir);
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    fs.writeFileSync(file, COMMITTED_TEXT, 'utf8');
    recordEdits(logDir, [file]);
  }));
});

test('A tracked file that is still modified is named', () => {
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    const file = repoWithCommittedSource(cwdDir);
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    recordEdits(logDir, [file]);
  }), SOURCE_NAME);
});

test('A file that was committed after the edit, without a test, is still named', () => {
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    const file = repoWithCommittedSource(cwdDir);
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    commitAll(cwdDir);
    recordEdits(logDir, [file]);
  }), SOURCE_NAME);
});

// git stores a commit time in whole seconds, and the edit log stores
// milliseconds. A commit in the same second as the edit counts as "after the
// edit": a doubtful case keeps the reminder.
test('A commit in the same second as the edit counts as a commit after the edit', () => {
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    const commitTimeMs = Math.floor(Date.now() / SECOND_MS) * SECOND_MS - EDIT_AGE_MINUTES * MINUTE_MS;
    const editTimeMs = commitTimeMs + 900;
    initRepo(cwdDir);
    const file = writeRepoFile(cwdDir, SOURCE_NAME);
    commitAll(cwdDir, commitTimeMs);
    writeEditLog(logDir, [editLogLine(TEST_SESSION_ID, file, Date.now() - editTimeMs)]);
  }), SOURCE_NAME);
});

// git has no record of a file that it never tracked. It cannot tell a file
// that was deleted from a file that was moved to another name, so the
// reminder stays.
const DELETED_NEW_FILES = [
  ['in a folder that still exists', NEW_SOURCE_NAME],
  ['in a folder that was deleted too', path.join('scratch', 'deep', 'new.js')],
];

for (const [label, name] of DELETED_NEW_FILES) {
  test(`A new file that was written and then deleted, ${label}, is still named`, () => {
    assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
      repoWithCommittedSource(cwdDir);
      recordEdits(logDir, [path.join(cwdDir, name)]);
    }), name);
  });
}

test('A new file that git does not track yet is named', () => {
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    repoWithCommittedSource(cwdDir);
    recordEdits(logDir, [writeRepoFile(cwdDir, NEW_SOURCE_NAME)]);
  }), NEW_SOURCE_NAME);
});

test('A new file is named when the git configuration of the user hides untracked files', () => {
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    repoWithCommittedSource(cwdDir);
    git(cwdDir, ['config', 'status.showUntrackedFiles', 'no']);
    recordEdits(logDir, [writeRepoFile(cwdDir, NEW_SOURCE_NAME)]);
  }), NEW_SOURCE_NAME);
});

test('A file that git ignores is named: git cannot say whether it changed', () => {
  const ignoredName = path.join('build', 'out.js');
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    initRepo(cwdDir);
    writeRepoFile(cwdDir, '.gitignore', 'build/\n');
    commitAll(cwdDir, Date.now() - FIRST_COMMIT_AGE_MS);
    recordEdits(logDir, [writeRepoFile(cwdDir, ignoredName)]);
  }), ignoredName);
});

test('Of a restored file and a modified file, the reminder counts and names only the modified file', () => {
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    initRepo(cwdDir);
    const files = [SOURCE_NAME, OTHER_SOURCE_NAME].map(name => writeRepoFile(cwdDir, name));
    commitAll(cwdDir, Date.now() - FIRST_COMMIT_AGE_MS);
    fs.writeFileSync(files[1], EDITED_TEXT, 'utf8');
    recordEdits(logDir, files);
  }), OTHER_SOURCE_NAME);
});

test('A restored file in a repository that is not the session folder gets no reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    recordEdits(logDir, [repoWithCommittedSource(path.join(cwdDir, 'nested-repo'))]);
  }));
});

test('A restored file whose record holds a relative path gets no reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    repoWithCommittedSource(cwdDir);
    recordEdits(logDir, [SOURCE_NAME]);
  }));
});

test('In a repository with no commit, a file that does not exist is still named', () => {
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    initRepo(cwdDir);
    recordEdits(logDir, [path.join(cwdDir, SOURCE_NAME)]);
  }), SOURCE_NAME);
});

// Each state leaves the working file equal to the last commit of the current
// branch, or leaves no working file, but the change of the session still
// exists in the repository.
const CHANGE_STILL_IN_REPOSITORY = [
  ['whose change is staged and then removed from the working file', (repoDir, file) => {
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    git(repoDir, ['add', '-A']);
    fs.writeFileSync(file, COMMITTED_TEXT, 'utf8');
  }],
  ['that the session deleted', (repoDir, file) => fs.rmSync(file)],
  ['that was committed on another branch before the first branch was checked out again', (repoDir, file) => {
    git(repoDir, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    commitAll(repoDir);
    git(repoDir, ['checkout', '-q', '-']);
  }],
  ['whose change was put away with git stash', (repoDir, file) => {
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    git(repoDir, ['stash', '-q']);
  }],
];

for (const [label, change] of CHANGE_STILL_IN_REPOSITORY) {
  test(`A tracked file ${label} is still named`, () => {
    assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
      const file = repoWithCommittedSource(cwdDir);
      change(cwdDir, file);
      recordEdits(logDir, [file]);
    }), SOURCE_NAME);
  });
}

// Reported by two reviewers: the session edits and commits a file inside a
// git worktree (a second working folder of the same repository), and the
// worktree is removed afterwards. The folder of the file no longer exists.
test('A file committed in a worktree that was removed afterwards is still named', () => {
  const worktreeName = path.join('.claude', 'worktrees', 'feature');
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    repoWithCommittedSource(cwdDir);
    const worktreeDir = path.join(cwdDir, worktreeName);
    git(cwdDir, ['worktree', 'add', '-q', '-b', 'feature', worktreeName]);
    const file = writeRepoFile(worktreeDir, SOURCE_NAME, EDITED_TEXT);
    commitAll(worktreeDir);
    git(cwdDir, ['worktree', 'remove', worktreeName]);
    recordEdits(logDir, [file]);
  }), path.join(worktreeName, SOURCE_NAME));
});

// On a file system that ignores letter case (the default on macOS), a record
// can name the file in another case than git stores. git then reports nothing
// for the name, also while the file is modified.
test('A modified file whose record differs in letter case from the tracked name is still named', () => {
  const recordedName = path.join('src', 'APP.js');
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    fs.writeFileSync(repoWithCommittedSource(cwdDir), EDITED_TEXT, 'utf8');
    recordEdits(logDir, [path.join(cwdDir, recordedName)]);
  }), recordedName);
});

// The file has two edit records. The commit lies between them, so only the
// first record is earlier than the commit.
test('A file that was edited, committed, edited again and restored is still named: the first edit counts', () => {
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    const file = repoWithCommittedSource(cwdDir);
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    commitAll(cwdDir, Date.now() - MIDDLE_COMMIT_AGE_MS);
    recordEditsAtAges(logDir, [[file, EDIT_BEFORE_MIDDLE_COMMIT_MINUTES], [file, EDIT_AFTER_MIDDLE_COMMIT_MINUTES]]);
  }), SOURCE_NAME);
});

// The commit changed the second file before the first edit of that file, and
// after the edit of the first file. Each file is judged with its own edit time.
test('The first edit time is taken per file: an earlier edit of another file does not keep the reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    initRepo(cwdDir);
    const [first, second] = [SOURCE_NAME, OTHER_SOURCE_NAME].map(name => writeRepoFile(cwdDir, name));
    commitAll(cwdDir, Date.now() - FIRST_COMMIT_AGE_MS);
    fs.writeFileSync(second, EDITED_TEXT, 'utf8');
    commitAll(cwdDir, Date.now() - MIDDLE_COMMIT_AGE_MS);
    recordEditsAtAges(logDir, [[first, EDIT_BEFORE_MIDDLE_COMMIT_MINUTES], [second, EDIT_AFTER_MIDDLE_COMMIT_MINUTES]]);
  }));
});

test('A restored file gets no reminder when a commit after the edit changed only another file', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const file = repoWithCommittedSource(cwdDir);
    writeRepoFile(cwdDir, 'README.md', '# readme\n');
    commitAll(cwdDir);
    recordEdits(logDir, [file]);
  }));
});

// git reads `[id]` in a file name as a pattern that matches the one letter
// `i` or `d`, unless it is told that such characters have no special meaning.
test('A restored file whose name holds pattern characters is judged alone, not with the files that the pattern matches', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    initRepo(cwdDir);
    const [restored, matchedByPattern] = [path.join('pages', '[id].js'), path.join('pages', 'i.js')]
      .map(name => writeRepoFile(cwdDir, name));
    commitAll(cwdDir, Date.now() - FIRST_COMMIT_AGE_MS);
    fs.writeFileSync(matchedByPattern, EDITED_TEXT, 'utf8');
    recordEdits(logDir, [restored]);
  }));
});

// The index is the file in which git stores the state of every tracked file.
// A new modification time makes the index entry of the file out of date, and
// a plain `git status` then writes the index again. The hook must not write
// into the repository of the user.
test('The check of a restored file does not rewrite the index of the repository', () => {
  let indexFile;
  let indexBefore;
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const file = repoWithCommittedSource(cwdDir);
    setFileAge(file, EDIT_AGE_MINUTES * MINUTE_MS);
    recordEdits(logDir, [file]);
    indexFile = path.join(cwdDir, '.git', 'index');
    indexBefore = fs.readFileSync(indexFile);
  }, () => assert.ok(indexBefore.equals(fs.readFileSync(indexFile)), 'Expected the index file to be unchanged')));
});

test('The commit reminder states the number of files that git reports', () => {
  const result = evaluateStop(REMINDER_SCENARIOS.find(s => s.name === 'commit').arrange);
  assert.ok((result.reason || '').includes('Commit reminder: 6 files with uncommitted changes'),
    `Expected a count of 6 files, got: ${result.reason}`);
});

// ── checkSessionLogSize hard cap ─────────────────────────────────────────────

console.log('\ncheckSessionLogSize hard cap');

test('Entry at 1200 chars does NOT trigger warning (cap is 1500)', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cap-home-'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cap-'));
  try {
    // ~1200 chars: under old cap (1000) this would trigger, under new cap (1500) it should not
    const content = '## 2026-04-15 [saved]\nGoal: Test\n' + 'Decisions:\n- ' + 'x'.repeat(1100) + '\n';
    fs.writeFileSync(path.join(tmpDir, 'session-log.md'), content);
    const hook = loadHookWithHome(homeDir);
    const result = hook.checkSessionLogSize(tmpDir);
    assert.strictEqual(result, null, `1200-char entry should NOT trigger at 1500 cap, got: ${result}`);
  } finally {
    cleanup(homeDir, tmpDir);
  }
});

test('Entry at 1600 chars DOES trigger warning', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cap-home-'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cap-'));
  try {
    const content = '## 2026-04-15 [saved]\nGoal: Test\n' + 'x'.repeat(1600) + '\n';
    fs.writeFileSync(path.join(tmpDir, 'session-log.md'), content);
    const hook = loadHookWithHome(homeDir);
    const result = hook.checkSessionLogSize(tmpDir);
    assert.ok(result !== null, 'Expected warning for 1600-char entry');
    assert.ok(result.includes('375 tokens'), `Warning should reference 375 token cap, got: ${result}`);
  } finally {
    cleanup(homeDir, tmpDir);
  }
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`stop-reminders: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
