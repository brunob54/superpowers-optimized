#!/usr/bin/env node
// Measure where a Claude Code session's context window went.
//
// Written for the acceptance measure of worklist row 13 fix 1 (see
// docs/orchestration-issues.md, Cases 017 and 018): the orchestrator's own
// "prompt material" — the text it writes and re-sends in order to dispatch a
// controller — must stay below 10 percent of the session's content.
//
// The script is committed on purpose. The two earlier versions of this
// measurement lived in a session scratchpad under /private/tmp and were both
// lost, so the same counting rules had to be rediscovered twice.
//
// Two numbers, counted in two different units, on purpose:
//
//   1. Shares by class are BYTES of message content. A share is a proportion,
//      so the unit cancels out; bytes need no tokenizer and are exact.
//   2. Peak context is TOKENS, read from the `usage` object of each API
//      response, and it is a MAXIMUM over requests, never a sum.
//
// THE COUNTING TRAP THIS SCRIPT AVOIDS. One API response is written to the
// transcript as several records that all repeat the same `usage` object. A
// naive sum over records therefore overcounts tokens by 3 to 5 times. Every
// token figure below is deduplicated on `requestId` first. (Verified on a real
// transcript: 166 assistant records, 90 distinct requests, one requestId
// carrying 6 records.)
//
// Worklist row 27 added four measures on top of the shares:
//
//   3. A second share table, "model-visible", that leaves out the attachment
//      records the model never sees (`hook_success` and `prompt_snapshot`).
//   4. The skill body: the growth of the context, in tokens, from the request
//      that made a Skill tool call to the next request; and a count of reads
//      under any path containing `/skills/`.
//   5. PARTIAL notices: how many times the Read tool cut a file at its token
//      cap, and whether the agent then paged to the end, paged short, or did
//      not page at all.
//   6. File coverage: for every file whose first read was cut, the union of
//      the line ranges the agent received over BOTH hand-over routes, the
//      uncovered ranges, and whether the last line was reached. A "hand-over"
//      is the moment a large file reaches the model in pieces:
//        - Read route: a Read call returns at most about 25,000 tokens, then
//          a notice "PARTIAL view — <path>: showing lines A-B of T total"
//          names the next offset. The notice sits in the tool result or in a
//          separate attachment record (type read_truncation_notice). A Read
//          that the tool refuses for the size of the file ("exceeds maximum
//          allowed size" or "tokens") is the same hand-over with no line
//          delivered: a cut first read, so the file is listed.
//        - cat route: a Bash `cat <file>` whose output exceeds 30,000
//          characters is persisted; the result says "Output too large (N KB).
//          Full output saved to: <path>" with a 2 KB preview. The agent may
//          read the persisted path back with sed, head, tail, awk or Read.
//      A PARTIAL count alone cannot see the cat route, which is why the
//      acceptance measure is the line coverage over both routes.
//
//      Line numbering. The Read tool counts the empty text after a file's
//      final newline as a line of its own, so its total (`totalLines` in a
//      Read record, "of T total" in a notice) is one more than sed or wc
//      count. Every figure of this section is in lines as sed and wc count
//      them: the Read total minus that empty line, unless a page showed text
//      on the last line (a file without a final newline). A received line
//      number above the total is that empty line and is not counted, so a
//      file received whole gives exactly 100 percent.
//
//      Where a total comes from. The total is the one that the transcript
//      states for the time of the read: a PARTIAL notice or a Read record.
//      Only when no record states a total is a text on disk counted: first
//      the persisted copy of a `cat` that was the whole command (Claude Code
//      wrote that copy at the time of the read), then the file itself. The
//      file may have changed since the read, so that total is labelled
//      "counted on disk today". A pattern range (`sed -n '/A/,/B/p'`) is
//      resolved on the same text, and the row names which text it was.
//
//      Failed calls. A Read result with `is_error: true` delivered no line
//      and is skipped; only a refusal for size (above) starts a row. A Bash
//      result is never skipped on `is_error`: for Bash the field is the exit
//      status of the whole command, and a `cat` inside a command that failed
//      at a later step still printed its file.
//
// Usage:
//   node tools/measure-context.js <transcript.jsonl> [--json]
//
// The transcript is a session file
// (~/.claude/projects/<project>/<session-uuid>.jsonl) or a subagent file
// (<session-uuid>/subagents/agent-<id>.jsonl). Both have the same shape, so a
// controller's window is measured with the same command.

'use strict';

const fs = require('fs');
const path = require('path');

// A Write whose file name begins like this is a dispatch value file — the
// answers/lens/findings text a controller or the orchestrator writes for a
// prompt to be filled from. Those bytes are prompt material; other writes are
// ordinary work (a log entry, a source edit) and are not.
const VALUE_FILE_NAME = /^dispatch-\d+-/;
// A Bash command that fills a prompt template. These bytes are prompt material.
const FILL_COMMAND = 'fill-prompt.js';
// Tool names that dispatch a subagent. `Task` is the older name for `Agent`.
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const READ_TOOL = 'Read';
const BASH_TOOL = 'Bash';
const SKILL_TOOL = 'Skill';
// A path segment that marks a read of a skill directory.
const SKILL_DIRECTORY = '/skills/';
// Attachment record kinds the model never sees: a hook's success record and
// the harness's snapshot of the system prompt.
const MODEL_INVISIBLE_ATTACHMENTS = ['hook_success', 'prompt_snapshot'];

// Classes reported, in the order they are printed.
const CLASSES = [
  'agent-prompts',
  'fill-commands',
  'value-files',
  'bash-commands',
  'other-tool-inputs',
  'other-writes',
  'thinking',
  'assistant-text',
  'read-results',
  'bash-results',
  'agent-reports',
  'other-results',
  'attachments',
  'user-messages',
];
// The three classes that make up prompt material: what the session writes and
// re-sends so that a subagent can be dispatched.
const PROMPT_MATERIAL = ['agent-prompts', 'fill-commands', 'value-files'];

// --- Hand-over patterns (row 27) ---
// Shell commands the coverage engine understands. The two routes are named
// after what made the first read: the Read tool, or the `cat` command.
const SHELL = { CAT: 'cat', SED: 'sed', AWK: 'awk', HEAD: 'head', TAIL: 'tail', CD: 'cd' };
const ROUTE_READ = READ_TOOL;
const ROUTE_CAT = SHELL.CAT;
// The notice the Read tool leaves when a file exceeds its token cap.
const PARTIAL_NOTICE = /PARTIAL view — (\S+?): showing lines (\d+)-(\d+) of (\d+) total/g;
// The marker in a Bash result whose output was too large and was persisted.
const PERSISTED_OUTPUT = /Full output saved to: (\S+)/;
// The preview text of a persisted result sits between these two markers; the
// last preview line is usually cut in the middle, so only complete lines count.
const PREVIEW_START = /Preview \(first [^)]*\):\r?\n/;
const PREVIEW_END = /\r?\n\.\.\.(?:\r?\n)?<\/persisted-output>\s*$/;
const LINE_BREAK = /\r?\n/;
// One line of a Read result: line number, a tab, then the text; and the same
// line when the text is empty.
const READ_LINE = /^\s*(\d+)\t/;
const EMPTY_LAST_LINE = /^\s*(\d+)\t\r?$/;
// A shell assignment `NAME=value` at the start of a command unit, so that a
// later `$NAME` can be resolved to the path it names.
const SHELL_ASSIGNMENT = /(?:^|[;&|\n]\s*)([A-Za-z_]\w*)=(["']?)([^\s"';|&]+)\2/g;
// The start of a heredoc (`<<WORD`, `<<-WORD`, `<<'WORD'`): the lines that
// follow, up to a line equal to WORD, are data the command writes.
const HEREDOC_START = /^<<-?\s*(["']?)(\w+)\1/;
// A trailing `{print}` on an awk program changes nothing about which lines
// are printed.
const AWK_PRINT = /\s*\{\s*print\s*\}\s*$/;
// Where a file's total line count came from, when a record states it.
const TOTAL_FROM_NOTICE = 'from a PARTIAL notice';
const TOTAL_FROM_READ = 'from a Read result';
// Where a text was read when no record states a total, and for every pattern
// range: the saved output of a `cat`, written at the time of the read, or the
// file itself, which may have changed since the read.
const ON_PERSISTED_COPY = 'on the persisted copy';
const ON_DISK_TODAY = 'on disk today';
// The text of a Read that the tool refused for the size of the file. Real
// transcripts hold two forms, both on a result with `is_error: true`:
//   "File content (300.5KB) exceeds maximum allowed size (256KB). Use offset
//    and limit parameters to read specific portions of the file, ..."
//   "File content (30000 tokens) exceeds maximum allowed tokens (25000). ..."
// Other failed Reads ("File does not exist.", an input that is not valid)
// do not match and start no row.
const READ_REFUSED_FOR_SIZE = /exceeds maximum allowed (?:size|tokens)/;
const REFUSED_FOR_SIZE = 'refused for size';
const UNKNOWN = 'unknown';
// The end of a range that runs to the end of the file.
const TO_END = Infinity;

function bytes(value) {
  if (value === undefined || value === null) return 0;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.byteLength(s, 'utf8');
}

function readRecords(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A partial last line is normal while a session is still running.
    }
  }
  return out;
}

// Tokens held in the model's context for one request. `output_tokens` is what
// the model produced, not what it was holding, so it is excluded.
function contextTokens(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0);
}

// The text of a tool_result block: a string, or a list of text blocks.
function resultText(block) {
  const content = block.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (part && part.text) || '').join('\n');
}

function percent(part, whole) {
  return whole ? (part * 100) / whole : 0;
}

// --- The measurement ---

function measure(records) {
  const state = {
    totals: Object.fromEntries(CLASSES.map((c) => [c, 0])),
    // Bytes of the attachment records the model never sees, by kind.
    excluded: Object.fromEntries(MODEL_INVISIBLE_ATTACHMENTS.map((k) => [k, 0])),
    // tool_use id -> tool_use block, so a tool_result can be attributed to its
    // tool and read with its input.
    toolUseById: new Map(),
    // requestId -> context tokens. A Map keyed on requestId is the deduplication.
    requests: new Map(),
    // requestId -> names of the skills called by that request.
    skillCallsByRequest: new Map(),
    skillDirectoryReads: 0,
    assistantRecords: 0,
    // Counted so the report can say when thinking text was not stored: the
    // transcript keeps the signature and drops the text, so those bytes are
    // missing from `content` and every share is an upper bound.
    thinkingBlocks: 0,
    coverage: newCoverage(),
  };

  records.forEach((rec, index) => {
    if (rec.type === 'attachment') measureAttachment(state, rec, index);
    else if (rec.type === 'assistant') measureAssistant(state, rec);
    else if (rec.type === 'user') measureUser(state, rec, index);
  });

  const { totals, excluded, requests } = state;
  const content = CLASSES.reduce((sum, c) => sum + totals[c], 0);
  const promptMaterial = PROMPT_MATERIAL.reduce((sum, c) => sum + totals[c], 0);
  const peakTokens = requests.size ? Math.max(...requests.values()) : 0;
  const excludedBytes = Object.values(excluded).reduce((a, b) => a + b, 0);
  const modelVisibleContent = content - excludedBytes;

  return Object.assign({
    totals,
    content,
    promptMaterial,
    promptMaterialPercent: percent(promptMaterial, content),
    peakTokens,
    assistantRecords: state.assistantRecords,
    distinctRequests: requests.size,
    thinkingBlocks: state.thinkingBlocks,
    thinkingTextStored: totals.thinking > 0,
    modelVisible: {
      totals: Object.assign({}, totals, { attachments: totals.attachments - excludedBytes }),
      content: modelVisibleContent,
      excluded,
      promptMaterialPercent: percent(promptMaterial, modelVisibleContent),
    },
    skillBody: skillBody(requests, state.skillCallsByRequest),
    skillDirectoryReads: state.skillDirectoryReads,
  }, finishCoverage(state.coverage));
}

function measureAttachment(state, rec, index) {
  const size = bytes(rec.attachment);
  state.totals.attachments += size;
  const kind = rec.attachment && rec.attachment.type;
  if (kind in state.excluded) state.excluded[kind] += size;
  trackNoticeAttachment(state.coverage, rec, index);
}

function measureAssistant(state, rec) {
  state.assistantRecords += 1;
  const msg = rec.message || {};
  const key = rec.requestId || msg.id || `norequestid-${rec.uuid}`;
  if (!state.requests.has(key)) state.requests.set(key, contextTokens(msg.usage));

  for (const block of Array.isArray(msg.content) ? msg.content : []) {
    if (block.type === 'thinking') {
      state.thinkingBlocks += 1;
      state.totals.thinking += bytes(block.thinking);
    } else if (block.type === 'text') {
      state.totals['assistant-text'] += bytes(block.text);
    } else if (block.type === 'tool_use') {
      classifyToolUse(block, state.totals, state.toolUseById);
      if (block.name === SKILL_TOOL) {
        if (!state.skillCallsByRequest.has(key)) state.skillCallsByRequest.set(key, []);
        state.skillCallsByRequest.get(key).push((block.input || {}).skill || '?');
      }
      if (readsSkillDirectory(block)) state.skillDirectoryReads += 1;
    }
  }
}

function measureUser(state, rec, index) {
  const content = (rec.message || {}).content;
  if (!Array.isArray(content)) {
    state.totals['user-messages'] += bytes(content);
    return;
  }
  for (const block of content) {
    if (block.type === 'tool_result') {
      const use = state.toolUseById.get(block.tool_use_id) || {};
      const size = bytes(block.content);
      if (use.name === READ_TOOL) state.totals['read-results'] += size;
      else if (use.name === BASH_TOOL) state.totals['bash-results'] += size;
      else if (AGENT_TOOLS.has(use.name)) state.totals['agent-reports'] += size;
      else state.totals['other-results'] += size;
      trackToolResult(state.coverage, rec, index, block, use);
    } else if (block.type === 'text') {
      state.totals['user-messages'] += bytes(block.text);
    }
  }
}

function classifyToolUse(block, totals, toolUseById) {
  const name = block.name;
  const input = block.input || {};
  toolUseById.set(block.id, block);

  if (AGENT_TOOLS.has(name)) {
    totals['agent-prompts'] += bytes(input.prompt);
    const rest = Object.assign({}, input);
    delete rest.prompt;
    totals['other-tool-inputs'] += bytes(rest);
    return;
  }

  if (name === BASH_TOOL) {
    const command = input.command || '';
    const size = bytes(command);
    if (command.includes(FILL_COMMAND)) totals['fill-commands'] += size;
    else totals['bash-commands'] += size;
    const rest = Object.assign({}, input);
    delete rest.command;
    totals['other-tool-inputs'] += bytes(rest);
    return;
  }

  if (WRITE_TOOLS.has(name)) {
    const size = bytes(input.content) + bytes(input.new_string);
    const base = path.basename(input.file_path || '');
    if (VALUE_FILE_NAME.test(base)) totals['value-files'] += size;
    else totals['other-writes'] += size;
    return;
  }

  totals['other-tool-inputs'] += bytes(input);
}

// A Read call, or a Bash command, that names a path under a skill directory.
function readsSkillDirectory(block) {
  const input = block.input || {};
  if (block.name === READ_TOOL) return (input.file_path || '').includes(SKILL_DIRECTORY);
  if (block.name === BASH_TOOL) return (input.command || '').includes(SKILL_DIRECTORY);
  return false;
}

// The skill body, in tokens: for each request that made a Skill call, the
// context tokens of the next request minus this one. The jump holds the skill
// body plus whatever else arrived with it (the tool result, hook records),
// which is what the row asks for: the cost of the Skill call as the API saw it.
function skillBody(requests, skillCallsByRequest) {
  const keys = Array.from(requests.keys());
  const perCall = [];
  let calls = 0;
  keys.forEach((key, i) => {
    const skills = skillCallsByRequest.get(key);
    if (!skills) return;
    calls += skills.length;
    const next = keys[i + 1];
    const tokens = next === undefined ? 0 : requests.get(next) - requests.get(key);
    perCall.push({ skill: skills.join(' + '), tokens, nextRequestSeen: next !== undefined });
  });
  return { calls, tokens: perCall.reduce((sum, c) => sum + c.tokens, 0), perCall };
}

// --- File coverage over both hand-over routes (row 27) ---

function newCoverage() {
  return {
    files: new Map(),           // file path -> state, in first-seen order
    aliases: new Map(),         // persisted output path -> file path
    notices: [],                // every PARTIAL notice, once per tool call
    noticedToolUses: new Set(), // tool_use ids whose notice is already counted
    diskText: new Map(),        // file path -> its text on disk and where it was read, or null
  };
}

// The state of one file. A persisted output path is an alias of the file it
// was made from, so reads of the copy count for the original.
function fileFor(coverage, rawPath) {
  const filePath = coverage.aliases.get(rawPath) || rawPath;
  if (!coverage.files.has(filePath)) {
    coverage.files.set(filePath, {
      path: filePath,
      firstRoute: null,       // ROUTE_READ or ROUTE_CAT
      cut: false,             // the first read did not deliver the whole file
      refused: false,         // the first read was a Read refused for the size of the file
      exactCopy: null,        // persisted output of a `cat` that was the whole command
      patternSource: null,    // where the text of a resolved pattern range was read
      whole: false,           // one call delivered the whole file
      covered: new Set(),     // line numbers received
      openRanges: [],         // starts of ranges that run to the end of the file
      readTotal: null,        // total lines as the Read tool counts them
      totalSource: null,
      lastLineHasText: null,  // true when a page showed text on the Read total's line
      lastRangeRecord: -1,    // index of the last record that delivered lines
      lastLineReached: null,
      events: [],
    });
  }
  return coverage.files.get(filePath);
}

function firstRead(file, route, cut, whole, refused = false) {
  if (!file.firstRoute) {
    file.firstRoute = route;
    file.cut = cut;
    file.refused = refused;
  }
  if (whole) file.whole = true;
}

// Record delivered lines. A range to TO_END waits for the total; it still
// counts as a delivery for the "paged" classification of a notice.
function addRange(file, from, to, recordIndex, event) {
  if (!(from >= 1) || !(to >= from)) return;
  file.lastRangeRecord = Math.max(file.lastRangeRecord, recordIndex);
  if (to === TO_END) {
    file.openRanges.push(from);
    file.events.push(`${event} -> ${from}-end`);
    return;
  }
  for (let line = from; line <= to; line += 1) file.covered.add(line);
  file.events.push(`${event} -> ${from}-${to}`);
}

// A PARTIAL notice's total is preferred over a Read result's, although both
// count lines the same way; the label then says which one the reader sees.
function setTotal(file, total, source) {
  if (!(total >= 1)) return;
  if (file.readTotal === null || source === TOTAL_FROM_NOTICE) {
    file.readTotal = total;
    file.totalSource = source;
  }
}

// The file's total lines as sed and wc count them, with its source. The total
// that the transcript states for the time of the read comes first. The Read
// tool's total (`totalLines`, "of T total") is the wc count plus 1 when the
// file ends with a newline, because the tool numbers the empty text after
// that newline as a line; so 1 is subtracted, unless a page showed text on
// that last line. Only when no record states a total is a text on disk
// counted, and the source then says which text.
function fileTotal(coverage, file) {
  if (file.readTotal !== null) {
    return { lines: file.readTotal - (file.lastLineHasText ? 0 : 1), source: file.totalSource };
  }
  const text = textOnDisk(coverage, file);
  return text ? { lines: text.lines.length, source: `counted ${text.where}` } : null;
}

function noticesIn(text) {
  return Array.from(text.matchAll(PARTIAL_NOTICE)).map((m) => ({
    path: m[1], from: Number(m[2]), to: Number(m[3]), total: Number(m[4]),
  }));
}

// Count a notice for `file` once per tool call. `rawPath` is the path the
// notice or the Read named, which is the persisted copy on the cat route.
function registerFileNotice(coverage, file, key, notice, rawPath, recordIndex) {
  if (coverage.noticedToolUses.has(key)) return;
  coverage.noticedToolUses.add(key);
  coverage.notices.push(Object.assign({}, notice, {
    path: file.path, persisted: rawPath !== file.path, recordIndex,
  }));
}

// A notice carried by an attachment record (type read_truncation_notice).
function trackNoticeAttachment(coverage, rec, index) {
  const attachment = rec.attachment;
  if (!attachment || typeof attachment !== 'object') return;
  const text = typeof attachment.banner === 'string' ? attachment.banner : JSON.stringify(attachment);
  for (const notice of noticesIn(text)) {
    const file = fileFor(coverage, notice.path);
    setTotal(file, notice.total, TOTAL_FROM_NOTICE);
    firstRead(file, ROUTE_READ, true, false);
    registerFileNotice(coverage, file, attachment.toolUseID || `${notice.path}:${notice.from}`, notice, notice.path, index);
  }
}

function trackToolResult(coverage, rec, index, block, use) {
  if (use.name === READ_TOOL) trackRead(coverage, rec, index, block, use.input || {});
  else if (use.name === BASH_TOOL) trackBash(coverage, rec, index, block, use.input || {});
}

// A Read that failed delivered no line, so it is not a read of the file. One
// failure is a hand-over: the tool refused the call for the size of the file.
// That is a cut first read with no line received, so the file gets a row and
// its coverage comes from the page reads that follow. (This rule is for the
// Read tool only: on a Bash result `is_error` is the exit status of the whole
// command. Of 71 failed Bash commands holding a plain `cat` in the measured
// transcripts, 69 had more than one step, so the `cat` may well have printed
// its file before a later step failed.)
function trackFailedRead(coverage, rawPath, text) {
  if (!READ_REFUSED_FOR_SIZE.test(text)) return;
  const file = fileFor(coverage, rawPath);
  firstRead(file, ROUTE_READ, true, false, true);
  file.events.push(`${READ_TOOL} ${REFUSED_FOR_SIZE} -> no line`);
}

function trackRead(coverage, rec, index, block, input) {
  const rawPath = input.file_path || '';
  if (!rawPath) return;
  const text = resultText(block);
  if (block.is_error) {
    trackFailedRead(coverage, rawPath, text);
    return;
  }
  const file = fileFor(coverage, rawPath);
  const info = (rec.toolUseResult || {}).file || {};
  // The harness's own record of what was returned is preferred; the line
  // numbers printed in the result text are the fallback.
  const numbers = text.split(LINE_BREAK).map((l) => READ_LINE.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  const start = info.startLine || (numbers.length ? numbers[0] : (input.offset || 1));
  const end = info.numLines ? start + info.numLines - 1 : (numbers.length ? numbers[numbers.length - 1] : start - 1);
  const inText = noticesIn(text);
  const cut = Boolean(info.truncatedByTokenCap) || inText.length > 0;
  const paged = input.offset !== undefined || input.limit !== undefined;

  if (info.totalLines) {
    setTotal(file, info.totalLines, TOTAL_FROM_READ);
    // A page that shows the Read total's own line says whether that line is
    // the empty one after the final newline (then the total is one too many)
    // or real text (a file without a final newline).
    const lines = text.split(LINE_BREAK);
    const lastLine = lines[lines.length - 1];
    const shown = READ_LINE.exec(lastLine);
    if (shown && Number(shown[1]) === info.totalLines) file.lastLineHasText = !EMPTY_LAST_LINE.test(lastLine);
  }
  firstRead(file, ROUTE_READ, cut, !paged && !cut && start === 1);
  const label = `${READ_TOOL}${paged ? ` offset=${input.offset} limit=${input.limit}` : ''}${cut ? ' (cut)' : ''}`;
  addRange(file, start, end, index, label);
  if (cut) {
    const notice = inText[0] || { from: start, to: end, total: info.totalLines || null };
    if (inText[0]) setTotal(file, notice.total, TOTAL_FROM_NOTICE);
    registerFileNotice(coverage, file, block.tool_use_id, notice, rawPath, index);
  }
}

// Resolve `$NAME`, `${NAME}` and `"$NAME"` from assignments in the same
// command, so that `S=<path>; sed -n '1,9p' $S` names the path.
function substituteShellVariables(command) {
  let out = command;
  for (const m of command.matchAll(SHELL_ASSIGNMENT)) {
    const [, name, , value] = m;
    out = out.split(`"\${${name}}"`).join(value)
      .split(`"$${name}"`).join(value)
      .split(`\${${name}}`).join(value)
      .replace(new RegExp(`\\$${name}(?![A-Za-z0-9_])`, 'g'), value);
  }
  return out;
}

// Split a command into units (at an unquoted `;`, `&&`, `||` or newline) and
// each unit into pipeline segments (at an unquoted `|`). Quotes stay in the
// text. A heredoc body is dropped: it is data the command writes, not a read.
function splitShell(command) {
  const units = [];
  let segments = [];
  let current = '';
  let quote = null;
  let heredoc = null;
  const endSegment = () => { segments.push(current.trim()); current = ''; };
  const endUnit = () => { endSegment(); units.push(segments.filter(Boolean)); segments = []; };
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      i += 1;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i += 1;
    } else if (ch === '\\') {
      current += command.slice(i, i + 2);
      i += 2;
    } else if (ch === '\n') {
      endUnit();
      i += 1;
      if (heredoc) {
        i = skipHeredocBody(command, i, heredoc);
        heredoc = null;
      }
    } else if (ch === ';') {
      endUnit();
      i += 1;
    } else if (ch === '&' && command[i + 1] === '&') {
      endUnit();
      i += 2;
    } else if (ch === '|' && command[i + 1] === '|') {
      endUnit();
      i += 2;
    } else if (ch === '|') {
      endSegment();
      i += 1;
    } else if (ch === '<' && command[i + 1] === '<' && HEREDOC_START.test(command.slice(i))) {
      const m = HEREDOC_START.exec(command.slice(i));
      heredoc = m[2];
      i += m[0].length;
    } else {
      current += ch;
      i += 1;
    }
  }
  endUnit();
  return units.filter((u) => u.length);
}

// The index just after the heredoc body that starts at `from`: the lines up
// to and including the one equal to `delimiter`.
function skipHeredocBody(command, from, delimiter) {
  let pos = from;
  while (pos < command.length) {
    let lineEnd = command.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = command.length;
    const line = command.slice(pos, lineEnd).trim();
    pos = lineEnd + 1;
    if (line === delimiter) break;
  }
  return Math.min(pos, command.length);
}

// The words of one segment, with the quotes removed.
function shellWords(segment) {
  const words = [];
  let word = '';
  let quote = null;
  let inWord = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else {
      word += ch;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

// The words of a segment that can be file operands: not flags, not
// redirections.
function fileWords(words) {
  return words.slice(1).filter((w) => !/^(-|\d*[<>])/.test(w));
}

function absolutePath(p, cwd) {
  if (path.posix.isAbsolute(p) || !cwd) return p;
  return path.posix.join(cwd, p);
}

// The complete lines in a persisted result's preview. The preview ends with a
// line cut in the middle, so only lines that end with a newline are counted.
function previewLineCount(text) {
  const start = PREVIEW_START.exec(text);
  if (!start) return 0;
  const preview = text.slice(start.index + start[0].length).replace(PREVIEW_END, '');
  return preview.split(LINE_BREAK).length - 1;
}

function trackBash(coverage, rec, index, block, input) {
  const text = resultText(block);
  const command = substituteShellVariables(input.command || '');
  const persisted = PERSISTED_OUTPUT.exec(text);
  let cwd = rec.cwd || '';

  const units = splitShell(command).map((unit) => ({ unit, words: shellWords(unit[0]) }));
  // A persisted output is the text of one file, and nothing else, only when
  // one `cat` was the whole command; a `cd` before it prints nothing.
  const printingUnits = units.filter(({ words }) => words[0] !== SHELL.CD).length;
  for (const { unit, words } of units) {
    if (words[0] === SHELL.CD && words[1]) {
      cwd = absolutePath(words[1], cwd);
      continue;
    }
    // A plain `cat` of one file starts tracking that file, whether or not
    // its output was persisted.
    const operands = fileWords(words);
    if (unit.length === 1 && words[0] === SHELL.CAT && operands.length === 1) {
      const file = fileFor(coverage, absolutePath(operands[0], cwd));
      if (persisted) {
        coverage.aliases.set(persisted[1], file.path);
        if (printingUnits === 1) file.exactCopy = persisted[1];
        const preview = previewLineCount(text);
        firstRead(file, ROUTE_CAT, true, false);
        addRange(file, 1, preview, index, `${SHELL.CAT} persisted (${preview} complete preview lines)`);
        continue;
      }
      firstRead(file, ROUTE_CAT, false, true);
    }
    // A persisted output of anything else cannot be attributed to a file.
    if (persisted) continue;
    trackPipeline(coverage, unit, cwd, index);
  }
}

// A pipeline delivers lines of the first tracked file it names; every later
// segment is a filter on that stream of lines. Ranges are kept as file line
// numbers throughout, so a `head` after a `sed` selects among the lines the
// `sed` let through.
function trackPipeline(coverage, unit, cwd, index) {
  let file = null;
  let stream = null;
  for (const segment of unit) {
    const words = shellWords(segment);
    const named = trackedFileNamed(coverage, words, cwd);
    if (!file) {
      if (!named) continue;
      file = named;
      stream = [[1, TO_END]];
    } else if (named && named !== file) {
      break;
    }
    const filter = parseFilter(words);
    if (!filter) {
      file.events.push(`not a line read, nothing counted: ${segment.slice(0, 60)}`);
      return;
    }
    stream = applyFilter(coverage, file, stream, filter);
    if (!stream.length) return;
  }
  if (!file) return;
  for (const [from, to] of stream) addRange(file, from, to, index, unit.join(' | ').slice(0, 60));
}

// The tracked file that a segment names, by absolute path, by a path relative
// to the working directory, or by a persisted alias of it.
function trackedFileNamed(coverage, words, cwd) {
  for (const word of words) {
    const candidate = absolutePath(word, cwd);
    const filePath = coverage.aliases.get(candidate) || candidate;
    if (coverage.files.has(filePath)) return coverage.files.get(filePath);
  }
  return null;
}

// What a command lets through, as a filter: `items` are line selections
// (numeric ranges, or pattern pairs resolved against the file), `lastLines`
// is a `tail -n N`. Null means the command is not a line read (grep, wc, a
// program that rewrites lines).
function parseFilter(words) {
  const command = words[0];
  let m;
  if (command === SHELL.CAT) return { items: [{ from: 1, to: TO_END }], lastLines: null };
  if (command === SHELL.SED) return sedFilter(words);
  if (command === SHELL.AWK) return awkFilter(words);
  if (command === SHELL.HEAD) {
    if ((m = lineCountOption(words))) return { items: [{ from: 1, to: Number(m[1]) }], lastLines: null };
    return null;
  }
  if (command === SHELL.TAIL) {
    if ((m = /^\+(\d+)$/.exec(tailOperand(words)))) return { items: [{ from: Number(m[1]), to: TO_END }], lastLines: null };
    if ((m = lineCountOption(words))) return { items: [], lastLines: Number(m[1]) };
    return null;
  }
  return null;
}

// `-n N`, `-nN`, `-N` or `--lines=N` on head and tail.
function lineCountOption(words) {
  const joined = words.slice(1).join(' ');
  return /(?:^|\s)(?:-n\s*|-|--lines=)(\d+)(?=\s|$)/.exec(joined);
}

// The `+N` of `tail -n +N` or `tail +N`.
function tailOperand(words) {
  const joined = words.slice(1).join(' ');
  const m = /(?:^|\s)(?:-n\s*)?(\+\d+)(?=\s|$)/.exec(joined);
  return m ? m[1] : '';
}

// Every expression of a sed call: each `-e`, or the first non-flag word.
function sedFilter(words) {
  const expressions = [];
  let sawExpressionFlag = false;
  for (let i = 1; i < words.length; i += 1) {
    const w = words[i];
    if (w === '-e' || w === '--expression') {
      expressions.push(words[i + 1] || '');
      i += 1;
      sawExpressionFlag = true;
    } else if (w.startsWith('--expression=')) {
      expressions.push(w.slice('--expression='.length));
      sawExpressionFlag = true;
    } else if (w.startsWith('-') && w.length > 1) {
      // A combined flag ending in `e` (`-ne`) takes the next word.
      if (!w.startsWith('--') && w.endsWith('e')) {
        expressions.push(words[i + 1] || '');
        i += 1;
        sawExpressionFlag = true;
      }
    } else if (!sawExpressionFlag && expressions.length === 0) {
      expressions.push(w);
    }
  }
  const items = [];
  for (const expression of expressions) {
    for (const part of expression.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
      const item = sedItem(part);
      if (item) items.push(item);
    }
  }
  return { items, lastLines: null };
}

// One sed selection: `A,Bp`, `Ap`, `A,$p`, `/A/,/B/p`, `/A/,$p`.
function sedItem(part) {
  let m;
  if ((m = /^(\d+),(\d+)p$/.exec(part))) return { from: Number(m[1]), to: Number(m[2]) };
  if ((m = /^(\d+)p$/.exec(part))) return { from: Number(m[1]), to: Number(m[1]) };
  if ((m = /^(\d+),\$p$/.exec(part))) return { from: Number(m[1]), to: TO_END };
  if ((m = /^\/(.*?)\/,\/(.*?)\/p$/.exec(part))) return { startPattern: m[1], endPattern: m[2] };
  if ((m = /^\/(.*?)\/,\$p$/.exec(part))) return { startPattern: m[1], endPattern: null };
  return null;
}

// The program of an awk call (after `-F x` and `-v x=y` options), when it
// only selects lines by number or by pattern pair.
function awkFilter(words) {
  let program = null;
  for (let i = 1; i < words.length && program === null; i += 1) {
    const w = words[i];
    if (w === '-F' || w === '-v' || w === '-f') i += 1;
    else if (!w.startsWith('-')) program = w;
  }
  if (program === null) return null;
  const selection = program.replace(AWK_PRINT, '').trim();
  let m;
  const one = (from, to) => ({ items: [{ from, to }], lastLines: null });
  if ((m = /^NR\s*>=\s*(\d+)\s*&&\s*NR\s*<=\s*(\d+)$/.exec(selection))) return one(Number(m[1]), Number(m[2]));
  if ((m = /^NR\s*==\s*(\d+)\s*,\s*NR\s*==\s*(\d+)$/.exec(selection))) return one(Number(m[1]), Number(m[2]));
  if ((m = /^NR\s*>=\s*(\d+)$/.exec(selection))) return one(Number(m[1]), TO_END);
  if ((m = /^NR\s*>\s*(\d+)$/.exec(selection))) return one(Number(m[1]) + 1, TO_END);
  if ((m = /^NR\s*<=\s*(\d+)$/.exec(selection))) return one(1, Number(m[1]));
  if ((m = /^NR\s*<\s*(\d+)$/.exec(selection))) return one(1, Number(m[1]) - 1);
  if ((m = /^NR\s*==\s*(\d+)$/.exec(selection))) return one(Number(m[1]), Number(m[1]));
  if ((m = /^\/(.*?)\/,\/(.*?)\/$/.exec(selection))) return { items: [{ startPattern: m[1], endPattern: m[2] }], lastLines: null };
  if ((m = /^\/(.*?)\/,0$/.exec(selection))) return { items: [{ startPattern: m[1], endPattern: null }], lastLines: null };
  return null;
}

// Apply a filter to a stream of file lines. Numeric selections are positions
// in the stream; a pattern pair is resolved on the file, which is only
// meaningful when the stream is still the whole file.
function applyFilter(coverage, file, stream, filter) {
  const wholeFile = stream.length === 1 && stream[0][0] === 1 && stream[0][1] === TO_END;
  const positions = [];
  for (const item of filter.items) {
    if (item.from !== undefined) positions.push([item.from, item.to]);
    else if (wholeFile) positions.push(...patternRanges(coverage, file, item.startPattern, item.endPattern));
    else file.events.push(`pattern range /${item.startPattern}/ on piped text not resolved`);
  }
  let source = stream;
  if (filter.lastLines !== null) {
    if (!Number.isFinite(streamLength(source))) {
      const total = fileTotal(coverage, file);
      if (!total) {
        file.events.push(`${SHELL.TAIL} -n ${filter.lastLines} not resolved: total lines unknown`);
        return [];
      }
      source = source.map(([from, to]) => [from, Math.min(to, total.lines)]).filter(([from, to]) => to >= from);
    }
    const length = streamLength(source);
    positions.push([Math.max(1, length - filter.lastLines + 1), length]);
  }
  return mergeRanges(selectPositions(source, positions));
}

function streamLength(stream) {
  return stream.reduce((sum, [from, to]) => sum + (to - from + 1), 0);
}

// The file lines at the given positions of a stream of ranges.
function selectPositions(stream, positions) {
  const out = [];
  for (const [a, b] of positions) {
    let position = 1;
    for (const [from, to] of stream) {
      const end = position + (to - from);
      const low = Math.max(a, position);
      const high = Math.min(b, end);
      if (low <= high) out.push([from + (low - position), from + (high - position)]);
      if (!Number.isFinite(end)) break;
      position = end + 1;
    }
  }
  return out;
}

// Sorted ranges with overlaps and adjacent ranges joined.
function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

// `awk '/A/,/B/'` and `sed -n '/A/,/B/p'` are emulated on the file's text on
// disk: from each line matching A to the first later line matching B, both
// included; no end pattern means to the end of the file. No record holds the
// text with its line numbers, so the row names where the text was read.
function patternRanges(coverage, file, startPattern, endPattern) {
  const text = textOnDisk(coverage, file);
  if (!text) {
    file.events.push(`pattern range /${startPattern}/ not resolved: file not on disk`);
    return [];
  }
  const { lines } = text;
  let startRe;
  let endRe;
  try {
    startRe = new RegExp(startPattern);
    endRe = endPattern === null ? null : new RegExp(endPattern);
  } catch {
    file.events.push(`pattern range /${startPattern}/ not resolved: not a JavaScript regular expression`);
    return [];
  }
  file.patternSource = text.where;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!startRe.test(lines[i])) {
      i += 1;
      continue;
    }
    let j = lines.length;
    if (endRe) {
      j = i + 1;
      while (j < lines.length && !endRe.test(lines[j])) j += 1;
      j = Math.min(j + 1, lines.length);
    }
    out.push([i + 1, j]);
    i = j;
  }
  return out;
}

// The file's text on disk, split into lines the way `wc -l` counts them, and
// where it was read. The persisted copy of a `cat` that was the whole command
// comes first: Claude Code wrote it at the time of the read, so it is the
// text the agent was offered. The file itself is the text of today. Cached;
// null when neither can be read.
function textOnDisk(coverage, file) {
  if (coverage.diskText.has(file.path)) return coverage.diskText.get(file.path);
  const candidates = [[file.exactCopy, ON_PERSISTED_COPY], [file.path, ON_DISK_TODAY]].filter(([candidate]) => candidate);
  let found = null;
  for (const [candidate, where] of candidates) {
    try {
      const lines = fs.readFileSync(candidate, 'utf8').split(LINE_BREAK);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      found = { lines, where };
      break;
    } catch {
      // Try the next candidate.
    }
  }
  coverage.diskText.set(file.path, found);
  return found;
}

function rangesToString(lines) {
  const sorted = Array.from(lines).sort((a, b) => a - b);
  const parts = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(sorted[i] === sorted[j] ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.length ? parts.join(', ') : 'none';
}

function finishCoverage(coverage) {
  const fileCoverage = [];
  const fullyReceivedPaths = [];
  for (const file of coverage.files.values()) {
    if (!file.cut) {
      if (file.whole) fullyReceivedPaths.push(file.path);
      continue;
    }
    const total = fileTotal(coverage, file);
    const lines = total ? total.lines : null;
    if (lines !== null) {
      for (const from of file.openRanges) addRange(file, from, lines, file.lastRangeRecord, 'to the end');
      if (file.whole) addRange(file, 1, lines, file.lastRangeRecord, 'whole file');
    }
    const received = lines === null ? file.covered : new Set(Array.from(file.covered).filter((l) => l <= lines));
    const uncovered = [];
    if (lines !== null) for (let l = 1; l <= lines; l += 1) if (!received.has(l)) uncovered.push(l);
    const complete = file.whole || (lines !== null && uncovered.length === 0);
    // Without a total, two cases still have an answer: a file received whole,
    // and a file of which no line was received, which is zero percent of any
    // total. An open range is a delivery of lines, although it has no end yet.
    const nothingReceived = received.size === 0 && file.openRanges.length === 0;
    const whenTotalUnknown = (wholeValue, nothingValue) => (complete ? wholeValue : (nothingReceived ? nothingValue : null));
    file.lastLineReached = lines !== null ? received.has(lines) : whenTotalUnknown(true, false);

    fileCoverage.push({
      path: file.path,
      firstRoute: file.firstRoute,
      refusedForSize: file.refused,
      totalLines: lines,
      totalLinesSource: total ? total.source : null,
      receivedRanges: rangesToString(received),
      receivedLines: received.size,
      patternRangesSource: file.patternSource,
      coveragePercent: lines !== null ? Math.round(percent(received.size, lines) * 10) / 10 : whenTotalUnknown(100, 0),
      uncoveredRanges: lines !== null ? rangesToString(uncovered) : whenTotalUnknown('none', null),
      lastLineReached: file.lastLineReached,
      events: file.events,
    });
  }

  const partialNotices = { count: 0, pagedToEnd: 0, pagedShort: 0, notPaged: 0, persistedThenRead: 0 };
  for (const notice of coverage.notices) {
    const file = coverage.files.get(notice.path);
    const paged = file.lastRangeRecord > notice.recordIndex;
    partialNotices.count += 1;
    if (!paged) partialNotices.notPaged += 1;
    else if (file.lastLineReached === true) partialNotices.pagedToEnd += 1;
    else partialNotices.pagedShort += 1;
    if (notice.persisted) partialNotices.persistedThenRead += 1;
  }
  return { fileCoverage, fullyReceivedFiles: fullyReceivedPaths.length, fullyReceivedPaths, partialNotices };
}

// --- Report ---

function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

function printShares(totals, content, promptMaterial) {
  const rows = CLASSES
    .map((c) => [c, totals[c]])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const width = Math.max(...rows.map(([c]) => c.length), 'prompt material'.length);
  for (const [name, value] of rows) {
    const pct = percent(value, content).toFixed(1);
    console.log(`  ${name.padEnd(width)}  ${kb(value).padStart(9)}  ${pct.padStart(5)}%`);
  }
  console.log('');
  console.log(`  ${'prompt material'.padEnd(width)}  ` +
    `${kb(promptMaterial).padStart(9)}  ` +
    `${percent(promptMaterial, content).toFixed(1).padStart(5)}%  ` +
    `(${PROMPT_MATERIAL.join(' + ')})`);
}

// A value the transcript could not establish prints as "unknown".
function orUnknown(value, format) {
  return value === null || value === undefined ? UNKNOWN : format(value);
}

function report(file, m) {
  console.log(`Transcript: ${file}`);
  console.log(`Assistant records: ${m.assistantRecords}  ` +
    `distinct requests: ${m.distinctRequests}  ` +
    `(deduplicated on requestId)`);
  console.log(`Peak context: ${m.peakTokens.toLocaleString('en-US')} tokens ` +
    `(a maximum over requests, never a sum)`);
  console.log(`Content: ${kb(m.content)}`);
  console.log('');
  console.log('Shares over every record (the table the issues log cites):');
  printShares(m.totals, m.content, m.promptMaterial);

  const modelVisible = m.modelVisible;
  const excludedList = MODEL_INVISIBLE_ATTACHMENTS.map((k) => `${k} ${kb(modelVisible.excluded[k])}`).join(', ');
  console.log('');
  console.log(`Model-visible shares (without ${MODEL_INVISIBLE_ATTACHMENTS.join(' and ')} ` +
    `attachment records, which the model never sees): content ${kb(modelVisible.content)}, ` +
    `excluded ${excludedList}`);
  printShares(modelVisible.totals, modelVisible.content, m.promptMaterial);

  console.log('');
  const skill = m.skillBody;
  console.log(`Skill body: ${skill.tokens.toLocaleString('en-US')} tokens over ${skill.calls} ` +
    `Skill call${skill.calls === 1 ? '' : 's'} (context tokens of the request after each ` +
    `Skill call minus the request that made it); skill-directory reads: ` +
    `${m.skillDirectoryReads} (Read calls and Bash commands naming a path under ${SKILL_DIRECTORY})`);
  const notices = m.partialNotices;
  console.log(`PARTIAL notices: ${notices.count} (paged to the end: ${notices.pagedToEnd}, ` +
    `paged short: ${notices.pagedShort}, not paged: ${notices.notPaged}; of these on a ` +
    `persisted output file: ${notices.persistedThenRead})`);
  console.log('File coverage (files whose first read was cut; lines received over both routes):');
  for (const f of m.fileCoverage) {
    const firstReadLabel = f.firstRoute === ROUTE_CAT ? `${ROUTE_CAT}, persisted`
      : `${ROUTE_READ}, ${f.refusedForSize ? REFUSED_FOR_SIZE : 'cut by a PARTIAL notice'}`;
    const patternNote = f.patternRangesSource ? `; pattern ranges resolved ${f.patternRangesSource}` : '';
    console.log(`  ${f.path} | first read: ${firstReadLabel} | ` +
      `total lines: ${orUnknown(f.totalLines, (n) => `${n} (${f.totalLinesSource})`)} | ` +
      `received: ${f.receivedRanges} (${f.receivedLines} lines${patternNote}) | ` +
      `coverage: ${orUnknown(f.coveragePercent, (p) => `${p.toFixed(1)}%`)} | ` +
      `uncovered: ${orUnknown(f.uncoveredRanges, (u) => u)} | ` +
      `last line reached: ${orUnknown(f.lastLineReached, (r) => (r ? 'yes' : 'no'))}`);
  }
  console.log(`  Files fully received in one call: ${m.fullyReceivedFiles}`);
  // List each of these paths. A file the controller never opened cannot
  // appear here, so this list is how a maintainer checks that a named
  // template (for example a worker prompt template) was opened.
  for (const path of m.fullyReceivedPaths) console.log(`    ${path}`);

  if (m.thinkingBlocks > 0 && !m.thinkingTextStored) {
    console.log('');
    console.log(`Note: ${m.thinkingBlocks} thinking blocks carry a signature ` +
      `but no stored text, so their bytes are absent from Content. Every ` +
      `share above is therefore an upper bound.`);
  }
}

function main(argv) {
  const args = argv.filter((a) => a !== '--json');
  const asJson = argv.includes('--json');
  const file = args[0];

  if (!file) {
    console.error('usage: node tools/measure-context.js <transcript.jsonl> [--json]');
    return 2;
  }
  if (!fs.existsSync(file)) {
    console.error(`no such transcript: ${file}`);
    return 2;
  }

  const m = measure(readRecords(file));
  if (asJson) console.log(JSON.stringify(Object.assign({ file }, m), null, 2));
  else report(file, m);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { measure, readRecords, CLASSES, PROMPT_MATERIAL };
