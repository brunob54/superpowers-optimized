#!/usr/bin/env node
/**
 * SessionStart Hook — Context Engine
 *
 * Runs on every session start. Executes git commands to compute:
 *   - Recently changed files (last commit)
 *   - Blast radius: which tracked files reference each changed file
 *   - Recent commit history and change statistics
 *
 * Writes context-snapshot.json to the project root.
 * Keeps context-snapshot.json out of `git status` through the local exclude
 * file (see git-exclude.js); no tracked file is edited.
 * Fails silently on any error — never blocks session start.
 *
 * Input:  stdin JSON with { cwd, ... } (falls back to process.cwd())
 * Output: stdout {} always
 */

const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const { excludeFromGit } = require('./git-exclude');

const MAX_FILES = 10;    // cap blast radius queries to avoid slowness on large diffs
const MIN_NAME_LEN = 3;  // skip very short filenames to avoid false-positive grep hits
const TIMEOUT_MS = 5000; // max time for any single git command

// Cross-session watermark: stores the HEAD hash from the previous session start
// so the next session can diff against it and show everything that changed since.
// Per-project: hashes the cwd so multi-project users don't clobber each other's watermarks.
function getLastHeadFile(cwd) {
  const hash = createHash('md5').update(cwd).digest('hex').slice(0, 12);
  return path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.claude', 'hooks-logs', `last-session-head-${hash}.txt`
  );
}

// Generic basenames that match too many files and produce noisy blast radius results
const BASENAME_DENYLIST = new Set([
  'index', 'main', 'test', 'tests', 'spec', 'utils', 'util', 'helpers', 'helper',
  'config', 'setup', 'app', 'types', 'constants', 'common', 'shared', 'lib', 'mod',
]);

// Runs git without a shell: each argument reaches git as one unchanged string,
// so text from a file name or from a file is never read as shell syntax.
// Returns '' on any error.
function gitOutput(args, cwd) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', timeout: TIMEOUT_MS, cwd });
  } catch {
    return '';
  }
}

function run(args, cwd) {
  return gitOutput(args, cwd).trim();
}

// Path names printed by a git command that is called with `-z`. With `-z`, git
// prints each name unchanged and ends it with a NUL character. Without `-z`,
// git puts quotes around a name that holds a non-ASCII letter, a double quote
// or a control character, and escapes it (setting core.quotePath).
function pathList(args, cwd) {
  return gitOutput(args, cwd).split('\0').filter(Boolean);
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let cwd;
  try {
    const data = JSON.parse(input);
    cwd = data.cwd || process.cwd();
  } catch {
    cwd = process.cwd();
  }

  // Bail silently if not a git repo
  const gitDir = run(['rev-parse', '--git-dir'], cwd);
  if (!gitDir) {
    process.stdout.write('{}');
    return;
  }

  const gitHash = run(['rev-parse', 'HEAD'], cwd);
  // `--` after a revision range: git reads the range as revisions, also when a
  // tracked file has the same name as the range.
  const filesChangedSince = base => pathList(['diff', '--name-only', '-z', `${base}..HEAD`, '--'], cwd);
  const lastHeadFile = getLastHeadFile(cwd);

  // Cross-session watermark: read BEFORE computing changedFiles so we can use
  // it as the diff base when available (shows all changes since last session,
  // not just the last commit).
  let lastHead = '';
  let mergeBase = '';
  let crossSessionFiles = [];
  let crossSessionCommitCount = 0;
  try {
    lastHead = fs.existsSync(lastHeadFile)
      ? fs.readFileSync(lastHeadFile, 'utf8').trim()
      : '';
    if (lastHead && lastHead !== gitHash) {
      // Confirm lastHead is an ancestor of HEAD (merge-base returns it if so)
      mergeBase = run(['merge-base', lastHead, 'HEAD'], cwd);
      if (mergeBase === lastHead) {
        crossSessionFiles = filesChangedSince(lastHead);
        const logRaw2 = run(['log', '--oneline', `${lastHead}..HEAD`, '--'], cwd);
        crossSessionCommitCount = logRaw2 ? logRaw2.split('\n').filter(Boolean).length : 0;
      }
    }
  } catch {
    // Silent — never block session start
  }

  // Changed files: use cross-session watermark as diff base when available
  // (shows everything since last session). Falls back to HEAD~1 on first session.
  const useWatermark = lastHead && lastHead !== gitHash && mergeBase === lastHead;
  const diffBase = useWatermark ? lastHead : 'HEAD~1';
  const changedFiles = filesChangedSince(diffBase);

  // Change statistics
  const statOutput = run(['diff', '--stat', `${diffBase}..HEAD`, '--'], cwd);
  const changeStat = statOutput ? statOutput.split('\n').pop() : '';

  // Recent commits
  const logRaw = run(['log', '--oneline', '-5'], cwd);
  const recentCommits = logRaw ? logRaw.split('\n').filter(Boolean) : [];

  // Persist current HEAD as watermark for the next session
  try {
    fs.mkdirSync(path.dirname(lastHeadFile), { recursive: true });
    fs.writeFileSync(lastHeadFile, gitHash);
  } catch {
    // Silent
  }

  // Blast radius: for each changed file, find tracked files that import/reference it
  const blastRadius = {};
  for (const file of changedFiles.slice(0, MAX_FILES)) {
    const basename = path.basename(file, path.extname(file));
    if (basename.length < MIN_NAME_LEN) continue;
    if (BASENAME_DENYLIST.has(basename.toLowerCase())) continue;

    // Strip characters that could break the grep pattern
    const safeName = basename.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safeName) continue;

    // `-e`: the name is the search pattern, also when it starts with a dash.
    const refs = pathList(
      ['grep', '-l', '-z', '-e', safeName, '--', ':(exclude)*.lock', ':(exclude)package-lock.json', ':(exclude)*.min.js', ':(exclude)*.map'],
      cwd
    );

    // Secondary filter: keep only files where the match looks like an import/reference,
    // not a prose mention. Fail-open: if the content check errors, keep the ref.
    const importPatterns = [
      new RegExp(`(import|require|from).*${safeName}`, 'i'),
      new RegExp(`[./]${safeName}[./'";\`]`),
    ];
    blastRadius[file] = refs.filter(f => {
      if (f === file) return false;
      // --literal-pathspecs: git reads `f` as one file name, not as a pattern.
      const content = run(['--literal-pathspecs', 'grep', '-h', '-e', safeName, '--', f], cwd);
      if (!content) return true; // fail-open
      return importPatterns.some(p => p.test(content));
    });
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    git_hash: gitHash,
    changed_files: changedFiles,
    change_stat: changeStat,
    recent_commits: recentCommits,
    blast_radius: blastRadius,
    cross_session_files: crossSessionFiles,
    cross_session_commit_count: crossSessionCommitCount,
  };

  try {
    const snapshotPath = path.join(cwd, 'context-snapshot.json');
    // A repository can hold a symbolic link with the name of the snapshot. A
    // write through the link would overwrite the file that the link points to,
    // so the hook then writes nothing and adds no exclude entry. lstat reads
    // the path itself: it does not follow a symbolic link.
    const existing = fs.lstatSync(snapshotPath, { throwIfNoEntry: false });
    if (!existing?.isSymbolicLink()) {
      // Exclude first, so `git status` never shows the new file, not even for a moment.
      excludeFromGit(snapshotPath);
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    }
  } catch {
    // Silently ignore write errors — never block session start
  }

  process.stdout.write('{}');
}

main();
