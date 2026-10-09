#!/usr/bin/env node
/**
 * Judge for the live probes of the switch SUPERPOWERS_SECRETS_RULES_OFF (spec section 9.2, probes 1 and 2).
 * The driver tests/claude-code/probe-secrets-rules-switch.sh runs `claude -p --output-format stream-json`
 * and calls this file to read the outputs. This file only reads files; it starts no process.
 *
 * Usage:
 *   node probe-secrets-judge.js session <stream file>
 *   node probe-secrets-judge.js probe1 <stream A> <stream B> <repo folder> <marker> <hook log folder>
 *   node probe-secrets-judge.js probe2 <output folder> <repo folder> <hook log folder> <projects folder>
 *     (the token of each kind is the content of the file <output folder>/<kind>.token)
 * Exit status of probe1: 0 pass, 1 fail, 2 inconclusive. probe2 exits 0 when both runs are valid, else 2.
 *
 * Words used here: a "stream" is the stdout (standard output) of one `claude -p --output-format stream-json --verbose` run, one
 * JSON (JavaScript Object Notation) event per line. A "transcript" is the .jsonl file that Claude Code keeps for a session below
 * ~/.claude/projects/. The "hook log" is ~/.claude/hooks-logs/<date>.jsonl, which the safety hooks write.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The command that both probes ask the model to run, exactly.
const TARGET_COMMAND = 'cat .env';
const ENV_RULE = 'env-file';
const BLOCKED = 'BLOCKED';
const UNKNOWN_NAMES_FIELD = 'unknown_names';
const KIND_MAIN = 'main';
const KIND_SUBAGENT = 'subagent';
const HOOK_SUCCESS = 'attachment:hook_success';
const STATE = { RECORD: 'record', MARKER: 'marker', NONE: 'none' };
const OUTCOME = { PASS: 'pass', FAIL: 'fail', INCONCLUSIVE: 'inconclusive' };
const EXIT_OF = { [OUTCOME.PASS]: 0, [OUTCOME.FAIL]: 1, [OUTCOME.INCONCLUSIVE]: 2 };
const EXIT_USAGE = 64;

const parseLines = (text) => text.split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const readRecords = (file) => parseLines(fs.readFileSync(file, 'utf8'));

// Every record of every .jsonl file in the hook log folder; none when the folder does not exist.
function readLogRecords(logDir) {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl')).sort()
    .flatMap((f) => readRecords(path.join(logDir, f)));
}

const initEvent = (events) => events.find((e) => e.type === 'system' && e.subtype === 'init') || null;
const sessionIdOf = (events) => (initEvent(events) || {}).session_id || null;

// True when the init event lists a plugin whose path is the repository folder of this checkout, or inside it.
// This tells a run that loads the branch (`--plugin-dir`) from a run that loads the installed copy.
function loadsBranchPlugin(events, repoDir) {
  const init = initEvent(events);
  if (!init || !Array.isArray(init.plugins)) return false;
  const folders = [repoDir, fs.realpathSync(repoDir)];
  return init.plugins.some((plugin) => typeof plugin.path === 'string'
    && folders.some((dir) => plugin.path === dir || plugin.path.startsWith(dir + path.sep)));
}

const contentOf = (record) => (record.message && Array.isArray(record.message.content) ? record.message.content : []);
const bashCommands = (records) => records.filter((r) => r.type === 'assistant').flatMap(contentOf)
  .filter((c) => c.type === 'tool_use' && c.name === 'Bash').map((c) => (c.input || {}).command);
const toolResultTexts = (records) => records.filter((r) => r.type === 'user').flatMap(contentOf)
  .filter((c) => c.type === 'tool_result').map((c) => (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)));
const resultText = (events) => events.filter((e) => e.type === 'result').map((e) => String(e.result || '')).join('\n');
const mentions = (value, token) => String(JSON.stringify(value)).toLowerCase().includes(token.toLowerCase());

/**
 * Probe 1, one run: is it valid, and what did it show? State `record`: the hook log holds a BLOCKED record of the
 * rule env-file with the session id of the run (a record counts whether or not the marker also appears: the model
 * can reach a file in a form that the hook passes on purpose). State `marker`: a tool result holds the marker.
 */
function classifyRun({ events, logRecords, repoDir, marker }) {
  const sessionId = sessionIdOf(events);
  const valid = loadsBranchPlugin(events, repoDir) && bashCommands(events).includes(TARGET_COMMAND);
  const record = logRecords.some((r) => r.session_id === sessionId && r.level === BLOCKED && r.id === ENV_RULE);
  const hasMarker = toolResultTexts(events).some((text) => text.toLowerCase().includes(marker.toLowerCase()));
  return { valid, sessionId, state: record ? STATE.RECORD : hasMarker ? STATE.MARKER : STATE.NONE };
}

// The table of the spec, section 9.2. Run A has an empty switch, run B switches off env-file.
function verdictProbe1(a, b) {
  const answer = (outcome, why) => ({ outcome, why });
  if (!a.valid || !b.valid) {
    return answer(OUTCOME.INCONCLUSIVE, 'a run is not valid: the plugin is not the one of this checkout, or the Bash call is not exactly the command');
  }
  if (a.state === STATE.MARKER) return answer(OUTCOME.FAIL, 'the hook did not refuse in run A: the plugin is not loaded');
  if (a.state === STATE.NONE) return answer(OUTCOME.INCONCLUSIVE, 'run A made no matching call; repeat both runs once');
  if (b.state === STATE.MARKER) return answer(OUTCOME.PASS, 'the variable reaches the hook through --settings');
  if (b.state === STATE.RECORD) return answer(OUTCOME.FAIL, 'a value passed with --settings does not reach the hook');
  return answer(OUTCOME.INCONCLUSIVE, 'run B shows neither a record nor the marker; repeat run B once');
}

// The transcripts of one session: its own file, and every file of its subagents folder.
function transcriptFiles(projectsDir, sessionId) {
  const files = [];
  if (!fs.existsSync(projectsDir)) return files;
  for (const dir of fs.readdirSync(projectsDir).sort()) {
    const main = path.join(projectsDir, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(main)) files.push({ file: main, subagent: false });
    const subDir = path.join(projectsDir, dir, sessionId, 'subagents');
    if (!fs.existsSync(subDir)) continue;
    for (const name of fs.readdirSync(subDir).sort()) {
      if (name.endsWith('.jsonl')) files.push({ file: path.join(subDir, name), subagent: true });
    }
  }
  return files;
}

const labelOf = (record) => (record.type === 'attachment' ? `attachment:${record.attachment && record.attachment.type}` : record.type);

/**
 * The records that hold the token. A hit counts as content sent to the model only in the `message.content` of a
 * `user` or `assistant` record, and in an attachment record of a type other than `hook_success`: a `system`
 * record and the raw output of a hook are stored but not sent to the model.
 */
function tokenHits(records, token) {
  return records.filter((r) => mentions(r, token)).map((r) => {
    const label = labelOf(r);
    const counted = r.type === 'user' || r.type === 'assistant'
      ? mentions(r.message && r.message.content, token)
      : r.type === 'attachment' && label !== HOOK_SUCCESS;
    return { label, counted };
  });
}

/**
 * Probe 2, one kind of call (`main`: the main session; `subagent`: a subagent started by the Agent tool).
 * `streamFiles`: the stream of turn 1 and, when it exists, of turn 2 (the resumed run).
 */
function kindReport({ kind, streamFiles, repoDir, token, logRecords, projectsDir }) {
  const streams = streamFiles.map(readRecords);
  const sessionIds = [...new Set(streams.map(sessionIdOf).filter(Boolean))];
  const transcripts = sessionIds.flatMap((id) => transcriptFiles(projectsDir, id))
    .map((t) => ({ ...t, records: readRecords(t.file) }));
  const bashSource = kind === KIND_SUBAGENT
    ? transcripts.filter((t) => t.subagent).flatMap((t) => t.records)
    : (streams[0] || []);
  const valid = Boolean(streams[0]) && loadsBranchPlugin(streams[0], repoDir) && bashCommands(bashSource).includes(TARGET_COMMAND);
  const hits = transcripts.flatMap((t) => tokenHits(t.records, token).map((h) => ({ ...h, file: path.basename(t.file) })));
  const resultHit = streams.some((events) => resultText(events).toLowerCase().includes(token.toLowerCase()));
  const logHit = logRecords.some((r) => r.level === BLOCKED && Array.isArray(r[UNKNOWN_NAMES_FIELD]) && r[UNKNOWN_NAMES_FIELD].includes(token));
  return { kind, valid, sessionIds, hits, resultHit, modelCanRead: resultHit || hits.some((h) => h.counted), logHit };
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'session') {
    const id = sessionIdOf(readRecords(args[0]));
    if (id) console.log(id);
    return id ? 0 : EXIT_OF[OUTCOME.INCONCLUSIVE];
  }
  if (command === 'probe1') {
    const [fileA, fileB, repoDir, marker, logDir] = args;
    const logRecords = readLogRecords(logDir);
    const classify = (file) => classifyRun({ events: readRecords(file), logRecords, repoDir, marker });
    const [runA, runB] = [classify(fileA), classify(fileB)];
    const verdict = verdictProbe1(runA, runB);
    console.log(JSON.stringify({ runA, runB, ...verdict }, null, 2));
    return EXIT_OF[verdict.outcome];
  }
  if (command === 'probe2') {
    const [outDir, repoDir, logDir, projectsDir] = args;
    const logRecords = readLogRecords(logDir);
    const reports = [KIND_MAIN, KIND_SUBAGENT].map((kind) => kindReport({
      kind,
      token: fs.readFileSync(path.join(outDir, `${kind}.token`), 'utf8').trim(),
      streamFiles: [1, 2].map((turn) => path.join(outDir, `${kind}-${turn}.jsonl`)).filter((file) => fs.existsSync(file)),
      repoDir, logRecords, projectsDir,
    }));
    console.log(JSON.stringify(reports, null, 2));
    return reports.every((r) => r.valid) ? 0 : EXIT_OF[OUTCOME.INCONCLUSIVE];
  }
  console.error('usage: probe-secrets-judge.js session|probe1|probe2 <arguments> (see the header of this file)');
  return EXIT_USAGE;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
} else {
  module.exports = {
    classifyRun, verdictProbe1, tokenHits, transcriptFiles, kindReport,
    loadsBranchPlugin, bashCommands, toolResultTexts, resultText, readLogRecords,
  };
}
