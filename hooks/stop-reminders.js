#!/usr/bin/env node
/**
 * Stop Hook — Contextual Reminders
 *
 * When Claude finishes responding, checks session context and provides
 * gentle reminders about TDD, verification, and commit hygiene.
 * These reminders reinforce discipline skills deterministically.
 *
 * Uses a file-based guard to fire only once per session to prevent
 * infinite loops (Stop hook returning content causes Claude to resume).
 * It also stays silent when the payload field `stop_hook_active` is true:
 * Claude Code sets it when it is already continuing because a stop hook
 * blocked. The field can only remove a block, never add one, so a platform
 * or version that does not send it behaves as before.
 *
 * Input:  stdin JSON with { session_id, cwd, stop_hook_active, ... }
 * Output: stdout JSON with decision/reason continuation payload (only when
 * actionable reminders exist), or {} to let Claude stop normally.
 * Uses decision+reason rather than hookSpecificOutput for broader version compat.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  MARKER_COMMAND,
  MAX_AGE_MS,
  editLogFile,
  guardFile,
  markerFile,
  removeOldSessionFiles,
  statsFile,
  writeTimeFile,
} = require('./save-marker');

// A user switches off individual reminders with a comma-separated list of their
// names in this environment variable, for example "commit,tdd". Names are not
// case-sensitive. An unknown name switches nothing off; a block names it (see
// unknownNameWarning). The session summary has no name: it never blocks a
// stop on its own.
const REMINDERS_OFF_VARIABLE = 'SUPERPOWERS_STOP_REMINDERS_OFF';
const REMINDER = Object.freeze({
  TDD: 'tdd',
  COMMIT: 'commit',
  DECISION_LOG: 'decision-log',
  STATE_MD: 'state-md',
  SESSION_LOG_SIZE: 'session-log-size',
});

const KNOWN_REMINDER_NAMES = Object.values(REMINDER);

function namesSwitchedOff() {
  return (process.env[REMINDERS_OFF_VARIABLE] || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0);
}

function isReminderOn(name) {
  return !namesSwitchedOff().includes(name);
}

/**
 * A warning that names each unknown name in the switch, or null. A Stop hook
 * has one visible channel: the reason of a block. Claude Code discards the
 * systemMessage field for Stop and sends standard error of a hook that exits
 * 0 to the debug log only. So the warning goes into a block that the hook
 * makes anyway; an unknown name never makes the hook block on its own.
 */
function unknownNameWarning() {
  const unknownNames = namesSwitchedOff().filter(name => !KNOWN_REMINDER_NAMES.includes(name));
  if (unknownNames.length === 0) return null;
  return (
    `Unknown name in ${REMINDERS_OFF_VARIABLE}: ${unknownNames.map(name => `"${name}"`).join(', ')}. ` +
    `Separate names with commas. Known names: ${KNOWN_REMINDER_NAMES.join(', ')}. ` +
    'Tell the user about this; do not change the setting yourself.'
  );
}

// Guard: only fire once per session (prevent infinite loop)
// The guard file is created on first fire and checked on subsequent fires.
// It auto-expires after 2 minutes so subsequent Claude stops can show reminders.
// Each session has its own guard file, so a block of one session does not
// silence another session.
const GUARD_TTL_MS = 2 * 60 * 1000;

function shouldFire(sessionId) {
  try {
    const file = guardFile(sessionId);
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      const age = Date.now() - stat.mtimeMs;
      if (age < GUARD_TTL_MS) {
        return false; // Guard is active, don't fire
      }
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Write the guard of this session. Also delete every per-session marker,
 * guard and edit log file that is older than 7 days, which is every file in
 * the log folder whose name matches the pattern of a per-session file. This
 * includes a file of this session. That is harmless: the hook never looks
 * further back than 7 days for unsaved edits, so a marker or an edit line of
 * that age changes no result, and every append sets the modification time of
 * the edit log to the present time.
 * Limit (from reasoning, not measured): the cleanup reads the time of a file
 * and then deletes the file. When a session rewrites its marker, which was
 * older than 7 days, between these two steps, the cleanup deletes the new
 * marker. That session then gets one more reminder, until its next save.
 */
function setGuard(sessionId) {
  writeTimeFile(guardFile(sessionId));
  removeOldSessionFiles();
}

// Common test file patterns
const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.(go|py|rb)$/,
  /test_[^/]+\.py$/,
  /Tests?\.[^/]+$/,
  /\.test$/,
  /__tests__\//,
  /(?:^|[/\\])test[-_][^/\\]+\.[jt]sx?$/i,
  /[/\\]tests?[/\\]/i,
];

// Common source file patterns (non-test, non-config)
const SOURCE_PATTERNS = [
  /\.(js|jsx|ts|tsx|py|rb|go|rs|java|cs|cpp|c|h|hpp|swift|kt|scala|php)$/,
];

// Files that are clearly config/non-source
const CONFIG_PATTERNS = [
  /package\.json$/,
  /tsconfig.*\.json$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /\.gitignore$/,
  /\.env/,
  /Dockerfile/,
  /docker-compose/,
  /\.ya?ml$/,
  /\.toml$/,
  /\.cfg$/,
  /\.ini$/,
  /\.md$/,
  /\.lock$/,
  /CLAUDE\.md$/,
  /SKILL\.md$/,
];

function isTestFile(filePath) {
  return TEST_PATTERNS.some(p => p.test(filePath));
}

function isSourceFile(filePath) {
  return SOURCE_PATTERNS.some(p => p.test(filePath)) && !CONFIG_PATTERNS.some(p => p.test(filePath));
}

/**
 * Parse a raw log line into an entry object.
 * Supports both legacy 3-field format and new 4-field format with session_id.
 */
function parseLogLine(line) {
  const parts = line.split(' | ');
  if (parts.length < 3) return null;
  if (parts.length >= 4) {
    // New format: timestamp | session_id | tool | filePath
    return {
      timestamp: parts[0],
      sessionId: parts[1] || null,
      tool: parts[2],
      filePath: parts.slice(3).join(' | '),
    };
  }
  // Legacy format: timestamp | tool | filePath
  return {
    timestamp: parts[0],
    sessionId: null,
    tool: parts[1],
    filePath: parts.slice(2).join(' | '),
  };
}

/**
 * Return true if an entry matches the given sessionId filter.
 * When sessionId is provided: only entries with a matching sessionId pass.
 * When sessionId is null/undefined: legacy entries (no sessionId) pass.
 */
function matchesSession(entry, sessionId) {
  if (sessionId) {
    return entry.sessionId === sessionId;
  }
  return entry.sessionId === null;
}

/**
 * A path inside the worktree of a subagent. Claude Code creates the folder
 * `.claude/worktrees/agent-a<16 hexadecimal digits>/` for a subagent that runs
 * with worktree isolation, also for a named subagent (six samples, measured
 * 2026-09-19). The edit log records such edits under the parent session's id.
 * They are throwaway work, for example mutation testing, so no reminder counts
 * them. A worktree that the main session entered has a name of another form
 * and is still counted. Both path separators match, for Windows paths.
 */
const SUBAGENT_WORKTREE_PATTERN = /(?:^|[/\\])\.claude[/\\]worktrees[/\\]agent-a[0-9a-f]{16}[/\\]/;

/**
 * Read the edit log entries of the current session that are newer than cutoff.
 * Edits inside a subagent's own worktree are left out. The old shared log is
 * read as well: it holds the edits without a session id, and the earlier edits
 * of a session that was open while the plugin was updated. Without a session
 * id both paths are the same file, and the Set keeps it from being read twice.
 */
function readSessionEditsAfter(cutoff, sessionId) {
  try {
    return [...new Set([editLogFile(sessionId), editLogFile()])]
      .filter(file => fs.existsSync(file))
      .flatMap(file => fs.readFileSync(file, 'utf8').split('\n'))
      .filter(Boolean)
      .map(parseLogLine)
      .filter(entry =>
        entry &&
        new Date(entry.timestamp) > cutoff &&
        matchesSession(entry, sessionId) &&
        !SUBAGENT_WORKTREE_PATTERN.test(entry.filePath)
      );
  } catch {
    return [];
  }
}

/**
 * Read recent edits from the edit log (last 30 minutes), filtered to the current session.
 */
function getRecentEdits(sessionId) {
  return readSessionEditsAfter(new Date(Date.now() - 30 * 60 * 1000), sessionId);
}

/**
 * Return the time that one save marker file holds, or null when the file does
 * not exist or holds no valid time.
 */
function readMarkerTime(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const ts = new Date(fs.readFileSync(file, 'utf8').trim());
    return isNaN(ts.getTime()) ? null : ts;
  } catch {
    return null;
  }
}

/**
 * Return the time after which an edit counts as not saved. It is the latest
 * of three times:
 *   - the save marker of this session;
 *   - the old marker that all sessions share. Old skill text and old handoff
 *     documents still write it. Honouring it can only cause a missed
 *     reminder, never a false block;
 *   - the current time minus MAX_AGE_MS, so that a missing or deleted marker
 *     never causes a block for edits older than that.
 */
function getLastSavedEntryTime(sessionId) {
  const oldestCounted = new Date(Date.now() - MAX_AGE_MS);
  return [markerFile(sessionId), markerFile()]
    .map(readMarkerTime)
    .reduce((latest, time) => (time && time > latest ? time : latest), oldestCounted);
}

/**
 * Load the statistics of one session for progress visibility.
 */
function getSessionStats(sessionId) {
  try {
    const file = statsFile(sessionId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Format session stats into a brief summary line.
 */
function formatStatsSummary(stats) {
  if (!stats || stats.totalSkillCalls === 0) return null;

  const skillNames = Object.entries(stats.skillInvocations)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count}x)`)
    .join(', ');

  return `Session summary: ${stats.totalSkillCalls} skill invocations [${skillNames}]`;
}

/**
 * Generate contextual reminders based on edit history and session stats.
 * Returns array of reminder strings.
 */
function getUncommittedCount(cwd) {
  try {
    const result = spawnSync('git', ['status', '--porcelain'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status !== 0 || result.error) return 0;
    const lines = (result.stdout || '').split('\n').filter(l => l.trim().length > 0);
    return lines.length;
  } catch {
    return 0;
  }
}

// The TDD reminder names at most this many files, so that a long session
// does not make the block text long.
const MAX_NAMED_FILES = 5;

/**
 * Return the file names for a reminder: each path relative to cwd, or the
 * full path for a file outside cwd, and "and N more" after MAX_NAMED_FILES.
 * The reminder counts every edit of the last 30 minutes, not only the last
 * turn, so without names the reader cannot tell which edit it counted.
 */
function formatFileList(filePaths, cwd) {
  const names = filePaths.slice(0, MAX_NAMED_FILES).map(filePath => {
    const relative = path.relative(cwd, filePath);
    const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    return outside ? filePath : relative;
  });
  const rest = filePaths.length - names.length;
  return names.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}

function generateReminders(edits, cwd, sessionId) {
  const reminders = [];

  // Session stats summary (always include if available)
  const stats = getSessionStats(sessionId);
  const statsSummary = formatStatsSummary(stats);
  if (statsSummary) {
    reminders.push(statsSummary);
  }

  if (edits.length === 0) return reminders;

  const editedPaths = [...new Set(edits.map(e => e.filePath))];
  const sourceFiles = editedPaths.filter(isSourceFile);
  const testFiles = editedPaths.filter(isTestFile);

  // TDD reminder: source files changed without corresponding tests
  const untestedSources = sourceFiles.filter(src => !isTestFile(src));
  if (isReminderOn(REMINDER.TDD) && untestedSources.length > 0 && testFiles.length === 0) {
    reminders.push(
      `TDD reminder: ${untestedSources.length} source file(s) modified without test changes: ` +
      `${formatFileList(untestedSources, cwd)}. ` +
      `Consider running tests or invoking TDD workflow if behavior changed.`
    );
  }

  // Commit reminder: check actual uncommitted changes via git, not just session edits.
  // Using edit-log count was wrong — it fired even after a commit was made mid-session.
  if (isReminderOn(REMINDER.COMMIT) && editedPaths.length >= 5) {
    const uncommittedCount = getUncommittedCount(cwd);
    if (uncommittedCount >= 5) {
      reminders.push(
        `Commit reminder: ${uncommittedCount} files with uncommitted changes. ` +
        `Consider committing incremental progress to avoid losing work. ` +
        `If a project rule (for example in CLAUDE.md or AGENTS.md) requires the user's approval ` +
        `before a commit, do not commit: tell the user about the uncommitted changes and wait.`
      );
    }
  }

  return reminders;
}


/**
 * Detect sessions where significant architectural decisions were made.
 * These are sessions that modified skill files, hooks, or plugin config —
 * places where the "why" matters and would be costly to rediscover.
 */
function isSignificantSession(edits) {
  const sigPatterns = [
    /SKILL\.md$/i,
    /[/\\]hooks[/\\][^/\\]+\.js$/,
    /[/\\]hooks[/\\]session-start$/,
    /skill-rules\.json$/,
    /CLAUDE\.md$/i,
    /agents[/\\][^/\\]+\.md$/i,
    /[/\\]specs[/\\][^/\\]+\.md$/i,
    /[/\\]plans[/\\][^/\\]+\.md$/i,
    /plugin\.universal\.yaml$/,
  ];
  return edits.some(e => sigPatterns.some(p => p.test(e.filePath)));
}

/**
 * Check if state.md exists in cwd and has been overtaken by recent source-file
 * edits — a signal that active task state may have drifted since last save.
 * Returns a reminder string if stale, null otherwise.
 *
 * Threshold: state.md older than at least 2 source-file edits that occurred
 * after it was last written. Config-only edits are excluded (noise).
 */
function checkStateMdStaleness(cwd, recentEdits) {
  try {
    const stateMdPath = path.join(cwd, 'state.md');
    if (!fs.existsSync(stateMdPath)) return null;

    const stateMtime = fs.statSync(stateMdPath).mtimeMs;
    const editsAfterState = recentEdits.filter(e =>
      new Date(e.timestamp).getTime() > stateMtime && isSourceFile(e.filePath)
    );

    if (editsAfterState.length >= 2) {
      return (
        'State.md sync: state.md was written before recent code changes in this session. ' +
        'If progress was made on the active task, update state.md via the context-management skill.'
      );
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check the last 2 [saved] entries in session-log.md and warn if they
 * exceed the token budget. Hard cap is 250 tokens (~1000 chars) per entry.
 * Returns a warning string if over budget, null otherwise.
 */
function checkSessionLogSize(cwd) {
  try {
    const sessionLogPath = path.join(cwd, 'session-log.md');
    if (!fs.existsSync(sessionLogPath)) return null;

    const lines = fs.readFileSync(sessionLogPath, 'utf8').split('\n');
    const entries = [];
    let current = null;

    for (const line of lines) {
      if (/^## .+\[saved\]/.test(line)) {
        if (current) entries.push(current);
        current = { header: line, chars: line.length + 1 };
      } else if (current) {
        current.chars += line.length + 1;
      }
    }
    if (current) entries.push(current);

    const last2 = entries.slice(-2);
    const HARD_CAP_CHARS = 1500; // ~375 tokens — accommodates multi-subsystem sessions
    const over = last2.filter(e => e.chars > HARD_CAP_CHARS);
    if (over.length === 0) return null;

    const totalTokens = last2.reduce((s, e) => s + Math.round(e.chars / 4), 0);
    return (
      `Session-log size warning: last 2 [saved] entries inject ~${totalTokens} tokens per session ` +
      `(target: <500). Entries over budget: ${over.map(e => e.header.trim()).join('; ')}. ` +
      `Trim to: Goal / Decisions / Rejected / Open only. Hard cap 375 tokens per entry. ` +
      `Task checklists → state.md. Speculative analysis → design docs. Test results → delete.`
    );
  } catch {
    return null;
  }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    process.stdout.write(JSON.stringify(evaluatePayload(data)));
  } catch {
    process.stdout.write('{}');
  }
}

/**
 * Build Claude Stop hook response object from input payload.
 * Only blocks Claude's stop when actionable reminders exist (TDD, commit,
 * decision log, session-log size). Informational stats alone do not block.
 */
function evaluatePayload(data) {
  if (!data || typeof data !== 'object') return {};

  const cwd = data.cwd || process.cwd();
  const sessionId = data.session_id || null;
  const edits = getRecentEdits(sessionId);

  // Claude Code says directly that it is continuing because of a stop hook
  // (strictly `true`, as in hooks/codex/stop-adapter.js). The file-based guard
  // stays: it covers a payload without the field, and it limits how often a
  // reminder that the model cannot clear (the TDD reminder) repeats.
  if (data.stop_hook_active === true || !shouldFire(sessionId)) return {};

  const reminders = generateReminders(edits, cwd, sessionId);

  // Decision-log reminder: significant files modified since the last [saved] entry.
  // Using "since last saved" (not "last 30 min") means long sessions with multiple
  // work phases keep getting reminded until each phase is explicitly documented.
  // A save before the edits that implement a decision gives one more reminder:
  // the hook cannot know that the entry already covers the later edits. The
  // reminder therefore names the marker command for that case.
  const editsSinceLastSaved = readSessionEditsAfter(getLastSavedEntryTime(sessionId), sessionId);
  if (isReminderOn(REMINDER.DECISION_LOG) && isSignificantSession(editsSinceLastSaved)) {
    reminders.push(
      'Decision log: This session modified core skill/hook/config files. ' +
      'Before stopping, invoke context-management via the Skill tool to write a [saved] entry ' +
      'capturing decisions, rationale, and rejected approaches. ' +
      'Future sessions start with zero context — this is the only way to preserve the "why". ' +
      'If a [saved] entry of this session already covers these edits, write no new entry; ' +
      `run only the marker command: ${MARKER_COMMAND}`
    );
  }

  // state.md staleness: warn if state.md exists but source files changed after it was written
  const stateStaleness = isReminderOn(REMINDER.STATE_MD) && checkStateMdStaleness(cwd, edits);
  if (stateStaleness) reminders.push(stateStaleness);

  // Session-log size guard: warn if last 2 [saved] entries exceed token budget
  const sizeWarning = isReminderOn(REMINDER.SESSION_LOG_SIZE) && checkSessionLogSize(cwd);
  if (sizeWarning) reminders.push(sizeWarning);

  if (reminders.length === 0) return {};

  // Stats-only sessions don't warrant blocking Claude's stop.
  // Only block when there are actionable reminders that need Claude's attention.
  // The stats summary is informational — it doesn't require a response from Claude.
  const hasActionableReminders = reminders.some(r => !r.startsWith('Session summary:'));
  if (!hasActionableReminders) return {};

  // Set guard BEFORE outputting — prevents re-entry
  setGuard(sessionId);

  const warning = unknownNameWarning();
  const context = [
    '<stop-hook-reminders>',
    ...reminders,
    ...(warning ? [warning] : []),
    '</stop-hook-reminders>',
  ].join('\n');

  return {
    decision: 'block',
    reason: context,
  };
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    checkSessionLogSize,
    checkStateMdStaleness,
    evaluatePayload,
    generateReminders,
    getLastSavedEntryTime,
    getRecentEdits,
    isSourceFile,
    isTestFile,
    matchesSession,
    parseLogLine,
    setGuard,
    shouldFire,
  };
}
