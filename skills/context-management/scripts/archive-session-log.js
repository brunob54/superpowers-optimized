#!/usr/bin/env node
/**
 * archive-session-log.js: move the older entries of session-log.md to the end
 * of session-log-archive.md, and keep the newest entries in session-log.md.
 *
 * Usage, from the folder that holds session-log.md:
 *   node archive-session-log.js [<keep>]
 * <keep> is the number of entries to keep, a positive integer (default 100).
 *
 * An entry starts at a line that starts with "## " and a date (YYYY-MM-DD).
 * The text before the first entry is the header. The log is in ascending
 * time, so the newest entries are the last ones. The script moves every entry
 * before the newest <keep> entries, byte for byte, and keeps the order.
 *
 * The log keeps its header, one pointer paragraph after the header (added
 * once) and the kept entries. The automatic recall of the hooks reads only
 * session-log.md, so the pointer tells a reader where the older entries are.
 *
 * Exit codes: 0 = done, or nothing to archive; 1 = no session-log.md in the
 * current folder, or a safety check failed; 2 = invalid argument.
 * Requires Node 16 or later and no package. Runs on macOS, Linux and Windows
 * Git Bash.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { excludeFromGit } = require('../../../hooks/git-exclude.js');

const LOG_FILE = 'session-log.md';
const ARCHIVE_FILE = 'session-log-archive.md';
const DEFAULT_KEEP = 100;
// The start of an entry heading. A carriage return before the line end
// changes nothing, because the pattern does not read the end of the line.
const ENTRY_HEADING = /^## (\d{4}-\d{2}-\d{2})/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const ARCHIVE_TITLE = '# Session Log Archive';
const POINTER_TEXT =
  `Older entries are in ${ARCHIVE_FILE} in this folder; the automatic recall does not read that file.`;
const USAGE = `usage: node archive-session-log.js [<keep>]  (<keep>: the number of entries to keep, a positive integer; default ${DEFAULT_KEEP})`;
// "latin1" maps each byte to one character and back. The files therefore keep
// their exact bytes, also bytes that are not valid UTF-8 (Unicode
// Transformation Format, 8-bit).
const ENCODING = 'latin1';
const LF = '\n';
const CRLF = '\r\n';

/**
 * Print `message` on standard error and set the exit code to `code`. The
 * caller returns at once. The process is not ended with process.exit(),
 * because that call can cut the message short when standard error is a pipe.
 */
function fail(message, code) {
  process.stderr.write(message + LF);
  process.exitCode = code;
}

/**
 * Split `text` into its header and its entries. Each entry runs from its
 * heading line to the line before the next heading, with its line ends.
 */
function splitEntries(text) {
  const lines = text.split(LF).map((line, i, all) => (i < all.length - 1 ? line + LF : line));
  let header = '';
  const entries = [];
  for (const line of lines) {
    if (ENTRY_HEADING.test(line)) entries.push(line);
    else if (entries.length === 0) header += line;
    else entries[entries.length - 1] += line;
  }
  return { header, entries };
}

/** The date in the heading of `entry`. */
function entryDate(entry) {
  return entry.match(ENTRY_HEADING)[1];
}

/** The number of entries in the file at `filePath`. */
function countEntriesIn(filePath) {
  return splitEntries(fs.readFileSync(filePath, ENCODING)).entries.length;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !POSITIVE_INTEGER.test(args[0]))) return fail(USAGE, 2);
  const keep = args.length === 1 ? Number(args[0]) : DEFAULT_KEEP;

  const logPath = path.resolve(LOG_FILE);
  const archivePath = path.resolve(ARCHIVE_FILE);
  if (!fs.existsSync(logPath)) return fail(`no ${LOG_FILE} in the current folder (${process.cwd()})`, 1);

  const original = fs.readFileSync(logPath, ENCODING);
  const { header, entries } = splitEntries(original);
  if (entries.length <= keep) {
    process.stdout.write(`nothing to archive: ${entries.length} entries, keep ${keep}${LF}`);
    return;
  }

  // New text uses the line end of the first heading.
  const eol = entries[0].endsWith(CRLF) ? CRLF : LF;
  const movedCount = entries.length - keep;
  const moved = entries.slice(0, movedCount);
  const kept = entries.slice(movedCount);
  const movedText = moved.join('');
  const keptText = kept.join('');
  if (movedText + keptText !== original.slice(header.length)) {
    return fail('safety check failed: the moved and the kept entries are not the original entries; no file changed', 1);
  }

  const archiveBefore = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, ENCODING) : '';
  const expectedArchiveCount = splitEntries(archiveBefore).entries.length + movedCount;
  let archiveStart;
  if (archiveBefore === '') archiveStart = ARCHIVE_TITLE + eol + eol;
  else archiveStart = archiveBefore.endsWith(LF) ? '' : eol;

  // The pointer is a paragraph: a blank line separates it from the header.
  let pointer = '';
  if (!header.includes(POINTER_TEXT)) {
    const blankLineBefore = header === '' || /\n[ \t\r]*\n$/.test(header) ? '' : eol;
    pointer = blankLineBefore + POINTER_TEXT + eol + eol;
  }
  const newLog = header + pointer + keptText;

  // Hide the archive from git before it exists (no effect outside git).
  excludeFromGit(archivePath);
  // The archive first: when the log write then fails, the moved entries are
  // in both files, and no entry is lost.
  fs.appendFileSync(archivePath, archiveStart + movedText, ENCODING);
  fs.writeFileSync(logPath, newLog, ENCODING);

  const logCount = countEntriesIn(logPath);
  const archiveCount = countEntriesIn(archivePath);
  if (logCount !== keep || archiveCount !== expectedArchiveCount) {
    return fail(`safety check failed after writing: ${LOG_FILE} holds ${logCount} entries (expected ${keep}), ` +
      `${ARCHIVE_FILE} holds ${archiveCount} (expected ${expectedArchiveCount})`, 1);
  }

  process.stdout.write(
    `archived ${movedCount} entries (${entryDate(moved[0])} to ${entryDate(moved[movedCount - 1])}) ` +
    `to ${ARCHIVE_FILE}; kept ${keep} entries in ${LOG_FILE}${LF}`);
}

main();
