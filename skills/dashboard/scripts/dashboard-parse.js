// Parsing rules shared by dashboard-extract.js and dashboard-sync.js, so that
// the sync script finds exactly the line that the extractor anchored:
// normalization of lines and headings, "## " sections, item ids, Markdown
// table rows, the open items of a session-log entry, the Node copy of the
// work-log rules of skills/worklog/SKILL.md (sections "The check command",
// "Valid forms of line 1" and "The listing command"), argument parsing and
// local ISO 8601 times. The parsing functions are pure: text in, data out.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { HEADING_PREFIX } = require('../../pickup/scripts/git-runs');

const BYTE_ORDER_MARK = /^﻿/;
const SUPERSEDED_SUFFIX = / \[superseded[^\]]*\]$/;
const RESOLVED_SUFFIX = / \[resolved[^\]]*\]$/;
const RESOLVED_MARK = '[resolved';
const SUPERSEDED_MARK = '[superseded';
const ID_SEPARATOR = '\n';
const OPEN_LIST = /^Open:\s*$/;
const OPEN_ONE_LINE = /^Open: (.*\S.*)$/;
const ONE_LINE_PREFIX = 'Open: ';
const LIST_END = /^[A-Za-z][A-Za-z0-9_-]*:/;
const BULLET = '- ';
const CONTINUATION = /^[ \t]+\S/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|[\s|:-]*-[\s|:-]*$/;
const WORKLOG_SLUG = '[a-z0-9]+(-[a-z0-9]+)*';
const WORKLOG_DATE = '[0-9]{4}-[0-9]{2}-[0-9]{2}';
const WORKLOG_ACTIVE = new RegExp(`^<!-- Work log: status=active slug=${WORKLOG_SLUG} created=${WORKLOG_DATE} -->$`);
const WORKLOG_CLOSED = new RegExp(`^<!-- Work log: status=closed slug=${WORKLOG_SLUG} created=${WORKLOG_DATE} closed=${WORKLOG_DATE} -->$`);
const WORKLOG_NAME = new RegExp(`^${WORKLOG_SLUG}\\.md$`);
const WORKLOG_NAME_MAX = 43;
const WORKLOG_COMMAND_NAMES = ['new.md', 'update.md', 'close.md'];
const WORKLOG_CLASS = { active: 'active', closed: 'closed', malformed: 'malformed', symlink: 'symlink' };
// The sources that both the extractor reads and the sync script writes.
const SESSION_LOG = 'session-log.md';
const WORKLOG_DIR = 'docs/worklogs';
const PARTS_HEADING = '## Parts';
const OPEN_ITEMS_HEADING = '## Open items';
// The columns of the two tables of skills/worklog/template.md, by header label.
const PART_COLUMNS = { number: '#', part: 'Part', status: 'Status', since: 'Since', commit: 'Commit', note: 'Note' };
const OPEN_ITEM_COLUMNS = { number: '#', item: 'Item', part: 'Part', found: 'Found', blocks: 'Blocks' };
// The note rule and the part statuses. The page template of the dashboard
// (Task 8) holds the only other copy of these three values, because the page
// cannot load shared code; a parity test of Task 8 checks that copy.
const PART_STATUSES = ['not started', 'in progress', 'done'];
const NOTE_LIMIT = 200;
const NOTE_FORBIDDEN = /[|[\]\r\n]/;
// The bytes that the listing command keeps in an invalid file name: a-z,
// 0-9, "." and "-" (it runs awk with LC_ALL=C, so it replaces bytes).
const LISTING_KEEP = (byte) => (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || byte === 0x2e || byte === 0x2d;
const LISTING_REPLACEMENT = '?';

function splitLines(text) {
  return text.replace(BYTE_ORDER_MARK, '').split('\n').map((line) => line.replace(/\r$/, ''));
}

function normalizeHeading(line) {
  return line.replace(SUPERSEDED_SUFFIX, '');
}

function normalizeLine(line) {
  return line.replace(RESOLVED_SUFFIX, '');
}

// Every "## " heading: its line index, raw text, normalized text, 1-based
// ordinal among the headings with the same normalized text, and the index
// where its section ends (the next "## " line, or the line count).
function headings(lines) {
  const found = [];
  const seen = new Map();
  lines.forEach((line, index) => {
    if (!line.startsWith(HEADING_PREFIX)) return;
    const heading = normalizeHeading(line);
    const ordinal = (seen.get(heading) || 0) + 1;
    seen.set(heading, ordinal);
    found.push({ index, raw: line, heading, ordinal, end: lines.length });
  });
  found.forEach((section, i) => {
    if (i + 1 < found.length) section.end = found[i + 1].index;
  });
  return found;
}

function findSection(lines, heading, ordinal) {
  return headings(lines).find((section) => section.heading === heading && section.ordinal === ordinal) || null;
}

// The 1-based position of line <index> among the lines of <section> whose
// normalized text is equal. The heading line itself is occurrence 1.
function occurrenceOf(lines, section, index) {
  if (index === section.index) return 1;
  const target = normalizeLine(lines[index]);
  let count = 0;
  for (let i = section.index + 1; i <= index; i += 1) {
    if (normalizeLine(lines[i]) === target) count += 1;
  }
  return count;
}

function lineAtOccurrence(lines, section, normalized, occurrence) {
  let count = 0;
  for (let i = section.index + 1; i < section.end; i += 1) {
    if (normalizeLine(lines[i]) !== normalized) continue;
    count += 1;
    if (count === occurrence) return i;
  }
  return -1;
}

// The open items of the lines [start, end) of one entry, in order. An item is
// a bullet line inside an "Open:" list with its indented continuation lines,
// or a one-line "Open: <text>" line. A list ends at a blank line, at a line
// that starts with a word followed by ":", or at the end. A line inside a
// list that is neither a bullet nor a continuation is a raw item.
function openItems(lines, start, end) {
  const items = [];
  let inList = false;
  let current = null;
  for (let i = start; i < end; i += 1) {
    const line = lines[i];
    if (inList) {
      if (!line.trim()) {
        inList = false;
        current = null;
        continue;
      }
      if (line.startsWith(BULLET)) {
        current = { index: i, line, continuation: [], raw: false };
        items.push(current);
        continue;
      }
      if (current && CONTINUATION.test(line)) {
        current.continuation.push(line);
        continue;
      }
      if (!LIST_END.test(line)) {
        items.push({ index: i, line, continuation: [], raw: true });
        current = null;
        continue;
      }
      inList = false;
      current = null;
    }
    if (OPEN_LIST.test(line)) {
      inList = true;
    } else if (OPEN_ONE_LINE.test(line)) {
      items.push({ index: i, line, continuation: [], raw: false });
    }
  }
  return items.map((item) => Object.assign(item, {
    resolved: !item.raw && [item.line, ...item.continuation].some((text) => text.includes(RESOLVED_MARK)),
  }));
}

function openItemText(line) {
  if (line.startsWith(BULLET)) return line.slice(BULLET.length);
  if (line.startsWith(ONE_LINE_PREFIX)) return line.slice(ONE_LINE_PREFIX.length);
  return line;
}

// A table row split on "|" after the leading and the trailing "|" are
// removed; cells are trimmed.
function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function joinRow(cells) {
  return `| ${cells.join(' | ')} |`;
}

// The first table of a section: its header cells and its rows. The
// separator row is skipped; a row whose cell count differs from the header's
// is marked raw.
function sectionTable(lines, section) {
  let header = null;
  const rows = [];
  for (let i = section.index + 1; i < section.end; i += 1) {
    const line = lines[i];
    if (!TABLE_ROW.test(line)) continue;
    if (!header) {
      header = splitRow(line);
      continue;
    }
    if (TABLE_SEPARATOR.test(line)) continue;
    const cells = splitRow(line);
    rows.push({ index: i, line, cells, raw: cells.length !== header.length });
  }
  return { header: header || [], rows };
}

// { name: position } for the header labels in <columns> ({ name: label }),
// or null when one label is missing.
function columnIndex(header, columns) {
  const found = {};
  for (const [name, label] of Object.entries(columns)) {
    const index = header.indexOf(label);
    if (index === -1) return null;
    found[name] = index;
  }
  return found;
}

function itemId(parts) {
  return crypto.createHash('sha1').update(parts.join(ID_SEPARATOR), 'utf8').digest('hex');
}

function lineItemId(file, heading, ordinal, line, occurrence) {
  return itemId([file, heading, String(ordinal), normalizeLine(line), String(occurrence)]);
}

function keyItemId(sectionId, key) {
  return itemId([sectionId, key]);
}

// Line 1 as the check command compares it: every carriage return removed,
// then one byte order mark at the start removed.
function worklogLine1(text) {
  return text.split('\n')[0].replace(/\r/g, '').replace(BYTE_ORDER_MARK, '');
}

function worklogClass(text) {
  const line = worklogLine1(text);
  if (WORKLOG_ACTIVE.test(line)) return WORKLOG_CLASS.active;
  if (WORKLOG_CLOSED.test(line)) return WORKLOG_CLASS.closed;
  return WORKLOG_CLASS.malformed;
}

function worklogNameValid(name) {
  return WORKLOG_NAME.test(name) && name.length <= WORKLOG_NAME_MAX && !WORKLOG_COMMAND_NAMES.includes(name);
}

function listingName(name) {
  return Array.from(Buffer.from(name, 'utf8')).map((byte) => (LISTING_KEEP(byte) ? String.fromCharCode(byte) : LISTING_REPLACEMENT)).join('');
}

// A local time with its UTC offset, for example 2026-09-29T00:30:00+02:00.
function localIso(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// The path with the symbolic links of its existing part resolved; the part
// that does not exist yet is appended unchanged.
function realPath(target) {
  let current = path.resolve(target);
  const rest = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    rest.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...rest);
}

// True when <target> (which may not exist yet) lies inside <folder> or is it.
function isInside(target, folder) {
  const base = realPath(folder);
  const full = realPath(target);
  return full === base || full.startsWith(base + path.sep);
}

// Reads "--name value" options (options.values) and "--name" flags
// (options.flags). Calls stop(<message>) on an unknown argument or a missing
// value.
function parseArguments(argv, options, stop) {
  const args = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (options.values.includes(name)) {
      if (i + 1 >= argv.length) {
        stop(`${name} needs a value`);
        return args;
      }
      args[name] = argv[i + 1];
      i += 1;
    } else if (options.flags.includes(name)) {
      args.flags.add(name);
    } else {
      stop(`unknown argument: ${name}`);
      return args;
    }
  }
  return args;
}

module.exports = {
  HEADING_PREFIX, RESOLVED_MARK, SUPERSEDED_MARK, WORKLOG_CLASS,
  SESSION_LOG, WORKLOG_DIR, PARTS_HEADING, OPEN_ITEMS_HEADING, PART_COLUMNS, OPEN_ITEM_COLUMNS,
  PART_STATUSES, NOTE_LIMIT, NOTE_FORBIDDEN,
  splitLines, normalizeHeading, normalizeLine, headings, findSection, occurrenceOf, lineAtOccurrence,
  openItems, openItemText, splitRow, joinRow, sectionTable, columnIndex,
  itemId, lineItemId, keyItemId, worklogLine1, worklogClass, worklogNameValid, listingName,
  localIso, parseArguments, isInside,
};
