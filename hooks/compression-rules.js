#!/usr/bin/env node
'use strict';

/**
 * Bash Output Compression Rules
 *
 * Defines which commands can be compressed and how.
 * Used by bash-compress-hook.js (Claude Code) and by
 * codex/posttool-bash-compress-adapter.js (Codex). Both run after the command
 * has ended and replace its output.
 *
 * Design principles:
 *   - Fail-open: if a compress() function returns null, output passes through raw
 *   - Never compress commands where every line is potential signal (diffs, file reads)
 *   - Transparency: compressed output always gets a marker so Claude knows info was removed
 *   - Cross-platform: line ending normalization handled by the callers, not here
 */

// Commands that should NEVER be compressed — output is always valuable
const NEVER_COMPRESS = [
  // Diffs — every line matters for code review/debugging
  /^git\s+diff\b/,
  /^diff\b/,

  // File reading — user/Claude explicitly wants file content
  /^\s*(cat|head|tail|less|bat|more|type)\s+/,

  // Compound commands — a rule matches only the first command, so compressing
  // the whole output can remove the output of the later commands. Separators:
  // ';', '|' (this also covers '||' and a pipe into the user's own filter),
  // a new line, '&&', and a single '&' that runs a command in the background.
  // An '&' after '<' or '>', or before '>', is a redirect ('2>&1', '<&0',
  // '&>file') and is not a separator. Quotes and escapes are not parsed: a
  // separator inside a quoted string, an escaped '\;' (as in 'find -exec') and
  // the '>|' redirect also stop compression, which only leaves that output
  // uncompressed.
  /[;|\n]|&&|(?<![<>])&(?!>)/,

  // Verbose/debug flags — user explicitly wants detail
  /\s--(verbose|debug)\b/,

  // API/network responses — should not be truncated
  /^\s*(curl|wget|httpie|http)\s+/,

  // Interactive commands
  /^\s*(vim|nano|emacs|vi)\s+/,

  // Inline script execution — output is the point
  /^\s*(node|python3?|ruby|php|perl)\s+-e\s+/,

  // Echo/printf — user constructing specific output
  /^\s*(echo|printf)\s+/,

  // Dry runs — the command changes nothing, so the result that a rule states
  // ("ok", "added 25 packages") would be false. The first pattern matches an
  // option that starts with `--dry`: git accepts a shortened long option
  // (`--dry` for `--dry-run`). `git add` also has the short option `-n`,
  // alone or in a group of short options (`-An`). For `git commit`, `-n` is
  // `--no-verify` and not a dry run.
  /\s--dry/,
  /^git\s+add\b.*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/,
];

// Minimum output length (chars) to bother compressing.
// Below this threshold, compression overhead exceeds savings.
const MIN_OUTPUT_LENGTH = 200;

// A line of a test run that holds one of these word stems can report a test
// that did not run ("3 skipped", "16 pending", "1 test todo", "... ignored"),
// in upper or lower case. The test rule never removes such a line.
const TEST_NOT_RUN_STEM = /skip|pending|todo|ignored/i;

// The summary hint at the end of a `git status` output, for example
// 'no changes added to commit (use "git add" and/or "git commit -a")'
const GIT_STATUS_SUMMARY_HINT = /^(no changes|nothing) added to commit\b/;

const RULES = [
  // ═══════════════════════════════════════════
  // Tier 1: Near-lossless (safe to always compress)
  // ═══════════════════════════════════════════

  {
    type: 'git-add',
    match: /^git\s+add\b/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = (stdout + '\n' + stderr).trim();
      if (!combined) return 'ok';
      // Preserve warnings (e.g., CRLF conversion warnings)
      const warnings = combined.split('\n').filter(l => /warning:/i.test(l));
      if (warnings.length) return `ok (${warnings.length} warning(s))\n${warnings.join('\n')}`;
      return 'ok';
    },
  },

  {
    type: 'git-commit',
    match: /^git\s+commit\b/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      // Extract [branch hash] and file change summary
      const branchHash = combined.match(/\[([^\]]+)\s+([a-f0-9]+)\]/);
      // Without the line `[branch hash] subject`, the output states no commit
      // (`git commit --short` is a dry run; with `-q`, git prints no such line)
      if (!branchHash) return null;
      const summary = combined.match(/(\d+\s+files?\s+changed.*)/);
      const parts = [`${branchHash[2]} on ${branchHash[1]}`];
      if (summary) parts.push(summary[1].trim());
      return `committed: ${parts.join(', ')}`;
    },
  },

  {
    type: 'git-push',
    match: /^git\s+push\b/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      const branch = combined.match(/->\s+([\w/.-]+)/);
      // The remote is the address of a line `To <address>`. An address holds
      // `:` or `/`, so the words "To find out more" in a message of the
      // server are not read as the remote.
      const remote = combined.match(/^To\s+(\S*[:/]\S*)\s*$/m);
      const parts = ['ok'];
      if (branch) parts.push(branch[1]);
      if (remote) parts.push(`-> ${remote[1]}`);
      // The messages of the server stay: for example the address for a new
      // pull request, or a notice about vulnerabilities
      const remoteLines = combined.split('\n').filter(l => l.startsWith('remote:'));
      return [parts.join(' '), ...remoteLines].join('\n');
    },
  },

  {
    type: 'git-pull',
    match: /^git\s+pull\b/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      if (/Already up to date/i.test(combined)) return 'ok: already up to date';
      const changes = combined.match(/(\d+)\s+files?\s+changed/);
      const insertions = combined.match(/(\d+)\s+insertions?/);
      const deletions = combined.match(/(\d+)\s+deletions?/);
      const parts = ['ok'];
      if (changes) parts.push(changes[0]);
      if (insertions) parts.push(`+${insertions[1]}`);
      if (deletions) parts.push(`-${deletions[1]}`);
      return parts.join(', ');
    },
  },

  {
    type: 'git-clone',
    match: /^git\s+clone\b/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      const dir = combined.match(/Cloning into '([^']+)'/);
      return dir ? `cloned -> ${dir[1]}` : 'cloned';
    },
  },

  {
    type: 'git-fetch',
    match: /^git\s+fetch\b/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = (stdout + '\n' + stderr).trim();
      if (!combined) return 'ok: up to date';
      // Extract new branches/tags
      const updates = combined.split('\n').filter(l => /->|new branch|new tag/i.test(l));
      if (updates.length) return `fetched: ${updates.length} update(s)\n${updates.join('\n')}`;
      return 'ok';
    },
  },

  {
    type: 'npm-install',
    match: /^(npm|yarn|pnpm)\s+(install|add|ci|i)(\s|$)/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      const added = combined.match(/added\s+(\d+)\s+packages?/);
      const removed = combined.match(/removed\s+(\d+)\s+packages?/);
      const time = combined.match(/in\s+(\d+[\d.]*\s*[sm])/);
      // Extract full vulnerability summary line (e.g., "2 vulnerabilities (1 moderate, 1 high)")
      const vulnLine = combined.split('\n').find(l => /vulnerabilit/i.test(l));
      const parts = ['ok'];
      if (added) parts.push(added[0]);
      if (removed) parts.push(removed[0]);
      if (time) parts.push(`in ${time[1]}`);
      if (vulnLine) parts.push(vulnLine.trim());
      return parts.join(', ');
    },
  },

  {
    type: 'pip-install',
    match: /^(pip3?|uv\s+pip|uv\s+add|poetry\s+add)\s+install\b/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      if (/already satisfied/i.test(combined)) {
        const count = (combined.match(/already satisfied/gi) || []).length;
        return `ok: ${count} package(s) already satisfied`;
      }
      const installed = combined.match(/Successfully installed\s+(.*)/);
      if (installed) {
        const pkgs = installed[1].trim().split(/\s+/);
        return `ok: installed ${pkgs.length} package(s): ${pkgs.slice(0, 5).join(', ')}${pkgs.length > 5 ? ` (+${pkgs.length - 5} more)` : ''}`;
      }
      return 'ok';
    },
  },

  {
    type: 'cargo-install',
    match: /^cargo\s+install\b/,
    tier: 1,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      const pkg = combined.match(/Installing\s+(\S+)/);
      return pkg ? `ok: installed ${pkg[1]}` : 'ok';
    },
  },

  // ═══════════════════════════════════════════
  // Tier 2: Smart filtering (compress noise, keep signal)
  // ═══════════════════════════════════════════

  {
    type: 'git-status',
    match: /^git\s+status\b/,
    tier: 2,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const lines = stdout.split('\n');
      // `git status -v` and `-vv` print a diff after the status text. A
      // context line of the diff can be a single space or can look like a
      // hint line, so only the status text before the first line
      // "diff --git" is filtered. With a colour setting (`color.ui=always`),
      // that line starts with a colour code, which the test does not read.
      const diffIndex = lines.findIndex(l => l.replace(ANSI_CODE, '').startsWith('diff --git '));
      const diffStart = diffIndex === -1 ? lines.length : diffIndex;
      const status = lines.slice(0, diffStart);
      const diff = lines.slice(diffStart);
      // Remove git hint lines:
      //   - Indented hints: '  (use "git add <file>..." to update...)'
      //   - Summary hints: 'no changes added to commit (use "git add"...)'
      //   - Clean/working tree messages that are noise
      const filtered = status.filter(l => {
        const trimmed = l.trim();
        if (trimmed.startsWith('(use "git ')) return false;
        if (GIT_STATUS_SUMMARY_HINT.test(trimmed)) return false;
        return true;
      });
      // Remove consecutive blank lines (left behind after removing hints)
      const deduped = filtered.filter((l, i, arr) => {
        if (l.trim() === '' && i > 0 && arr[i - 1].trim() === '') return false;
        return true;
      });
      // Git prints the summary hint after the diff of `-vv` too. It starts
      // at column 0, and no line of a diff starts with its words.
      const diffKept = diff.filter(l => !GIT_STATUS_SUMMARY_HINT.test(l));
      return deduped.concat(diffKept).join('\n');
    },
  },

  {
    type: 'git-log',
    match: /^git\s+log\b/,
    tier: 2,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const lines = stdout.split('\n');
      if (lines.length <= 40) return null; // Already short enough
      const kept = lines.slice(0, 30);
      const dropped = lines.length - 30;
      kept.push('', `... ${dropped} more lines (use git log -n <N> for specific range)`);
      return kept.join('\n');
    },
  },

  {
    type: 'test-pass',
    match: /^(npm\s+test|npm\s+run\s+test|npx\s+(jest|vitest|mocha)|yarn\s+test|pnpm\s+test|cargo\s+test|pytest|python3?\s+-m\s+pytest|go\s+test|rake\s+test|rspec|bundle\s+exec\s+(rspec|rake)|php\s+artisan\s+test|phpunit|dotnet\s+test)\b/,
    tier: 2,
    compress(stdout, stderr, exitCode) {
      // ONLY compress passing tests — failures need full context
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      const lines = combined.split('\n');
      if (lines.length <= 20) return null; // Short output, no need

      // Extract summary/result lines only — NOT individual test result lines.
      // "  PASS src/test.js" is an individual result (noise).
      // "Tests: 100 passed, 100 total" is a summary (signal).
      const summaryPatterns = [
        /\d+\s+passing\b/i,                       // mocha: "5 passing (3s)"
        /^\s*\d+\s+pending\s*$/,                    // mocha: "2 pending", on its own line
        /Tests?:\s+\d+/i,                          // jest: "Tests: 100 passed, 100 total"
        /Test Suites?:\s+\d+/i,                     // jest: "Test Suites: 5 passed"
        /test result:\s/i,                          // cargo: "test result: ok"
        /\bOK\s*\(\d+/i,                           // phpunit: "OK (42 tests, 80 assertions)"
        /\d+\s+passed,?\s+\d+\s+total/i,           // generic: "100 passed, 100 total"
        /\d+\s+tests?\s+passed/i,                   // generic: "42 tests passed"
        /All\s+\d+\s+tests/i,                       // generic
        /\d+\s+examples?,\s+\d+\s+failures?/i,      // rspec
        /Ran\s+\d+\s+tests?/i,                      // python unittest
        /^Time:\s/m,                                // jest time line
        /^Snapshots:\s/m,                           // jest snapshots
        /succeeded\.\s+\d+/i,                       // dotnet: "Passed! 42 succeeded"
      ];
      const summaryLines = lines.filter(l =>
        summaryPatterns.some(p => p.test(l))
      );
      // Without a summary line, the output does not state a result: exit
      // status 0 does not prove that a test ran (skipped tests, no test file)
      if (!summaryLines.length) return null;

      // Collect warnings
      const warningLines = lines.filter(l => /\bwarn|deprecat/i.test(l));

      const result = [...summaryLines];
      if (warningLines.length) {
        result.push('', 'Warnings:');
        result.push(...warningLines.slice(0, 10));
        if (warningLines.length > 10) {
          result.push(`... ${warningLines.length - 10} more warnings`);
        }
      }

      // A summary line of one program does not prove the result of the whole
      // run: a second test program, or a line that the rule does not read
      // ("OK (skipped=24)"), can report tests that did not run. When a line
      // that would be removed holds such a report, the output stays raw.
      const kept = new Set(result);
      if (lines.some(l => !kept.has(l) && TEST_NOT_RUN_STEM.test(l))) return null;
      return result.join('\n');
    },
  },

  {
    type: 'build-success',
    match: /^(npm\s+run\s+build|yarn\s+build|pnpm\s+build|cargo\s+build|go\s+build|tsc\b|next\s+build|dotnet\s+build|gradle\s+build|mvn\s+(compile|package))\b/,
    tier: 2,
    compress(stdout, stderr, exitCode) {
      // Only compress successful builds — errors need full context
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      const lines = combined.split('\n');
      if (lines.length <= 20) return null;

      // Keep warning and summary lines
      const important = lines.filter(l =>
        /\bwarn|error|built|compiled|success|finish|complete|ready|emitted/i.test(l)
      );
      // Keep last 5 non-empty lines (usually the build summary)
      const tail = lines.filter(l => l.trim()).slice(-5);
      // Deduplicate
      const seen = new Set();
      const result = [];
      for (const l of [...important, ...tail]) {
        if (!seen.has(l)) { seen.add(l); result.push(l); }
      }
      return result.length ? result.join('\n') : 'build succeeded';
    },
  },

  // There is no rule for lint tools (eslint, pylint, ruff, ...): a rule that
  // counts lines by the words "error" and "warning" cannot state the counts
  // of the tool, so lint output stays raw.

  {
    type: 'ls-large',
    match: /^(ls|dir)\b/,
    tier: 2,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const lines = stdout.split('\n').filter(l => l.trim());
      if (lines.length <= 50) return null;
      const kept = lines.slice(0, 50);
      const dropped = lines.length - 50;
      kept.push('', `... ${dropped} more entries`);
      return kept.join('\n');
    },
  },

  {
    type: 'find-large',
    match: /^find\s+/,
    tier: 2,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const lines = stdout.split('\n').filter(l => l.trim());
      if (lines.length <= 60) return null;
      const kept = lines.slice(0, 60);
      const dropped = lines.length - 60;
      kept.push('', `... ${dropped} more results`);
      return kept.join('\n');
    },
  },

  {
    type: 'docker-build',
    match: /^docker\s+(build|compose\s+build)\b/,
    tier: 2,
    compress(stdout, stderr, exitCode) {
      if (exitCode !== 0) return null;
      const combined = stdout + '\n' + stderr;
      const lines = combined.split('\n');
      if (lines.length <= 20) return null;
      // Keep step headers and final lines
      const steps = lines.filter(l => /^(Step|#\d+|\s*=>\s|FINISHED|Successfully|sha256:)/i.test(l.trim()));
      const tail = lines.filter(l => l.trim()).slice(-3);
      const seen = new Set();
      const result = [];
      for (const l of [...steps, ...tail]) {
        if (!seen.has(l)) { seen.add(l); result.push(l); }
      }
      return result.join('\n') || 'build succeeded';
    },
  },
];

/**
 * The rule for a command. Returns undefined when the output of the command
 * must stay raw: the never-compress list names the command, or no rule
 * matches it.
 */
function findRule(command) {
  if (NEVER_COMPRESS.some(pattern => pattern.test(command))) return undefined;
  return RULES.find(rule => rule.match.test(command));
}

// An ANSI escape sequence, for example a colour code. It ends with a letter,
// which would otherwise stand directly before the next word.
const ANSI_CODE = /\x1b\[[0-9;?]*[A-Za-z]/g;

// A line that holds one of these word stems can report a problem of a command
// that ended with exit status 0 (standard error is often merged into standard
// output). The stem can be a part of a longer word (`TypeError`, `FAILED`,
// `vulnerabilities`) or of a dotted name (`jinja2.exceptions.TemplateNotFound`),
// in upper or lower case. A path that holds a stem (`src/errors.js`) counts
// too: the pattern cannot tell such a path from a real report, and every
// doubt keeps the line.
const ALERT_STEM = /error|warn|fail|fatal|conflict|denied|incompatible|deprecated|cannot|not\s+found|traceback|exception|panic|reject|refus|abort|unable\s+to|vulnerab|err!/i;

// With more removed alert lines than this, the output stays raw
const MAX_ALERT_LINES = 40;

// The line above the alert lines that are added to the compressed text
const ALERT_HEADING = 'Removed lines with an alert word:';

/**
 * Apply a rule to the output of a command. Returns the compressed text, or
 * null when the output must stay raw: the rule throws, the rule returns no
 * text, or the rule removed more than MAX_ALERT_LINES alert lines.
 *
 * An alert line is a line of the output that holds an alert stem. Each alert
 * line that is not a line of the compressed text is added below it, once,
 * under ALERT_HEADING. Lines are compared whole, without white space at
 * their end.
 */
function runRule(rule, stdout, stderr, exitCode) {
  let compressed;
  try {
    compressed = rule.compress(stdout, stderr, exitCode);
  } catch {
    return null;
  }
  if (!compressed || typeof compressed !== 'string') return null;

  const keptLines = new Set(compressed.split('\n').map(line => line.trimEnd()));
  const alertLines = new Set();
  for (const outputLine of `${stdout}\n${stderr}`.split('\n')) {
    const line = outputLine.trimEnd();
    if (!keptLines.has(line) && ALERT_STEM.test(line.replace(ANSI_CODE, ''))) alertLines.add(line);
  }
  if (alertLines.size > MAX_ALERT_LINES) return null;
  return alertLines.size ? [compressed, '', ALERT_HEADING, ...alertLines].join('\n') : compressed;
}

/** The number of lines of a text that hold more than white space. */
function countNonEmptyLines(text) {
  return text.split('\n').filter(line => line.trim().length > 0).length;
}

/** The marker line that tells the reader that a rule removed lines. */
function compressionMarker(originalLines, compressedLines, ruleType) {
  return `[compressed: ${originalLines}->${compressedLines} lines | ${ruleType}]`;
}

module.exports = {
  RULES,
  NEVER_COMPRESS,
  MIN_OUTPUT_LENGTH,
  findRule,
  runRule,
  countNonEmptyLines,
  compressionMarker,
};
