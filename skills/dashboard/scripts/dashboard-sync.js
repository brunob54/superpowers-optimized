#!/usr/bin/env node
// Checks the edit proposals of the dashboard page against the Markdown files
// (spec section 8). <folder> is the out_dir of the ArtifactData query: each
// proposal is the file <folder>/proposals/<id>.json, which holds the document
// body only (platform check 9). <versions file> holds one line
// "<id> <version>" per proposal; the skill copies these lines from the result
// text of the query. The script runs from inside the repository, reads the
// working tree, and never commits.
// Usage:
//   node dashboard-sync.js --check <folder> --versions <versions file>
// Exit status: 0 when every proposal got a verdict; 2 when the command cannot
// run (not a git repository with a commit, a bad argument, no proposal
// folder, a versions file that does not match the body files one to one, a
// git command that failed).
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DETACHED, GIT_OK, RUN_STATE, REFS, git, gitState, currentBranch, scanRuns,
} = require('../../pickup/scripts/git-runs');
const parse = require('./dashboard-parse');

const EXIT_STOP = 2;
const COLLECTION = 'proposals';
const JSON_SUFFIX = '.json';
const VERSIONS_OPTION = '--versions';
// One line of the versions file: the id, one space, a positive integer.
const VERSION_LINE = /^(\S+) ([1-9][0-9]*)$/;
// The exit status of "git ls-files --error-unmatch" for a file that git does
// not track; any other non-zero status is a failure of git.
const LS_FILES_NOT_TRACKED = 1;
const KIND = { resolve: 'resolve-open-item', setPart: 'set-part' };
const VERDICT = {
  unique: 'unique', alreadyApplied: 'already-applied', none: 'none', several: 'several',
  invalid: 'invalid', fileMissing: 'file-missing', wrongBranch: 'wrong-branch', heldRun: 'held-run',
};
const DONE = 'done';
const WORKLOG_FILE = /^docs\/worklogs\/[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}:\d{2}$/;
const DEFAULT_NOTE = 'from the dashboard';
const ITEM_REFERENCE = 'item #';
const DATE_LENGTH = 10;
// The header of skills/worklog/template.md, used when the file has no
// "## Parts" table to read the columns from.
const DEFAULT_PART_HEADER = Object.values(parse.PART_COLUMNS);

function stop(message) {
  process.stderr.write(`dashboard-sync: ${message}\n`);
  process.exit(EXIT_STOP);
}

// Removes the pair "<name> <value>" from <argv> and returns the value, or
// null when the pair is absent or its value is empty.
function takeOption(argv, name) {
  const at = argv.indexOf(name);
  if (at === -1) return null;
  return argv.splice(at, 2)[1] || null;
}

// One file saved by ArtifactData query with out_dir: the proposal document
// itself, with no id and no version (platform check 9). The id is the file
// name; <version> comes from the versions file.
function readProposalFile(file, id, version) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { id, version, doc: null, error: 'the file is not valid JSON' };
  }
  const valid = typeof doc === 'object' && doc !== null && !Array.isArray(doc);
  return { id, version, doc: valid ? doc : null, error: valid ? null : 'the file holds no document' };
}

// The versions file: Map(id -> version). Stops on a line that is not
// "<id> <positive integer>" (an id with an unsafe character included, since
// the id is printed) and on an id that appears twice.
function readVersions(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return stop(`cannot read the versions file ${file}`);
  }
  const versions = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line) return;
    const match = parse.UNSAFE_CHARACTER.test(line) ? null : line.match(VERSION_LINE);
    const version = match ? Number(match[2]) : NaN;
    if (!Number.isSafeInteger(version)) {
      stop(`versions file ${file}, line ${index + 1}: expected "<id> <positive integer>" with no control character, found ${JSON.stringify(line)}`);
    }
    if (versions.has(match[1])) stop(`versions file ${file}: the id ${match[1]} is on two lines`);
    versions.set(match[1], version);
  });
  return versions;
}

// Every proposal of the folder, joined with its version by id. Stops before
// any proposal is used when the body files and the versions lines do not
// match one to one.
function loadProposals(folder, versionsFile) {
  const dir = path.join(folder, COLLECTION);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    return stop(`no proposal folder ${dir}`);
  }
  const versions = readVersions(versionsFile);
  const ids = names.filter((name) => name.endsWith(JSON_SUFFIX)).sort().map((name) => name.slice(0, -JSON_SUFFIX.length));
  const noLine = ids.filter((id) => !versions.has(id));
  if (noLine.length) stop(`no line in the versions file ${versionsFile} for the proposals: ${noLine.join(', ')}`);
  const idSet = new Set(ids);
  const noFile = [...versions.keys()].filter((id) => !idSet.has(id));
  if (noFile.length) stop(`no file in ${dir} for the versions lines of: ${noFile.join(', ')}`);
  return ids.map((id) => readProposalFile(path.join(dir, `${id}${JSON_SUFFIX}`), id, versions.get(id)));
}

// The run that makes a write to a tracked file unsafe (spec section 8 step
// 2.4): an in-progress run on the current branch, or any stopped or
// ambiguous run. A failed git command of the scan stops the script: a run
// that the scan could not read may be the one that holds the file. The
// message names the commands only; they hold no absolute path.
function heldRun(current) {
  const runs = scanRuns({ refs: REFS.local });
  if (runs.errors.length) {
    stop(`a git command failed while the unfinished runs were read, so the check cannot tell whether a run holds the files: ${runs.errors.map((error) => error.command).join('; ')}`);
  }
  const run = runs.find((item) => (item.state === RUN_STATE.inProgress && item.branch === current)
    || item.state === RUN_STATE.stopped || item.state === RUN_STATE.ambiguous);
  return run ? `${run.state} run on ${run.branch}` : null;
}

// True when git tracks the file <full>. Git is asked about the path that the
// file system resolves (the symbolic links of the folders, and the letter
// case stored on disk where the file system ignores letter case), because git
// records that path and not the path of the proposal. A git failure other
// than "not tracked" stops the script; the message holds the path relative
// to the repository only.
function isTracked(top, full) {
  const rel = path.relative(parse.realPath(top), parse.realPath(full)).split(path.sep).join('/');
  const result = git(['--literal-pathspecs', '-C', top, 'ls-files', '--error-unmatch', '--', rel]);
  if (result.ok) return true;
  if (result.status === LS_FILES_NOT_TRACKED) return false;
  return stop(`git ls-files failed for ${rel}, so the check cannot tell whether the file is tracked`);
}

function environment() {
  if (gitState() !== GIT_OK) stop('run the sync from inside a git repository with at least one commit');
  const top = git(['rev-parse', '--show-toplevel']).out;
  const current = currentBranch();
  return {
    top,
    branch: current === DETACHED ? null : current,
    held: heldRun(current),
    tracked: (full) => isTracked(top, full),
  };
}

const optional = (value) => (value === null || value === undefined ? undefined : value);

// The checked copy of a document. Object spread defines own properties only:
// a "__proto__" key of the document stays an ordinary field and never
// becomes the prototype, so every field that is checked is a field of the
// document itself. Every later step reads this copy, never the raw document.
function normalized(doc) {
  return { ...doc, status: optional(doc.status), note: optional(doc.note) };
}

function verdict(name, reason) {
  return { verdict: name, reason };
}

function target(index, oldLine, newLine, warnings) {
  return { verdict: VERDICT.unique, reason: '', index, oldLine, newLine, warnings };
}

// True when <value> is a string with no unsafe character (a line break
// included): such a value cannot print a line of its own.
const safeText = (value) => typeof value === 'string' && !parse.UNSAFE_CHARACTER.test(value);

// The rules of spec section 8 step 2.1 that need no file.
function basicInvalid(p) {
  if (p.kind !== KIND.resolve && p.kind !== KIND.setPart) return 'kind is not resolve-open-item or set-part';
  if (typeof p.file !== 'string' || !p.file || path.isAbsolute(p.file) || p.file.includes('\\') || p.file.split('/').includes('..')) {
    return 'file is not a relative path inside the repository';
  }
  if (p.kind === KIND.resolve && p.file !== parse.SESSION_LOG) return 'resolve-open-item allows only session-log.md';
  if (p.kind === KIND.setPart && !WORKLOG_FILE.test(p.file)) return 'set-part allows only docs/worklogs/<slug>.md';
  if (p.status !== undefined && (p.kind !== KIND.setPart || !parse.PART_STATUSES.includes(p.status))) return 'status must be not started, in progress or done, on set-part only';
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > parse.NOTE_LIMIT || parse.NOTE_FORBIDDEN.test(p.note))) {
    return `note must be one line of at most ${parse.NOTE_LIMIT} characters without | [ ] or control characters`;
  }
  if (p.kind === KIND.setPart && p.status === undefined && p.note === undefined) return 'set-part needs a status or a note';
  const a = p.anchor;
  const anchorOk = Boolean(a) && safeText(a.heading) && a.heading.startsWith(parse.HEADING_PREFIX)
    && Number.isInteger(a.headingOrdinal) && a.headingOrdinal >= 1 && safeText(a.line)
    && (p.kind === KIND.setPart
      ? a.heading === parse.PARTS_HEADING && safeText(a.part)
      : Number.isInteger(a.occurrence) && a.occurrence >= 1);
  if (!anchorOk) return 'the anchor fields are missing or wrong';
  if (p.kind === KIND.setPart && (typeof p.branch !== 'string' || !p.branch)) {
    return 'set-part needs the branch of the page (a page built on a detached HEAD cannot propose work-log edits)';
  }
  if (typeof p.branch === 'string' && !safeText(p.branch)) return 'the branch holds a line break or a control character';
  if (typeof p.createdAt !== 'string' || !CREATED_AT.test(p.createdAt)) return 'createdAt is not a local time with its offset';
  return null;
}

// The new line of a proposal, computed from its anchor line (the row the
// owner saw) and its own fields only, so it is the same on every run.
function expectedChange(p, header) {
  const date = p.createdAt.slice(0, DATE_LENGTH);
  if (p.kind === KIND.resolve) {
    const note = p.note === undefined ? DEFAULT_NOTE : p.note;
    return { changed: !p.anchor.line.includes(parse.RESOLVED_MARK), line: `${p.anchor.line} [resolved ${date}: ${note}]` };
  }
  const columns = parse.columnIndex(header, parse.PART_COLUMNS) ? header : DEFAULT_PART_HEADER;
  const col = parse.columnIndex(columns, parse.PART_COLUMNS);
  const cells = parse.splitRow(p.anchor.line);
  if (cells.length !== columns.length) return { error: 'the anchor row does not match the ## Parts table header' };
  const next = cells.slice();
  const statusChanges = p.status !== undefined && p.status !== cells[col.status];
  if (statusChanges) {
    if (cells[col.status] === DONE && cells[col.commit]) return { error: 'a done part with a filled Commit cell changes status only through /worklog' };
    next[col.status] = p.status;
    next[col.since] = date;
  }
  if (p.note !== undefined) next[col.note] = p.note;
  return { changed: next.some((cell, i) => cell !== cells[i]), line: parse.joinRow(next), cells, col, statusChanges };
}

// The part numbers named in the Blocks column of "## Open items".
function blockedParts(lines) {
  const section = parse.findSection(lines, parse.OPEN_ITEMS_HEADING, 1);
  if (!section) return [];
  const table = parse.sectionTable(lines, section);
  const col = parse.columnIndex(table.header, parse.OPEN_ITEM_COLUMNS);
  if (!col) return [];
  return table.rows.filter((row) => !row.raw).flatMap((row) => row.cells[col.blocks].split(/[^0-9]+/).filter(Boolean));
}

function partWarnings(p, lines, expected) {
  const warnings = [];
  const note = expected.cells[expected.col.note];
  if (p.note !== undefined && note.includes(ITEM_REFERENCE)) {
    warnings.push(`the Note "${note}" names an open item; the work-log rules say that the Note of a blocked part names the blocking item`);
  }
  if (expected.statusChanges && (note.includes(ITEM_REFERENCE) || blockedParts(lines).includes(p.anchor.part))) {
    warnings.push('an open item blocks this part; the work-log rules say that a blocked part keeps its status');
  }
  return warnings;
}

function findResolveTarget(p, lines, section, expected) {
  const index = parse.lineAtOccurrence(lines, section, parse.normalizeLine(p.anchor.line), p.anchor.occurrence);
  if (index === -1) return verdict(VERDICT.none, 'the line is no longer at its place');
  if (lines[index] === p.anchor.line) return target(index, p.anchor.line, expected.line, []);
  if (lines[index] === expected.line) return verdict(VERDICT.alreadyApplied, 'the line already holds this change');
  return verdict(VERDICT.none, 'the line changed after the refresh');
}

function findPartTarget(p, lines, section, expected) {
  const rows = parse.sectionTable(lines, section).rows.filter((row) => parse.splitRow(row.line)[0] === p.anchor.part);
  if (!rows.length) return verdict(VERDICT.none, `no row for part ${p.anchor.part}`);
  if (rows.length > 1) return verdict(VERDICT.several, `${rows.length} rows for part ${p.anchor.part}`);
  const row = rows[0];
  if (row.line === p.anchor.line) return target(row.index, row.line, expected.line, partWarnings(p, lines, expected));
  if (row.line === expected.line) return verdict(VERDICT.alreadyApplied, 'the row already holds this change');
  return verdict(VERDICT.none, 'the row changed after the refresh');
}

function isSymlink(full) {
  try {
    return fs.lstatSync(full).isSymbolicLink();
  } catch (error) {
    return false;
  }
}

function readText(full) {
  try {
    return fs.lstatSync(full).isFile() ? fs.readFileSync(full, 'utf8') : null;
  } catch (error) {
    return null;
  }
}

function fullPath(env, file) {
  return path.join(env.top, ...file.split('/'));
}

// The verdict of one proposal (spec section 8 step 2). <read>(full path)
// returns the file text or null. A file is read only after the path rules.
// A unique verdict also carries the checked file and whether git tracks it.
function evaluate(proposal, env, read) {
  if (!proposal.doc) return verdict(VERDICT.invalid, proposal.error);
  const p = normalized(proposal.doc);
  const reason = basicInvalid(p);
  if (reason) return verdict(VERDICT.invalid, reason);
  const full = fullPath(env, p.file);
  if (!parse.isInside(full, env.top)) return verdict(VERDICT.invalid, 'the file lies outside the repository');
  if (isSymlink(full)) return verdict(VERDICT.invalid, 'the target file is a symbolic link');
  const text = read(full);
  const lines = text === null ? null : parse.splitLines(text);
  const section = lines ? parse.findSection(lines, p.anchor.heading, p.anchor.headingOrdinal) : null;
  const header = section && p.kind === KIND.setPart ? parse.sectionTable(lines, section).header : [];
  const expected = expectedChange(p, header);
  if (expected.error) return verdict(VERDICT.invalid, expected.error);
  if (!expected.changed) return verdict(VERDICT.invalid, 'the proposal changes nothing');
  if (text === null) return verdict(VERDICT.fileMissing, `${p.file} does not exist in the working tree`);
  if (p.kind === KIND.setPart && p.branch !== env.branch) return verdict(VERDICT.wrongBranch, `the page was built on ${p.branch}; check out that branch and sync again`);
  const tracked = env.tracked(full);
  if (env.held && tracked) return verdict(VERDICT.heldRun, `${env.held}: an uncommitted change to a tracked file would reach that run`);
  if (!section) return verdict(VERDICT.none, `no heading "${p.anchor.heading}" number ${p.anchor.headingOrdinal}`);
  const found = p.kind === KIND.resolve ? findResolveTarget(p, lines, section, expected) : findPartTarget(p, lines, section, expected);
  return Object.assign(found, { file: p.file, tracked });
}

// The "tracked" or "untracked" label of the file line is the one the skill
// asks its whole-branch-review question from.
function printVerdict(proposal, result) {
  console.log(`proposal ${proposal.id}: ${result.verdict}${result.reason ? ` — ${result.reason}` : ''}`);
  if (result.verdict !== VERDICT.unique) return;
  console.log(`  file: ${result.file} (${result.tracked ? 'tracked' : 'untracked'})`);
  console.log(`  - ${result.oldLine}`);
  console.log(`  + ${result.newLine}`);
  result.warnings.forEach((warning) => console.log(`  warning: ${warning}`));
}

// Every verdict is computed before the first line is printed, so a stop (a
// git failure) prints no verdict at all.
function check(folder, versionsFile) {
  const env = environment();
  const proposals = loadProposals(folder, versionsFile);
  const results = proposals.map((proposal) => evaluate(proposal, env, readText));
  const counts = {};
  proposals.forEach((proposal, i) => {
    counts[results[i].verdict] = (counts[results[i].verdict] || 0) + 1;
    printVerdict(proposal, results[i]);
  });
  const summary = Object.entries(counts).map(([name, count]) => `${name}=${count}`).join(' ');
  console.log(`summary: ${summary || 'no proposal'}`);
}

function main() {
  const argv = process.argv.slice(2);
  const versionsFile = takeOption(argv, VERSIONS_OPTION);
  const [mode, folder] = argv;
  if (mode !== '--check' || !folder || !versionsFile) stop('usage: dashboard-sync.js --check <folder> --versions <versions file>');
  check(folder, versionsFile);
}

main();
