'use strict';
// dashboard-sync.js --apply and --batches: one write per file, line endings
// and the byte order mark kept, repeated runs, both orders of two equal lines,
// a file that changes during the write, a sync stopped after the marking,
// ids that were not marked, a held run, batches of at most 50 records, and
// the security cases: a link at a temporary name, bytes that are not valid
// UTF-8, a git failure after a write, and an id with a line break.
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const SYNC = h.script('dashboard-sync.js');
const CREATED = '2026-09-29T00:30:00+02:00';
const SHA = 'c'.repeat(40);
const E = '## 2026-01-01 [saved]';
const RESOLVED = ' [resolved 2026-09-29: from the dashboard]';
const SESSION_LOG = [
  '# Session log', '', `${E} [superseded by 2026-01-02]`, 'Open:', '- same', '',
  E, 'Open:', '- same', '- same', '', E, 'Open:', '- same', '',
].join('\n');
const W = 'docs/worklogs/w.md';
const ROW4 = '| 4 | fourth | in progress | 2026-09-23 | | |';
const WORKLOG = [
  '<!-- Work log: status=active slug=w created=2026-09-21 -->', '', '## Parts', '',
  '| # | Part | Status | Since | Commit | Note |', '|---|------|--------|-------|--------|------|', ROW4, '',
].join('\n');
const resolve = (ordinal, occurrence, extra) => Object.assign({
  kind: 'resolve-open-item', file: 'session-log.md', branch: 'main', baseCommit: SHA,
  anchor: { heading: E, headingOrdinal: ordinal, line: '- same', occurrence }, createdAt: CREATED, state: 'pending', closedAt: null,
}, extra || {});
const part = (fields) => Object.assign({
  kind: 'set-part', file: W, branch: 'main', baseCommit: SHA,
  anchor: { heading: '## Parts', headingOrdinal: 1, line: ROW4, occurrence: 1, part: '4' },
  createdAt: CREATED, state: 'pending', closedAt: null,
}, fields);

let folderCount = 0;
function folderOf(docs) {
  folderCount += 1;
  const folder = path.join(h.ROOT, `apply-${folderCount}`);
  Object.entries(docs).forEach(([id, doc], i) => h.proposalFile(folder, id, doc, i + 1));
  return folder;
}
const versionsOf = (folder) => ['--versions', h.versionsFile(folder)];
const apply = (dir, folder, ids, env) => h.node(dir, [SYNC, '--apply', folder, ...ids, ...versionsOf(folder)], env);
const lines = (result) => result.out.trim().split('\n');
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
function freshRepo(name, sessionText) {
  const d = h.repo(name);
  h.write(d, W, WORKLOG);
  h.commit(d, 'base', ['docs']);
  h.write(d, 'session-log.md', sessionText === undefined ? SESSION_LOG : sessionText);
  return d;
}

// 1. Entry 2 of three equal headings (entry 1 superseded): both equal lines
// in one call; entry 3 and the superseded entry are never written.
let d = freshRepo('apply-one');
const both = folderOf({ a: resolve(2, 1), b: resolve(2, 2) });
let result = apply(d, both, ['a', 'b']);
let log = read(d, 'session-log.md').split('\n');
h.eq('both equal lines of entry 2 are resolved', [log[8], log[9]], [`- same${RESOLVED}`, `- same${RESOLVED}`]);
h.eq('entry 3 and the superseded entry are unchanged', [log[4], log[13]], ['- same', '- same']);
h.eq('the report lines', lines(result), ['proposal a: applied', 'proposal b: applied', 'changed session-log.md (untracked)']);
const afterFirst = read(d, 'session-log.md');
result = apply(d, both, ['a', 'b']);
h.check('a second run gives already-applied and writes nothing', lines(result).every((line) => line.includes('already-applied')) && read(d, 'session-log.md') === afterFirst);

// 2. The two equal lines applied one at a time, in both orders.
for (const order of [['b', 'a'], ['a', 'b']]) {
  d = freshRepo(`apply-order-${order.join('')}`);
  const folder = folderOf({ a: resolve(2, 1), b: resolve(2, 2) });
  order.forEach((id) => apply(d, folder, [id]));
  log = read(d, 'session-log.md');
  h.eq(`order ${order.join(' then ')}: both lines resolved, none twice`, [log.split('[resolved').length - 1, log.split('\n')[8], log.split('\n')[9]], [2, `- same${RESOLVED}`, `- same${RESOLVED}`]);
}

// 3. A part: status and note on one row, in a tracked file.
d = freshRepo('apply-part');
result = apply(d, folderOf({ p: part({ status: 'done', note: 'finished' }) }), ['p']);
h.eq('the row is rewritten', read(d, W).split('\n')[6], '| 4 | fourth | done | 2026-09-29 |  | finished |');
h.eq('a tracked file is named as tracked', lines(result)[1], `changed ${W} (tracked)`);

// 4. Carriage returns and a byte order mark are kept.
d = freshRepo('apply-crlf', `\uFEFF${SESSION_LOG.split('\n').join('\r\n')}`);
apply(d, folderOf({ c: resolve(3, 1) }), ['c']);
const raw = read(d, 'session-log.md');
h.eq('byte order mark, carriage returns, changed line', [raw.startsWith('\uFEFF'), raw.split('\n').slice(0, -1).every((line) => line.endsWith('\r')), raw.split('\r\n')[13]], [true, true, `- same${RESOLVED}`]);

// 5. The file changes between the read and the rename: the check runs again.
d = freshRepo('apply-race');
result = apply(d, folderOf({ c: resolve(3, 1) }), ['c'], { DASHBOARD_SYNC_TEST_CHANGE_ONCE: '- appended line\n' });
log = read(d, 'session-log.md');
h.eq('the change is applied and the other writer\'s line is kept', [lines(result)[0], log.split('\n')[13], log.includes('- appended line')], ['proposal c: applied', `- same${RESOLVED}`, true]);
h.eq('no temporary file is left', fs.readdirSync(d).filter((name) => name.endsWith('.tmp')), []);

// 6. A sync that stopped after the marking: the next check completes it.
d = freshRepo('apply-resume', SESSION_LOG.replace('- same\n- same', `- same${RESOLVED}\n- same`));
const marked = folderOf({ a: resolve(2, 1, { state: 'applying' }), b: resolve(2, 2, { state: 'applying' }) });
const checked = h.node(d, [SYNC, '--check', marked, ...versionsOf(marked)]);
h.check('check: already-applied for the written line, unique for the other', checked.out.includes('proposal a: already-applied') && checked.out.includes('proposal b: unique'));
h.eq('apply completes it', lines(apply(d, marked, ['a', 'b'])).slice(0, 2), ['proposal a: already-applied — the line already holds this change', 'proposal b: applied']);

// 7. Only the listed ids are written; an unknown id is reported.
d = freshRepo('apply-subset');
result = apply(d, folderOf({ a: resolve(2, 1), b: resolve(2, 2) }), ['a', 'zzz']);
log = read(d, 'session-log.md').split('\n');
h.eq('an id that was not marked is not written', [log[8], log[9]], [`- same${RESOLVED}`, '- same']);
h.check('an unknown id is reported', lines(result)[0] === 'proposal zzz: not-found — no file for this id in the folder');
h.check('an invalid proposal is reported and nothing is read', lines(apply(d, folderOf({ x: resolve(2, 1, { file: '../session-log.md' }) }), ['x']))[0].startsWith('proposal x: invalid'));

// 8. A held run: nothing is written.
d = freshRepo('apply-held');
h.git(d, 'checkout', '-q', '-b', 'feature/stopped');
h.write(d, h.logPath('2026-09-21', 'stopped'), h.runLog('stopped', ['## STOPPED — 2026-09-21 — phase 3 — blocked']));
h.commit(d, 'stopped log', ['docs/superpowers-orchestrator']);
h.git(d, 'checkout', '-q', 'main');
result = apply(d, folderOf({ p: part({ status: 'done' }) }), ['p']);
h.eq('held-run: the tracked file is not written', [lines(result).length, lines(result)[0].startsWith('proposal p: held-run'), read(d, W)], [1, true, WORKLOG]);

// 9. Batches of at most 50 records, pinned to each file's version.
const many = {};
for (let i = 0; i < 120; i += 1) many[`p${String(i).padStart(3, '0')}`] = resolve(2, 1);
const manyFolder = folderOf(many);
const manyVersions = versionsOf(manyFolder);
const ids = Object.keys(many);
const batchLines = lines(h.node(d, [SYNC, '--batches', manyFolder, 'applied', ...ids, ...manyVersions])).map((line) => JSON.parse(line));
h.eq('three batches of 50, 50 and 20', batchLines.map((batch) => batch.length), [50, 50, 20]);
const first = batchLines[0][0];
h.eq('one record', [first.op, first.collection, first.doc_id, first.data.state, first.if_version, batchLines[2][19].if_version], ['update', 'proposals', 'p000', 'applied', 1, 120]);
h.check('applied records carry closedAt as local time with its offset', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(first.data.closedAt));
h.eq('pending records carry closedAt null', JSON.parse(lines(h.node(d, [SYNC, '--batches', manyFolder, 'pending', 'p000', ...manyVersions]))[0])[0].data.closedAt, null);
h.eq('an unknown state stops', h.node(d, [SYNC, '--batches', manyFolder, 'done', 'p000', ...manyVersions]).code, 2);
h.eq('an id with no file stops', h.node(d, [SYNC, '--batches', manyFolder, 'applied', 'nothing', ...manyVersions]).code, 2);
h.eq('a --data-dir pair is accepted and not read', JSON.parse(lines(h.node(d, [SYNC, '--data-dir', '', '--batches', manyFolder, 'pending', 'p000', ...manyVersions]))[0])[0].doc_id, 'p000');

// A preload module runs in the process of the script before the script
// itself, so it can act at the exact moment that another program would.
function preload(name, code) {
  const file = path.join(h.ROOT, name);
  fs.writeFileSync(file, `'use strict';\nconst fs = require('fs');\nconst path = require('path');\n${code}\n`);
  return file;
}
const applyWith = (module, dir, folder, ids) => h.node(dir, ['-r', module, SYNC, '--apply', folder, ...ids, ...versionsOf(folder)]);
const SESSION_LINES = SESSION_LOG.split('\n');
const RESOLVED_LINES = SESSION_LINES.slice();
RESOLVED_LINES[13] = `- same${RESOLVED}`;

// 10. A symbolic link at the temporary name (the random part is fixed by the
// preload): the create-only write never goes through it.
d = freshRepo('apply-temp-link');
const outside = path.join(h.ROOT, 'outside-apply.txt');
fs.writeFileSync(outside, 'OUTSIDE');
const TEMP_NAME_HEX = '07'.repeat(6);
const plantLink = preload('plant-link.js', `require('crypto').randomBytes = (count) => Buffer.alloc(count, 7);
fs.symlinkSync(${JSON.stringify(outside)}, path.join(process.cwd(), '.session-log.md.dashboard-${TEMP_NAME_HEX}.tmp'));`);
result = applyWith(plantLink, d, folderOf({ c: resolve(3, 1) }), ['c']);
h.eq('a link at the temporary name: the create-only write stops, the outside file and the target are unchanged', [fs.readFileSync(outside, 'utf8'), result.code !== 0, result.out.includes('proposal c: applied'), read(d, 'session-log.md')], ['OUTSIDE', true, false, SESSION_LOG]);

// 11. A byte that is not valid UTF-8 on a line that no proposal changes is
// written back as it was.
const LATIN1_LINE = Buffer.from('- caf\xE9 (latin-1)\n', 'latin1');
d = freshRepo('apply-bytes', Buffer.concat([Buffer.from(SESSION_LOG), LATIN1_LINE]));
apply(d, folderOf({ c: resolve(3, 1) }), ['c']);
h.check('the lines not changed are written back byte for byte', fs.readFileSync(path.join(d, 'session-log.md')).equals(Buffer.concat([Buffer.from(RESOLVED_LINES.join('\n')), LATIN1_LINE])));

// 12. Git fails after the first file was written: the report of that file
// is printed before the stop.
d = freshRepo('apply-git-fails');
const breakIndex = preload('break-index.js', `const rename = fs.renameSync;
fs.renameSync = (...args) => {
  rename(...args);
  fs.renameSync = rename;
  fs.writeFileSync(path.join(process.cwd(), '.git', 'index'), 'not an index');
};`);
result = applyWith(breakIndex, d, folderOf({ a: resolve(2, 1), b: part({ status: 'done' }) }), ['a', 'b']);
h.eq('the written file is reported, then the git failure stops', [result.code, lines(result)], [2, ['proposal a: applied', 'changed session-log.md (untracked)']]);

// 14. The file changes during every attempt (only the modification time, so
// the bytes stay the same): nothing is written, no applied line, exit 1.
d = freshRepo('apply-always-changing');
const touchAlways = preload('touch-always.js', `const stat = fs.statSync;
let tick = 0;
fs.statSync = (target, ...rest) => {
  const result = stat(target, ...rest);
  if (String(target).endsWith('session-log.md')) { tick += 1; fs.utimesSync(target, 1000 + tick, 1000 + tick); }
  return result;
};`);
result = applyWith(touchAlways, d, folderOf({ c: resolve(3, 1) }), ['c']);
h.eq('a file that changes 3 times: exit 1, one not-written line, no proposal line, bytes kept', [result.code, lines(result).length, lines(result)[0].startsWith('not written: session-log.md changed 3 times'), result.out.includes('proposal '), read(d, 'session-log.md'), fs.readdirSync(d).filter((name) => name.endsWith('.tmp'))], [1, 1, true, false, SESSION_LOG, []]);

// 15. The rename fails: exit 1, one not-written line naming the temporary
// file that keeps the new text, no proposal line, the target unchanged.
d = freshRepo('apply-rename-fails');
const failRename = preload('fail-rename.js', `fs.renameSync = () => { throw new Error('rename refused'); };`);
result = applyWith(failRename, d, folderOf({ c: resolve(3, 1) }), ['c']);
const kept = (lines(result)[0].match(/the new text is kept in (.+)$/) || [])[1];
h.eq('a failed rename: exit 1, one not-written line, no proposal line, bytes kept', [result.code, lines(result).length, lines(result)[0].startsWith('not written: session-log.md: rename refused'), result.out.includes('proposal '), read(d, 'session-log.md')], [1, 1, true, false, SESSION_LOG]);
h.check('the printed temporary file exists and holds the new text', Boolean(kept) && fs.existsSync(kept) && fs.readFileSync(kept, 'utf8') === RESOLVED_LINES.join('\n'));
if (kept) fs.rmSync(kept, { force: true });

// 13. An id argument with a line break is printed escaped, on one line.
d = freshRepo('apply-id-escape');
const escapeFolder = folderOf({ a: resolve(2, 1) });
const FORGED = 'zz\nproposal a: applied';
h.eq('the not-found line holds the escaped id', lines(apply(d, escapeFolder, [FORGED])), [`proposal ${JSON.stringify(FORGED)}: not-found — no file for this id in the folder`]);
result = h.node(d, [SYNC, '--batches', escapeFolder, 'applied', FORGED, ...versionsOf(escapeFolder)]);
h.eq('batches: the stop message holds the escaped id on one line', [result.code, result.out, result.err.trim().split('\n').length, result.err.includes(JSON.stringify(FORGED))], [2, '', 1, true]);

h.finish();
