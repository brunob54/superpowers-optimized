'use strict';
// The Node work-log rules of dashboard-parse.js against the check command and
// the listing command copied out of skills/worklog/SKILL.md, on the same
// fixture files. A difference fails.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./helpers');
const p = require(h.script('dashboard-parse.js'));

const SKILL = path.join(h.REPO, 'skills', 'worklog', 'SKILL.md');
const FENCE_OPEN = '```bash';
const FENCE_CLOSE = '```';

// The lines of the first bash block after the line <heading>.
function blockAfter(heading) {
  const lines = fs.readFileSync(SKILL, 'utf8').split('\n');
  const start = lines.indexOf(heading);
  const open = lines.indexOf(FENCE_OPEN, start);
  const close = lines.indexOf(FENCE_CLOSE, open + 1);
  return start === -1 || open === -1 || close === -1 ? '' : lines.slice(open + 1, close).join('\n');
}

const CHECK = blockAfter('### The check command');
const LISTING = blockAfter('### The listing command');
h.check('the skill text holds the check command', CHECK.includes('<slug>'));
h.check('the skill text holds the listing command', LISTING.includes('invalid file name'));

const bash = (dir, command) => spawnSync('bash', ['-c', command], { cwd: dir, env: h.ENV, encoding: 'utf8' }).stdout;

const d = h.repo('parity');
const W = 'docs/worklogs';
const activeLine = (slug) => `<!-- Work log: status=active slug=${slug} created=2026-09-21 -->`;
h.write(d, `${W}/alpha.md`, `${activeLine('alpha')}\n\n# Work log: a\n`);
h.write(d, `${W}/shut.md`, '<!-- Work log: status=closed slug=shut created=2026-09-21 closed=2026-09-22 -->\n');
h.write(d, `${W}/bad.md`, '<!-- Work log: status=open slug=bad created=2026-09-21 -->\n');
h.write(d, `${W}/bom.md`, `\uFEFF${activeLine('bom')}\n`);
h.write(d, `${W}/crlf.md`, `${activeLine('crlf')}\r\n\r\n# x\r\n`);
h.write(d, `${W}/heading.md`, `# Work log: heading first\n\n${activeLine('heading')}\n`);
for (const name of ['Upper.md', 'new.md', 'x y.md', 'café.md']) h.write(d, `${W}/${name}`, `${activeLine('x')}\n`);
let haveLink = true;
try { fs.symlinkSync('alpha.md', path.join(d, W, 'link.md')); } catch (error) { haveLink = false; console.log('  NOTE: this file system refuses a symbolic link; the link case is skipped'); }

const folder = path.join(d, W);
const regular = fs.readdirSync(folder).filter((name) => name.endsWith('.md') && fs.lstatSync(path.join(folder, name)).isFile());
const nodeListing = regular.map((name) => (p.worklogNameValid(name) ? name.slice(0, -3) : `${p.listingName(name)}: invalid file name — rename it`)).sort();
const shellListing = bash(d, LISTING).split('\n').filter(Boolean).sort();
h.eq('listing: the Node rules and the listing command give the same lines', nodeListing, shellListing);

const slugs = regular.filter(p.worklogNameValid).map((name) => name.slice(0, -3));
if (haveLink) slugs.push('link');
for (const slug of slugs) {
  const file = path.join(folder, `${slug}.md`);
  const nodeWord = fs.lstatSync(file).isSymbolicLink() ? 'symlink' : p.worklogClass(fs.readFileSync(file, 'utf8'));
  const shellWord = bash(d, CHECK.split('<slug>').join(slug)).split('\n')[0];
  h.eq(`check: ${slug} gives the same word`, nodeWord, shellWord);
}

h.finish();
