/**
 * Shell Words — the command reader shared by the two safety hooks
 * (block-dangerous-commands.js and protect-secrets.js).
 *
 * It turns the text of one Bash tool call into a flat list of simple
 * commands. A simple command is one program with its words, for example
 * `git reset --hard`. Each command carries its words (quotes removed), its
 * redirects and its here-documents (the `<<EOF` form: text lines that the
 * shell gives to the program as input).
 *
 * What it reads: single quotes, double quotes, `$'...'`, the backslash,
 * comments, the separators `;` `&` `&&` `||` `|` and the line end, subshells
 * `( ... )`, redirects, here-documents (also inside `$( ... )`), `$( ... )`,
 * backticks and `<( ... )` (their text is read as commands), `[[ ... ]]` and
 * `case ... esac`.
 *
 * Text that is a shell command by its position is read again with the same
 * rules ("code text"): `<shell> -c <text>`, `eval <text>`, text piped into a
 * shell, a here-document for a shell, a file that the same call writes and
 * then runs, `ssh host <text>`, `watch <text>`, `find -exec`,
 * `git rebase -x <text>`, and the quoted first argument of a call that starts
 * a process inside `python -c`, `node -e`, `perl -e` or `ruby -e`.
 *
 * It reads text only. It never runs anything, and it does not know the value
 * of a variable, of a file name pattern or of an alias.
 *
 * When the reader cannot read the text to its end (a quote that is not closed,
 * for example), it records a problem. Both hooks refuse such a command: a rule
 * that sees only a part of a command cannot say that the command is harmless.
 */

'use strict';

// How deep code text may lie inside code text (`bash -c "bash -c '...'"`).
const MAX_CODE_DEPTH = 5;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
// Interpreters whose inline program text is searched for calls that start a process.
const INTERPRETERS = /^(python[\d.]*|node|nodejs|ruby|perl|php|deno|bun)$/;
// Words of the shell grammar that can stand in front of a program name.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'coproc']);
// Words that start a construct whose own words are data, not a program with arguments.
const DATA_KEYWORDS = new Set(['for', 'select', 'case', 'esac']);
// Prefix programs: the real program follows them. For each one: the letters of its short options that take
// a value, and the names of its long options that take a value in the next word. Without these lists the
// value (`sudo --user bob git ...`) would be read as the program.
const prefix = (short = '', long = []) => ({ short, long });
const PREFIX_PROGRAMS = {
  sudo: prefix('ugpCDhRTUrt', ['user', 'group', 'prompt', 'close-from', 'chdir', 'host', 'chroot', 'command-timeout', 'other-user', 'role', 'type']),
  doas: prefix('uC'),
  command: prefix(),
  builtin: prefix(),
  exec: prefix('a'),
  nohup: prefix(),
  nice: prefix('n', ['adjustment']),
  time: prefix('of', ['output', 'format']),
  timeout: prefix('ks', ['kill-after', 'signal']),
  xargs: prefix('nIPLsEdaJR', ['max-args', 'max-procs', 'max-lines', 'max-chars', 'eof', 'delimiter', 'arg-file']),
  stdbuf: prefix('ioe', ['input', 'output', 'error']),
  env: prefix('uCS', ['unset', 'chdir', 'split-string']),
  caffeinate: prefix('tw'),
  npx: prefix('p', ['package']),
  pnpx: prefix(),
  bunx: prefix(),
};
const XARGS = 'xargs';
// Programs whose arguments are text that they print. Their words never start a program.
const TEXT_PROGRAMS = new Set(['echo', 'printf']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
// The names of calls that start a process in Python, JavaScript, Perl, Ruby and PHP.
const PROCESS_START_NAMES = 'system|popen|Popen|run|call|check_output|check_call|getoutput|getstatusoutput|exec|execSync|spawn|spawnSync|execFile|execFileSync';
// A quoted text in interpreter code. `group` is the number of the group that holds the quote character.
const quotedText = (quotes, group) => `([${quotes}])((?:\\\\.|(?!\\${group})[^\\\\\\n])*)\\${group}`;
// `/re/.exec('text')` is a method of a regular expression, not a process start.
const NOT_A_REGEXP_METHOD = '(?<!\\/[dgimsuvy]{0,7}\\.)';
// A call with a quoted text as its first argument (`os.system("...")`, `execSync('...')`).
const startWithText = (quotes) => new RegExp(`${NOT_A_REGEXP_METHOD}\\b(${PROCESS_START_NAMES})\\s*\\(\\s*${quotedText(quotes, 2)}`, 'g');
const START_WITH_TEXT = startWithText('\'"');
// JavaScript also quotes a text with backticks. In other languages a backtick in a comment is prose.
const START_WITH_TEXT_SCRIPT = startWithText('\'"`');
const SCRIPT_INTERPRETERS = /^(node|nodejs|deno|bun)$/;
// Perl, Ruby and PHP also write the call without parentheses: `system "..."`.
const START_WITHOUT_PARENTHESES = new RegExp(`\\b(system|exec)\\s+${quotedText('\'"', 2)}`, 'g');
const BARE_CALL_INTERPRETERS = /^(perl|ruby|php)$/;
// A call with a list of words (`subprocess.run(["git", "reset", "--hard"])`), and a call with the
// program and then a list (`spawnSync('git', ['reset', '--hard'])`).
const START_WITH_LIST = new RegExp(`\\b(${PROCESS_START_NAMES})\\s*\\(\\s*\\[([^\\]\\n]*)\\]`, 'g');
const START_WITH_PROGRAM_AND_LIST = new RegExp(`\\b(${PROCESS_START_NAMES})\\s*\\(\\s*${quotedText('\'"`', 2)}\\s*,\\s*\\[([^\\]\\n]*)\\]`, 'g');
const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
// Long options of a shell that take a value in the next word.
const SHELL_LONG_VALUE_OPTIONS = new Set(['--rcfile', '--init-file']);
// A brace list (`{a,b}`) stands for several words. No more words than this are built from one word.
const MAX_BRACE_WORDS = 64;
const SU_COMMAND_PREFIX = '--command=';
const GIT_EXEC_PREFIX = '--exec=';
// Options of ssh that take a value: the word after them is not the host.
const SSH_VALUE_OPTIONS = 'bcDEeFIiJLlmOopQRSWw';
const FIND_EXEC_OPTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>']);
// Letters after a backslash inside `$'...'` and the character that each one stands for.
const ANSI_ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
// What `text` holds in the place of a `$( ... )`, a backtick text or a `<( ... )`.
const SUBSTITUTION_MARK = '$()';

const PROBLEM = {
  singleQuote: 'a single quote is not closed',
  doubleQuote: 'a double quote is not closed',
  backtick: 'a backtick is not closed',
  substitution: 'a `$(` is not closed',
  braces: 'a `${` is not closed',
  parenthesis: 'a `)` has no `(` before it',
  group: 'a `(` is not closed',
  redirect: 'a redirect has no target',
  depth: 'the command text is nested too deeply',
};

// Options of git itself (before the sub-command) that take a value in the next word.
const GIT_GLOBAL_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix', '--attr-source']);

// Windows writes `\` between folders. The hooks compare paths with `/`.
const toPosix = (p) => p.replace(/\\/g, '/');
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
const programName = (text) => baseName(toPosix(text)).replace(/\.exe$/i, '').toLowerCase();
const joinWords = (words) => words.map((w) => w.text).join(' ');

function newWord() {
  // text: the characters without quotes. quoted: a part was quoted or escaped.
  // dynamic: a part is a variable or a substitution, so the real value is unknown.
  // glob: an unquoted `*`, `?` or `[`. tilde: an unquoted `~` at the start.
  // refs: the variables that the word names. subs: for each substitution inside the word, its commands.
  return { text: '', quoted: false, dynamic: false, glob: false, tilde: false, refs: [], subs: [] };
}

/**
 * Reads one text and adds its simple commands to `sink.commands`.
 * `origin` says where the text comes from: { kind: 'top' | 'substitution' | 'code', parent, depth }.
 * `bodyOnly` reads the text as the body of a here-document: only `$`, the
 * backtick and the backslash have a meaning there.
 */
function readText(text, sink, origin, bodyOnly = false) {
  const t = text;
  const n = t.length;
  let i = 0;
  const waiting = [];            // here-documents whose body lines are not read yet
  let openSubstitutions = 0;     // how many `$(` are open at the place that is read
  const fail = (problem) => { if (!sink.problems.includes(problem)) sink.problems.push(problem); };

  // Reads `'...'`. `t[i]` is the opening quote.
  function readSingleQuoted(w) {
    const end = t.indexOf("'", i + 1);
    w.quoted = true;
    if (end === -1) { fail(PROBLEM.singleQuote); w.text += t.slice(i + 1); i = n; return; }
    w.text += t.slice(i + 1, end);
    i = end + 1;
  }

  // Reads `$'...'`: a backslash writes a special character. `t[i]` is the `$`.
  function readAnsiQuoted(w) {
    w.quoted = true;
    i += 2;
    while (i < n && t[i] !== "'") {
      if (t[i] !== '\\') { w.text += t[i++]; continue; }
      const rest = t.slice(i + 1, i + 10);
      const code = /^(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3})/.exec(rest);
      if (code) {
        const digits = /^[xuU]/.test(code[1]) ? parseInt(code[1].slice(1), 16) : parseInt(code[1], 8);
        w.text += String.fromCodePoint(Math.min(digits, 0x10ffff));
        i += 1 + code[1].length;
      } else {
        const letter = t[i + 1] || '';
        w.text += Object.prototype.hasOwnProperty.call(ANSI_ESCAPES, letter) ? ANSI_ESCAPES[letter] : `\\${letter}`;
        i += 2;
      }
    }
    if (i >= n) fail(PROBLEM.singleQuote);
    i++;
  }

  // Reads the inside of `"..."` up to `terminator`. With no terminator it reads to the end of the text.
  function readQuotedRun(w, terminator, owner) {
    w.quoted = true;
    while (i < n) {
      const c = t[i];
      if (terminator && c === terminator) { i++; return; }
      if (c === '\\') {
        const next = t[i + 1];
        if (next === '\n') i += 2;
        else if (next !== undefined && '"\\$`'.includes(next)) { w.text += next; i += 2; }
        else { w.text += c; i++; }
      } else if (c === '$') readDollar(w, true, owner);
      else if (c === '`') readBacktick(w, owner);
      else { w.text += c; i++; }
    }
    if (terminator) fail(PROBLEM.doubleQuote);
  }

  // Reads the commands of a substitution in place. `t[i]` is the first character after the `(`.
  function readSubstitution(w, owner) {
    const first = sink.commands.length;
    openSubstitutions++;
    const closed = readList(')', { kind: 'substitution', parent: owner, depth: origin.depth });
    openSubstitutions--;
    if (!closed) fail(PROBLEM.substitution);
    w.subs.push(sink.commands.slice(first));
    w.text += SUBSTITUTION_MARK;
    w.dynamic = true;
  }

  // Reads `` `...` ``. `t[i]` is the opening backtick.
  function readBacktick(w, owner) {
    let end = i + 1;
    while (end < n && t[end] !== '`') end += t[end] === '\\' ? 2 : 1;
    if (end >= n) fail(PROBLEM.backtick);
    const inner = t.slice(i + 1, end).replace(/\\([`\\$])/g, '$1');
    const first = sink.commands.length;
    readText(inner, sink, { kind: 'substitution', parent: owner, depth: origin.depth });
    w.subs.push(sink.commands.slice(first));
    w.text += SUBSTITUTION_MARK;
    w.dynamic = true;
    i = Math.min(end, n) + 1;
  }

  // Finds the `))` that closes arithmetic text. `innerOpen` is the index of the second `(` of `((`.
  // Returns the index of the first `)` of that `))`, or -1 when the text is not arithmetic (then the
  // two `(` open subshells). The closing parenthesis of every `(` is found once for the whole text,
  // so that many `((` in one text cost no more than one pass.
  let closers = null;
  function arithmeticEnd(innerOpen) {
    if (!closers) {
      closers = new Int32Array(n).fill(-1);
      const open = [];
      for (let j = 0; j < n; j++) {
        if (t[j] === '(') open.push(j);
        else if (t[j] === ')' && open.length) closers[open.pop()] = j;
      }
    }
    const end = closers[innerOpen];
    return end !== -1 && t[end + 1] === ')' ? end : -1;
  }

  // Reads `$(( ... ))`. Returns false when the text is not arithmetic (then it is a `$(` with a subshell).
  function readArithmetic(w, owner) {
    const end = arithmeticEnd(i + 2);
    if (end === -1) return false;
    readText(t.slice(i + 3, end), sink, { kind: 'substitution', parent: owner, depth: origin.depth }, true);
    w.text += SUBSTITUTION_MARK;
    w.dynamic = true;
    i = end + 2;
    return true;
  }

  // Reads `${ ... }`. `t[i]` is the `$`.
  function readBraces(w, inDouble, owner) {
    const at = w.text.length;
    const start = i + 2;
    const inner = newWord();
    i = start;
    let closed = false;
    while (i < n) {
      const c = t[i];
      if (c === '}') { closed = true; break; }
      if (c === '\\') i += 2;
      else if (c === "'" && !inDouble) readSingleQuoted(inner);
      else if (c === '"') { i++; readQuotedRun(inner, '"', owner); }
      else if (c === '$') readDollar(inner, inDouble, owner);
      else if (c === '`') readBacktick(inner, owner);
      else i++;
    }
    if (!closed) { fail(PROBLEM.braces); w.dynamic = true; return; }
    const raw = t.slice(start, i);
    i++;
    w.refs.push(...inner.refs.map((r) => Object.assign({}, r, { plain: false })));
    w.subs.push(...inner.subs);
    const m = /^([#!]?)([A-Za-z_][A-Za-z0-9_]*)([^]*)$/.exec(raw);
    w.dynamic = true;
    if (m && !m[1] && !m[3]) {                                     // `${NAME}` is the same as `$NAME`
      w.refs.push({ name: m[2], at, plain: true, printsValue: true });
      w.text += `$${m[2]}`;
      return;
    }
    // `${NAME:+text}` prints the text and `${#NAME}` prints a length: neither prints the value.
    if (m) w.refs.push({ name: m[2], at, plain: false, printsValue: m[1] !== '#' && !/^:?\+/.test(m[3]) });
    w.text += `\${${raw}}`;
  }

  // Reads one `$...` construct. `t[i]` is the `$`.
  function readDollar(w, inDouble, owner) {
    const next = t[i + 1];
    if (next === '(') {
      if (t[i + 2] === '(' && readArithmetic(w, owner)) return;
      i += 2;
      readSubstitution(w, owner);
      return;
    }
    if (next === '{') { readBraces(w, inDouble, owner); return; }
    if (next === "'" && !inDouble) { readAnsiQuoted(w); return; }
    if (next === '"' && !inDouble) { i += 2; readQuotedRun(w, '"', owner); return; }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(t.slice(i + 1, i + 200));
    if (m) {
      w.refs.push({ name: m[0], at: w.text.length, plain: true, printsValue: true });
      w.text += `$${m[0]}`;
      w.dynamic = true;
      i += 1 + m[0].length;
      return;
    }
    if (next !== undefined && /[0-9@*#?$!-]/.test(next)) { w.text += `$${next}`; w.dynamic = true; i += 2; return; }
    w.text += '$';
    i++;
  }

  // Reads the body lines of every here-document that waits. `i` is at the start of a line.
  function readHereDocBodies() {
    while (waiting.length) {
      const h = waiting.shift();
      const lines = [];
      while (i < n) {
        let end = t.indexOf('\n', i);
        if (end === -1) end = n;
        const line = t.slice(i, end);
        const tabs = h.strip ? /^\t*/.exec(line)[0].length : 0;
        // A text with Windows line ends has a carriage return at the end of each line.
        const content = line.slice(tabs).replace(/\r$/, '');
        // bash also ends the body at `<delimiter>)` inside `$( ... )`; zsh does not. The reader takes the
        // reading of bash, because it leaves the text after that line visible to the rules.
        if (openSubstitutions > 0 && content.startsWith(`${h.delimiter})`)) { i += tabs + h.delimiter.length; break; }
        i = Math.min(end + 1, n);
        if (content === h.delimiter) break;
        lines.push(line);
      }
      const body = lines.join('\n');
      h.command.hereDocs.push(body);
      // With a delimiter that is not quoted, the shell runs each `$( ... )` and backtick text of the body.
      if (!h.literal) readText(body, sink, { kind: 'substitution', parent: h.command, depth: origin.depth }, true);
    }
  }

  // Reads commands up to the end of the text, or up to the `)` that closes a substitution.
  // Returns true when it stopped at that `)`.
  function readList(closer, listOrigin) {
    let scope = sink.scopes++;     // a number for the list or the subshell in which a command stands
    const groups = [];             // for each open "(" of this list, the scope around it
    let plainWords = 0;            // words of the present command that are not keywords
    let plainWordsNotFor = 0;      // the same, without the word `for`
    let caseDepth = 0;
    let pipeline = sink.pipelines++;
    let previous = null;           // the command before the present one in this list
    let w = null;
    let pending = null;            // a redirect operator that waits for its target word
    let inTest = false;            // between `[[` and `]]`: operators are plain characters there
    const newCommand = () => ({
      words: [], redirects: [], hereDocs: [], separator: '', previous: null,
      pipeline, scope, origin: listOrigin, order: sink.order++,
    });
    let cmd = newCommand();
    const word = () => (w || (w = newWord()));
    const atCommandStart = () => plainWords === 0;
    const arithmeticAllowed = () => !w && plainWordsNotFor === 0;

    const endWord = () => {
      if (!w) return;
      const done = w;
      w = null;
      if (pending) {
        cmd.redirects.push({ op: pending, target: done });
        if (pending === '<<' || pending === '<<-') {
          waiting.push({ delimiter: done.text, strip: pending === '<<-', literal: done.quoted, command: cmd });
        }
        pending = null;
        return;
      }
      if (!done.quoted && atCommandStart()) {
        if (done.text === '[[') inTest = true;
        if (done.text === 'case') caseDepth++;
        if (done.text === 'esac' && caseDepth > 0) caseDepth--;
      }
      if (done.text === ']]') inTest = false;
      if (done.quoted || !KEYWORDS.has(done.text)) {
        plainWords++;
        if (done.text !== 'for') plainWordsNotFor++;
      }
      cmd.words.push(done);
    };

    const endCommand = (separator) => {
      endWord();
      if (pending) { fail(PROBLEM.redirect); pending = null; }
      inTest = false;
      cmd.separator = separator;
      if (cmd.words.length || cmd.redirects.length) {
        cmd.previous = previous;
        previous = cmd;
        Object.assign(cmd, resolveProgram(cmd.words));
        sink.commands.push(cmd);
        const members = sink.pipelineMembers.get(cmd.pipeline);
        if (members) members.push(cmd); else sink.pipelineMembers.set(cmd.pipeline, [cmd]);
      }
      if (separator !== '|') pipeline = sink.pipelines++;
      if (separator === '(') { groups.push(scope); scope = sink.scopes++; }
      if (separator === ')') scope = groups.pop();
      plainWords = 0;
      plainWordsNotFor = 0;
      cmd = newCommand();
    };

    while (i < n) {
      const c = t[i];
      if (c === '\\') {
        if (t[i + 1] === '\n') { i += 2; continue; }
        word().text += t[i + 1] || '';
        w.quoted = true;
        i += 2;
        continue;
      }
      if (c === "'") { readSingleQuoted(word()); continue; }
      if (c === '"') { i++; readQuotedRun(word(), '"', cmd); continue; }
      if (c === '$') { readDollar(word(), false, cmd); continue; }
      if (c === '`') { readBacktick(word(), cmd); continue; }
      if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue; }
      if (c === '\n') { endCommand(';'); i++; readHereDocBodies(); continue; }
      if (c === '#' && !w) { const end = t.indexOf('\n', i); i = end === -1 ? n : end; continue; }
      if (c === ';') { endCommand(';'); i++; continue; }
      if (inTest && '()|&<>'.includes(c) && !(w && w.text === ']]')) { word().text += c; i++; continue; }
      if ((c === '<' || c === '>') && t[i + 1] === '(') { i += 2; readSubstitution(word(), cmd); continue; }
      if (c === '(') {
        if (t[i + 1] === '(' && arithmeticAllowed()) {                 // `(( ... ))`: arithmetic, no command inside
          const end = arithmeticEnd(i + 1);
          if (end !== -1) { i = end + 2; continue; }
        }
        endCommand('(');
        i++;
        continue;
      }
      if (c === ')') {
        endWord();                                                     // `esac)` : the word ends the `case` first
        if (groups.length) endCommand(')');
        else if (caseDepth > 0) endCommand(';');                       // the end of a pattern of `case`
        else if (closer === ')') { endCommand(''); i++; return true; }
        else { fail(PROBLEM.parenthesis); endCommand(';'); }
        i++;
        continue;
      }
      if (c === '|') {
        if (t[i + 1] === '|') { endCommand('||'); i += 2; } else { endCommand('|'); i += t[i + 1] === '&' ? 2 : 1; }
        continue;
      }
      if (c === '&' && t[i + 1] !== '>') {
        if (t[i + 1] === '&') { endCommand('&&'); i += 2; } else { endCommand('&'); i++; }
        continue;
      }
      if (c === '<' || c === '>' || c === '&') {
        if (w && !w.quoted && /^\d+$/.test(w.text)) w = null; else endWord();   // a file descriptor number before the operator
        const op = /^(&>>|&>|<<<|<<-|<<|<&|<>|<|>>|>\||>&|>)/.exec(t.slice(i, i + 3))[1];
        i += op.length;
        const copy = (op === '>&' || op === '<&') && /^(\d+|-)/.exec(t.slice(i, i + 8));
        if (copy) { i += copy[1].length; continue; }                   // `2>&1`, `>&2`, `<&-`: no file is named
        if (pending) fail(PROBLEM.redirect);
        pending = op;
        continue;
      }
      word();
      if (c === '~' && w.text === '' && !w.quoted) w.tilde = true;
      if (c === '*' || c === '?' || c === '[') w.glob = true;
      w.text += c;
      i++;
    }
    endCommand(';');
    if (groups.length) fail(PROBLEM.group);
    readHereDocBodies();
    return false;
  }

  if (bodyOnly) {
    const owner = origin.parent;
    readQuotedRun(newWord(), null, owner);
    return;
  }
  readList(null, origin);
}

/**
 * Skips the own options of a program. `i` is the index of the first word after
 * the program name. Returns the index of the first word that is not an option.
 * `shortWithValue`: the letters of short options that take a value.
 * `longWithValue`: the names of long options that take a value in the next word.
 */
function skipOptions(words, i, shortWithValue = '', longWithValue = []) {
  for (; i < words.length; i++) {
    const v = words[i].text;
    if (v === '--') return i + 1;
    if (!v.startsWith('-') || v === '-') return i;
    if (v.startsWith('--')) {
      if (!v.includes('=') && longWithValue.includes(v.slice(2))) i++;
      continue;
    }
    // In a group of short options (`-Eu bob`) the option that takes a value is the last letter.
    const k = [...v.slice(1)].findIndex((letter) => shortWithValue.includes(letter));
    if (k !== -1 && k === v.length - 2) i++;
  }
  return i;
}

/**
 * Removes keywords, variable assignments and prefix programs from the words of
 * one simple command. Returns the real program (lower case, without folder)
 * and its arguments.
 */
function resolveProgram(words) {
  const assignments = [];
  const prefixes = [];
  const result = (program, args, bare = false) => ({ program, args, assignments, prefixes, bare });
  let i = 0;
  for (;;) {
    for (; i < words.length; i++) {
      const first = words[i];
      if (ASSIGNMENT.test(first.text)) assignments.push(first);
      else if (!first.quoted && first.text === 'function') i++;
      else if (first.quoted || !KEYWORDS.has(first.text)) break;
    }
    if (i >= words.length) return result('', []);
    if (!words[i].quoted && DATA_KEYWORDS.has(words[i].text)) return result('', []);
    const program = programName(words[i].text);
    const isPrefix = Object.prototype.hasOwnProperty.call(PREFIX_PROGRAMS, program)
      && !(program === 'command' && words[i + 1] && /^-[vV]$/.test(words[i + 1].text));
    if (!isPrefix) return result(program, words.slice(i + 1));
    prefixes.push(program);
    const own = PREFIX_PROGRAMS[program];
    i = skipOptions(words, i + 1, own.short, own.long);
    if (program === 'env') for (; i < words.length && ASSIGNMENT.test(words[i].text); i++) assignments.push(words[i]);
    if (program === 'timeout' && i < words.length) i++;                // the duration
    if (i >= words.length) return result(program, [], true);
  }
}

// Builds a command from words that another program runs as they are (`find -exec`, `git bisect run`).
function derivedCommand(words, parent, sink) {
  const cmd = {
    words, redirects: [], hereDocs: [], separator: ';', previous: null, pipeline: sink.pipelines++,
    scope: sink.scopes++, origin: { kind: 'code', parent, depth: parent.origin.depth + 1 }, order: sink.order++,
  };
  return Object.assign(cmd, resolveProgram(words));
}

/**
 * Splits arguments into short option letters, long option names and operands.
 * `shortWithValue`: the letters of short options that take a value.
 * `longWithValue`: the names of long options that take a value in the next word.
 */
function splitArgs(args, shortWithValue = '', longWithValue = []) {
  const short = new Set();
  const long = [];
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const v = args[i].text;
    if (v === '--') { operands.push(...args.slice(i + 1)); break; }
    if (v.startsWith('--')) {
      const name = v.slice(2).split('=')[0];
      long.push(name);
      if (!v.includes('=') && longWithValue.includes(name)) i++;
    } else if (/^-[A-Za-z0-9]/.test(v)) {
      for (let k = 1; k < v.length; k++) {
        short.add(v[k]);
        if (shortWithValue.includes(v[k])) { if (k === v.length - 1) i++; break; }
      }
    } else operands.push(args[i]);
  }
  return { short, long, operands };
}

/**
 * Splits the arguments of git: the options of git itself (`-C <dir>`,
 * `-c k=v`, `--no-pager`), the sub-command, and the words after it.
 */
function gitCall(args) {
  let i = 0;
  while (i < args.length && args[i].text.startsWith('-')) i += GIT_GLOBAL_VALUE.has(args[i].text) ? 2 : 1;
  return { globals: args.slice(0, i), sub: args[i] ? args[i].text : '', rest: args.slice(i + 1) };
}

/**
 * The words that the brace lists of a word stand for: `{a,b}/x` gives `a/x`
 * and `b/x`. Returns null when they are more than MAX_BRACE_WORDS.
 */
function expandBraces(text) {
  let words = [text];
  for (;;) {
    const next = words.flatMap((word) => {
      const m = /^([^]*?)\{([^{}]*,[^{}]*)\}([^]*)$/.exec(word);
      return m ? m[2].split(',').map((part) => m[1] + part + m[3]) : [word];
    });
    if (next.length === words.length) return words;
    if (next.length > MAX_BRACE_WORDS) return null;
    words = next;
  }
}

// True when one long option is `full` or a shortened form of it. git and the GNU programs accept shortened forms.
const hasLong = (long, full) => long.some((l) => l.length > 0 && full.startsWith(l));

// The word that follows `-c` of a shell, at any place in the words (`docker run img sh -c "..."`).
// Other options of the shell may stand before it (`bash -euo pipefail -c`, `bash --login -c`, `bash -c --`).
function shellCodeWord(words) {
  const k = words.findIndex((x) => SHELLS.has(programName(x.text)));
  if (k === -1) return null;
  let hasCode = false;
  for (let j = k + 1; j < words.length; j++) {
    const v = words[j].text;
    if (v === '--') return (hasCode && words[j + 1]) || null;
    if (v.startsWith('--')) { if (SHELL_LONG_VALUE_OPTIONS.has(v)) j++; continue; }
    if (!/^[-+][A-Za-z]+$/.test(v)) return hasCode ? words[j] : null;
    if (v[0] === '-' && v.includes('c')) hasCode = true;
    if (/[oO]$/.test(v)) j++;                                          // `-o pipefail`, `-euo pipefail`
  }
  return null;
}

// The texts that a file write of this command stores: a here-document, or the words of `echo` / `printf`.
function writtenTexts(c) {
  if (!TEXT_PROGRAMS.has(c.program)) return c.hereDocs;
  // `printf 'a\nb'` writes two lines: the two characters `\n` in an argument stand for a line end.
  const printed = [joinWords(c.args), ...c.args.map((a) => a.text)].map((x) => x.replace(/\\n/g, '\n'));
  return [...c.hereDocs, ...printed];
}

// The texts that the substitutions inside a word print, as far as the text shows them:
// `"$(cat <<'EOF' ... EOF)"` prints the here-document, `"$(echo ...)"` prints its words.
const printedBy = (word) => word.subs.flatMap((commands) => commands.flatMap(writtenTexts));

// The quoted texts of a list in interpreter code: `["git", "reset", "--hard"]` gives three texts.
function stringLiterals(code) {
  return [...code.matchAll(STRING_LITERAL)].map((m) => m[2].replace(/\\(.)/g, '$1'));
}

/**
 * What interpreter code gives to a new process, as far as plain texts show it.
 * Returns { texts, lists }. `texts`: the quoted first argument of a call that
 * starts a process (`os.system("...")`, `execSync('...')`, Perl `system "..."`);
 * a shell reads it. `lists`: the words of a call with a list
 * (`subprocess.run(["git", "reset", "--hard"])`, `spawnSync('git', ['reset'])`);
 * the program gets them as they are.
 */
function processStarts(code, interpreter) {
  const unescape = (text) => text.replace(/\\(.)/g, '$1');
  const texts = [...code.matchAll(SCRIPT_INTERPRETERS.test(interpreter) ? START_WITH_TEXT_SCRIPT : START_WITH_TEXT)].map((m) => unescape(m[3]));
  if (BARE_CALL_INTERPRETERS.test(interpreter)) texts.push(...[...code.matchAll(START_WITHOUT_PARENTHESES)].map((m) => unescape(m[3])));
  const lists = [...code.matchAll(START_WITH_LIST)].map((m) => stringLiterals(m[2]));
  lists.push(...[...code.matchAll(START_WITH_PROGRAM_AND_LIST)].map((m) => [unescape(m[3]), ...stringLiterals(m[4])]));
  return { texts, lists: lists.filter((list) => list.length) };
}

// The interpreter that a script text names in its first line (`#!/usr/bin/env python3`), or '' for a shell script.
function scriptInterpreter(text) {
  const m = /^#!\s*(\S+)(?:[ \t]+(\S+))?/.exec(text);
  if (!m) return '';
  const name = programName(m[1]) === 'env' && m[2] ? programName(m[2]) : programName(m[1]);
  return SHELLS.has(name) ? '' : name;
}

/**
 * Finds the code texts of one command: text that a shell will run because of
 * its position. Returns { texts: [string], derived: [command] }.
 * `written`: the files that earlier commands of the same call wrote, by file name.
 */
function codeOf(c, sink, written) {
  const texts = [];
  const derived = [];
  const all = c.words.filter((x) => !ASSIGNMENT.test(x.text));
  const pushWord = (word) => texts.push(word.text, ...printedBy(word));
  const codeWord = TEXT_PROGRAMS.has(c.program) ? null : shellCodeWord(all);
  if (codeWord) pushWord(codeWord);
  const isShell = SHELLS.has(c.program);
  const isInterpreter = INTERPRETERS.test(c.program);
  const literalWord = (text) => Object.assign(newWord(), { text, quoted: true });
  const readInterpreterCode = (code, interpreter) => {
    const starts = processStarts(code, interpreter);
    texts.push(...starts.texts);
    derived.push(...starts.lists.map((list) => derivedCommand(list.map(literalWord), c, sink)));
  };
  // The texts that the other members of the pipe print, as far as the text shows them.
  const pipedTexts = () => (sink.pipelineMembers.get(c.pipeline) || []).filter((d) => d !== c).flatMap(writtenTexts);
  if (isShell) {
    texts.push(...c.hereDocs);
    for (const r of c.redirects) if (r.op === '<<<') pushWord(r.target);
    const operands = splitArgs(c.args, 'cOo').operands.filter((a) => a.text !== '-');
    // The shell reads its commands from a pipe: the text of the other pipe members is the script.
    // One pipe is read once, also when several shells stand in it.
    if (!codeWord && operands.length === 0 && !sink.pipelinesRead.has(c.pipeline)) {
      sink.pipelinesRead.add(c.pipeline);
      texts.push(...pipedTexts());
    }
  }
  // The file that the command runs: the first operand of a shell, of an interpreter or of `source`,
  // else the command word itself when it is written as a path (`./run.sh`).
  const runsScript = isShell || isInterpreter || c.program === 'source' || c.program === '.';
  const script = runsScript ? c.args.find((a) => !a.text.startsWith('-')) : all.find((x) => x.text.includes('/') && programName(x.text) === c.program);
  // A written file runs as shell text, or, when it names an interpreter, its process-start calls run.
  // Each stored text is read once: the list of a file is empty after the first command that runs it.
  const scriptName = script ? baseName(script.text) : '';
  for (const text of written.get(scriptName) || []) {
    const interpreter = isInterpreter ? c.program : scriptInterpreter(text);
    if (!interpreter) texts.push(text);
    else if (INTERPRETERS.test(interpreter)) readInterpreterCode(text, interpreter);
  }
  if (written.has(scriptName)) written.set(scriptName, []);
  const store = (word, stored) => {
    if (word.dynamic || !stored.length) return;
    const name = baseName(word.text);
    if (!written.has(name)) written.set(name, []);
    written.get(name).push(...stored);
  };
  for (const r of c.redirects) if (WRITE_REDIRECTS.has(r.op)) store(r.target, writtenTexts(c));
  // `tee <file>` writes its input: its own here-document, or the text of the other pipe members.
  if (c.program === 'tee') {
    const input = [...c.hereDocs, ...pipedTexts()];
    for (const a of c.args) if (!a.text.startsWith('-')) store(a, input);
  }
  if (c.program === 'eval') texts.push(joinWords(c.args), ...c.args.flatMap(printedBy));
  // ssh and watch join every word after their own options to one text, and a shell reads that text.
  if (c.program === 'ssh') texts.push(joinWords(c.args.slice(skipOptions(c.args, 0, SSH_VALUE_OPTIONS) + 1)));
  if (c.program === 'watch') texts.push(joinWords(c.args.slice(skipOptions(c.args, 0, 'n', ['interval']))));
  if (c.program === 'su') {
    c.args.forEach((a, j) => {
      if ((a.text === '-c' || a.text === '--command') && c.args[j + 1]) pushWord(c.args[j + 1]);
      if (a.text.startsWith(SU_COMMAND_PREFIX)) texts.push(a.text.slice(SU_COMMAND_PREFIX.length));
    });
  }
  if (c.program === 'tmux' && c.args[0] && c.args[0].text === 'send-keys') texts.push(...c.args.slice(1).map((a) => a.text));
  if (c.program === 'osascript') {
    for (const m of joinWords(c.args).matchAll(/do shell script\s+"((?:[^"\\]|\\.)*)"/g)) texts.push(m[1].replace(/\\(.)/g, '$1'));
  }
  if (c.program === 'git') {
    const { sub, rest } = gitCall(c.args);
    const afterOptions = (list) => list.slice(skipOptions(list, 0));
    const inner = afterOptions(rest);
    if (sub === 'submodule' && inner[0] && inner[0].text === 'foreach') texts.push(joinWords(afterOptions(inner.slice(1))));
    if (sub === 'bisect' && inner[0] && inner[0].text === 'run' && inner[1]) derived.push(derivedCommand(inner.slice(1), c, sink));
    if (sub === 'rebase') {
      rest.forEach((a, j) => {
        if ((a.text === '-x' || a.text === '--exec') && rest[j + 1]) texts.push(rest[j + 1].text);
        if (a.text.startsWith(GIT_EXEC_PREFIX)) texts.push(a.text.slice(GIT_EXEC_PREFIX.length));
      });
    }
  }
  if (isInterpreter) readInterpreterCode([...c.args.map((a) => a.text), ...c.hereDocs].join('\n'), c.program);
  if (c.program === 'find') {                                         // the words after each `-exec` are a command
    let words = null;
    for (const a of c.args) {
      const ends = a.text === ';' || a.text === '+';
      if (words && !ends && !FIND_EXEC_OPTIONS.has(a.text)) { words.push(a); continue; }
      if (words && words.length) derived.push(derivedCommand(words, c, sink));
      words = FIND_EXEC_OPTIONS.has(a.text) ? [] : null;
    }
    if (words && words.length) derived.push(derivedCommand(words, c, sink));
  }
  return { texts: texts.filter(Boolean), derived };
}

/**
 * Reads the text of one Bash tool call.
 * Returns { commands, problems }: the simple commands in the order of the
 * text, and the reasons why the text could not be read to its end (an empty
 * list when it was read completely).
 */
function readCommand(text) {
  const sink = {
    commands: [], problems: [], scopes: 0, pipelines: 0, order: 0,
    pipelineMembers: new Map(), pipelinesRead: new Set(),
  };
  readText(String(text || ''), sink, { kind: 'top', parent: null, depth: 0 });
  sink.commands.sort((a, b) => a.order - b.order);
  const written = new Map();
  for (let k = 0; k < sink.commands.length; k++) {
    const c = sink.commands[k];
    const { texts, derived } = codeOf(c, sink, written);
    sink.commands.push(...derived);
    if (!texts.length) continue;
    const depth = c.origin.depth + 1;
    if (depth > MAX_CODE_DEPTH) { sink.problems.push(PROBLEM.depth); continue; }
    for (const code of texts) readText(code, sink, { kind: 'code', parent: c, depth });
  }
  return { commands: sink.commands, problems: sink.problems };
}

module.exports = {
  readCommand, splitArgs, hasLong, gitCall, expandBraces, toPosix, baseName,
  SHELLS, INTERPRETERS, ASSIGNMENT, XARGS, TEXT_PROGRAMS, FIND_EXEC_OPTIONS, SUBSTITUTION_MARK,
};
