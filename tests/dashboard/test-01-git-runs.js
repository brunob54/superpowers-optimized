'use strict';
// git-runs.js: scanRuns in local and upstream mode, countedUpstream, and the
// failures that scanRuns returns as data.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./helpers');

const STOPPED = '## STOPPED — 2026-09-02 — phase 2 — blocked';
const COMPLETED = '_Completed — 2026-09-03 — HEAD abc1234_';
const LATER_DATE = '2026-02-01T12:00:00';

const d = h.repo('runs');
h.write(d, 'file.txt', 'base\n');
h.commit(d, 'base', ['file.txt']);
h.addRemote(d, 'runs-remote');
h.git(d, 'push', '-q', '-u', 'origin', 'main');

// feature/alpha: pushed with "## Phase 1"; a later local commit adds a STOPPED
// heading that is not pushed.
h.git(d, 'checkout', '-q', '-b', 'feature/alpha');
const alphaLog = h.logPath('2026-09-01', 'alpha');
h.write(d, alphaLog, h.runLog('alpha', ['## Phase 1 — Plan — DONE']));
h.commit(d, 'alpha log', [alphaLog]);
h.git(d, 'push', '-q', '-u', 'origin', 'feature/alpha');
h.write(d, alphaLog, h.runLog('alpha', ['## Phase 1 — Plan — DONE', STOPPED]));
h.commit(d, 'alpha stopped', [alphaLog], LATER_DATE);

// feature/done: one completed log. feature/twin: two logs (ambiguous).
h.git(d, 'checkout', '-q', 'main');
h.git(d, 'checkout', '-q', '-b', 'feature/done');
const doneLog = h.logPath('2026-09-03', 'done');
h.write(d, doneLog, `${h.runLog('done', ['## Phase 1'])}${COMPLETED}\n`);
h.commit(d, 'done log', [doneLog]);
h.git(d, 'checkout', '-q', 'main');
h.git(d, 'checkout', '-q', '-b', 'feature/twin');
h.write(d, h.logPath('2026-08-01', 'twin'), h.runLog('twin', ['## Phase 1']));
h.write(d, h.logPath('2026-09-10', 'twin'), h.runLog('twin', ['## Phase 2']));
h.commit(d, 'twin logs', ['docs']);

// feature/local-up: its upstream is the local branch main, not a remote ref.
h.git(d, 'checkout', '-q', 'main');
h.git(d, 'checkout', '-q', '-b', 'feature/local-up');
h.write(d, h.logPath('2026-09-11', 'local-up'), h.runLog('local-up', ['## Phase 1']));
h.commit(d, 'local-up log', ['docs']);
h.git(d, 'branch', '-q', '--set-upstream-to=main', 'feature/local-up');
h.git(d, 'checkout', '-q', 'main');

const byBranch = (runs) => Object.fromEntries(runs.map((run) => [run.branch, run]));

const localRuns = h.scan(d, { refs: 'local' });
const local = byBranch(localRuns);
h.eq('local mode lists alpha, local-up and twin, not the completed run', Object.keys(local).sort(), ['feature/alpha', 'feature/local-up', 'feature/twin']);
h.eq('a clean scan has an empty errors list', localRuns.errors, []);
h.eq('alpha is stopped, read from the local branch', [local['feature/alpha'].state, local['feature/alpha'].lastHeading], ['stopped', STOPPED]);
h.eq('alpha last commit date is the local commit date', local['feature/alpha'].lastCommitDate, '2026-02-01');
h.eq('twin is ambiguous with no last heading', [local['feature/twin'].state, local['feature/twin'].lastHeading, local['feature/twin'].logs.length], ['ambiguous', null, 2]);
h.eq('a run carries its topic and its file list', [local['feature/alpha'].logs[0].topic, local['feature/alpha'].files.includes(alphaLog)], ['docs/superpowers-orchestrator/2026-09-01-alpha', true]);

// feature/linked: its only log is pushed as a symbolic link (mode 120000),
// staged with update-index so that the file system needs no link support.
h.git(d, 'checkout', '-q', '-b', 'feature/linked', 'main');
const linkTarget = h.git(d, 'hash-object', '-w', 'file.txt');
h.git(d, 'update-index', '--add', '--cacheinfo', `120000,${linkTarget},${h.logPath('2026-09-13', 'linked')}`);
h.git(d, 'commit', '-q', '-m', 'linked log');
h.git(d, 'push', '-q', '-u', 'origin', 'feature/linked');
h.git(d, 'checkout', '-q', 'main');

const upstreamRuns = h.scan(d, { refs: 'upstream', base: 'refs/remotes/origin/main' });
const upstream = byBranch(upstreamRuns);
h.eq('a clean upstream scan (an upstream not merged into the base) records no error', upstreamRuns.errors, []);
h.check('upstream mode skips a log pushed as a symbolic link', !upstream['origin/feature/linked']);
h.eq('upstream mode lists only the pushed run, by its upstream name', Object.keys(upstream), ['origin/feature/alpha']);
h.eq('the unpushed STOPPED heading is read from neither the log nor the date', [upstream['origin/feature/alpha'].state, upstream['origin/feature/alpha'].lastHeading, upstream['origin/feature/alpha'].lastCommitDate], ['in progress', '## Phase 1 — Plan — DONE', '2026-01-09']);
h.eq('upstream mode reads from the remote-tracking ref', upstream['origin/feature/alpha'].ref, 'refs/remotes/origin/feature/alpha');

// An upstream merged into the base is left out.
h.git(d, 'push', '-q', 'origin', 'feature/alpha:main');
h.git(d, 'fetch', '-q', 'origin');
h.eq('an upstream that is an ancestor of the base is merged', h.scan(d, { refs: 'upstream', base: 'refs/remotes/origin/main' }).length, 0);

const counted = (branch) => JSON.parse(h.node(d, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(h.GIT_RUNS)}).countedUpstream(process.argv[1])))`, branch]).out);
h.eq('countedUpstream of a same-name remote-tracking upstream', counted('feature/alpha'), 'refs/remotes/origin/feature/alpha');
h.eq('countedUpstream of a local-branch upstream is null', counted('feature/local-up'), null);
h.git(d, 'branch', '-q', 'other', 'main');
h.git(d, 'branch', '-q', '--set-upstream-to=origin/main', 'other');
h.eq('countedUpstream of a remote-tracking ref of another name is null', counted('other'), null);

// No default branch: every feature branch is scanned.
const n = h.repo('no-default', 'trunk');
h.write(n, 'file.txt', 'base\n');
h.commit(n, 'base', ['file.txt']);
h.git(n, 'checkout', '-q', '-b', 'feature/solo');
h.write(n, h.logPath('2026-09-12', 'solo'), h.runLog('solo', ['## Phase 1']));
h.commit(n, 'solo log', ['docs']);
h.git(n, 'checkout', '-q', 'trunk');
h.eq('with no default branch every feature branch is scanned', h.scan(n, { refs: 'local' }).map((run) => run.branch), ['feature/solo']);

// A git command of the scan fails: the log blob of feature/broken is deleted
// from the object store, so "git show" cannot read it. The scan must not
// throw; it returns the failure as data on the errors property.
const b = h.repo('broken');
h.write(b, 'file.txt', 'base\n');
h.commit(b, 'base', ['file.txt']);
h.git(b, 'checkout', '-q', '-b', 'feature/broken');
const brokenLog = h.logPath('2026-09-14', 'broken');
h.write(b, brokenLog, h.runLog('broken', ['## Phase 1 — unreadable']));
h.commit(b, 'broken log', [brokenLog]);
h.git(b, 'checkout', '-q', 'main');
const blob = h.git(b, 'rev-parse', `feature/broken:${brokenLog}`);
fs.rmSync(path.join(b, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
let brokenRuns = null;
let thrown = null;
try {
  brokenRuns = h.scan(b, { refs: 'local' });
} catch (error) {
  thrown = error;
}
h.check('scanRuns does not throw when a git command fails', thrown === null, thrown && thrown.message);
h.check('the failed command and its message are in errors', Boolean(brokenRuns) && brokenRuns.errors.length >= 1
  && brokenRuns.errors.every((entry) => typeof entry.command === 'string' && entry.command.includes('show') && entry.command.includes(brokenLog) && entry.message.length > 0),
JSON.stringify(brokenRuns && brokenRuns.errors));

// A base that does not resolve: git merge-base exits with status 128, which is
// an error and not "not an ancestor". The scan must not throw, must record the
// failure and must leave the run out (it fails closed).
const badBaseRuns = h.scan(d, { refs: 'upstream', base: 'refs/remotes/origin/does-not-exist' });
h.eq('an unresolvable base leaves the run out', badBaseRuns.length, 0);
h.check('an unresolvable base is recorded as a merge-base failure', badBaseRuns.errors.length >= 1
  && badBaseRuns.errors.every((entry) => entry.command.includes('merge-base') && entry.message.length > 0),
JSON.stringify(badBaseRuns.errors));

// The repository setting log.showSignature=true makes "git log" print the
// result of the signature check of a signed commit as extra output lines. The
// last commit of feature/signed is signed with an SSH key made by ssh-keygen,
// so no GnuPG (GNU Privacy Guard) is needed. The git commands of git-runs.js
// must give the same output as without the setting.
const s = h.repo('signed');
h.write(s, 'file.txt', 'base\n');
h.commit(s, 'base', ['file.txt']);
h.git(s, 'checkout', '-q', '-b', 'feature/signed');
const signedLog = h.logPath('2026-09-15', 'signed');
h.write(s, signedLog, h.runLog('signed', ['## Phase 1']));
h.git(s, 'add', '--', signedLog);
const signingKey = path.join(h.ROOT, 'signing-key');
const keygen = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', signingKey], { encoding: 'utf8' });
if (keygen.status !== 0) throw new Error(`ssh-keygen failed: ${keygen.stderr || (keygen.error && keygen.error.message)}`);
h.gitIn(s, ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${signingKey}`, 'commit', '-q', '-S', '-m', 'signed log'], h.OLD_DATE);
h.git(s, 'checkout', '-q', 'main');
const signedTime = Number(h.git(s, 'log', '-1', '--format=%ct', 'feature/signed'));
h.git(s, 'config', 'log.showSignature', 'true');
h.check('the fixture: with log.showSignature, git log prints more than the formatted line',
  h.git(s, 'log', '-1', '--format=%ct', 'feature/signed') !== String(signedTime));
const signedRuns = h.scan(s, { refs: 'local' });
h.eq('log.showSignature changes neither the last commit date nor the time of a run',
  signedRuns.map((run) => [run.lastCommitDate, run.lastCommitTime]), [['2026-01-09', signedTime]]);
// gitRaw is the helper under every other git helper of the module.
const onelineCode = `process.stdout.write(require(${JSON.stringify(h.GIT_RUNS)}).gitRaw(['log', '--oneline', 'feature/signed']).raw)`;
h.eq('log.showSignature adds no line to the output of git log --oneline (gitRaw)', h.node(s, ['-e', onelineCode]).out.trim().split('\n').length, 2);

h.finish();
