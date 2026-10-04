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
 * pattern of `grep`, a commit message), or an option whose value the program
 * loads without printing it (`--env-file`, `ssh -i`, `curl --cacert`).
 * A program that is not named in such a table is refused.
 *
 * A Bash command that the reader cannot read to its end is refused.
 *
 * Limits. The hook reads text; it cannot see these, and passes them:
 *   - a variable that holds the path (`F=.env; cat "$F"`), and an alias;
 *   - a script file that exists already, `make`, `npm run`;
 *   - a read of a whole folder (`grep -r KEY .`, `tar czf all.tgz .`);
 *   - a file name pattern that does not start with a dot (`cat *`);
 *   - `xargs` that gets file names from a program other than `find`, `ls`,
 *     `echo` or `printf`;
 *   - code of an interpreter (`python3 -c "open('.env')"`), except the quoted
 *     first argument of a call that starts a process;
 *   - a command that is written to hide its meaning on purpose.
 *
 * Based on claude-code-hooks by karanb192 (MIT License).
 * Adapted for superpowers-orchestrator plugin with cross-platform support.
 *
 * Logs blocked operations to: ~/.claude/hooks-logs/YYYY-MM-DD.jsonl
 */

'use strict';

const {
  splitArgs, hasLong, gitCall, toPosix, ASSIGNMENT, XARGS, TEXT_PROGRAMS, FIND_EXEC_OPTIONS,
} = require('./shell-words');
const { runHook, refusal, decideCommand, firstRefusal, ALLOWED, BASH_TOOL, NO_RETRY } = require('./hook-io');

const HOOK_NAME = 'protect-secrets';
const GREP_TOOL = 'Grep';
const FILE_TOOLS = ['Read', 'Edit', 'Write'];
const WRITE_TOOLS = ['Edit', 'Write'];
const ASK_USER = 'ask the user to create or change the file, or to give you the one value that the task needs';

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
  { id: 'proc-environ',       regex: /^\/proc\/[^/]+\/environ$/,                      reason: 'the environment of a process' },
];
// A public key is not a secret.
const PUBLIC_KEY = /\.pub$/;
// Names that a file name pattern which starts with a dot (`.e*`, `.env*`) is tested against.
const HIDDEN_SAMPLE_NAMES = ['.env', '.env.local', '.envrc', '.netrc', '.npmrc', '.pypirc', '.pgpass', '.vault-token', '.htpasswd', '.my.cnf'];
const PATTERN_CHARACTERS = /[*?[]/;
// Characters after which a word can hold a path: `if=.env`, `file=@.env`, `HEAD:.env`, `src=.npmrc,x`.
const PATH_STARTS = '=@:,';

// Programs that neither print nor change the content of a file that they name.
const NO_CONTENT_PROGRAMS = new Set(['ls', 'test', '[', '[[', 'stat', 'chmod', 'touch']);
// `find` only lists names, unless it runs or deletes what it finds.
const FIND = 'find';
const FIND_DELETE = '-delete';
// Programs that print their own arguments or the names of files. Piped into `xargs`, those names become operands.
const NAME_SOURCES = new Set([FIND, 'ls', ...TEXT_PROGRAMS]);
// Shell words that give a value to a variable: an argument `NAME=path` is not an operand.
const DECLARING_PROGRAMS = new Set(['export', 'declare', 'typeset', 'local', 'readonly']);
// Programs that load the key files which they name and do not print them.
const LOADER_PROGRAMS = new Set(['ssh-add']);
// Programs whose first operand is a pattern or a program text, not a file.
// `value`: the short options that take a value. `pattern`: the short options whose value is the pattern
// or a file of patterns; with one of them every operand is a file.
// A letter that is wrongly in `value` would hide the real pattern and exempt a file, so each list is short.
const PATTERN_FIRST_PROGRAMS = {
  grep: { value: 'efABCmdD', pattern: 'ef' },
  rg: { value: 'efgtABCm', pattern: 'ef' },
  sed: { value: 'ef', pattern: 'ef' },
  awk: { value: 'fFv', pattern: 'f' },
  jq: { value: 'f', pattern: 'f' },
};
const PATTERN_FIRST_LONG_VALUE = ['regexp', 'file', 'after-context', 'before-context', 'context', 'max-count',
  'include', 'exclude', 'exclude-dir', 'glob', 'type', 'expression', 'field-separator', 'assign', 'from-file'];
// The long options whose value is the pattern or a file of patterns.
const PATTERN_OPTION_LONG = ['regexp', 'file', 'expression', 'from-file'];
// Options whose value the program loads or skips; it does not print the file. '*': every program.
const LOADER_OPTIONS = {
  '*': ['--env-file', '--exclude'],
  ssh: ['-i'], scp: ['-i'], 'ssh-keygen': ['-f'],
  curl: ['--cacert', '--cert', '--key'],
  kubectl: ['--kubeconfig'],
  gcloud: ['--key-file'], npm: ['--userconfig'], twine: ['--config-file'], keytool: ['-keystore'],
  docker: ['--secret'], dotenv: ['-e'], 'dotenv-cli': ['-e'],
  'openssl x509': ['-in'], 'openssl req': ['-key'], 'openssl genrsa': ['-out'],
};
// Options whose value is text for a person, not a path. Short options also count at the end of a group (`-am`).
const TEXT_OPTIONS = {
  git: ['-m', '--message', '--grep', '-S', '-G'],
  gh: ['-t', '--title', '-b', '--body'],
};
// Sub-commands of git that do not print or store the content of the files that they name.
const GIT_NO_CONTENT = new Set(['check-ignore', 'ls-files', 'status']);
// The name of a variable ends with a secret word: API_KEY and GITHUB_TOKEN match, TOKEN_COUNT and AUTHOR do not.
const SECRET_NAME = /(^|_)(SECRET|KEY|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|AUTH)$/i;
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

function isAllowlisted(filePath) {
  return Boolean(filePath) && ALLOWLIST.some(p => p.test(normalizePath(filePath)));
}

// The row of the path table that refuses this path, or null.
function secretRow(filePath) {
  if (!filePath) return null;
  const p = normalizePath(filePath);
  if (PUBLIC_KEY.test(p) || ALLOWLIST.some(a => a.test(p))) return null;
  return SENSITIVE_FILES.find(row => row.regex.test(p)) || null;
}

// A file name pattern of the shell as a regular expression: `*` is any text, `?` is one character,
// `[a-z]` is a set of characters. A set that is not valid is read as plain characters.
function patternToRegex(name) {
  const source = (plain) => name.replace(plain, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  try {
    return new RegExp(`^${source(/[.+^${}()|\\]/g)}$`);
  } catch {
    return new RegExp(`^${source(/[.+^${}()|\\[\]]/g)}$`);
  }
}

// The row for a file name pattern: the pattern itself, or, for a pattern that starts with a dot, a secret name that it matches.
function secretRowOfPattern(pattern) {
  const direct = secretRow(pattern);
  if (direct || !PATTERN_CHARACTERS.test(pattern)) return direct;
  const p = normalizePath(pattern);
  const dir = p.slice(0, p.lastIndexOf('/') + 1);
  const name = p.slice(dir.length);
  if (!name.startsWith('.')) return null;
  const asRegex = patternToRegex(name);
  const sample = HIDDEN_SAMPLE_NAMES.find(s => asRegex.test(s));
  return sample ? secretRow(dir + sample) : null;
}

function checkFilePath(filePath) {
  const row = secretRow(filePath);
  return { blocked: Boolean(row), pattern: row };
}

// The row for a Bash word: the word itself, and the text after each character that can start a path inside it.
function secretRowOfWord(word) {
  const v = word.text;
  const parts = [v];
  for (let i = 0; i < v.length; i++) if (PATH_STARTS.includes(v[i])) parts.push(v.slice(i + 1));
  for (const part of parts) {
    const row = secretRowOfPattern(part);
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

  const loaderKey = program === 'openssl' && texts[0] ? `openssl ${texts[0]}` : program;
  const loaders = [...LOADER_OPTIONS['*'], ...(LOADER_OPTIONS[loaderKey] || [])];
  const textOptions = TEXT_OPTIONS[program] || [];
  let words = c.args.filter((a, k) => !isValueOf(c.args, k, loaders) && !isValueOf(c.args, k, textOptions, true));

  if (program === 'git') {
    const { sub, rest } = gitCall(c.args);
    const cached = sub === 'rm' && hasLong(splitArgs(rest).long, 'cached');
    if (GIT_NO_CONTENT.has(sub) || cached) return [];
  }
  if (program === 'cp') {
    // `cp -n` never replaces a file that exists, so its last operand, the destination, may name the file.
    // With `-t <folder>` the last operand is a source.
    const a = splitArgs(words);
    const keepsDestination = a.short.has('n') || a.long.includes('no-clobber');
    const namesFolderFirst = a.short.has('t') || a.long.includes('target-directory');
    if (keepsDestination && !namesFolderFirst) words = words.filter(x => x !== a.operands[a.operands.length - 1]);
  }
  if (Object.prototype.hasOwnProperty.call(PATTERN_FIRST_PROGRAMS, program)) {
    const options = PATTERN_FIRST_PROGRAMS[program];
    const a = splitArgs(words, options.value, PATTERN_FIRST_LONG_VALUE);
    const patternInOption = [...options.pattern].some(o => a.short.has(o)) || PATTERN_OPTION_LONG.some(o => a.long.includes(o));
    const pattern = patternInOption ? null : a.operands[0];
    words = words.filter(x => x !== pattern);
  }
  return words;
}

// A program that prints every variable of the environment.
function dumpsEnvironment(c) {
  const names = c.args.filter(a => !a.text.startsWith('-'));
  const noSecretName = names.length > 0 && names.every(a => /^[A-Za-z_][A-Za-z0-9_]*$/.test(a.text) && !SECRET_NAME.test(a.text));
  if (c.program === 'printenv') return !noSecretName;
  if (c.program === 'env') return Boolean(c.bare);
  if (ENV_LISTERS.has(c.program)) return c.args.every(a => /^-[px]+$/.test(a.text));
  return c.program === 'set' && c.args.length === 0;
}

// The variable with a secret name whose value `echo`, `printf` or a here-string would print.
function printedSecretVariable(c) {
  const hereStrings = c.redirects.filter(r => r.op === '<<<').map(r => r.target);
  const words = [...(TEXT_PROGRAMS.has(c.program) ? c.args : []), ...hereStrings];
  const ref = words.flatMap(w => w.refs).find(r => r.printsValue && SECRET_NAME.test(r.name));
  return ref ? ref.name : null;
}

function fileRefusal(row, what) {
  return refusal(row.id, `${what} (${row.reason}).`, ASK_USER);
}

function checkOne(c, commands) {
  for (const r of c.redirects) {
    if (r.op.startsWith('<<')) continue;                               // a here-document or a here-string: text, not a file
    const row = secretRowOfWord(r.target);
    const effect = r.op.includes('>') ? 'write' : 'read';
    if (row) return fileRefusal(row, `The redirect \`${r.op}\` would ${effect} the secret file \`${r.target.text}\``);
  }
  if (dumpsEnvironment(c)) {
    return refusal('env-dump', `\`${c.program}\` would print every variable of the environment, and some hold secrets.`,
      '`printenv NAME` for one variable that is not a secret, or `echo "${NAME:+set}"` to see whether a variable is set');
  }
  const secretVariable = printedSecretVariable(c);
  if (secretVariable) {
    return refusal('echo-secret-var', `\`${c.program}\` would print the value of the secret variable \`${secretVariable}\`.`,
      `\`echo "\${${secretVariable}:+set}"\` shows whether it is set and does not print the value`);
  }
  const feedsXargs = commands.some(d => d.pipeline === c.pipeline && d.order > c.order && d.prefixes.includes(XARGS));
  for (const word of testedWords(c, feedsXargs)) {
    const row = secretRowOfWord(word);
    if (row) return fileRefusal(row, `\`${c.program}\` would use the secret file \`${word.text}\``);
  }
  return null;
}

function checkBashCommand(cmd) {
  if (!cmd) return ALLOWED;
  return decideCommand(cmd, (commands) => firstRefusal(commands, (c) => checkOne(c, commands)));
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

  for (const p of HARDCODED_SECRET_PATTERNS) {
    if (p.regex.test(content)) {
      return {
        blocked: true,
        pattern: {
          id: `hardcoded-${p.id}`,
          reason: `Hardcoded ${p.name} detected in content. Do not write the value into a file. Write code that reads it from the environment (process.env.${p.envHint}), and ask the user to store the value. ${NO_RETRY}`,
        },
      };
    }
  }
  return ALLOWED;
}

// Read, Edit, Write name one file. Grep names a file or folder (`path`) and a file name pattern (`glob`).
function checkToolPaths(toolName, toolInput) {
  const candidates = toolName === GREP_TOOL
    ? [[toolInput?.path, secretRow], [toolInput?.glob, secretRowOfPattern]]
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
  return pathResult.blocked ? pathResult : checkWriteContent(toolName, toolInput);
}

if (require.main === module) {
  runHook(HOOK_NAME, [...FILE_TOOLS, GREP_TOOL, BASH_TOOL], (data) => check(data.tool_name, data.tool_input));
} else {
  module.exports = {
    SENSITIVE_FILES, HARDCODED_SECRET_PATTERNS, CONTENT_SCAN_ALLOWLIST, ALLOWLIST,
    check, checkFilePath, checkBashCommand, checkWriteContent, isAllowlisted, isContentScanAllowlisted,
  };
}
