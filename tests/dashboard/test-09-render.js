'use strict';
// dashboard-render.js: the page files, the local file, --verify, --diff, and
// the privacy cases (1) and (9) of spec section 11 on real extractor output.
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const RENDER = h.script('dashboard-render.js');
const EXTRACT = h.script('dashboard-extract.js');
const MARKER = 'zqxmarker';
const PAYLOAD = '</script><img src=x onerror=alert(1)>';
const render = (cwd, args) => h.node(cwd, [RENDER, ...args]);
const scratch = (name) => path.join(h.ROOT, 'scratch', name);
const read = (file) => fs.readFileSync(file, 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
function writeJson(name, value) {
  const file = scratch(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
const NO_SOURCE = { file: null, heading: null, headingOrdinal: null, line: null, occurrence: null, lineNumber: null };
const commitItem = (id, visibility, subject) => ({ id, visibility, source: NO_SOURCE, kind: 'commit', sha: id, short: 'x', date: '2026-01-01', subject });
function doc(audience, name, sections) {
  return {
    schemaVersion: 1, audience, generatedAt: '2026-09-29T20:40:00+02:00', repo: { name },
    commit: { sha: 'a'.repeat(40), short: 'aaaaaaa', branch: 'main', ref: 'HEAD', defaultBranch: 'main' }, sections,
  };
}

// 1. Page files of the private audience.
const privateDoc = doc('private', 'demo', { commits: { status: 'ok', note: '', items: [commitItem('1', 'tracked', 'one'), commitItem('2', 'private', 'two')] } });
const privateIn = writeJson('private.json', privateDoc);
const privateDir = scratch('private');
const rendered = render(h.ROOT, ['--audience', 'private', '--in', privateIn, '--out', privateDir]);
const html = read(path.join(privateDir, 'index.html'));
h.eq('two written lines', rendered.out.split('\n').filter((line) => line.startsWith('written ')).length, 2);
h.check('the meta tag names the audience', html.includes('<meta name="dashboard-audience" content="private">'));
h.check('the title names the audience', html.includes('<title>demo dashboard — PRIVATE</title>'));
h.check('no placeholder is left and no data is inside the page', !html.includes('__DASHBOARD_') && !html.includes('id="dashboard-state"'));
h.eq('the data file is the JSON', JSON.parse(read(path.join(privateDir, 'dashboard-data.json'))), privateDoc);
const markupName = render(h.ROOT, ['--audience', 'private', '--in', writeJson('markup-name.json', doc('private', 'a<b>&"', {})), '--out', scratch('markup-name')]);
h.check('the repository name is escaped in the title', markupName.code === 0 && read(path.join(scratch('markup-name'), 'index.html')).includes('<title>a&lt;b&gt;&amp;&quot; dashboard — PRIVATE</title>'));

// 2. The shared audience: the second guard.
const sharedDoc = doc('shared', 'demo', { commits: { status: 'ok', note: '', items: [commitItem('1', 'tracked', 'one'), commitItem('2', 'private', MARKER)] } });
const sharedDir = scratch('shared');
render(h.ROOT, ['--audience', 'shared', '--in', writeJson('shared.json', sharedDoc), '--out', sharedDir]);
const sharedData = read(path.join(sharedDir, 'dashboard-data.json'));
h.eq('the renderer drops every item that is not tracked', [sharedData.includes(MARKER), JSON.parse(sharedData).sections.commits.items.length], [false, 1]);
h.check('the shared title', read(path.join(sharedDir, 'index.html')).includes('<title>demo dashboard — shared</title>'));
const mismatch = render(h.ROOT, ['--audience', 'shared', '--in', privateIn, '--out', scratch('mismatch')]);
h.eq('a JSON of another audience stops, no file', [mismatch.code, fs.existsSync(scratch('mismatch'))], [2, false]);

// 3. --verify.
h.eq('verify accepts the private files', render(h.ROOT, ['--verify', privateDir, '--audience', 'private']).out.trim(), 'verified private');
const wrongAudience = render(h.ROOT, ['--verify', privateDir, '--audience', 'shared']);
h.check('(9) verify refuses private files for the shared audience', wrongAudience.code === 1 && wrongAudience.out.startsWith('refused: '));
const tampered = JSON.parse(sharedData);
tampered.sections.commits.items.push(commitItem('3', 'private', 'x'));
fs.writeFileSync(path.join(sharedDir, 'dashboard-data.json'), JSON.stringify(tampered));
h.eq('verify refuses a shared file with a private item', render(h.ROOT, ['--verify', sharedDir, '--audience', 'shared']).code, 1);

// 4. The local file: one inline block that markup cannot end.
const localDoc = doc('private', 'demo', { commits: { status: 'ok', note: '', items: [commitItem('1', 'tracked', PAYLOAD)] }, git: { status: 'ok', note: '', ahead: 0, dirty: 0, items: [{ id: 'b', visibility: 'tracked', source: NO_SOURCE, kind: 'branch', name: `feature/${PAYLOAD}`, date: 'd' }] } });
render(h.ROOT, ['--local', '--in', writeJson('local.json', localDoc), '--out', scratch('local')]);
const local = read(path.join(scratch('local'), 'dashboard.html'));
const block = local.split('<script type="application/json" id="dashboard-state">')[1].split('</script>')[0];
h.eq('the inline block parses back to the JSON', JSON.parse(block), localDoc);
h.eq('one inline block; every script tag is closed once', [count(local, 'id="dashboard-state"'), count(local, '<script') === count(local, '</script>')], [1, true]);
h.check('the markup never appears raw in the file', !local.includes(PAYLOAD) && !block.includes('<'));
h.eq('--local refuses a shared JSON', render(h.ROOT, ['--local', '--in', writeJson('shared-local.json', sharedDoc), '--out', scratch('shared-local')]).code, 2);

// 5. --diff.
h.eq('no previous JSON: first refresh', render(h.ROOT, ['--diff', scratch('none.json'), '--in', privateIn]).out.trim(), 'first refresh');
const before = writeJson('before.json', doc('private', 'demo', { commits: { status: 'ok', note: '', items: [commitItem('a', 'tracked', 'a'), commitItem('b', 'tracked', 'b')] }, git: { status: 'ok', note: '', items: [] } }));
const after = writeJson('after.json', doc('private', 'demo', { commits: { status: 'ok', note: '', items: [commitItem('b', 'tracked', 'b'), commitItem('c', 'tracked', 'c')] }, git: { status: 'error', note: 'x', items: [] } }));
h.eq('added and removed ids, and a changed status', render(h.ROOT, ['--diff', before, '--in', after]).out.trim().split('\n'), ['commits: 1 added, 1 removed', 'git: status ok → error']);
h.eq('identical documents: no change', render(h.ROOT, ['--diff', before, '--in', before]).out.trim(), 'no change');
h.eq('a --data-dir argument is accepted and not read', render(h.ROOT, ['--data-dir', '', '--diff', before, '--in', before]).out.trim(), 'no change');

// 6. Real extractor output: (1) no marker in the shared page files; the output
// folder may not lie inside the repository.
const d = h.repo('render-privacy');
h.addRemote(d, 'render-remote');
h.write(d, 'RELEASE-NOTES.md', '## v1.0.0 — pushed\n');
h.commit(d, 'base', ['RELEASE-NOTES.md']);
h.git(d, 'push', '-q', '-u', 'origin', 'main');
h.write(d, 'session-log.md', `## 2026-01-01 [saved]\nOpen: ${MARKER}\n`);
h.write(d, 'RELEASE-NOTES.md', `## v2.0.0 — ${MARKER}\n## v1.0.0 — pushed\n`);
h.node(d, [EXTRACT, '--audience', 'shared', '--ref', 'origin/main', '--out', scratch('real-shared.json')]);
render(d, ['--audience', 'shared', '--in', scratch('real-shared.json'), '--out', scratch('real-shared')]);
const pageFiles = ['index.html', 'dashboard-data.json'].map((name) => read(path.join(scratch('real-shared'), name)));
h.check('(1) no marker in the shared page files', pageFiles.every((text) => !text.includes(MARKER)) && pageFiles[1].includes('v1.0.0'));
const inside = render(d, ['--audience', 'shared', '--in', scratch('real-shared.json'), '--out', path.join(d, 'page')]);
h.eq('--out inside the repository stops, no file', [inside.code, fs.existsSync(path.join(d, 'page'))], [2, false]);

// 7. Hardening from the security review of this task.
// A letter-case spelling of the repository folder is still inside it (only on
// a case-insensitive file system).
const upper = path.join(path.dirname(d), path.basename(d).toUpperCase(), 'page-case');
if (fs.existsSync(upper.replace('page-case', ''))) {
  const cased = render(d, ['--audience', 'shared', '--in', scratch('real-shared.json'), '--out', upper]);
  h.eq('--out in another letter case stops, no file', [cased.code, fs.existsSync(path.join(d, 'page-case'))], [2, false]);
} else {
  console.log('  NOTE: this file system is case-sensitive; the letter-case case is skipped');
}
// An output file name that is a symbolic link stops the command, no file.
const linkDir = scratch('linked');
const victim = scratch('victim.txt');
fs.mkdirSync(linkDir, { recursive: true });
fs.writeFileSync(victim, 'keep');
let haveLink = true;
try { fs.symlinkSync(victim, path.join(linkDir, 'dashboard-data.json')); } catch (error) { haveLink = false; console.log('  NOTE: this file system refuses a symbolic link; the link case is skipped'); }
if (haveLink) {
  const linked = render(h.ROOT, ['--audience', 'private', '--in', privateIn, '--out', linkDir]);
  h.eq('a symbolic link at an output name stops, nothing written', [linked.code, read(victim), fs.existsSync(path.join(linkDir, 'index.html'))], [2, 'keep', false]);
}
// --verify refuses an inline state block in index.html and a non-object data file.
const inlineDir = scratch('inline');
render(h.ROOT, ['--audience', 'shared', '--in', writeJson('shared2.json', sharedDoc), '--out', inlineDir]);
const inlinePage = path.join(inlineDir, 'index.html');
fs.writeFileSync(inlinePage, read(inlinePage).replace('</body>', '<script type="application/json" id="dashboard-state">{}</script></body>'));
h.eq('verify refuses an index.html with an inline data block', render(h.ROOT, ['--verify', inlineDir, '--audience', 'shared']).code, 1);
for (const value of ['null', '0', '[]']) {
  const dir = scratch(`nonobject-${value.length}${value[0]}`);
  render(h.ROOT, ['--audience', 'shared', '--in', writeJson('shared3.json', sharedDoc), '--out', dir]);
  fs.writeFileSync(path.join(dir, 'dashboard-data.json'), value);
  h.eq(`verify refuses a data file holding ${value}`, render(h.ROOT, ['--verify', dir, '--audience', 'shared']).code, 1);
}

h.finish();
