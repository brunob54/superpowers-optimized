#!/usr/bin/env node
/**
 * Block Dangerous Commands — PreToolUse Hook for Bash
 *
 * Refuses a Bash command that destroys work or data before it runs.
 *
 * The shared reader (shell-words.js) splits the command text into simple
 * commands and words. Each rule then tests one program, its sub-command, the
 * SET of its options and its operands, in any order. Text that only names a
 * command (a quoted argument of `echo`, a commit message, the body of a
 * here-document that goes to a file) is data and passes.
 *
 * A command that the reader cannot read to its end is refused.
 *
 * Scratch exemption: the rules for the git work tree (reset, clean, checkout,
 * restore, switch) pass when the command text itself shows that git works in
 * a folder below a temporary folder and outside the project:
 * `git -C <dir> ...`, or `cd <dir> && git ...` with the `cd` directly before
 * the command. `<dir>` must be written as a full literal path.
 *
 * Limits. The hook reads text; it cannot see what these do, and passes them:
 *   - a variable as the program or as a path (`$CMD`, `rm -rf "$DIR"`);
 *   - an alias, and a script file that exists already (`bash cleanup.sh`);
 *   - `make`, `npm run` and other programs that run commands of a file;
 *   - `xargs` that gets its operands from a pipe (`ls | xargs rm -rf`);
 *   - file name patterns other than a bare `*` (`rm -rf b*`);
 *   - code of an interpreter, except the quoted first argument of a call
 *     that starts a process (`os.system("...")`, `execSync('...')`);
 *   - a command that is written to hide its meaning on purpose.
 *
 * Based on claude-code-hooks by karanb192 (MIT License).
 * Adapted for superpowers-orchestrator plugin with cross-platform support.
 *
 * Logs blocked commands to: ~/.claude/hooks-logs/YYYY-MM-DD.jsonl
 */

'use strict';

const os = require('os');
const path = require('path');
const { splitArgs, hasLong, gitCall, toPosix, SHELLS, INTERPRETERS, ASSIGNMENT, SUBSTITUTION_MARK } = require('./shell-words');
const { runHook, refusal, decideCommand, firstRefusal, BASH_TOOL } = require('./hook-io');

const HOOK_NAME = 'block-dangerous-commands';

const PROTECTED_BRANCHES = new Set(['main', 'master']);
// Names that stand for the branch that is checked out. The hook cannot see which branch that is.
const CURRENT_BRANCH_NAMES = new Set(['HEAD', '@']);
// The option of git itself that names the folder in which git works.
const GIT_FOLDER_OPTION = '-C';
// Options and variables that move the repository or the work tree away from the folder that the text shows.
const GIT_PLACE_OPTION = /^--(git-dir|work-tree)(=|$)/;
const GIT_PLACE_VARIABLE = /^GIT_(DIR|WORK_TREE)=/;
// Path arguments that name the whole work tree.
const WHOLE_TREE = new Set(['.', './', ':/', '*', ':/*']);
// Folders whose whole tree is system data.
const SYSTEM_TREES = new Set(['etc', 'usr', 'bin', 'sbin', 'lib', 'lib64', 'boot', 'dev', 'proc', 'sys', 'System', 'Library', 'Windows']);
// Folders whose direct children are also protected (`/Users/<name>`, `/var/log`).
const TWO_LEVEL_TREES = new Set(['Users', 'home', 'var', 'private', 'opt']);
const DOWNLOADERS = new Set(['curl', 'wget']);
// Devices that `dd of=` may write to: none of them is a disk.
const HARMLESS_DEVICE = /^\/dev\/(null|zero|stdout|stderr|tty|fd\/.*)$/;
const DISK_FORMATTERS = /^(mkfs(\..+)?|newfs(_.+)?|wipefs)$/;
const DISKUTIL_ERASE = /^(erase|reformat|partitiondisk|zerodisk|randomdisk|secureerase)/i;
const SSH_FILES = /(^|\/)\.ssh\/(id_[^/]*|authorized_keys|known_hosts)$/;
const FIND_FILTERS = /^-(name|iname|path|ipath|regex|iregex|newer|mtime|size|empty)$/;
const DEVICE_PREFIX = '/dev/';
// The option of curl and wget that names the file which receives the download.
const DOWNLOAD_FILE_OPTION = /^(-o|-O|--output|--output-document)$/;
const CD = 'cd';
const AND = '&&';

const WINDOWS = process.platform === 'win32';
// One spelling for each folder: no drive letter (`C:/x` and, in Git Bash, `/c/x`), no `/private` in front of
// the macOS temporary folders, no `/` at the end. Windows compares folder names without letter case.
function canonical(p) {
  let v = path.posix.normalize(toPosix(p)).replace(/^[A-Za-z]:(?=\/)/, '');
  if (WINDOWS) v = v.replace(/^\/[A-Za-z](?=\/)/, '').toLowerCase();
  return v.replace(/^\/private(?=\/(tmp|var)(\/|$))/, '').replace(/(.)\/+$/, '$1');
}
const isBelow = (dir, root) => dir.startsWith(`${root}/`);

const HOME_DIR = canonical(os.homedir());
// Temporary folders of the operating system. A repository below one of them is a scratch repository.
const TEMP_ROOTS = [...new Set([os.tmpdir(), '/tmp', '/var/tmp', '/var/folders'].map(canonical))];

const SCRATCH_HINT = 'in a scratch repository below a temporary folder, name the folder in the command: `git -C <full path> ...`';

// True when the word states a folder completely: no variable and no pattern. (A word with `~` never starts with `/`.)
const isLiteral = (word) => !word.dynamic && !word.glob;

/**
 * The folder in which a git command works, when the command text states it as
 * a literal path: `git -C <dir>`, or `cd <dir> &&` directly before the command.
 * Returns null when the text does not state it.
 */
function statedFolder(c, call) {
  let dir = null;
  const before = c.previous;
  // `cd <dir> && git ...`: when the `cd` fails, git does not run. After `cd <dir>;` git runs in the old folder.
  if (before && before.scope === c.scope && before.separator === AND && before.words.length === 2
    && before.words[0].text === CD && isLiteral(before.words[1])
    && !(before.previous && ['|', '||'].includes(before.previous.separator))) {
    dir = toPosix(before.words[1].text);
  }
  // Each `-C <folder>` of git moves the folder; a relative one counts from the folder before it.
  const folders = call.globals.filter((word, k) => k > 0 && call.globals[k - 1].text === GIT_FOLDER_OPTION);
  for (const folder of folders) {
    if (!isLiteral(folder)) return null;
    const text = toPosix(folder.text);
    dir = text.startsWith('/') || !dir ? text : `${dir}/${text}`;
  }
  // Only a full path says where the folder is.
  return dir && dir.startsWith('/') ? dir : null;
}

// True when the command text places git in a scratch repository: below a temporary folder, outside the project.
function inScratch(c, call, context) {
  if (call.globals.some((word) => GIT_PLACE_OPTION.test(word.text)) || context.gitPlaceVariable) return false;
  const stated = statedFolder(c, call);
  if (!stated) return false;
  const dir = canonical(stated);
  if (!TEMP_ROOTS.some((root) => isBelow(dir, root))) return false;
  const project = context.projectDir ? canonical(context.projectDir).toLowerCase() : '';
  const lower = dir.toLowerCase();
  return !project || !(lower === project || isBelow(lower, project));
}

// Rules for the git sub-commands that destroy uncommitted work in the work tree.
function workTreeRule(sub, rest) {
  const wholeTree = (a) => a.operands.some((o) => WHOLE_TREE.has(o.text));
  if (sub === 'reset') {
    const { long } = splitArgs(rest);
    const mode = hasLong(long, 'hard') ? '--hard' : hasLong(long, 'merge') ? '--merge' : '';
    if (mode) {
      return refusal('git-reset-hard', `\`git reset ${mode}\` would discard the uncommitted changes of the work tree.`,
        `\`git stash\` first, or \`git reset --soft\`, \`--mixed\` or \`--keep\`; ${SCRATCH_HINT}`);
    }
  }
  if (sub === 'clean') {
    const a = splitArgs(rest, 'e', ['exclude']);
    if (!(a.short.has('n') || hasLong(a.long, 'dry-run'))) {
      return refusal('git-clean', '`git clean` would delete the untracked files of the work tree.',
        `\`git clean -n\` (a dry run) lists the files, then remove named files with \`rm\`; ${SCRATCH_HINT}`);
    }
  }
  if (sub === 'checkout') {
    const a = splitArgs(rest, 'bB', ['orphan', 'conflict']);
    if (a.short.has('f') || hasLong(a.long, 'force')) {
      return refusal('git-checkout-force', '`git checkout --force` would discard the uncommitted changes of the work tree.',
        `\`git stash\` first, then \`git checkout <branch>\`; ${SCRATCH_HINT}`);
    }
    if (wholeTree(a)) {
      return refusal('git-checkout-tree', '`git checkout` of the whole work tree would discard every uncommitted change.',
        `\`git checkout -- <path>\` for the named files that you want back; ${SCRATCH_HINT}`);
    }
  }
  if (sub === 'restore') {
    const a = splitArgs(rest, 's', ['source']);
    const stagedOnly = (a.short.has('S') || hasLong(a.long, 'staged')) && !(a.short.has('W') || hasLong(a.long, 'worktree'));
    if (wholeTree(a) && !stagedOnly) {
      return refusal('git-restore-tree', '`git restore` of the whole work tree would discard every uncommitted change.',
        `\`git restore <path>\` for the named files that you want back; ${SCRATCH_HINT}`);
    }
  }
  if (sub === 'switch') {
    const a = splitArgs(rest, 'cC');
    if (a.short.has('f') || hasLong(a.long, 'force') || hasLong(a.long, 'discard-changes')) {
      return refusal('git-switch-force', '`git switch --force` would discard the uncommitted changes of the work tree.',
        `\`git stash\` first, then \`git switch <branch>\`; ${SCRATCH_HINT}`);
    }
  }
  return null;
}

// The branch that a refspec of `git push` writes on the remote (`+src:dst`, `:dst`, `dst`).
function refspec(word) {
  const body = word.text.replace(/^\+/, '');
  const k = body.lastIndexOf(':');
  const target = (k === -1 ? body : body.slice(k + 1)).replace(/^refs\/heads\//, '');
  return { plus: word.text.startsWith('+'), deletes: k === 0, target, dynamic: word.dynamic };
}

function pushRule(rest) {
  const a = splitArgs(rest, 'o', ['push-option', 'repo', 'receive-pack', 'exec']);
  const refs = a.operands.slice(1).map(refspec);
  const forced = a.short.has('f') || hasLong(a.long, 'force');
  const isProtected = (r) => PROTECTED_BRANCHES.has(r.target);
  const isUnknown = (r) => CURRENT_BRANCH_NAMES.has(r.target) || r.dynamic;
  const leaseForm = '`git push --force-with-lease origin <feature branch>`';
  if (hasLong(a.long, 'mirror')) {
    return refusal('git-push-mirror', '`git push --mirror` would overwrite or delete every branch of the remote.', '`git push origin <branch>`');
  }
  if (forced && refs.length === 0) {
    return refusal('git-force-unnamed', '`git push --force` names no branch, so the hook cannot see which branch it overwrites.', leaseForm);
  }
  const hit = refs.find((r) => (forced || r.plus) && (isProtected(r) || isUnknown(r)));
  if (hit) {
    return refusal('git-force-main', `\`git push\` with force would overwrite the history of \`${hit.target}\` on the remote.`,
      `${leaseForm}; for main or master, ask the user`);
  }
  const deleted = refs.find((r) => isProtected(r) && (r.deletes || a.short.has('d') || hasLong(a.long, 'delete')));
  if (deleted) {
    return refusal('git-delete-main', `\`git push\` would delete \`${deleted.target}\` on the remote.`, 'ask the user to delete the branch');
  }
  return null;
}

/**
 * When the operand of `rm` names a protected place, returns { id, what }. Else null.
 * `recursive`: rm has `-r`. Without it rm cannot remove a folder, only the files that a `*` names.
 */
function protectedTarget(word, recursive, context) {
  // A drive of Windows is the root folder: `C:/Users` and, in Git Bash, `/c/Users`.
  let v = toPosix(word.text).replace(/^[A-Za-z]:(?=\/)/, '').replace(/^\/[A-Za-z](?=\/|$)/, '');
  const sub = word.subs.length === 1 ? word.subs[0] : [];
  const ref = word.refs.length === 1 && word.refs[0].plain && word.refs[0].at === 0 ? word.refs[0].name : '';
  // `$(pwd)` and `$PWD` name the current folder. `$HOME` names the home folder, unless the text gives HOME a value.
  if (sub.length === 1 && sub[0].program === 'pwd' && word.refs.length === 0) v = v.replace(SUBSTITUTION_MARK, '.');
  else if (ref === 'PWD' && word.subs.length === 0) v = v.replace('$PWD', '.');
  let home = (ref === 'HOME' && word.subs.length === 0 && !context.homeAssigned) || (word.tilde && /^~[^/]*/.test(v));
  if (home) v = v.replace(/^(\$HOME|~[^/]*)/, '');
  else if (word.dynamic && !/^\.(\/|$)/.test(v)) return null;          // a variable or a substitution: the text does not show the place
  const starred = /(^|\/)\.?\*$/.test(v);
  v = path.posix.normalize(v.replace(/\/(\*|\.\*|\{[^/]*\})$/, '/')).replace(/(.)\/+$/, '$1');
  if (!recursive && !starred) return null;
  if (/(^|\/)\.git$/.test(v)) return { id: 'rm-git-data', what: 'the data of a git repository (`.git`)' };
  if (!home && v.startsWith('/')) {
    const full = canonical(v);
    if (full === HOME_DIR || isBelow(full, HOME_DIR)) { home = true; v = full.slice(HOME_DIR.length); }
  }
  if (home) {
    const parts = v.split('/').filter((part) => part && part !== '.');
    if (parts.length === 0) return { id: 'rm-home', what: 'the home folder' };
    return parts.length === 1 ? { id: 'rm-home', what: 'a top-level folder of the home folder' } : null;
  }
  if (v.startsWith('/')) {
    const parts = v.split('/').filter(Boolean);
    if (parts.length === 0) return { id: 'rm-root', what: 'the root folder' };
    if (SYSTEM_TREES.has(parts[0])) return { id: 'rm-system', what: 'a system folder' };
    if (parts.length === 1 || (parts.length === 2 && TWO_LEVEL_TREES.has(parts[0]))) return { id: 'rm-root', what: 'a top-level folder' };
    return null;
  }
  if (/^(\.\.?)(\/\.\.?)*$/.test(v) || v === '*' || v === '.*') return { id: 'rm-cwd', what: 'the current folder or a folder above it' };
  return null;
}

function rmRule(c, context) {
  const a = splitArgs(c.args);
  const recursive = a.short.has('r') || a.short.has('R') || hasLong(a.long, 'recursive');
  for (const operand of a.operands) {
    if (SSH_FILES.test(toPosix(operand.text))) {
      return refusal('rm-ssh', `\`rm\` would delete the SSH file \`${operand.text}\`.`, 'ask the user to remove the file');
    }
    const hit = protectedTarget(operand, recursive, context);
    if (hit) {
      return refusal(hit.id, `\`rm\` would delete ${hit.what}: \`${operand.text}\`.`,
        'name the one folder or file to delete with its path, for example `rm -rf ./build`');
    }
  }
  return null;
}

// `find <protected folder> -delete` with no test that narrows the files.
function findRule(c, sink, context) {
  const texts = c.args.map((x) => x.text);
  const deletes = texts.includes('-delete') || sink.some((d) => d.origin.parent === c && d.program === 'rm');
  const start = c.args.find((x) => !x.text.startsWith('-'));
  if (deletes && start && !texts.some((x) => FIND_FILTERS.test(x)) && protectedTarget(start, true, context)) {
    return refusal('find-delete', `\`find\` would delete every file below \`${start.text}\`.`, 'add a test such as `-name <pattern>`, and run it with `-print` first');
  }
  return null;
}

function gitRule(c, context) {
  const call = gitCall(c.args);
  const { sub, rest } = call;
  if (sub === 'push') return pushRule(rest);
  // The stash belongs to the repository, not to one work tree, so the scratch exemption does not cover it.
  if (sub === 'stash' && rest[0] && rest[0].text === 'clear') {
    return refusal('git-stash-clear', '`git stash clear` would delete every stash entry.', '`git stash drop <entry>` removes one entry and prints its hash');
  }
  const hit = workTreeRule(sub, rest);
  return hit && !inScratch(c, call, context) ? hit : null;
}

function diskRule(c) {
  const device = c.args.map((a) => /^of=(.*)$/.exec(a.text)).find((m) => m && m[1].startsWith(DEVICE_PREFIX) && !HARMLESS_DEVICE.test(m[1]));
  if (c.program === 'dd' && device) {
    return refusal('dd-disk', `\`dd\` would overwrite the device \`${device[1]}\`.`, 'write to a file (`of=<file>`), or ask the user to run it');
  }
  const formats = DISK_FORMATTERS.test(c.program) && c.args.some((a) => a.text.startsWith(DEVICE_PREFIX));
  const erases = c.program === 'diskutil' && c.args[0] && DISKUTIL_ERASE.test(c.args[0].text);
  if (formats || erases) return refusal('mkfs', `\`${c.program}\` would format a disk.`, 'ask the user to run it');
  const target = c.redirects.find((r) => /^(>|>>|>\||&>|&>>)$/.test(r.op) && /^\/dev\/(sd|hd|vd|xvd|nvme|disk|rdisk)/.test(r.target.text));
  if (target) return refusal('dd-disk', `The redirect would overwrite the device \`${target.target.text}\`.`, 'write to a file, or ask the user to run it');
  return null;
}

function dockerRule(c) {
  const words = c.args.filter((a) => !a.text.startsWith('-')).map((a) => a.text);
  const { short, long } = splitArgs(c.args);
  const volumes = short.has('v') || long.includes('volumes');
  const removesVolume = (words[0] === 'volume' && /^(rm|remove|prune)$/.test(words[1] || ''))
    || (words.includes('down') && volumes)
    || (words[0] === 'system' && words[1] === 'prune' && long.includes('volumes'));
  return removesVolume
    ? refusal('docker-vol-rm', '`docker` would delete volumes, and the data in them is lost.', 'ask the user to run it, or stop the containers without the volume option')
    : null;
}

// Text that a download program printed or stored in the same call, and that a shell (or `eval`, `source`) runs.
function downloadRule(c, sink) {
  const isDownload = (d) => DOWNLOADERS.has(d.program);
  const stored = sink.filter((d) => isDownload(d) && d.order < c.order).flatMap((d) => {
    const k = d.args.findIndex((a) => DOWNLOAD_FILE_OPTION.test(a.text));
    return [k === -1 ? null : d.args[k + 1], ...d.redirects.filter((r) => r.op.startsWith('>')).map((r) => r.target)];
  }).filter((file) => file && !file.dynamic).map((file) => file.text.replace(/^\.\//, ''));
  const names = (word) => stored.includes(word.text.replace(/^\.\//, ''));
  const runsStdin = INTERPRETERS.test(c.program) && c.args.every((a) => a.text === '-');
  const runsText = SHELLS.has(c.program) || ['eval', 'source', '.'].includes(c.program) || runsStdin;
  const piped = runsText && sink.some((d) => isDownload(d)
    && ((d.origin.parent === c && d.origin.kind === 'substitution') || (d.pipeline === c.pipeline && d.order < c.order)));
  // The stored file runs as an operand of a shell, or as the command word itself (`./install.sh`).
  const commandWord = c.words.find((w) => !ASSIGNMENT.test(w.text));
  const runsStored = runsText ? c.args.some(names) : Boolean(commandWord) && commandWord.text.includes('/') && names(commandWord);
  return piped || runsStored
    ? refusal('curl-pipe-sh', `\`${c.program}\` would run a downloaded script that nobody has read.`, 'download to a file, read the file, then run it in a separate command')
    : null;
}

// A function that calls itself through a pipe in the background (`:(){ :|:& };:`).
function forkBombRule(sink) {
  const defined = sink.filter((c) => c.separator === '(' && c.words.length === 1).map((c) => c.words[0].text);
  const bomb = sink.find((c) => c.separator === '&' && c.previous && c.previous.separator === '|'
    && defined.includes(c.program) && c.previous.program === c.program);
  return bomb ? refusal('fork-bomb', `The function \`${bomb.program}\` would start copies of itself without end.`, 'none') : null;
}

function checkOne(c, sink, context) {
  if (c.program === 'rm') return rmRule(c, context);
  if (c.program === 'find') return findRule(c, sink, context);
  if (c.program === 'git') return gitRule(c, context);
  if (c.program === 'chmod' && splitArgs(c.args).operands.some((a) => /^0?777$|^(a|ugo)[+=]rwx$/.test(a.text))) {
    return refusal('chmod-777', '`chmod 777` would let every user of the machine change the file.', '`chmod 755` for a folder or a program, `chmod 644` for a file');
  }
  if (c.program === 'docker' || c.program === 'docker-compose') return dockerRule(c);
  return diskRule(c) || downloadRule(c, sink);
}

/**
 * Decides one Bash command. `context`: { cwd, projectDir } of the hook input.
 * Returns { blocked, pattern: { id, reason } }.
 */
function checkCommand(cmd, context = {}) {
  return decideCommand(cmd, (commands) => {
    const assigned = commands.flatMap((c) => [...c.assignments, ...c.args.filter((a) => ASSIGNMENT.test(a.text))]);
    const full = {
      projectDir: context.projectDir || context.cwd || '',
      homeAssigned: assigned.some((w) => w.text.startsWith('HOME=')),
      gitPlaceVariable: assigned.some((w) => GIT_PLACE_VARIABLE.test(w.text)),
    };
    return firstRefusal(commands, (c) => checkOne(c, commands, full)) || forkBombRule(commands);
  });
}

if (require.main === module) {
  runHook(HOOK_NAME, [BASH_TOOL], (data) => checkCommand(data.tool_input?.command || '', {
    cwd: data.cwd,
    projectDir: process.env.CLAUDE_PROJECT_DIR,
  }));
} else {
  module.exports = { checkCommand };
}
