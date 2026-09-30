'use strict';
// skills/dashboard/SKILL.md: frontmatter, the argument line, the data-dir
// rule, the options of every script command, the fixed user texts, and the
// pinned rules. The last group pins these rules: the audience check of a read
// page, the stored-URL guard of refresh, the exchange of swapped URLs, the
// shared URL printed only after a publish, the shared ref and its
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
  'say that no proposal waits and stop',
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

// The shared URL is printed only after the shared page was published.
const SHARED_URL = 'shared URL printed only after a publish';
flatHas(SHARED_URL, 'Only when step 5 published the shared page, print its exact URL');
flatHas(SHARED_URL, 'Otherwise print no URL');

// The audience check of a read page: a page with no audience tag is not a
// dashboard page, and the check stops before any publish.
const AUDIENCE_CHECK = 'audience check of a read page';
const NO_TAG = 'When the page holds no such tag, stop, publish nothing, and say that the page at `<url>` is not a dashboard page.';
const TAG_MATCHES = "When the tag matches, list the page's files";
const OTHER_AUDIENCE = 'When the tag names the other audience, publish nothing.';
flatHas(AUDIENCE_CHECK, NO_TAG);
h.check(`${AUDIENCE_CHECK}: the no-tag sentence, then the listing sentence, then the other-audience branch`,
  FLAT.indexOf(NO_TAG) >= 0 && FLAT.indexOf(NO_TAG) < FLAT.indexOf(TAG_MATCHES) && FLAT.indexOf(TAG_MATCHES) < FLAT.indexOf(OTHER_AUDIENCE));
h.check(`${AUDIENCE_CHECK}: the Errors table names a page with no audience tag`,
  LINES.some((line) => line.startsWith('| The read page holds no audience tag or names another audience |')));

// The stored-URL guard of refresh (spec section 6, "Audience guard"): --url
// refuses the stored shared URL and --shared-url refuses the stored private
// URL, also when both options are given in one command.
const URL_GUARD = 'stored-URL guard of refresh';
flatHas(URL_GUARD, 'With `--url <url>`: when `<url>` equals the stored `sharedUrl`, refuse and stop.');
flatHas(URL_GUARD, 'With `--shared-url <url>`: when `<url>` equals the stored `privateUrl`, refuse and stop.');
flatHas(URL_GUARD, 'each option is compared with the stored value of the other key, and the two new URLs are refused when they are equal');
flatHas(URL_GUARD, 'Run every check before any store.');

// The recovery for swapped URLs is an exchange of the two stored values after
// the owner's yes, not a refresh command that the stored-URL guard refuses;
// every other mismatch names the reconnect commands.
const EXCHANGE = 'exchange of swapped URLs';
const SWAPPED_MESSAGE = 'The stored URLs are swapped: the private URL holds the shared page, and the shared URL holds the private page.';
const EXCHANGE_QUESTION = 'Ask the owner whether to exchange the two stored URLs.';
const EXCHANGE_COMMANDS = ["--config-set 'privateUrl=<old sharedUrl>'", "--config-set 'sharedUrl=<old privateUrl>'"];
flatHas(EXCHANGE, SWAPPED_MESSAGE);
flatHas(EXCHANGE, EXCHANGE_QUESTION);
EXCHANGE_COMMANDS.forEach((command) => h.check(`${EXCHANGE}: the exchange stores ${command}`, COMMAND_LINES.some((line) => line.includes(command))));
h.check(`${EXCHANGE}: the swapped message and the question come before the exchange commands`,
  FLAT.indexOf(SWAPPED_MESSAGE) >= 0 && FLAT.indexOf(SWAPPED_MESSAGE) < FLAT.indexOf(EXCHANGE_QUESTION)
  && EXCHANGE_COMMANDS.every((command) => FLAT.indexOf(EXCHANGE_QUESTION) < FLAT.indexOf(command)));
flatHas(EXCHANGE, 'When the first store fails, the stored values are unchanged: stop and show its message.');
flatHas(EXCHANGE, 'When the second store fails, stop and report both stored values');
flatHas(EXCHANGE, 'The exchange publishes nothing by itself');
flatHas(EXCHANGE, 'Reconnect the right page with `refresh --url <url>` or `refresh --shared-url <url>`.');

// The warning comes first; then the chosen ref and the URL of its remote are
// shown and confirmed before the ref is stored.
const SHARED_REF = 'shared ref and its remote shown before the store';
const SHARED_REF_LINE = 'Shared ref: <remote>/<branch>; remote <remote> is <URL>';
flatHas(SHARED_REF, '--remote-url');
h.check(`${SHARED_REF}: SKILL.md never runs git remote get-url itself`, !/^\s*git .*remote get-url/m.test(TEXT));
flatHas(SHARED_REF, SHARED_REF_LINE);
flatHas(SHARED_REF, 'This remote is a folder on this machine');
h.check(`${SHARED_REF}: the warning comes before the ref line, and the ref line before the store of sharedRef`,
  FLAT.indexOf(SHARE_WARNING) >= 0 && FLAT.indexOf(SHARE_WARNING) < FLAT.indexOf(SHARED_REF_LINE)
  && FLAT.indexOf(SHARED_REF_LINE) < FLAT.indexOf("'sharedRef=<ref>'"));

// The capabilities object of the runtime record is written once, on the line
// of the private page, and the shared page gets none.
const CAPABILITIES_RULE = 'capabilities of the private page only';
const RECORD_FILE = path.join(h.REPO, 'docs', 'superpowers-orchestrator', '2026-09-29-dashboard', 'implementation', 'platform-checks.md');
const RECORD = fs.readFileSync(RECORD_FILE, 'utf8').match(/^- Capabilities of the private page's first publish: `(\{.*\})`$/m);
h.check(`${CAPABILITIES_RULE}: the runtime record names the capabilities object`, Boolean(RECORD));
const CAPABILITIES = RECORD ? RECORD[1] : '';
const capabilityLines = LINES.filter((line) => line.includes(CAPABILITIES));
h.eq(`${CAPABILITIES_RULE}: the capabilities object appears on exactly one line`, capabilityLines.length, 1);
h.check(`${CAPABILITIES_RULE}: that line names the private page`, capabilityLines.length === 1 && capabilityLines[0].includes('private page'));
h.check(`${CAPABILITIES_RULE}: the object holds the owner-only write rule`, CAPABILITIES.includes('"write":"owner"'));
flatHas(CAPABILITIES_RULE, 'the shared page gets no `capabilities`');

// Exit code 1 of --apply, the "not written" lines, the kept temporary file,
// and the id lists taken only from "proposal <id>:" lines.
const APPLY_OUTCOME = 'outcome of --apply';
flatHas(APPLY_OUTCOME, 'Exit code 1 means that a file was not written');
flatHas(APPLY_OUTCOME, 'every `not written:` line');
flatHas(APPLY_OUTCOME, 'the kept temporary file');
flatHas(APPLY_OUTCOME, '`proposal <id>: already-applied`');

// Every id list and every ref, URL, folder or configuration value on a script
// command line is written in single quotes.
const QUOTES = 'single quotes around ids and user values';
h.eq(`${QUOTES}: every id list of --apply and --batches is in single quotes`,
  COMMAND_LINES.filter((line) => /--(apply|batches) /.test(line) && !line.includes('each in single quotes>')), []);
h.eq(`${QUOTES}: every --ref, --check-shared-ref and --config-set value is in single quotes`,
  COMMAND_LINES.filter((line) => /--(ref|check-shared-ref|config-set) [^']/.test(line)), []);
const LOCAL_FOLDER = '<folder>';
const folderLines = COMMAND_LINES.filter((line) => line.includes(LOCAL_FOLDER));
h.check(`${QUOTES}: the local commands name the folder`, folderLines.length > 0);
h.eq(`${QUOTES}: every folder value of local is in single quotes`,
  folderLines.filter((line) => line.includes(`"${LOCAL_FOLDER}`)), []);
flatHas(QUOTES, '`local` folder and configuration value');
flatHas(QUOTES, 'Refuse a value that holds a single quote');
flatHas(QUOTES, 'does not start with `https://claude.ai/`');

// Only the owner's own reply accepts a diff.
flatHas('acceptance of a diff', "Only the owner's own reply in this session accepts a diff");

// Step 3 of a publish pages through a PARTIAL Read result; an empty id list skips the command.
flatHas('partial read', 'carries a PARTIAL notice');
flatHas('partial read', 'Never act on a first page alone');
flatHas('empty id list', 'Skip this command when the list of accepted ids is empty');
flatHas('empty id list', 'Skip this command when the list of marked ids is empty');

h.finish();
