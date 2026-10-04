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
// Prefix programs: the real program follows them. Value: the short options of the prefix that take a value.
const PREFIX_PROGRAMS = {
  sudo: 'ugpCDhRTUrt', doas: 'uC', command: '', builtin: '', exec: 'a', nohup: '', nice: 'n', time: 'of',
  timeout: 'ks', xargs: 'nIPLsEdaJR', stdbuf: 'ioe', env: 'uCS', npx: 'p', pnpx: '', bunx: '',
};
const XARGS = 'xargs';
// Programs whose arguments are text that they print. Their words never start a program.
const TEXT_PROGRAMS = new Set(['echo', 'printf']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
// A call that starts a process, with a quoted text as its first argument (`os.system("...")`, `execSync('...')`).
const PROCESS_START_CALL = /\b(system|popen|Popen|run|call|check_output|check_call|getoutput|getstatusoutput|exec|execSync|spawn|spawnSync)\s*\(\s*(['"`])((?:\\.|(?!\2)[^\\\n])*)\2/g;
// Options of a shell that take a value (`bash -o pipefail -c "..."`).
const SHELL_VALUE_OPTIONS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
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
const GIT_GLOBAL_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix']);

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

  // Finds the `))` that closes arithmetic text which starts at `from`. Returns the index of its first `)`,
  // or -1 when the text is not arithmetic (then the two `(` open subshells).
  function arithmeticEnd(from) {
    let depth = 0;
    for (let j = from; j < n; j++) {
      if (t[j] === '(') depth++;
      else if (t[j] === ')') {
        if (depth === 0) return t[j + 1] === ')' ? j : -1;
        depth--;
      }
    }
    return -1;
  }

  // Reads `$(( ... ))`. Returns false when the text is not arithmetic (then it is a `$(` with a subshell).
  function readArithmetic(w, owner) {
    const end = arithmeticEnd(i + 3);
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
        const content = h.strip ? line.replace(/^\t+/, '') : line;
        // bash also ends the body at `<delimiter>)` inside `$( ... )`; zsh does not. The reader takes the
        // reading of bash, because it leaves the text after that line visible to the rules.
        if (openSubstitutions > 0 && content.startsWith(`${h.delimiter})`)) { i += line.length - content.length + h.delimiter.length; break; }
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
    const unit = sink.units++;
    const groups = [];             // one number for each open "(" of this list
    let groupCount = 0;
    let caseDepth = 0;
    let pipeline = sink.pipelines++;
    let previous = null;           // the command before the present one in this list
    let w = null;
    let pending = null;            // a redirect operator that waits for its target word
    let inTest = false;            // between `[[` and `]]`: operators are plain characters there
    const newCommand = () => ({
      words: [], redirects: [], hereDocs: [], separator: '', previous: null,
      pipeline, scope: [unit, ...groups].join('.'), origin: listOrigin, order: sink.order++,
    });
    let cmd = newCommand();
    const word = () => (w || (w = newWord()));
    const atCommandStart = () => cmd.words.every((x) => KEYWORDS.has(x.text));
    const arithmeticAllowed = () => !w && cmd.words.every((x) => KEYWORDS.has(x.text) || x.text === 'for');

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
      }
      if (separator !== '|') pipeline = sink.pipelines++;
      if (separator === '(') groups.push(++groupCount);
      if (separator === ')') groups.pop();
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
          const end = arithmeticEnd(i + 2);
          if (end !== -1) { i = end + 2; continue; }
        }
        endCommand('(');
        i++;
        continue;
      }
      if (c === ')') {
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
 * Removes keywords, variable assignments and prefix programs from the words of
 * one simple command. Returns the real program (lower case, without folder)
 * and its arguments.
 */
function resolveProgram(words) {
  const w = words.slice();
  const assignments = [];
  const prefixes = [];
  const result = (program, args, bare = false) => ({ program, args, assignments, prefixes, bare });
  for (;;) {
    for (;;) {
      const first = w[0];
      if (!first) return result('', []);
      if (!first.quoted && KEYWORDS.has(first.text)) w.shift();
      else if (!first.quoted && first.text === 'function') w.splice(0, 2);
      else if (ASSIGNMENT.test(first.text)) assignments.push(w.shift());
      else break;
    }
    if (!w[0].quoted && DATA_KEYWORDS.has(w[0].text)) return result('', []);
    const program = programName(w[0].text);
    const isPrefix = Object.prototype.hasOwnProperty.call(PREFIX_PROGRAMS, program)
      && !(program === 'command' && w[1] && /^-[vV]$/.test(w[1].text));
    if (!isPrefix) return result(program, w.slice(1));
    prefixes.push(program);
    w.shift();
    while (w.length && (w[0].text.startsWith('-') || (program === 'env' && ASSIGNMENT.test(w[0].text)))) {
      const option = w.shift();
      if (ASSIGNMENT.test(option.text)) assignments.push(option);
      else if (option.text.length === 2 && PREFIX_PROGRAMS[program].includes(option.text[1])) w.shift();
    }
    if (program === 'timeout' && w.length) w.shift();                  // the duration
    if (!w.length) return result(program, [], true);
  }
}

// Builds a command from words that another program runs as they are (`find -exec`, `git bisect run`).
function derivedCommand(words, parent, sink) {
  const cmd = {
    words, redirects: [], hereDocs: [], separator: ';', previous: null, pipeline: sink.pipelines++,
    scope: String(sink.units++), origin: { kind: 'code', parent, depth: parent.origin.depth + 1 }, order: sink.order++,
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

// True when one long option is `full` or a shortened form of it. git and the GNU programs accept shortened forms.
const hasLong = (long, full) => long.some((l) => l.length > 0 && full.startsWith(l));

// The text that follows `-c` of a shell, at any place in the words (`docker run img sh -c "..."`).
function shellCodeArgument(words) {
  const k = words.findIndex((x) => SHELLS.has(programName(x.text)));
  if (k === -1) return null;
  for (let j = k + 1; j < words.length; j++) {
    const v = words[j].text;
    if (SHELL_VALUE_OPTIONS.has(v)) { j++; continue; }
    if (!/^[-+][A-Za-z]/.test(v)) return null;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(v)) return words[j + 1] ? words[j + 1].text : null;
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

// The texts inside interpreter code that go to a shell: the quoted first argument of a call that starts a process.
function processStartTexts(code) {
  return [...code.matchAll(PROCESS_START_CALL)].map((m) => m[3].replace(/\\(.)/g, '$1'));
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
 * `written`: the files that earlier commands of the same call wrote.
 */
function codeOf(c, sink, written) {
  const texts = [];
  const derived = [];
  const all = c.words.filter((x) => !ASSIGNMENT.test(x.text));
  const inlineCode = TEXT_PROGRAMS.has(c.program) ? null : shellCodeArgument(all);
  if (inlineCode !== null) texts.push(inlineCode);
  const isShell = SHELLS.has(c.program);
  const isInterpreter = INTERPRETERS.test(c.program);
  const sameFile = (word, file) => word.text === file.name || baseName(word.text) === baseName(file.name);
  // A written file runs as shell text, or, when it names an interpreter, its process-start calls run.
  const runWritten = (file) => {
    for (const text of file.texts) {
      const interpreter = isInterpreter ? c.program : scriptInterpreter(text);
      if (!interpreter) texts.push(text);
      else if (INTERPRETERS.test(interpreter)) texts.push(...processStartTexts(text));
    }
  };
  if (isShell) {
    texts.push(...c.hereDocs);
    for (const r of c.redirects) if (r.op === '<<<') texts.push(r.target.text);
    const operands = splitArgs(c.args, 'cO', []).operands;
    // The shell reads its commands from a pipe: the text of the earlier pipe members is the script.
    if (inlineCode === null && operands.length === 0) {
      for (const d of sink.commands) {
        if (d.pipeline === c.pipeline && d.order < c.order) texts.push(...writtenTexts(d));
      }
    }
  }
  // The file that the command runs: the first operand of a shell, of an interpreter or of `source`,
  // else the command word itself when it is written as a path (`./run.sh`).
  const runsScript = isShell || isInterpreter || c.program === 'source' || c.program === '.';
  const script = runsScript ? c.args.find((a) => !a.text.startsWith('-')) : all.find((x) => x.text.includes('/') && programName(x.text) === c.program);
  for (const file of written) if (script && sameFile(script, file)) runWritten(file);
  for (const r of c.redirects) {
    if (!WRITE_REDIRECTS.has(r.op) || r.target.dynamic) continue;
    const stored = writtenTexts(c);
    if (stored.length) written.push({ name: r.target.text, texts: stored });
  }
  if (c.program === 'eval') texts.push(joinWords(c.args));
  if (c.program === 'ssh') texts.push(joinWords(splitArgs(c.args, SSH_VALUE_OPTIONS).operands.slice(1)));
  if (c.program === 'watch') texts.push(joinWords(splitArgs(c.args, 'nd', ['interval', 'differences']).operands));
  if (c.program === 'tmux' && c.args[0] && c.args[0].text === 'send-keys') texts.push(...c.args.slice(1).map((a) => a.text));
  if (c.program === 'osascript') {
    for (const m of joinWords(c.args).matchAll(/do shell script\s+"((?:[^"\\]|\\.)*)"/g)) texts.push(m[1].replace(/\\(.)/g, '$1'));
  }
  if (c.program === 'git') {
    const k = c.args.findIndex((a) => a.text === 'foreach' || a.text === 'run');
    const before = k > 0 ? c.args[k - 1].text : '';
    if (before === 'submodule') texts.push(joinWords(c.args.slice(k + 1)));
    if (before === 'bisect' && c.args[k + 1]) derived.push(derivedCommand(c.args.slice(k + 1), c, sink));
    if (c.args.some((a) => a.text === 'rebase')) {
      c.args.forEach((a, j) => {
        if ((a.text === '-x' || a.text === '--exec') && c.args[j + 1]) texts.push(c.args[j + 1].text);
        if (a.text.startsWith('--exec=')) texts.push(a.text.slice('--exec='.length));
      });
    }
  }
  if (isInterpreter) texts.push(...processStartTexts([...c.args.map((a) => a.text), ...c.hereDocs].join('\n')));
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
  const sink = { commands: [], problems: [], units: 0, pipelines: 0, order: 0 };
  readText(String(text || ''), sink, { kind: 'top', parent: null, depth: 0 });
  sink.commands.sort((a, b) => a.order - b.order);
  const written = [];
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
  readCommand, splitArgs, hasLong, gitCall, toPosix,
  SHELLS, INTERPRETERS, ASSIGNMENT, XARGS, TEXT_PROGRAMS, FIND_EXEC_OPTIONS, SUBSTITUTION_MARK,
};
