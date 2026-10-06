'use strict';
// Shared helpers of the dashboard test suite: result counting, fixture git
// repositories under one temporary folder (removed at exit), and runners for
// the scripts under test. Git never reads the user's configuration and never
// finds a repository above the temporary folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(REPO, 'skills', 'dashboard', 'scripts');
const GIT_RUNS = path.join(REPO, 'skills', 'pickup', 'scripts', 'git-runs.js');
// Fixture commits use fixed past dates, so no case depends on the time of day.
const OLD_DATE = '2026-01-09T12:00:00';
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-')));
const HOME = path.join(ROOT, 'home');
fs.mkdirSync(HOME);
const ENV = Object.assign({}, process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CEILING_DIRECTORIES: ROOT,
  HOME,
});
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

let passed = 0;
let failed = 0;
let finished = false;

function check(desc, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS: ${desc}`);
  } else {
    failed += 1;
    console.log(`  FAIL: ${desc}${detail ? ` (${detail})` : ''}`);
  }
}

function eq(desc, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(desc, a === e, `expected ${e}, got ${a}`);
}

function finish() {
  finished = true;
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

// A test file that ends without calling finish() (an early return, or an
// awaited promise that never settles) fails: Node uses the exit code that an
// 'exit' listener sets.
process.on('exit', () => {
  if (finished) return;
  console.log('  FAIL: finish() was never called');
  process.exitCode = 1;
});

// Runs git in <dir>; throws on failure. <date> sets both commit dates.
function gitIn(dir, args, date) {
  const env = date ? Object.assign({}, ENV, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) : ENV;
  const result = spawnSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function git(dir, ...args) {
  return gitIn(dir, args);
}

// An empty repository whose unborn branch is <branch>.
function repo(name, branch = 'main') {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  return dir;
}

// A bare repository used as the remote "origin" of <dir>.
function addRemote(dir, name) {
  const bare = path.join(ROOT, `${name}.git`);
  spawnSync('git', ['init', '-q', '--bare', bare], { env: ENV });
  git(dir, 'remote', 'add', 'origin', bare);
  return bare;
}

function write(dir, rel, text) {
  const file = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// Adds <files> and commits them with <subject> at <date>.
function commit(dir, subject, files, date = OLD_DATE) {
  git(dir, 'add', '--', ...files);
  gitIn(dir, ['commit', '-q', '-m', subject], date);
  return git(dir, 'rev-parse', 'HEAD');
}

// Runs a Node script (or "-e" code) in <cwd> with the fixture environment.
function node(cwd, args, extraEnv) {
  const result = spawnSync(process.execPath, args, { cwd, env: Object.assign({}, ENV, extraEnv || {}), encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function script(name) {
  return path.join(SCRIPTS, name);
}

// scanRuns(<options>) of git-runs.js, run inside <dir>. The result is the
// list of runs; its "errors" property (a list of { command, message }) is
// returned as the "errors" property of the parsed list too.
function scan(dir, options) {
  const code = `const runs = require(${JSON.stringify(GIT_RUNS)}).scanRuns(JSON.parse(process.argv[1])); console.log(JSON.stringify({ runs, errors: runs.errors }))`;
  const result = node(dir, ['-e', code, JSON.stringify(options)]);
  if (result.code !== 0) throw new Error(result.err);
  const parsed = JSON.parse(result.out);
  parsed.runs.errors = parsed.errors;
  return parsed.runs;
}

// A orchestration log of <slug> with <headings> after its title line.
function runLog(slug, headings) {
  return [`# Orchestration Log — ${slug}`, '', ...headings, ''].join('\n');
}

function logPath(date, slug) {
  return `docs/superpowers-orchestrator/${date}-${slug}/${slug}-orchestration-log.md`;
}

// The versions file of a proposal folder: "<folder>-versions.txt", next to
// the folder, as the dashboard skill places it.
function versionsFile(folder) {
  return `${folder}-versions.txt`;
}

// Writes one proposal as ArtifactData query with out_dir saves it: the file
// <folder>/proposals/<id>.json holds the document body only, with no id and
// no version (platform check 9). <body> is a document, or a raw text for a
// file that is not valid JSON. The version goes to the versions file as the
// line "<id> <version>", the line that the skill copies from the query's
// result text.
function proposalFile(folder, id, body, version) {
  const file = path.join(folder, 'proposals', `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  fs.appendFileSync(versionsFile(folder), `${id} ${version}\n`);
  return file;
}

module.exports = {
  REPO, SCRIPTS, GIT_RUNS, OLD_DATE, ROOT, HOME, ENV,
  check, eq, finish, git, gitIn, repo, addRemote, write, commit, node, script, scan, runLog, logPath,
  proposalFile, versionsFile,
};
