#!/usr/bin/env node
// Prints the facts the /pickup skill needs, as "key: value" lines:
// - the git state of the current directory;
// - the newest handoff file (or the one named by the argument), its header,
//   the working tree, and the commits made after the handoff (its staleness);
// - without an argument, the unfinished orchestration runs found on local
//   feature branches that are not merged into the default branch.
// Usage: node pickup-scan.js [handoff-path]
// A path argument is looked up from the current directory, then from the
// repository top; tmp/docs and the branch files are read from the top. Every
// printed path is relative to the top.
// Exit status is 0 on every normal outcome; a status word carries the result.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DATE_PATTERN, LOG_ROOT, HEADS, NONE, GIT_OK, REFS,
  lines, git, gitLines, gitState, defaultBranch, currentBranch, scanRuns,
} = require('./git-runs');

const HANDOFF_DIR = 'tmp/docs';
const HANDOFF_NAME = new RegExp(`^(${DATE_PATTERN})-handoff-.+\\.md$`);
const BYTE_ORDER_MARK = /^\uFEFF/;
const HEADER = /^Handoff: +written=(\S+) +branch=(\S+) +head=(\S+)/;
// written=<YYYY-MM-DD>T<HH:MM>, optionally followed by a time-zone offset
// such as +0200.
const WRITTEN = new RegExp(`^(${DATE_PATTERN})T(\\d{2}):(\\d{2})([+-]\\d{4})?$`);
const OFFSET_MINUTES = { min: -12 * 60, max: 14 * 60 };
const VALID_HEAD = /^[0-9a-f]{7,40}$/;
const DONE_WHEN = /^Done when: (.+)$/;
const DONE_WHEN_LINES = 5;
const NOT_LISTED = 'not-listed';
// Files that /handoff itself writes after the handoff, and the work logs of
// skills/worklog, which the same sessions update; they are not work. This list
// covers the uncommitted-change check only: a commit made after the handoff
// still counts, also when it touches only docs/worklogs.
const NOT_WORK = [HANDOFF_DIR, 'state.md', 'session-log.md', 'docs/worklogs'];
const MAX_COMMITS = 30;
const STATUS = { fresh: 'FRESH', check: 'CHECK', unknown: 'UNKNOWN' };

function print(key, value) {
  console.log(`${key}: ${value}`);
}

function printList(items) {
  items.forEach((item) => console.log(`  ${item}`));
}

function localDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// A path relative to the repository top, with forward slashes.
function topPath(top, file) {
  return path.relative(top, file).split(path.sep).join('/');
}

// Parses a written= value. Returns null unless the date is a real calendar
// day, the time is 00:00-23:59 and the optional offset is -1200..+1400.
function parseWritten(value) {
  const match = value.match(WRITTEN);
  if (!match) return null;
  const [year, month, day] = match[1].split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const realDay = calendar.getUTCFullYear() === year
    && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day;
  if (!realDay || Number(match[2]) > 23 || Number(match[3]) > 59) return null;
  const offset = match[4] || '';
  if (offset) {
    const minutes = Number(offset.slice(3, 5));
    const total = (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + minutes);
    if (minutes > 59 || total < OFFSET_MINUTES.min || total > OFFSET_MINUTES.max) return null;
  }
  return { date: match[1], time: `${match[2]}:${match[3]}`, offset };
}

// Reads a handoff file: the header fields of its first line (a byte-order
// mark is removed) and a "Done when:" line among the first non-empty lines.
// Returns null when the path is not a readable regular file.
function readHandoff(file) {
  let text;
  let mtime;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    text = lines(fs.readFileSync(file, 'utf8').replace(BYTE_ORDER_MARK, ''));
    mtime = stat.mtimeMs;
  } catch (error) {
    return null;
  }
  const header = (text[0] || '').match(HEADER);
  const nameDate = path.basename(file).match(HANDOFF_NAME);
  const done = text.filter((line) => line.trim())
    .slice(0, DONE_WHEN_LINES)
    .map((line) => line.match(DONE_WHEN))
    .find(Boolean);
  return {
    file,
    header: header ? { written: header[1], branch: header[2], head: header[3] } : null,
    written: header ? parseWritten(header[1]) : null,
    nameDate: nameDate ? nameDate[1] : null,
    doneWhen: done ? done[1] : null,
    mtime,
  };
}

function handoffDate(handoff) {
  return handoff.written ? handoff.written.date : handoff.nameDate;
}

// The newest handoff in tmp/docs: ordered by a valid header "written=" value,
// then the file-name date, then the modification time. A file dated after
// today, and an entry that is not a readable file, are skipped.
function newestHandoff(top) {
  const dir = path.join(top, HANDOFF_DIR);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    return null;
  }
  const today = localDate();
  const key = (h) => (h.written ? `${h.written.date}T${h.written.time}` : h.nameDate);
  const found = names
    .filter((name) => HANDOFF_NAME.test(name))
    .map((name) => readHandoff(path.join(dir, name)))
    .filter((h) => h && h.nameDate <= today && handoffDate(h) <= today)
    .sort((a, b) => key(b).localeCompare(key(a))
      || b.nameDate.localeCompare(a.nameDate)
      || b.mtime - a.mtime);
  return found[0] || null;
}

// Prints the length of a commit list and at most MAX_COMMITS of its lines,
// oldest first, or "not-listed" when the list could not be produced.
function printCommits(key, list) {
  print(key, list ? list.length : NOT_LISTED);
  if (!list) return;
  if (list.length > MAX_COMMITS) print('commits-listed', MAX_COMMITS);
  printList(list.slice(0, MAX_COMMITS));
}

// The --since value of the window after the handoff, or null when no date is
// known. A bare --since=<date> means that date at the current time of day, so
// a date alone always gets 00:00.
function sinceValue(handoff, withTime) {
  const date = handoffDate(handoff);
  if (!date) return null;
  const written = handoff.written;
  const time = withTime && written ? written.time : '00:00';
  return `${date} ${time}${written && written.offset ? ` ${written.offset}` : ''}`;
}

// Prints the head check and two commit lists, and returns them.
// - self: the commits on HEAD after the handoff head, merges included and
//   whatever their date (HEAD moved, so they are new here). Without a head,
//   the commits on HEAD since 00:00 of the handoff date.
// - other: commits on other local branches, not on HEAD, made after the
//   handoff time (the file-name date at 00:00 when written= is not valid).
//   Each line names the first local ref that reaches it.
function reportCommits(handoff) {
  const head = handoff.header ? handoff.header.head : NONE;
  const headFound = VALID_HEAD.test(head) && git(['cat-file', '-e', `${head}^{commit}`]).ok;
  print('head', headFound ? head : 'not-found');
  const since = sinceValue(handoff, headFound);
  print('since', since || NONE);
  const sinceArgs = since ? [`--since=${since}`] : null;
  const log = ['log', '--reverse', '--oneline'];
  let selfRange = null;
  if (headFound) selfRange = [`${head}..HEAD`];
  else if (sinceArgs) selfRange = [...sinceArgs, 'HEAD'];
  const self = selfRange && gitLines([...log, ...selfRange]);
  printCommits('commits-self', self);
  if (self && self.length > MAX_COMMITS) {
    printCommits('first-parent', gitLines([...log, '--first-parent', ...selfRange]));
  }
  const notReached = headFound ? ['HEAD', head] : ['HEAD'];
  const other = sinceArgs
    && gitLines([...log, '--no-merges', '--source', ...sinceArgs, '--branches', '--not', ...notReached]);
  printCommits('commits-other', other);
  return { self, other };
}

// Prints the working tree and the commits made after the handoff. Returns the
// status word.
function reportStaleness(handoff, state) {
  if (state !== GIT_OK) return STATUS.unknown;
  const current = currentBranch();
  print('current-branch', current);
  const excludes = NOT_WORK.map((file) => `:(top,exclude)${file}`);
  const dirty = gitLines(['status', '--porcelain', '--untracked-files=normal', '--', ':(top)', ...excludes]);
  print('dirty', dirty ? dirty.length : NOT_LISTED);
  const branch = handoff.header ? handoff.header.branch : NONE;
  const branchDiffers = branch !== NONE && branch !== current;
  if (branchDiffers) print('branch-differs', 'yes');
  const { self, other } = reportCommits(handoff);
  if (!self || !other) return STATUS.unknown;
  const changed = self.length > 0 || other.length > 0 || !dirty || dirty.length > 0 || branchDiffers;
  return changed ? STATUS.check : STATUS.fresh;
}

function reportHandoff(handoff, state, top) {
  print('handoff', topPath(top, handoff.file));
  if (handoff.header) {
    print('written', handoff.header.written);
    print('branch', handoff.header.branch);
  } else {
    print('header', NONE);
  }
  if (handoff.doneWhen) print('done-when', handoff.doneWhen);
  print('status', reportStaleness(handoff, state));
}

// The resume path of a run: its plan when the branch has it, else its spec.
function resumePath(topic, slug, files) {
  const plan = `${topic}/plans/${slug}.md`;
  const spec = `${topic}/specs/${slug}-design.md`;
  return [plan, spec].find((p) => files.has(p)) || NONE;
}

// Prints the unfinished runs of git-runs.js in this script's format: a
// relative date for the last commit, and the resume path of a run.
// Global Constraint 4 (dashboard spec): git-runs.js is the single definition
// of "unfinished run", and this output does not change. The "errors" property
// of the scan result (git failures) is not read here, so a failed git command
// prints the same lines as before.
function reportRuns() {
  const runs = scanRuns({ refs: REFS.local });
  print('runs', runs.length || NONE);
  for (const run of runs) {
    print('run', run.ref.slice(HEADS.length));
    printList(run.logs.map((log) => `log: ${log.file}`));
    const details = [run.ambiguous ? 'ambiguous: yes' : `last: ${run.lastHeading || NONE}`];
    details.push(`last-commit: ${git(['log', '-1', '--format=%cr', run.ref]).out}`);
    details.push(`resume: ${run.ambiguous ? NONE : resumePath(run.logs[0].topic, run.slug, new Set(run.files))}`);
    printList(details);
  }
}

// Reports a path argument: an orchestrator file (a plan, spec or log is not a
// handoff), a missing or unreadable path, or the handoff.
function reportArgument(target, state, top) {
  const candidates = [path.resolve(target), path.resolve(top, target)];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  const shown = topPath(top, file || candidates[0]);
  if (shown.startsWith(`${LOG_ROOT}/`)) {
    print('handoff', `orchestrator-file ${shown}`);
    return;
  }
  const handoff = file ? readHandoff(file) : null;
  if (handoff) reportHandoff(handoff, state, top);
  else print('handoff', `${file ? 'unreadable' : 'missing'} ${target}`);
}

function main() {
  const target = process.argv[2];
  const state = gitState();
  print('git', state);
  const inGit = state === GIT_OK;
  const base = inGit ? defaultBranch() : null;
  if (inGit) print('default-branch', base || 'unknown (no merge filter: every feature branch is scanned)');
  const top = state === NONE ? process.cwd() : git(['rev-parse', '--show-toplevel']).out;
  if (target) {
    reportArgument(target, state, top);
    return;
  }
  const handoff = newestHandoff(top);
  if (handoff) reportHandoff(handoff, state, top);
  else print('handoff', NONE);
  if (inGit) reportRuns();
  else print('runs', NONE);
}

main();
