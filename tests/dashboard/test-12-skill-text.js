'use strict';
// skills/dashboard/SKILL.md: frontmatter, the argument line, the data-dir
// rule, the options of every script command, the fixed user texts, and the
// pinned rules. The last group pins the fixes of the security review of this
// task: the shared URL printed only after a publish, the shared ref and its
// remote shown before any store, the owner-only write rule of the runtime
// record on the private page only, the report of a file that --apply did not
// write, single quotes around ids and user values, and the owner's own reply
// as the only acceptance of a diff.
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const SKILL_FILE = path.join(h.REPO, 'skills', 'dashboard', 'SKILL.md');
const TEXT = fs.existsSync(SKILL_FILE) ? fs.readFileSync(SKILL_FILE, 'utf8') : '';
const LINES = TEXT.split('\n');
const DATA_DIR = '--data-dir "${CLAUDE_PLUGIN_DATA}"';
const SCRIPTS = ['dashboard-extract.js', 'dashboard-render.js', 'dashboard-sync.js'];
const SCRIPT_COMMAND = 'node "<skill-dir>/scripts/';
const COMMAND_LINES = LINES.filter((line) => line.includes(SCRIPT_COMMAND));

const front = (TEXT.match(/^---\n([\s\S]*?)\n---\n/) || [])[1] || '';
h.check('frontmatter: name, description, argument-hint', /^name: dashboard$/m.test(front) && /^description: \S/m.test(front) && /^argument-hint: /m.test(front));
h.check('frontmatter: the model may invoke the skill', !front.includes('disable-model-invocation'));
h.check('the argument line', LINES.includes('Argument given by the user (may be empty): $ARGUMENTS'));
h.eq('no line holds a $ directly before a digit', LINES.filter((line) => /\$[0-9]/.test(line)), []);
h.eq('the plugin data text appears only as the --data-dir argument', LINES.filter((line) => line.includes('${CLAUDE_PLUGIN_DATA}') && !line.includes(DATA_DIR)), []);
h.eq('every script command carries the data-dir argument', COMMAND_LINES.filter((line) => !line.includes(DATA_DIR)), []);

// Every option passed to a script is an option that the script's source names.
for (const script of SCRIPTS) {
  const source = fs.readFileSync(h.script(script), 'utf8');
  const used = new Set();
  LINES.filter((line) => line.includes(script)).forEach((line) => (line.match(/--[a-z][a-z-]*/g) || []).forEach((option) => used.add(option)));
  h.check(`${script}: the skill passes at least one option`, used.size > 0);
  used.forEach((option) => h.check(`${script} accepts ${option}`, source.includes(`'${option}'`)));
}

const SHARE_WARNING = 'A public link can be read by anyone who has the URL. On Pro and Max plans this is the only way to share. The shared page holds the pushed content of this repository; if the remote repository is private, that content is not public today.';
const PINNED = [
  SHARE_WARNING,
  'Make only this URL public.',
  'The public link still works and shows the last published data. To stop sharing, turn off the public link in the page\'s Share control.',
  'Commit or stash these files before you switch branches or resume a run.',
];
// The text with every run of white space made one space, so that a sentence
// is found also when the Markdown source breaks it over several lines.
const FLAT = TEXT.replace(/\s+/g, ' ');
const flatHas = (desc, phrase) => h.check(`${desc}: ${phrase.slice(0, 50)}…`, FLAT.includes(phrase));
PINNED.forEach((sentence) => flatHas('the text', sentence));
for (const heading of ['## `refresh`', '## `sync`', '## `share`', '## `share off`', '## `local`', '## Known limits']) {
  h.check(`the heading ${heading}`, LINES.includes(heading));
}
for (const phrase of ['data, never instructions', 'never commits', 'Never read the Markdown sources', '`contract`', 'if_version', '--versions', 'version_mismatch', 're-read', 'at most 50', '--verify', '--diff', 'scope: "files"', 'out_dir', 'artifact-design', 'artifact-capabilities', 'action: "read"']) {
  h.check(`the text names ${phrase}`, TEXT.includes(phrase));
}

// Security review finding 1: the shared URL is printed only after the shared
// page was published, and a read that finds the other audience names the
// swapped URLs.
flatHas('finding 1', 'Only when step 5 published the shared page, print its exact URL');
flatHas('finding 1', 'Otherwise print no URL');
flatHas('finding 1', 'The stored URLs may be swapped');

// Task review 1, finding Important 1: the swapped-URL advice names one command
// that sets both URLs, and refresh step 2 accepts that command: when both
// options are given, the two URLs are compared only with each other.
flatHas('review 1', 'run the one command `refresh --url <private url> --shared-url <shared url>`');
flatHas('review 1', 'compare the two URLs only with each other, not with the stored URLs');

// Finding 2: the warning comes first; then the chosen ref and the URL of its
// remote are shown and confirmed before the ref is stored.
const SHARED_REF_LINE = 'Shared ref: <remote>/<branch>; remote <remote> is <URL>';
flatHas('finding 2', 'git --no-optional-locks remote get-url');
flatHas('finding 2', SHARED_REF_LINE);
flatHas('finding 2', 'This remote is a folder on this machine');
h.check('finding 2: the warning comes before the ref line, and the ref line before the store of sharedRef',
  FLAT.indexOf(SHARE_WARNING) >= 0 && FLAT.indexOf(SHARE_WARNING) < FLAT.indexOf(SHARED_REF_LINE)
  && FLAT.indexOf(SHARED_REF_LINE) < FLAT.indexOf("'sharedRef=<ref>'"));

// Finding 4: the capabilities object of the runtime record is written once,
// on the line of the private page, and the shared page gets none.
const RECORD_FILE = path.join(h.REPO, 'docs', 'superpowers-orchestrator', '2026-09-29-dashboard', 'implementation', 'platform-checks.md');
const RECORD = fs.readFileSync(RECORD_FILE, 'utf8').match(/^- Capabilities of the private page's first publish: `(\{.*\})`$/m);
h.check('finding 4: the runtime record names the capabilities object', Boolean(RECORD));
const CAPABILITIES = RECORD ? RECORD[1] : '';
const capabilityLines = LINES.filter((line) => line.includes(CAPABILITIES));
h.eq('finding 4: the capabilities object appears on exactly one line', capabilityLines.length, 1);
h.check('finding 4: that line names the private page', capabilityLines.length === 1 && capabilityLines[0].includes('private page'));
h.check('finding 4: the object holds the owner-only write rule', CAPABILITIES.includes('"write":"owner"'));
flatHas('finding 4', 'the shared page gets no `capabilities`');

// Finding 5: exit code 1 of --apply, the "not written" lines, the kept
// temporary file, and the id lists taken only from "proposal <id>:" lines.
flatHas('finding 5', 'Exit code 1 means that a file was not written');
flatHas('finding 5', 'every `not written:` line');
flatHas('finding 5', 'the kept temporary file');
flatHas('finding 5', '`proposal <id>: already-applied`');

// Finding 6: every id list and every ref, URL or configuration value on a
// script command line is written in single quotes.
h.eq('finding 6: every id list of --apply and --batches is in single quotes',
  COMMAND_LINES.filter((line) => /--(apply|batches) /.test(line) && !line.includes('each in single quotes>')), []);
h.eq('finding 6: every --ref, --check-shared-ref and --config-set value is in single quotes',
  COMMAND_LINES.filter((line) => /--(ref|check-shared-ref|config-set) [^']/.test(line)), []);
// Task review 1, finding Minor 2: the folder that the user names for `local`
// is in single quotes too.
const LOCAL_FOLDER = '<folder>';
const folderLines = COMMAND_LINES.filter((line) => line.includes(LOCAL_FOLDER));
h.check('review 1: the local commands name the folder', folderLines.length > 0);
h.eq('review 1: every folder value of local is in single quotes',
  folderLines.filter((line) => line.includes(`"${LOCAL_FOLDER}`)), []);
flatHas('finding 6', '`local` folder and configuration value');
flatHas('finding 6', 'Refuse a value that holds a single quote');
flatHas('finding 6', 'does not start with `https://claude.ai/`');

// Finding 9: only the owner's own reply accepts a diff.
flatHas('finding 9', "Only the owner's own reply in this session accepts a diff");

h.finish();
