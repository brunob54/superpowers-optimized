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
h.eq('the clean shared run records no scan error', [s.unfinishedRuns.status, s.unfinishedRuns.note], ['ok', '']);
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

// --remote-url prints a remote's URL without user information.
const urls = h.repo('remote-urls');
h.write(urls, 'file.txt', 'x\n');
h.commit(urls, 'base', ['file.txt']);
const TOKEN = 'sekrettoken';
const REMOTE_URLS = {
  token: [`https://user:${TOKEN}@example.com/team/repo.git`, 'https://example.com/team/repo.git'],
  plain: ['https://example.com/team/repo.git', 'https://example.com/team/repo.git'],
  atpath: ['https://example.com/team/@repo.git', 'https://example.com/team/@repo.git'],
  atquery: ['https://tok@example.com/team/repo.git?u=a@b', 'https://example.com/team/repo.git?u=a@b'],
};
for (const [name, [url]] of Object.entries(REMOTE_URLS)) h.git(urls, 'remote', 'add', name, url);
for (const [name, [, cleaned]] of Object.entries(REMOTE_URLS)) {
  const result = run(urls, ['--remote-url', `${name}/main`]);
  h.eq(`--remote-url ${name}/main: the remote and the cleaned URL`, [result.code, result.out.trim()], [0, `remote ${name}\n${cleaned}`]);
  h.check(`--remote-url ${name}: no token in any output`, !`${result.out}${result.err}`.includes(TOKEN));
}
h.eq('--remote-url stops on a missing remote and on a bad name', [run(urls, ['--remote-url', 'nothing/main']).code, run(urls, ['--remote-url', "a'b/main"]).code], [2, 2]);

// repo.name of the shared run comes from the URL of the shared ref's remote,
// never from the name of the local folder (the folder name holds MARKER).
// Only a network URL whose last path part is a plain name gives that name;
// every other URL gives the shared ref. Each fallback URL below holds MARKER
// or TOKEN where a wrong rule would take the name from.
const NAMED_REF = 'origin/main';
const FOLDER_NAME = `${MARKER}-folder`;
const named = h.repo(FOLDER_NAME);
h.addRemote(named, 'named-remote');
h.write(named, 'file.txt', 'x\n');
h.commit(named, 'base', ['file.txt']);
h.git(named, 'push', '-q', '-u', 'origin', 'main');
// repo.name of an extractor run, or a text that no case expects when the
// extractor stopped, so that a stop fails its case and the cases go on.
const repoName = (result) => (result.code === 0 ? JSON.parse(result.out).repo.name : `stopped with exit ${result.code}: ${result.err.trim()}`);
const privateName = () => repoName(run(named, ['--audience', 'private']));
const sharedCase = (label, name) => {
  const result = shared(named, NAMED_REF);
  h.eq(`repo.name of the shared run with ${label}`, repoName(result), name);
  h.check(`the shared output with ${label} holds no folder name and no token`, !`${result.out}${result.err}`.includes(MARKER) && !`${result.out}${result.err}`.includes(TOKEN));
};
h.eq('repo.name of the private run is the folder name', privateName(), FOLDER_NAME);
sharedCase('the bare fixture remote (an absolute folder path)', NAMED_REF);
const URL_NAME = 'repo';
const SHARED_NAMES = {
  // A network URL with a scheme, and the scp-like form (scp: secure copy).
  'https://example.com/team/repo.git': URL_NAME,
  'https://example.com/team/repo': URL_NAME,
  'https://example.com/team/repo.git//': URL_NAME,
  'https://example.com/repo.git': URL_NAME,
  'HTTPS://example.com/team/repo.git': URL_NAME,
  'http://example.com:8080/team/repo.git': URL_NAME,
  'ssh://git@example.com/team/repo.git': URL_NAME,
  'ssh://git@example.com:22/team/repo.git': URL_NAME,
  'git://example.com/team/repo.git': URL_NAME,
  'git@example.com:team/repo.git': URL_NAME,
  'git@example.com:repo.git': URL_NAME,
  'example.com:team/repo.git': URL_NAME,
  [`https://user:${TOKEN}@example.com/team/repo.git`]: URL_NAME,
  // Exactly one trailing ".git" is removed.
  'https://example.com/team/repo.git.git': 'repo.git',
  // User information that no rule may take the name from.
  [`https://user:${TOKEN}@example.com`]: NAMED_REF,
  [`https://${TOKEN}@example.com/`]: NAMED_REF,
  [`https://user:${TOKEN}#ss@example.com/team/repo.git`]: NAMED_REF,
  [`user:${TOKEN}@example.com`]: NAMED_REF,
  // A network URL with no path, or with a last part that is not a plain name.
  [`https://${MARKER}.example.com`]: NAMED_REF,
  [`https://${MARKER}.example.com/`]: NAMED_REF,
  [`https://${MARKER}.example.com:8443`]: NAMED_REF,
  'https://example.com/.git': NAMED_REF,
  'https://example.com/team/.': NAMED_REF,
  'https://example.com/team/..': NAMED_REF,
  [`https://example.com/team/${MARKER} repo.git`]: NAMED_REF,
  [`https://example.com/team/repo.git?token=${TOKEN}`]: NAMED_REF,
  [`https://example.com/team/repo#${TOKEN}`]: NAMED_REF,
  // A scheme that is not in the list, and a helper form (<helper>::<address>).
  [`ftp://example.com/team/${MARKER}.git`]: NAMED_REF,
  [`codecommit::us-east-1://profile@${MARKER}`]: NAMED_REF,
  [`hg::https://user:${TOKEN}@example.com/${MARKER}`]: NAMED_REF,
  // A folder on this machine.
  [`/srv/git/${MARKER}.git`]: NAMED_REF,
  [`./${MARKER}.git`]: NAMED_REF,
  [`../${MARKER}.git`]: NAMED_REF,
  [`~/${MARKER}.git`]: NAMED_REF,
  [`${MARKER}.git`]: NAMED_REF,
  [`backups/${MARKER}.git`]: NAMED_REF,
  [`C:/git/${MARKER}.git`]: NAMED_REF,
  [`C:\\git\\${MARKER}.git`]: NAMED_REF,
  [`C:${MARKER}.git`]: NAMED_REF,
  [`..\\${MARKER}.git`]: NAMED_REF,
  [`\\\\server\\share\\${MARKER}.git`]: NAMED_REF,
  [`file:///srv/git/${MARKER}.git`]: NAMED_REF,
  [`FILE:///srv/git/${MARKER}.git`]: NAMED_REF,
  [`file:/srv/git/${MARKER}.git`]: NAMED_REF,
  [`File:${MARKER}.git`]: NAMED_REF,
};
for (const [url, name] of Object.entries(SHARED_NAMES)) {
  h.git(named, 'remote', 'set-url', 'origin', url);
  sharedCase(`the remote ${url}`, name);
}
h.git(named, 'remote', 'set-url', 'origin', 'https://example.com/team/repo.git');
h.eq('repo.name of the private run is the folder name, also with a network remote', privateName(), FOLDER_NAME);
// A remote with no URL: git prints the remote name in place of a URL.
h.git(named, 'config', '--unset', 'remote.origin.url');
sharedCase('a remote that has no URL', NAMED_REF);

// A remote whose name begins with the shared remote's name and "/": a branch
// pushed only to it is not on the shared ref's remote (exact remote match).
const twoRemotes = h.repo('slash-remote');
h.addRemote(twoRemotes, 'slash-remote-origin');
const secretBare = path.join(h.ROOT, 'slash-remote-secret.git');
h.git(twoRemotes, 'init', '-q', '--bare', secretBare);
h.git(twoRemotes, 'remote', 'add', 'origin/secret', secretBare);
h.write(twoRemotes, 'file.txt', 'x\n');
h.commit(twoRemotes, 'base', ['file.txt']);
h.git(twoRemotes, 'push', '-q', '-u', 'origin', 'main');
h.git(twoRemotes, 'checkout', '-q', '-b', 'feature/hidden');
const hiddenLog = h.logPath('2026-09-05', 'hidden');
h.write(twoRemotes, hiddenLog, h.runLog('hidden', ['## Phase 1']));
h.commit(twoRemotes, 'hidden log', [hiddenLog]);
h.git(twoRemotes, 'push', '-q', '-u', 'origin/secret', 'feature/hidden');
const twoResult = shared(twoRemotes, 'origin/main');
h.eq('two remotes: the shared run succeeds', twoResult.code, 0);
h.check('two remotes: a branch pushed only to origin/secret is in neither section', !twoResult.out.includes('hidden'), twoResult.out);
h.eq('two remotes: --remote-url resolves the shared ref to origin', run(twoRemotes, ['--remote-url', 'origin/main']).out.split('\n')[0], 'remote origin');
// Two remotes match one ref: the remote origin holds a branch secret/main, and
// the remote origin/secret holds a branch main. Both give origin/secret/main.
h.git(twoRemotes, 'push', '-q', 'origin', 'main:secret/main');
h.git(twoRemotes, 'push', '-q', 'origin/secret', 'main');
const AMBIGUOUS_REF = 'origin/secret/main';
const ambiguousShared = shared(twoRemotes, AMBIGUOUS_REF);
const ambiguousUrl = run(twoRemotes, ['--remote-url', AMBIGUOUS_REF]);
h.eq('two remotes match the ref: the shared run and --remote-url both stop with exit 2', [ambiguousShared.code, ambiguousUrl.code], [2, 2]);
h.eq('two remotes match the ref: nothing on stdout', [ambiguousShared.out, ambiguousUrl.out], ['', '']);

// A ref name with shell characters stops in --check-shared-ref.
const oddRef = h.repo('odd-ref');
h.addRemote(oddRef, 'odd-ref-remote');
h.write(oddRef, 'file.txt', 'x\n');
h.commit(oddRef, 'base', ['file.txt']);
h.git(oddRef, 'push', '-q', '-u', 'origin', 'main');
h.eq('--check-shared-ref stops on a name with shell characters', [run(oddRef, ['--check-shared-ref', "origin/a'b"]).code, run(oddRef, ['--check-shared-ref', 'origin/a$b']).code, run(oddRef, ['--check-shared-ref', 'origin/a..b']).code], [2, 2, 2]);

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

// Two remotes: the shared ref is public/main. A feature branch pushed only to
// origin is absent from the git and unfinishedRuns sections; once it is pushed
// to public it is present.
const two = h.repo('two-remotes');
h.addRemote(two, 'two-remotes-origin');
h.git(two, 'init', '-q', '--bare', path.join(h.ROOT, 'two-remotes-public.git'));
h.git(two, 'remote', 'add', 'public', path.join(h.ROOT, 'two-remotes-public.git'));
h.write(two, 'file.txt', 'x\n');
h.commit(two, 'base', ['file.txt']);
h.git(two, 'push', '-q', '-u', 'origin', 'main');
h.git(two, 'push', '-q', 'public', 'main');
h.git(two, 'fetch', '-q', 'public');
h.git(two, 'checkout', '-q', '-b', 'feature/private-only');
h.write(two, h.logPath('2026-09-06', 'private-only'), h.runLog('private-only', ['## Phase 1']));
h.commit(two, 'private run', ['docs']);
h.git(two, 'push', '-q', '-u', 'origin', 'feature/private-only');
const twoSections = () => JSON.parse(shared(two, 'public/main').out).sections;
const twoNames = () => [twoSections().git.items.map((i) => i.name), twoSections().unfinishedRuns.items.map((i) => i.branch)];
h.eq('a branch pushed only to another remote is absent from git and unfinishedRuns', twoNames(), [[], []]);
h.git(two, 'push', '-q', 'public', 'feature/private-only');
h.git(two, 'branch', '-q', '--set-upstream-to=public/feature/private-only', 'feature/private-only');
h.eq('the same branch is present once its upstream is on the shared ref\'s remote', twoNames(), [['public/feature/private-only'], ['public/feature/private-only']]);

h.finish();
