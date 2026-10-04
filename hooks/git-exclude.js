/**
 * Keep a file that a hook or the AI assistant writes out of `git status`.
 *
 * The entry goes to the repository's local exclude file, found with
 * `git rev-parse --git-path info/exclude`. Git never commits that file, so the
 * repository gets no uncommitted change. An edit to .gitignore would be such a
 * change, and it stops an automatic pipeline run at its check that the working
 * tree has no uncommitted change. In a linked worktree the command returns the
 * exclude file that all worktrees of the repository share.
 *
 * Fails silently on any error: a hook must never block the session.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GIT_TIMEOUT_MS = 5000;

// Characters that have a special meaning in a gitignore pattern.
const PATTERN_SPECIAL_CHARACTERS = /[\\*?[]/g;

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** True when the git command exits with status 0; false for any other status. */
function gitSucceeds(args, cwd) {
  try {
    git(args, cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add an exclude entry for `filePath` (absolute) when git neither tracks nor
 * ignores the file yet. Call it before the file is written, when possible:
 * then `git status` never shows the file, not even for a moment.
 * Does nothing outside the working tree of a git repository.
 */
function excludeFromGit(filePath) {
  try {
    // Git's output is read line by line below, so a path that holds a newline
    // cannot be handled.
    if (filePath.includes('\n')) return;

    // The real folder, not a symbolic link to it: git prints the exclude path
    // relative to the real folder, and `..` in it must apply to that folder.
    const dir = fs.realpathSync(path.dirname(filePath));
    const name = path.basename(filePath);

    // Three output lines: "true" inside the working tree ("false" inside the
    // .git folder); the folder's path from the repository root ('' at the root,
    // else ending in '/'); the exclude file's path, relative to `dir` or
    // absolute (in a linked worktree). The command fails outside a repository.
    const [insideWorkTree, prefix, excludeFile] = git(
      ['rev-parse', '--is-inside-work-tree', '--show-prefix', '--git-path', 'info/exclude'],
      dir
    ).split(/\r?\n/);
    if (insideWorkTree !== 'true') return;

    // A tracked file never shows as untracked, and an entry would hide it
    // without any message if the user untracks it later.
    if (gitSucceeds(['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', name], dir)) return;

    // Already ignored by any source: a .gitignore, the exclude file, or the
    // global excludes file.
    if (gitSucceeds(['check-ignore', '-q', '--', name], dir)) return;

    const excludePath = path.resolve(dir, excludeFile);
    const pattern = '/' + (prefix + name).replace(PATTERN_SPECIAL_CHARACTERS, '\\$&');

    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const content = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
    // The entry can be present and still not apply: a `!` pattern in a
    // .gitignore overrides the exclude file. Do not add it a second time.
    if (content.split(/\r?\n/).includes(pattern)) return;
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(excludePath, `${separator}${pattern}\n`);
  } catch {
    // Not a git repository, or the exclude file cannot be written.
  }
}

module.exports = { excludeFromGit, git };
