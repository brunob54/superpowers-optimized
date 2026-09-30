#!/usr/bin/env node
// Extracts the status of a repository for the dashboard skill and writes one
// JSON document (JSON: JavaScript Object Notation) for one audience.
// Usage (run from inside the repository):
//   node dashboard-extract.js --audience private [--out <file>]
//   node dashboard-extract.js --data-dir <path> --state-dir
//   node dashboard-extract.js --data-dir <path> --config
//   node dashboard-extract.js --data-dir <path> --config-set <key>=<value>
// The private run reads the working tree. The state folder
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
  HEADS, DETACHED, GIT_OK, GIT_NO_COMMITS, RUN_STATE, REFS,
  git, gitState, defaultBranch, currentBranch, scanRuns,
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
  values: ['--audience', '--out', '--data-dir', '--config-set'],
  flags: ['--state-dir', '--config'],
};
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

function stateDir(dataDir) {
  const top = fs.realpathSync(repoTop());
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

function stateCommand(args) {
  const dataDir = args['--data-dir'];
  if (!dataDir || dataDir.includes(DATA_DIR_UNSET)) {
    stop('the plugin data folder is not set (the --data-dir argument is empty or was not substituted); refresh, sync and share need it, local does not');
  }
  const dir = stateDir(dataDir);
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
  const runs = scanRuns({ refs: REFS.local });
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
  const note = defaultBranch() ? '' : 'no default branch: every feature/* branch is scanned';
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

function gitSection(context) {
  return { [SECTION.git]: localBranches(context) };
}

function commits(context) {
  const format = ['%H', '%h', '%cd', '%s'].join('%x1f');
  const items = mustLines(['log', `-${COMMIT_LIMIT}`, `--format=${format}`, '--date=short', context.ref]).map((row) => {
    const [sha, short, date, subject] = row.split(FIELD_SEPARATOR);
    return keyItem(context, SECTION.commits, sha, null, { kind: KIND.commit, sha, short, date, subject });
  });
  return { [SECTION.commits]: okSection(items) };
}

// Each builder fills the sections it names; a builder that throws gives every
// one of its sections the status "error".
const BUILDERS = [
  { ids: [SECTION.unfinishedRuns], build: unfinishedRuns },
  { ids: [SECTION.git], build: gitSection },
  { ids: [SECTION.commits], build: commits },
];

// ---- the document ----

function commitMeta(context) {
  const sha = must(['rev-parse', `${context.ref}^{commit}`]);
  const current = currentBranch();
  return {
    sha,
    short: sha.slice(0, 7),
    branch: current === DETACHED ? null : current,
    ref: context.ref,
    defaultBranch: defaultBranch(),
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

function extract(audience) {
  const top = repoTop();
  const context = {
    shared: false, ref: HEAD_REF, top, home: os.homedir(), now: Date.now(), committed: new Map(), source: workingTreeSource(top),
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    audience,
    generatedAt: parse.localIso(new Date()),
    repo: { name: path.basename(top) },
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
  fs.writeFileSync(out, text);
  console.log(`written ${out} ${Buffer.byteLength(text)} bytes`);
}

function main() {
  const args = parse.parseArguments(process.argv.slice(2), OPTIONS, stop);
  const state = gitState();
  if (state !== GIT_OK) stop(state === GIT_NO_COMMITS ? 'the repository has no commit yet' : 'this folder is not inside a git repository');
  // SKILL.md passes --data-dir on every command (Global Constraint 10); only a
  // state option makes the command a state command.
  if (args.flags.has('--state-dir') || args.flags.has('--config') || args['--config-set'] !== undefined) {
    stateCommand(args);
    return;
  }
  const audience = args['--audience'];
  if (audience !== AUDIENCE.private) stop('--audience must be private');
  const out = args['--out'];
  if (out && parse.isInside(out, repoTop())) stop(`--out ${out} lies inside the repository; write into the session scratchpad folder`);
  writeDocument(extract(audience), out);
}

main();
