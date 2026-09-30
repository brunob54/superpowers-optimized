'use strict';
// dashboard-extract.js, private audience: the file sections.
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const EXTRACT = h.script('dashboard-extract.js');
function extract(dir) {
  const result = h.node(dir, [EXTRACT, '--audience', 'private']);
  if (result.code !== 0) throw new Error(`extract failed: ${result.err}`);
  return JSON.parse(result.out).sections;
}
const pick = (section, fields) => section.items.map((item) => fields.map((field) => item[field]));

const d = h.repo('files');
h.write(d, 'file.txt', 'base\n');
h.commit(d, 'base', ['file.txt']);

// 1. session-log.md: nine dated entries (the fifth superseded), then four
// more; 12 entries count, the last 10 are read, entries 1 and 2 are older.
const log = ['# Session log', ''];
for (let n = 1; n <= 9; n += 1) {
  log.push(n === 5 ? '## 2026-01-05 [saved] [superseded by 2026-01-06]' : `## 2026-01-0${n} [saved]`, `Goal: goal ${n}`);
  if (n <= 2) log.push('Open:', `- older item ${n}`, `- older done ${n} [resolved 2026-01-0${n}: ok]`);
  if (n === 5) log.push('Open:', '- superseded item');
  log.push('');
}
log.push(
  '## 2026-01-10 [saved]', 'Goal: goal 10', 'Open:', '- fine item', 'oops not a bullet', '',
  '## 2026-01-11 [saved]', 'Goal: goal 11', 'Decisions:', '- a decision', 'Open:', '- first item', '  continued here',
  '- same item', '- same item', '- closed item [resolved 2026-01-11: done]', 'Rejected: x', '- not an item', '',
  '## 2026-01-11 [saved]', 'Goal: goal 12', 'Open: one-line item', '',
  '## 2026-01-13 [saved]', 'Goal: goal 13', '',
);
h.write(d, 'session-log.md', log.join('\n'));

// 2. state.md with a byte order mark and carriage returns; known-issues.md.
h.write(d, 'state.md', `\uFEFF# State\r\n\r\n## Current Goal\r\n\r\n${'g'.repeat(350)}\r\n\r\n## Plan\r\nx\r\n`);
h.write(d, 'known-issues.md', '# Known issues\n\n## First problem\ntext\n\n## Second problem\n');

// 3. VERSION and 17 release headings.
h.write(d, 'VERSION', '7.1.0\n');
const notes = ['# Release notes', ''];
for (let i = 16; i >= 1; i -= 1) notes.push(`## v7.0.${i} — release ${i}`, '', 'text', '');
notes.push('## [1.0.0] — 2020-01-01', '');
h.write(d, 'RELEASE-NOTES.md', notes.join('\n'));

// 4. Work logs: active, closed, malformed, a symbolic link, an invalid name.
const W = 'docs/worklogs';
h.write(d, `${W}/active-one.md`, [
  '<!-- Work log: status=active slug=active-one created=2026-09-21 -->', '', '# Work log: one', '', '## Parts', '',
  '| # | Part | Status | Since | Commit | Note |', '|---|------|--------|-------|--------|------|',
  '| 1 | first | done | 2026-09-22 | abc1234 | |', '| 2 | second | in progress | 2026-09-23 | | blocked by item #1 |',
  '| 3 | third | not started | | | |', '| 4 | short row | done |', '', '## Open items', '',
  '| # | Item | Part | Found | Blocks |', '|---|------|------|-------|--------|', '| 1 | fix the parser | 2 | 2026-09-23 | 2 |', '',
  'Next item number: 2', '',
].join('\n'));
h.write(d, `${W}/shut.md`, '<!-- Work log: status=closed slug=shut created=2026-09-21 closed=2026-09-22 -->\n');
h.write(d, `${W}/broken.md`, '<!-- Work log: status=open slug=broken created=2026-09-21 -->\n');
h.write(d, `${W}/Bad Name.md`, '<!-- Work log: status=active slug=x created=2026-09-21 -->\n');
fs.symlinkSync('active-one.md', path.join(d, W, 'link.md'));

// 5. Topic folders: a committed one with a log, a merged run, an untracked one.
const R = 'docs/superpowers-orchestrator';
h.write(d, `${R}/2026-09-01-alpha/specs/alpha-design.md`, '# spec\n');
h.write(d, `${R}/2026-09-01-alpha/plans/alpha.md`, '# plan\n');
h.write(d, `${R}/2026-09-01-alpha/alpha-orchestration-log.md`, h.runLog('alpha', ['## Phase 1 — Plan — DONE', '## RULING 1 — x', '## STOPPED — y', '## RULING 2 — z']));
h.write(d, `${R}/notes/readme.md`, 'not a topic folder\n');
h.commit(d, 'worklogs and topics', ['docs', 'VERSION', 'RELEASE-NOTES.md']);
h.git(d, 'checkout', '-q', '-b', 'feature/merged');
h.write(d, `${R}/2026-09-03-merged/merged-orchestration-log.md`, h.runLog('merged', ['## Phase 1']));
h.commit(d, 'merged log', ['docs']);
h.git(d, 'checkout', '-q', 'main');
h.git(d, 'merge', '-q', '--no-edit', 'feature/merged');
h.write(d, `${R}/2026-09-02-beta/specs/beta-design.md`, '# untracked spec\n');

const s = extract(d);
h.eq('sessionOpenItems: kinds and texts of the 10 recent entries', pick(s.sessionOpenItems, ['kind', 'text']), [
  ['open-item', 'fine item'], ['raw', 'oops not a bullet'], ['open-item', 'first item'],
  ['open-item', 'same item'], ['open-item', 'same item'], ['open-item', 'one-line item'],
]);
const same = s.sessionOpenItems.items.filter((item) => item.text === 'same item');
h.eq('two equal lines: occurrences 1 and 2 and two ids', [same[0].source.occurrence, same[1].source.occurrence, same[0].id !== same[1].id], [1, 2, true]);
h.eq('the second equal heading has ordinal 2', s.sessionOpenItems.items[5].source.headingOrdinal, 2);
h.eq('a continuation line stays with its item', s.sessionOpenItems.items[2].continuation, ['  continued here']);
h.eq('the anchor line is the exact raw line', s.sessionOpenItems.items[2].source.line, '- first item');
h.eq('older unresolved open items are counted', s.sessionOpenItems.olderUnresolved, 2);
h.eq('an untracked session-log.md gives private items', s.sessionOpenItems.items[0].visibility, 'private');
h.eq('sessions: the Goal lines of the same 10 entries', s.sessions.items.map((item) => item.goal), ['goal 3', 'goal 4', 'goal 6', 'goal 7', 'goal 8', 'goal 9', 'goal 10', 'goal 11', 'goal 12', 'goal 13']);
h.eq('currentGoal: 300 characters, no carriage return', [s.currentGoal.items[0].text.length, s.currentGoal.items[0].text.includes('\r')], [300, false]);
h.eq('knownIssues: the ## titles', s.knownIssues.items.map((item) => item.title), ['First problem', 'Second problem']);
h.eq('releases: version, 15 headings, file order', [s.releases.version, s.releases.items.length, s.releases.items[0].heading], ['7.1.0', 15, '## v7.0.16 — release 16']);
h.eq('activeWorklogs: items in file-name order', pick(s.activeWorklogs, ['kind', 'path', 'number']), [
  ['worklog-file', 'docs/worklogs/?ad??ame.md', null],
  ['worklog', 'docs/worklogs/active-one.md', null],
  ['part', null, '2'], ['part', null, '3'], ['raw', null, null], ['worklog-open-item', null, '1'],
  ['worklog-file', 'docs/worklogs/broken.md', null],
  ['worklog-file', 'docs/worklogs/link.md', null],
]);
h.eq('worklog-file notes', s.activeWorklogs.items.filter((i) => i.kind === 'worklog-file').map((i) => i.note), ['invalid file name, not read', 'malformed line 1: run /worklog to see why', 'symbolic link, not read']);
const part2 = s.activeWorklogs.items.find((i) => i.kind === 'part' && i.number === '2');
h.eq('a part keeps its cells, its anchor and its visibility', [part2.status, part2.note, part2.worklog, part2.source.heading, part2.visibility], ['in progress', 'blocked by item #1', 'active-one', '## Parts', 'tracked']);
h.eq('closedWorklogs: the closed log and its date', pick(s.closedWorklogs, ['slug', 'closed']), [['shut', '2026-09-22']]);
h.eq('runHistory: folders, stages, last heading, counts', pick(s.runHistory, ['slug', 'stages', 'lastHeading', 'rulings', 'stops', 'visibility']), [
  ['alpha', ['specs', 'plans'], '## RULING 2 — z', 2, 1, 'tracked'],
  ['beta', ['specs'], null, 0, 0, 'private'],
  ['merged', [], '## Phase 1', 0, 0, 'tracked'],
]);
h.eq('a merged log is history only', s.unfinishedRuns.items.length, 0);

h.commit(d, 'session log', ['session-log.md']);
h.eq('a committed session-log.md gives tracked items', extract(d).sessionOpenItems.items[0].visibility, 'tracked');

// 6. Missing sources, and the release fallbacks.
const m = h.repo('nothing');
h.write(m, 'file.txt', 'x\n');
h.commit(m, 'base', ['file.txt']);
const ms = extract(m);
const FILE_SECTIONS = ['activeWorklogs', 'closedWorklogs', 'sessionOpenItems', 'sessions', 'currentGoal', 'releases', 'runHistory', 'knownIssues'];
h.eq('missing sources give not-found', FILE_SECTIONS.map((id) => ms[id].status), FILE_SECTIONS.map(() => 'not-found'));
h.eq('the other sections still build', [ms.commits.status, ms.git.status, ms.unfinishedRuns.status], ['ok', 'ok', 'ok']);

const c = h.repo('changelog');
h.write(c, 'package.json', '{"name":"x","version":"2.3.4"}\n');
h.write(c, 'CHANGELOG.md', '# Changelog\n\n## [2.3.4] - 2026-01-01\n\n## [2.3.3] - 2025-12-01\n');
h.commit(c, 'base', ['package.json', 'CHANGELOG.md']);
const cs = extract(c).releases;
h.eq('CHANGELOG.md and package.json are the fallbacks', [cs.version, cs.file, cs.items.map((i) => i.heading)], ['2.3.4', 'CHANGELOG.md', ['## [2.3.4] - 2026-01-01', '## [2.3.3] - 2025-12-01']]);
const nm = h.repo('no-match');
h.write(nm, 'RELEASE-NOTES.md', '# Notes\n\n## Something else\n');
h.commit(nm, 'base', ['RELEASE-NOTES.md']);
const ns = extract(nm).releases;
h.eq('a release file with no release heading gives a note', [ns.status, ns.items.length, /no release heading/.test(ns.note)], ['ok', 0, true]);

// A work log whose read fails is listed with a note, never dropped.
const u = h.repo('unreadable');
h.write(u, 'docs/worklogs/locked.md', '<!-- Work log: status=active slug=locked created=2026-09-21 -->\n');
h.commit(u, 'base', ['docs']);
const lockedFile = path.join(u, 'docs', 'worklogs', 'locked.md');
fs.chmodSync(lockedFile, 0);
let canRead = true;
try { fs.readFileSync(lockedFile); } catch (error) { canRead = false; }
if (canRead) {
  console.log('  NOTE: this account can read a file with no permission; the unreadable case is skipped');
} else {
  const locked = extract(u).activeWorklogs;
  h.eq('an unreadable work log is listed with a note', [locked.status, locked.items.map((i) => [i.kind, i.path, i.note])], ['ok', [['worklog-file', 'docs/worklogs/locked.md', 'could not be read']]]);
}
fs.chmodSync(lockedFile, 0o644);

h.finish();
