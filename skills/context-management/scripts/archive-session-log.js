#!/usr/bin/env node
/**
 * archive-session-log.js: move the older entries of session-log.md to the end
 * of session-log-archive.md, and keep the newest entries in session-log.md.
 *
 * Usage, from the folder that holds session-log.md:
 *   node archive-session-log.js [<keep>]
 * <keep> is the number of entries to keep, a positive integer (default 100).
 *
 * An entry starts at a line that starts with "## " and a date (YYYY-MM-DD),
 * outside a fenced code block. The text before the first entry is the header;
 * a UTF-8 byte order mark at the start of the file belongs to the header. The
 * log is in ascending time, so the newest entries are the last ones. The
 * script moves every entry before the newest <keep> entries, byte for byte,
 * and keeps the order.
 *
 * The log keeps its header, one pointer paragraph after the header (added
 * once) and the kept entries. The automatic recall (the session-start hook
 * and the prompt hook, which add log entries to the context of a session)
 * reads only session-log.md, so the pointer tells a reader where the older
 * entries are.
 *
 * The order of the steps keeps every entry, also when another session saves
 * an entry (appends to session-log.md) while the script runs:
 * 1. Git runs first. It takes tens of milliseconds; a save in that time is
 *    simply part of the log that step 2 reads.
 * 2. Read the log, append the moved entries to the archive, and compare the
 *    archive with the expected bytes.
 * 3. Read the log again. Bytes that were appended since step 2 go to the end
 *    of the new log. Any other change stops the script.
 * 4. Write the log, and compare it with the expected bytes.
 * When a step before the log write fails, the script removes the bytes that
 * it appended to the archive, so neither file changes.
 *
 * Exit codes: 0 = done, or nothing to archive; 1 = no session-log.md, a
 * folder in place of a file, a failed write or a failed check; 2 = invalid
 * argument. Requires Node 16 or later and no package. Runs on macOS, Linux
 * and Windows Git Bash.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { excludeFromGit, git } = require('../../../hooks/git-exclude.js');

const LOG_FILE = 'session-log.md';
const ARCHIVE_FILE = 'session-log-archive.md';
const DEFAULT_KEEP = 100;
// The start of an entry heading. Group 1 is the date.
const ENTRY_HEADING = /^## (\d{4}-\d{2}-\d{2})/;
// A CommonMark fence line: 0 to 3 spaces, then 3 or more backticks or 3 or
// more tildes. Group 1 is the run of fence characters, group 2 the rest.
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const BLANKS_ONLY = /^[ \t]*$/;
// A text that ends with a blank line (a carriage return is allowed).
const ENDS_WITH_BLANK_LINE = /\n[ \t\r]*\n$/;
// The first line of a text ends with a carriage return and a line feed.
const FIRST_LINE_ENDS_WITH_CRLF = /^[^\n]*\r\n/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
// "latin1" maps each byte to one character and back. The files therefore keep
// their exact bytes, also bytes that are not valid UTF-8 (Unicode
// Transformation Format, 8-bit), and the length of a text is its size in bytes.
const ENCODING = 'latin1';
// The UTF-8 byte order mark, as the latin1 encoding reads it.
const BYTE_ORDER_MARK = '\xEF\xBB\xBF';
const LF = '\n';
const CRLF = '\r\n';
const CR = '\r';
const ARCHIVE_TITLE = '# Session Log Archive';
const POINTER_TEXT =
  `Older entries are in ${ARCHIVE_FILE} in this folder; the automatic recall does not read that file.`;
const USAGE = `usage: node archive-session-log.js [<keep>]  (<keep>: the number of entries to keep, a positive integer; default ${DEFAULT_KEEP})`;
const NO_FILE_CHANGED = `${LOG_FILE} and ${ARCHIVE_FILE} are unchanged`;
const TRACKED_NOTE =
  `; ${LOG_FILE} is tracked by git, so ${ARCHIVE_FILE} is not hidden from git: commit it together with ${LOG_FILE}`;

/**
 * Print `message` on standard error and set the exit code to `code`. The
 * caller returns at once. The process is not ended with process.exit(),
 * because that call can cut the message short when standard error is a pipe.
 */
function fail(message, code) {
  process.stderr.write(message + LF);
  process.exitCode = code;
}

/** The short name of an error of the file system, for a message. */
function describe(error) {
  return error.code || error.message;
}

/** The content of the file at `filePath`, or null when it cannot be read. */
function readOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, ENCODING);
  } catch {
    return null;
  }
}

/**
 * The fence state after `line` (without its line end): the run of fence
 * characters that opened the current fenced block, or null outside a block.
 * A block closes on the same character, at least as many times, followed by
 * blanks only; a shorter run, or a run of the other character, is content.
 */
function nextFence(fence, line) {
  const match = line.match(FENCE);
  if (!match) return fence;
  if (fence === null) return match[1];
  const closes = match[1][0] === fence[0] && match[1].length >= fence.length && BLANKS_ONLY.test(match[2]);
  return closes ? null : fence;
}

/**
 * Split `text` into a byte order mark ('' when there is none), the header
 * after it, and the entries. Each entry runs from its heading line to the
 * line before the next heading, with its line ends.
 */
function splitEntries(text) {
  const bom = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  const pieces = text.slice(bom.length).split(LF);
  let header = '';
  const entries = [];
  let fence = null;
  pieces.forEach((piece, i) => {
    const line = i < pieces.length - 1 ? piece + LF : piece;
    // A carriage return before the line end is part of the line end.
    const bare = piece.endsWith(CR) ? piece.slice(0, -1) : piece;
    if (fence === null && ENTRY_HEADING.test(bare)) entries.push(line);
    else if (entries.length === 0) header += line;
    else entries[entries.length - 1] += line;
    fence = nextFence(fence, bare);
  });
  return { bom, header, entries };
}

/** The date in the heading of `entry`. */
function entryDate(entry) {
  return entry.match(ENTRY_HEADING)[1];
}

/** True when git tracks the file at `filePath`: the file is in the index. */
function isTrackedByGit(filePath) {
  try {
    git(['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', path.basename(filePath)], path.dirname(filePath));
    return true;
  } catch {
    // Not in the index, or not in a git work tree.
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !POSITIVE_INTEGER.test(args[0]))) return fail(USAGE, 2);
  const keep = args.length === 1 ? Number(args[0]) : DEFAULT_KEEP;

  const logPath = path.resolve(LOG_FILE);
  const archivePath = path.resolve(ARCHIVE_FILE);
  if (!fs.existsSync(logPath)) return fail(`no ${LOG_FILE} in the current folder (${process.cwd()})`, 1);
  for (const filePath of [logPath, archivePath]) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      return fail(`${path.basename(filePath)} is a folder, not a file; ${NO_FILE_CHANGED}`, 1);
    }
  }

  // This first read only decides whether there is anything to archive, so
  // that a run with nothing to archive starts no git process.
  const nothingToArchive = count => process.stdout.write(`nothing to archive: ${count} entries, keep ${keep}${LF}`);
  const firstCount = splitEntries(fs.readFileSync(logPath, ENCODING)).entries.length;
  if (firstCount <= keep) return nothingToArchive(firstCount);

  // Step 1 (see the top of the file). When git tracks the log, the archive
  // must stay visible to git, or the archived entries leave version control.
  const logTracked = isTrackedByGit(logPath);
  if (!logTracked) excludeFromGit(archivePath);

  // Step 2.
  const original = fs.readFileSync(logPath, ENCODING);
  const { bom, header, entries } = splitEntries(original);
  if (entries.length <= keep) return nothingToArchive(entries.length);

  // New text uses the line end of the first heading line.
  const eol = FIRST_LINE_ENDS_WITH_CRLF.test(entries[0]) ? CRLF : LF;
  const movedCount = entries.length - keep;
  const moved = entries.slice(0, movedCount);
  const movedText = moved.join('');
  const keptText = entries.slice(movedCount).join('');

  const archiveExisted = fs.existsSync(archivePath);
  const archiveBefore = archiveExisted ? fs.readFileSync(archivePath, ENCODING) : '';
  let archiveStart;
  if (archiveBefore === '') archiveStart = ARCHIVE_TITLE + eol + eol;
  else archiveStart = archiveBefore.endsWith(LF) ? '' : eol;
  const expectedArchive = archiveBefore + archiveStart + movedText;

  // The pointer is a paragraph: a blank line separates it from the header.
  let pointer = '';
  if (!header.includes(POINTER_TEXT)) {
    const blankLineBefore = header === '' || ENDS_WITH_BLANK_LINE.test(header) ? '' : eol;
    pointer = blankLineBefore + POINTER_TEXT + eol + eol;
  }

  // Remove the bytes that this run appended to the archive. The result is
  // the end of the failure message.
  const undoArchive = () => {
    try {
      if (archiveExisted) fs.truncateSync(archivePath, archiveBefore.length);
      else fs.rmSync(archivePath, { force: true });
      return `; ${NO_FILE_CHANGED}`;
    } catch (error) {
      return `; the appended bytes could not be removed from ${ARCHIVE_FILE} (${describe(error)}), ` +
        `so the moved entries are in both files`;
    }
  };

  try {
    fs.appendFileSync(archivePath, archiveStart + movedText, ENCODING);
  } catch (error) {
    return fail(`could not write ${ARCHIVE_FILE} (${describe(error)})${undoArchive()}`, 1);
  }
  if (readOrNull(archivePath) !== expectedArchive) {
    return fail(`check after writing failed: ${ARCHIVE_FILE} does not hold the expected bytes${undoArchive()}`, 1);
  }

  // Step 3. A save that lands between this read and the log write below is
  // still lost; that window is some microseconds wide, not the milliseconds
  // that git takes.
  const current = readOrNull(logPath);
  if (current === null || !current.startsWith(original)) {
    return fail(`${LOG_FILE} changed while the script ran, and not only at its end${undoArchive()}`, 1);
  }
  const newLog = bom + header + pointer + keptText + current.slice(original.length);

  // Step 4.
  try {
    fs.writeFileSync(logPath, newLog, ENCODING);
  } catch (error) {
    // Undo the archive only when the log is still complete. A write that
    // failed after it started (a full disk) leaves the log incomplete, and
    // the moved entries must then stay in the archive.
    const logIntact = readOrNull(logPath) === current;
    const end = logIntact ? undoArchive() : `; ${LOG_FILE} may be incomplete, and ${ARCHIVE_FILE} holds the moved entries`;
    return fail(`could not write ${LOG_FILE} (${describe(error)})${end}`, 1);
  }
  if (readOrNull(logPath) !== newLog) {
    return fail(`check after writing failed: ${LOG_FILE} does not hold the expected bytes; ` +
      `${ARCHIVE_FILE} holds the moved entries; compare the two files`, 1);
  }

  process.stdout.write(
    `archived ${movedCount} entries (${entryDate(moved[0])} to ${entryDate(moved[movedCount - 1])}) ` +
    `to ${ARCHIVE_FILE}; kept ${keep} entries in ${LOG_FILE}${logTracked ? TRACKED_NOTE : ''}${LF}`);
}

main();
