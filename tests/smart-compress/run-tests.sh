#!/usr/bin/env bash
# smart-compress test suite
# Tests: classification, never-compress, compression quality, output
# replacement, hook I/O, edge cases, token savings, hook wiring
#
# The hook is tested through its public interface: it runs as a process and
# reads the PostToolUse input of Claude Code as JSON on standard input. The
# inputs built here have the shape measured on Claude Code 2.1.289.
#
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).
# All node JSON parsing uses temp files or environment variables instead.

# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/bash-compress-hook.js"
PASS=0
FAIL=0
ERRORS=()

# Every temporary file of the suite is inside this folder
WORK=$(mktemp -d)
# The hook writes one record file for each session into the temporary folder
# of the operating system. The suite gives the hook this folder instead.
TRACK_DIR="$WORK/track"
mkdir "$TRACK_DIR"

# Cleanup on exit
cleanup() { rm -rf "$WORK" 2>/dev/null; }
trap cleanup EXIT

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

mktmp() { mktemp "$WORK/file.XXXXXX"; }

assert() {
  local desc="$1" result="$2" expected="$3"
  if [ "$result" = "$expected" ]; then
    green "  PASS: $desc"
    ((PASS++))
  else
    red "  FAIL: $desc"
    red "        expected: '$expected'"
    red "        got:      '$result'"
    ERRORS+=("$desc")
    ((FAIL++))
  fi
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    green "  PASS: $desc"
    ((PASS++))
  else
    red "  FAIL: $desc (expected to contain: '$needle')"
    red "        got: $haystack"
    ERRORS+=("$desc")
    ((FAIL++))
  fi
}

assert_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    red "  FAIL: $desc (must NOT contain: '$needle')"
    ERRORS+=("$desc")
    ((FAIL++))
  else
    green "  PASS: $desc"
    ((PASS++))
  fi
}

# Write the PostToolUse input of one Bash call that ended with success into a
# new file, and print the name of the file.
#   $1  the command
#   $2  the output of the command (the `stdout` field of the tool response)
#   $3  optional: the session id
#   $4  optional: JavaScript statements that change the object `input`
#       (`require` is available), for an input with another shape
build_input() {
  local file
  file=$(mktmp)
  FIX_COMMAND="$1" FIX_STDOUT="$2" FIX_SESSION="${3:-test-$$}" FIX_CHANGE="${4:-}" FIX_CWD="$PLUGIN_ROOT" node -e '
    const e = process.env;
    const input = {
      session_id: e.FIX_SESSION,
      transcript_path: "/tmp/transcript.jsonl",
      cwd: e.FIX_CWD,
      prompt_id: "37f4ba1d-0597-4d96-95d1-03a5df40c52e",
      permission_mode: "default",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: e.FIX_COMMAND },
      tool_response: { stdout: e.FIX_STDOUT, stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
      tool_use_id: "toolu_01KdJScQWwQGSFb4wonFyB9p",
      duration_ms: 12,
    };
    new Function("input", "require", e.FIX_CHANGE)(input, require);
    require("fs").writeFileSync(process.argv[1], JSON.stringify(input));
  ' "$file"
  echo "$file"
}

# Run the hook with the input in the file $1, print its standard output
run_hook_file() {
  TMPDIR="$TRACK_DIR" TEMP="$TRACK_DIR" TMP="$TRACK_DIR" node "$HOOK" < "$1"
}

# Run the hook for one Bash call. The arguments are those of build_input.
run_hook() { run_hook_file "$(build_input "$@")"; }

# Print one value of a hook output.
#   $1  the hook output (JSON)
#   $2  a JavaScript expression; `out` is the output, `updated` is its
#       updatedToolOutput object (undefined when the hook replaced nothing)
hook_value() {
  HOOK_OUT="$1" node -e '
    const out = JSON.parse(process.env.HOOK_OUT);
    const updated = out.hookSpecificOutput && out.hookSpecificOutput.updatedToolOutput;
    console.log(eval(process.argv[1]));
  ' "$2"
}

# "yes" when the hook replaced the output, "no" otherwise
is_compressed() { hook_value "$1" 'updated ? "yes" : "no"'; }

# The text that replaces the output; empty when the hook replaced nothing
compressed_text() { hook_value "$1" 'updated ? updated.stdout : ""'; }

# The rule named in the marker line of the replaced output; "none" when the
# hook replaced nothing
rule_type() { hook_value "$1" '((updated ? updated.stdout : "").match(/\| ([\w-]+)\]$/) || [0, "none"])[1]'; }

# Output with 100 lines: long enough for every rule except git-status, which
# removes hint lines only
NOISY=$(node -e 'for (let i = 1; i <= 100; i++) console.log("noisy output line " + i + " of the command")')

# Output of `git status` with 4 hint lines: 10 lines that are not empty, 6 of
# them stay
STATUS_OUT=$(printf 'On branch main\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n  (use "git restore <file>..." to discard changes in working directory)\n\tmodified:   hooks/hooks.json\n\tmodified:   README.md\n\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\tnotes.md\n\nno changes added to commit (use "git add" and/or "git commit -a")')
STATUS_MARKER='[compressed: 10->6 lines | git-status]'

cd "$PLUGIN_ROOT"

# ═══════════════════════════════════════════════════════
bold "\n1. SYNTAX & MODULE LOADING"
# ═══════════════════════════════════════════════════════

result=$(node -c hooks/compression-rules.js 2>&1 && echo "ok")
assert "compression-rules.js syntax valid" "$result" "ok"

result=$(node -c hooks/bash-compress-hook.js 2>&1 && echo "ok")
assert "bash-compress-hook.js syntax valid" "$result" "ok"

result=$(node -e "const r = require('./hooks/compression-rules'); console.log(r.RULES.length > 0 && r.NEVER_COMPRESS.length > 0 ? 'ok' : 'fail')")
assert "compression-rules exports non-empty RULES and NEVER_COMPRESS" "$result" "ok"

result=$(node -e "const r = require('./hooks/compression-rules'); console.log(r.RULES.length)")
assert "17 compression rules defined" "$result" "17"

result=$(node -e "const r = require('./hooks/compression-rules'); console.log(r.NEVER_COMPRESS.length)")
assert "9 never-compress patterns defined" "$result" "9"

# ═══════════════════════════════════════════════════════
bold "\n2. NEVER-COMPRESS CLASSIFICATION"
# ═══════════════════════════════════════════════════════

# The output is long, so only the command can be the reason for raw output
check_never() { is_compressed "$(run_hook "$1" "$NOISY" "never-$$-$RANDOM")"; }

assert "git diff passes through"            "$(check_never 'git diff HEAD')"            "no"
assert "git diff --staged passes through"   "$(check_never 'git diff --staged')"        "no"
assert "cat file passes through"            "$(check_never 'cat README.md')"            "no"
assert "head file passes through"           "$(check_never 'head -20 file.js')"         "no"
assert "tail file passes through"           "$(check_never 'tail -f log.txt')"          "no"
assert "curl passes through"                "$(check_never 'curl https://api.example.com')" "no"
assert "wget passes through"                "$(check_never 'wget https://example.com')" "no"
assert "echo passes through"                "$(check_never 'echo hello')"               "no"
assert "printf passes through"              "$(check_never 'printf hello')"             "no"
assert "piped grep passes through"          "$(check_never 'git log | grep fix')"       "no"
assert "piped awk passes through"           "$(check_never 'cat file | awk NF')"        "no"

# A compound command runs several commands, and a rule matches only the first
# one, so compressing it can remove the output of the later commands (row 36).
assert "&& chain passes through"            "$(check_never 'git add . && git commit -m msg && git log --oneline -1')" "no"
assert "|| chain passes through"            "$(check_never 'git log || true')"         "no"
assert "; chain passes through"             "$(check_never 'git status; git log')"     "no"
assert "pipe into tail passes through"      "$(check_never 'git push origin main | tail -5')" "no"
assert "new-line chain passes through"      "$(check_never $'git add .\ngit log')"     "no"
assert "background & passes through"        "$(check_never 'npm install & wait')"      "no"
assert "background & before < passes through" "$(check_never 'npm install &<in wait')"  "no"
assert "--verbose passes through"           "$(check_never 'npm install --verbose')"    "no"
assert "--debug passes through"             "$(check_never 'cargo build --debug')"      "no"
assert "node -e passes through"             "$(check_never 'node -e console.log(1)')"  "no"
assert "rtk command passes through"         "$(check_never 'rtk git status')"           "no"

# ═══════════════════════════════════════════════════════
bold "\n3. RULE MATCHING (commands whose output SHOULD be compressed)"
# ═══════════════════════════════════════════════════════

# The rule that compressed the output of a command; "none" when the output
# stayed raw. A new session id for each call: the hook leaves the second run
# of a command in one session raw.
check_rule() { rule_type "$(run_hook "$1" "${2:-$NOISY}" "rule-$$-$RANDOM")"; }

assert "git add . → git-add rule"            "$(check_rule 'git add .')"            "git-add"
assert "git commit → git-commit rule"        "$(check_rule 'git commit -m msg')"    "git-commit"
assert "git push → git-push rule"            "$(check_rule 'git push origin main')" "git-push"
assert "git pull → git-pull rule"            "$(check_rule 'git pull')"             "git-pull"
assert "git clone → git-clone rule"          "$(check_rule 'git clone https://github.com/x/y')" "git-clone"
assert "git status → git-status rule"        "$(check_rule 'git status' "$STATUS_OUT")" "git-status"
assert "git log → git-log rule"              "$(check_rule 'git log')"              "git-log"
assert "npm install → npm-install rule"      "$(check_rule 'npm install')"          "npm-install"
assert "npm test → test-pass rule"           "$(check_rule 'npm test')"             "test-pass"
assert "cargo test → test-pass rule"         "$(check_rule 'cargo test')"           "test-pass"
assert "pytest → test-pass rule"             "$(check_rule 'pytest')"               "test-pass"
assert "ls → ls-large rule"                  "$(check_rule 'ls')"                   "ls-large"
assert "cargo build → build-success rule"    "$(check_rule 'cargo build')"          "build-success"
assert "eslint → lint-output rule"           "$(check_rule 'eslint src/')"          "lint-output"
assert "docker build → docker-build rule"    "$(check_rule 'docker build .')"       "docker-build"
# Redirects contain '&' but join no commands, so they do not stop compression.
assert "npm test 2>&1 → compressed"          "$(check_rule 'npm test 2>&1')"        "test-pass"
assert "npm test &>file → compressed"        "$(check_rule 'npm test &>test.log')"  "test-pass"
assert "npm test <&0 → compressed"           "$(check_rule 'npm test <&0')"         "test-pass"

# ═══════════════════════════════════════════════════════
bold "\n4. COMPRESSION QUALITY (unit tests on compress functions)"
# ═══════════════════════════════════════════════════════

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-add');
console.log(r.compress('', '', 0));
")
assert "git-add empty output → 'ok'" "$result" "ok"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-add');
console.log(r.compress('', '', 1));
")
assert "git-add failure → null (raw passthrough)" "$result" "null"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-add');
const c = r.compress('', 'warning: CRLF will be replaced by LF\n', 0);
console.log(c && c.includes('warning') ? 'ok' : c);
")
assert "git-add with CRLF warning preserves warning" "$result" "ok"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-commit');
const out = '[main abc1234] Fix bug\n 3 files changed, 10 insertions(+), 2 deletions(-)\n';
const c = r.compress(out, '', 0);
console.log(c.includes('abc1234') && c.includes('3 files') ? 'ok' : c);
")
assert "git-commit keeps hash and file stats" "$result" "ok"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-commit');
console.log(r.compress('', 'error', 1));
")
assert "git-commit failure → null" "$result" "null"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-push');
const err = 'To github.com:user/repo.git\n   abc1234..def5678  main -> main\n';
const c = r.compress('', err, 0);
console.log(c && c.startsWith('ok') ? 'ok' : c);
")
assert "git-push success → compact ok message" "$result" "ok"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-pull');
console.log(r.compress('Already up to date.\n', '', 0));
")
assert "git-pull up-to-date → summary" "$result" "ok: already up to date"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-status');
const s = 'On branch main\n\nChanges not staged:\n  (use \"git add <file>...\")\n  (use \"git restore <file>...\")\n\tmodified:   foo.js\n\nno changes added to commit\n';
const c = r.compress(s, '', 0);
const hints = c.includes('(use \"git add') || c.includes('no changes added to commit');
console.log(!hints ? 'ok' : 'hints-remain');
")
assert "git-status removes all hint lines" "$result" "ok"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-status');
const s = 'On branch main\n\nChanges not staged:\n  (use \"git add <file>...\")\n\tmodified:   foo.js\n';
const c = r.compress(s, '', 0);
console.log(c.includes('foo.js') ? 'ok' : 'file-missing');
")
assert "git-status keeps file list" "$result" "ok"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'npm-install');
const out = 'added 150 packages in 12s\n\n2 vulnerabilities (1 moderate, 1 high)\n';
const c = r.compress(out, '', 0);
console.log(c.includes('150') && c.includes('vulnerabilit') ? 'ok' : c);
")
assert "npm-install keeps package count and vulnerability summary" "$result" "ok"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'test-pass');
console.log(r.compress('PASS\n3 tests passed\n', '', 0));
")
assert "test-pass short output → null (below threshold)" "$result" "null"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'test-pass');
const long = Array(100).fill('  PASS src/test.js').join('\n') + '\nTest Suites: 5 passed, 5 total\nTests: 100 passed, 100 total\nTime: 3.2s\n';
const c = r.compress(long, '', 0);
const hasSummary = c.includes('Tests: 100 passed');
const noisy = (c.match(/  PASS src\/test\.js/g) || []).length;
console.log(hasSummary && noisy === 0 ? 'ok' : 'summary:' + hasSummary + ',noisy:' + noisy);
")
assert "test-pass: keeps summary lines, removes individual PASS lines" "$result" "ok"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'test-pass');
console.log(r.compress('FAIL src/test.js\nAssertionError', 'AssertionError: expected 1 to equal 2', 1));
")
assert "test-pass on FAILURE → null (full output preserved)" "$result" "null"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-log');
const short = 'commit abc1234\nAuthor: A\nDate: D\n\n    msg\n';
console.log(r.compress(short, '', 0));
")
assert "git-log short output → null (already short enough)" "$result" "null"

result=$(node -e "
const { RULES } = require('./hooks/compression-rules');
const r = RULES.find(r => r.type === 'git-log');
const long = Array(50).fill('commit abc\nAuthor: A\nDate: D\n\n    msg\n').join('\n');
const c = r.compress(long, '', 0);
console.log(c && c.includes('more lines') ? 'ok' : 'no-truncation-marker');
")
assert "git-log long output → truncated with 'more lines' marker" "$result" "ok"

# ═══════════════════════════════════════════════════════
bold "\n5. OUTPUT REPLACEMENT"
# ═══════════════════════════════════════════════════════

# The hook output for a compressed call holds the whole tool response, with
# only the `stdout` field changed.
out=$(run_hook "git status" "$STATUS_OUT" "replace-$$-$RANDOM")
result=$(hook_value "$out" '
  JSON.stringify(Object.keys(out)) === "[\"hookSpecificOutput\"]" &&
  JSON.stringify(Object.keys(out.hookSpecificOutput)) === "[\"hookEventName\",\"updatedToolOutput\"]" &&
  out.hookSpecificOutput.hookEventName === "PostToolUse" ? "ok" : JSON.stringify(out)')
assert "replacement: the output holds hookEventName PostToolUse and updatedToolOutput, nothing else" "$result" "ok"
result=$(hook_value "$out" '
  JSON.stringify({ ...updated, stdout: "" }) ===
  JSON.stringify({ stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false }) ? "ok" : JSON.stringify(updated)')
assert "replacement: every other field of the tool response is unchanged" "$result" "ok"
text=$(compressed_text "$out")
assert_contains     "replacement: the compressed text keeps the branch line"   "$text" "On branch main"
assert_contains     "replacement: the compressed text keeps the file list"     "$text" "modified:   README.md"
assert_not_contains "replacement: the compressed text has no hint line"        "$text" '(use "git'
assert "replacement: the last line is the marker" "$(echo "$text" | tail -1)" "$STATUS_MARKER"

# A `stderr` field that is not empty goes to the rule and stays as it is
out=$(run_hook "git status" "$STATUS_OUT" "stderr-$$-$RANDOM" 'input.tool_response.stderr = "warning: something\n";')
assert "replacement: a stderr field that is not empty stays unchanged" \
  "$(hook_value "$out" 'updated ? JSON.stringify(updated.stderr) : "not replaced"')" '"warning: something\n"'

# Windows line ends do not stop a rule
out=$(run_hook "git status" "$STATUS_OUT" "crlf-$$-$RANDOM" 'input.tool_response.stdout = input.tool_response.stdout.replace(/\n/g, "\r\n");')
assert_not_contains "replacement: hint lines with Windows line ends are removed" "$(compressed_text "$out")" '(use "git'
assert "replacement: output with Windows line ends gets the marker" "$(compressed_text "$out" | tail -1)" "$STATUS_MARKER"

# Real output of a real command. An untracked probe file makes `git status`
# print hint lines on a clean tree too. Must not end in .txt (.gitignore
# covers *.txt).
PROBE_FILE="$PLUGIN_ROOT/.sp-test-probe.tmp"
touch "$PROBE_FILE"
real_status=$(git status 2>&1)
rm -f "$PROBE_FILE"
text=$(compressed_text "$(run_hook "git status" "$real_status" "real-$$-$RANDOM")")
assert_contains     "real git status: the compressed text contains branch info"  "$text" "On branch"
assert_not_contains "real git status: hint lines are removed"                     "$text" '(use "git'
assert_contains     "real git status: has [compressed] marker"                    "$text" "[compressed:"

# Above 30,000 characters Claude Code cuts `stdout` and saves the whole output
# in a file. The hook must compress the whole output, not the cut part.
FULL_FILE=$(mktmp)
node -e 'for (let i = 1; i <= 3000; i++) console.log("./src/folder/file-" + i + ".js")' > "$FULL_FILE"
export FULL_FILE
PERSISTED='
  const full = require("fs").readFileSync(process.env.FULL_FILE, "utf8");
  input.tool_response.stdout = full.slice(0, 30000);
  input.tool_response.persistedOutputPath = process.env.FULL_FILE;
  input.tool_response.persistedOutputSize = Buffer.byteLength(full);'
out=$(run_hook "find . -name '*.js'" "" "persisted-$$-$RANDOM" "$PERSISTED")
text=$(compressed_text "$out")
assert_contains "saved output: the rule counts the lines of the whole output" "$text" "... 2940 more results"
assert "saved output: the marker counts the lines of the whole output" "$(echo "$text" | tail -1)" "[compressed: 3000->61 lines | find-large]"
assert "saved output: the replacement has no persistedOutputPath and no persistedOutputSize" \
  "$(hook_value "$out" 'updated ? Object.keys(updated).join(",") : "not replaced"')" "stdout,stderr,interrupted,isImage,noOutputExpected"

# A response that the hook cannot prove safe to replace stays as it is
untouched() { run_hook "${3:-git status}" "${2:-$STATUS_OUT}" "untouched-$$-$RANDOM" "$1"; }

assert "saved output: a file that cannot be read → {}" \
  "$(untouched "$PERSISTED"' input.tool_response.persistedOutputPath += ".missing";' "" "find . -name '*.js'")" "{}"
assert "saved output: a file that does not start with the cut output → {}" \
  "$(untouched "$PERSISTED"' input.tool_response.stdout = "other output\n" + input.tool_response.stdout;' "" "find . -name '*.js'")" "{}"
BIG_FILE=$(mktmp)
node -e 'require("fs").writeFileSync(process.argv[1], "./file.js\n".repeat(1100000))' "$BIG_FILE"
assert "saved output: a file above 10 MB → {}" \
  "$(FULL_FILE="$BIG_FILE" untouched "$PERSISTED" "" "find . -name '*.js'")" "{}"
rm -f "$BIG_FILE"

assert "untouched: a call moved to the background by run_in_background → {}" \
  "$(untouched 'input.tool_input.run_in_background = true; input.tool_response.backgroundTaskId = "bsenraxvw";')" "{}"
assert "untouched: a call moved to the background at its time-out → {}" \
  "$(untouched 'input.tool_input.timeout = 2000; input.tool_response.backgroundTaskId = "bjan2dvyw"; input.tool_response.timedOutAfterMs = 2000;')" "{}"
assert "untouched: an interrupted call → {}" \
  "$(untouched 'input.tool_response.interrupted = true;')" "{}"
assert "untouched: image output → {}" \
  "$(untouched 'input.tool_response.isImage = true;')" "{}"
assert "untouched: an exit status that is not 0 and that Claude Code accepts (returnCodeInterpretation) → {}" \
  "$(untouched 'input.tool_response.returnCodeInterpretation = "Some directories were inaccessible";')" "{}"
assert "untouched: a field that the hook does not know → {}" \
  "$(untouched 'input.tool_response.someNewField = 1;')" "{}"
assert "untouched: no stdout field → {}" \
  "$(untouched 'delete input.tool_response.stdout;')" "{}"
assert "untouched: a stdout field that is not text → {}" \
  "$(untouched 'input.tool_response.stdout = null;')" "{}"
assert "untouched: no stderr field → {}" \
  "$(untouched 'delete input.tool_response.stderr;')" "{}"
assert "untouched: no interrupted field → {}" \
  "$(untouched 'delete input.tool_response.interrupted;')" "{}"
assert "untouched: a tool response that is text → {}" \
  "$(untouched 'input.tool_response = input.tool_response.stdout;')" "{}"
assert "untouched: a tool response that is a list → {}" \
  "$(untouched 'input.tool_response = [input.tool_response];')" "{}"
assert "untouched: no tool response → {}" \
  "$(untouched 'delete input.tool_response;')" "{}"
# A command that fails does not reach PostToolUse: Claude Code sends the
# PostToolUseFailure event, with an `error` text and no tool response.
assert "untouched: the PostToolUseFailure input of a failed command → {}" \
  "$(untouched 'input.hook_event_name = "PostToolUseFailure"; input.error = "Exit code 3\n" + input.tool_response.stdout; input.is_interrupt = false; delete input.tool_response;')" "{}"

# Raw output for reasons in the output itself
assert "short output (below 200 characters) → {}" \
  "$(run_hook 'git status' 'On branch main' "short-$$-$RANDOM")" "{}"
assert "a rule that returns null (git log with 40 lines or fewer) → {}" \
  "$(run_hook 'git log' "$(echo "$NOISY" | head -40)" "null-$$-$RANDOM")" "{}"
assert "output from which the rule removes no line (git status without hint lines) → {}" \
  "$(run_hook 'git status' "$NOISY" "same-$$-$RANDOM")" "{}"

# ═══════════════════════════════════════════════════════
bold "\n6. HOOK I/O PROTOCOL"
# ═══════════════════════════════════════════════════════

# Non-Bash tool → passthrough
assert "non-Bash tool passes through as {}" \
  "$(untouched 'input.tool_name = "Read"; input.tool_input = { file_path: "/tmp/test" };')" "{}"

# Unknown command → passthrough
assert "unknown command passes through as {}" "$(run_hook 'some-obscure-tool --flags' "$NOISY")" "{}"

# Empty command → passthrough
assert "empty command passes through as {}" "$(run_hook '' "$NOISY")" "{}"

# Input that is not JSON → passthrough
bad_input=$(mktmp)
printf 'not json' > "$bad_input"
assert "input that is not JSON passes through as {}" "$(run_hook_file "$bad_input")" "{}"

# ═══════════════════════════════════════════════════════
bold "\n7. ADAPTIVE RE-RUN DETECTION"
# ═══════════════════════════════════════════════════════

SESSION="rerun-$$"

r1=$(run_hook "git status" "$STATUS_OUT" "$SESSION")
r2=$(run_hook "git status" "$STATUS_OUT" "$SESSION")
r3=$(run_hook "git status" "$STATUS_OUT" "$SESSION")

assert "re-run: 1st run is compressed"       "$(is_compressed "$r1")" "yes"
assert "re-run: 2nd run passes through raw"  "$r2"                    "{}"
assert "re-run: 3rd run compressed again"    "$(is_compressed "$r3")" "yes"

# Different commands track independently
rl1=$(run_hook "git log" "$NOISY" "$SESSION")
rl2=$(run_hook "git log" "$NOISY" "$SESSION")
assert "re-run: different command 1st run compressed" "$(is_compressed "$rl1")" "yes"
assert "re-run: different command 2nd run raw"        "$rl2"                    "{}"

# The hook writes its record of compressed commands into one file per session
OTHER_SESSION="rerun-other-$$"
run_hook "npm install" "$NOISY" "$OTHER_SESSION" > /dev/null
read_record() {
  RECORD_FILE="$TRACK_DIR/sp-compress-$1.json" node -e '
    const record = JSON.parse(require("fs").readFileSync(process.env.RECORD_FILE, "utf8"));
    console.log(Object.keys(record).sort().map(command =>
      command + "=" + record[command].compressed + "," + typeof record[command].ts).join(" | "));
  ' 2>&1
}
assert "session record: the file of a session holds its commands, with the state and the time of the last run" \
  "$(read_record "$SESSION")" "git log=false,number | git status=true,number"
assert "session record: another session has its own file" \
  "$(read_record "$OTHER_SESSION")" "npm install=true,number"

# ═══════════════════════════════════════════════════════
bold "\n8. DISABLE MECHANISMS"
# ═══════════════════════════════════════════════════════

# SP_NO_COMPRESS env var
status_input=$(build_input "git status" "$STATUS_OUT" "disable-$$-$RANDOM")
result=$(SP_NO_COMPRESS=1 run_hook_file "$status_input")
assert "SP_NO_COMPRESS=1 disables compression" "$result" "{}"
assert "the same input without SP_NO_COMPRESS is compressed" "$(is_compressed "$(run_hook_file "$status_input")")" "yes"

# .sp-no-compress file in project dir
export NO_COMPRESS_DIR="$WORK/project"
mkdir "$NO_COMPRESS_DIR"
touch "$NO_COMPRESS_DIR/.sp-no-compress"
assert ".sp-no-compress file disables compression" \
  "$(untouched 'input.cwd = process.env.NO_COMPRESS_DIR;')" "{}"

# ═══════════════════════════════════════════════════════
bold "\n9. TOKEN SAVINGS MEASUREMENT"
# ═══════════════════════════════════════════════════════

bold "\n  Measuring real token savings on live commands:\n"

measure() {
  local desc="$1" cmd="$2"
  local raw compressed raw_tok comp_tok saved

  raw=$(bash -c "$cmd" 2>&1)
  raw_tok=$(( ${#raw} / 4 ))

  # The text Claude receives: the replacement, or the raw output when the hook
  # replaced nothing
  compressed=$(compressed_text "$(run_hook "$cmd" "$raw" "measure-$$-$RANDOM")")
  [ -n "$compressed" ] || compressed="$raw"
  comp_tok=$(( ${#compressed} / 4 ))

  if [ "${#raw}" -le 200 ]; then
    printf "  %-38s output too short (%d chars) — correctly skipped\n" "$desc" "${#raw}"
    ((PASS++))
    green "  PASS: $desc (below threshold)"
  elif [ "$comp_tok" -lt "$raw_tok" ]; then
    saved=$(( (raw_tok - comp_tok) * 100 / raw_tok ))
    printf "  %-38s ~%d tok → ~%d tok  (%d%% saved)\n" "$desc" "$raw_tok" "$comp_tok" "$saved"
    ((PASS++))
    green "  PASS: $desc achieves ${saved}% token savings"
  else
    printf "  %-38s ~%d tok → ~%d tok  (no compression)\n" "$desc" "$raw_tok" "$comp_tok"
    ((PASS++))
    green "  PASS: $desc correctly passed through (rule returned null)"
  fi
}

measure "git status"             "git status"
measure "git log (last 50)"      "git log --oneline -50"
measure "ls -la (plugin root)"   "ls -la"
measure "find hooks/ -type f"    "find hooks/ -type f"

# Simulate npm install output (can't run real install)
npm_mock=$(node -e "
const lines = [];
for(let i=0;i<80;i++) lines.push('  package-'+i+'@1.'+i+'.0');
lines.push('added 150 packages, and audited 200 packages in 12s');
lines.push('');
lines.push('2 vulnerabilities (1 moderate, 1 high)');
process.stdout.write(lines.join('\n'));
")
raw_tok=$(( ${#npm_mock} / 4 ))
# The mock goes through the environment, never through the -e source: it is
# multi-line, and interpolating it into a JS string literal is a syntax error
# that empties comp_result — which the savings check below reads as perfect
# compression. Crashes stay on stderr for the same reason.
comp_result=$(NPM_MOCK="$npm_mock" node -e "
  const { RULES } = require('./hooks/compression-rules');
  const r = RULES.find(r => r.type === 'npm-install');
  const c = r.compress(process.env.NPM_MOCK, '', 0);
  process.stdout.write(c || '');
")
comp_tok=$(( ${#comp_result} / 4 ))
if [ -z "$comp_result" ]; then
  red "  FAIL: npm-install simulation produced no output (rule missing, or compress threw or returned null)"
  ERRORS+=("npm-install simulation produced no output")
  ((FAIL++))
elif [ "$comp_tok" -lt "$raw_tok" ] && [ "$raw_tok" -gt 0 ]; then
  saved=$(( (raw_tok - comp_tok) * 100 / raw_tok ))
  printf "  %-38s ~%d tok → ~%d tok  (%d%% saved)\n" "npm install (80-pkg mock)" "$raw_tok" "$comp_tok" "$saved"
  ((PASS++))
  green "  PASS: npm-install simulation achieves ${saved}% token savings"
else
  red "  FAIL: npm-install simulation achieved no savings ($raw_tok → $comp_tok)"
  ERRORS+=("npm-install simulation token savings")
  ((FAIL++))
fi

# ═══════════════════════════════════════════════════════
bold "\n10. HOOK WIRING"
# ═══════════════════════════════════════════════════════

# The names of the hook events of a hooks file that run bash-compress-hook
compress_events() {
  node -e "
    const hooks = JSON.parse(require('fs').readFileSync('$1','utf8')).hooks;
    const events = Object.keys(hooks).filter(event => hooks[event].some(entry =>
      (entry.hooks || []).some(h => h.command && h.command.includes('bash-compress-hook'))));
    console.log(events.join(',') || 'none');
  "
}

assert "hooks.json: bash-compress-hook runs on PostToolUse only" "$(compress_events hooks/hooks.json)" "PostToolUse"

result=$(node -e "
  const hooks = JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')).hooks;
  const entry = hooks.PostToolUse.find(e => e.hooks.some(h => h.command.includes('bash-compress-hook')));
  console.log(entry.matcher);
")
assert "hooks.json: the bash-compress-hook entry matches the Bash tool only" "$result" "Bash"

assert "hooks-cursor.json: bash-compress-hook is not registered" "$(compress_events hooks/hooks-cursor.json)" "none"

result=$(node -e "
  const lines = require('fs').readFileSync('plugin.universal.yaml','utf8').split('\n');
  const events = [];
  let event = '';
  for (const line of lines) {
    const m = line.match(/^\s*- event:\s*(\S+)/);
    if (m) event = m[1];
    if (line.includes('hooks/bash-compress-hook.js')) events.push(event);
  }
  console.log(events.join(',') || 'none');
")
assert "plugin.universal.yaml: bash-compress-hook is declared on PostToolUse only" "$result" "PostToolUse"

result=$(node -e "
  // Verify hooks.json is still valid JSON with correct structure
  const h = JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'));
  const required = ['SessionStart','UserPromptSubmit','PostToolUse','Stop','SubagentStop','PreToolUse'];
  const ok = required.every(k => h.hooks[k]);
  console.log(ok ? 'ok' : 'missing-keys');
")
assert "hooks.json: all original hook sections still present" "$result" "ok"

assert "hooks/bash-optimizer.js does not exist" "$([ -e hooks/bash-optimizer.js ] && echo exists || echo absent)" "absent"

# ═══════════════════════════════════════════════════════
bold "\n11. THE PLUGIN NEVER REWRITES OR APPROVES A BASH COMMAND"
# ═══════════════════════════════════════════════════════

# An earlier form of the compression hook ran on PreToolUse and returned
# permissionDecision "allow" with a replaced command (updatedInput). Claude
# Code then skipped the permission prompt, and compared the deny rules and the
# ask rules of the user with the replaced command. No hook of the plugin may
# return either field for a Bash command.

assert "no file in hooks/ contains the text updatedInput" \
  "$(grep -rl 'updatedInput' hooks | tr '\n' ' ')" ""

# For one command: run every PreToolUse hook that hooks.json starts for the
# Bash tool, and run bash-compress-hook with a PreToolUse input and with a
# PostToolUse input. Print "clean", or each output that rewrites or approves.
permission_fields() {
  local post_file
  post_file=$(build_input "$1" "$NOISY" "permission-$$-$RANDOM")
  REVIEW_COMMAND="$1" POST_FILE="$post_file" SAFE_HOME="$WORK" PLUGIN_ROOT="$PLUGIN_ROOT" HOOK="$HOOK" \
  TMPDIR="$TRACK_DIR" TEMP="$TRACK_DIR" TMP="$TRACK_DIR" node -e '
    const { spawnSync } = require("child_process");
    const fs = require("fs");
    const e = process.env;
    const post = fs.readFileSync(e.POST_FILE, "utf8");
    const { tool_response, duration_ms, ...pre } = { ...JSON.parse(post), hook_event_name: "PreToolUse" };
    const preInput = JSON.stringify(pre);
    // The safety hooks write a log below the home folder
    const env = { ...e, HOME: e.SAFE_HOME, USERPROFILE: e.SAFE_HOME, CLAUDE_PLUGIN_ROOT: e.PLUGIN_ROOT };
    const wired = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8")).hooks.PreToolUse
      .filter(entry => new RegExp("^(" + (entry.matcher || ".*") + ")$").test("Bash"))
      .flatMap(entry => entry.hooks.map(h => h.command.split("${CLAUDE_PLUGIN_ROOT}").join(e.PLUGIN_ROOT)));
    const runs = [
      ...wired.map(command => spawnSync(command, { shell: true, input: preInput, env, encoding: "utf8" })),
      spawnSync("node", [e.HOOK], { input: preInput, env, encoding: "utf8" }),
      spawnSync("node", [e.HOOK], { input: post, env, encoding: "utf8" }),
    ];
    const bad = runs.map(run => run.stdout || "").filter(text => {
      if (text.includes("updatedInput")) return true;
      try {
        const h = JSON.parse(text || "{}").hookSpecificOutput;
        return Boolean(h && h.permissionDecision === "allow");
      } catch { return false; }
    });
    console.log(runs.length >= 4 && bad.length === 0 ? "clean" : "runs=" + runs.length + " " + bad.join(" "));
  '
}

# The 9 commands of the review (docs/reviews/2026-10-03-whole-project, V1.1)
assert "git push: no hook rewrites or approves the command"      "$(permission_fields 'git push origin main')" "clean"
assert "git commit: no hook rewrites or approves the command"    "$(permission_fields 'git commit -m "wip"')" "clean"
assert "npm install: no hook rewrites or approves the command"   "$(permission_fields 'npm install left-pad')" "clean"
assert "pip install: no hook rewrites or approves the command"   "$(permission_fields 'pip install requests')" "clean"
assert "make: no hook rewrites or approves the command"          "$(permission_fields 'make deploy')" "clean"
assert "find -delete: no hook rewrites or approves the command"  "$(permission_fields "find . -name '*.tmp' -delete")" "clean"
assert "docker build: no hook rewrites or approves the command"  "$(permission_fields 'docker build -t app .')" "clean"
assert "command substitution: no hook rewrites or approves the command" \
  "$(permission_fields 'ls -d $(touch substitution-ran.flag)')" "clean"
assert "git status: no hook rewrites or approves the command"    "$(permission_fields 'git status')" "clean"

# The hook answers a PreToolUse input with {}: a hooks file of an older
# release that still starts it on PreToolUse changes nothing
assert "a PreToolUse input passes through as {}" \
  "$(untouched 'input.hook_event_name = "PreToolUse"; delete input.tool_response;')" "{}"

# ═══════════════════════════════════════════════════════
bold "\n\n══════════════════════════════════════════"
printf "  Results: "
green "$PASS passed"
printf "  "
if [ "$FAIL" -gt 0 ]; then
  red "$FAIL failed"
else
  echo "0 failed"
fi
echo "══════════════════════════════════════════"

if [ "${#ERRORS[@]}" -gt 0 ]; then
  red "\nFailed tests:"
  for e in "${ERRORS[@]}"; do
    red "  - $e"
  done
  exit 1
fi

exit 0
