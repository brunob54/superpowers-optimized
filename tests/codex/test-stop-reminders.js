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
    // The logged files lie in no git repository → no file has an uncommitted change → no commit reminder
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

/** The commit scenario plus one source edit: two reminders are due. */
function arrangeCommitAndTdd(context) {
  REMINDER_SCENARIOS.find(s => s.name === 'commit').arrange(context);
  fs.appendFileSync(path.join(context.logDir, 'edit-log.txt'),
    editLogLine(TEST_SESSION_ID, 'src/index.js'), 'utf8');
}

test('Names are trimmed and case-insensitive, unknown names are ignored, other reminders stay', () => {
  const result = withRemindersOff(' Commit ,unknown ', () => evaluateStop(arrangeCommitAndTdd));
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
 * named files. Returns the full paths of the files, in the order of the names.
 */
function repoWithCommittedFiles(repoDir, names) {
  initRepo(repoDir);
  const files = names.map(name => writeRepoFile(repoDir, name));
  commitAll(repoDir, Date.now() - FIRST_COMMIT_AGE_MS);
  return files;
}

/** The same with one source file. Returns the full path of the source file. */
function repoWithCommittedSource(repoDir, name = SOURCE_NAME) {
  return repoWithCommittedFiles(repoDir, [name])[0];
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
  // The reflogs are emptied, so only the branch itself still leads to the commit.
  ['that was committed on another branch before the first branch was checked out again', (repoDir, file) => {
    git(repoDir, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    commitAll(repoDir);
    git(repoDir, ['checkout', '-q', '-']);
    git(repoDir, ['reflog', 'expire', '--expire=now', '--all']);
  }],
  ['whose change was put away with git stash', (repoDir, file) => {
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    git(repoDir, ['stash', '-q']);
  }],
  // Only the newest stash entry is a reference. git keeps an older entry in
  // the reflog (the list of the earlier values of a reference).
  ['whose change is in a stash entry that is not the newest one', (repoDir, file) => {
    const otherFile = writeRepoFile(repoDir, OTHER_SOURCE_NAME);
    git(repoDir, ['add', '-A']);
    git(repoDir, ['stash', '-q']);
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    git(repoDir, ['stash', '-q']);
    fs.writeFileSync(otherFile, EDITED_TEXT, 'utf8');
    git(repoDir, ['add', '-A']);
    git(repoDir, ['stash', '-q']);
  }],
  ['that was committed on a branch that was deleted afterwards', (repoDir, file) => {
    git(repoDir, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(file, EDITED_TEXT, 'utf8');
    commitAll(repoDir);
    git(repoDir, ['checkout', '-q', '-']);
    git(repoDir, ['branch', '-q', '-D', 'feature']);
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

// A symbolic link is a file that points to another file. An edit through the
// link changes the other file, and git reports no change for the link itself.
test('A tracked symbolic link whose target was edited through the link is still named', () => {
  const linkName = path.join('src', 'link.js');
  assertReminderNames(evaluateStop(({ logDir, cwdDir }) => {
    initRepo(cwdDir);
    const target = writeRepoFile(cwdDir, SOURCE_NAME);
    const link = path.join(cwdDir, linkName);
    fs.symlinkSync(path.basename(target), link);
    commitAll(cwdDir, Date.now() - FIRST_COMMIT_AGE_MS);
    fs.writeFileSync(link, EDITED_TEXT, 'utf8');
    recordEdits(logDir, [link]);
  }), linkName);
});

test('A tracked symbolic link whose target was edited through the link and then restored gets no reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    initRepo(cwdDir);
    const target = writeRepoFile(cwdDir, SOURCE_NAME);
    const link = path.join(cwdDir, 'src', 'link.js');
    fs.symlinkSync(path.basename(target), link);
    commitAll(cwdDir, Date.now() - FIRST_COMMIT_AGE_MS);
    recordEdits(logDir, [link]);
  }));
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

// ── Commit reminder counts the files of this session only ────────────────────
// Reported by a code review: the reminder counted every line of `git status`
// of the repository. A session that had committed all of its own files was
// blocked because of 5 unfinished files of the user. The reminder now asks git
// about each file that the edit log of the session names, and counts the files
// for which git reports a change. The files of these tests are text files, so
// no other reminder is due and "no commit reminder" means "no block".

console.log('\nCommit reminder counts the files of this session only');

function scenarioNamed(name) {
  return REMINDER_SCENARIOS.find(scenario => scenario.name === name);
}

const COMMIT_SCENARIO = scenarioNamed('commit');
// The reminder is due from this number of files.
const COMMIT_THRESHOLD = 5;

/** The names `<prefix>1.txt` to `<prefix><count>.txt`. */
function numberedNames(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}.txt`);
}

/**
 * Make repoDir a repository whose only commit holds sessionCount files for
 * the session and otherCount files that the edit log will not name.
 */
function repoWithSessionAndOtherFiles(repoDir, sessionCount, otherCount = 0) {
  const files = repoWithCommittedFiles(repoDir,
    [...numberedNames('session', sessionCount), ...numberedNames('other', otherCount)]);
  return { sessionFiles: files.slice(0, sessionCount), otherFiles: files.slice(sessionCount) };
}

function modifyFiles(files) {
  for (const file of files) fs.writeFileSync(file, EDITED_TEXT, 'utf8');
}

/** Write new files, which git does not track, below repoDir. Returns the full paths. */
function writeNewFiles(repoDir, names) {
  return names.map(name => writeRepoFile(repoDir, name, EDITED_TEXT));
}

function assertCommitReminder(result, count) {
  const expected = `Commit reminder: ${count} files with uncommitted changes, all edited in this session.`;
  assert.ok((result.reason || '').includes(expected),
    `Expected "${expected}", got: ${JSON.stringify(result)}`);
}

test('The commit reminder states the number of session files with uncommitted changes', () => {
  assertCommitReminder(evaluateStop(COMMIT_SCENARIO.arrange), 6);
});

test('The session committed its 5 files and the user has 5 modified files: no reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles, otherFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD, COMMIT_THRESHOLD);
    modifyFiles(sessionFiles);
    commitAll(cwdDir);
    modifyFiles(otherFiles);
    recordEdits(logDir, sessionFiles);
  }));
});

test('The session committed its 5 files and the user has 5 new files that git does not track: no reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD);
    modifyFiles(sessionFiles);
    commitAll(cwdDir);
    writeNewFiles(cwdDir, numberedNames('user-new', COMMIT_THRESHOLD));
    recordEdits(logDir, sessionFiles);
  }));
});

// `git status` prints one line for a whole new folder, so a count of status
// lines saw one file here and gave no reminder.
test('6 new session files in one new folder are counted as 6 files', () => {
  assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
    repoWithSessionAndOtherFiles(cwdDir, 1);
    recordEdits(logDir, writeNewFiles(cwdDir, numberedNames(path.join('new-folder', 'new'), 6)));
  }), 6);
});

test('New session files are counted when the git configuration of the user hides untracked files', () => {
  assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
    repoWithSessionAndOtherFiles(cwdDir, 1);
    git(cwdDir, ['config', 'status.showUntrackedFiles', 'no']);
    recordEdits(logDir, writeNewFiles(cwdDir, numberedNames('new', 6)));
  }), 6);
});

// Accepted limit: a file that was changed only through the Bash tool is not in
// the edit log, so it is not counted. Here 2 logged files and 4 files that the
// log does not name are changed: `git status` prints 6 lines, the count is 2.
test('5 logged files of which 3 are committed, and 4 changed files that the log does not name: no reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles, otherFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD, 4);
    modifyFiles(sessionFiles.slice(0, 3));
    commitAll(cwdDir);
    modifyFiles([...sessionFiles.slice(3), ...otherFiles]);
    recordEdits(logDir, sessionFiles);
  }));
});

test('7 logged files of which 2 are committed, and 4 changed files that the log does not name: the count is 5', () => {
  assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles, otherFiles } = repoWithSessionAndOtherFiles(cwdDir, 7, 4);
    modifyFiles(sessionFiles.slice(0, 2));
    commitAll(cwdDir);
    modifyFiles([...sessionFiles.slice(2), ...otherFiles]);
    recordEdits(logDir, sessionFiles);
  }), COMMIT_THRESHOLD);
});

test('Session files in a repository that is not the session folder are counted', () => {
  assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles } = repoWithSessionAndOtherFiles(path.join(cwdDir, 'nested-repo'), COMMIT_THRESHOLD);
    modifyFiles(sessionFiles);
    recordEdits(logDir, sessionFiles);
  }), COMMIT_THRESHOLD);
});

test('Session files that git ignores are not counted: they cannot be committed', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    initRepo(cwdDir);
    writeRepoFile(cwdDir, '.gitignore', 'ignored-folder/\n');
    commitAll(cwdDir, Date.now() - FIRST_COMMIT_AGE_MS);
    recordEdits(logDir, writeNewFiles(cwdDir, numberedNames(path.join('ignored-folder', 'new'), COMMIT_THRESHOLD)));
  }));
});

test('New files inside a subagent worktree folder are not counted', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    repoWithSessionAndOtherFiles(cwdDir, 1);
    const worktreeName = path.join('.claude', 'worktrees', path.basename(AGENT_WORKTREE));
    recordEdits(logDir, writeNewFiles(cwdDir, numberedNames(path.join(worktreeName, 'new'), 6)));
  }));
});

test('A file name with a space and a file name with a letter outside ASCII are counted', () => {
  assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
    const tracked = repoWithCommittedFiles(cwdDir, ['my notes.txt', ...numberedNames('session', 3)]);
    modifyFiles(tracked);
    recordEdits(logDir, [...tracked, ...writeNewFiles(cwdDir, ['café.txt'])]);
  }), COMMIT_THRESHOLD);
});

test('A tracked session file that was deleted after the edit is counted: the deletion is not committed', () => {
  assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD);
    modifyFiles(sessionFiles);
    fs.rmSync(sessionFiles[0]);
    recordEdits(logDir, sessionFiles);
  }), COMMIT_THRESHOLD);
});

test('A new session file that was deleted again is not counted', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD - 1);
    modifyFiles(sessionFiles);
    const [newFile] = writeNewFiles(cwdDir, ['new.txt']);
    fs.rmSync(newFile);
    recordEdits(logDir, [...sessionFiles, newFile]);
  }));
});

// git reads `[id]` in a file name as a pattern that matches `i.txt` and `d.txt`.
test('A committed session file whose name holds pattern characters is not counted for the files that the pattern matches', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const [patternFile, ...others] = repoWithCommittedFiles(cwdDir,
      ['[id].txt', 'i.txt', 'd.txt', ...numberedNames('session', COMMIT_THRESHOLD - 1)]);
    modifyFiles(others);
    recordEdits(logDir, [patternFile, ...others.slice(2)]);
  }));
});

// On a file system that ignores letter case (the default on macOS and
// Windows), git reports nothing for a name in another case than it stores.
// The hook asks the file system for the stored name first. On a file system
// that respects letter case, the recorded name is a file that does not exist.
test('A modified session file whose record differs in letter case from the tracked name is counted', () => {
  let ignoresCase;
  const result = evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD);
    modifyFiles(sessionFiles);
    const recorded = path.join(cwdDir, path.basename(sessionFiles[0]).toUpperCase());
    ignoresCase = fs.existsSync(recorded);
    recordEdits(logDir, [recorded, ...sessionFiles.slice(1)]);
  });
  if (ignoresCase) assertCommitReminder(result, COMMIT_THRESHOLD);
  else assertNoReminder(result);
});

// A symbolic link to the folder gives every file a second path.
test('A file that the log names under two paths is counted once', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD - 1);
    modifyFiles(sessionFiles);
    const linkToFolder = path.join(cwdDir, 'same-folder');
    fs.symlinkSync(cwdDir, linkToFolder);
    recordEdits(logDir,
      [...sessionFiles, ...sessionFiles.map(file => path.join(linkToFolder, path.basename(file)))]);
  }));
});

// Reported by a reviewer: the session edits 5 tracked files and then renames
// or deletes their folder. The logged paths no longer exist, but `git status`
// shows 5 changes that are not committed. The hook asks git from the nearest
// folder that still exists.
const OLD_FOLDER = path.join('src', 'old');
const FOLDER_CHANGES = [
  ['renamed with git mv', repoDir => git(repoDir, ['mv', OLD_FOLDER, path.join('src', 'new')])],
  ['renamed without git', repoDir => fs.renameSync(path.join(repoDir, OLD_FOLDER), path.join(repoDir, 'src', 'new'))],
  ['deleted', repoDir => fs.rmSync(path.join(repoDir, OLD_FOLDER), { recursive: true })],
  ['deleted together with its parent folder', repoDir => fs.rmSync(path.join(repoDir, 'src'), { recursive: true })],
];

for (const [label, changeFolder] of FOLDER_CHANGES) {
  test(`5 tracked session files whose folder was ${label} after the edit are counted`, () => {
    assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
      const files = repoWithCommittedFiles(cwdDir, numberedNames(path.join(OLD_FOLDER, 'session'), COMMIT_THRESHOLD));
      modifyFiles(files);
      changeFolder(cwdDir);
      recordEdits(logDir, files);
    }), COMMIT_THRESHOLD);
  });
}

test('Session files that never existed, in a folder that never existed, are not counted', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    repoWithSessionAndOtherFiles(cwdDir, 1);
    recordEdits(logDir, numberedNames(path.join(cwdDir, 'never', 'was', 'new'), COMMIT_THRESHOLD));
  }));
});

test('A file in a deleted folder that the log names under two paths is counted once', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const files = repoWithCommittedFiles(cwdDir, numberedNames(path.join(OLD_FOLDER, 'session'), COMMIT_THRESHOLD - 1));
    const linkToFolder = path.join(cwdDir, 'same-folder');
    fs.symlinkSync(cwdDir, linkToFolder);
    fs.rmSync(path.join(cwdDir, OLD_FOLDER), { recursive: true });
    recordEdits(logDir,
      [...files, ...files.map(file => path.join(linkToFolder, path.relative(cwdDir, file)))]);
  }));
});

// git fails in a folder that is not a repository. A failed git command is no
// proof of a change.
test('5 existing session files in a folder that is not a git repository: no reminder', () => {
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) =>
    recordEdits(logDir, writeNewFiles(cwdDir, numberedNames('new', COMMIT_THRESHOLD)))));
});

// The test process runs in another folder than the session folder of the payload.
test('A record with a relative path is resolved against the session folder', () => {
  assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD);
    modifyFiles(sessionFiles);
    recordEdits(logDir, sessionFiles.map(file => path.relative(cwdDir, file)));
  }), COMMIT_THRESHOLD);
});

// Reported by two reviewers: each git call has a time limit of 5 seconds, and
// the count had no limit of its own. With a git that hangs, 6 logged files
// blocked the stop for 30 seconds. The fake git of this test answers its first
// calls (the first two after one second each) and hangs on every later call.
const SLOW_GIT_CALLS = 2;
const ANSWERED_GIT_CALLS = COMMIT_THRESHOLD;
const LOGGED_FILES_FOR_SLOW_GIT = 9;
// The whole count may take 5 seconds. The test states the value itself, so
// that a longer limit in the hook fails the test. The margin is the time
// that the hook may need outside its git calls.
const COUNT_TIME_LIMIT_MS = 5000;
const TIME_LIMIT_MARGIN_MS = 1000;

/** The full path of the git program that the test process runs. */
function realGitPath() {
  const found = process.env.PATH.split(path.delimiter)
    .map(folder => path.join(folder, 'git'))
    .find(candidate => fs.existsSync(candidate));
  assert.ok(found, 'Expected a program named git in PATH');
  return found;
}

/** Write a program named `git` into binDir that counts its calls in a file. */
function writeFakeGit(binDir) {
  const callsFile = path.join(binDir, 'calls');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'git'), [
    '#!/bin/sh',
    `echo call >> '${callsFile}'`,
    `calls=$(wc -l < '${callsFile}')`,
    `if [ "$calls" -le ${SLOW_GIT_CALLS} ]; then sleep 1; fi`,
    `if [ "$calls" -le ${ANSWERED_GIT_CALLS} ]; then exec '${realGitPath()}' "$@"; fi`,
    'exec sleep 60',
    '',
  ].join('\n'), { mode: 0o755 });
}

test('With a git that hangs, the count stops at its time limit and uses the files counted so far', () => {
  if (process.platform === 'win32') {
    console.log('    (not run on Windows: the fake git is a shell script)');
    return;
  }
  const pathBefore = process.env.PATH;
  const allowedMs = COUNT_TIME_LIMIT_MS + TIME_LIMIT_MARGIN_MS;
  let startMs;
  let elapsedMs;
  try {
    assertCommitReminder(evaluateStop(({ logDir, cwdDir }) => {
      const { sessionFiles } = repoWithSessionAndOtherFiles(cwdDir, LOGGED_FILES_FOR_SLOW_GIT);
      modifyFiles(sessionFiles);
      recordEdits(logDir, sessionFiles);
      const binDir = path.join(path.dirname(logDir), 'fake-bin');
      writeFakeGit(binDir);
      process.env.PATH = binDir + path.delimiter + pathBefore;
      startMs = Date.now();
    }, () => { elapsedMs = Date.now() - startMs; }), ANSWERED_GIT_CALLS);
  } finally {
    process.env.PATH = pathBefore;
  }
  assert.ok(elapsedMs < allowedMs, `Expected the stop to take less than ${allowedMs} ms, it took ${elapsedMs} ms`);
});

// See the test of the restored file above: a new modification time makes a
// plain `git status` write the index again.
test('The count of 5 session files does not rewrite the index of the repository', () => {
  let indexFile;
  let indexBefore;
  assertNoReminder(evaluateStop(({ logDir, cwdDir }) => {
    const { sessionFiles } = repoWithSessionAndOtherFiles(cwdDir, COMMIT_THRESHOLD);
    for (const file of sessionFiles) setFileAge(file, EDIT_AGE_MINUTES * MINUTE_MS);
    recordEdits(logDir, sessionFiles);
    indexFile = path.join(cwdDir, '.git', 'index');
    indexBefore = fs.readFileSync(indexFile);
  }, () => assert.ok(indexBefore.equals(fs.readFileSync(indexFile)), 'Expected the index file to be unchanged')));
});

// ── No commit reminder while a subagent is still running ─────────────────────
// Seen in a real session: six stops were blocked with a commit reminder for
// files that subagents were still editing. Claude Code lists the unfinished
// background work of the session in the field `background_tasks` of the stop
// payload. The entries below copy a payload that was recorded with Claude
// Code 2.1.289.

console.log('\nNo commit reminder while a subagent is still running');

const RUNNING_SUBAGENT = {
  id: 'af50c1d6fb184d121',
  type: 'subagent',
  status: 'running',
  description: 'Write file and sleep task',
  agent_type: 'general-purpose',
};
const RUNNING_SHELL_COMMAND = {
  id: 'bwexoicz6',
  type: 'shell',
  status: 'running',
  description: 'Wait for 40 seconds',
  command: 'sleep 40',
};

/** Evaluate a stop for which `arrange` makes reminders due, with the given field value. */
function evaluateStopWithBackgroundTasks(arrange, backgroundTasks) {
  return evaluateStop(context => {
    arrange(context);
    return { background_tasks: backgroundTasks };
  });
}

const TASKS_THAT_POSTPONE_THE_REMINDER = [
  ['a running subagent', [RUNNING_SUBAGENT]],
  ['a running subagent after a running shell command', [RUNNING_SHELL_COMMAND, RUNNING_SUBAGENT]],
  ['a running subagent after an entry that is null', [null, RUNNING_SUBAGENT]],
];

for (const [label, backgroundTasks] of TASKS_THAT_POSTPONE_THE_REMINDER) {
  test(`With ${label}, the commit scenario gives no reminder`, () => {
    assertNoReminder(evaluateStopWithBackgroundTasks(COMMIT_SCENARIO.arrange, backgroundTasks));
  });
}

// A running subagent must remove the commit reminder and nothing else: not
// another reminder that is due alone, and no line of a block that holds
// every reminder.
const OTHER_SCENARIOS = REMINDER_SCENARIOS.filter(scenario => scenario !== COMMIT_SCENARIO);
const SESSION_SUMMARY = 'Session summary:';
const OTHER_BLOCK_TEXTS = [...OTHER_SCENARIOS.map(scenario => scenario.text), SESSION_SUMMARY];

for (const scenario of OTHER_SCENARIOS) {
  test(`A running subagent does not remove the "${scenario.name}" reminder that is due alone`, () => {
    const reason = evaluateStopWithBackgroundTasks(scenario.arrange, [RUNNING_SUBAGENT]).reason || '';
    assert.ok(reason.includes(scenario.text), `Expected "${scenario.text}", got: ${reason}`);
  });
}

/**
 * Make every reminder of the hook due at one stop, with the session summary
 * line. The two scenarios that write only files run first, because the
 * commit scenario writes the edit log again.
 */
function arrangeEveryReminder(context) {
  scenarioNamed('state-md').arrange(context);
  scenarioNamed('session-log-size').arrange(context);
  COMMIT_SCENARIO.arrange(context);
  // Two source edits later than state.md, with no test edit, and one skill file.
  fs.appendFileSync(path.join(context.logDir, 'edit-log.txt'),
    ['src/a.js', 'src/b.js', SIGNIFICANT_FILE].map(file => editLogLine(TEST_SESSION_ID, file)).join(''), 'utf8');
  fs.writeFileSync(context.hook.statsFile(TEST_SESSION_ID), JSON.stringify({
    skillInvocations: { 'superpowers-orchestrator:executing-plans': 1 },
    totalSkillCalls: 1,
  }), 'utf8');
}

function assertBlockTexts(reason, expectedTexts, missingTexts = []) {
  for (const text of expectedTexts) assert.ok(reason.includes(text), `Expected "${text}", got: ${reason}`);
  for (const text of missingTexts) assert.ok(!reason.includes(text), `Expected no "${text}", got: ${reason}`);
}

test('Without a running subagent, the scenario with every reminder gives every reminder', () => {
  assertBlockTexts(evaluateStop(arrangeEveryReminder).reason || '', [COMMIT_SCENARIO.text, ...OTHER_BLOCK_TEXTS]);
});

test('A running subagent removes the commit reminder and no other line of the block', () => {
  assertBlockTexts(evaluateStopWithBackgroundTasks(arrangeEveryReminder, [RUNNING_SUBAGENT]).reason || '',
    OTHER_BLOCK_TEXTS, [COMMIT_SCENARIO.text]);
});

test('With the commit reminder switched off, a running subagent removes no line of the block', () => {
  const result = withRemindersOff(COMMIT_SCENARIO.name,
    () => evaluateStopWithBackgroundTasks(arrangeEveryReminder, [RUNNING_SUBAGENT]));
  assertBlockTexts(result.reason || '', OTHER_BLOCK_TEXTS, [COMMIT_SCENARIO.text]);
});

test('The reminder is postponed, not removed: the next stop without a running subagent gives it', () => {
  assertCommitReminder(evaluateStop(context => {
    COMMIT_SCENARIO.arrange(context);
    assertNoReminder(context.stop(TEST_SESSION_ID, { background_tasks: [RUNNING_SUBAGENT] }));
    return { background_tasks: [] };
  }), 6);
});

// The documentation of Claude Code does not list the status values, so every other value
// must leave the reminder as it is without the field.
const VALUES_THAT_KEEP_THE_REMINDER = [
  ...['completed', 'failed', 'pending', 'RUNNING', ''].map(status =>
    [`a subagent with the status "${status}"`, [{ ...RUNNING_SUBAGENT, status }]]),
  ['a subagent without a status', [{ id: RUNNING_SUBAGENT.id, type: RUNNING_SUBAGENT.type }]],
  ['a running task that is not a subagent', [RUNNING_SHELL_COMMAND]],
  ['an entry without a type', [{ status: 'running' }]],
  ['entries that are not objects', [null, 'subagent', 7]],
  ['one task object instead of a list', RUNNING_SUBAGENT],
  ['a text instead of a list', 'running'],
  ['a number instead of a list', 1],
  ['null', null],
];

for (const [label, backgroundTasks] of VALUES_THAT_KEEP_THE_REMINDER) {
  test(`With ${label} in background_tasks, the commit reminder is given`, () => {
    assertCommitReminder(evaluateStopWithBackgroundTasks(COMMIT_SCENARIO.arrange, backgroundTasks), 6);
  });
}

// The tests above call the function that evaluates a payload. This test runs
// the hook as Claude Code runs it, so it also covers the code that reads the
// payload: JSON on standard input, the result on standard output. The payload
// comes from a file, because /dev/stdin does not exist in Git Bash on Windows.
function runHookAsProcess(homeDir, payload) {
  const payloadFile = path.join(homeDir, 'payload.json');
  fs.writeFileSync(payloadFile, JSON.stringify(payload), 'utf8');
  const payloadInput = fs.openSync(payloadFile, 'r');
  try {
    const result = spawnSync(process.execPath, [HOOK_MODULE_PATH], {
      stdio: [payloadInput, 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });
    assert.strictEqual(result.status, 0, `The hook ended with status ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout);
  } finally {
    fs.closeSync(payloadInput);
  }
}

test('Run as a process, the hook reads background_tasks from the payload on standard input', () => {
  const { homeDir, cwdDir, logDir } = makeTempDirs();
  try {
    COMMIT_SCENARIO.arrange({ logDir, cwdDir });
    const payload = { cwd: cwdDir, session_id: TEST_SESSION_ID };
    assertNoReminder(runHookAsProcess(homeDir, { ...payload, background_tasks: [RUNNING_SUBAGENT] }));
    // The same payload without the field blocks, so the empty result above
    // comes from the field.
    assertCommitReminder(runHookAsProcess(homeDir, payload), 6);
  } finally {
    cleanup(homeDir, cwdDir);
  }
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
