#!/usr/bin/env node
/**
 * Protect Secrets — PreToolUse Hook for Read|Edit|Write|Grep|Bash
 *
 * Refuses a tool call that reads, changes or sends away a file that holds
 * secrets, and a Bash command that prints the environment.
 *
 * ONE path table (SENSITIVE_FILES, with the ALLOWLIST for template files)
 * decides for every tool: the `file_path` of Read, Edit and Write, the `path`
 * and the `glob` of Grep (never its `pattern`, which is text), and, in a Bash
 * command, every redirect target and every word of every program. The shared
 * reader (shell-words.js) splits the Bash command into programs and words.
 *
 * A Bash word that names a secret file passes only through a named exemption
 * of the program that receives it: a program that does not touch the content
 * (`ls`, `test`, `stat`, `chmod`, `touch`), a text argument (`echo`, the
 * pattern of `grep`, a commit message), or a program or an option that loads
 * the file without printing it (`source`, `--env-file`, `ssh -i`,
 * `curl --cacert`). A program that is not named in such a table is refused.
 *
 * A Bash command that the reader cannot read to its end is refused. An error
 * inside the Bash rules is refused in the same way. An error inside the check
 * of Read, Edit, Write or Grep is a pass (see hook-io.js for the reason).
 *
 * Switch. The environment variable SUPERPOWERS_SECRETS_RULES_OFF holds a comma-separated list of rule names
 * (KNOWN_RULE_NAMES). A rule in the list is not applied: the hook filters its rule tables, so a command that
 * names a second secret file is still refused by the rule of that file. `unreadable-command` cannot be
 * switched off.
 *
 * Limits. The hook reads text; it cannot see these, and passes them:
 *   - a variable that holds the path (`F=.env; cat "$F"`), and an alias;
 *   - a script file that exists already, `make`, `npm run`;
 *   - a read of a whole folder (`grep -r KEY .`, `tar czf all.tgz .`);
 *   - a file name pattern with fewer than three plain characters that does
 *     not start with a dot (`cat *`, `cat *.*`), and a pattern with a negated
 *     set of characters (`.[!.]*`);
 *   - `xargs` that gets file names from a program other than `find`, `ls`,
 *     `echo` or `printf`;
 *   - code of an interpreter (`python3 -c "open('.env')"`), except a call
 *     that starts a process;
 *   - a variable with a secret name in lower case (`echo "$api_key"`,
 *     `$token`): only a name in upper case counts;
 *   - a command that is written to hide its meaning on purpose.
 *
 * Based on claude-code-hooks by karanb192 (MIT License).
 * Adapted for superpowers-orchestrator plugin with cross-platform support.
 *
 * Logs blocked operations to: ~/.claude/hooks-logs/YYYY-MM-DD.jsonl
 */

'use strict';

const {
  splitArgs, hasLong, gitCall, expandBraces, toPosix, ASSIGNMENT, XARGS, TEXT_PROGRAMS, FIND_EXEC_OPTIONS,
} = require('./shell-words');
const { runHook, refusal, decideCommand, firstRefusal, ALLOWED, BASH_TOOL, NO_RETRY } = require('./hook-io');
const { parseNameList } = require('../name-list');

const HOOK_NAME = 'protect-secrets';
const GREP_TOOL = 'Grep';
const FILE_TOOLS = ['Read', 'Edit', 'Write'];
const WRITE_TOOLS = ['Edit', 'Write'];
const ASK_USER = 'ask the user to create or change the file, or to give you the one value that the task needs; '
  + 'to create the file from a template without replacing it: `cp -n <template> <file>`';

// The environment variable that switches rules off: a comma-separated list of rule names (KNOWN_RULE_NAMES).
// A rule in the list is not applied. The name of a rule is the text that its refusal shows in square brackets.
const RULES_OFF_VARIABLE = 'SUPERPOWERS_SECRETS_RULES_OFF';
// The two Bash rules have no table row; their names are constants that the rule and KNOWN_RULE_NAMES share.
const ENV_DUMP_RULE = 'env-dump';
const ECHO_SECRET_VAR_RULE = 'echo-secret-var';
// The refusal for hardcoded content shows this text before the `id` of the content pattern.
const HARDCODED_PREFIX = 'hardcoded-';
// The last sentence of every refusal reason of this hook. It names no variable: a refusal reason goes to the
// model, and a model that learns the name of the switch could set it to avoid its own refusal.
const NO_SETTINGS_CHANGE = 'Never change Claude Code settings or hook files to get past this refusal; ask the user.';

// Files explicitly safe to access (templates, examples)
const ALLOWLIST = [
  /\.env\.example$/, /\.env\.sample$/, /\.env\.template$/,
  /\.env\.schema$/, /\.env\.defaults$/, /env\.example$/, /example\.env$/,
];

// The path table. Every path is compared in lower case and with `/` as the separator,
// so each expression is written in lower case.
const SENSITIVE_FILES = [
  { id: 'env-file',           regex: /(?:^|\/)\.env(?:\.[^/]*)?$/,                    reason: '.env file contains secrets' },
  { id: 'envrc',              regex: /(?:^|\/)\.envrc$/,                              reason: '.envrc (direnv) contains secrets' },
  { id: 'ssh-private-key',    regex: /(?:^|\/)\.ssh\/id_[^/]+$/,                      reason: 'SSH private key' },
  { id: 'ssh-private-key-2',  regex: /(?:^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/,  reason: 'SSH private key' },
  { id: 'ssh-authorized',     regex: /(?:^|\/)\.ssh\/authorized_keys$/,               reason: 'SSH authorized_keys' },
  { id: 'aws-credentials',    regex: /(?:^|\/)\.aws\/credentials$/,                   reason: 'AWS credentials file' },
  { id: 'aws-config',         regex: /(?:^|\/)\.aws\/config$/,                        reason: 'AWS config may contain secrets' },
  { id: 'kube-config',        regex: /(?:^|\/)\.kube\/config$/,                       reason: 'Kubernetes config contains credentials' },
  { id: 'pem-key',            regex: /\.pem$/,                                        reason: 'PEM key file' },
  { id: 'key-file',           regex: /\.key$/,                                        reason: 'Key file' },
  { id: 'p12-key',            regex: /\.(p12|pfx)$/,                                  reason: 'PKCS12 key file' },
  { id: 'credentials-json',   regex: /(?:^|\/)credentials\.json$/,                    reason: 'Credentials file' },
  { id: 'secrets-file',       regex: /(?:^|\/)(secrets?|credentials?)\.(json|ya?ml|toml)$/, reason: 'Secrets configuration file' },
  { id: 'service-account',    regex: /service[_-]?account.*\.json$/,                  reason: 'GCP service account key' },
  { id: 'gcloud-creds',       regex: /(?:^|\/)\.config\/gcloud\/.*(credentials|tokens)/, reason: 'GCloud credentials' },
  { id: 'azure-creds',        regex: /(?:^|\/)\.azure\/(credentials|accesstokens)/,   reason: 'Azure credentials' },
  { id: 'docker-config',      regex: /(?:^|\/)\.docker\/config\.json$/,               reason: 'Docker config may contain registry auth' },
  { id: 'netrc',              regex: /(?:^|\/)\.netrc$/,                              reason: '.netrc contains credentials' },
  { id: 'npmrc',              regex: /(?:^|\/)\.npmrc$/,                              reason: '.npmrc may contain auth tokens' },
  { id: 'pypirc',             regex: /(?:^|\/)\.pypirc$/,                             reason: '.pypirc contains PyPI credentials' },
  { id: 'gem-creds',          regex: /(?:^|\/)\.gem\/credentials$/,                   reason: 'RubyGems credentials' },
  { id: 'vault-token',        regex: /(?:^|\/)(\.vault-token|vault-token)$/,          reason: 'Vault token file' },
  { id: 'keystore',           regex: /\.(keystore|jks)$/,                             reason: 'Java keystore' },
  { id: 'htpasswd',           regex: /(?:^|\/)\.?htpasswd$/,                          reason: 'htpasswd contains hashed passwords' },
  { id: 'pgpass',             regex: /(?:^|\/)\.pgpass$/,                             reason: 'PostgreSQL password file' },
  { id: 'my-cnf',             regex: /(?:^|\/)\.my\.cnf$/,                            reason: 'MySQL config may contain password' },
  { id: 'proc-environ',       regex: /(?:^|\/)proc\/[^/]+\/environ$/,                 reason: 'the environment of a process' },
];
// A public key is not a secret.
const PUBLIC_KEY = /\.pub$/;
// Names that a file name pattern (`.e*`, `*.env*`) is tested against.
const HIDDEN_SAMPLE_NAMES = ['.env', '.env.local', '.envrc', '.netrc', '.npmrc', '.pypirc', '.pgpass', '.vault-token', '.htpasswd', '.my.cnf'];
const PATTERN_CHARACTERS = /[*?[]/;
// A pattern that does not start with a dot counts only with this many plain characters: `*.env*` counts,
// `*` and `*.*` do not (they would refuse every search).
const MIN_PATTERN_CHARACTERS = 3;
// Characters after which a word can hold a path: `if=.env`, `file=@.env`, `HEAD:.env`, `a.txt,.env`.
const PATH_STARTS = /[=@:,]/g;
// No path is longer than this, so only this many characters at the end of a word can name a file.
// The limit keeps the time for one very long word (a megabyte of JSON) short.
const PATH_TAIL = 4096;
// A pattern that starts with `!` leaves files out (`rg -g '!*.pem'`).
const EXCLUSION_MARK = '!';

// Programs that neither print nor change the content of a file that they name.
const NO_CONTENT_PROGRAMS = new Set(['ls', 'test', '[', '[[', 'stat', 'chmod', 'touch']);
// `find` only lists names, unless it runs or deletes what it finds.
const FIND = 'find';
const FIND_DELETE = '-delete';
// Programs that print their own arguments or the names of files. Piped into `xargs`, those names become operands.
const NAME_SOURCES = new Set([FIND, 'ls', ...TEXT_PROGRAMS]);
// Shell words that give a value to a variable: an argument `NAME=path` is not an operand.
const DECLARING_PROGRAMS = new Set(['export', 'declare', 'typeset', 'local', 'readonly']);
// Programs that load the files which they name and do not print them. `source` and `.` set the variables
// of the file in the shell, as `--env-file` does for a program.
const LOADER_PROGRAMS = new Set(['ssh-add', 'source', '.']);
// Programs whose first operand is a pattern or a program text, not a file.
// `value`: the short options that take a value. `pattern`: the short options whose value is the pattern
// or a file of patterns; with one of them every operand is a file.
// A letter that is wrongly in `value` would hide the real pattern and exempt a file, so each list is short.
// `text`: the options whose value is the pattern itself; that value is text, not a file.
// (`jq -e` takes no value, so jq has no such option.)
const GREP_OPTIONS = { value: 'efABCmdD', pattern: 'ef', text: ['-e', '--regexp'] };
const NO_OPTIONS = { value: '', pattern: '', text: [] };
const PATTERN_FIRST_PROGRAMS = {
  grep: GREP_OPTIONS,
  rg: { value: 'efgtABCm', pattern: 'ef', text: ['-e', '--regexp'] },
  ag: NO_OPTIONS,
  sed: { value: 'ef', pattern: 'ef', text: ['-e', '--expression'] },
  awk: { value: 'fFv', pattern: 'f', text: [] },
  jq: { value: 'f', pattern: 'f', text: [] },
  yq: NO_OPTIONS,
};
const GIT_GREP = 'grep';
const PATTERN_FIRST_LONG_VALUE = ['regexp', 'file', 'after-context', 'before-context', 'context', 'max-count',
  'include', 'exclude', 'exclude-dir', 'glob', 'type', 'expression', 'field-separator', 'assign', 'from-file'];
// The long options whose value is the pattern or a file of patterns.
const PATTERN_OPTION_LONG = ['regexp', 'file', 'expression', 'from-file'];
// The options of rg whose value is a file name pattern.
const RG_GLOB_OPTIONS = ['-g', '--glob', '--iglob'];
// Options whose value the program loads or skips; it does not print the file. '*': every program.
const LOADER_OPTIONS = {
  '*': ['--env-file', '--exclude'],
  ssh: ['-i'], scp: ['-i'], 'ssh-keygen': ['-f'],
  curl: ['--cacert', '--cert', '--key'],
  kubectl: ['--kubeconfig'],
  gcloud: ['--key-file'], npm: ['--userconfig'], twine: ['--config-file'], keytool: ['-keystore'],
  docker: ['--secret'], dotenv: ['-e'], 'dotenv-cli': ['-e'],
  uvicorn: ['--ssl-keyfile', '--ssl-certfile'],
  openssl: ['-CAfile'],
  'openssl x509': ['-in'], 'openssl req': ['-key', '-keyout', '-out'], 'openssl genrsa': ['-out'],
};
// Options whose value is text for a person or for the program, not a path.
// Short options also count at the end of a group (`-am`).
const TEXT_OPTIONS = {
  git: ['-m', '--message', '--grep', '-S', '-G'],
  gh: ['-t', '--title', '-b', '--body', '-q', '--jq'],
  aws: ['--query'],
  rsync: ['-e', '--rsh'],
};
// `zip ... -x <pattern>...`: the words after `-x` name files that zip leaves out.
const ZIP = 'zip';
const ZIP_EXCLUDE = '-x';
// Sub-commands of git that do not print or store the content of the files that they name.
const GIT_NO_CONTENT = new Set(['check-ignore', 'ls-files', 'status']);
// A variable name in UPPER case is a secret name when one of its parts (between `_`) is a secret word,
// wherever the part stands: API_KEY, FILE_ENCRYPTION_KEY, PGPASSWORD, GITHUB_TOKEN.
// A name in lower case passes (`$key`, `$token`): that is a documented limit.
// KEY counts alone or after a word such as API (`$MONKEY` and the list `$KEYS` are no secrets).
const SECRET_NAME_PART = /^(.*(SECRETS?|TOKEN|PASSWORD|PASSWD)|(API|ACCESS|PRIVATE|SECRET|SSH)?KEY|CREDENTIALS?|PRIVATE)$/;
// A name with one of these parts is a number, not the secret: TOKEN_COUNT, PASSWORD_LENGTH.
const COUNTER_PARTS = new Set(['COUNT', 'LIMIT', 'LENGTH', 'SIZE']);
// PASS is a password when another part names what it belongs to (`DB_PASS`). Alone, or with one of
// these parts only, it is the number of tests that passed: PASS, TESTS_PASS, TOTAL_PASS.
const PASS_PART = 'PASS';
const PASS_COUNTER_PARTS = new Set(['TESTS', 'TEST', 'TOTAL', 'NUM']);
// AUTH is a secret word (`REDIS_AUTH`), except in a name that holds an address or a setting:
// AUTH_URL, AUTH_METHOD, SSH_AUTH_SOCK.
const AUTH_PART = 'AUTH';
const ADDRESS_PARTS = new Set(['URL', 'URI', 'HOST', 'PORT', 'SOCK', 'METHOD', 'ENDPOINT', 'DOMAIN']);
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PRINT_ENVIRONMENT = 'printenv';
// Shell words that list every variable when they have no name argument.
const ENV_LISTERS = new Set(['export', 'declare', 'typeset']);

// Hardcoded secret patterns — scans content being written for leaked credentials.
// When detected, blocks the write and instructs the agent to use environment variables instead.
const HARDCODED_SECRET_PATTERNS = [
  { id: 'aws-access-key',    regex: /AKIA[0-9A-Z]{16}/,                                                                     name: 'AWS access key',               envHint: 'AWS_ACCESS_KEY_ID' },
  { id: 'aws-secret-key',    regex: /(?:aws_secret_access_key|secret_key|aws_secret)\s*[:=]\s*['"]?[0-9a-zA-Z/+]{40}/,      name: 'AWS secret key',               envHint: 'AWS_SECRET_ACCESS_KEY' },
  { id: 'github-token',      regex: /gh[ps]_[A-Za-z0-9_]{36,}/,                                                             name: 'GitHub token',                 envHint: 'GITHUB_TOKEN' },
  { id: 'openai-key',        regex: /sk-[A-Za-z0-9]{32,}/,                                                                  name: 'OpenAI API key',               envHint: 'OPENAI_API_KEY' },
  { id: 'anthropic-key',     regex: /sk-ant-[A-Za-z0-9_-]{32,}/,                                                            name: 'Anthropic API key',            envHint: 'ANTHROPIC_API_KEY' },
  { id: 'stripe-key',        regex: /sk_(live|test)_[A-Za-z0-9]{24,}/,                                                      name: 'Stripe secret key',            envHint: 'STRIPE_SECRET_KEY' },
  { id: 'stripe-pub-key',    regex: /pk_(live|test)_[A-Za-z0-9]{24,}/,                                                      name: 'Stripe publishable key',       envHint: 'STRIPE_PUBLISHABLE_KEY' },
  { id: 'private-key-block', regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,                                         name: 'private key PEM block',        envHint: 'PRIVATE_KEY (load from file)' },
  { id: 'generic-api-key',   regex: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/i,             name: 'hardcoded API key',            envHint: 'API_KEY' },
  { id: 'connection-string',  regex: /(?:postgres|mysql|mongodb|redis|amqp):\/\/[^:\s]+:[^@\s]+@/,                           name: 'connection string with password', envHint: 'DATABASE_URL' },
  { id: 'slack-token',       regex: /xox[bporas]-[A-Za-z0-9-]{10,}/,                                                        name: 'Slack token',                  envHint: 'SLACK_TOKEN' },
  { id: 'sendgrid-key',      regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,                                             name: 'SendGrid API key',             envHint: 'SENDGRID_API_KEY' },
  { id: 'twilio-key',        regex: /SK[0-9a-fA-F]{32}/,                                                                    name: 'Twilio API key',               envHint: 'TWILIO_API_KEY' },
  { id: 'supabase-key',      regex: /sbp_[A-Za-z0-9]{40,}/,                                                                 name: 'Supabase service key',         envHint: 'SUPABASE_SERVICE_ROLE_KEY' },
];

const contentRuleName = (pattern) => `${HARDCODED_PREFIX}${pattern.id}`;

// Every name that the switch knows, derived from the tables above: 27 path rows, 14 content patterns, 2 Bash rules.
const KNOWN_RULE_NAMES = [
  ...SENSITIVE_FILES.map(row => row.id),
  ...HARDCODED_SECRET_PATTERNS.map(contentRuleName),
  ENV_DUMP_RULE,
  ECHO_SECRET_VAR_RULE,
];

// Files in which a text that looks like a secret is expected and is not flagged
const CONTENT_SCAN_ALLOWLIST = [
  /\.env(\..*)?$/i,           // template files such as .env.example hold placeholder values
  /known-issues\.md$/i,       // Error documentation may reference key formats
  /SKILL\.md$/i,              // Skill files may document patterns
  /RELEASE-NOTES\.md$/i,      // Release notes may reference patterns
];

// One spelling for every path: `/` as the separator (Windows writes `\`) and lower case
// (the file systems of macOS and Windows do not tell `.ENV` from `.env`).
const normalizePath = (p) => toPosix(String(p)).toLowerCase();

// The names that the user switched off, as a set. The variable is read at each decision, not once when the
// module loads, so that a test can set it after `require`. The last value is kept with its set, so a Bash
// command with thousands of words parses the list once. The returned set is shared: a caller must not change it.
let lastValue;
let lastSet = new Set();
function rulesOff() {
  const value = process.env[RULES_OFF_VARIABLE];
  if (value !== lastValue) {
    lastValue = value;
    lastSet = new Set(parseNameList(value));
  }
  return lastSet;
}

function isAllowlisted(filePath) {
  return Boolean(filePath) && ALLOWLIST.some(p => p.test(normalizePath(filePath)));
}

// The row of the path table that refuses this path, or null.
function secretRow(filePath) {
  if (!filePath) return null;
  const p = normalizePath(filePath);
  if (PUBLIC_KEY.test(p) || ALLOWLIST.some(a => a.test(p))) return null;
  const off = rulesOff();
  return SENSITIVE_FILES.find(row => row.regex.test(p) && !off.has(row.id)) || null;
}

// The parts of a file name pattern.
const ANY_TEXT = Symbol('*');
const ANY_CHARACTER = Symbol('?');

// The test for a set of characters of a pattern: `[a-z]`, `[abc]`.
function characterSet(chars) {
  // A negated set (`[!a]`) is not read as one: `!` counts as a plain member. `.[!.]*` therefore
  // matches no secret name; that is a documented limit.
  return (ch) => {
    for (let k = 0; k < chars.length; k++) {
      const isRange = chars[k + 1] === '-' && k + 2 < chars.length;
      if (isRange ? ch >= chars[k] && ch <= chars[k + 2] : ch === chars[k]) return true;
      if (isRange) k += 2;
    }
    return false;
  };
}

// Splits a file name pattern into its parts: `*` (any text), `?` (one character), `[a-z]` (a set
// of characters) or a plain character. A run of `*` is one `*`.
function patternParts(pattern) {
  const parts = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    const close = c === '[' ? pattern.indexOf(']', i + 2) : -1;
    if (c === '*') { if (parts[parts.length - 1] !== ANY_TEXT) parts.push(ANY_TEXT); }
    else if (c === '?') parts.push(ANY_CHARACTER);
    else if (close !== -1) { parts.push(characterSet(pattern.slice(i + 1, close))); i = close; }
    else parts.push(c);
  }
  return parts;
}

// True when the pattern parts match the whole name. The work grows with the length of the pattern
// times the length of the name; there is no regular expression that could try every split of the name.
function matchesPattern(parts, name) {
  let p = 0;
  let s = 0;
  let star = -1;                 // the last `*` that was passed
  let resume = 0;                // where in the name the text of that `*` ends at present
  while (s < name.length) {
    const part = parts[p];
    const fits = part === ANY_CHARACTER || (typeof part === 'function' ? part(name[s]) : part === name[s]);
    if (part === ANY_TEXT) { star = p++; resume = s; }
    else if (fits) { p++; s++; }
    else if (star !== -1) { p = star + 1; s = ++resume; }
    else return false;
  }
  while (parts[p] === ANY_TEXT) p++;
  return p === parts.length;
}

/**
 * The row for a path that may be a file name pattern. A brace list (`{a,b}`)
 * is tested word by word. A pattern is tested itself (`*.pem`), and against
 * the names of secret files that it can match (`.e*`, `*.env*`): in `find
 * -name`, `grep --include`, `rg -g` and the Grep tool a `*` also matches the
 * dot at the start of a name.
 */
function secretRowOfPattern(pattern) {
  for (const text of expandBraces(pattern) || [pattern]) {
    const direct = secretRow(text);
    if (direct) return direct;
    if (!PATTERN_CHARACTERS.test(text)) continue;
    const p = normalizePath(text);
    const dir = p.slice(0, p.lastIndexOf('/') + 1);
    const name = p.slice(dir.length);
    if (!name.startsWith('.') && name.replace(/[*?[\]]/g, '').length < MIN_PATTERN_CHARACTERS) continue;
    const parts = patternParts(name);
    // Every sample that the pattern matches is tried: the first one can have a row that is switched off.
    for (const sample of HIDDEN_SAMPLE_NAMES) {
      const row = matchesPattern(parts, sample) ? secretRow(dir + sample) : null;
      if (row) return row;
    }
  }
  return null;
}

function checkFilePath(filePath) {
  const row = secretRow(filePath);
  return { blocked: Boolean(row), pattern: row };
}

// The row for a Bash word. Inside a word a path can start after one of PATH_STARTS; each of them is
// read as a path separator, so that the path after it is found in one pass over the end of the word.
function secretRowOfWord(word) {
  const tail = word.text.slice(-PATH_TAIL);
  for (const text of expandBraces(tail) || [tail]) {
    // The word as it is (a file name can hold `@`, `:`, `,` or `=`), and the path after such a character.
    const row = secretRowOfPattern(text) || secretRowOfPattern(text.replace(PATH_STARTS, '/'));
    if (row) return row;
  }
  return null;
}

// True when the word at `k` is the value of one of `options`, in the next word or after `=`.
function isValueOf(args, k, options, shortGroups = false) {
  const own = args[k].text;
  if (options.some(o => own.startsWith(`${o}=`))) return true;
  if (k === 0) return false;
  const before = args[k - 1].text;
  if (options.includes(before)) return true;
  // `-am "<message>"`: the last letter of a group of short options takes the value.
  return shortGroups && /^-[A-Za-z]{2,}$/.test(before) && options.includes(`-${before[before.length - 1]}`);
}

// The words without the pattern operand of a program such as grep. `options`: a row of PATTERN_FIRST_PROGRAMS.
function withoutPattern(words, options) {
  const a = splitArgs(words, options.value, PATTERN_FIRST_LONG_VALUE);
  // When an option gives the pattern (`-e X`, `-eX`, `--regexp=X`, `-f file`), no operand is the
  // pattern: every operand is a file. Only the value of the option is text.
  const patternInOption = [...options.pattern].some(o => a.short.has(o)) || PATTERN_OPTION_LONG.some(o => a.long.includes(o));
  if (patternInOption) return words.filter((x, k) => !isValueOf(words, k, options.text, true));
  return words.filter(x => x !== a.operands[0]);
}

/**
 * The words of one command that the path table tests. A word that a named
 * exemption of the program covers is left out.
 * `feedsXargs`: a later member of the same pipe runs through `xargs`.
 */
function testedWords(c, feedsXargs) {
  const program = c.program;
  const texts = c.args.map(a => a.text);
  if (!program || LOADER_PROGRAMS.has(program)) return [];
  if (NAME_SOURCES.has(program) && feedsXargs) return c.args;
  if (NO_CONTENT_PROGRAMS.has(program) || TEXT_PROGRAMS.has(program)) return [];
  if (program === FIND) return texts.some(x => FIND_EXEC_OPTIONS.has(x) || x === FIND_DELETE) ? c.args : [];
  if (DECLARING_PROGRAMS.has(program)) return c.args.filter(a => !ASSIGNMENT.test(a.text));

  const subProgram = program === 'openssl' && texts[0] ? `openssl ${texts[0]}` : '';
  const loaders = [...LOADER_OPTIONS['*'], ...(LOADER_OPTIONS[program] || []), ...(LOADER_OPTIONS[subProgram] || [])];
  const textOptions = TEXT_OPTIONS[program] || [];
  let words = c.args.filter((a, k) => !isValueOf(c.args, k, loaders) && !isValueOf(c.args, k, textOptions, true));

  if (program === 'git') {
    const { sub, rest } = gitCall(c.args);
    const cached = sub === 'rm' && hasLong(splitArgs(rest).long, 'cached');
    if (GIT_NO_CONTENT.has(sub) || cached) return [];
    if (sub === GIT_GREP) return withoutPattern(rest, GREP_OPTIONS);
  }
  if (program === 'cp') {
    // `cp -n` never replaces a file that exists, so its last operand, the destination, may name the file.
    // With `-t <folder>` the last operand is a source.
    const a = splitArgs(words);
    const keepsDestination = a.short.has('n') || a.long.includes('no-clobber');
    const namesFolderFirst = a.short.has('t') || a.long.includes('target-directory');
    if (keepsDestination && !namesFolderFirst) words = words.filter(x => x !== a.operands[a.operands.length - 1]);
  }
  // Words that only name files to leave out. They are text. They are taken out at the end, so that
  // they exempt no other word: the pattern and the files are found with every word in its place.
  const leftOut = new Set();
  if (program === ZIP) {
    // `zip ... -x <pattern>...`: the patterns end at the next option.
    for (let k = texts.indexOf(ZIP_EXCLUDE) + 1; k > 0 && k < texts.length && !texts[k].startsWith('-'); k++) leftOut.add(c.args[k]);
  }
  if (program === 'rg') {
    // A glob that starts with `!` names the files that rg leaves out.
    c.args.forEach((a, k) => {
      if (isValueOf(c.args, k, RG_GLOB_OPTIONS) && a.text.replace(/^--i?glob=/, '').startsWith(EXCLUSION_MARK)) leftOut.add(a);
    });
  }
  if (Object.prototype.hasOwnProperty.call(PATTERN_FIRST_PROGRAMS, program)) words = withoutPattern(words, PATTERN_FIRST_PROGRAMS[program]);
  return words.filter(x => !leftOut.has(x));
}

// True for the name of a variable that holds a secret: one of its parts is a secret word in upper case.
function isSecretName(name) {
  const parts = name.split('_');
  if (parts.some(part => COUNTER_PARTS.has(part))) return false;
  const others = parts.filter(part => part !== PASS_PART);
  const password = others.length < parts.length && others.some(part => !PASS_COUNTER_PARTS.has(part));
  const login = parts.includes(AUTH_PART) && !parts.some(part => ADDRESS_PARTS.has(part));
  return password || login || parts.some(part => SECRET_NAME_PART.test(part));
}

// The names that a command gives as arguments (`printenv HOME`, `declare -p API_KEY`).
const namedVariables = (c) => c.args.filter(a => VARIABLE_NAME.test(a.text)).map(a => a.text);

// A program that prints every variable of the environment.
function dumpsEnvironment(c) {
  if (c.program === PRINT_ENVIRONMENT) return namedVariables(c).length === 0;
  if (c.program === 'env') return Boolean(c.bare);
  if (ENV_LISTERS.has(c.program)) return c.args.every(a => /^-[px]+$/.test(a.text));
  return c.program === 'set' && c.args.length === 0;
}

// The variable with a secret name whose value the command would print: `echo`, `printf`, a here-string,
// `printenv NAME`, `declare -p NAME`.
function printedSecretVariable(c) {
  const printsNamed = c.program === PRINT_ENVIRONMENT || (ENV_LISTERS.has(c.program) && c.args.some(a => /^-[A-Za-z]*p/.test(a.text)));
  const named = printsNamed ? namedVariables(c).find(isSecretName) : null;
  if (named) return named;
  const hereStrings = c.redirects.filter(r => r.op === '<<<').map(r => r.target);
  const words = [...(TEXT_PROGRAMS.has(c.program) ? c.args : []), ...hereStrings];
  const ref = words.flatMap(w => w.refs).find(r => r.printsValue && isSecretName(r.name));
  return ref ? ref.name : null;
}

function fileRefusal(row, what) {
  return refusal(row.id, `${what} (${row.reason}).`, ASK_USER);
}

// `lastXargs`: for each pipe, the place of its last member that runs through `xargs`.
function checkOne(c, lastXargs) {
  for (const r of c.redirects) {
    if (r.op.startsWith('<<')) continue;                               // a here-document or a here-string: text, not a file
    const row = secretRowOfWord(r.target);
    const effect = r.op.includes('>') ? 'write' : 'read';
    if (row) return fileRefusal(row, `The redirect \`${r.op}\` would ${effect} the secret file \`${r.target.text}\``);
  }
  const off = rulesOff();
  if (!off.has(ENV_DUMP_RULE) && dumpsEnvironment(c)) {
    return refusal(ENV_DUMP_RULE, `\`${c.program}\` would print every variable of the environment, and some hold secrets.`,
      '`printenv NAME` for one variable that is not a secret, or `echo "${NAME:+set}"` to see whether a variable is set');
  }
  const secretVariable = off.has(ECHO_SECRET_VAR_RULE) ? null : printedSecretVariable(c);
  if (secretVariable) {
    return refusal(ECHO_SECRET_VAR_RULE,`\`${c.program}\` would print the value of the secret variable \`${secretVariable}\`.`,
      `\`echo "\${${secretVariable}:+set}"\` shows whether it is set and does not print the value`);
  }
  const feedsXargs = lastXargs.has(c.pipeline) && lastXargs.get(c.pipeline) > c.order;
  for (const word of testedWords(c, feedsXargs)) {
    const row = secretRowOfWord(word);
    if (row) return fileRefusal(row, `\`${c.program}\` would use the secret file \`${word.text.slice(-200)}\``);
  }
  return null;
}

// Ends the reason of a refusal with NO_SETTINGS_CHANGE. A result that is not a refusal is returned as it is.
function finishRefusal(result) {
  if (!result.blocked) return result;
  return { ...result, pattern: { ...result.pattern, reason: `${result.pattern.reason} ${NO_SETTINGS_CHANGE}` } };
}

function checkBashCommand(cmd) {
  if (!cmd) return ALLOWED;
  return finishRefusal(decideCommand(cmd, (commands) => {
    // Found once for the whole call, so that the time for a long list of commands grows with its length.
    const lastXargs = new Map();
    for (const c of commands) {
      if (c.prefixes.includes(XARGS) && !(lastXargs.get(c.pipeline) > c.order)) lastXargs.set(c.pipeline, c.order);
    }
    return firstRefusal(commands, (c) => checkOne(c, lastXargs));
  }));
}

function isContentScanAllowlisted(filePath) {
  return filePath && CONTENT_SCAN_ALLOWLIST.some(p => p.test(filePath));
}

function checkWriteContent(toolName, toolInput) {
  if (!WRITE_TOOLS.includes(toolName)) return ALLOWED;

  const filePath = toolInput?.file_path || '';
  if (isContentScanAllowlisted(filePath)) return ALLOWED;

  // Extract content being written: Write uses 'content', Edit uses 'new_string'
  const content = toolName === 'Write' ? toolInput?.content : toolInput?.new_string;
  if (!content || typeof content !== 'string') return ALLOWED;

  const off = rulesOff();
  for (const p of HARDCODED_SECRET_PATTERNS) {
    const name = contentRuleName(p);
    if (!off.has(name) && p.regex.test(content)) {
      return {
        blocked: true,
        pattern: {
          id: name,
          reason: `Hardcoded ${p.name} detected in content. Do not write the value into a file. Write code that reads it from the environment (process.env.${p.envHint}), and ask the user to store the value. ${NO_RETRY}`,
        },
      };
    }
  }
  return ALLOWED;
}

// Read, Edit, Write name one file. Grep names a file or folder (`path`) and a file name pattern (`glob`).
// A glob that starts with `!` names the files that the search leaves out.
function checkToolPaths(toolName, toolInput) {
  const glob = toolInput?.glob;
  const includes = typeof glob === 'string' && !glob.startsWith(EXCLUSION_MARK) ? glob : null;
  const candidates = toolName === GREP_TOOL
    ? [[toolInput?.path, secretRow], [includes, secretRowOfPattern]]
    : [[toolInput?.file_path, secretRow]];
  for (const [value, rowOf] of candidates) {
    const row = typeof value === 'string' ? rowOf(value) : null;
    if (row) {
      return {
        blocked: true,
        pattern: { id: row.id, reason: `\`${toolName}\` would use the secret file \`${value}\` (${row.reason}). Safe form: ${ASK_USER}. ${NO_RETRY}` },
      };
    }
  }
  return ALLOWED;
}

function check(toolName, toolInput) {
  if (toolName === BASH_TOOL) return checkBashCommand(toolInput?.command);
  const pathResult = checkToolPaths(toolName, toolInput);
  // Also scan content being written for hardcoded secrets
  return finishRefusal(pathResult.blocked ? pathResult : checkWriteContent(toolName, toolInput));
}

if (require.main === module) {
  runHook(HOOK_NAME, [...FILE_TOOLS, GREP_TOOL, BASH_TOOL], (data) => check(data.tool_name, data.tool_input));
} else {
  module.exports = {
    SENSITIVE_FILES, HARDCODED_SECRET_PATTERNS, CONTENT_SCAN_ALLOWLIST, ALLOWLIST, KNOWN_RULE_NAMES, RULES_OFF_VARIABLE,
    check, checkFilePath, checkBashCommand, checkWriteContent, isAllowlisted, isContentScanAllowlisted,
  };
}
