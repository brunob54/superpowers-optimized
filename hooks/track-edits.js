#!/usr/bin/env node
/**
 * PostToolUse Hook — File Edit Tracking
 *
 * After every Edit|Write tool use, logs the file path and timestamp
 * to a session-scoped edit log. This log feeds downstream hooks
 * (stop-reminders) to know what was changed during the session.
 *
 * Input:  stdin JSON with { tool_name, tool_input, session_id, cwd,
 *         scratchpad_dir, ... }
 * Output: stdout JSON (always {}, never blocks)
 *
 * A file inside the session scratchpad (the temporary folder that Claude Code
 * gives a session for throwaway files; the hook input names it in
 * `scratchpad_dir`) is not logged: such a file is not a change to the project,
 * and a logged one made the stop hook ask for tests of a scratch script.
 * Without the field (a headless session has no scratchpad) every edit is
 * logged, as before.
 *
 * The hook also runs after every Bash tool use. A Bash call is never logged;
 * the hook only writes the git exclude entry of a session-log.md that the
 * command redirects output into (see excludeSessionLogWrittenBy).
 */

const fs = require('fs');
const path = require('path');
const { excludeFromGit, git } = require('./git-exclude');
const { LOG_DIR, editLogFile, markerFile, writeTimeFile } = require('./save-marker');

// AI-generated workspace artifacts that should never be committed
const SESSION_LOG = 'session-log.md';
const AI_ARTIFACTS = ['project-map.md', SESSION_LOG, 'state.md', 'known-issues.md'];

// Claude Code sets this environment variable for every hook: the folder where
// the session started. It keeps its value when the assistant runs `cd`; the
// `cwd` field of the hook input does not.
const PROJECT_DIR_VARIABLE = 'CLAUDE_PROJECT_DIR';

/**
 * Keep an AI artifact file out of `git status` without editing a tracked file.
 * Called after every Edit or Write, and after a Bash command that redirects
 * output into session-log.md; it acts only when the file name is in
 * AI_ARTIFACTS and the file lies directly in one of the two folders where the
 * skills write these files: the project folder of the session, or the top
 * folder of the file's git work tree (the folder that holds the checked-out
 * files; a linked worktree has its own top folder). A file with the same name
 * in any other folder, for example `docs/known-issues.md`, is a document of
 * the user's project: an exclude entry would leave it out of `git add -A` and
 * of the commit with no message.
 */
function excludeArtifact(filePath) {
  const name = path.basename(filePath);
  if (!AI_ARTIFACTS.includes(name)) return;
  const folder = realPath(path.dirname(filePath));
  if (!isProjectFolder(folder) && !isTopFolderOfWorkTree(folder)) return;
  if (isTrackedWhereLetterCaseIsIgnored(folder, name)) return;
  excludeFromGit(filePath);
}

/**
 * True when the file system ignores letter case and git tracks a file in
 * `folder` whose name is `name` in any letter case. On such a file system
 * (the default on macOS and on Windows) `state.md` and `STATE.md` are one
 * file. excludeFromGit asks git for the exact name only, so without this
 * check a tracked `STATE.md` got the entry `/state.md`.
 * Both answers come from git: `:(icase)` makes `ls-files` compare the name
 * without letter case, and git sets `core.ignorecase` to true when it creates
 * a repository on a file system that ignores letter case.
 */
function isTrackedWhereLetterCaseIsIgnored(folder, name) {
  try {
    // The command fails when git tracks no file with this name.
    git(['ls-files', '--error-unmatch', '--', `:(icase)${name}`], folder);
    return git(['config', '--type=bool', '--get', 'core.ignorecase'], folder).trim() === 'true';
  } catch {
    return false;
  }
}

const BASH_TOOL = 'Bash';

// Text of a shell command in which no character has a special meaning: a text
// in single quotes, a text in double quotes, or a character after a backslash.
const QUOTED_TEXT = [String.raw`'[^']*'`, String.raw`"(?:[^"\\]|\\[\s\S])*"`, String.raw`\\[\s\S]`].join('|');

// One word of a shell command: quoted text and characters that end no word.
const SHELL_WORD = String.raw`(?:${QUOTED_TEXT}|[^\s;&|<>()'"\\])+`;

// One step of the reader of a shell command. At each position the first
// alternative that matches is taken, so a `>` inside quotes, after a
// backslash or in a comment is never read as a redirect.
const SHELL_STEP = new RegExp(
  [
    QUOTED_TEXT,
    String.raw`(?<![^\s;&|()])#[^\n]*`, // a comment: `#` at the start of a word, to the end of the line
    String.raw`>>?\|?[ \t]*(?<target>${SHELL_WORD})`, // `>`, `>>` or `>|` and the file it writes
    String.raw`[\s\S]`, // any other character
  ].join('|'),
  'g'
);

// The first `<<` of a command, with the rest of its line. `<<<` (a
// here-string, which has no body) does not count.
const HERE_DOCUMENT_LINE = /(?<!<)<<(?!<)[^\n]*/;

// A redirect target that holds one of these is not a plain path: the shell
// replaces a variable, a command in backticks or a `~` at the start, and the
// hook cannot know the result. A target with a backslash is left out too: the
// reader does not remove a backslash as the shell does.
const NOT_A_PLAIN_PATH = /[$`\\]|^~/;

/**
 * The files that a shell command redirects output into (`>`, `>>`, `>|`), as
 * the command writes them, without quotes. A target that is not a plain path
 * is left out.
 *
 * The command is read only up to the end of the first line that holds `<<`:
 * the lines after the opener of a here-document are its body, which is text
 * and not a command. The cut is made before the quotes are read, so the body
 * of a here-document inside double quotes (the usual form of a commit
 * message) is never read, whatever quotes it holds.
 *
 * Limits. Not seen: a redirect on a line after the first `<<`, also when
 * that `<<` opens no here-document. Read as a redirect by mistake: a `>`
 * between `[[` and `]]`, where it compares two texts; and a `>` in a text
 * that the shell reads as quoted because of a command substitution `$( )`
 * inside double quotes (the reader ends the quoted text at the next `"`).
 */
function redirectTargets(command) {
  const hereDocument = HERE_DOCUMENT_LINE.exec(command);
  const text = hereDocument ? command.slice(0, hereDocument.index + hereDocument[0].length) : command;
  return [...text.matchAll(SHELL_STEP)]
    .map(step => step.groups.target)
    .filter(target => target && !NOT_A_PLAIN_PATH.test(target))
    .map(target => target.replace(/['"]/g, ''));
}

/**
 * Keep a session-log.md that a Bash command wrote out of `git status`. The
 * save command of the context-management skill creates the file with
 * `cat >> session-log.md`, and the Edit and Write tools do not see that.
 *
 * The function acts only on a redirect into a file with this exact name. A
 * command that only names the file (grep, cat, a commit message) gets no
 * entry, and no other AI artifact gets one after a Bash call: such a file can
 * be a document of the user's project, and a mention must not hide it.
 *
 * A relative path is resolved against the `cwd` of the hook input: this is
 * the folder of the shell after the command, and it follows a `cd` of the
 * assistant. The folder is therefore not read as the project folder:
 * excludeArtifact applies its folder rule to the file, as it does after a
 * Write of the same file. Without a `cwd` the function does nothing.
 *
 * A file that does not exist gets no entry, and a tracked file gets none. A
 * folder with this name gets none: the entry would hide every file in it.
 * A file inside the session scratchpad gets none either, as after a Write: a
 * repository there is a test fixture, and its `git status` must stay as the
 * commands left it.
 *
 * Limits (the file then stays visible until the next save in the form of the
 * skill): a path that holds a variable; a redirect on a line after the first
 * `<<`; a command that writes the file in another way (`tee`); a `cd` inside
 * a subshell, which the `cwd` of the hook input does not show.
 */
function excludeSessionLogWrittenBy(command, cwd, scratchpadDir) {
  if (typeof command !== 'string' || typeof cwd !== 'string' || cwd === '') return;
  const filePaths = redirectTargets(command)
    .filter(target => path.basename(target) === SESSION_LOG)
    .map(target => path.resolve(cwd, target));
  for (const filePath of new Set(filePaths)) {
    if (isFile(filePath) && !isInsideScratchpad(filePath, scratchpadDir)) excludeArtifact(filePath);
  }
}

/** True when the path is a file, or a symbolic link to a file. */
function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

const SAVED_TAG = '[saved]';
const REGEXP_SPECIAL_CHARACTER = /[.*+?^${}()|[\]\\]/g;
// A Markdown heading line that holds the tag, for example `## 2026-09-20 [saved]`.
// Markdown allows up to three spaces before the `#`; four spaces start a code block.
const SAVED_HEADING = new RegExp(
  `^ {0,3}#{1,6}\\s.*${SAVED_TAG.replace(REGEXP_SPECIAL_CHARACTER, '\\$&')}`,
  'gm'
);

function countSavedHeadings(text) {
  return (String(text || '').match(SAVED_HEADING) || []).length;
}

/**
 * True when this Edit or Write of session-log.md adds a `[saved]` entry.
 * An Edit adds an entry when the new text holds more `[saved]` headings than
 * the old text. An Edit that trims an old entry, or that changes the text of
 * an entry, does not count. Limit: the payload of a Write holds no old text,
 * so every Write whose content holds the tag counts.
 */
function addsSavedEntry(toolName, toolInput) {
  if (toolName === 'Edit') {
    return countSavedHeadings(toolInput.new_string) > countSavedHeadings(toolInput.old_string);
  }
  return String(toolInput.content || '').includes(SAVED_TAG);
}

/**
 * The path with every symbolic link resolved. On macOS the temporary folder
 * has two names (/tmp/... and /private/tmp/...), and the hook input may use
 * either. A path that does not exist is resolved through its parent folder;
 * when that fails too, the path is returned as given.
 */
function realPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

/**
 * True when `folder` (a real path) is the project folder of the session.
 * Without the variable (a platform other than Claude Code) the result is
 * false.
 */
function isProjectFolder(folder) {
  const projectDir = process.env[PROJECT_DIR_VARIABLE];
  return Boolean(projectDir) && path.relative(realPath(projectDir), folder) === '';
}

/**
 * True when git reports `folder` as the top folder of a work tree.
 * `git rev-parse --show-prefix` prints the path of the folder from that top
 * folder: an empty line for the top folder itself, and a path that ends in
 * `/` for a subfolder. Outside a git repository the command fails, and the
 * result is false.
 */
function isTopFolderOfWorkTree(folder) {
  try {
    return git(['rev-parse', '--show-prefix'], folder).trim() === '';
  } catch {
    return false;
  }
}

/**
 * True when the absolute path filePath lies inside the folder scratchpadDir.
 * A sibling folder whose name starts with the scratchpad's name (for example
 * `scratchpad-2`) is outside; the comparison works on path segments. Any
 * value that is not a folder path, and any error, gives false: the edit is
 * then logged as it was before this check existed.
 */
function isInsideScratchpad(filePath, scratchpadDir) {
  if (typeof scratchpadDir !== 'string' || scratchpadDir === '') return false;
  try {
    const relative = path.relative(realPath(scratchpadDir), realPath(filePath));
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

/** The file path made absolute against cwd when it is relative. */
function resolveAgainstCwd(filePath, cwd) {
  if (filePath && !path.isAbsolute(filePath) && cwd) {
    return path.resolve(cwd, filePath);
  }
  return filePath;
}

/**
 * Append an entry to the edit log of the session. The log is never rewritten
 * or trimmed here; save-marker.js deletes a log that is older than 7 days.
 * Format: ISO-timestamp | session_id | tool | file_path
 * (Legacy format without session_id is still accepted on read)
 */
function logEdit(tool, filePath, cwd, sessionId) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const resolved = resolveAgainstCwd(filePath, cwd);

    const sid = sessionId || '';
    const entry = `${new Date().toISOString()} | ${sid} | ${tool} | ${resolved}\n`;
    fs.appendFileSync(editLogFile(sessionId), entry);

    // Keep AI workspace artifacts out of git status on first write
    excludeArtifact(resolved);
  } catch {
    // Silently ignore logging errors — never block the tool
  }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, cwd, session_id, scratchpad_dir } = data;

    // A Bash call is not logged as an edit, and it does not move the save
    // marker: only the exclude entry of a session log that the command wrote.
    if (tool_name === BASH_TOOL) {
      excludeSessionLogWrittenBy(tool_input?.command, cwd, scratchpad_dir);
    }

    // Only track Edit and Write operations
    if (tool_name !== 'Edit' && tool_name !== 'Write') {
      process.stdout.write('{}');
      return;
    }

    const filePath = tool_input?.file_path;
    // A file inside the session scratchpad is neither logged nor read as a
    // save of the session log.
    if (filePath && !isInsideScratchpad(resolveAgainstCwd(filePath, cwd), scratchpad_dir)) {
      logEdit(tool_name, filePath, cwd, session_id);

      // Track when a [saved] entry is written to session-log.md so that
      // stop-reminders can ask "any significant edits since last [saved]?"
      // rather than "any significant edits in the last 30 minutes?"
      // The marker belongs to this session, so a save by another session
      // does not reset this session's reminder.
      if (
        path.basename(filePath).toLowerCase().startsWith('session-log') &&
        addsSavedEntry(tool_name, tool_input)
      ) {
        writeTimeFile(markerFile(session_id));
      }
    }
  } catch {
    // Silently ignore parse errors
  }

  process.stdout.write('{}');
}

if (require.main === module) {
  main();
} else {
  module.exports = { logEdit, excludeArtifact, LOG_DIR };
}
