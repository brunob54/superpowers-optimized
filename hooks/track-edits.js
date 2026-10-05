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
 * the hook only writes the git exclude entry of an AI artifact file that the
 * command names (see excludeArtifactsNamedIn).
 */

const fs = require('fs');
const path = require('path');
const { excludeFromGit, git } = require('./git-exclude');
const { LOG_DIR, editLogFile, markerFile, writeTimeFile } = require('./save-marker');

// AI-generated workspace artifacts that should never be committed
const AI_ARTIFACTS = ['project-map.md', 'session-log.md', 'state.md', 'known-issues.md'];

// Claude Code sets this environment variable for every hook: the folder where
// the session started. It keeps its value when the assistant runs `cd`; the
// `cwd` field of the hook input does not.
const PROJECT_DIR_VARIABLE = 'CLAUDE_PROJECT_DIR';

/**
 * Keep an AI artifact file out of `git status` without editing a tracked file.
 * Called after every Edit or Write, and after a Bash command that names such
 * a file; it acts only when the file name is in
 * AI_ARTIFACTS and the file lies directly in one of the two folders where the
 * skills write these files: the project folder of the session, or the top
 * folder of the file's git work tree (the folder that holds the checked-out
 * files; a linked worktree has its own top folder). A file with the same name
 * in any other folder, for example `docs/known-issues.md`, is a document of
 * the user's project: an exclude entry would leave it out of `git add -A` and
 * of the commit with no message.
 */
function excludeArtifact(filePath) {
  if (!AI_ARTIFACTS.includes(path.basename(filePath))) return;
  const folder = realPath(path.dirname(filePath));
  if (!isProjectFolder(folder) && !isTopFolderOfWorkTree(folder)) return;
  excludeFromGit(filePath);
}

const BASH_TOOL = 'Bash';

/**
 * Keep the AI artifact files that a Bash command names out of `git status`.
 * A Bash command can create such a file: the save command of the
 * context-management skill appends to session-log.md with `cat >>`, and the
 * Edit and Write tools do not see that.
 *
 * The text of the command only selects the file names to look at; the state
 * of each file decides. The function looks for the file in two folders:
 *   - the `cwd` of the hook input. This is the folder of the shell after the
 *     command, so a file name without a folder in the command means a file
 *     there. The folder follows a `cd` of the assistant, so it is not read as
 *     the project folder: excludeArtifact applies its folder rule to it, as
 *     it does after a Write of the same file.
 *   - the project folder of the session, for a command that ran in another
 *     folder and named the file by a path.
 * A file that does not exist gets no entry, and a tracked file gets none. A
 * folder with the name of an artifact gets none: the entry would hide every
 * file in it.
 * A file inside the session scratchpad gets none either, as after a Write: a
 * repository there is a test fixture, and its `git status` must stay as the
 * commands left it.
 *
 * Limits: a command that builds the file name from a variable is not seen.
 * A command that names the file by a path into a third folder is not seen
 * either. A command that only reads the file gives it the entry too: the
 * entry depends on the file, not on what the command does with it.
 */
function excludeArtifactsNamedIn(command, cwd, scratchpadDir) {
  if (typeof command !== 'string') return;
  const folders = new Set(
    [cwd, process.env[PROJECT_DIR_VARIABLE]].filter(folder => typeof folder === 'string' && folder !== '')
  );
  for (const name of AI_ARTIFACTS.filter(artifact => command.includes(artifact))) {
    for (const folder of folders) {
      const filePath = path.resolve(folder, name);
      if (isFile(filePath) && !isInsideScratchpad(filePath, scratchpadDir)) excludeArtifact(filePath);
    }
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
    // marker: only the exclude entry of a file that the command names.
    if (tool_name === BASH_TOOL) {
      excludeArtifactsNamedIn(tool_input?.command, cwd, scratchpad_dir);
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
