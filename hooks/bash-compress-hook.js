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
 *   - output that the rule declines, or from which the rule removes no line
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
]);

// The hook does not read a saved output file above this size
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB (megabytes)

/**
 * The whole output of the call, as { stdout, stderr }. Returns null when the
 * hook cannot prove that the response is safe to replace: the response does
 * not have the known shape, the call was interrupted, the output is an image,
 * or the saved output file is too large or does not belong to this response.
 * A saved output file that cannot be read throws; main() handles the error.
 */
function readOutput(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  if (Object.keys(response).some(field => !KNOWN_RESPONSE_FIELDS.has(field))) return null;

  const { stdout, stderr, interrupted, isImage } = response;
  if (typeof stdout !== 'string' || typeof stderr !== 'string') return null;
  if (interrupted !== false || isImage !== false) return null;

  if (!SAVED_OUTPUT_FIELDS.some(field => field in response)) return { stdout, stderr };

  // `stdout` holds only the start of the output. A rule must see all of it:
  // for example, the summary of a test run is at the end.
  const savedPath = response.persistedOutputPath;
  if (fs.statSync(savedPath).size > MAX_OUTPUT_BYTES) return null;
  const whole = fs.readFileSync(savedPath, 'utf8');
  return whole.startsWith(stdout) ? { stdout: whole, stderr } : null;
}

/**
 * The text that replaces the output: the compressed text and the marker line.
 * Returns null when the output must stay raw.
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

  // Output from which the rule removed no line stays as it is, so every
  // replaced output carries the marker
  const originalLines = countNonEmptyLines(totalOutput);
  const compressedLines = countNonEmptyLines(compressed);
  if (compressedLines >= originalLines) return null;

  return `${compressed}\n${compressionMarker(originalLines, compressedLines, rule.type)}`;
}

/**
 * Adaptive re-run detection.
 *
 * Tracks whether the output of a command was recently compressed. If Claude
 * runs the exact same command again within 60 seconds, the output stays raw:
 * Claude is likely re-running because the compressed output was insufficient.
 * On the third run, the output is compressed again (routine check pattern).
 *
 * Returns true when this run must stay raw, and records the state of this
 * run. State is stored in a session-scoped temp file that is automatically
 * cleaned up by the OS.
 */
function isRawRerun(cmd, sessionId) {
  const trackFile = path.join(os.tmpdir(), `sp-compress-${sessionId || 'default'}.json`);
  let tracking = {};
  try { tracking = JSON.parse(fs.readFileSync(trackFile, 'utf8')); } catch {}

  const key = cmd.replace(/\s+/g, ' ').trim();
  const prev = tracking[key];
  const raw = Boolean(prev && prev.compressed && (Date.now() - prev.ts < RERUN_WINDOW_MS));

  tracking[key] = { compressed: !raw, ts: Date.now() };
  try { fs.writeFileSync(trackFile, JSON.stringify(tracking)); } catch {}
  return raw;
}

/** The hook output for one hook input. */
function evaluate(data) {
  // ── Global disable check ──
  if (process.env.SP_NO_COMPRESS === '1') return NO_CHANGE;

  const { hook_event_name, tool_name, tool_input, tool_response, session_id, cwd } = data;

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
  if (isRawRerun(cmd, session_id)) return NO_CHANGE;

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
