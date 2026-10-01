'use strict';
// skills/dashboard/template.html, the view: placeholders, the page contract,
// text-only insertion (the fake document throws on innerHTML), tabs, the
// as-of line, the lock sign, the audience check of the inline data.
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const { TEMPLATE, APP, fakeDocument, load, settle } = require('./fake-page');

const PAYLOAD = '</script><img src=x onerror=alert(1)>';
const count = (text, needle) => text.split(needle).length - 1;

const source = (file) => ({ file, heading: null, headingOrdinal: null, line: null, occurrence: null, lineNumber: null });
function sample(audience, branch) {
  return {
    schemaVersion: 1,
    audience,
    generatedAt: '2026-09-29T20:40:00+02:00',
    repo: { name: `repo${PAYLOAD}` },
    commit: { sha: 'a'.repeat(40), short: 'aaaaaaa', branch, ref: 'HEAD', defaultBranch: 'main' },
    sections: {
      git: { status: 'ok', note: '', ahead: 2, dirty: 1, items: [{ id: '1'.repeat(40), visibility: 'tracked', source: source(null), kind: 'branch', name: `feature/${PAYLOAD}`, date: '2026-01-01' }] },
      sessionOpenItems: { status: 'ok', note: '', olderUnresolved: 3, items: [{ id: '2'.repeat(40), visibility: 'private', source: source('session-log.md'), kind: 'open-item', text: PAYLOAD, continuation: [] }] },
      commits: { status: 'ok', note: '', items: [{ id: '3'.repeat(40), visibility: 'tracked', source: source(null), kind: 'commit', sha: 'b'.repeat(40), short: 'bbbbbbb', date: '2026-01-01', subject: PAYLOAD }] },
      knownIssues: { status: 'not-found', note: 'known-issues.md not found', items: [] },
    },
  };
}

// 1. The template file.
h.eq('each placeholder appears exactly once', ['__DASHBOARD_AUDIENCE__', '__DASHBOARD_TITLE__', '<!--__DASHBOARD_STATE__-->'].map((p) => count(TEMPLATE, p)), [1, 1, 1]);
h.check('the audience placeholder is the meta tag', TEMPLATE.includes('<meta name="dashboard-audience" content="__DASHBOARD_AUDIENCE__">'));
h.check('the state placeholder stands before the app script', TEMPLATE.indexOf('<!--__DASHBOARD_STATE__-->') < TEMPLATE.indexOf('<script id="dashboard-app">'));
for (const needle of ['prefers-color-scheme: dark', ':root:not([data-theme="light"])', ':root[data-theme="dark"]', 'body {', 'background: var(--bg)', 'padding: 16px', 'overflow-wrap: anywhere']) {
  h.check(`the page contract: ${needle}`, TEMPLATE.includes(needle));
}
h.check('the private banner text', TEMPLATE.includes('Private page — do not make it public'));
h.check('the two fixed tab ids and labels', TEMPLATE.includes('id="tab-waits"') && TEMPLATE.includes('>Waits for me<') && TEMPLATE.includes('id="tab-history"') && TEMPLATE.includes('>History<'));
for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'DOMParser', 'createContextualFragment', 'srcdoc', 'eval(', 'new Function']) {
  h.check(`the app script does not use ${banned}`, APP.length > 0 && !APP.includes(banned));
}

// 2. Rendering data that holds markup.
const doc = fakeDocument('private');
const app = load(doc).DashboardApp;
app.renderPage({ data: sample('private', 'main'), canEdit: false, proposals: new Map(), store: null });
h.check('no element is created from the text', doc.created.every((node) => !['IMG', 'SCRIPT', 'IFRAME'].includes(node.tagName)));
h.check('the markup is shown as text', doc.getElementById('panel-waits').textContent.includes(PAYLOAD) && doc.getElementById('panel-history').textContent.includes(PAYLOAD));
h.eq('the title line holds the repository name as text', doc.getElementById('page-title').textContent, `repo${PAYLOAD} dashboard`);
h.eq('the as-of line on a branch', doc.getElementById('as-of').textContent, 'as of commit aaaaaaa on branch main, built 2026-09-29 20:40');
h.eq('the as-of line on a detached HEAD', app.asOfLine(sample('private', null)), 'as of commit aaaaaaa (detached HEAD)');
const order = (panel) => doc.getElementById(panel).children.map((card) => card.getAttribute('data-section'));
h.eq('tab 1 sections, in order', order('panel-waits'), ['unfinishedRuns', 'git', 'activeWorklogs', 'sessionOpenItems', 'currentGoal']);
h.eq('tab 2 sections, in order', order('panel-history'), ['releases', 'runHistory', 'closedWorklogs', 'commits', 'sessions', 'knownIssues']);
const locks = doc.created.filter((node) => node.getAttribute('class') === 'lock');
h.eq('one lock sign, on the private item only', locks.length, 1);
// The lines under the title of a section card: [class, text] of each one.
const VIEW = { data: sample('private', 'main'), canEdit: false, proposals: new Map(), store: null };
const sectionLines = (section) => app.renderSection('knownIssues', section, VIEW).children.slice(1).map((line) => [line.getAttribute('class'), line.textContent]);
const emptySection = (status, note) => ({ status, note, items: [] });
const MUTED = 'muted';
const NOTHING_HERE = 'nothing here';
h.eq('an empty section that is ok shows one muted line', sectionLines(emptySection('ok', '')), [[MUTED, NOTHING_HERE]]);
h.eq('a missing source with a note shows the same muted line and the note, with no status word', sectionLines(sample('private', 'main').sections.knownIssues), [[MUTED, `${NOTHING_HERE} (known-issues.md not found)`]]);
h.eq('a missing source without a note shows the muted line only', sectionLines(emptySection('not-found', '')), [[MUTED, NOTHING_HERE]]);
h.eq('an error keeps its status word and the error style', sectionLines(emptySection('error', 'git command failed')), [['status error', 'error: git command failed']]);
// The section that the extractor writes for a missing source is shown that way.
const bare = h.repo('template-missing-source');
h.write(bare, 'file.txt', 'x\n');
h.commit(bare, 'base', ['file.txt']);
const extracted = JSON.parse(h.node(bare, [h.script('dashboard-extract.js'), '--audience', 'private']).out).sections.knownIssues;
h.eq('the extractor\'s section of a missing source is shown as an empty section', sectionLines(extracted), [[MUTED, `${NOTHING_HERE} (${extracted.note})`]]);
h.check('the git counts and the older open items are shown', doc.getElementById('panel-waits').textContent.includes('2 commits not pushed') && doc.getElementById('panel-waits').textContent.includes('3 more unresolved open items in older entries'));

// 3. Boot with inline data: the audience check and the banner.
async function boot(pageAudience, data) {
  const bootDoc = fakeDocument(pageAudience, JSON.stringify(data));
  load(bootDoc, { DASHBOARD_NO_BOOT: false });
  await settle();
  return bootDoc;
}
(async () => {
  const own = await boot('private', sample('private', 'main'));
  h.eq('a private page shows the banner and its sections', [own.getElementById('private-banner').hidden, own.getElementById('panel-waits').children.length], [false, 5]);
  // A click on the History tab shows its panel and hides the other one.
  own.getElementById('tab-history').listeners.click();
  h.eq('a click on the History tab selects it', [own.getElementById('panel-history').hidden, own.getElementById('panel-waits').hidden, own.getElementById('tab-history').getAttribute('aria-selected'), own.getElementById('tab-waits').getAttribute('aria-selected')], [false, true, 'true', 'false']);
  const shared = await boot('shared', sample('shared', 'origin/main'));
  h.eq('a shared page hides the banner', shared.getElementById('private-banner').hidden, true);
  const wrong = await boot('shared', sample('private', 'main'));
  h.eq('data of another audience: an error line and no section', [wrong.getElementById('load-error').hidden, wrong.getElementById('panel-waits').children.length], [false, 0]);
  const wrongPrivate = await boot('private', sample('shared', 'origin/main'));
  h.eq('a private page keeps its banner when the data is refused', [wrongPrivate.getElementById('load-error').hidden, wrongPrivate.getElementById('private-banner').hidden], [false, false]);
  // 4. Boot with no inline block: the data file is fetched from the page's own origin.
  const renderSource = fs.readFileSync(path.join(h.SCRIPTS, 'dashboard-render.js'), 'utf8');
  const dataFile = renderSource.match(/^const DATA_FILE = '([^']+)';/m)[1];
  async function bootFetch(pageAudience, fakeFetch) {
    const fetchDoc = fakeDocument(pageAudience);
    load(fetchDoc, { DASHBOARD_NO_BOOT: false, fetch: fakeFetch });
    await settle();
    return fetchDoc;
  }
  const requested = [];
  const fetched = await bootFetch('private', async (url) => {
    requested.push(url);
    return { ok: true, status: 200, json: async () => sample('private', 'main') };
  });
  h.eq('the page requests the data file that the renderer publishes', requested, [dataFile]);
  h.eq('the fetched data renders its sections', fetched.getElementById('panel-waits').children.length, 5);
  const notFound = await bootFetch('private', async () => ({ ok: false, status: 404, json: async () => ({}) }));
  h.eq('an HTTP error shows the banner with the status and no section', [notFound.getElementById('load-error').hidden, notFound.getElementById('load-error').textContent.includes('The dashboard data could not be loaded') && notFound.getElementById('load-error').textContent.includes('HTTP 404'), notFound.getElementById('panel-waits').children.length], [false, true, 0]);
  h.eq('a private page keeps its banner on an HTTP error', notFound.getElementById('private-banner').hidden, false);
  const badJson = await bootFetch('private', async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));
  h.eq('a JSON parse failure shows the banner', [badJson.getElementById('load-error').hidden, badJson.getElementById('load-error').textContent.includes('The dashboard data could not be loaded'), badJson.getElementById('panel-waits').children.length], [false, true, 0]);
  h.finish();
})();
