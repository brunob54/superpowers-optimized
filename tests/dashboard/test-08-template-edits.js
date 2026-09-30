'use strict';
// skills/dashboard/template.html, the edits: the write rules of spec section
// 7, the labels, the controls, submitted edits, the owner check at boot, the
// adapter's write path, and the parity of the page's copy of the note and
// status rules with dashboard-parse.js.
const path = require('path');
const h = require('./helpers');
const { fakeDocument, load, settle } = require('./fake-page');
const parse = require(path.join(h.SCRIPTS, 'dashboard-parse.js'));

const BUILT = '2026-09-29T20:40:00+02:00';
const EARLIER = '2026-09-29T18:00:00+02:00';
const LATER = '2026-09-29T21:00:00+02:00';
const NOW = '2026-09-30T00:30:00+02:00';
const OPEN_ID = 'o'.repeat(40);
const PART_ID = 'p'.repeat(40);
const PART_LINE = '| 2 | b | in progress | | | |';
const PROPOSALS = 'proposals';
const app = load(fakeDocument('private')).DashboardApp;
const edit = { base: { kind: 'set-part', file: 'docs/worklogs/w.md' }, fields: { status: 'done' } };
const existing = (state, closedAt) => ({ doc: { kind: 'set-part', state, closedAt, note: 'kept' } });

// A runtime object with the calls that createStore and ownerState use, in the
// form of the `## Runtime record` of platform-checks.md: `claude.use(name)`
// resolves the `user` or `db` namespace; a page snapshot carries no version.
// <reread> maps an id to the document that the single-document read finds;
// an id with no entry is read as absent.
function fakeRuntime(owner, docs, writes, reread) {
  const found = reread || {};
  const collection = {
    get: async () => ({ docs: docs.map((entry) => ({ id: entry.id, exists: true, data: () => entry.doc })) }),
    doc: (id) => ({
      get: async () => ({ id, exists: found[id] !== undefined, data: () => found[id] }),
      set: async (doc) => { writes.push({ id, doc }); },
    }),
  };
  const db = {
    collection: (name) => {
      if (name !== PROPOSALS) throw new Error(`unexpected collection ${name}`);
      return collection;
    },
  };
  const namespaces = { user: { isOwner: async () => owner }, db };
  return { use: async (name) => namespaces[name] || null };
}

// 1. planWrite.
let plan = app.planWrite(undefined, edit, BUILT, NOW);
h.eq('no document: a new pending document', [plan.action, plan.doc.state, plan.doc.closedAt, plan.doc.createdAt, plan.doc.status], ['write', 'pending', null, NOW, 'done']);
plan = app.planWrite(existing('rejected', LATER), edit, BUILT, NOW);
h.eq('a rejected document: a new document with this edit only', [plan.action, plan.doc.state, plan.doc.note], ['write', 'pending', undefined]);
plan = app.planWrite(existing('applied', EARLIER), edit, BUILT, NOW);
h.eq('applied before the page was built: a new document', [plan.action, plan.doc.state, plan.doc.note], ['write', 'pending', undefined]);
plan = app.planWrite(existing('pending', null), edit, BUILT, NOW);
h.eq('a pending document: fields merged, createdAt moved', [plan.action, plan.doc.status, plan.doc.note, plan.doc.createdAt], ['write', 'done', 'kept', NOW]);
h.eq('an applying document: refused', app.planWrite(existing('applying', null), edit, BUILT, NOW).action, 'refuse');
h.eq('applied after the page was built: refused', app.planWrite(existing('applied', LATER), edit, BUILT, NOW).action, 'refuse');
h.eq('times are compared as instants, not as text', app.planWrite(existing('applied', '2026-09-29T19:00:00+00:00'), edit, BUILT, NOW).action, 'refuse');

// 2. Labels, no-op edits, notes.
h.eq('labels', [
  app.proposalLabel(undefined, BUILT), app.proposalLabel(existing('pending', null), BUILT), app.proposalLabel(existing('applying', null), BUILT),
  app.proposalLabel(existing('applied', LATER), BUILT), app.proposalLabel(existing('rejected', LATER), BUILT), app.proposalLabel(existing('rejected', EARLIER), BUILT),
], ['', 'pending sync', 'sync in progress', 'applied — refresh to update', 'rejected', '']);
const part = { kind: 'part', status: 'in progress', note: 'n' };
h.eq('changesSomething', [app.changesSomething(part, { status: 'in progress' }), app.changesSomething(part, { note: 'n' }), app.changesSomething(part, { status: 'done' }), app.changesSomething({ kind: 'open-item' }, {})], [false, false, true, true]);
h.eq('noteProblem', [app.noteProblem('fine'), app.noteProblem('a|b') !== null, app.noteProblem('[x]') !== null, app.noteProblem('x'.repeat(201)) !== null], [null, true, true, true]);

// 3. Controls.
const source = (file, heading, line) => ({ file, heading, headingOrdinal: 1, line, occurrence: 1, lineNumber: 5 });
function data(branch, partStatus) {
  return {
    schemaVersion: 1, audience: 'private', generatedAt: BUILT, repo: { name: 'r' },
    commit: { sha: 'c'.repeat(40), short: 'ccccccc', branch, ref: 'HEAD', defaultBranch: 'main' },
    sections: {
      activeWorklogs: { status: 'ok', note: '', items: [{ id: PART_ID, visibility: 'tracked', source: source('docs/worklogs/w.md', '## Parts', PART_LINE), kind: 'part', worklog: 'w', number: '2', part: 'b', status: partStatus || 'in progress', since: '', commit: '', note: '' }] },
      sessionOpenItems: { status: 'ok', note: '', items: [{ id: OPEN_ID, visibility: 'private', source: source('session-log.md', '## E', '- fix x'), kind: 'open-item', text: 'fix x', continuation: [] }] },
      commits: { status: 'ok', note: '', items: [{ id: 'k'.repeat(40), visibility: 'tracked', source: source(null, null, null), kind: 'commit', sha: 'd'.repeat(40), short: 'ddddddd', date: '2026-01-01', subject: 's' }] },
    },
  };
}
const buttons = (doc) => doc.created.filter((node) => node.tagName === 'BUTTON' && node.listeners.click);
const nodes = (doc, tag) => doc.created.filter((node) => node.tagName === tag);
const messages = (doc) => doc.created.filter((node) => node.getAttribute('role') === 'status').map((node) => node.textContent).filter(Boolean);
function render(branch, canEdit, store, proposals, partStatus) {
  const doc = fakeDocument('private');
  load(doc).DashboardApp.renderPage({ data: data(branch, partStatus), canEdit, store, proposals: proposals || new Map() });
  return doc;
}
// Sets the fake status list to the option that the page marked selected, as
// a browser does: a <select> always has the value of its selected option.
function browserSelect(doc) {
  const select = nodes(doc, 'SELECT')[0];
  select.value = select.children.find((option) => option.selected).value;
  return select;
}
// A store that lists nothing: the Contract allows no control without a store.
const idleStore = { list: async () => new Map(), write: async () => {} };
h.eq('no control when editing is off', buttons(render('main', false, null)).length, 0);
h.eq('controls on the part and the open item only', buttons(render('main', true, idleStore)).map((b) => b.textContent), ['Propose change', 'Mark resolved']);
h.eq('a detached HEAD: no part control', buttons(render(null, true, idleStore)).map((b) => b.textContent), ['Mark resolved']);
const busy = render('main', true, idleStore, new Map([[OPEN_ID, { doc: { state: 'applying', closedAt: null } }]]));
h.eq('an applying proposal: its label and no control', [buttons(busy).map((b) => b.textContent), nodes(busy, 'SPAN').some((n) => n.textContent === 'sync in progress')], [['Propose change'], true]);
const dropped = browserSelect(render('main', true, idleStore, null, 'dropped'));
h.eq('a status outside the list: a "(current)" option that sets no status', [dropped.value, dropped.children[0].textContent, dropped.children.length], ['', 'dropped (current)', 4]);

(async () => {
  // 4. Submitted edits.
  const writes = [];
  const store = { list: async () => new Map(), write: async (id, doc, listed, generatedAt) => { writes.push({ id, doc, listed, generatedAt }); } };
  let doc = render('main', true, store);
  nodes(doc, 'SELECT')[0].value = 'done';
  nodes(doc, 'INPUT')[0].value = 'finished';
  buttons(doc)[0].listeners.click();
  await settle();
  const first = writes[0] || { doc: { anchor: {} } };
  h.eq('a part edit writes one pending set-part proposal', [writes.length, first.id, first.listed, first.generatedAt, first.doc.kind, first.doc.status, first.doc.note, first.doc.state, first.doc.branch, first.doc.file, first.doc.anchor.part, first.doc.anchor.line], [1, PART_ID, undefined, BUILT, 'set-part', 'done', 'finished', 'pending', 'main', 'docs/worklogs/w.md', '2', PART_LINE]);
  h.check('createdAt is local time with its offset', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(first.doc.createdAt || ''));
  doc = render('main', true, store);
  buttons(doc)[1].listeners.click();
  await settle();
  const second = writes[1] || { doc: { anchor: {} } };
  h.eq('a resolve edit with no note', [second.doc.kind, second.doc.note, second.doc.anchor.occurrence, second.doc.baseCommit], ['resolve-open-item', undefined, 1, 'c'.repeat(40)]);
  doc = render('main', true, store);
  nodes(doc, 'INPUT')[1].value = 'a | b';
  buttons(doc)[1].listeners.click();
  await settle();
  h.eq('a note with | is not written', writes.length, 2);
  doc = render('main', true, store);
  nodes(doc, 'SELECT')[0].value = 'in progress';
  buttons(doc)[0].listeners.click();
  await settle();
  h.eq('an edit that changes nothing is not written', writes.length, 2);

  // A note-only edit sends no status: the list starts at the pending status.
  const pendingDone = { doc: { kind: 'set-part', state: 'pending', closedAt: null, createdAt: EARLIER, status: 'done' } };
  doc = render('main', true, store, new Map([[PART_ID, pendingDone]]));
  h.eq('the status list starts at the pending status', browserSelect(doc).value, 'done');
  nodes(doc, 'INPUT')[0].value = 'added a note';
  buttons(doc)[0].listeners.click();
  await settle();
  const noteOnPending = writes[2] || { doc: {} };
  h.eq('a note-only edit keeps the pending status', [writes.length, noteOnPending.doc.status, noteOnPending.doc.note], [3, 'done', 'added a note']);
  doc = render('main', true, store, null, 'dropped');
  browserSelect(doc);
  nodes(doc, 'INPUT')[0].value = 'why';
  buttons(doc)[0].listeners.click();
  await settle();
  const noteOnDropped = writes[3] || { doc: {} };
  h.eq('a note-only edit on a dropped part writes no status', [writes.length, 'status' in noteOnDropped.doc, noteOnDropped.doc.note], [4, false, 'why']);

  // The item's controls are disabled while its write runs.
  let refuse;
  const slowStore = { list: async () => new Map(), write: () => new Promise((resolve, reject) => { refuse = reject; }) };
  doc = render('main', true, slowStore);
  const controls = () => [nodes(doc, 'SELECT')[0], nodes(doc, 'INPUT')[0], buttons(doc)[0]].map((node) => node.disabled === true);
  nodes(doc, 'SELECT')[0].value = 'done';
  buttons(doc)[0].listeners.click();
  await settle();
  h.eq('the controls are disabled while the write runs', controls(), [true, true, true]);
  refuse(new Error('boom'));
  await settle();
  h.eq('a refused write enables the controls again and says "not saved"', [controls(), messages(doc)], [[false, false, false], ['not saved: boom — reload the page and try again']]);
  const listFails = { list: async () => { throw new Error('offline'); }, write: async () => {} };
  doc = render('main', true, listFails);
  buttons(doc)[1].listeners.click();
  await settle();
  h.eq('a saved write whose list fails says it was saved', messages(doc), ['saved, but the proposals could not be read again: offline — reload the page']);

  // 5. Boot: the owner check and the store.
  async function boot(runtime) {
    const bootDoc = fakeDocument('private', JSON.stringify(data('main')));
    load(bootDoc, { DASHBOARD_NO_BOOT: false, claude: runtime });
    await settle();
    return bootDoc;
  }
  const rendered = (bootDoc) => bootDoc.getElementById('panel-waits').children.length > 0;
  const owner = await boot(fakeRuntime(true, [{ id: OPEN_ID, doc: { state: 'pending', closedAt: null } }], []));
  h.eq('the owner gets the controls and the pending label', [buttons(owner).length, nodes(owner, 'SPAN').some((n) => n.textContent === 'pending sync'), owner.getElementById('viewer-warning').hidden], [2, true, true]);
  const viewer = await boot(fakeRuntime(false, [], []));
  h.eq('another viewer gets the warning and no control', [viewer.getElementById('viewer-warning').hidden, buttons(viewer).length], [false, 0]);
  const noUser = await boot({ use: async () => null });
  h.eq('no user namespace: the warning and no control', [noUser.getElementById('viewer-warning').hidden, buttons(noUser).length], [false, 0]);
  const truthy = await boot(fakeRuntime('no', [], []));
  h.eq('an owner check that does not resolve true: no control', buttons(truthy).length, 0);
  const localFile = fakeDocument('private', JSON.stringify(data('main')));
  load(localFile, { DASHBOARD_NO_BOOT: false });
  await settle();
  h.eq('no runtime (the local file): no control and no warning', [buttons(localFile).length, localFile.getElementById('viewer-warning').hidden], [0, true]);
  const throwing = await boot({ use: async () => { throw new Error('no capability'); } });
  h.eq('a runtime that throws: the page renders, no control, no warning', [rendered(throwing), buttons(throwing).length, throwing.getElementById('viewer-warning').hidden], [true, 0, true]);
  const noDb = await boot({ use: async (name) => (name === 'user' ? { isOwner: async () => true } : null) });
  h.eq('an owner without a db namespace: the page renders, an error, no control', [rendered(noDb), noDb.getElementById('load-error').hidden, buttons(noDb).length], [true, false, 0]);
  h.eq('createStore and ownerState without a runtime', [app.createStore(undefined), await app.ownerState(undefined)], [null, null]);

  // 6. The adapter's own write path, with the runtime calls of fakeRuntime.
  // The page of the record sees no version and the record names no pinned
  // page write (platform check 12), so write re-reads the document.
  const LISTED = { doc: { kind: 'set-part', state: 'pending', closedAt: null, createdAt: EARLIER, note: 'kept' } };
  const CHANGED = 'changed since the page read it';
  const BLOCKED = 'a sync is applying this item, or applied it after the page was built';
  const reread = (fields) => Object.assign({}, LISTED.doc, fields);
  // Writes one document through the adapter. <found> is the document that the
  // re-read finds, or undefined for none. Gives [number of runtime writes,
  // message of the refusal or null].
  async function adapterWrite(listed, found) {
    const runtimeWrites = [];
    const adapter = app.createStore(fakeRuntime(true, [], runtimeWrites, { [PART_ID]: found }));
    try {
      await adapter.write(PART_ID, { state: 'pending' }, listed, BUILT);
      return [runtimeWrites.length, null];
    } catch (error) {
      return [runtimeWrites.length, error.message];
    }
  }
  h.eq('an unchanged re-read: written', await adapterWrite(LISTED, reread({})), [1, null]);
  h.eq('a new document whose re-read finds none: written', await adapterWrite(undefined, undefined), [1, null]);
  for (const [field, fields] of [['createdAt', { createdAt: LATER }], ['state', { state: 'rejected' }], ['closedAt', { closedAt: LATER }]]) {
    h.eq(`a re-read whose ${field} differs: refused`, await adapterWrite(LISTED, reread(fields)), [0, CHANGED]);
  }
  h.eq('a re-read that finds none for a listed document: refused', await adapterWrite(LISTED, undefined), [0, CHANGED]);
  h.eq('a re-read that finds an applying document: refused', await adapterWrite(LISTED, reread({ state: 'applying' })), [0, BLOCKED]);
  h.eq('a re-read that finds a document applied after the page was built: refused', await adapterWrite(LISTED, reread({ state: 'applied', closedAt: LATER })), [0, BLOCKED]);
  h.eq('a new document whose re-read finds one: refused', await adapterWrite(undefined, LISTED.doc), [0, CHANGED]);
  h.eq('a listed entry that carries a version is still re-read', await adapterWrite({ doc: LISTED.doc, version: 4 }, reread({ state: 'applying' })), [0, BLOCKED]);
  const listedRuntime = app.createStore(fakeRuntime(true, [{ id: OPEN_ID, doc: LISTED.doc }], []));
  h.eq('list gives each document by its id', Array.from((await listedRuntime.list()).entries()), [[OPEN_ID, { doc: LISTED.doc }]]);

  // 7. Parity of the page's copy with dashboard-parse.js (ruling [task 3/1]).
  h.eq('parity: the part statuses', Array.from(app.PART_STATUSES), parse.PART_STATUSES);
  h.eq('parity: the note limit', app.NOTE_LIMIT, parse.NOTE_LIMIT);
  h.eq('parity: the note rule', [app.NOTE_FORBIDDEN.source, app.NOTE_FORBIDDEN.flags], [parse.NOTE_FORBIDDEN.source, parse.NOTE_FORBIDDEN.flags]);
  const dates = [new Date(2026, 0, 2, 3, 4, 5), new Date(2026, 6, 15, 23, 59, 59), new Date(0)];
  h.eq('parity: localIso', dates.map((date) => app.localIso(date)), dates.map((date) => parse.localIso(date)));
  h.finish();
})();
