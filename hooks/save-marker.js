/**
 * Save marker, stop guard, edit log and statistics — file names shared by the hooks
 *
 * Four files under the hook log folder record the state of one session:
 *   - the save marker holds the time of the session's last `[saved]` entry in
 *     session-log.md. track-edits.js and the context-management skill write
 *     it; stop-reminders.js reads it.
 *   - the stop guard holds the time of the last stop that stop-reminders.js
 *     blocked.
 *   - the edit log holds one line for each Edit or Write of the session.
 *     track-edits.js appends to it; stop-reminders.js reads it.
 *   - the statistics file counts the Skill calls of the session.
 *     track-session-stats.js writes it; stop-reminders.js reads it.
 *
 * Each session has its own four files, so one session cannot hide the
 * reminders of another session. The session id is part of the file name.
 * A payload without a session id uses the old file names, which all sessions
 * share.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR_SEGMENTS = ['.claude', 'hooks-logs'];
const LOG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  ...LOG_DIR_SEGMENTS
);

const MARKER_KIND = { prefix: 'last-saved-entry', extension: '.txt' };
const GUARD_KIND = { prefix: 'stop-hook-fired', extension: '.lock' };
const EDIT_LOG_KIND = { prefix: 'edit-log', extension: '.txt' };
const STATS_KIND = { prefix: 'session-stats', extension: '.json' };
const FILE_KINDS = [MARKER_KIND, GUARD_KIND, EDIT_LOG_KIND, STATS_KIND];

// A per-session file is named `<prefix>-<clean id><extension>`.
const ID_SEPARATOR = '-';

// Every character outside this set becomes `_`, so an id can never name a
// folder or point outside the log folder.
const UNSAFE_ID_CHARACTER = /[^A-Za-z0-9_-]/g;
const ID_REPLACEMENT = '_';
const MAX_ID_LENGTH = 64;

// Per-session files older than this are deleted. stop-reminders.js also never
// looks further back than this for unsaved edits.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cleanSessionId(sessionId) {
  if (!sessionId) return '';
  return String(sessionId).replace(UNSAFE_ID_CHARACTER, ID_REPLACEMENT).slice(0, MAX_ID_LENGTH);
}

function sessionFile(kind, sessionId) {
  const id = cleanSessionId(sessionId);
  const suffix = id ? ID_SEPARATOR + id : '';
  return path.join(LOG_DIR, kind.prefix + suffix + kind.extension);
}

/** Path of the save marker of one session. No id gives the old shared file. */
function markerFile(sessionId) {
  return sessionFile(MARKER_KIND, sessionId);
}

/** Path of the stop guard of one session. No id gives the old shared file. */
function guardFile(sessionId) {
  return sessionFile(GUARD_KIND, sessionId);
}

/**
 * Path of the edit log of one session. No id gives the old shared file. A
 * writer only appends to an edit log, and no hook rewrites, renames or trims
 * one: a rewrite of a file that several processes append to loses lines.
 */
function editLogFile(sessionId) {
  return sessionFile(EDIT_LOG_KIND, sessionId);
}

/**
 * Path of the statistics file of one session. No id gives the old shared file.
 * A reader never reads the shared file for a session that has an id: the shared
 * file holds one total of all sessions, and no part of it belongs to one session.
 */
function statsFile(sessionId) {
  return sessionFile(STATS_KIND, sessionId);
}

/** True for the name of a per-session file, false for the old shared names. */
function isPerSessionFileName(name) {
  return FILE_KINDS.some(kind =>
    name.startsWith(kind.prefix + ID_SEPARATOR) && name.endsWith(kind.extension)
  );
}

/**
 * Delete the per-session files that are older than MAX_AGE_MS. The old shared
 * files are never deleted. Every file-system error is ignored.
 */
function removeOldSessionFiles() {
  try {
    const oldest = Date.now() - MAX_AGE_MS;
    for (const name of fs.readdirSync(LOG_DIR).filter(isPerSessionFileName)) {
      try {
        const file = path.join(LOG_DIR, name);
        if (fs.statSync(file).mtimeMs < oldest) fs.unlinkSync(file);
      } catch {
        // Another session may have deleted the file already
      }
    }
  } catch {
    // The log folder may not exist yet
  }
}

/** Write the current time into a marker or guard file. Errors are ignored. */
function writeTimeFile(file) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(file, new Date().toISOString());
  } catch {
    // A hook must never fail because of this file
  }
}

/**
 * The shell command that writes the save marker of the current session.
 * Claude Code gives a Bash command the session id in CLAUDE_CODE_SESSION_ID.
 * The command cleans the id by the same rule as cleanSessionId, and it writes
 * the old shared file when the variable is not set. The text holds no `$`
 * and no backtick, so the shell passes it to node unchanged.
 * skills/context-management/SKILL.md holds a copy of this text; a unit test
 * compares the two.
 */
const quoted = values => values.map(value => `'${value}'`).join(',');
const MARKER_COMMAND =
  'node -e "const fs=require(\'fs\'),path=require(\'path\'),' +
  `id=String(process.env.CLAUDE_CODE_SESSION_ID||'').replace(${UNSAFE_ID_CHARACTER},'${ID_REPLACEMENT}').slice(0,${MAX_ID_LENGTH}),` +
  `dir=path.join(process.env.HOME||process.env.USERPROFILE||'.',${quoted(LOG_DIR_SEGMENTS)});` +
  'fs.mkdirSync(dir,{recursive:true});' +
  `fs.writeFileSync(path.join(dir,'${MARKER_KIND.prefix}'+(id?'${ID_SEPARATOR}'+id:'')+'${MARKER_KIND.extension}'),new Date().toISOString())"`;

module.exports = {
  LOG_DIR,
  MARKER_COMMAND,
  MAX_AGE_MS,
  cleanSessionId,
  editLogFile,
  guardFile,
  markerFile,
  removeOldSessionFiles,
  statsFile,
  writeTimeFile,
};
