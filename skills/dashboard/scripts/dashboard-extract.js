#!/usr/bin/env node
// Extracts the status of a repository for the dashboard skill and writes one
// JSON document (JSON: JavaScript Object Notation) for one audience.
// Usage (run from inside the repository):
//   node dashboard-extract.js --audience private [--out <file>]
//   node dashboard-extract.js --audience shared --ref <remote>/<branch> [--out <file>]
//   node dashboard-extract.js --default-shared-ref
//   node dashboard-extract.js --check-shared-ref <remote>/<branch>
//   node dashboard-extract.js --remote-url <remote>/<branch>
//   node dashboard-extract.js --data-dir <path> --state-dir
//   node dashboard-extract.js --data-dir <path> --config
//   node dashboard-extract.js --data-dir <path> --config-set <key>=<value>
// The private run reads the working tree. The shared run reads only the
// pushed ref refs/remotes/<remote>/<branch>, and the URL of that remote for
// repo.name, and fails closed. The state folder
// <data dir>/dashboard/<repo key>/ lies outside the repository.
// Exit status: 0 on success; 2 when the command cannot run (not a git
// repository, no commit, a bad argument, a data folder that is not set, an
// output file inside the repository).
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  HEADS, REMOTES, LINK_MODE, DETACHED, GIT_OK, GIT_NO_COMMITS, RUN_STATE, REFS, LOG_ROOT, HEADING_PREFIX, STOPPED_HEADING,
  git, gitRaw, gitState, defaultBranch, currentBranch, countedUpstream, isAncestor, scanRuns,
} = require('../../pickup/scripts/git-runs');
const parse = require('./dashboard-parse');

const SCHEMA_VERSION = 1;
const EXIT_STOP = 2;
const HEAD_REF = 'HEAD';
const AUDIENCE = { private: 'private', shared: 'shared' };
const VISIBILITY = { tracked: 'tracked', private: 'private' };
const STATUS = { ok: 'ok', notFound: 'not-found', error: 'error' };
const SHARED_ERROR_NOTE = 'git command failed';
const REPO_TOKEN = '<repo>';
const HOME_TOKEN = '~';
// The text that Claude Code leaves in a skill when it does not substitute the
// plugin data path.
const DATA_DIR_UNSET = '${CLAUDE_PLUGIN_DATA}';
const STATE_ROOT = 'dashboard';
const CONFIG_FILE = 'config.json';
// Allowed config keys; a list names the only allowed values.
const CONFIG_KEYS = { privateUrl: null, sharedUrl: null, sharing: ['on', 'off'], sharedRef: null };
const KEY_HEX_DIGITS = 12;
// A run with no commit for this long may need a resume (spec section 5.2).
const STALE_MS = 24 * 60 * 60 * 1000;
const COMMIT_LIMIT = 20;
const FIELD_SEPARATOR = '\x1f';
const OPTIONS = {
  values: ['--audience', '--ref', '--out', '--data-dir', '--config-set', '--check-shared-ref', '--remote-url'],
  flags: ['--state-dir', '--config', '--default-shared-ref'],
};
// <remote>/<branch>: letters, digits, ".", "_", "-" and "/" only, and no "..".
const SHARED_REF_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/;
// The scheme and the user information (user name, password or token) of a
// URL that has an authority part. The authority ends at the first "/", "?"
// or "#"; its user information ends at the last "@" inside it.
const URL_USER_INFO = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#]*@/;
// A remote URL that names a folder on this machine: it starts with "/", "./",
// "../", "~", a drive letter ("C:/" or "C:\") or "file://". SKILL.md, `share`
// step 3, holds the only other copy of this rule, in prose.
const LOCAL_FOLDER_URL = /^(?:\/|\.\.?\/|~|[A-Za-z]:[\\/]|file:\/\/)/;
// The parts of a remote URL that follow the repository name: a query ("?…")
// or a fragment ("#…"), then trailing "/" characters, then one ".git".
const URL_NAME_TAIL = [/[?#].*$/, /\/+$/, /\.git$/];
// The path parts of a URL end at "/"; the scp-like form <user>@<host>:<path>
// (scp: secure copy) puts ":" before its first path part.
const URL_PART_END = /[/:]/;
const TREE = 'tree';
const BLOB = 'blob';
const NO_SOURCE = { file: null, heading: null, headingOrdinal: null, line: null, occurrence: null, lineNumber: null };
const MARK = { stopped: 'stopped — waits for you', ambiguous: 'ambiguous — waits for you', inProgress: 'in progress' };
const SECTION = {
  unfinishedRuns: 'unfinishedRuns', git: 'git', activeWorklogs: 'activeWorklogs', sessionOpenItems: 'sessionOpenItems',
  currentGoal: 'currentGoal', releases: 'releases', runHistory: 'runHistory', closedWorklogs: 'closedWorklogs',
  commits: 'commits', sessions: 'sessions', knownIssues: 'knownIssues',
};
const KIND = {
  run: 'run', branch: 'branch', commit: 'commit', worklog: 'worklog', worklogFile: 'worklog-file', part: 'part',
  worklogOpenItem: 'worklog-open-item', openItem: 'open-item', raw: 'raw', goal: 'goal', release: 'release',
  topic: 'topic', session: 'session', knownIssue: 'known-issue',
};
const ENTRY = { file: 'file', dir: 'dir', symlink: 'symlink', other: 'other' };
const FILES = { state: 'state.md', knownIssues: 'known-issues.md', version: 'VERSION', packageJson: 'package.json' };
const RELEASE_FILES = ['RELEASE-NOTES.md', 'CHANGELOG.md'];
const RELEASE_HEADING = /^## (v\d\S*|\[[^\]]+\])/;
const RELEASE_LIMIT = 15;
const SESSION_ENTRIES = 10;
const GOAL_LIMIT = 300;
const GOAL_PREFIX = 'Goal: ';
const CURRENT_GOAL = '## Current Goal';
const OPEN_PART_STATUSES = ['in progress', 'not started'];
const TOPIC_NAME = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const STAGES = ['specs', 'plans', 'implementation'];
const RULING_HEADING = '## RULING';
const MARKDOWN = '.md';
const CLOSED_DATE = / closed=(\d{4}-\d{2}-\d{2}) -->$/;
const WORKLOG_NOTE = {
  symlink: 'symbolic link, not read',
  invalidName: 'invalid file name, not read',
  malformed: 'malformed line 1: run /worklog to see why',
  unreadable: 'could not be read',
};

function stop(message) {
  process.stderr.write(`dashboard-extract: ${message}\n`);
  process.exit(EXIT_STOP);
}

// The trimmed output of a git command; throws with git's message on failure.
function must(args) {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.err}`);
  return result.out;
}

function mustLines(args) {
  return must(args).split('\n').filter(Boolean);
}

function repoTop() {
  return must(['rev-parse', '--show-toplevel']);
}

// ---- state folder and config.json ----

function stateDir(dataDir, repoTopDir) {
  const top = fs.realpathSync(repoTopDir);
  const hash = crypto.createHash('sha1').update(top, 'utf8').digest('hex').slice(0, KEY_HEX_DIGITS);
  return path.join(dataDir, STATE_ROOT, `${path.basename(top)}-${hash}`);
}

function readConfig(dir) {
  const file = path.join(dir, CONFIG_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return stop(`${file} is not valid JSON: ${error.message}`);
  }
}

function writeConfig(dir, config) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, CONFIG_FILE);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(temp, target);
}

function setConfig(config, assignment) {
  const at = assignment.indexOf('=');
  const key = at === -1 ? assignment : assignment.slice(0, at);
  const value = at === -1 ? '' : assignment.slice(at + 1);
  if (!Object.prototype.hasOwnProperty.call(CONFIG_KEYS, key)) stop(`unknown config key: ${key}`);
  if (!value) stop(`${key} needs a value`);
  if (CONFIG_KEYS[key] && !CONFIG_KEYS[key].includes(value)) stop(`${key} must be one of: ${CONFIG_KEYS[key].join(', ')}`);
  config[key] = value;
}

function stateCommand(args, repoTopDir) {
  const dataDir = args['--data-dir'];
  if (!dataDir || dataDir.includes(DATA_DIR_UNSET)) {
    stop('the plugin data folder is not set (the --data-dir argument is empty or was not substituted); refresh, sync and share need it, local does not');
  }
  const dir = stateDir(dataDir, repoTopDir);
  if (args.flags.has('--state-dir')) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(dir);
    return;
  }
  const config = readConfig(dir);
  if (args['--config-set'] !== undefined) {
    setConfig(config, args['--config-set']);
    writeConfig(dir, config);
  }
  console.log(JSON.stringify(config));
}

// ---- sources: where the files of one audience are read ----

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function entryKind(dirent) {
  if (dirent.isSymbolicLink()) return ENTRY.symlink;
  if (dirent.isDirectory()) return ENTRY.dir;
  return dirent.isFile() ? ENTRY.file : ENTRY.other;
}

// The private source: the working tree. A symbolic link is never followed.
function workingTreeSource(top) {
  const full = (rel) => path.join(top, ...rel.split('/'));
  return {
    read(rel) {
      try {
        if (!fs.lstatSync(full(rel)).isFile()) return null;
        return fs.readFileSync(full(rel), 'utf8');
      } catch (error) {
        return null;
      }
    },
    entries(rel) {
      try {
        if (!fs.lstatSync(full(rel)).isDirectory()) return null;
        return fs.readdirSync(full(rel), { withFileTypes: true })
          .map((dirent) => ({ name: dirent.name, kind: entryKind(dirent) }))
          .sort(byName);
      } catch (error) {
        return null;
      }
    },
    committed(rel) {
      return git(['cat-file', '-e', `${HEAD_REF}:${rel}`]).ok;
    },
  };
}

// The entries of `git ls-tree -z --full-tree <ref> -- <rel>`.
function lsTree(ref, rel) {
  const result = gitRaw(['ls-tree', '-z', '--full-tree', ref, '--', rel]);
  if (!result.ok) throw new Error(`git ls-tree failed: ${result.err}`);
  return result.raw.split('\0').filter(Boolean).map((row) => {
    const tab = row.indexOf('\t');
    const [mode, type, id] = row.slice(0, tab).split(' ');
    return { mode, type, id, path: row.slice(tab + 1) };
  });
}

// The shared source: only the pushed ref <ref>, read with git; never the
// working tree, the index or HEAD. A symbolic link (mode 120000) is skipped.
function refSource(ref) {
  const entry = (rel) => lsTree(ref, rel).find((item) => item.path === rel) || null;
  return {
    read(rel) {
      const found = entry(rel);
      if (!found || found.type !== BLOB || found.mode === LINK_MODE) return null;
      // Global Constraint 7: read with git show <ref>:<path>, after ls-tree
      // named the entry as a blob that is not a symbolic link.
      const blob = gitRaw(['show', `${ref}:${rel}`]);
      if (!blob.ok) throw new Error(`git show failed: ${blob.err}`);
      return blob.raw;
    },
    entries(rel) {
      const found = entry(rel);
      if (!found || found.type !== TREE) return null;
      return lsTree(ref, `${rel}/`)
        .filter((item) => item.mode !== LINK_MODE)
        .map((item) => ({
          name: item.path.slice(rel.length + 1),
          kind: item.type === TREE ? ENTRY.dir : (item.type === BLOB ? ENTRY.file : ENTRY.other),
        }))
        .sort(byName);
    },
    committed() {
      return true;
    },
  };
}

// ---- items and sections ----

function visibilityOf(context, file) {
  if (context.shared || file === null) return VISIBILITY.tracked;
  if (!context.committed.has(file)) context.committed.set(file, context.source.committed(file));
  return context.committed.get(file) ? VISIBILITY.tracked : VISIBILITY.private;
}

// An item with no anchored line: its id is the section id and a natural key.
// <file> (a file or a folder, or null) decides the visibility only.
function keyItem(context, sectionId, key, file, fields) {
  return Object.assign({
    id: parse.keyItemId(sectionId, key),
    visibility: visibilityOf(context, file),
    source: Object.assign({}, NO_SOURCE, { file }),
  }, fields);
}

// An item anchored to line <index> of <file>, inside <section>.
function lineItem(context, file, lines, section, index, fields) {
  const occurrence = parse.occurrenceOf(lines, section, index);
  return Object.assign({
    id: parse.lineItemId(file, section.heading, section.ordinal, lines[index], occurrence),
    visibility: visibilityOf(context, file),
    source: { file, heading: section.heading, headingOrdinal: section.ordinal, line: lines[index], occurrence, lineNumber: index + 1 },
  }, fields);
}

function okSection(items, extra) {
  return Object.assign({ status: STATUS.ok, note: '', items }, extra || {});
}

function notFoundSection(id, file) {
  return { [id]: notFound(file) };
}

function remoteRef(name) {
  return `${REMOTES}${name}`;
}

function remoteName(ref) {
  return ref.slice(REMOTES.length);
}

function notFound(file) {
  return { status: STATUS.notFound, note: `${file} not found`, items: [] };
}

function sanitize(context, message) {
  let text = message.split(context.top).join(REPO_TOKEN);
  if (context.home.length > 1) text = text.split(context.home).join(HOME_TOKEN);
  return text;
}

function errorSection(context, error) {
  return { status: STATUS.error, note: context.shared ? SHARED_ERROR_NOTE : sanitize(context, error.message), items: [] };
}

// ---- section builders: each returns { <section id>: <section> } ----

function runMark(context, run) {
  if (run.state === RUN_STATE.stopped) return MARK.stopped;
  if (run.state === RUN_STATE.ambiguous) return MARK.ambiguous;
  if (run.lastCommitTime !== null && context.now - run.lastCommitTime * 1000 > STALE_MS) {
    return `no commit since ${run.lastCommitDate} — may need resume`;
  }
  return MARK.inProgress;
}

function unfinishedRuns(context) {
  const runs = scanRuns(context.shared
    ? { refs: REFS.upstream, base: context.base, acceptUpstream: (upstream, branch) => onSharedRemote(context, upstream, branch) }
    : { refs: REFS.local });
  const items = runs.map((run) => keyItem(context, SECTION.unfinishedRuns, run.branch, null, {
    kind: KIND.run,
    branch: run.branch,
    slug: run.slug,
    logs: run.logs.map((log) => log.file),
    lastHeading: run.lastHeading,
    lastCommitDate: run.lastCommitDate,
    state: run.state,
    mark: runMark(context, run),
  }));
  // A failed git command of the scan leaves a run in the list with an empty
  // text; the section must show the failure, not look healthy.
  if (runs.errors.length) {
    const message = runs.errors.map((failure) => `${failure.command} failed: ${failure.message}`).join('; ');
    return { [SECTION.unfinishedRuns]: Object.assign(errorSection(context, new Error(message)), { items }) };
  }
  const note = context.shared || defaultBranch() ? '' : 'no default branch: every feature/* branch is scanned';
  return { [SECTION.unfinishedRuns]: okSection(items, { note }) };
}

function localBranches(context) {
  const base = defaultBranch();
  const notes = [];
  if (!base) notes.push('no default branch: merge information is not available');
  const filter = base ? [`--no-merged=${HEADS}${base}`] : [];
  const items = mustLines(['for-each-ref', ...filter, '--format=%(refname:short)%09%(committerdate:short)', HEADS])
    .map((row) => row.split('\t'))
    .filter(([name]) => name !== base)
    .map(([name, date]) => keyItem(context, SECTION.git, name, null, { kind: KIND.branch, name, date }));
  const ahead = git(['rev-list', '--count', '@{upstream}..HEAD']);
  if (!ahead.ok) notes.push('no upstream branch: the number of unpushed commits is omitted');
  const dirty = mustLines(['status', '--porcelain', '--untracked-files=no']).length;
  return okSection(items, { note: notes.join('; '), ahead: ahead.ok ? Number(ahead.out) : null, dirty });
}

// true when the counted upstream of the local branch <branch> lies on the
// remote of the shared ref: the shared run never shows a branch pushed only to
// another remote. A counted upstream is refs/remotes/<remote>/<branch> with
// the remote read from the branch's own configuration, so an exact comparison
// with the path built from context.remote cannot match a remote whose name
// only begins with the shared remote's name and a "/".
function onSharedRemote(context, upstream, branch) {
  return upstream === `${remoteRef(context.remote)}/${branch}`;
}

// The remote of the shared ref <name> (<remote>/<branch>): the one name in
// the list that `git remote` prints that is followed by "/" in <name>. A
// remote name may hold "/", so more than one name can match: the run stops.
function sharedRemote(name) {
  const matches = mustLines(['remote']).filter((remote) => name.startsWith(`${remote}/`));
  if (matches.length !== 1) stop(`the shared ref ${name} does not name exactly one remote (${matches.length} found)`);
  return matches[0];
}

// The URL of the remote <remote> with the user information removed, or null
// when git gives no URL. Every reader of a remote URL uses this function, so
// that a token inside the URL reaches no output.
function remoteUrl(remote) {
  const result = git(['remote', 'get-url', remote]);
  return result.ok ? result.out.replace(URL_USER_INFO, '$1') : null;
}

// repo.name of the shared run: the last path part of the URL of the shared
// ref's remote. The name of the local folder is local data and never reaches
// the shared page. The last part of a folder path on this machine is local
// data too, so such a remote, a remote with no URL and a URL that gives no
// name all give the shared ref <sharedName> (<remote>/<branch>) instead.
function sharedRepoName(sharedName, remote) {
  const url = remoteUrl(remote);
  if (url === null || LOCAL_FOLDER_URL.test(url)) return sharedName;
  const head = URL_NAME_TAIL.reduce((text, tail) => text.replace(tail, ''), url);
  return head.split(URL_PART_END).pop() || sharedName;
}

// The shared run lists only local branches whose upstream counts, by the
// upstream's name and date. The shared ref itself is left out by name; an
// upstream merged into context.base (the counted upstream of the default
// branch) is left out; with no context.base, no upstream counts as merged.
function sharedBranches(context) {
  const items = [];
  for (const name of localBranchNames()) {
    const upstream = countedUpstream(name);
    if (!upstream || upstream === context.ref || !onSharedRemote(context, upstream, name)) continue;
    const merged = context.base ? isAncestor(upstream, context.base) : false;
    if (merged === null) throw new Error('git merge-base failed');
    if (merged) continue;
    const shown = remoteName(upstream);
    const date = must(['log', '-1', '--format=%cd', '--date=short', upstream]);
    items.push(keyItem(context, SECTION.git, shown, null, { kind: KIND.branch, name: shown, date }));
  }
  return okSection(items, { ahead: null, dirty: null });
}

function gitSection(context) {
  return { [SECTION.git]: context.shared ? sharedBranches(context) : localBranches(context) };
}

function commits(context) {
  const format = ['%H', '%h', '%cd', '%s'].join('%x1f');
  const items = mustLines(['log', `-${COMMIT_LIMIT}`, `--format=${format}`, '--date=short', context.ref]).map((row) => {
    const [sha, short, date, subject] = row.split(FIELD_SEPARATOR);
    return keyItem(context, SECTION.commits, sha, null, { kind: KIND.commit, sha, short, date, subject });
  });
  return { [SECTION.commits]: okSection(items) };
}

function sessionLog(context) {
  const text = context.source.read(parse.SESSION_LOG);
  if (text === null) {
    const missing = notFound(parse.SESSION_LOG);
    return { [SECTION.sessionOpenItems]: missing, [SECTION.sessions]: missing };
  }
  const lines = parse.splitLines(text);
  const entries = parse.headings(lines).filter((entry) => !entry.raw.includes(parse.SUPERSEDED_MARK));
  const split = Math.max(0, entries.length - SESSION_ENTRIES);
  const itemsOf = (entry) => parse.openItems(lines, entry.index + 1, entry.end);
  const open = [];
  const sessions = [];
  for (const entry of entries.slice(split)) {
    for (const item of itemsOf(entry)) {
      if (item.resolved) continue;
      const fields = item.raw
        ? { kind: KIND.raw, text: item.line }
        : { kind: KIND.openItem, entry: entry.raw, text: parse.openItemText(item.line), continuation: item.continuation };
      open.push(lineItem(context, parse.SESSION_LOG, lines, entry, item.index, fields));
    }
    const goal = lines.slice(entry.index + 1, entry.end).findIndex((line) => line.startsWith(GOAL_PREFIX));
    if (goal !== -1) {
      const index = entry.index + 1 + goal;
      sessions.push(lineItem(context, parse.SESSION_LOG, lines, entry, index, { kind: KIND.session, entry: entry.raw, goal: lines[index].slice(GOAL_PREFIX.length) }));
    }
  }
  const olderUnresolved = entries.slice(0, split)
    .reduce((count, entry) => count + itemsOf(entry).filter((item) => !item.raw && !item.resolved).length, 0);
  return { [SECTION.sessionOpenItems]: okSection(open, { olderUnresolved }), [SECTION.sessions]: okSection(sessions) };
}

function currentGoal(context) {
  const text = context.source.read(FILES.state);
  if (text === null) return notFoundSection(SECTION.currentGoal, FILES.state);
  const lines = parse.splitLines(text);
  const section = parse.findSection(lines, CURRENT_GOAL, 1);
  const body = section ? lines.slice(section.index + 1, section.end) : [];
  const first = body.findIndex((line) => line.trim());
  if (first === -1) return { [SECTION.currentGoal]: okSection([], { note: `no text under "${CURRENT_GOAL}" in ${FILES.state}` }) };
  const goal = body.join('\n').trim().slice(0, GOAL_LIMIT);
  return { [SECTION.currentGoal]: okSection([lineItem(context, FILES.state, lines, section, section.index + 1 + first, { kind: KIND.goal, text: goal })]) };
}

function readVersion(context) {
  const plain = context.source.read(FILES.version);
  if (plain !== null && plain.trim()) return parse.splitLines(plain)[0].trim();
  const manifest = context.source.read(FILES.packageJson);
  if (manifest === null) return null;
  try {
    const { version } = JSON.parse(manifest);
    return typeof version === 'string' ? version : null;
  } catch (error) {
    return null;
  }
}

function releases(context) {
  const version = readVersion(context);
  for (const file of RELEASE_FILES) {
    const text = context.source.read(file);
    if (text === null) continue;
    const found = parse.headings(parse.splitLines(text)).filter((section) => RELEASE_HEADING.test(section.raw)).slice(0, RELEASE_LIMIT);
    const items = found.map((section) => keyItem(context, SECTION.releases, section.raw, file, { kind: KIND.release, heading: section.raw }));
    const note = found.length ? '' : `no release heading (## v<version> or ## [<version>]) in ${file}`;
    return { [SECTION.releases]: okSection(items, { note, version, file }) };
  }
  return { [SECTION.releases]: Object.assign(notFound(RELEASE_FILES.join(' or ')), { version, file: null }) };
}

function knownIssues(context) {
  const text = context.source.read(FILES.knownIssues);
  if (text === null) return notFoundSection(SECTION.knownIssues, FILES.knownIssues);
  const lines = parse.splitLines(text);
  const items = parse.headings(lines).map((section) => lineItem(context, FILES.knownIssues, lines, section, section.index, {
    kind: KIND.knownIssue,
    title: section.raw.slice(HEADING_PREFIX.length),
  }));
  return { [SECTION.knownIssues]: okSection(items) };
}

function runHistory(context) {
  const entries = context.source.entries(LOG_ROOT);
  if (entries === null) return notFoundSection(SECTION.runHistory, LOG_ROOT);
  const items = [];
  for (const entry of entries) {
    const match = entry.kind === ENTRY.dir ? entry.name.match(TOPIC_NAME) : null;
    if (!match) continue;
    const folder = `${LOG_ROOT}/${entry.name}`;
    const inner = context.source.entries(folder) || [];
    const logText = context.source.read(`${folder}/${match[2]}-orchestration-log.md`);
    const heads = logText === null ? [] : parse.splitLines(logText).filter((line) => line.startsWith(HEADING_PREFIX));
    items.push(keyItem(context, SECTION.runHistory, entry.name, folder, {
      kind: KIND.topic,
      date: match[1],
      slug: match[2],
      stages: STAGES.filter((stage) => inner.some((child) => child.kind === ENTRY.dir && child.name === stage)),
      lastHeading: heads.length ? heads[heads.length - 1] : null,
      rulings: heads.filter((line) => line.startsWith(RULING_HEADING)).length,
      stops: heads.filter((line) => line.startsWith(STOPPED_HEADING)).length,
    }));
  }
  return { [SECTION.runHistory]: okSection(items) };
}

// The items of the first table of <section>: <describe>(cells, columns)
// returns the fields of a row, or null to leave the row out. A row whose cell
// count differs from the header, or a table whose header lacks a column,
// gives a raw item.
function tableItems(context, file, slug, lines, section, columns, describe) {
  const table = parse.sectionTable(lines, section);
  const col = parse.columnIndex(table.header, columns);
  const items = [];
  for (const row of table.rows) {
    const fields = row.raw || !col ? { kind: KIND.raw, text: row.line } : describe(row.cells, col);
    if (fields) items.push(lineItem(context, file, lines, section, row.index, Object.assign({ worklog: slug }, fields)));
  }
  return items;
}

function activeWorklog(context, file, slug, text) {
  const lines = parse.splitLines(text);
  const items = [keyItem(context, SECTION.activeWorklogs, file, file, { kind: KIND.worklog, slug, path: file })];
  const parts = parse.findSection(lines, parse.PARTS_HEADING, 1);
  if (parts) {
    items.push(...tableItems(context, file, slug, lines, parts, parse.PART_COLUMNS, (cells, col) => (
      OPEN_PART_STATUSES.includes(cells[col.status])
        ? { kind: KIND.part, number: cells[col.number], part: cells[col.part], status: cells[col.status], since: cells[col.since], commit: cells[col.commit], note: cells[col.note] }
        : null
    )));
  }
  const open = parse.findSection(lines, parse.OPEN_ITEMS_HEADING, 1);
  if (open) {
    items.push(...tableItems(context, file, slug, lines, open, parse.OPEN_ITEM_COLUMNS, (cells, col) => (
      { kind: KIND.worklogOpenItem, number: cells[col.number], item: cells[col.item], part: cells[col.part], found: cells[col.found], blocks: cells[col.blocks] }
    )));
  }
  return items;
}

function worklogFileItem(context, shown, file, note) {
  return keyItem(context, SECTION.activeWorklogs, shown, file, { kind: KIND.worklogFile, path: shown, note });
}

function worklogs(context) {
  const entries = context.source.entries(parse.WORKLOG_DIR);
  if (entries === null) {
    const missing = notFound(parse.WORKLOG_DIR);
    return { [SECTION.activeWorklogs]: missing, [SECTION.closedWorklogs]: missing };
  }
  const active = [];
  const closed = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(MARKDOWN) || (entry.kind !== ENTRY.file && entry.kind !== ENTRY.symlink)) continue;
    const file = `${parse.WORKLOG_DIR}/${entry.name}`;
    if (entry.kind === ENTRY.symlink) {
      active.push(worklogFileItem(context, file, file, WORKLOG_NOTE.symlink));
      continue;
    }
    if (!parse.worklogNameValid(entry.name)) {
      active.push(worklogFileItem(context, `${parse.WORKLOG_DIR}/${parse.listingName(entry.name)}`, file, WORKLOG_NOTE.invalidName));
      continue;
    }
    const text = context.source.read(file);
    if (text === null) {
      active.push(worklogFileItem(context, file, file, WORKLOG_NOTE.unreadable));
      continue;
    }
    const slug = entry.name.slice(0, -MARKDOWN.length);
    const kind = parse.worklogClass(text);
    if (kind === parse.WORKLOG_CLASS.active) {
      active.push(...activeWorklog(context, file, slug, text));
    } else if (kind === parse.WORKLOG_CLASS.closed) {
      const date = parse.worklogLine1(text).match(CLOSED_DATE);
      closed.push(keyItem(context, SECTION.closedWorklogs, file, file, { kind: KIND.worklog, slug, path: file, closed: date ? date[1] : null }));
    } else {
      active.push(worklogFileItem(context, file, file, WORKLOG_NOTE.malformed));
    }
  }
  return { [SECTION.activeWorklogs]: okSection(active), [SECTION.closedWorklogs]: okSection(closed) };
}

// Each builder fills the sections it names; a builder that throws gives every
// one of its sections the status "error".
const BUILDERS = [
  { ids: [SECTION.unfinishedRuns], build: unfinishedRuns },
  { ids: [SECTION.git], build: gitSection },
  { ids: [SECTION.activeWorklogs, SECTION.closedWorklogs], build: worklogs },
  { ids: [SECTION.sessionOpenItems, SECTION.sessions], build: sessionLog },
  { ids: [SECTION.currentGoal], build: currentGoal },
  { ids: [SECTION.releases], build: releases },
  { ids: [SECTION.runHistory], build: runHistory },
  { ids: [SECTION.commits], build: commits },
  { ids: [SECTION.knownIssues], build: knownIssues },
];

// ---- the document ----

function commitMeta(context) {
  const sha = must(['rev-parse', `${context.ref}^{commit}`]);
  // The shared run never reads HEAD.
  const current = context.shared ? null : currentBranch();
  return {
    sha,
    short: sha.slice(0, 7),
    branch: context.shared ? remoteName(context.ref) : (current === DETACHED ? null : current),
    ref: context.ref,
    defaultBranch: context.shared ? null : defaultBranch(),
  };
}

function buildSections(context) {
  const sections = {};
  for (const builder of BUILDERS) {
    try {
      Object.assign(sections, builder.build(context));
    } catch (error) {
      for (const id of builder.ids) sections[id] = errorSection(context, error);
    }
  }
  return sections;
}

function extract(audience, sharedName, top) {
  const shared = audience === AUDIENCE.shared;
  const ref = shared ? remoteRef(sharedName) : HEAD_REF;
  // base: the ref against which the shared run decides "merged" (null: no
  // merge exclusion). The private run does not use it.
  const context = {
    shared, ref, remote: shared ? sharedRemote(sharedName) : null, base: shared ? defaultUpstream() : null, top, home: os.homedir(), now: Date.now(), committed: new Map(),
    source: shared ? refSource(ref) : workingTreeSource(top),
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    audience,
    generatedAt: parse.localIso(new Date()),
    repo: { name: shared ? sharedRepoName(sharedName, context.remote) : path.basename(top) },
    commit: commitMeta(context),
    sections: buildSections(context),
  };
}

function writeDocument(doc, out) {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (!out) {
    process.stdout.write(text);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  // A write would follow a symbolic link at --out and change its target.
  const entry = fs.lstatSync(out, { throwIfNoEntry: false });
  if (entry && entry.isSymbolicLink()) stop(`${out} is a symbolic link`);
  fs.writeFileSync(out, text);
  console.log(`written ${out} ${Buffer.byteLength(text)} bytes`);
}

function localBranchNames() {
  return mustLines(['for-each-ref', '--format=%(refname:short)', HEADS]);
}

// The counted upstream of the default branch (refs/remotes/<remote>/<branch>),
// or null when there is no default branch or the default branch has no
// counted upstream. The shared run decides "merged" against this ref, never
// against the shared ref (spec section 5, Tab 1).
function defaultUpstream() {
  const base = defaultBranch();
  return base ? countedUpstream(base) : null;
}

function printDefaultSharedRef() {
  const upstream = defaultUpstream();
  if (!upstream) stop('the default branch has no upstream that counts (a remote-tracking ref of the same name); give --ref <remote>/<branch>');
  const name = remoteName(upstream);
  requireSharedRefForm(name, `the upstream ${name}`);
  console.log(name);
}

function requireSharedRefForm(name, label) {
  if (!SHARED_REF_NAME.test(name) || name.includes('..')) stop(`${label} is not of the form <remote>/<branch>`);
}

function checkSharedRef(name) {
  requireSharedRefForm(name, `--check-shared-ref ${name}`);
  if (!localBranchNames().some((branch) => countedUpstream(branch) === remoteRef(name))) {
    stop(`${name} is not the upstream of a local branch of the same name`);
  }
  console.log(`ok ${name}`);
}

// Prints the remote of the shared ref <name> (<remote>/<branch>, resolved by
// sharedRemote) and its URL with the user information removed, so that a
// token inside the URL never reaches the model. Git's own message is not
// printed: it is not needed and could name the URL.
function printRemoteUrl(name) {
  requireSharedRefForm(name, `--remote-url ${name}`);
  const remote = sharedRemote(name);
  const url = remoteUrl(remote);
  if (url === null) stop(`the remote ${remote} has no URL`);
  console.log(`remote ${remote}`);
  console.log(url);
}

function checkSharedName(name) {
  if (!name) stop('the shared audience needs --ref <remote>/<branch>');
  requireSharedRefForm(name, `--ref ${name}`);
  // The exact-name check: rev-parse would also accept a local branch or tag
  // named refs/remotes/<name> (git's name guessing).
  if (!git(['show-ref', '--verify', '--quiet', remoteRef(name)]).ok) stop(`the shared ref ${name} no longer exists; nothing is published`);
  if (!git(['rev-parse', '--verify', '--quiet', `${remoteRef(name)}^{commit}`]).ok) stop(`the shared ref ${name} is not a commit; nothing is published`);
}

function main() {
  const args = parse.parseArguments(process.argv.slice(2), OPTIONS, stop);
  const state = gitState();
  if (state !== GIT_OK) stop(state === GIT_NO_COMMITS ? 'the repository has no commit yet' : 'this folder is not inside a git repository');
  const top = repoTop();
  // SKILL.md passes --data-dir on every command (Global Constraint 10); only a
  // state option makes the command a state command.
  if (args.flags.has('--state-dir') || args.flags.has('--config') || args['--config-set'] !== undefined) {
    stateCommand(args, top);
    return;
  }
  if (args['--remote-url'] !== undefined) {
    printRemoteUrl(args['--remote-url']);
    return;
  }
  if (args.flags.has('--default-shared-ref')) {
    printDefaultSharedRef();
    return;
  }
  if (args['--check-shared-ref'] !== undefined) {
    checkSharedRef(args['--check-shared-ref']);
    return;
  }
  const audience = args['--audience'];
  if (!Object.values(AUDIENCE).includes(audience)) stop('--audience must be private or shared');
  if (audience === AUDIENCE.shared) checkSharedName(args['--ref']);
  const out = args['--out'];
  if (out && parse.isInside(out, top)) stop(`--out ${out} lies inside the repository; write into the session scratchpad folder`);
  writeDocument(extract(audience, args['--ref'], top), out);
}

main();
