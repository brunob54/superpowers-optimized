# Smart Compress

How the plugin automatically reduces token usage by compressing noisy Bash output before it enters Claude's context.

---

## The Problem

Every time Claude runs a shell command, the full raw output flows into its context window. Most of that output is noise:

- `git add .` produces nothing useful — Claude already knows what it staged
- `git status` includes 4-5 hint lines ("use git add...", "use git restore...") that serve no purpose for an AI
- `npm install` dumps hundreds of "added package X" lines when all Claude needs is "installed, 150 packages, no errors"
- Passing test suites print every individual test name when the summary lines of the test runner ("Tests: 42 passed, 42 total") convey the same information

In a typical 30-minute session, Claude runs ~80 Bash commands. The raw output from those commands can consume 50,000-120,000 tokens — often more than the actual code Claude reads and writes.

These tokens cost money and consume context window space that could be used for reasoning about your code.

---

## What Smart Compress Does

Smart compress is a `PostToolUse` hook (a program that Claude Code runs after a tool call has ended). It runs after each Bash command that ended with success. When it recognizes a command that produces noisy output, it:

1. Reads the output of the command from the hook input
2. Applies command-specific compression rules to remove noise while preserving signal
3. Returns the compressed output with a transparency marker, in the `updatedToolOutput` field. Claude Code then gives Claude this text in place of the raw output.

The hook never changes the command, and it never returns a permission decision. Claude Code runs the command exactly as Claude wrote it. The permission prompt and the user's allow, ask and deny rules work exactly as they do without the hook.

**Requirement:** Claude Code 2.1.121 or later. That version added `updatedToolOutput` for the Bash tool.

```
Without smart compress:

  Claude  ──git status──>  bash  ──>  git
    ^                                  |
    |         14 lines (raw)           |
    +----------------------------------+

With smart compress:

  Claude  ──git status──>  bash  ──>  git
    ^                                  |
    |                                  |  14 lines (raw)
    |      10 lines (hint lines        v
    |      removed, marker added)    hook
    +----------------------------------+
```

Before this design, the hook ran on `PreToolUse` and replaced the command with a call of a wrapper program (`bash-optimizer.js`), together with the permission decision "allow". Claude Code then skipped the permission prompt for every such command, and it compared the user's deny and ask rules with the replaced command text, which they could not match. The wrapper program no longer exists.

---

## What Gets Compressed

╔═══════════════════════════════════════════
║   smart-compress Implementation Summary   
╠═══════════════════════════════════════════
║ Compression rules: 17 
║ Never-compress patterns: 11 
║ Min output threshold: 200 chars 
╠═══════════════════════════════════════════
║ Tier 1 (near-lossless): 9 
║   - git-add                               
║   - git-commit                            
║   - git-push                              
║   - git-pull                              
║   - git-clone                             
║   - git-fetch                             
║   - npm-install                           
║   - pip-install                           
║   - cargo-install                         
║ Tier 2 (smart filtering): 8 
║   - git-status                            
║   - git-log                               
║   - test-pass                             
║   - build-success                         
║   - lint-output                           
║   - ls-large                              
║   - find-large                            
║   - docker-build                          
╠═══════════════════════════════════════════
║ Never-compress patterns:                  
║   - ^git\s+diff\b                         
║   - ^diff\b                               
║   - ^\s*(cat|head|tail|less|bat|more|type)\ 
║   - [;|\n]|&&|(?<![<>])&(?!>)             
║   - \s--(verbose|debug)\b                 
║   - ^\s*(curl|wget|httpie|http)\s+        
║   - ^\s*(vim|nano|emacs|vi)\s+            
║   - ^\s*(node|python3?|ruby|php|perl)\s+-e\ 
║   - ^\s*(echo|printf)\s+                  
║   - ^git\s+(add|commit)\b.*\s--dry-run(\s|$) 
║   - ^git\s+add\b.*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$) 
╚═══════════════════════════════════════════

### Tier 1: Near-Lossless

These commands produce output where the signal can be captured in one line. A line of the raw output that holds an alert word (for example `error`, `warning`, `conflict`) and that the one-line summary does not hold is added below the summary (see "Alert Lines").

| Command | Raw output | Compressed output | Savings |
|---|---|---|---|
| `git add .` | Empty or CRLF warnings | `ok` or `ok (2 warning(s))` | ~90% |
| `git commit -m "msg"` | Branch info, file stats, create mode lines | `committed: abc1234 on main, 3 files changed` | ~85%, only for output of 200 characters or more; the output of a small commit is shorter and stays raw |
| `git push` | Counting objects, writing objects (git writes them to standard error; Claude Code merges them into the output) | `ok main -> github.com:user/repo.git`, then every line that starts with `remote:` (for example the address for a new pull request, or a notice about vulnerabilities) | ~90% for a push without messages of the server |
| `git pull` | Remote info, unpacking, file stats | `ok, 3 files changed, +10, -2` | ~85% |
| `git clone` | Cloning, receiving, resolving deltas | `cloned -> my-repo` | ~90% |
| `git fetch` | Remote counting, unpacking | `ok: up to date` or `fetched: 3 update(s)` | ~85% |
| `npm install` / `yarn` / `pnpm` | Hundreds of package resolution lines | `ok, added 150 packages, in 12s` | ~80% |
| `pip install` / `uv pip` | Download progress, dependency resolution | `ok: installed 5 package(s): flask, requests...` | ~80% |
| `cargo install` | Compiling, downloading crates | `ok: installed my-tool` | ~85% |

For `git commit` and `git push`, Claude Code adds a `gitOperation` field to the tool response (the branch, and the commit id or the push target). The hook returns that field unchanged.

### Tier 2: Smart Filtering

These commands produce output where some lines are signal and others are noise. The compressor removes the noise and keeps the signal.

| Command | What's removed | What's kept |
|---|---|---|
| `git status` | Hint lines ("use git add...", "use git restore..."), "no changes added to commit" | Branch info, file lists |
| `git log` (>40 lines) | Entries beyond the first 30 | First 30 entries + count of remaining |
| Test runners (passing), only for output with a summary line that the rule reads | Individual "PASS" lines | Summary lines ("Tests: 100 passed, 100 total"; for mocha "8 passing" and "16 pending") + warnings |
| Build commands (success) | Compilation progress, bundling steps | Summary + warnings |
| Lint output (>30 lines) of a run that ends with exit status 0, only when the counts cover every message | Repeated similar warnings | Error/warning counts, the lines with the word "error" (25 at most), the first 5 warnings, and the alert lines |
| `ls` (>50 entries) | Entries beyond 50 | First 50 + count of remaining |
| `find` (>60 results) | Results beyond 60 | First 60 + count of remaining |
| `docker build` (success) | Layer download/extract progress | Step headers + final result |

**Lint runs that fail are no longer compressed.** Most lint tools end with a non-zero exit status when they report an error. Claude Code sends no `PostToolUse` event for such a run, so the hook does not see it and the output stays raw. The earlier design compressed that output too (the lint rule is the only rule that does not look at the exit status). This saving is lost. The same holds for a test run that fails, which was raw before as well.

**A rule states only what the output states.** Exit status 0 does not prove that a test ran or that a lint tool found nothing. Two rules therefore leave output raw that they cannot read:

- **Test runs without a summary line.** The test rule reads the summary lines of jest, mocha, cargo, rspec, phpunit and Python's unittest. When the output holds none of them, the output stays raw. Measured examples: `node --test` (spec and TAP reporter, Node 24.13.1), `pytest -v` (9.1.1) and `vitest run --reporter=verbose` (5.0.3) print a summary in another form, so their output stays raw, also when every test passed. An earlier version replaced such output with the sentence "all tests passed", which was false for a run with 24 skipped tests and for a run with no test.
- **Lint output with messages that the rule cannot count.** The lint rule counts the lines that hold the word "error" or "warning". The output stays raw when the rule counts no line, and when a line that is not counted names a position (`line:column`). Measured examples: the messages of `pylint --exit-zero` (4.1.2) and `ruff check --exit-zero` (0.16.10) hold neither word, so their output stays raw. The output of eslint (10.12.0, default format) is still compressed: each message holds the word "error" or "warning". An earlier version printed "0 error(s), 0 warning(s)" for pylint output with 36 messages.

---

## What Is NEVER Compressed

These commands always pass through with raw, unmodified output — regardless of length:

| Command type | Why |
|---|---|
| `git diff` (any variant) | Every line is signal for code review and debugging |
| `cat`, `head`, `tail`, `less`, `bat` | Claude explicitly requested file content |
| Compound commands: commands joined by `&&`, `\|\|`, `;`, `\|` or a new line, and any command run in the background with `&` | A rule matches only the first command, so it would remove the output of the later commands. A pipe also means the user already applied their own filter. Redirects such as `2>&1` do not count. Quotes and escapes are not parsed, so a `;` inside a quoted message, the `\;` of `find -exec` and the `>\|` redirect also stop compression. |
| Commands with `--verbose` or `--debug` flags | User explicitly asked for detail |
| `curl`, `wget`, `httpie` | API responses should not be truncated |
| `echo`, `printf` | User is constructing specific output |
| `node -e`, `python -e`, `ruby -e` | Inline script output is the point |
| A dry run of `git add` (`--dry-run`, `-n`, also in a group of short options such as `-An`) or of `git commit` (`--dry-run`) | The command changes nothing, so the result that the rule states (`ok`, `committed`) would be false. Quotes are not parsed, so a commit message that holds ` --dry-run` also stops compression. |
| A test run whose output holds no summary line that the test rule reads; lint output with messages that the lint rule cannot count | The rule cannot read the result, and exit status 0 does not prove it (see "A rule states only what the output states") |
| **Any command that fails** (non-zero exit code) | Error output must be seen in full |
| Output shorter than 200 characters | Not worth the compression overhead |
| Output that the replacement would not make shorter (not fewer lines, or not fewer characters than the `stdout` text of the response) | Nothing to gain (see "The Size Rule"); every replaced output carries the marker |
| Output in which a rule removed more than 40 lines with an alert word | Too many possible problems to hide (see "Alert Lines") |
| A background call, a call moved to the background at its time-out, an interrupted call | The output is not complete (see "Output That Is Never Replaced") |

The "never compress on failure" rule is the most important safety feature. When tests fail, builds break, or commands error out, you get the complete raw output — stack traces, assertion details, error messages, everything. Claude Code itself enforces the rule: for a command that fails it sends the `PostToolUseFailure` event, not `PostToolUse`, so the hook does not run.

---

## Transparency Markers

Every compressed output includes a marker at the end:

```
On branch main
Changes not staged for commit:
	modified:   hooks/hooks.json

Untracked files:
	hooks/bash-compress-hook.js

[compressed: 14->10 lines | git-status]
```

The marker tells Claude (and you, if you're reading the output):
- How many lines were in the original output
- How many lines remain after compression
- Which compression rule was applied

This is a deliberate design choice. Unlike external tools that silently truncate output, smart compress always tells Claude that information was removed. If the compressed output is insufficient, Claude can re-run the command — and the adaptive re-run system will pass it through uncompressed (see below).

---

## Adaptive Re-Run Detection

If Claude runs the exact same command twice within 60 seconds, the second run passes through **uncompressed**. This handles the scenario where Claude re-runs a command because the compressed output didn't contain what it needed.

| Run | Behavior | Reasoning |
|---|---|---|
| 1st | Compressed | Default behavior — remove noise |
| 2nd (within 60s) | Raw/uncompressed | Claude is likely retrying for more info |
| 3rd | Compressed | The 2nd run was raw, so the rule applies again |
| 4th (within 60s of the 3rd) | Raw/uncompressed | The rule is the same at every run: raw when the run before it was compressed less than 60 seconds earlier |

So repeated runs of one command alternate between compressed and raw for as long as each run starts within 60 seconds of the one before.

The 60 seconds count from the end of the compressed run to the **start** of the next run (the hook input holds the time the command took, in `duration_ms`). A re-run that starts at once and takes 90 seconds is therefore still raw.

This tracking is session-scoped: one temp file per session, named after the session id. Every character of the id outside letters, digits, `_` and `-` becomes `_`, so the id cannot name another folder. The operating system removes the file with its other temporary files.

---

## Alert Lines

Claude Code merges the standard error of a successful command into its output. A command can end with exit status 0 and still report a problem, and a rule that keeps only a summary would remove that line. Three measured examples: `pip install` prints "ERROR: pip's dependency resolver ... incompatible", `git pull --rebase --autostash` prints "Applying autostash resulted in conflicts", `npm install` prints "npm warn EBADENGINE".

One shared step protects these lines, for every rule, on Claude Code and in the Codex adapter (`runRule` in `hooks/compression-rules.js`):

1. An **alert line** is a line of the raw output (standard output and standard error) that holds one of these word stems, in upper or lower case: `error`, `warn`, `fail`, `fatal`, `conflict`, `denied`, `incompatible`, `deprecated`, `cannot`, `not found`, `traceback`, `exception`, `panic`, `reject`, `refus`, `abort`, `unable to`, `vulnerab`, `ERR!`. A stem is the start of a word family: `fail` also finds `failed`, `failure` and `FAILED`. The stem can be inside a longer word: `TypeError`, `UserWarning`.
2. ANSI escape sequences (for example colour codes) are removed from the line before the search, so a coloured `error` is found.
3. Every alert line that is not a line of the compressed text is added below the compressed text, once, under the heading `Removed lines with an alert word:`, above the marker. Lines are compared whole, without the white space at their end: the removed line `1 failed` is added although the kept line `Tests: 11 failed` holds the same text.
4. When more than 40 alert lines would be added, the hook replaces nothing and Claude receives the raw output.

A stem inside a path or a dotted name counts too: `src/errors.js` and `error.log` are alert lines, and so is `jinja2.exceptions.TemplateNotFound: index.html`. The pattern cannot tell a file name from a real report, and every doubt keeps the line.

Known wrong counts: a file or folder name that holds a stem (`src/errors.js` in a `find` list), and ordinary text such as a test name "should fail when the input is empty", a commit subject "fix error message" or the line "found 0 vulnerabilities" count as alert lines. The result is only less compression: the lines are added, or the output stays raw. A run of a passing test suite whose test names hold such words in more than 40 lines is not compressed.

---

## The Size Rule

The hook replaces the output only when the replacement is useful:

- it has fewer lines than the raw output, and
- it has fewer characters than the `stdout` text of the response.

Output that Claude Code saved in a file is never replaced (see "Output That Is Never Replaced"), so the `stdout` text is always the text that Claude would receive.

---

## Output That Is Never Replaced

The hook replaces the output only when it can prove that the tool response is the complete output of a command that ended with exit status 0. The fields below were measured on Claude Code 2.1.289. In every other case the hook prints `{}` and Claude receives the output unchanged.

| Case | How the hook sees it | Behavior |
|---|---|---|
| Command that fails | Claude Code sends `PostToolUseFailure` | The hook does not run |
| Call with `run_in_background: true` | The response has a `backgroundTaskId` field | Unchanged. Claude Code writes the output of a background call to a file. |
| Command still running at the Bash call's time-out | The response has `backgroundTaskId` and `timedOutAfterMs` | Unchanged. Claude Code moves the call to the background and does not stop the command. |
| Exit status that is not 0 and that Claude Code accepts (for example `find` with a folder it cannot read) | The response has a `returnCodeInterpretation` field | Unchanged |
| Interrupted call, image output | `interrupted` or `isImage` is not `false` | Unchanged |
| Output above 30,000 characters | The response has `persistedOutputPath` and `persistedOutputSize` | Unchanged (see below) |
| Any field the hook does not know, or a missing `stdout` or `stderr` field | The shape is not the measured one | Unchanged |

The known fields are `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected`, and four notes that Claude Code adds to complete output and that the hook returns unchanged: `gitOperation` (what a `git commit` or `git push` did), `bashEditDiff` (the files the command changed), `staleReadFileStateHint` (a text about files that changed after Claude read them) and `dangerouslyDisableSandbox`. If a later Claude Code version adds a field to every response, compression stops (the output stays raw) until the hook learns the field. Nothing else breaks.

**Output above 30,000 characters.** Claude Code cuts the `stdout` field at 30,000 characters, saves the whole output in a file and adds the fields `persistedOutputPath` and `persistedOutputSize` to the response. Claude does not receive the 30,000 characters: it receives a preview of about 2,000 characters and the path of the file (read in the program text of Claude Code 2.1.289). A replacement could therefore be longer than what Claude receives. The hook leaves such a response unchanged and does not read the file. A long passing test run or a long `find` list is therefore not compressed; Claude sees the preview and can read the file.

**Standard error.** Claude Code merges the standard error of a successful command into `stdout`, in the order the lines were written, and leaves the `stderr` field empty. The hook therefore cannot keep standard error apart, and a rule treats those lines like any other line. The alert-line rule (see "Alert Lines") keeps the lines that report a problem. A `stderr` field that is not empty goes to the rule as standard error and stays unchanged in the replacement.

The hook starts no command and sets no time limit, so it cannot stop or delay a command.

---

## Token Savings

### Measured (verified by test suite)

These numbers come from running the test suite against this repository — a small plugin project with a short git history and a modest number of files. Real-world savings on larger codebases will be higher because there's more noise to remove.

| Command | Raw tokens | Compressed tokens | Savings |
|---|---|---|---|
| `git status` | ~203 | ~146 | **28%** |
| `git log --oneline -50` | ~672 | ~404 | **40%** |
| `npm install` (80-package output) | ~418 | ~18 | **96%** |
| `ls -la` (small dir, below 50-entry threshold) | ~396 | ~396 | 0% — correctly skipped |
| `find hooks/ -type f` (below 60-result threshold) | ~106 | ~106 | 0% — correctly skipped |

The 0% cases are intentional — the output was already short enough that compression overhead wasn't worth it. On a larger project with a `node_modules/` tree, `find` and `ls` results would compress significantly.

### Projected (30-minute session estimates)

Savings accumulate across all Bash calls in a session. These are projections based on typical usage patterns and the per-command rates measured above:

| Scenario | Raw tokens | With smart compress | Savings |
|---|---|---|---|
| Git-heavy workflow (commit, push, pull, status) | ~12,000 | ~2,500 | ~80% |
| Test-driven development (frequent test runs) | ~30,000 | ~4,000 | ~87% |
| Package installation (npm/pip/cargo) | ~15,000 | ~2,000 | ~87% |
| Build-heavy workflow (compile, lint, build) | ~20,000 | ~5,000 | ~75% |
| Mixed session (typical) | ~50,000 | ~12,000 | ~76% |

Commands that aren't covered by compression rules (or hit the never-compress list) pass through unchanged with zero overhead.

---

## Performance Overhead

| Component | Time | Notes |
|---|---|---|
| PostToolUse hook (classification) | ~40ms | Node.js startup + regex matching |
| Compression logic | <5ms | String operations |
| **Total per Bash command** | **~40-45ms** | The hook runs once after each Bash call that ended with success |

For a typical session with ~80 Bash calls, total overhead is approximately 3-4 seconds across the entire session. This is a fraction of a second per command — imperceptible compared to the time Claude spends reasoning. The hook runs after the command, so it adds no time before the command starts.

---

## Cross-Platform Support

Smart compress works on all three platforms supported by Claude Code (macOS, Linux, Windows). The hook starts no shell and no command: Claude Code runs the command, and the hook only reads the result. It uses only Node.js built-ins.

Cross-platform handling:
- **Line endings:** Windows `\r\n` output is normalized to `\n` before compression
- **Temp files:** Session tracking uses `os.tmpdir()` which resolves correctly on all platforms

---

## How to Disable

If you need to disable compression for any reason:

**For a single project:**
Create an empty file named `.sp-no-compress` in the project root:
```bash
touch .sp-no-compress
```

**For all projects (environment variable):**
```bash
export SP_NO_COMPRESS=1
```

**For a single command:**
There's no per-command disable — but commands on the never-compress list already pass through raw. If you need full output for a command that would normally be compressed, add a pipe: `git status | cat` (the pipe triggers the never-compress rule).

---

## Why Smart Compress Instead of RTK

[RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) is an excellent open-source tool that achieves 60-90% token savings on Bash output. We studied it carefully before building smart compress. Here's why we built our own:

**Zero dependencies.** RTK requires installing a Rust binary and `jq`. Smart compress uses only Node.js, which is already required by the plugin. Install the plugin, and compression works — nothing else to download, no PATH configuration, no version management.

**Safer defaults.** RTK compresses `git diff` output by 75%. That means Claude reviews partial diffs without knowing lines were removed. Smart compress never compresses diffs, file reads, or failed command output. We'd rather save fewer tokens than silently degrade the quality of Claude's reasoning.

**Transparency.** RTK's compressed output looks like normal output — Claude doesn't know information was removed and treats it as complete. Smart compress adds a `[compressed: 120->10 lines | git-status]` marker to every compressed output. Claude always knows when and how much was filtered, and can re-run the command if it needs more.

**Adaptive behavior.** If Claude re-runs the same command within 60 seconds, smart compress passes it through uncompressed — it assumes Claude is retrying because the compressed output wasn't enough. RTK applies the same compression every time regardless.

**The trade-off we accepted.** RTK covers 100+ commands with <10ms overhead (Rust). Smart compress covers 17 commands with ~40ms overhead (Node.js). We're slower and narrower — but those 17 commands account for the vast majority of token waste in typical sessions, and the safety guarantees matter more than covering edge cases.

### Coexistence with RTK

If you also have RTK installed, smart compress detects commands that already start with `rtk` and skips them — no double-compression. The two tools can coexist safely, though running both provides diminishing returns since they target the same output.

---

## Architecture

Smart compress consists of two files:

```
hooks/
├── bash-compress-hook.js     PostToolUse/Bash hook — classifies the command,
│                             checks that the tool response is safe to
│                             replace, applies the rule, and returns the
│                             compressed output with the transparency marker
│
└── compression-rules.js      Rule definitions — command patterns, tier
                              classification, compression functions,
                              the never-compress list, and the helper
                              functions shared with the Codex adapter
```

### Hook Order

```
PreToolUse/Bash hooks (before the command, before the permission check):

  1. block-dangerous-commands.js   →  May DENY
  2. protect-secrets.js            →  May DENY

Claude Code checks the permission rules, asks the user when needed, and
runs the command.

PostToolUse/Bash hook (after a command that ended with success):

  3. bash-compress-hook.js         →  May REPLACE the output Claude receives
```

If a safety hook, a permission rule or the user blocks a command, the command does not run and the compressor never sees it.

### Fail-Open Design

Every layer is designed to fail open — if anything goes wrong, Claude receives the raw output:

- Hook crashes or produces invalid JSON → Claude Code keeps the original output
- A tool response without the known shape → raw output
- Compression function throws → raw output
- Compression function returns `null` → raw output (used intentionally for short output)
- A Claude Code version before 2.1.121 → the `updatedToolOutput` field is not known for the Bash tool; expected result: raw output (not run on such a version)

The hook runs after the command, so no compression failure can prevent a command from executing or change what it does.
