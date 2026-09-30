'use strict';
// dashboard-sync.js --check: every verdict of spec section 8 step 2, the
// anchors (ordinal, occurrence, normalization), the new lines and the
// warnings.
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const SYNC = h.script('dashboard-sync.js');
const CREATED = '2026-09-29T00:30:00+02:00';
const SHA = 'c'.repeat(40);
const W = 'docs/worklogs/w.md';
const E = '## 2026-01-01 [saved]';
const LAST = '## 2026-01-05 [saved]';
const ROW = {
  1: '| 1 | first | done | 2026-09-22 | abc1234 | |',
  2: '| 2 | second | in progress | 2026-09-23 | | waits on item #1 |',
  3: '|  3  | third | not started |  |  |  |',
  4: '| 4 | fourth | in progress | 2026-09-23 | | |',
  5: '| 5 | dup | in progress | | | |',
};
const WORKLOG = [
  '<!-- Work log: status=active slug=w created=2026-09-21 -->', '', '## Parts', '',
  '| # | Part | Status | Since | Commit | Note |', '|---|------|--------|-------|--------|------|',
  ROW[1], ROW[2], ROW[3], ROW[4], ROW[5], ROW[5], '', '## Open items', '',
  '| # | Item | Part | Found | Blocks |', '|---|------|------|-------|--------|', '| 1 | fix x | 4 | 2026-09-23 | 4 |', '',
].join('\n');
const SESSION_LOG = [
  '# Session log', '',
  `${E} [superseded by 2026-01-02]`, 'Open:', '- same', '',
  E, 'Open:', '- same', '- same', '',
  E, 'Open:', '- same', '',
  LAST, 'Open: one line', '',
].join('\n');

const resolve = (heading, ordinal, line, occurrence, extra) => Object.assign({
  kind: 'resolve-open-item', file: 'session-log.md', branch: 'main', baseCommit: SHA,
  anchor: { heading, headingOrdinal: ordinal, line, occurrence }, createdAt: CREATED, state: 'pending', closedAt: null,
}, extra || {});
const oneLine = (extra) => resolve(LAST, 1, 'Open: one line', 1, extra);
const setPart = (part, fields, extra) => Object.assign({
  kind: 'set-part', file: W, branch: 'main', baseCommit: SHA,
  anchor: { heading: '## Parts', headingOrdinal: 1, line: ROW[part], occurrence: 1, part: String(part) },
  createdAt: CREATED, state: 'pending', closedAt: null,
}, fields, extra || {});

// Runs --check in <dir> on the proposals <docs> ({ id: document, or a raw
// file text }); returns { id: { verdict, lines } } and the raw output.
let folderCount = 0;
function check(dir, docs) {
  folderCount += 1;
  const folder = path.join(h.ROOT, `check-${folderCount}`);
  Object.entries(docs).forEach(([id, doc]) => h.proposalFile(folder, id, doc, 1));
  const result = h.node(dir, [SYNC, '--check', folder, '--versions', h.versionsFile(folder)]);
  const found = {};
  let current = null;
  for (const line of result.out.split('\n')) {
    const match = line.match(/^proposal (\S+): (\S+)/);
    if (match) {
      current = { verdict: match[2], lines: [] };
      found[match[1]] = current;
    } else if (current && line.startsWith('  ')) {
      current.lines.push(line.trim());
    }
  }
  return { found, out: result.out, code: result.code };
}
const verdictOf = (run) => Object.fromEntries(Object.entries(run.found).map(([id, value]) => [id, value.verdict]));

const d = h.repo('sync-check');
h.write(d, 'file.txt', 'x\n');
h.write(d, W, WORKLOG);
fs.symlinkSync('w.md', path.join(d, 'docs', 'worklogs', 'link.md'));
h.commit(d, 'base', ['file.txt', 'docs']);
h.write(d, 'session-log.md', SESSION_LOG);

// 1. unique targets and their new lines.
let run = check(d, {
  one: oneLine(),
  utc: oneLine({ createdAt: '2026-09-30T00:30:00+02:00' }),
  noted: oneLine({ note: 'done here' }),
  entry2: resolve(E, 2, '- same', 2),
  part4: setPart(4, { status: 'done' }),
  part2: setPart(2, { note: 'new note' }),
  padded: setPart(3, { status: 'in progress' }),
  sameStatus: setPart(4, { status: 'in progress', note: 'n' }),
  both: setPart(4, { status: 'done', note: 'finished' }),
});
h.eq('unique verdicts', Object.values(verdictOf(run)), Array(9).fill('unique'));
h.eq('resolve: the diff and the default note', run.found.one.lines, ['file: session-log.md (untracked)', '- Open: one line', '+ Open: one line [resolved 2026-09-29: from the dashboard]']);
h.eq('the date is the local date of createdAt, not its UTC date', run.found.utc.lines[2], '+ Open: one line [resolved 2026-09-30: from the dashboard]');
h.eq('a given note is written', run.found.noted.lines[2], '+ Open: one line [resolved 2026-09-29: done here]');
h.eq('set-part: status and Since change; a blocked part gets a warning', [run.found.part4.lines[2], run.found.part4.lines.some((l) => l.startsWith('warning: an open item blocks this part'))], ['+ | 4 | fourth | done | 2026-09-29 |  |  |', true]);
h.check('a target that git tracks is labelled tracked', run.found.part4.lines[0].endsWith(' (tracked)'));
h.check('a note that replaces an "item #" Note gets a warning', run.found.part2.lines.some((l) => l.startsWith('warning: the Note')));
h.eq('a padded row is rewritten with single spaces', run.found.padded.lines.slice(1, 3), [`- ${ROW[3]}`, '+ | 3 | third | in progress | 2026-09-29 |  |  |']);
h.eq('a status equal to the current one keeps Since', run.found.sameStatus.lines[2], '+ | 4 | fourth | in progress | 2026-09-23 |  | n |');
h.eq('status and note on one row in one proposal', run.found.both.lines[2], '+ | 4 | fourth | done | 2026-09-29 |  | finished |');
h.check('the summary line counts the verdicts', run.out.includes('summary: unique=9'));

// 2. none, several, already-applied.
run = check(d, {
  gone: resolve(E, 2, '- vanished', 1),
  ordinal: resolve(E, 9, '- same', 1),
  occurrence: resolve(E, 3, '- same', 2),
  changed: oneLine({ anchor: { heading: LAST, headingOrdinal: 1, line: 'Open: other text', occurrence: 1 } }),
  dup: setPart(5, { status: 'done' }),
  missingPart: setPart(4, { status: 'done' }, { anchor: { heading: '## Parts', headingOrdinal: 1, line: ROW[4], occurrence: 1, part: '9' } }),
});
h.eq('none and several', verdictOf(run), { changed: 'none', dup: 'several', gone: 'none', missingPart: 'none', occurrence: 'none', ordinal: 'none' });
const resolvedLog = SESSION_LOG.replace('Open: one line', 'Open: one line [resolved 2026-09-29: from the dashboard]');
fs.writeFileSync(path.join(d, 'session-log.md'), resolvedLog);
h.eq('the expected new line at the anchor gives already-applied', verdictOf(check(d, { one: oneLine() })), { one: 'already-applied' });
fs.writeFileSync(path.join(d, 'session-log.md'), SESSION_LOG);

// 3. invalid: one proposal per rule of spec section 8 step 2.1.
const invalid = {
  badKind: oneLine({ kind: 'delete' }),
  dotdot: oneLine({ file: '../session-log.md' }),
  absolute: oneLine({ file: '/etc/passwd' }),
  backslash: setPart(4, { status: 'done' }, { file: 'docs\\worklogs\\w.md' }),
  resolveOther: oneLine({ file: 'state.md' }),
  setPartOther: setPart(4, { status: 'done' }, { file: 'docs/other/w.md' }),
  badStatus: setPart(4, { status: 'dropped' }),
  pipeNote: setPart(4, { note: 'a | b' }),
  bracketNote: oneLine({ note: 'see [x]' }),
  longNote: setPart(4, { note: 'x'.repeat(201) }),
  twoLines: oneLine({ note: 'a\nb' }),
  nothing: setPart(4, {}),
  noAnchor: oneLine({ anchor: { heading: LAST } }),
  detached: setPart(4, { status: 'done' }, { branch: null }),
  badCreated: oneLine({ createdAt: '2026-09-29 00:30' }),
  noop: setPart(4, { status: 'in progress' }),
  doneWithCommit: setPart(1, { status: 'in progress' }),
  symlink: setPart(4, { status: 'done' }, { file: 'docs/worklogs/link.md' }),
};
run = check(d, Object.assign({ broken: '{' }, invalid));
h.eq('every rule gives invalid', verdictOf(run), Object.fromEntries(Object.keys(invalid).concat('broken').sort().map((id) => [id, 'invalid'])));

// 4. file-missing and wrong-branch.
run = check(d, {
  missing: setPart(4, { status: 'done' }, { file: 'docs/worklogs/gone.md' }),
  otherBranch: setPart(4, { status: 'done' }, { branch: 'feature/other' }),
});
h.eq('file-missing and wrong-branch', verdictOf(run), { missing: 'file-missing', otherBranch: 'wrong-branch' });

// 5. held-run: an in-progress run on another branch holds nothing; on the
// current branch it holds tracked files; a stopped run holds them from any
// branch; an untracked session-log.md is never held.
h.git(d, 'checkout', '-q', '-b', 'feature/busy');
h.write(d, h.logPath('2026-09-20', 'busy'), h.runLog('busy', ['## Phase 3 — Batch 1']));
h.commit(d, 'busy log', ['docs/superpowers-orchestrator']);
h.git(d, 'checkout', '-q', 'main');
h.eq('an in-progress run on another branch holds nothing', verdictOf(check(d, { part: setPart(4, { status: 'done' }) })), { part: 'unique' });
h.git(d, 'checkout', '-q', 'feature/busy');
h.eq('an in-progress run on the current branch holds a tracked file', verdictOf(check(d, { part: setPart(4, { status: 'done' }, { branch: 'feature/busy' }) })), { part: 'held-run' });
h.git(d, 'checkout', '-q', '-b', 'feature/stopped', 'main');
h.write(d, h.logPath('2026-09-21', 'stopped'), h.runLog('stopped', ['## Phase 1', '## STOPPED — 2026-09-21 — phase 3 — blocked']));
h.commit(d, 'stopped log', ['docs/superpowers-orchestrator']);
h.eq('a stopped run on the current branch holds a tracked file', verdictOf(check(d, { part: setPart(4, { status: 'done' }, { branch: 'feature/stopped' }) })), { part: 'held-run' });
h.git(d, 'checkout', '-q', 'main');
h.eq('a stopped run on another branch: tracked held, untracked not', verdictOf(check(d, { part: setPart(4, { status: 'done' }), one: oneLine() })), { one: 'unique', part: 'held-run' });
h.commit(d, 'track the session log', ['session-log.md']);
h.eq('a tracked session-log.md is held too', verdictOf(check(d, { one: oneLine() })), { one: 'held-run' });

// 6. The command cannot run: no proposal folder, no --versions option, or a
// versions file that does not match the body files one to one. No verdict
// line is printed.
h.eq('no proposal folder: exit 2', h.node(d, [SYNC, '--check', path.join(h.ROOT, 'nowhere'), '--versions', path.join(h.ROOT, 'nowhere.txt')]).code, 2);
const joined = path.join(h.ROOT, 'versions-join');
h.proposalFile(joined, 'one', oneLine(), 1);
h.eq('no --versions option: exit 2', h.node(d, [SYNC, '--check', joined]).code, 2);
const badVersions = {
  'a body file with no versions line': '',
  'a versions line with no body file': 'one 1\nother 1\n',
  'an id on two lines': 'one 1\none 2\n',
  'a version that is not a positive integer': 'one 0\n',
  'a version that is not a number': 'one v1\n',
  'a line with no version': 'one\n',
};
Object.entries(badVersions).forEach(([name, text], i) => {
  const file = path.join(h.ROOT, `versions-bad-${i}.txt`);
  fs.writeFileSync(file, text);
  const result = h.node(d, [SYNC, '--check', joined, '--versions', file]);
  h.eq(`${name}: exit 2 and no verdict line`, [result.code, /^proposal /m.test(result.out)], [2, false]);
});
h.eq('the matching versions file of the same folder is accepted', h.node(d, [SYNC, '--check', joined, '--versions', h.versionsFile(joined)]).code, 0);


// 7. The findings of the security review of this task (run before the
// implementation).
// 7a. A note holds no character that is invisible in the diff or that
// breaks a line: control characters, line and paragraph separators,
// bidirectional controls (finding 3); the script uses the note rule of
// dashboard-parse.js (finding 9). Ordinary non-ASCII text stays allowed.
const hiddenInNote = {
  nulNote: oneLine({ note: 'ok\u0000x' }),
  tabNote: setPart(4, { note: 'a\tb' }),
  escapeNote: oneLine({ note: 'a\u001b(0b' }),
  deleteNote: setPart(4, { note: 'a\u007fb' }),
  nextLineNote: oneLine({ note: 'a\u0085b' }),
  lineSeparatorNote: oneLine({ note: 'a\u2028b' }),
  paragraphSeparatorNote: setPart(4, { note: 'a\u2029b' }),
  rightToLeftNote: oneLine({ note: 'a\u202eb' }),
  isolateNote: oneLine({ note: 'a\u2066b' }),
};
// 7b. The anchor fields and the branch hold no line break or control
// character, so one proposal cannot print a forged verdict block (finding 2).
const forged = (id) => `x\nproposal ${id}: unique\n  file: session-log.md (untracked)`;
const forgedFields = {
  headingBreak: oneLine({ anchor: { heading: `${LAST}${forged('zz')}`, headingOrdinal: 1, line: 'Open: one line', occurrence: 1 } }),
  lineBreak: oneLine({ anchor: { heading: LAST, headingOrdinal: 1, line: `Open: one line${forged('yy')}`, occurrence: 1 } }),
  partBreak: setPart(4, { status: 'done' }, { anchor: { heading: '## Parts', headingOrdinal: 1, line: ROW[4], occurrence: 1, part: `9${forged('xx')}` } }),
  branchBreak: setPart(4, { status: 'done' }, { branch: `main${forged('ww')}` }),
  branchEscape: oneLine({ branch: 'main\u001b[2J' }),
};
// 7c. A "__proto__" key cannot replace the checked fields (finding 4).
const protoDoc = `{"__proto__": ${JSON.stringify(setPart(4, { status: 'done' }))}, "status": "done"}`;
const hostile = Object.assign({ proto: protoDoc }, hiddenInNote, forgedFields);
run = check(d, hostile);
h.eq('hidden characters, forged fields and a __proto__ key give invalid', verdictOf(run), Object.fromEntries(Object.keys(hostile).sort().map((id) => [id, 'invalid'])));
h.check('no forged verdict line and one summary line', !/^proposal (zz|yy|xx|ww):/m.test(run.out) && run.out.split('\n').filter((line) => line.startsWith('summary:')).length === 1, run.out);
const escapeId = path.join(h.ROOT, 'versions-escape.txt');
fs.writeFileSync(escapeId, 'one 1\ne\u001bx 1\n');
const escapeRun = h.node(d, [SYNC, '--check', joined, '--versions', escapeId]);
h.eq('an id with a control character: exit 2, the line is named, the character is not printed', [escapeRun.code, escapeRun.err.includes('line 2'), escapeRun.err.includes('\u001b')], [2, true, false]);

// 7d. The tracked check asks git about the path that the file system
// resolves: a work log reached through a tracked folder link (finding 1).
const partDone = setPart(4, { status: 'done' });
const linked = h.repo('sync-linked');
h.write(linked, 'real/worklogs/w.md', WORKLOG);
fs.mkdirSync(path.join(linked, 'docs'));
fs.symlinkSync(path.join('..', 'real', 'worklogs'), path.join(linked, 'docs', 'worklogs'));
h.commit(linked, 'base', ['real', 'docs']);
run = check(linked, { part: partDone, accents: setPart(4, { note: 'café — naïve' }) });
h.eq('a file reached through a folder link is labelled tracked', run.found.part.lines[0], `file: ${W} (tracked)`);
h.eq('ordinary non-ASCII text in a note is allowed', run.found.accents.verdict, 'unique');
const addStoppedRun = (dir) => {
  h.git(dir, 'checkout', '-q', '-b', 'feature/stopped');
  h.write(dir, h.logPath('2026-09-21', 'stopped'), h.runLog('stopped', ['## Phase 1', '## STOPPED — 2026-09-21 — phase 3 — blocked']));
  h.commit(dir, 'stopped log', ['docs/superpowers-orchestrator']);
  h.git(dir, 'checkout', '-q', 'main');
};
addStoppedRun(linked);
h.eq('a file reached through a folder link is held by a stopped run', verdictOf(check(linked, { part: partDone })), { part: 'held-run' });
// On a file system that ignores letter case (the macOS default), git records
// "Docs/worklogs/w.md" while the proposal names "docs/worklogs/w.md". (Git
// would record a run log there under "Docs/" too, where the run scan does not
// look, so this case checks the label, which comes from the same tracked
// check as held-run.)
const cased = h.repo('sync-cased');
h.write(cased, 'Docs/worklogs/w.md', WORKLOG);
h.commit(cased, 'base', ['Docs']);
if (fs.existsSync(path.join(cased, 'docs'))) {
  h.eq('a file recorded with other letter case is labelled tracked', check(cased, { part: partDone }).found.part.lines[0], `file: ${W} (tracked)`);
} else {
  console.log('  NOTE: this file system keeps letter case apart; the letter-case case is skipped');
}

// 7e. A git failure stops the check (exit 2, no verdict line, no absolute
// path in the message) instead of giving "untracked" or no held-run
// (finding 8).
const failedRun = (dir) => {
  const result = h.node(dir, [SYNC, '--check', joined, '--versions', h.versionsFile(joined)]);
  return [result.code, /^proposal /m.test(result.out), result.err.includes(h.ROOT)];
};
const scanFail = h.repo('sync-scan-fail');
h.write(scanFail, 'session-log.md', SESSION_LOG);
h.commit(scanFail, 'base', ['session-log.md']);
h.git(scanFail, 'checkout', '-q', '-b', 'feature/broken');
h.write(scanFail, h.logPath('2026-09-22', 'broken'), h.runLog('broken', ['## Phase 3 — Batch 2']));
h.commit(scanFail, 'broken log', ['docs/superpowers-orchestrator']);
h.git(scanFail, 'checkout', '-q', 'main');
const blob = h.git(scanFail, 'rev-parse', `feature/broken:${h.logPath('2026-09-22', 'broken')}`);
fs.rmSync(path.join(scanFail, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
h.eq('a failed git command of the run scan: exit 2, no verdict, no absolute path', failedRun(scanFail), [2, false, false]);
const indexFail = h.repo('sync-index-fail');
h.write(indexFail, 'session-log.md', SESSION_LOG);
h.commit(indexFail, 'base', ['session-log.md']);
fs.writeFileSync(path.join(indexFail, '.git', 'index'), 'not an index');
h.eq('a failed git ls-files: exit 2, no verdict, no absolute path', failedRun(indexFail), [2, false, false]);

h.finish();
