// Git helpers and the scan of unfinished orchestration runs, shared by
// skills/pickup/scripts/pickup-scan.js and the dashboard scripts
// (skills/dashboard/scripts). It is the single definition of "unfinished
// run". It prints nothing: each caller prints the data in its own format.
// Every git command runs with --no-optional-locks, so a read never takes the
// index lock that a running orchestrator's commit needs.
'use strict';

const { spawnSync } = require('child_process');

const DATE_PATTERN = '\\d{4}-\\d{2}-\\d{2}';
const LOG_ROOT = 'docs/superpowers-orchestrator';
const HEADS = 'refs/heads/';
const REMOTES = 'refs/remotes/';
const FEATURE_PREFIX = 'feature/';
const COMPLETED = '_Completed — ';
const STOPPED_HEADING = '## STOPPED';
const HEADING_PREFIX = '## ';
const DETACHED = 'detached';
const NONE = 'none';
const GIT_OK = 'ok';
const GIT_NO_COMMITS = 'no-commits';
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
const RUN_STATE = { stopped: 'stopped', ambiguous: 'ambiguous', inProgress: 'in progress' };
const REFS = { local: 'local', upstream: 'upstream' };
const LINK_MODE = '120000';

function lines(text) {
  return text ? text.split(/\r?\n/) : [];
}

// Runs git with an argument array (no shell), colors off and no optional
// locks, whatever the user's configuration. Returns the exit state, the
// exit status (null when git did not start), the untrimmed standard output and
// the trimmed standard error.
function gitRaw(args) {
  const result = spawnSync('git', ['--no-optional-locks', '-c', 'color.ui=never', ...args], { encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
  return { ok: result.status === 0, status: result.status, raw: result.stdout || '', err: (result.stderr || result.error?.message || '').trim() };
}

// The same, with the standard output trimmed.
function git(args) {
  const result = gitRaw(args);
  return { ok: result.ok, status: result.status, out: result.raw.trim(), err: result.err };
}

// The output lines of a git command, or null when the command failed.
function gitLines(args) {
  const result = git(args);
  return result.ok ? lines(result.out) : null;
}

// The failures of the git commands of one scanRuns call. A command that is
// allowed to fail (for example, a branch that has no upstream) is not a
// failure and is not recorded. scanRuns sets this list at its start.
let scanErrors = [];

// Runs a git command whose failure is a real error of the scan: the failure
// is recorded as { command, message } and the result is returned as usual.
// The optional isFailure function decides what counts as a failure; by
// default, every non-zero exit status.
function scanGit(args, isFailure = (result) => !result.ok) {
  const result = git(args);
  if (isFailure(result)) scanErrors.push({ command: `git ${args.join(' ')}`, message: result.err });
  return result;
}

function branchExists(name) {
  return git(['show-ref', '--verify', '--quiet', HEADS + name]).ok;
}

// "ok", "none" (not a work tree, including a bare repository) or "no-commits".
function gitState() {
  const tree = git(['rev-parse', '--is-inside-work-tree']);
  if (!tree.ok || tree.out !== 'true') return NONE;
  if (!git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).ok) return GIT_NO_COMMITS;
  return GIT_OK;
}

// The local branch that origin/HEAD points to, else local main, else local
// master. Merge checks use this LOCAL branch, never origin/main: a branch
// merged locally but not pushed is merged.
function defaultBranch() {
  const remote = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const candidates = remote.ok ? [remote.out.replace(/^refs\/remotes\/origin\//, '')] : [];
  return candidates.concat(['main', 'master']).find(branchExists) || null;
}

function currentBranch() {
  const ref = git(['symbolic-ref', '--quiet', 'HEAD']);
  return ref.ok ? ref.out.slice(HEADS.length) : DETACHED;
}

// The upstream of a local branch when it counts: a remote-tracking ref of the
// same name, refs/remotes/<remote>/<branch>. An upstream that is a local
// branch, or a remote-tracking ref of another name, counts as none (null).
function countedUpstream(branch) {
  const remote = git(['config', '--get', `branch.${branch}.remote`]);
  const upstream = git(['rev-parse', '--symbolic-full-name', `${branch}@{upstream}`]);
  if (!remote.ok || !upstream.ok) return null;
  return upstream.out === `${REMOTES}${remote.out}/${branch}` ? upstream.out : null;
}

const EXIT_ANCESTOR = 0;
const EXIT_NOT_ANCESTOR = 1;

// True when ref is an ancestor of base, false when it is not, and null when
// git failed (for example, base does not resolve). Git exits with status 1 for
// "not an ancestor"; any other non-zero status is an error, which is recorded
// in the scan errors.
function isAncestor(ref, base) {
  const result = scanGit(['merge-base', '--is-ancestor', ref, base], (r) => r.status !== EXIT_ANCESTOR && r.status !== EXIT_NOT_ANCESTOR);
  if (result.status === EXIT_ANCESTOR) return true;
  if (result.status === EXIT_NOT_ANCESTOR) return false;
  return null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The orchestration logs of one run for its slug, read from <ref> (never from
// the working tree).
function branchLogs(ref, slug, files) {
  const slugPattern = escapeRegExp(slug);
  const logPattern = new RegExp(`^(${LOG_ROOT}/${DATE_PATTERN}-${slugPattern})/${slugPattern}-orchestration-log\\.md$`);
  return files
    .map((file) => file.match(logPattern))
    .filter(Boolean)
    .map((match) => {
      const shown = scanGit(['show', `${ref}:${match[0]}`]);
      return { file: match[0], topic: match[1], text: shown.ok ? shown.out : '' };
    });
}

function describeRun(ref, branch, slug, files, logs) {
  const ambiguous = logs.length > 1;
  const headings = ambiguous ? [] : lines(logs[0].text).filter((line) => line.startsWith(HEADING_PREFIX));
  const lastHeading = headings.length ? headings[headings.length - 1] : null;
  const [date, time] = scanGit(['log', '-1', '--format=%cd %ct', '--date=short', ref]).out.split(' ');
  let state = RUN_STATE.inProgress;
  if (ambiguous) state = RUN_STATE.ambiguous;
  else if (lastHeading && lastHeading.startsWith(STOPPED_HEADING)) state = RUN_STATE.stopped;
  return {
    branch, ref, slug, files, logs, ambiguous, lastHeading,
    lastCommitDate: date || null,
    lastCommitTime: time ? Number(time) : null,
    state,
  };
}

// The paths under LOG_ROOT at a ref. In upstream mode symbolic links (ls-tree
// mode 120000) are left out: the shared run skips them (spec section 5.3).
function runFiles(ref, upstreamMode) {
  const entries = lines(scanGit(['ls-tree', '-r', '--full-tree', ref, '--', LOG_ROOT]).out);
  return entries
    .filter((entry) => !(upstreamMode && entry.startsWith(`${LINK_MODE} `)))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1));
}

// The unfinished runs. A branch is a run when it carries two or more logs for
// its slug (ambiguous: the orchestrator's Resume stops on them, completed or
// not) or exactly one log with no line that starts with "_Completed — ".
// refs "local": the local feature/<slug> branches not merged into the local
// default branch (every feature branch when there is none), read from the
// branch. refs "upstream": the same local branches whose upstream counts
// (countedUpstream), read from that upstream only; an upstream that is an
// ancestor of options.base is merged and left out. In that mode the optional
// options.acceptUpstream(ref, branch) function (branch: the local branch name)
// leaves out every upstream it rejects, before any git command reads that upstream.
// The result is an array of run objects. Its "errors" property lists every
// git command of the scan that failed, as { command, message }; it is an
// empty array when nothing failed. The scan never throws and prints nothing.
function scanRuns(options) {
  scanErrors = [];
  const upstreamMode = options.refs === REFS.upstream;
  const base = upstreamMode ? null : defaultBranch();
  const filter = base ? [`--no-merged=${HEADS}${base}`] : [];
  const refs = lines(scanGit(['for-each-ref', ...filter, '--format=%(refname)', HEADS + FEATURE_PREFIX]).out);
  const runs = [];
  for (const localRef of refs) {
    const localName = localRef.slice(HEADS.length);
    const slug = localName.slice(FEATURE_PREFIX.length);
    let ref = localRef;
    if (upstreamMode) {
      ref = countedUpstream(localName);
      if (!ref || (options.acceptUpstream && !options.acceptUpstream(ref, localName))) continue;
      // A merged upstream is left out; a failed check (null) also leaves the run out.
      if (options.base && isAncestor(ref, options.base) !== false) continue;
    }
    const files = runFiles(ref, upstreamMode);
    const logs = branchLogs(ref, slug, files);
    const completed = logs.length === 1 && lines(logs[0].text).some((line) => line.startsWith(COMPLETED));
    if (!logs.length || completed) continue;
    runs.push(describeRun(ref, upstreamMode ? ref.slice(REMOTES.length) : localName, slug, files, logs));
  }
  runs.errors = scanErrors;
  return runs;
}

module.exports = {
  DATE_PATTERN, LOG_ROOT, HEADS, REMOTES, DETACHED, NONE, GIT_OK, GIT_NO_COMMITS, RUN_STATE, REFS, LINK_MODE,
  STOPPED_HEADING, HEADING_PREFIX,
  lines, git, gitRaw, gitLines, gitState, defaultBranch, currentBranch, countedUpstream, isAncestor, scanRuns,
};
