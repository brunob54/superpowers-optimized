#!/usr/bin/env node
'use strict';

/**
 * Bash Output Compression Hook — PostToolUse/Bash
 *
 * Runs after a Bash tool call has ended with success. When a compression rule
 * matches the command, the hook replaces the output that Claude receives with
 * the compressed text. It uses the `updatedToolOutput` field, which needs
 * Claude Code 2.1.121 or later.
 *
 * The hook never changes the command and never returns a permission decision.
 * The permission rules and the permission prompt of Claude Code therefore see
 * every command exactly as Claude wrote it.
 *
 * The hook prints {} (no change: Claude receives the raw output) for:
 *   - an event that is not PostToolUse, and a tool that is not Bash
 *   - a command that no rule matches, or that the never-compress list names
 *   - a tool response that the hook cannot prove safe to replace (readOutput)
 *   - output that the rule declines, or that the replacement does not make
 *     shorter (compress)
 *   - output in which a rule removed more than 40 lines with an alert word
 *   - the second run of the same command within 60 seconds
 *   - any error inside the hook (fail-open)
 * A command that fails does not reach this hook: Claude Code sends the
 * PostToolUseFailure event for it, so its output always stays raw.
 *
 * Disable mechanisms:
 *   - Environment variable: SP_NO_COMPRESS=1
 *   - Project file: .sp-no-compress in project root
 *
 * Cross-platform: Works on macOS, Linux, and Windows.
 * Zero dependencies: uses only Node.js built-ins.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  MIN_OUTPUT_LENGTH,
  compressionMarker,
  countNonEmptyLines,
  findRule,
  runRule,
} = require('./compression-rules');
const { cleanSessionId } = require('./save-marker');

// The answer that changes nothing: Claude receives the output as it is
const NO_CHANGE = {};

// A second run of the same command within this time stays raw
const RERUN_WINDOW_MS = 60000; // ms (milliseconds)

// Above 30,000 characters Claude Code cuts the `stdout` field and saves the
// whole output in a file. These two fields of the response name that file.
const SAVED_OUTPUT_FIELDS = ['persistedOutputPath', 'persistedOutputSize'];

// The fields of the response of a Bash call that ended in the foreground with
// exit status 0 (measured on Claude Code 2.1.289). A response with any other
// field stays as it is. Two measured examples: `backgroundTaskId` (Claude Code
// moved the call to the background, so the output is not complete) and
// `returnCodeInterpretation` (the exit status was not 0).
const KNOWN_RESPONSE_FIELDS = new Set([
  'stdout',
  'stderr',
  'interrupted',
  'isImage',
  'noOutputExpected',
  ...SAVED_OUTPUT_FIELDS,
  // Notes that Claude Code adds to complete output. The hook returns each
  // unchanged. Seen in recorded tool results: `gitOperation` (what a git
  // commit or a git push did), `bashEditDiff` (the files that the command
  // changed), `staleReadFileStateHint` (a text about files that changed after
  // Claude read them). Read in the program text: `dangerouslyDisableSandbox`
  // (the field of the same name of the tool input).
  'gitOperation',
  'bashEditDiff',
  'staleReadFileStateHint',
  'dangerouslyDisableSandbox',
]);

// The hook does not read a saved output file above this size
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB (megabytes)

// A replacement is never longer than this number of characters. It is the
// length at which Claude Code cuts `stdout` and saves the output in a file.
const MAX_REPLACEMENT_LENGTH = 30000;

// A line with one of these words can report a problem of a command that ended
// with exit status 0. Claude Code merges standard error into `stdout`, so a
// rule can remove such a line; the hook adds it again (removedAlertLines).
// The word must stand alone: a letter, a digit, `_`, `.`, `/` or `-` directly
// before it, or a letter, a digit, `_`, `/`, `-` or a file extension directly
// after it, makes it a part of a name (`src/errors.js`, `fail-fast`).
const ALERT_WORDS = /(?<![\w./-])(?:errors?|warn|warnings?|fatal|fail|failed|conflicts?|denied|incompatible|deprecated|cannot|not\s+found)(?![\w/-]|\.\w)/i;

// With more removed alert lines than this, the output stays as it is
const MAX_ALERT_LINES = 40;

// The line above the alert lines that the hook adds to the compressed text
const ALERT_HEADING = 'Removed lines with an alert word:';

/**
 * The whole output of the call, as { stdout, stderr, sentLength, savedPath }.
 * `sentLength` is the length of the `stdout` text that Claude Code sent, and
 * `savedPath` names the file with the whole output when Claude Code cut that
 * text. Returns null when the hook cannot prove that the response is safe to
 * replace: the response does not have the known shape, the call was
 * interrupted, the output is an image, or the saved output file is not a
 * regular file, is too large or does not belong to this response.
 * A saved output file that cannot be read throws; main() handles the error.
 */
function readOutput(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  if (Object.keys(response).some(field => !KNOWN_RESPONSE_FIELDS.has(field))) return null;

  const { stdout, stderr, interrupted, isImage } = response;
  if (typeof stdout !== 'string' || typeof stderr !== 'string') return null;
  if (interrupted !== false || isImage !== false) return null;

  const sentLength = stdout.length;
  if (!SAVED_OUTPUT_FIELDS.some(field => field in response)) return { stdout, stderr, sentLength };

  // `stdout` holds only the start of the output. A rule must see all of it:
  // for example, the summary of a test run is at the end. lstat does not
  // follow a symbolic link and does not open the file: reading a named pipe
  // would never end.
  const savedPath = response.persistedOutputPath;
  const saved = fs.lstatSync(savedPath);
  if (!saved.isFile() || saved.size > MAX_OUTPUT_BYTES) return null;
  const whole = fs.readFileSync(savedPath, 'utf8');
  return whole.startsWith(stdout) ? { stdout: whole, stderr, sentLength, savedPath } : null;
}

/**
 * The lines of the output that hold an alert word and that the compressed
 * text does not hold: each line once, in the order of the output.
 */
function removedAlertLines(stdout, compressed) {
  const lines = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => ALERT_WORDS.test(line) && !compressed.includes(line));
  return [...new Set(lines)];
}

/**
 * The text that replaces the output: the compressed text, the alert lines
 * that the rule removed, and the marker line. Returns null when the output
 * must stay raw.
 */
function compress(rule, output) {
  // Normalize line endings (Windows CRLF -> LF)
  const stdout = output.stdout.replace(/\r\n/g, '\n');
  const stderr = output.stderr.replace(/\r\n/g, '\n');

  // If output is too short, compression isn't worth it
  const totalOutput = stdout + stderr;
  if (totalOutput.length < MIN_OUTPUT_LENGTH) return null;

  // The exit status is 0: see KNOWN_RESPONSE_FIELDS
  const compressed = runRule(rule, stdout, stderr, 0);
  if (compressed === null) return null;

  // A `stderr` field that is not empty stays in the response, so only the
  // lines of `stdout` can be lost
  const alertLines = removedAlertLines(stdout, compressed);
  if (alertLines.length > MAX_ALERT_LINES) return null;
  const kept = alertLines.length ? [compressed, '', ALERT_HEADING, ...alertLines].join('\n') : compressed;

  // Output from which no line was removed stays as it is, so every replaced
  // output carries the marker
  const originalLines = countNonEmptyLines(totalOutput);
  const keptLines = countNonEmptyLines(kept);
  if (keptLines >= originalLines) return null;

  // The marker names the saved output file, because the replacement no longer
  // has the fields that name it
  const text = `${kept}\n${compressionMarker(originalLines, keptLines, rule.type, output.savedPath)}`;

  // The replacement must never put more text into the context than the
  // output that Claude Code sent
  if (text.length >= output.sentLength || text.length > MAX_REPLACEMENT_LENGTH) return null;
  return text;
}

/**
 * Adaptive re-run detection.
 *
 * Tracks whether the output of a command was recently compressed. If Claude
 * runs the exact same command again within 60 seconds, the output stays raw:
 * Claude is likely re-running because the compressed output was insufficient.
 * On the third run, the output is compressed again (routine check pattern).
 *
 * The 60 seconds count from the end of the compressed run to the start of
 * this run: `durationMs` is the time this run took (the `duration_ms` field
 * of the hook input; 0 when the input has no such field).
 *
 * Returns true when this run must stay raw, and records the state of this
 * run. State is stored in a session-scoped temp file that is automatically
 * cleaned up by the OS.
 */
function isRawRerun(cmd, sessionId, durationMs) {
  // A session id becomes a part of a file name. cleanSessionId replaces every
  // character that could name a folder.
  const safeId = cleanSessionId(sessionId);
  const trackFile = path.join(os.tmpdir(), `sp-compress-${safeId || 'default'}.json`);
  let tracking = {};
  try { tracking = JSON.parse(fs.readFileSync(trackFile, 'utf8')); } catch {}

  const key = cmd.replace(/\s+/g, ' ').trim();
  const prev = tracking[key];
  const now = Date.now();
  const startedAt = now - (Number.isFinite(durationMs) ? durationMs : 0);
  const raw = Boolean(prev && prev.compressed && (startedAt - prev.ts < RERUN_WINDOW_MS));

  tracking[key] = { compressed: !raw, ts: now };
  try { fs.writeFileSync(trackFile, JSON.stringify(tracking)); } catch {}
  return raw;
}

/** The hook output for one hook input. */
function evaluate(data) {
  // ── Global disable check ──
  if (process.env.SP_NO_COMPRESS === '1') return NO_CHANGE;

  const { hook_event_name, tool_name, tool_input, tool_response, session_id, cwd, duration_ms } = data;

  // Only handle Bash tool calls that have ended. A hooks file of an older
  // release starts this hook on PreToolUse; it must change nothing there.
  if (hook_event_name !== 'PostToolUse' || tool_name !== 'Bash') return NO_CHANGE;

  const cmd = (tool_input?.command || '').trim();
  if (!cmd) return NO_CHANGE;

  // ── Project-level disable ──
  if (fs.existsSync(path.join(cwd || process.cwd(), '.sp-no-compress'))) return NO_CHANGE;

  // ── RTK coexistence ──
  // If RTK is already handling this command, don't double-compress
  if (/^rtk(\s|\.exe\s)/.test(cmd)) return NO_CHANGE;

  // ── Never-compress list, then the matching compression rule ──
  const rule = findRule(cmd);
  if (!rule) return NO_CHANGE;

  const output = readOutput(tool_response);
  if (!output) return NO_CHANGE;

  const text = compress(rule, output);
  if (text === null) return NO_CHANGE;

  // ── Adaptive re-run detection ──
  if (isRawRerun(cmd, session_id, duration_ms)) return NO_CHANGE;

  // Keep every field of the response and replace only the text. The fields
  // that name the saved output file go: the replacement is the whole output.
  const updatedToolOutput = { ...tool_response, stdout: text };
  for (const field of SAVED_OUTPUT_FIELDS) delete updatedToolOutput[field];

  return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput } };
}

async function main() {
  let result = NO_CHANGE;
  try {
    // Decode the input as one text: a character of several bytes can be
    // split between two chunks
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    result = evaluate(JSON.parse(input));
  } catch {
    // Fail-open: any error leaves the output of the command unchanged
  }
  process.stdout.write(JSON.stringify(result));
}

main();
