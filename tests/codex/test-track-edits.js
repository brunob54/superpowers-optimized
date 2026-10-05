#!/usr/bin/env node
/**
 * Unit tests — the save marker: hooks/track-edits.js, hooks/stop-reminders.js
 * and the save command of skills/context-management/SKILL.md
 *
 * The save marker is a file that holds the time of a session's last `[saved]`
 * entry in session-log.md. Each test runs the real hook scripts, or the real
 * command from the skill, as separate processes with a temporary HOME folder.
 * A test gives a payload on standard input and checks standard output and the
 * files under the temporary HOME.
 *
 * Run: node tests/codex/test-track-edits.js
 * No dependencies beyond Node.js stdlib and bash.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_DIR = path.join(REPO_ROOT, 'hooks');
const TRACK_EDITS = path.join(HOOKS_DIR, 'track-edits.js');
const TRACK_STATS = path.join(HOOKS_DIR, 'track-session-stats.js');
const STOP_REMINDERS = path.join(HOOKS_DIR, 'stop-reminders.js');
const SAVE_MARKER = path.join(HOOKS_DIR, 'save-marker.js');

// The stop hook reads this variable. A user who sets it in the settings.json
// "env" block also passes it to this file; every test expects the default.
delete process.env.SUPERPOWERS_STOP_REMINDERS_OFF;
const SKILL_FILE = path.join(REPO_ROOT, 'skills', 'context-management', 'SKILL.md');

const SESSION_A = 'session-a-111';
const SESSION_B = 'session-b-222';
const HOSTILE_ID = '../../evil';
// Written by hand, not computed by save-marker.js: each of the six characters
// `../../` becomes `_`.
const HOSTILE_MARKER_NAME = 'last-saved-entry-______evil.txt';
// Longer than the 64 characters that a file name keeps of a session id.
const LONG_ID = 'long-id-'.repeat(13).slice(0, 100);
const SESSION_ID_VARIABLE = 'CLAUDE_CODE_SESSION_ID';
const SESSION_LOG = 'session-log.md';
const SIGNIFICANT_FILE = 'skills/x/SKILL.md';
const DECISION_LOG = 'Decision log';
const EMPTY_HOOK_OUTPUT = '{}';
const SAVED_HEADING = '## 2026-09-20 10:00 [saved]\nGoal: one\n';
const OLDER_SAVED_HEADING = '## 2026-01-01 09:00 [saved]\nGoal: zero\n';

// realpathSync: on macOS the temporary folder is reached through a symbolic link.
const WORK_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'save-marker-')));
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

/** A new temporary HOME with a work folder inside it. */
function makeHome() {
  const homeDir = fs.mkdtempSync(path.join(WORK_ROOT, 'home-'));
  const cwdDir = path.join(homeDir, 'work');
  fs.mkdirSync(cwdDir);
  return { homeDir, cwdDir };
}

/** The environment of a child process whose HOME is homeDir. */
function envWithHome(homeDir, extra = {}) {
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, ...extra };
  if (!(SESSION_ID_VARIABLE in extra)) delete env[SESSION_ID_VARIABLE];
  return env;
}

/**
 * The value of a JavaScript expression in a process with this HOME. Inside the
 * expression, `m` is the exports of modulePath and `id` is sessionId.
 */
function evaluateInHome(homeDir, modulePath, sessionId, expression) {
  const script =
    `const m = require(${JSON.stringify(modulePath)});` +
    `const id = ${JSON.stringify(sessionId === undefined ? null : sessionId)};` +
    `console.log(JSON.stringify(${expression}));`;
  const result = spawnSync(process.execPath, ['-e', script], { env: envWithHome(homeDir), encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${path.basename(modulePath)} did not load: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** The exports of hooks/save-marker.js as a process with this HOME sees them. */
function markerPaths(homeDir, sessionId) {
  return evaluateInHome(homeDir, SAVE_MARKER, sessionId,
    '{ logDir: m.LOG_DIR, marker: m.markerFile(id), guard: m.guardFile(id), command: m.MARKER_COMMAND }');
}

function runHook(script, payload, homeDir) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    env: envWithHome(homeDir),
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, `${path.basename(script)} exited with ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function trackEdit(homeDir, cwdDir, sessionId, toolName, filePath, toolInput, payloadExtra = {}) {
  const output = runHook(TRACK_EDITS, {
    tool_name: toolName,
    tool_input: { file_path: filePath, ...toolInput },
    cwd: cwdDir,
    session_id: sessionId,
    ...payloadExtra,
  }, homeDir);
  assert.deepStrictEqual(output, JSON.parse(EMPTY_HOOK_OUTPUT), 'track-edits must never block');
}

function stop(homeDir, cwdDir, sessionId) {
  return runHook(STOP_REMINDERS, { cwd: cwdDir, session_id: sessionId }, homeDir);
}

/** Run a shell command in cwdDir. sessionId undefined leaves the variable unset. */
function runBash(command, homeDir, cwdDir, sessionId) {
  const sessionEnv = sessionId === undefined ? {} : { [SESSION_ID_VARIABLE]: sessionId };
  const result = spawnSync('bash', ['-c', command], {
    cwd: cwdDir, env: envWithHome(homeDir, sessionEnv), encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, `The command failed: ${result.stderr}`);
}

/** Every file under dir, as absolute paths. */
function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

// ── Two sessions ─────────────────────────────────────────────────────────────

console.log('\nSave marker: two sessions');

test("T1: a save by session B does not remove session A's decision-log block", () => {
  const { homeDir, cwdDir } = makeHome();
  trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  trackEdit(homeDir, cwdDir, SESSION_B, 'Write', SESSION_LOG, { content: SAVED_HEADING });
  const result = stop(homeDir, cwdDir, SESSION_A);
  assert.ok((result.reason || '').includes(DECISION_LOG),
    `Expected the decision-log block for session A, got: ${JSON.stringify(result)}`);
});

test("T1b: a save by session A removes session A's decision-log block", () => {
  const { homeDir, cwdDir } = makeHome();
  trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  trackEdit(homeDir, cwdDir, SESSION_A, 'Write', SESSION_LOG, { content: SAVED_HEADING });
  const result = stop(homeDir, cwdDir, SESSION_A);
  assert.ok(!(result.reason || '').includes(DECISION_LOG),
    `Expected no decision-log block, got: ${JSON.stringify(result)}`);
});

// ── A hostile session id ─────────────────────────────────────────────────────

console.log('\nSave marker: a session id that holds path separators');

test('T5: the id "../../evil" creates no file outside the log folder', () => {
  const { homeDir, cwdDir } = makeHome();
  const { logDir, marker, guard, command } = markerPaths(homeDir, HOSTILE_ID);

  trackEdit(homeDir, cwdDir, HOSTILE_ID, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  assert.strictEqual(stop(homeDir, cwdDir, HOSTILE_ID).decision, 'block', 'Expected a block, which writes the guard');
  trackEdit(homeDir, cwdDir, HOSTILE_ID, 'Write', SESSION_LOG, { content: SAVED_HEADING });
  runBash(command, homeDir, cwdDir, HOSTILE_ID);

  assert.strictEqual(path.basename(marker), HOSTILE_MARKER_NAME);
  for (const file of [marker, guard]) {
    assert.strictEqual(path.dirname(file), logDir, `${file} must be directly inside the log folder`);
    assert.ok(fs.existsSync(file), `Expected ${file} to exist`);
  }
  const outside = listFiles(WORK_ROOT).filter(file =>
    path.basename(file).includes('evil') && path.dirname(file) !== logDir);
  assert.deepStrictEqual(outside, [], 'No file for this id may exist outside the log folder');
  assert.deepStrictEqual(listFiles(homeDir).filter(file => !file.startsWith(logDir + path.sep)), [],
    'The temporary HOME must hold no file outside the log folder');
});

// ── track-edits.js: which tool calls move the marker ─────────────────────────

console.log('\ntrack-edits.js: tool calls that move the save marker');

const MARKER_CASES = [
  ['T8a: an Edit that adds a [saved] heading moves the marker', 'Edit',
    { old_string: OLDER_SAVED_HEADING, new_string: OLDER_SAVED_HEADING + SAVED_HEADING }, true],
  ['T8b: an Edit that only trims an old entry does not move the marker', 'Edit',
    { old_string: OLDER_SAVED_HEADING + SAVED_HEADING, new_string: SAVED_HEADING }, false],
  ['T8c: an Edit that changes the text of one entry does not move the marker', 'Edit',
    { old_string: SAVED_HEADING, new_string: SAVED_HEADING.replace('one', 'two') }, false],
  ['T8d: an Edit without [saved] does not move the marker', 'Edit',
    { old_string: 'Goal: one', new_string: 'Goal: two' }, false],
  ['T8e: an Edit that names [saved] outside a heading does not move the marker', 'Edit',
    { old_string: 'Goal: one', new_string: 'Goal: explain the [saved] tag' }, false],
  ['T8o: an Edit that adds a heading without the tag does not move the marker', 'Edit',
    { old_string: OLDER_SAVED_HEADING, new_string: OLDER_SAVED_HEADING + '## 2026-09-20 decisions\n' }, false],
  ['T8j: an Edit that adds a [saved] heading after three spaces moves the marker', 'Edit',
    { old_string: OLDER_SAVED_HEADING, new_string: OLDER_SAVED_HEADING + '   ' + SAVED_HEADING }, true],
  ['T8k: an Edit that adds a [saved] line after four spaces (a code block) does not move the marker', 'Edit',
    { old_string: OLDER_SAVED_HEADING, new_string: OLDER_SAVED_HEADING + '    ' + SAVED_HEADING }, false],
  ['T8f: a Write with a [saved] heading moves the marker', 'Write',
    { content: SAVED_HEADING }, true],
  ['T8g: a Write without [saved] does not move the marker', 'Write',
    { content: 'Goal: one\n' }, false],
];

for (const [label, toolName, toolInput, expectMarker] of MARKER_CASES) {
  test(label, () => {
    const { homeDir, cwdDir } = makeHome();
    const session = markerPaths(homeDir, SESSION_A);
    const shared = markerPaths(homeDir);
    trackEdit(homeDir, cwdDir, SESSION_A, toolName, SESSION_LOG, toolInput);
    assert.strictEqual(fs.existsSync(session.marker), expectMarker,
      `Marker of the session: expected exists=${expectMarker}`);
    assert.strictEqual(fs.existsSync(shared.marker), false,
      'A payload with a session id must not write the shared marker');
  });
}

// The session log is a file whose name starts with `session-log`, in upper or
// lower case. The name of a folder does not count.
const FILE_NAME_CASES = [
  ['T8h: a [saved] Edit of notes.md does not move the marker', 'notes.md', false],
  ['T8l: a [saved] Edit of session-notes.md does not move the marker', 'session-notes.md', false],
  ['T8m: a [saved] Edit of Session-Log.md moves the marker', 'Session-Log.md', true],
  ['T8n: a [saved] Edit of notes.md in a folder named session-log does not move the marker',
    '/x/session-log/notes.md', false],
];

for (const [label, filePath, expectMarker] of FILE_NAME_CASES) {
  test(label, () => {
    const { homeDir, cwdDir } = makeHome();
    trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', filePath, { old_string: '', new_string: SAVED_HEADING });
    assert.strictEqual(fs.existsSync(markerPaths(homeDir, SESSION_A).marker), expectMarker);
  });
}

test('T8i: a payload without a session id writes the shared marker', () => {
  const { homeDir, cwdDir } = makeHome();
  trackEdit(homeDir, cwdDir, undefined, 'Write', SESSION_LOG, { content: SAVED_HEADING });
  assert.ok(fs.existsSync(markerPaths(homeDir).marker), 'Expected the shared marker');
});

// ── The save command of the context-management skill ─────────────────────────

console.log('\ncontext-management skill: the save command');

const HEREDOC_OPENER = /<<-?\s*(\S+)/;
const BACKTICK_PROOF = 'backtick-command-ran';
const ENTRY_TEXT = [
  '',
  '## 2026-09-20 10:00 [saved]',
  `Goal: keep "double" and 'single' quotes, \`touch ${BACKTICK_PROOF}\` and $HOME literal`,
].join('\n');

/** The bash code blocks of the skill file. */
function skillBashBlocks() {
  const text = fs.readFileSync(SKILL_FILE, 'utf8');
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map(match => match[1].split('\n').map(line => line.replace(/^ {3}/, '')).join('\n'));
}

/** The one block that appends the entry through a here-document. */
function skillSaveCommand() {
  const blocks = skillBashBlocks().filter(block => HEREDOC_OPENER.test(block));
  assert.strictEqual(blocks.length, 1, `Expected one here-document command in the skill, found ${blocks.length}`);
  return blocks[0];
}

/** The save command with the example entry replaced by entryText. */
function saveCommandWithEntry(entryText) {
  const lines = skillSaveCommand().trimEnd().split('\n');
  const delimiter = lines[0].match(HEREDOC_OPENER)[1].replace(/['"]/g, '');
  assert.strictEqual(lines[lines.length - 1], delimiter, 'The command must end with the delimiter line');
  return [lines[0], entryText, delimiter, ''].join('\n');
}

function runSaveCommand(sessionId, existingLog = '', entryText = ENTRY_TEXT) {
  const { homeDir, cwdDir } = makeHome();
  const logFile = path.join(cwdDir, SESSION_LOG);
  if (existingLog) fs.writeFileSync(logFile, existingLog);
  runBash(saveCommandWithEntry(entryText), homeDir, cwdDir, sessionId);
  return { homeDir, cwdDir, logFile };
}

test('T9a: the entry text arrives literal and no backtick command runs', () => {
  const { cwdDir, logFile } = runSaveCommand(SESSION_A);
  assert.strictEqual(fs.readFileSync(logFile, 'utf8'), ENTRY_TEXT + '\n');
  assert.strictEqual(fs.existsSync(path.join(cwdDir, BACKTICK_PROOF)), false, 'The backtick command ran');
});

// A line equal to a common delimiter word, followed by a command line. With
// the delimiter `ENTRY`, the here-document ended at that line and the shell
// ran the command.
const DELIMITER_PROOF = 'delimiter-command-ran';
const ENTRY_WITH_DELIMITER_WORD = [ENTRY_TEXT, 'ENTRY', `touch ${DELIMITER_PROOF}`].join('\n');

test('T9f: an entry that holds the line ENTRY arrives whole and none of its lines runs', () => {
  const { cwdDir, logFile } = runSaveCommand(SESSION_A, '', ENTRY_WITH_DELIMITER_WORD);
  assert.strictEqual(fs.existsSync(path.join(cwdDir, DELIMITER_PROOF)), false, 'A line of the entry ran as a command');
  assert.strictEqual(fs.readFileSync(logFile, 'utf8'), ENTRY_WITH_DELIMITER_WORD + '\n');
});

test('T9b: the command appends to an existing session log', () => {
  const { logFile } = runSaveCommand(SESSION_A, OLDER_SAVED_HEADING);
  assert.strictEqual(fs.readFileSync(logFile, 'utf8'), OLDER_SAVED_HEADING + ENTRY_TEXT + '\n');
});

test('T9c: with the session id set, the command writes the marker of that session', () => {
  const { homeDir } = runSaveCommand(SESSION_A);
  assert.ok(fs.existsSync(markerPaths(homeDir, SESSION_A).marker), 'Expected the marker of the session');
  assert.strictEqual(fs.existsSync(markerPaths(homeDir).marker), false, 'The shared marker must not be written');
});

test('T9d: with the session id not set, the command writes the shared marker', () => {
  const { homeDir } = runSaveCommand(undefined);
  const { logDir, marker } = markerPaths(homeDir);
  assert.ok(fs.existsSync(marker), 'Expected the shared marker');
  assert.deepStrictEqual(fs.readdirSync(logDir), [path.basename(marker)]);
});

/** After a significant edit, run command as the session; the stop hook must then not ask for a decision-log entry. */
function assertCommandClearsBlock(sessionId, commandOf) {
  const { homeDir, cwdDir } = makeHome();
  trackEdit(homeDir, cwdDir, sessionId, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  runBash(commandOf(homeDir), homeDir, cwdDir, sessionId);
  const result = stop(homeDir, cwdDir, sessionId);
  assert.ok(!(result.reason || '').includes(DECISION_LOG),
    `Expected no decision-log block, got: ${JSON.stringify(result)}`);
}

test('T9e: the marker written by the command clears the decision-log block', () => {
  assertCommandClearsBlock(SESSION_A, homeDir => markerPaths(homeDir).command);
});

// The hooks and the command must cut a long id at the same length. If they
// do not, they name two different files, and a save never clears the block.
test('T9g: for an id of 100 characters, the save command of the skill clears the decision-log block', () => {
  assertCommandClearsBlock(LONG_ID, () => saveCommandWithEntry(ENTRY_TEXT));
});

test('T10: the here-document delimiter of the save command is quoted', () => {
  const delimiter = skillSaveCommand().match(HEREDOC_OPENER)[1];
  assert.ok(/^'[A-Za-z0-9_]+'$/.test(delimiter), `Expected a delimiter in single quotes, got: ${delimiter}`);
});

test('The skill holds the marker command of save-marker.js, in step 4 and alone in step 5', () => {
  const { command } = markerPaths(makeHome().homeDir);
  const blocks = skillBashBlocks();
  assert.ok(skillSaveCommand().split('\n')[0].endsWith(`&& ${command}`),
    'The save command must run the marker command after &&');
  assert.strictEqual(blocks.filter(block => block.trim() === command).length, 1,
    'Expected one block that holds the marker command alone');
});

// ── The edit log of one session (row 70) ─────────────────────────────────────

console.log('\nEdit log: one file per session');

const SHARED_EDIT_LOG = 'edit-log.txt';
const PLAIN_FILE = 'notes.txt';
// More lines than the old shared limit of 500, and more than 50 KB.
const MANY_LINES = 700;

function editLogLine(sessionId, filePath) {
  return `${new Date().toISOString()} | ${sessionId} | Edit | ${filePath}\n`;
}

/** Write lines into the shared edit log, which older plugin versions wrote. */
function seedSharedEditLog(homeDir, lines) {
  const { logDir } = markerPaths(homeDir);
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, SHARED_EDIT_LOG), lines.join(''));
}

function expectDecisionLogBlock(result, who) {
  assert.ok((result.reason || '').includes(DECISION_LOG),
    `Expected the decision-log block for ${who}, got: ${JSON.stringify(result)}`);
}

test("T11: an edit by session A removes no line of session B's edits", () => {
  const { homeDir, cwdDir } = makeHome();
  const filler = path.join(cwdDir, 'a-long-folder-name-'.repeat(5), PLAIN_FILE);
  seedSharedEditLog(homeDir, [
    editLogLine(SESSION_B, path.join(cwdDir, SIGNIFICANT_FILE)),
    ...Array.from({ length: MANY_LINES }, () => editLogLine(SESSION_B, filler)),
  ]);
  trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', PLAIN_FILE, { old_string: 'a', new_string: 'b' });
  expectDecisionLogBlock(stop(homeDir, cwdDir, SESSION_B), 'session B');
});

test('T12: a session that was open during the plugin update keeps its earlier edits', () => {
  const { homeDir, cwdDir } = makeHome();
  seedSharedEditLog(homeDir, [editLogLine(SESSION_A, path.join(cwdDir, SIGNIFICANT_FILE))]);
  trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', PLAIN_FILE, { old_string: 'a', new_string: 'b' });
  expectDecisionLogBlock(stop(homeDir, cwdDir, SESSION_A), 'session A');
});

test("T12b: an edit keeps every earlier line of the session's own log", () => {
  const { homeDir, cwdDir } = makeHome();
  const ownLog = evaluateInHome(homeDir, SAVE_MARKER, SESSION_A, 'm.editLogFile(id)');
  const filler = path.join(cwdDir, 'a-long-folder-name-'.repeat(5), PLAIN_FILE);
  fs.mkdirSync(path.dirname(ownLog), { recursive: true });
  fs.writeFileSync(ownLog, [
    editLogLine(SESSION_A, path.join(cwdDir, SIGNIFICANT_FILE)),
    ...Array.from({ length: MANY_LINES }, () => editLogLine(SESSION_A, filler)),
  ].join(''));
  trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', PLAIN_FILE, { old_string: 'a', new_string: 'b' });
  expectDecisionLogBlock(stop(homeDir, cwdDir, SESSION_A), 'session A');
});

test("T12c: a line of session B in the shared log gives session A no block", () => {
  const { homeDir, cwdDir } = makeHome();
  seedSharedEditLog(homeDir, [editLogLine(SESSION_B, path.join(cwdDir, SIGNIFICANT_FILE))]);
  assert.deepStrictEqual(stop(homeDir, cwdDir, SESSION_A), JSON.parse(EMPTY_HOOK_OUTPUT));
  expectDecisionLogBlock(stop(homeDir, cwdDir, SESSION_B), 'session B');
});

test('T13: an edit with a session id goes into the file of that session only', () => {
  const { homeDir, cwdDir } = makeHome();
  trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  const ownLog = evaluateInHome(homeDir, SAVE_MARKER, SESSION_A, 'm.editLogFile(id)');
  const sharedLog = evaluateInHome(homeDir, SAVE_MARKER, undefined, 'm.editLogFile(id)');
  assert.strictEqual(path.basename(sharedLog), SHARED_EDIT_LOG);
  assert.strictEqual(fs.readFileSync(ownLog, 'utf8').split('\n').filter(Boolean).length, 1);
  assert.ok(!fs.existsSync(sharedLog), 'The shared edit log must not be written');
});

test('T14: an edit without a session id is written to the shared log and counted once', () => {
  const { homeDir, cwdDir } = makeHome();
  trackEdit(homeDir, cwdDir, undefined, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  const { logDir } = markerPaths(homeDir);
  assert.deepStrictEqual(fs.readdirSync(logDir).filter(name => name.startsWith('edit-log')), [SHARED_EDIT_LOG]);
  assert.strictEqual(evaluateInHome(homeDir, STOP_REMINDERS, undefined, 'm.getRecentEdits(id).length'), 1);
});

// ── Edits inside the session scratchpad are not logged ───────────────────────

console.log('\nEdits inside the session scratchpad');

// Measured on 2026-10-03 (Claude Code 2.1.286, macOS, interactive session): the
// PostToolUse input of a Write carries `scratchpad_dir` without a trailing
// slash, in the /private/tmp form, for the main session and for a subagent
// alike; `file_path` is absolute in the same form. A headless `claude -p`
// session has no scratchpad and no such field.
// A scratch file must not be logged, because the stop hook's test-first
// reminder (the "TDD reminder"; TDD is test-driven development) names every
// logged source file that has no test change next to it.
const SCRATCHPAD_FIELD = 'scratchpad_dir';
const SCRATCH_FILE = 'mutate.js';
const TDD_REMINDER = 'TDD reminder';
// Values that the documented input never holds in this field. Each one must
// leave the hook logging as if the field were absent.
const NON_STRING_FIELD_VALUES = [42, { a: 1 }, ['/x'], true, null];

/** The number of lines in the edit log of this session (0 when there is none). */
function ownEditLogLines(homeDir, sessionId) {
  const ownLog = evaluateInHome(homeDir, SAVE_MARKER, sessionId, 'm.editLogFile(id)');
  if (!fs.existsSync(ownLog)) return 0;
  return fs.readFileSync(ownLog, 'utf8').split('\n').filter(Boolean).length;
}

/** A Write of a source file at filePath, with the scratchpad named in the payload. */
function writeWithScratchpad(homeDir, cwdDir, filePath, scratchpadDir) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '// probe\n');
  const payloadExtra = scratchpadDir === undefined ? {} : { [SCRATCHPAD_FIELD]: scratchpadDir };
  trackEdit(homeDir, cwdDir, SESSION_A, 'Write', filePath, { content: '// probe\n' }, payloadExtra);
}

/** A session scratchpad folder and a sibling folder, both outside the work folder. */
function makeScratchpad(homeDir) {
  const scratchpadDir = path.join(homeDir, 'tmp', 'scratchpad');
  const siblingDir = `${scratchpadDir}-2`;
  fs.mkdirSync(scratchpadDir, { recursive: true });
  fs.mkdirSync(siblingDir, { recursive: true });
  return { scratchpadDir, siblingDir };
}

test('T19: a Write of a source file inside the scratchpad is not logged and gives no TDD reminder', () => {
  const { homeDir, cwdDir } = makeHome();
  const { scratchpadDir } = makeScratchpad(homeDir);
  writeWithScratchpad(homeDir, cwdDir, path.join(scratchpadDir, SCRATCH_FILE), scratchpadDir);
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 0, 'The scratch file must not be logged');
  const reason = stop(homeDir, cwdDir, SESSION_A).reason || '';
  assert.ok(!reason.includes(TDD_REMINDER), `Expected no TDD reminder, got: ${reason}`);
});

test('T19b: a scratchpad path with a trailing separator is still recognised', () => {
  const { homeDir, cwdDir } = makeHome();
  const { scratchpadDir } = makeScratchpad(homeDir);
  writeWithScratchpad(homeDir, cwdDir, path.join(scratchpadDir, 'sub', SCRATCH_FILE), scratchpadDir + path.sep);
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 0, 'The scratch file must not be logged');
});

test('T20: without the scratchpad field, a source file outside the work folder is logged as before', () => {
  const { homeDir, cwdDir } = makeHome();
  const { scratchpadDir } = makeScratchpad(homeDir);
  writeWithScratchpad(homeDir, cwdDir, path.join(scratchpadDir, SCRATCH_FILE), undefined);
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 1);
  const reason = stop(homeDir, cwdDir, SESSION_A).reason || '';
  assert.ok(reason.includes(TDD_REMINDER), `Expected a TDD reminder, got: ${reason}`);
});

test('T21: with the scratchpad field, a source file inside the work folder is logged', () => {
  const { homeDir, cwdDir } = makeHome();
  const { scratchpadDir } = makeScratchpad(homeDir);
  writeWithScratchpad(homeDir, cwdDir, path.join(cwdDir, 'src', SCRATCH_FILE), scratchpadDir);
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 1);
});

test('T22: a source file in a sibling folder named scratchpad-2 is logged', () => {
  const { homeDir, cwdDir } = makeHome();
  const { scratchpadDir, siblingDir } = makeScratchpad(homeDir);
  writeWithScratchpad(homeDir, cwdDir, path.join(siblingDir, SCRATCH_FILE), scratchpadDir);
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 1);
});

test('T22b: a relative file path is resolved against cwd before the scratchpad check', () => {
  const { homeDir, cwdDir } = makeHome();
  const { scratchpadDir } = makeScratchpad(homeDir);
  fs.writeFileSync(path.join(cwdDir, SCRATCH_FILE), '// probe\n');
  trackEdit(homeDir, cwdDir, SESSION_A, 'Write', SCRATCH_FILE, { content: '// probe\n' }, { [SCRATCHPAD_FIELD]: scratchpadDir });
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 1);
});

test('T22c: a relative file path with the scratchpad as cwd is not logged', () => {
  const { homeDir } = makeHome();
  const { scratchpadDir } = makeScratchpad(homeDir);
  fs.writeFileSync(path.join(scratchpadDir, SCRATCH_FILE), '// probe\n');
  trackEdit(homeDir, scratchpadDir, SESSION_A, 'Write', SCRATCH_FILE, { content: '// probe\n' }, { [SCRATCHPAD_FIELD]: scratchpadDir });
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 0, 'The scratch file must not be logged');
});

for (const value of NON_STRING_FIELD_VALUES) {
  test(`T24: with the field set to ${JSON.stringify(value)}, a source file in the work folder is logged`, () => {
    const { homeDir, cwdDir } = makeHome();
    writeWithScratchpad(homeDir, cwdDir, path.join(cwdDir, 'src', SCRATCH_FILE), value);
    assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 1);
  });
}

test('T25: a session log with a [saved] entry written into the scratchpad does not move the save marker', () => {
  const { homeDir, cwdDir } = makeHome();
  const { scratchpadDir } = makeScratchpad(homeDir);
  trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  const scratchLog = path.join(scratchpadDir, SESSION_LOG);
  fs.writeFileSync(scratchLog, SAVED_HEADING);
  trackEdit(homeDir, cwdDir, SESSION_A, 'Write', scratchLog, { content: SAVED_HEADING }, { [SCRATCHPAD_FIELD]: scratchpadDir });
  const result = stop(homeDir, cwdDir, SESSION_A);
  assert.ok((result.reason || '').includes(DECISION_LOG),
    `Expected the decision-log block to stay, got: ${JSON.stringify(result)}`);
});

/**
 * A symbolic link to the parent of the scratchpad, so that the same folder has
 * two names (as /tmp and /private/tmp on macOS). Returns null when the link
 * cannot be created (Windows without the privilege).
 */
function linkedScratchpad(homeDir, scratchpadDir) {
  const linkDir = path.join(homeDir, 'tmp-link');
  try {
    fs.symlinkSync(path.dirname(scratchpadDir), linkDir, 'dir');
  } catch {
    return null;
  }
  return path.join(linkDir, path.basename(scratchpadDir));
}

for (const [label, fileThroughLink] of [['the file path', true], ['the scratchpad path', false]]) {
  test(`T23: the two names of one scratchpad folder match when ${label} goes through a symbolic link`, () => {
    const { homeDir, cwdDir } = makeHome();
    const { scratchpadDir } = makeScratchpad(homeDir);
    const linked = linkedScratchpad(homeDir, scratchpadDir);
    if (linked === null) {
      console.log('    (no symbolic link on this platform; the case is not checked)');
      return;
    }
    const fileDir = fileThroughLink ? linked : scratchpadDir;
    const fieldDir = fileThroughLink ? scratchpadDir : linked;
    writeWithScratchpad(homeDir, cwdDir, path.join(fileDir, SCRATCH_FILE), fieldDir);
    assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 0, 'The scratch file must not be logged');
  });
}

test('T23b: a scratch file that does not exist is matched through its parent folder', () => {
  const { homeDir, cwdDir } = makeHome();
  const { scratchpadDir } = makeScratchpad(homeDir);
  const linked = linkedScratchpad(homeDir, scratchpadDir);
  if (linked === null) {
    console.log('    (no symbolic link on this platform; the case is not checked)');
    return;
  }
  trackEdit(homeDir, cwdDir, SESSION_A, 'Write', path.join(linked, 'gone.js'), { content: '' }, { [SCRATCHPAD_FIELD]: scratchpadDir });
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 0, 'The scratch file must not be logged');
});

// ── A Bash call is not an edit ───────────────────────────────────────────────

console.log('\nA Bash call is not an edit');

// track-edits.js also runs after the Bash tool, to keep a session log that a
// command wrote out of `git status` (tests/codex/test-git-exclude-hooks.js).
// The stop hook counts the lines of the edit log, and it reads the save marker.
// A Bash call must change neither: the save command of the skill writes the
// marker itself when it runs, and a command is not an edit of a file.

function afterBash(homeDir, cwdDir, sessionId, command, toolInputExtra = {}) {
  const output = runHook(TRACK_EDITS, {
    tool_name: 'Bash',
    tool_input: { command, ...toolInputExtra },
    cwd: cwdDir,
    session_id: sessionId,
  }, homeDir);
  assert.deepStrictEqual(output, JSON.parse(EMPTY_HOOK_OUTPUT), 'track-edits must never block');
}

test('T26: after a Bash call with the save command, the log folder holds no file', () => {
  const { homeDir, cwdDir } = makeHome();
  fs.writeFileSync(path.join(cwdDir, SESSION_LOG), SAVED_HEADING);
  afterBash(homeDir, cwdDir, SESSION_A, saveCommandWithEntry(ENTRY_TEXT));
  const { logDir } = markerPaths(homeDir);
  assert.deepStrictEqual(fs.existsSync(logDir) ? fs.readdirSync(logDir) : [], [],
    'Expected no edit log, no save marker and no statistics file');
  assert.deepStrictEqual(stop(homeDir, cwdDir, SESSION_A), JSON.parse(EMPTY_HOOK_OUTPUT));
});

test('T26b: a Bash call with the save command adds no edit-log line and does not move the save marker', () => {
  const { homeDir, cwdDir } = makeHome();
  trackEdit(homeDir, cwdDir, SESSION_A, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  fs.writeFileSync(path.join(cwdDir, SESSION_LOG), SAVED_HEADING);
  afterBash(homeDir, cwdDir, SESSION_A, saveCommandWithEntry(ENTRY_TEXT));
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 1);
  assert.strictEqual(fs.existsSync(markerPaths(homeDir, SESSION_A).marker), false, 'The hook wrote the save marker');
  expectDecisionLogBlock(stop(homeDir, cwdDir, SESSION_A), 'session A');
});

// The documented input of a Bash call holds no `file_path`. If one arrives,
// the call is still not an edit.
test('T26c: a Bash call whose input also holds a file path adds no edit-log line', () => {
  const { homeDir, cwdDir } = makeHome();
  afterBash(homeDir, cwdDir, SESSION_A, 'npm test', { file_path: path.join(cwdDir, SIGNIFICANT_FILE) });
  assert.strictEqual(ownEditLogLines(homeDir, SESSION_A), 0);
});

// ── Session statistics: one file per session ─────────────────────────────────

console.log('\nSession statistics: one file per session');

const SHARED_STATS_FILE = 'session-stats.json';
const SUMMARY_LABEL = 'Session summary';
const MINUTE_MS = 60 * 1000;

function trackSkill(homeDir, sessionId, skill) {
  const output = runHook(TRACK_STATS, { tool_name: 'Skill', tool_input: { skill }, session_id: sessionId }, homeDir);
  assert.deepStrictEqual(output, JSON.parse(EMPTY_HOOK_OUTPUT), 'track-session-stats must never block');
}

/** The content of a statistics file that counts one call of each named skill. */
function statsContent(skills, startedMinutesAgo) {
  return JSON.stringify({
    startedAt: new Date(Date.now() - startedMinutesAgo * MINUTE_MS).toISOString(),
    skillInvocations: Object.fromEntries(skills.map(skill => [skill, 1])),
    totalSkillCalls: skills.length,
  });
}

/** The file is as old on disk as its content says, so no age rule of any kind can pass. */
function seedStatsFile(homeDir, file, skills, startedMinutesAgo) {
  fs.mkdirSync(markerPaths(homeDir).logDir, { recursive: true });
  fs.writeFileSync(file, statsContent(skills, startedMinutesAgo));
  const started = new Date(Date.now() - startedMinutesAgo * MINUTE_MS);
  fs.utimesSync(file, started, started);
}

/**
 * The reason text of the block that a stop gives after one significant edit.
 * The summary line appears only inside a block, so every check makes one edit.
 */
function stopReasonAfterEdit(homeDir, cwdDir, sessionId) {
  trackEdit(homeDir, cwdDir, sessionId, 'Edit', SIGNIFICANT_FILE, { old_string: 'a', new_string: 'b' });
  return stop(homeDir, cwdDir, sessionId).reason || '';
}

test('T15: the summary of session B names only the skills of session B, and no minutes', () => {
  const { homeDir, cwdDir } = makeHome();
  trackSkill(homeDir, SESSION_A, 'skill-a');
  trackSkill(homeDir, SESSION_B, 'skill-b');
  const reason = stopReasonAfterEdit(homeDir, cwdDir, SESSION_B);
  assert.ok(reason.includes(`${SUMMARY_LABEL}: 1 skill invocations [skill-b (1x)]`), `Got: ${reason}`);
  assert.ok(!reason.includes('skill-a'), `The summary names a skill of session A: ${reason}`);
  assert.ok(!fs.existsSync(path.join(markerPaths(homeDir).logDir, SHARED_STATS_FILE)),
    'The shared statistics file must not be written');
});

test('T16: the shared statistics file of an older plugin version gives a session no summary', () => {
  const { homeDir, cwdDir } = makeHome();
  seedStatsFile(homeDir, path.join(markerPaths(homeDir).logDir, SHARED_STATS_FILE), ['old-skill'], 180);
  const reason = stopReasonAfterEdit(homeDir, cwdDir, SESSION_A);
  assert.ok(reason.includes(DECISION_LOG), `Expected a block, got: ${reason}`);
  assert.ok(!reason.includes(SUMMARY_LABEL), `Expected no summary line, got: ${reason}`);
});

test('T16b: the first Skill call of a session does not start from the shared statistics file', () => {
  const { homeDir, cwdDir } = makeHome();
  seedStatsFile(homeDir, path.join(markerPaths(homeDir).logDir, SHARED_STATS_FILE), ['old-skill'], 1);
  trackSkill(homeDir, SESSION_A, 'skill-a');
  const reason = stopReasonAfterEdit(homeDir, cwdDir, SESSION_A);
  assert.ok(reason.includes(`${SUMMARY_LABEL}: 1 skill invocations [skill-a (1x)]`), `Got: ${reason}`);
});

test('T17: a session longer than 2 hours keeps its counts', () => {
  const { homeDir, cwdDir } = makeHome();
  const ownStats = evaluateInHome(homeDir, SAVE_MARKER, SESSION_A, 'm.statsFile(id)');
  seedStatsFile(homeDir, ownStats, ['skill-a'], 180);
  trackSkill(homeDir, SESSION_A, 'skill-a');
  const reason = stopReasonAfterEdit(homeDir, cwdDir, SESSION_A);
  assert.ok(reason.includes('2 skill invocations [skill-a (2x)]'), `Got: ${reason}`);
});

test('T18: a Skill call without a session id is counted in the shared file and shown', () => {
  const { homeDir, cwdDir } = makeHome();
  trackSkill(homeDir, undefined, 'skill-a');
  const { logDir } = markerPaths(homeDir);
  assert.deepStrictEqual(fs.readdirSync(logDir).filter(name => name.startsWith('session-stats')), [SHARED_STATS_FILE]);
  assert.ok(stopReasonAfterEdit(homeDir, cwdDir, undefined).includes('skill-a (1x)'));
});

// ── The rules that the skill states next to the save command ─────────────────

console.log('\ncontext-management skill: the rules of the save command');

// Each pattern pins one rule sentence. The skill text is read with its line
// breaks folded to spaces, and in lower case.
const SKILL_RULES = [
  ['a hook can block the command; write the entry with the Edit tool instead',
    /a hook can block this command\..*in that case write the entry with the edit tool instead/],
  ['write the [saved] heading at the start of a line',
    /write the `## \.\.\. \[saved\]` heading at the start of a line/],
  ['save after the edits that implement a decision',
    /save after the edits that implement a decision/],
  ['the delimiter is in single quotes and must stay so',
    /the delimiter `'[a-z0-9_]+'` is in single quotes, and it must stay so/],
  ['the entry must hold no line that is equal to the delimiter',
    /the entry must hold no line that is equal to the delimiter/],
  ['do not replace the delimiter with a common word',
    /the delimiter is an unusual word for this reason; do not replace it with a common word/],
];

const foldedSkillText = fs.readFileSync(SKILL_FILE, 'utf8').replace(/\s+/g, ' ').toLowerCase();
for (const [label, pattern] of SKILL_RULES) {
  test(`The skill states the rule: ${label}`, () => {
    assert.ok(pattern.test(foldedSkillText), `No sentence of the skill matches ${pattern}`);
  });
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`save-marker: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
