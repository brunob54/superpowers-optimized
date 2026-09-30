'use strict';
// dashboard-extract.js, private audience: stops, the state folder and
// config.json, commit meta, unfinishedRuns, git, commits.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const EXTRACT = h.script('dashboard-extract.js');
const run = (dir, args) => h.node(dir, [EXTRACT, ...args]);
function extract(dir) {
  const result = run(dir, ['--audience', 'private']);
  if (result.code !== 0) throw new Error(`extract failed: ${result.err}`);
  return JSON.parse(result.out);
}
const STOPPED = '## STOPPED — 2026-09-02 — phase 2 — blocked';
const COMPLETED = '_Completed — 2026-09-03 — HEAD abc1234_';
const NOW = new Date().toISOString();

// 1. The run cannot start.
const plain = path.join(h.ROOT, 'plain');
fs.mkdirSync(plain);
h.eq('not a git repository: exit 2', run(plain, ['--audience', 'private']).code, 2);
h.eq('no commit yet: exit 2', run(h.repo('empty'), ['--audience', 'private']).code, 2);

// 2. Fixture: main, five run branches and 24 more commits on main.
const d = h.repo('core');
h.write(d, 'file.txt', 'base\n');
h.commit(d, 'base', ['file.txt']);
function runBranch(slug, text, date) {
  h.git(d, 'checkout', '-q', '-b', `feature/${slug}`, 'main');
  h.write(d, h.logPath('2026-09-01', slug), text);
  h.commit(d, `${slug} log`, ['docs'], date);
  h.git(d, 'checkout', '-q', 'main');
}
runBranch('stopped', h.runLog('stopped', ['## Phase 1', STOPPED]));
runBranch('old', h.runLog('old', ['## Phase 3 — Batch 1']));
runBranch('fresh', h.runLog('fresh', ['## Phase 3 — Batch 2']), NOW);
runBranch('done', `${h.runLog('done', ['## Phase 1'])}${COMPLETED}\n`);
runBranch('merged', h.runLog('merged', ['## Phase 1']));
h.git(d, 'merge', '-q', '--no-edit', 'feature/merged');
h.git(d, 'checkout', '-q', '-b', 'feature/twin', 'main');
h.write(d, h.logPath('2026-08-01', 'twin'), h.runLog('twin', ['## Phase 1']));
h.write(d, h.logPath('2026-09-10', 'twin'), h.runLog('twin', ['## Phase 2']));
h.commit(d, 'twin logs', ['docs']);
h.git(d, 'checkout', '-q', 'main');
for (let i = 1; i <= 24; i += 1) {
  h.write(d, 'file.txt', `line ${i}\n`);
  h.commit(d, `commit ${i}`, ['file.txt']);
}

let doc = extract(d);
h.eq('document head', [doc.schemaVersion, doc.audience, doc.repo.name, doc.commit.branch, doc.commit.ref, doc.commit.defaultBranch], [1, 'private', 'core', 'main', 'HEAD', 'main']);
h.check('generatedAt is local time with its offset', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(doc.generatedAt));
h.check('commit sha and short hash', /^[0-9a-f]{40}$/.test(doc.commit.sha) && doc.commit.short === doc.commit.sha.slice(0, 7));
h.eq('unfinishedRuns: branches and marks', doc.sections.unfinishedRuns.items.map((i) => [i.branch, i.mark]), [
  ['feature/fresh', 'in progress'],
  ['feature/old', 'no commit since 2026-01-09 — may need resume'],
  ['feature/stopped', 'stopped — waits for you'],
  ['feature/twin', 'ambiguous — waits for you'],
]);
h.eq('a stopped run shows its last heading', doc.sections.unfinishedRuns.items[2].lastHeading, STOPPED);
h.eq('git: unmerged local branches, the default branch excluded', doc.sections.git.items.map((i) => i.name), ['feature/done', 'feature/fresh', 'feature/old', 'feature/stopped', 'feature/twin']);
h.eq('git: no upstream gives a null count and a note', [doc.sections.git.ahead, /no upstream/.test(doc.sections.git.note)], [null, true]);
h.eq('git: a clean tree has no uncommitted change', doc.sections.git.dirty, 0);
h.eq('commits: the last 20, newest first', [doc.sections.commits.items.length, doc.sections.commits.items[0].subject, doc.sections.commits.items[19].subject], [20, 'commit 24', 'commit 5']);
h.check('every item has an id and tracked visibility', doc.sections.commits.items.every((i) => /^[0-9a-f]{40}$/.test(i.id) && i.visibility === 'tracked'));
h.check('the JSON holds no absolute path of the fixture', !JSON.stringify(doc).includes(h.ROOT));

// 3. Uncommitted changes: a tracked change counts, an untracked file does not.
h.write(d, 'file.txt', 'changed\n');
h.write(d, 'new.txt', 'untracked\n');
h.eq('git: one tracked file with uncommitted changes', extract(d).sections.git.dirty, 1);
h.git(d, 'checkout', '-q', '--', 'file.txt');
fs.unlinkSync(path.join(d, 'new.txt'));

// 4. The checked-out run branch stays in unfinishedRuns; a detached HEAD.
h.git(d, 'checkout', '-q', 'feature/stopped');
doc = extract(d);
h.eq('the checked-out run branch is still an unfinished run', [doc.commit.branch, doc.sections.unfinishedRuns.items.some((i) => i.branch === 'feature/stopped')], ['feature/stopped', true]);
h.git(d, 'checkout', '-q', '--detach', 'main');
h.eq('a detached HEAD gives branch null', extract(d).commit.branch, null);
h.git(d, 'checkout', '-q', 'main');

// 5. No default branch.
const t = h.repo('trunk-only', 'trunk');
h.write(t, 'file.txt', 'base\n');
h.commit(t, 'base', ['file.txt']);
const noDefault = extract(t);
h.eq('no default branch: defaultBranch null and two notes', [noDefault.commit.defaultBranch, /no default branch/.test(noDefault.sections.unfinishedRuns.note), /no default branch/.test(noDefault.sections.git.note)], [null, true, true]);

// 6. --out: outside the repository only.
const inside = path.join(d, 'private.json');
h.eq('--out inside the repository stops', [run(d, ['--audience', 'private', '--out', inside]).code, fs.existsSync(inside)], [2, false]);
const outside = path.join(h.ROOT, 'scratch', 'private.json');
const written = run(d, ['--audience', 'private', '--out', outside]);
h.check('--out outside the repository writes the file and names it', written.code === 0 && written.out.startsWith(`written ${outside} `) && JSON.parse(fs.readFileSync(outside, 'utf8')).audience === 'private');

// 7. The state folder and config.json.
const data = path.join(h.ROOT, 'plugin-data');
const key = `core-${crypto.createHash('sha1').update(fs.realpathSync(d), 'utf8').digest('hex').slice(0, 12)}`;
const state = run(d, ['--data-dir', data, '--state-dir']);
h.eq('--state-dir prints <data dir>/dashboard/<repo key>', state.out.trim(), path.join(data, 'dashboard', key));
h.check('--state-dir creates the folder', fs.existsSync(path.join(data, 'dashboard', key)));
h.eq('an empty --data-dir stops', run(d, ['--data-dir', '', '--state-dir']).code, 2);
h.eq('an unsubstituted --data-dir stops', run(d, ['--data-dir', '${CLAUDE_PLUGIN_DATA}', '--state-dir']).code, 2);
h.eq('--config with no config.json prints {}', run(d, ['--data-dir', data, '--config']).out.trim(), '{}');
run(d, ['--data-dir', data, '--config-set', 'privateUrl=https://claude.ai/code/artifact/x']);
const set = run(d, ['--data-dir', data, '--config-set', 'sharing=on']);
h.eq('--config-set keeps the earlier keys', JSON.parse(set.out), { privateUrl: 'https://claude.ai/code/artifact/x', sharing: 'on' });
h.eq('an unknown key stops', run(d, ['--data-dir', data, '--config-set', 'colour=red']).code, 2);
h.eq('a sharing value other than on or off stops', run(d, ['--data-dir', data, '--config-set', 'sharing=maybe']).code, 2);
const withDataDir = run(d, ['--data-dir', '', '--audience', 'private', '--out', outside]);
h.check('an extraction that carries --data-dir (even empty) still writes the document', withDataDir.code === 0 && withDataDir.out.startsWith(`written ${outside} `));

// 8. A git command that fails: `git log` of a history whose oldest commit
// object is missing. An alternates entry that names a missing folder inside
// the repository makes git print the repository path on standard error, so
// the note must show it as <repo>.
const broken = h.repo('core-broken');
h.write(broken, 'file.txt', 'one\n');
const lostCommit = h.commit(broken, 'first', ['file.txt']);
h.write(broken, 'file.txt', 'two\n');
h.commit(broken, 'second', ['file.txt']);
fs.unlinkSync(path.join(broken, '.git', 'objects', lostCommit.slice(0, 2), lostCommit.slice(2)));
fs.writeFileSync(path.join(broken, '.git', 'objects', 'info', 'alternates'), `${fs.realpathSync(broken)}/missing-objects\n`);
const brokenCommits = extract(broken).sections.commits;
h.eq('a failed git command gives an error section', brokenCommits.status, 'error');
h.check('the error note names no absolute path of the repository', !brokenCommits.note.includes(broken) && !brokenCommits.note.includes(fs.realpathSync(broken)));
h.check('the error note writes the repository root as <repo>', brokenCommits.note.includes('<repo>/missing-objects'));

// 9. A failed git command inside the run scan: the log blob of a run branch
// is missing, so `git show` fails. The run stays in the list with an empty
// text, and the section must not look healthy.
const lost = h.repo('core-lost-log');
h.write(lost, 'file.txt', 'base\n');
h.commit(lost, 'base', ['file.txt']);
h.git(lost, 'checkout', '-q', '-b', 'feature/lost', 'main');
h.write(lost, h.logPath('2026-09-01', 'lost'), h.runLog('lost', ['## Phase 1']));
h.commit(lost, 'lost log', ['docs']);
h.git(lost, 'checkout', '-q', 'main');
const lostBlob = h.git(lost, 'rev-parse', `feature/lost:${h.logPath('2026-09-01', 'lost')}`).trim();
fs.unlinkSync(path.join(lost, '.git', 'objects', lostBlob.slice(0, 2), lostBlob.slice(2)));
fs.writeFileSync(path.join(lost, '.git', 'objects', 'info', 'alternates'), `${fs.realpathSync(lost)}/missing-objects\n`);
const lostRuns = extract(lost).sections.unfinishedRuns;
h.eq('a failed git command of the run scan gives an error section', lostRuns.status, 'error');
h.check('the scan error note writes the repository root as <repo>', lostRuns.note.includes('<repo>') && !lostRuns.note.includes(fs.realpathSync(lost)));

h.finish();
