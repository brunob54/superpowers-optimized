#!/usr/bin/env node
/**
 * Unit tests — every file that states the plugin version states the same one
 *
 * A release writes the version into eight places: the ones that the
 * `CLAUDE.md` section "Releases" lists. The v7.43.0 release commit wrote an EMPTY `VERSION`
 * file, and every suite passed. `versionProblems(root)` reads each place under
 * `root` and returns one sentence per place that does not hold the version of
 * `.claude-plugin/plugin.json`. The tests run it on this repository, and on
 * copies with one place damaged, so the check is seen to catch each damage.
 *
 * Run: node tests/codex/test-version-files.js
 * No dependencies beyond Node.js stdlib.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const VERSION_FILE = 'VERSION';
const PLUGIN_JSON = path.join('.claude-plugin', 'plugin.json');
const MARKETPLACE_JSON = path.join('.claude-plugin', 'marketplace.json');
const UNIVERSAL_YAML = 'plugin.universal.yaml';
const README = 'README.md';
const RELEASE_NOTES = 'RELEASE-NOTES.md';
const VERSION_SHAPE = '\\d+\\.\\d+\\.\\d+';
const FIRST_FORK_VERSION = 'v6.7.0';
const README_RANGE_COUNT = 2;

// Each place: a label, its file, and a function from the file text to the list
// of version strings found there. An empty list means "no version found".
const matches = (pattern) => (text) => Array.from(text.matchAll(pattern), (m) => m[1]);
const firstMatch = (pattern) => (text) => matches(pattern)(text).slice(0, 1);
const PLACES = [
  // Only one line end is removed (a Windows line end counts as one): a second
  // line, also an empty one, is not part of the version.
  { label: 'the VERSION file', file: VERSION_FILE, read: (text) => [text.replace(/\r?\n$/, '')] },
  { label: 'marketplace.json, first plugin', file: MARKETPLACE_JSON, read: (text) => [JSON.parse(text).plugins[0].version] },
  { label: 'plugin.universal.yaml, meta', file: UNIVERSAL_YAML, read: firstMatch(new RegExp(`^  version: "(${VERSION_SHAPE})"$`, 'gm')) },
  { label: 'the README badge', file: README, read: matches(new RegExp(`badge/version-(${VERSION_SHAPE})-`, 'g')) },
  { label: 'the README release ranges', file: README, count: README_RANGE_COUNT, read: matches(new RegExp(`${FIRST_FORK_VERSION}–v(${VERSION_SHAPE})`, 'g')) },
  { label: 'the first RELEASE-NOTES.md heading', file: RELEASE_NOTES, read: firstMatch(new RegExp(`^## v(${VERSION_SHAPE})`, 'gm')) },
];

function versionProblems(root) {
  const readText = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const expected = JSON.parse(readText(PLUGIN_JSON)).version;
  if (!new RegExp(`^${VERSION_SHAPE}$`).test(String(expected))) {
    return [`${PLUGIN_JSON} holds no version of the form X.Y.Z: "${expected}"`];
  }
  const problems = [];
  for (const place of PLACES) {
    const found = place.read(readText(place.file));
    const wanted = place.count || 1;
    if (found.length !== wanted || found.some((version) => version !== expected)) {
      problems.push(`${place.label} (${place.file}): expected ${wanted} x "${expected}", found ${JSON.stringify(found)}`);
    }
  }
  return problems;
}

const WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'version-files-'));
process.on('exit', () => fs.rmSync(WORK_ROOT, { recursive: true, force: true }));

let passed = 0;
let failed = 0;
let folderCount = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// A copy of the version-bearing files, with `file` rewritten by `damage`.
function damagedCopy(file, damage) {
  const root = path.join(WORK_ROOT, `copy-${++folderCount}`);
  for (const name of new Set([PLUGIN_JSON, ...PLACES.map((place) => place.file)])) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const text = fs.readFileSync(path.join(REPO_ROOT, name), 'utf8');
    fs.writeFileSync(target, name === file ? damage(text) : text);
  }
  return root;
}

function assertOneProblem(root, label) {
  const problems = versionProblems(root);
  assert.strictEqual(problems.length, 1, `expected one problem, found: ${JSON.stringify(problems)}`);
  assert.ok(problems[0].startsWith(label), `the problem names another place: ${problems[0]}`);
}

const CURRENT = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, PLUGIN_JSON), 'utf8')).version;
const OTHER_VERSION = '0.0.1';
const withOtherVersion = (text) => text.split(CURRENT).join(OTHER_VERSION);

console.log('version files');

test('every place in this repository holds the version of plugin.json', () => {
  assert.deepStrictEqual(versionProblems(REPO_ROOT), []);
});

test('an unchanged copy has no problem', () => {
  assert.deepStrictEqual(versionProblems(damagedCopy(null, null)), []);
});

test('an empty VERSION file is reported (the v7.43.0 release commit)', () => {
  assertOneProblem(damagedCopy(VERSION_FILE, () => ''), 'the VERSION file');
});

test('a VERSION file with a second line of white space is reported', () => {
  assertOneProblem(damagedCopy(VERSION_FILE, (text) => `${text} \n`), 'the VERSION file');
});

test('another version in marketplace.json is reported', () => {
  assertOneProblem(damagedCopy(MARKETPLACE_JSON, withOtherVersion), 'marketplace.json');
});

test('another version in plugin.universal.yaml is reported', () => {
  assertOneProblem(damagedCopy(UNIVERSAL_YAML, withOtherVersion), 'plugin.universal.yaml');
});

test('a RELEASE-NOTES.md without an entry for the version is reported', () => {
  assertOneProblem(damagedCopy(RELEASE_NOTES, withOtherVersion), 'the first RELEASE-NOTES.md heading');
});

test('a README with another version is reported for the badge and the ranges', () => {
  const problems = versionProblems(damagedCopy(README, withOtherVersion));
  assert.strictEqual(problems.length, 2, JSON.stringify(problems));
});

test('a README with one release range left at the old version is reported', () => {
  const oldRange = `${FIRST_FORK_VERSION}–v${CURRENT}`;
  const root = damagedCopy(README, (text) => text.replace(oldRange, `${FIRST_FORK_VERSION}–v${OTHER_VERSION}`));
  assertOneProblem(root, 'the README release ranges');
});

test('a plugin.json without a version is reported', () => {
  const problems = versionProblems(damagedCopy(PLUGIN_JSON, () => '{}'));
  assert.strictEqual(problems.length, 1, JSON.stringify(problems));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
