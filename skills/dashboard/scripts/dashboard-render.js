#!/usr/bin/env node
// Renders the dashboard page files from one extractor JSON document, checks
// them before a publish, and prints the change summary of a refresh.
// Usage:
//   node dashboard-render.js --audience private|shared --in <json> --out <dir>
//   node dashboard-render.js --local --in <json> --out <dir>
//   node dashboard-render.js --verify <dir> --audience private|shared
//   node dashboard-render.js --diff <previous json> --in <json>
// A published page is two files: index.html (the template, no data) and
// dashboard-data.json. The local file is one file, dashboard.html, with the
// data inside it, because a browser blocks a file:// page from reading the
// files next to it. Exit status: 0 on success; 1 when --verify refuses; 2
// when the command cannot run (a bad argument, an audience that does not
// match, an output folder inside the repository).
'use strict';

const fs = require('fs');
const path = require('path');
const { git } = require('../../pickup/scripts/git-runs');
const parse = require('./dashboard-parse');

const EXIT_REFUSED = 1;
const EXIT_STOP = 2;
const TEMPLATE = path.join(__dirname, '..', 'template.html');
const PAGE_FILE = 'index.html';
const DATA_FILE = 'dashboard-data.json';
const LOCAL_FILE = 'dashboard.html';
const PLACEHOLDER = { audience: '__DASHBOARD_AUDIENCE__', title: '__DASHBOARD_TITLE__', state: '<!--__DASHBOARD_STATE__-->' };
const AUDIENCE = { private: 'private', shared: 'shared' };
const TITLE_SUFFIX = { private: 'dashboard — PRIVATE', shared: 'dashboard — shared' };
const TRACKED = 'tracked';
const STATE_MARKER = 'id="dashboard-state"';
const AUDIENCE_META = /<meta name="dashboard-audience" content="([^"]*)">/;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// --data-dir is accepted and not read: SKILL.md writes it on every script
// command (Global Constraint 10).
const OPTIONS = { values: ['--audience', '--in', '--out', '--verify', '--diff', '--data-dir'], flags: ['--local'] };
const NO_SECTION = { status: 'absent', items: [] };

function stop(message) {
  process.stderr.write(`dashboard-render: ${message}\n`);
  process.exit(EXIT_STOP);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return stop(`${file}: ${error.message}`);
  }
}

function audienceOrStop(value) {
  if (!Object.values(AUDIENCE).includes(value)) stop('--audience must be private or shared');
  return value;
}

// split and join replace every occurrence and never read "$" patterns.
const replaceAll = (text, from, to) => text.split(from).join(to);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// The template with its three placeholders filled. The audience is replaced
// first and the escaped title second, so no value can form a placeholder.
function page(doc, audience, stateBlock) {
  const title = escapeHtml(`${doc.repo.name} ${TITLE_SUFFIX[audience]}`);
  let html = fs.readFileSync(TEMPLATE, 'utf8');
  html = replaceAll(html, PLACEHOLDER.audience, audience);
  html = replaceAll(html, PLACEHOLDER.title, title);
  return replaceAll(html, PLACEHOLDER.state, stateBlock);
}

// Every "<" is written as \u003c, so a "</script>" inside a value cannot end
// the block.
function inlineState(doc) {
  return `<script type="application/json" ${STATE_MARKER}>${JSON.stringify(doc).replace(/</g, '\\u003c')}</script>`;
}

// The items of one section that are not tracked. The shared filter and
// --verify both use it, so the two guards cannot disagree.
function untrackedItems(section) {
  return ((section && section.items) || []).filter((item) => !item || item.visibility !== TRACKED);
}

// The second guard of the shared page: only tracked items are kept.
function trackedOnly(doc) {
  const sections = {};
  for (const [id, section] of Object.entries(doc.sections)) {
    const dropped = new Set(untrackedItems(section));
    sections[id] = Object.assign({}, section, { items: section.items.filter((item) => !dropped.has(item)) });
  }
  return Object.assign({}, doc, { sections });
}

function checkOut(out) {
  if (!out) stop('--out <dir> is needed');
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.ok && parse.isInside(out, top.out)) stop(`--out ${out} lies inside the repository; write into the session scratchpad folder`);
}

// Stops when an output file name in <dir> is a symbolic link: a write would
// follow the link and change the file it points to.
function refuseLinks(dir, names) {
  for (const name of names) {
    const file = path.join(dir, name);
    const entry = fs.lstatSync(file, { throwIfNoEntry: false });
    if (entry && entry.isSymbolicLink()) stop(`${file} is a symbolic link`);
  }
}

function writeFile(dir, name, text) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  console.log(`written ${file} ${Buffer.byteLength(text)} bytes`);
}

function renderPage(args) {
  const audience = audienceOrStop(args['--audience']);
  const doc = readJson(args['--in']);
  if (doc.audience !== audience) stop(`the JSON is for the ${doc.audience} audience, not ${audience}`);
  const data = audience === AUDIENCE.shared ? trackedOnly(doc) : doc;
  refuseLinks(args['--out'], [PAGE_FILE, DATA_FILE]);
  writeFile(args['--out'], PAGE_FILE, page(data, audience, ''));
  writeFile(args['--out'], DATA_FILE, `${JSON.stringify(data, null, 2)}\n`);
}

function renderLocal(args) {
  const doc = readJson(args['--in']);
  if (doc.audience !== AUDIENCE.private) stop('--local renders the private audience only');
  refuseLinks(args['--out'], [LOCAL_FILE]);
  writeFile(args['--out'], LOCAL_FILE, page(doc, AUDIENCE.private, inlineState(doc)));
}

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    return null;
  }
}

function verify(dir, audience) {
  const reasons = [];
  const html = readOrNull(path.join(dir, PAGE_FILE));
  const dataText = readOrNull(path.join(dir, DATA_FILE));
  let doc = null;
  try {
    doc = dataText === null ? null : JSON.parse(dataText);
  } catch (error) {
    reasons.push(`${DATA_FILE} is not valid JSON`);
  }
  if (html === null) reasons.push(`${PAGE_FILE} is missing`);
  if (dataText === null) reasons.push(`${DATA_FILE} is missing`);
  const meta = html === null ? null : html.match(AUDIENCE_META);
  if (html !== null && html.includes(STATE_MARKER)) reasons.push(`${PAGE_FILE} holds an inline data block`);
  if (html !== null && (!meta || meta[1] !== audience)) reasons.push(`the meta tag names ${meta ? meta[1] : 'no audience'}`);
  if (dataText !== null && (doc === null || typeof doc !== 'object' || Array.isArray(doc))) {
    reasons.push(`${DATA_FILE} is not a JSON object`);
    doc = null;
  }
  if (doc && doc.audience !== audience) reasons.push(`the data is for the ${doc.audience} audience`);
  if (doc && audience === AUDIENCE.shared) {
    const untracked = Object.values(doc.sections || {}).reduce((n, section) => n + untrackedItems(section).length, 0);
    if (untracked) reasons.push(`${untracked} items are not tracked`);
  }
  if (reasons.length) {
    console.log(`refused: ${reasons.join('; ')}`);
    process.exitCode = EXIT_REFUSED;
    return;
  }
  console.log(`verified ${audience}`);
}

function diff(previousFile, doc) {
  if (!fs.existsSync(previousFile)) {
    console.log('first refresh');
    return;
  }
  const previous = readJson(previousFile).sections || {};
  const ids = Array.from(new Set([...Object.keys(doc.sections), ...Object.keys(previous)]));
  const lines = [];
  for (const id of ids) {
    const before = previous[id] || NO_SECTION;
    const after = doc.sections[id] || NO_SECTION;
    const beforeIds = new Set(before.items.map((item) => item.id));
    const afterIds = new Set(after.items.map((item) => item.id));
    const added = [...afterIds].filter((itemId) => !beforeIds.has(itemId)).length;
    const removed = [...beforeIds].filter((itemId) => !afterIds.has(itemId)).length;
    if (added || removed) lines.push(`${id}: ${added} added, ${removed} removed`);
    if (before.status !== after.status) lines.push(`${id}: status ${before.status} → ${after.status}`);
  }
  console.log(lines.length ? lines.join('\n') : 'no change');
}

function main() {
  const args = parse.parseArguments(process.argv.slice(2), OPTIONS, stop);
  if (args['--verify'] !== undefined) {
    verify(args['--verify'], audienceOrStop(args['--audience']));
    return;
  }
  if (!args['--in']) stop('--in <json> is needed');
  if (args['--diff'] !== undefined) {
    diff(args['--diff'], readJson(args['--in']));
    return;
  }
  checkOut(args['--out']);
  if (args.flags.has('--local')) renderLocal(args);
  else renderPage(args);
}

main();
