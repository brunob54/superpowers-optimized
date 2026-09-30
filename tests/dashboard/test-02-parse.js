'use strict';
// dashboard-parse.js: normalization, sections, ids, tables, open items,
// work-log rules, local ISO time, arguments.
const crypto = require('crypto');
const h = require('./helpers');
const p = require(h.script('dashboard-parse.js'));

h.eq('splitLines removes a byte order mark and carriage returns', p.splitLines('﻿a\r\nb\r\n'), ['a', 'b', '']);
h.eq('normalizeHeading removes one trailing superseded part', p.normalizeHeading('## 2026-09-29 20:30 [saved] [superseded by 2026-09-29]'), '## 2026-09-29 20:30 [saved]');
h.eq('normalizeLine removes one trailing resolved part', p.normalizeLine('- fix x [resolved 2026-09-29: from the dashboard]'), '- fix x');
h.eq('normalizeLine keeps a line without the part', p.normalizeLine('- fix x'), '- fix x');

const log = [
  '# Session log',
  '## E [saved]',
  'Open:',
  '- same',
  '- same',
  '## E [saved] [superseded by 2026-01-02]',
  '## E [saved]',
  'Goal: g',
];
const hs = p.headings(log);
h.eq('headings: normalized text and ordinals', hs.map((x) => [x.heading, x.ordinal, x.index, x.end]), [['## E [saved]', 1, 1, 5], ['## E [saved]', 2, 5, 6], ['## E [saved]', 3, 6, 8]]);
const first = p.findSection(log, '## E [saved]', 1);
h.eq('occurrenceOf counts equal normalized lines of the section', [p.occurrenceOf(log, first, 3), p.occurrenceOf(log, first, 4), p.occurrenceOf(log, first, 1)], [1, 2, 1]);
h.eq('lineAtOccurrence finds the second equal line', p.lineAtOccurrence(log, first, '- same', 2), 4);
h.eq('lineAtOccurrence gives -1 past the last', p.lineAtOccurrence(log, first, '- same', 3), -1);
h.eq('findSection gives null for a missing ordinal', p.findSection(log, '## E [saved]', 4), null);

const entry = [
  '## X',
  'Goal: g',
  'Open:',
  '- first item',
  '  continued here',
  '- done item [resolved 2026-01-02: ok]',
  'not a bullet',
  '- second item',
  'Rejected: something',
  '- after the list',
  'Open: one-line item',
  'Open:',
  '- third',
  '',
  '- after a blank line',
];
const items = p.openItems(entry, 1, entry.length);
h.eq('openItems: lines, raw marks and resolved marks', items.map((i) => [i.index, i.raw, i.resolved]), [[3, false, false], [5, false, true], [6, true, false], [7, false, false], [10, false, false], [12, false, false]]);
h.eq('openItems: a continuation line belongs to its item', items[0].continuation, ['  continued here']);
h.eq('openItemText strips the bullet and the one-line prefix', [p.openItemText('- first item'), p.openItemText('Open: one-line item')], ['first item', 'one-line item']);

h.eq('splitRow trims cells and keeps empty ones', p.splitRow('|  1 | x | not started | | | |'), ['1', 'x', 'not started', '', '', '']);
h.eq('joinRow writes single spaces', p.joinRow(['1', 'x', 'done', '2026-01-01', '', 'n']), '| 1 | x | done | 2026-01-01 |  | n |');
const table = ['## Parts', '| # | Part | Status |', '|---|------|--------|', '| 1 | a | done |', '| 2 | b |', 'text'];
const t = p.sectionTable(table, p.findSection(table, '## Parts', 1));
h.eq('sectionTable: header and rows; a short row is raw', [t.header, t.rows.map((r) => [r.index, r.raw])], [['#', 'Part', 'Status'], [[3, false], [4, true]]]);
h.eq('columnIndex maps names to positions', p.columnIndex(t.header, { number: '#', status: 'Status' }), { number: 0, status: 2 });
h.eq('columnIndex gives null for a missing column', p.columnIndex(t.header, { note: 'Note' }), null);

const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
h.eq('itemId is the SHA-1 of the parts joined by a line feed', p.itemId(['a', 'b']), sha1('a\nb'));
h.eq('lineItemId uses the normalized line', p.lineItemId('session-log.md', '## X', 1, '- a [resolved 2026-01-01: n]', 2), sha1('session-log.md\n## X\n1\n- a\n2'));
h.eq('keyItemId joins the section id and the key', p.keyItemId('commits', 'abc'), sha1('commits\nabc'));

const active = '<!-- Work log: status=active slug=a-b created=2026-09-21 -->';
const closed = '<!-- Work log: status=closed slug=a-b created=2026-09-21 closed=2026-09-22 -->';
h.eq('worklogClass: active, closed, malformed', [p.worklogClass(`${active}\n`), p.worklogClass(closed), p.worklogClass('<!-- Work log: status=open slug=a created=2026-09-21 -->')], ['active', 'closed', 'malformed']);
h.eq('worklogClass removes a byte order mark and carriage returns of line 1', p.worklogClass(`﻿${active}\r\nrest`), 'active');
h.eq('worklogNameValid', ['a-b.md', 'A.md', 'new.md', 'a--b.md', `${'s'.repeat(40)}.md`, `${'s'.repeat(41)}.md`].map(p.worklogNameValid), [true, false, false, false, true, false]);
h.eq('listingName replaces each other byte with ?', [p.listingName('x y.md'), p.listingName('café.md')], ['x?y.md', 'caf??.md']);

h.check('localIso has the local offset form', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(p.localIso(new Date())));
const date = new Date(2026, 8, 29, 0, 30, 5);
h.eq('localIso writes the local calendar date and time', p.localIso(date).slice(0, 19), '2026-09-29T00:30:05');

const stops = [];
const args = p.parseArguments(['--in', 'a.json', '--local'], { values: ['--in'], flags: ['--local'] }, (m) => stops.push(m));
h.eq('parseArguments reads values and flags', [args['--in'], args.flags.has('--local')], ['a.json', true]);
p.parseArguments(['--bad'], { values: [], flags: [] }, (m) => stops.push(m));
h.eq('parseArguments stops on an unknown argument', stops, ['unknown argument: --bad']);

const fs = require('fs');
const path = require('path');
const inside = h.repo('inside');
fs.symlinkSync(inside, path.join(h.ROOT, 'inside-link'));
h.eq('isInside: a new file inside, the folder itself, a folder beside it', [p.isInside(path.join(inside, 'a', 'b.json'), inside), p.isInside(inside, inside), p.isInside(path.join(h.ROOT, 'inside2', 'x'), inside)], [true, true, false]);
h.eq('isInside resolves a symbolic link of the existing part', p.isInside(path.join(h.ROOT, 'inside-link', 'x.json'), inside), true);

h.eq('the part statuses and the note rule are the values of the plan', [p.PART_STATUSES, p.NOTE_LIMIT, String(p.NOTE_FORBIDDEN)], [['not started', 'in progress', 'done'], 200, String(/[|[\]\r\n]/)]);

h.finish();
