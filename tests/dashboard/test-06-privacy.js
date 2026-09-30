'use strict';
// dashboard-extract.js, shared audience: only what is pushed (spec section
// 5.3). Every private fixture holds MARKER, in its content or in its name;
// no shared output may hold it. Numbers in brackets are the privacy cases of
// spec section 11.
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const EXTRACT = h.script('dashboard-extract.js');
const MARKER = 'zqxmarker';
const run = (dir, args) => h.node(dir, [EXTRACT, ...args]);
const shared = (dir, ref) => run(dir, ['--audience', 'shared', '--ref', ref]);
const W = 'docs/worklogs';
const R = 'docs/superpowers-orchestrator';
const activeLog = (slug, rows) => [
  `<!-- Work log: status=active slug=${slug} created=2026-09-21 -->`, '', '## Parts', '',
  '| # | Part | Status | Since | Commit | Note |', '|---|------|--------|-------|--------|------|', ...rows, '',
].join('\n');
const PUSHED_ROW = '| 1 | pushed part | in progress | | | |';

const d = h.repo('privacy');
h.addRemote(d, 'privacy-remote');
h.write(d, 'RELEASE-NOTES.md', '# Notes\n\n## v1.0.0 — pushed\n');
h.write(d, `${W}/pushed.md`, activeLog('pushed', [PUSHED_ROW]));
fs.symlinkSync('pushed.md', path.join(d, W, 'link.md'));
h.write(d, `${R}/2026-09-01-alpha/alpha-orchestration-log.md`, h.runLog('alpha', ['## Phase 1']));
h.commit(d, 'pushed base', ['RELEASE-NOTES.md', 'docs']);
h.git(d, 'push', '-q', '-u', 'origin', 'main');

// (5) A run branch with an upstream, and an unpushed STOPPED heading.
h.git(d, 'checkout', '-q', '-b', 'feature/run');
const runLog = h.logPath('2026-09-05', 'run');
h.write(d, runLog, h.runLog('run', ['## Phase 1']));
h.commit(d, 'run log', [runLog]);
h.git(d, 'push', '-q', '-u', 'origin', 'feature/run');
h.write(d, runLog, h.runLog('run', ['## Phase 1', `## STOPPED — ${MARKER}`]));
h.commit(d, 'run stopped', [runLog]);
// (6) A branch never pushed, with a marker in a commit subject.
h.git(d, 'checkout', '-q', '-b', 'feature/secret', 'main');
h.write(d, 'secret.txt', 'x\n');
h.commit(d, `${MARKER} subject`, ['secret.txt']);
// (8) A local branch with a marker in its name that tracks origin/main.
h.git(d, 'checkout', '-q', 'main');
h.git(d, 'branch', '-q', '--track', `${MARKER}-branch`, 'origin/main');
// (4) A committed but unpushed marker line in a tracked file.
h.write(d, 'RELEASE-NOTES.md', `# Notes\n\n## v1.1.0 — ${MARKER}\n\n## v1.0.0 — pushed\n`);
h.commit(d, 'unpushed release', ['RELEASE-NOTES.md']);
// (2) An uncommitted marker line in a tracked file.
h.write(d, `${W}/pushed.md`, activeLog('pushed', [PUSHED_ROW, `| 2 | ${MARKER} part | not started | | | |`]));
// (3) A staged file that was never committed, with the marker in its name.
h.write(d, `${W}/${MARKER}-staged.md`, activeLog(`${MARKER}-staged`, [PUSHED_ROW]));
h.git(d, 'add', '--', `${W}/${MARKER}-staged.md`);
// Untracked sources, an untracked topic folder and an untracked work log.
h.write(d, 'session-log.md', `## 2026-01-01 [saved]\nGoal: ${MARKER}\nOpen: ${MARKER}\n`);
h.write(d, 'state.md', `## Current Goal\n\n${MARKER}\n`);
h.write(d, 'known-issues.md', `## ${MARKER}\n`);
h.write(d, `${R}/2026-09-02-${MARKER}/specs/x-design.md`, `${MARKER}\n`);
h.write(d, `${W}/${MARKER}-untracked.md`, activeLog(`${MARKER}-untracked`, [PUSHED_ROW]));

const privateRun = run(d, ['--audience', 'private']);
h.check('the private run sees the marker (the fixture is valid)', privateRun.code === 0 && privateRun.out.includes(MARKER));

const result = shared(d, 'origin/main');
h.eq('the shared run succeeds', result.code, 0);
h.check('(2-6, 8) no marker in the shared JSON', !result.out.includes(MARKER), result.out.split('\n').filter((line) => line.includes(MARKER)).join(' | '));
const doc = JSON.parse(result.out);
const s = doc.sections;
h.eq('the document names the shared ref', [doc.audience, doc.commit.branch, doc.commit.ref, doc.commit.defaultBranch], ['shared', 'origin/main', 'refs/remotes/origin/main', null]);
h.eq('(5) the run is read from its upstream', s.unfinishedRuns.items.map((i) => [i.branch, i.lastHeading, i.state]), [['origin/feature/run', '## Phase 1', 'in progress']]);
h.eq('(6, 8) git lists only counted upstreams', s.git.items.map((i) => i.name), ['origin/feature/run']);
h.eq('git has no unpushed count and no uncommitted count', [s.git.ahead, s.git.dirty], [null, null]);
h.eq('(4) releases come from the pushed ref', s.releases.items.map((i) => i.heading), ['## v1.0.0 — pushed']);
h.eq('(2, 3) work logs come from the pushed ref; the link is skipped', s.activeWorklogs.items.map((i) => (i.kind === 'part' ? i.part : i.path)), ['docs/worklogs/pushed.md', 'pushed part']);
h.eq('untracked sources are not-found', [s.sessionOpenItems.status, s.currentGoal.status, s.knownIssues.status], ['not-found', 'not-found', 'not-found']);
h.eq('runHistory lists only pushed topic folders', s.runHistory.items.map((i) => i.slug), ['alpha']);
h.eq('commits are those of the shared ref', s.commits.items.map((i) => i.subject), ['pushed base']);
h.check('every shared item is tracked', Object.values(s).every((section) => section.items.every((i) => i.visibility === 'tracked')));
h.check('(10) the whole shared output holds neither the repository root nor the home folder', !result.out.includes(h.ROOT) && !result.out.includes(h.HOME));
h.check('(10) no section note holds a machine path', Object.values(s).every((section) => !section.note.includes(h.ROOT) && !section.note.includes(h.HOME)));

// A local branch named like a remote-tracking ref must not pass as the shared ref.
h.git(d, 'branch', 'refs/remotes/origin/guess', 'feature/secret');
const guessed = shared(d, 'origin/guess');
h.check('a local branch named refs/remotes/origin/<name> is not a shared ref', guessed.code === 2 && !`${guessed.out}${guessed.err}`.includes(MARKER));

h.eq('--default-shared-ref prints the upstream of the default branch', run(d, ['--default-shared-ref']).out.trim(), 'origin/main');
h.eq('--check-shared-ref accepts a counted upstream', run(d, ['--check-shared-ref', 'origin/feature/run']).out.trim(), 'ok origin/feature/run');
h.eq('--check-shared-ref refuses a ref that no branch tracks', run(d, ['--check-shared-ref', 'origin/nothing']).code, 2);
h.eq('a stored shared ref that no longer exists stops', shared(d, 'origin/gone').code, 2);
h.eq('a malformed shared ref stops', [shared(d, '../heads/main').code, shared(d, 'main').code, run(d, ['--audience', 'shared']).code], [2, 2, 2]);

// (7) No remote: a branch whose upstream is a local branch holding a marker.
const n = h.repo('no-remote');
h.write(n, 'file.txt', 'x\n');
h.commit(n, 'base', ['file.txt']);
h.git(n, 'checkout', '-q', '-b', 'holder');
h.write(n, 'm.txt', 'm\n');
h.commit(n, `${MARKER} commit`, ['m.txt']);
h.git(n, 'checkout', '-q', 'main');
h.git(n, 'branch', '-q', '--track', 'feature/tracker', 'holder');
const noRemote = shared(n, 'origin/main');
h.check('(7) with no remote the shared run stops and prints no marker', noRemote.code === 2 && !`${noRemote.out}${noRemote.err}`.includes(MARKER));
h.eq('--default-shared-ref with no counted upstream stops', run(n, ['--default-shared-ref']).code, 2);

// A shared feature ref. The shared run decides "merged" against the counted
// upstream of the default branch, never against the shared ref (spec section
// 5, Tab 1), so the stopped run of the shared branch itself is listed.
const f = h.repo('share-feature');
h.addRemote(f, 'share-feature-remote');
h.write(f, 'file.txt', 'x\n');
h.commit(f, 'base', ['file.txt']);
h.git(f, 'push', '-q', '-u', 'origin', 'main');
h.git(f, 'checkout', '-q', '-b', 'feature/run');
h.write(f, runLog, h.runLog('run', ['## Phase 1', '## STOPPED — waits for the owner']));
h.commit(f, 'run stopped', [runLog]);
h.git(f, 'push', '-q', '-u', 'origin', 'feature/run');
const FEATURE_REF = 'origin/feature/run';
const STOPPED_FEATURE_RUN = [[FEATURE_REF, 'stopped']];
const featureRuns = () => JSON.parse(shared(f, FEATURE_REF).out).sections.unfinishedRuns.items.map((i) => [i.branch, i.state]);
h.eq('a shared feature ref lists the stopped run of that branch', featureRuns(), STOPPED_FEATURE_RUN);
// The run reaches origin/main, the counted upstream of the default branch.
h.git(f, 'push', '-q', 'origin', 'feature/run:main');
h.eq('a run merged into the upstream of the default branch is left out', featureRuns(), []);
// The default branch has no counted upstream: no merge exclusion applies.
h.git(f, 'branch', '--unset-upstream', 'main');
h.eq('with no counted upstream of the default branch the run is listed', featureRuns(), STOPPED_FEATURE_RUN);

// A git command of the shared run that fails (the oldest commit object of the
// pushed history is missing): the note is the fixed text (Global Constraint 6).
const lost = h.repo('privacy-broken');
h.addRemote(lost, 'privacy-broken-remote');
h.write(lost, 'file.txt', 'one\n');
const lostFirst = h.commit(lost, 'first', ['file.txt']);
h.write(lost, 'file.txt', 'two\n');
h.commit(lost, 'second', ['file.txt']);
h.git(lost, 'push', '-q', '-u', 'origin', 'main');
fs.unlinkSync(path.join(lost, '.git', 'objects', lostFirst.slice(0, 2), lostFirst.slice(2)));
const lostCommits = JSON.parse(shared(lost, 'origin/main').out).sections.commits;
h.eq('(10) a failed git command of the shared run: the fixed note', [lostCommits.status, lostCommits.note], ['error', 'git command failed']);

// A failed git command inside the run scan of the shared run: a pushed run
// whose log blob is missing. The section is an error with the fixed note.
const blobLost = h.repo('privacy-blob');
h.addRemote(blobLost, 'privacy-blob-remote');
h.write(blobLost, 'file.txt', 'base\n');
h.commit(blobLost, 'base', ['file.txt']);
h.git(blobLost, 'push', '-q', '-u', 'origin', 'main');
h.git(blobLost, 'checkout', '-q', '-b', 'feature/lost');
h.write(blobLost, h.logPath('2026-09-01', 'lost'), h.runLog('lost', ['## Phase 1']));
h.commit(blobLost, 'lost log', ['docs']);
h.git(blobLost, 'push', '-q', '-u', 'origin', 'feature/lost');
const blobId = h.git(blobLost, 'rev-parse', `feature/lost:${h.logPath('2026-09-01', 'lost')}`);
fs.unlinkSync(path.join(blobLost, '.git', 'objects', blobId.slice(0, 2), blobId.slice(2)));
fs.writeFileSync(path.join(blobLost, '.git', 'objects', 'info', 'alternates'), `${fs.realpathSync(blobLost)}/missing-objects\n`);
const blobResult = shared(blobLost, 'origin/main');
const blobRuns = JSON.parse(blobResult.out).sections.unfinishedRuns;
h.eq('a failed git command of the shared run scan: the fixed note', [blobRuns.status, blobRuns.note], ['error', 'git command failed']);
h.check('the shared output of a failed scan holds neither the repository root nor the home folder', !blobResult.out.includes(h.ROOT) && !blobResult.out.includes(h.HOME));

h.finish();
