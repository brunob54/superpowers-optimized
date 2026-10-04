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

// The fields of the response of a Bash call that ended in the foreground with
// exit status 0 (measured on Claude Code 2.1.289). A response with any other
// field stays as it is. Three measured examples:
//   - `backgroundTaskId`: Claude Code moved the call to the background, so
//     the output is not complete.
//   - `returnCodeInterpretation`: the exit status was not 0.
//   - `persistedOutputPath` and `persistedOutputSize`: the output was longer
//     than 30,000 characters and Claude Code saved it in a file. Claude then
//     receives a preview of about 2,000 characters and the path of the file,
//     so a replacement could be longer than what Claude receives.
const KNOWN_RESPONSE_FIELDS = new Set([
  'stdout',
  'stderr',
  'interrupted',
  'isImage',
  'noOutputExpected',
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

/**
 * The output of the call, as { stdout, stderr }. Returns null when the hook
 * cannot prove that the response is safe to replace: the response does not
 * have the known shape, the call was interrupted, or the output is an image.
 */
function readOutput(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  if (Object.keys(response).some(field => !KNOWN_RESPONSE_FIELDS.has(field))) return null;

  const { stdout, stderr, interrupted, isImage } = response;
  if (typeof stdout !== 'string' || typeof stderr !== 'string') return null;
  if (interrupted !== false || isImage !== false) return null;

  return { stdout, stderr };
}

/**
 * The text that replaces the output: the text of the rule (the compressed
 * text and the alert lines that the rule removed, see runRule) and the marker
 * line. Returns null when the output must stay raw.
 */
function compress(rule, output) {
  // Normalize line endings (Windows CRLF -> LF)
  const stdout = output.stdout.replace(/\r\n/g, '\n');
  const stderr = output.stderr.replace(/\r\n/g, '\n');

  // If output is too short, compression isn't worth it
  const totalOutput = stdout + stderr;
  if (totalOutput.length < MIN_OUTPUT_LENGTH) return null;

  // The exit status is 0: see KNOWN_RESPONSE_FIELDS
  const kept = runRule(rule, stdout, stderr, 0);
  if (kept === null) return null;

  // Output from which no line was removed stays as it is, so every replaced
  // output carries the marker
  const originalLines = countNonEmptyLines(totalOutput);
  const keptLines = countNonEmptyLines(kept);
  if (keptLines >= originalLines) return null;

  // The replacement must be shorter than the text that it replaces
  const text = `${kept}\n${compressionMarker(originalLines, keptLines, rule.type)}`;
  return text.length < output.stdout.length ? text : null;
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
 * of the hook input). A value that is not a finite number, or is negative,
 * counts as 0.
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
  const startedAt = now - (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0);
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

  // Keep every field of the response and replace only the text
  const updatedToolOutput = { ...tool_response, stdout: text };

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
