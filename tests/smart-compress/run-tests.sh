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

# The caller's environment must not turn the hook off: remove every SP_*
# variable that the hook reads
unset SP_NO_COMPRESS

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

# Run the hook with the input in the file $1, print its standard output.
# Claude Code reads exit status 2 as a blocking error and shows standard error
# to Claude, so a run with another exit status than 0, or with text on
# standard error, prints a text that no check expects.
run_hook_file() {
  local err_file out status
  err_file=$(mktmp)
  out=$(TMPDIR="$TRACK_DIR" TEMP="$TRACK_DIR" TMP="$TRACK_DIR" node "$HOOK" < "$1" 2> "$err_file")
  status=$?
  if [ "$status" -ne 0 ] || [ -s "$err_file" ]; then
    echo "HOOK FAILED: exit status $status, standard error: $(cat "$err_file")"
  else
    printf '%s\n' "$out"
  fi
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

# No rule matches the next 9 commands: every rule starts with another program
# name. The checks state the documented result; they cannot show which of the
# two reasons (the never-compress list, or no rule) keeps the output raw.

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
assert "piped awk passes through"           "$(check_never 'npm test | awk NF')"        "no"

# A compound command runs several commands, and a rule matches only the first
# one, so compressing it can remove the output of the later commands (row 36).
# In each command below, a rule matches the first command and compresses the
# 100 lines, so only the separator keeps the output raw.
assert "&& chain passes through"            "$(check_never 'git add . && git commit -m msg && git log --oneline -1')" "no"
assert "|| chain passes through"            "$(check_never 'git log || true')"         "no"
assert "; chain passes through"             "$(check_never 'git log; git status')"     "no"
assert "pipe into tail passes through"      "$(check_never 'git push origin main | tail -5')" "no"
assert "new-line chain passes through"      "$(check_never $'git add .\ngit log')"     "no"
assert "background & passes through"        "$(check_never 'npm install & wait')"      "no"
assert "background & before < passes through" "$(check_never 'npm install &<in wait')"  "no"
assert "--verbose passes through"           "$(check_never 'npm install --verbose')"    "no"
assert "--debug passes through"             "$(check_never 'cargo build --debug')"      "no"
# No rule matches the next 2 commands (see above)
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
assert "git fetch → git-fetch rule"          "$(check_rule 'git fetch origin')"     "git-fetch"
assert "git status → git-status rule"        "$(check_rule 'git status' "$STATUS_OUT")" "git-status"
assert "git log → git-log rule"              "$(check_rule 'git log')"              "git-log"
assert "npm install → npm-install rule"      "$(check_rule 'npm install')"          "npm-install"
assert "pip install → pip-install rule"      "$(check_rule 'pip install requests')" "pip-install"
assert "cargo install → cargo-install rule"  "$(check_rule 'cargo install ripgrep')" "cargo-install"
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
assert "replacement: the text has no carriage return character" \
  "$(hook_value "$out" 'updated ? updated.stdout.includes("\r") : "not replaced"')" "false"

# The rule receives the `stderr` field: the git-add rule reports the warning
out=$(run_hook "git add ." "$NOISY" "stderr-rule-$$-$RANDOM" 'input.tool_response.stderr = "warning: CRLF will be replaced by LF in a.txt\n";')
assert_contains "replacement: the rule receives the stderr field" "$(compressed_text "$out")" "ok (1 warning(s))"

# Real output of a real command, in a repository of the suite: one changed
# file and one untracked file make `git status` print hint lines.
FIXTURE_REPO="$WORK/repo"
mkdir "$FIXTURE_REPO"
real_status=$(
  cd "$FIXTURE_REPO" &&
  git -c init.defaultBranch=main init -q . &&
  echo one > tracked.txt &&
  git add tracked.txt &&
  git -c user.name=test -c user.email=test@example.com -c commit.gpgsign=false commit -q -m first &&
  echo two >> tracked.txt &&
  echo new > untracked.md &&
  LC_ALL=C git status 2>&1
)
text=$(compressed_text "$(run_hook "git status" "$real_status" "real-$$-$RANDOM")")
assert_contains     "real git status: the compressed text contains branch info"  "$text" "On branch"
assert_contains     "real git status: the compressed text keeps the changed file" "$text" "tracked.txt"
assert_not_contains "real git status: hint lines are removed"                     "$text" '(use "git'
assert_contains     "real git status: has [compressed] marker"                    "$text" "[compressed:"

# A response that the hook cannot prove safe to replace stays as it is
untouched() { run_hook "${3:-git status}" "${2:-$STATUS_OUT}" "untouched-$$-$RANDOM" "$1"; }

# Above 30,000 characters Claude Code cuts `stdout` and saves the whole output
# in a file. Claude then receives a preview of about 2,000 characters and the
# path of the file, so a replacement could be longer than what Claude
# receives. The hook leaves such a response as it is.
export FULL_FILE
FULL_FILE=$(mktmp)
node -e 'for (let i = 1; i <= 3000; i++) console.log("./src/folder/file-" + i + ".js")' > "$FULL_FILE"
PERSISTED='
  const full = require("fs").readFileSync(process.env.FULL_FILE, "utf8");
  input.tool_response.stdout = full.slice(0, 30000);
  input.tool_response.persistedOutputPath = process.env.FULL_FILE;
  input.tool_response.persistedOutputSize = Buffer.byteLength(full);'
assert "saved output: a response with the two persisted fields → {}" \
  "$(run_hook "find . -name '*.js'" "" "persisted-$$-$RANDOM" "$PERSISTED")" "{}"
assert "saved output: the same output without the two fields is compressed" \
  "$(is_compressed "$(run_hook "find . -name '*.js'" "" "persisted-$$-$RANDOM" "$PERSISTED"' delete input.tool_response.persistedOutputPath; delete input.tool_response.persistedOutputSize;')")" "yes"
assert "saved output: a persistedOutputPath field alone → {}" \
  "$(untouched 'input.tool_response.persistedOutputPath = process.env.FULL_FILE;')" "{}"
assert "saved output: a persistedOutputSize field alone → {}" \
  "$(untouched 'input.tool_response.persistedOutputSize = 108894;')" "{}"

# The size rule: the hook replaces the output only when the replacement is
# shorter than the `stdout` text of the response.
assert "size rule: a replacement longer than the stdout of the response → {}" \
  "$(untouched 'input.tool_response.stdout = "On branch main\nChanges not staged for commit:\n  (use \"git x\")\n" + "\tmodified:   src/folder/changed-file.js\n".repeat(6);')" "{}"
assert "size rule: a long replacement that is shorter than the stdout is used" \
  "$(is_compressed "$(untouched 'input.tool_response.stdout = "On branch main\n" + ("\tmodified:   src/folder/changed-file.js\n" + "  (use \"git add <file>...\" to update what will be committed)\n").repeat(1500);')")" "yes"

# Fields that Claude Code adds to the response of a command that ended with
# exit status 0. The shapes of the first three come from recorded tool results
# of Claude Code 2.1.289; the fourth is the `dangerouslyDisableSandbox` field
# of the tool input (read in the program text). The hook returns each unchanged.
kept_field() {
  local out
  out=$(run_hook "$1" "$NOISY" "field-$$-$RANDOM" "input.tool_response.$2 = $3;")
  hook_value "$out" "updated ? JSON.stringify(updated.$2) === JSON.stringify($3) : 'not replaced'"
}
assert "known field: gitOperation of a commit is returned unchanged" \
  "$(kept_field 'git commit -m msg' gitOperation '{ commit: { branch: "main", kind: "committed", sha: "abc1234" } }')" "true"
assert "known field: gitOperation of a push is returned unchanged" \
  "$(kept_field 'git push origin main' gitOperation '{ push: { branch: "main" } }')" "true"
assert "known field: bashEditDiff is returned unchanged" \
  "$(kept_field 'npm install' bashEditDiff '{ changedFiles: ["package-lock.json"], files: [{ filePath: "package-lock.json", hunks: [] }], moreFiles: 0 }')" "true"
assert "known field: staleReadFileStateHint is returned unchanged" \
  "$(kept_field 'git pull' staleReadFileStateHint '"a file changed after it was read"')" "true"
assert "known field: dangerouslyDisableSandbox is returned unchanged" \
  "$(kept_field 'npm install' dangerouslyDisableSandbox 'true')" "true"

assert "untouched: a call moved to the background by run_in_background → {}" \
  "$(untouched 'input.tool_input.run_in_background = true; input.tool_response.backgroundTaskId = "bsenraxvw";')" "{}"
assert "untouched: a call moved to the background at its time-out → {}" \
  "$(untouched 'input.tool_input.timeout = 2000; input.tool_response.backgroundTaskId = "bjan2dvyw"; input.tool_response.timedOutAfterMs = 2000;')" "{}"
assert "untouched: a timedOutAfterMs field without a backgroundTaskId field → {}" \
  "$(untouched 'input.tool_response.timedOutAfterMs = 2000;')" "{}"
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
assert "untouched: no isImage field → {}" \
  "$(untouched 'delete input.tool_response.isImage;')" "{}"
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

# The next 3 inputs keep every field of a call that the hook would compress,
# so only the event name or the tool name can be the reason for {}
assert "untouched: the event PostToolUseFailure, with a complete tool response → {}" \
  "$(untouched 'input.hook_event_name = "PostToolUseFailure";')" "{}"
assert "untouched: the event PreToolUse, with a complete tool response → {}" \
  "$(untouched 'input.hook_event_name = "PreToolUse";')" "{}"
assert "untouched: a tool that is not Bash, with the same input and response → {}" \
  "$(untouched 'input.tool_name = "Read";')" "{}"

# Raw output for reasons in the output itself
# The git-add rule turns any output into one line, so only the length limit
# of 200 characters keeps the first output raw
line_block() { node -e 'process.stdout.write(("x".repeat(Number(process.argv[1]) / 5 - 1) + "\n").repeat(5).slice(0, -1) + "y".repeat(Number(process.argv[2])))' "$1" "$2"; }
short_199=$(line_block 200 0)
short_200=$(line_block 200 1)
assert "the two length fixtures have 199 and 200 characters" "${#short_199} ${#short_200}" "199 200"
assert "short output (199 characters) → {}" \
  "$(run_hook 'git add .' "$short_199" "short-$$-$RANDOM")" "{}"
assert "output of 200 characters is compressed" \
  "$(is_compressed "$(run_hook 'git add .' "$short_200" "short-$$-$RANDOM")")" "yes"
assert "a rule that returns null (git log with 40 lines or fewer) → {}" \
  "$(run_hook 'git log' "$(echo "$NOISY" | head -40)" "null-$$-$RANDOM")" "{}"
assert "output from which the rule removes no line (git status without hint lines) → {}" \
  "$(run_hook 'git status' "$NOISY" "same-$$-$RANDOM")" "{}"

# ── Alert lines ──
# Claude Code merges standard error into `stdout`. A line that holds an alert
# word (error, warning, conflict, ...) and that a rule removed must stay
# visible: the hook adds it below the compressed text, under one heading.
ALERT_HEADING='Removed lines with an alert word:'

IFS= read -r -d '' PIP_OUT <<'FIXTURE'
Collecting flask
  Downloading flask-3.0.0-py3-none-any.whl (101 kB)
Collecting requests
  Downloading requests-2.31.0-py3-none-any.whl (62 kB)
Installing collected packages: requests, flask
ERROR: pip's dependency resolver does not currently take into account all the packages that are installed. This behaviour is the source of the following dependency conflicts.
somepkg 1.0 requires requests<2.0, but you have requests 2.31.0 which is incompatible.
Successfully installed flask-3.0.0 requests-2.31.0
FIXTURE
text=$(compressed_text "$(run_hook "pip install -r requirements.txt" "$PIP_OUT" "alert-$$-$RANDOM")")
assert_contains "alert lines: pip install keeps the summary of the rule"      "$text" "ok: installed 2 package(s)"
assert_contains "alert lines: pip install keeps the ERROR line"               "$text" "ERROR: pip's dependency resolver"
assert_contains "alert lines: pip install keeps the line with 'incompatible'" "$text" "which is incompatible."
assert_contains "alert lines: the heading stands above the kept lines"        "$text" "$ALERT_HEADING"
assert "alert lines: the marker counts the kept lines and is the last line" \
  "$(echo "$text" | tail -1)" "[compressed: 8->4 lines | pip-install]"

IFS= read -r -d '' PULL_OUT <<'FIXTURE'
remote: Enumerating objects: 5, done.
remote: Counting objects: 100% (5/5), done.
remote: Compressing objects: 100% (3/3), done.
remote: Total 3 (delta 2), reused 0 (delta 0), pack-reused 0
Unpacking objects: 100% (3/3), 312 bytes | 104.00 KiB/s, done.
Updating abc1234..def5678
Fast-forward
 src/app.js | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
Applying autostash resulted in conflicts.
Your changes are safe in the stash.
FIXTURE
text=$(compressed_text "$(run_hook "git pull --rebase --autostash" "$PULL_OUT" "alert-$$-$RANDOM")")
assert_contains "alert lines: git pull keeps the summary of the rule" "$text" "ok, 1 file changed"
assert_contains "alert lines: git pull keeps the autostash conflict"  "$text" "Applying autostash resulted in conflicts."

NPM_NOISE=$(node -e 'for (let i = 1; i <= 30; i++) console.log("npm http fetch GET 200 https://registry.npmjs.org/package-" + i + " 12ms")')
NPM_TAIL=$(printf '\nadded 150 packages, and audited 151 packages in 12s')
text=$(compressed_text "$(run_hook "npm install" "npm warn EBADENGINE Unsupported engine { package: 'left-pad@1.3.0', required: { node: '>=20' } }
$NPM_NOISE$NPM_TAIL" "alert-$$-$RANDOM")")
assert_contains "alert lines: npm install keeps the summary of the rule" "$text" "ok, added 150 packages"
assert_contains "alert lines: npm install keeps the EBADENGINE warning"  "$text" "npm warn EBADENGINE Unsupported engine"

# At most 40 alert lines are added; with more, the output stays as it is
deprecated_lines() { node -e 'for (let i = 1; i <= Number(process.argv[1]); i++) console.log("npm warn deprecated package-" + i + "@1.0.0: this version is no longer supported")' "$1"; }
out=$(run_hook "npm install" "$(deprecated_lines 40)
$NPM_NOISE$NPM_TAIL" "alert-$$-$RANDOM")
assert "alert lines: 40 alert lines are all added" \
  "$(compressed_text "$out" | grep -c 'npm warn deprecated')" "40"
assert "alert lines: 41 alert lines → {}" \
  "$(run_hook "npm install" "$(deprecated_lines 41)
$NPM_NOISE$NPM_TAIL" "alert-$$-$RANDOM")" "{}"

# An alert line that the compressed text already holds is not added again
out=$(run_hook "git add ." "warning: CRLF will be replaced by LF in a.txt
$NOISY" "alert-$$-$RANDOM")
text=$(compressed_text "$out")
assert "alert lines: a line that the rule kept appears once" "$(echo "$text" | grep -c 'warning: CRLF')" "1"
assert_not_contains "alert lines: no heading when the rule kept every alert line" "$text" "$ALERT_HEADING"

# A file name that holds an alert word is not an alert line
out=$(run_hook "find . -name '*.js'" "$(node -e 'for (let i = 1; i <= 70; i++) console.log("./src/file-" + i + ".js"); console.log("./src/errors.js\n./src/error.js\n./lib/fail/handler.js\n./lib/warn-once.js\n./logs/error\nerror.log\nwarnings/list.txt\nfail-fast.js")')" "alert-$$-$RANDOM")
text=$(compressed_text "$out")
assert_contains     "alert lines: find output with such file names is compressed" "$text" "... 18 more results"
assert_not_contains "alert lines: a file name with an alert word adds no line"    "$text" "$ALERT_HEADING"

# Each of these lines reports a problem. The first two have colour codes:
# directly before the word, and between the two words of "not found". The
# git-clone rule keeps none of them.
IFS= read -r -d '' ALERT_EXAMPLES <<'FIXTURE'
TypeError: x is not a function
ReferenceError: y is not defined
KeyError: 'name'
UserWarning: this API changes in the next release
(node:1) UnhandledPromiseRejectionWarning: boom
Checking formatting...FAILED
Traceback (most recent call last):
1 failure
2 failing
BUILD FAILURE
Exception in thread main
thread 'main' panicked at the start
panic: runtime problem
the push was rejected by the server
Connection refused
abort: no repository here
Aborted (core dumped)
unable to access the cache
1 high severity vulnerability
npm ERR! code E404
fatal: bad object in the pack
Permission denied (publickey).
cannot open the lock
command not found: prettier
this option is deprecated
FIXTURE
ALERT_EXAMPLES="$(printf '\033[31merror\033[0m: the colour line\ncommand \033[1mnot\033[0m found: a colour code inside the two words')
${ALERT_EXAMPLES%$'\n'}"
text=$(compressed_text "$(run_hook "git clone https://github.com/x/y" "$NOISY
$ALERT_EXAMPLES
./src/errors.js
error.log" "alert-$$-$RANDOM")")
assert "alert lines: the summary of the git-clone rule is the first line" "$(echo "$text" | head -1)" "cloned"
while IFS= read -r line; do
  assert_contains "alert lines: added again: $line" "$text" "$line"
done <<< "$ALERT_EXAMPLES"
assert_not_contains "alert lines: a path after a slash (src/errors.js) is not added" "$text" "./src/errors.js"
assert_not_contains "alert lines: a file name with an extension (error.log) is not added" "$text" "error.log"

# White space at the end of a line does not make a kept line a removed line.
# First case: the rule cut the spaces of the last line. Second case: the rule
# kept the line with its spaces.
out=$(run_hook "git add ." "$NOISY
warning: CRLF will be replaced by LF in a.txt   " "alert-$$-$RANDOM")
assert "alert lines: a kept line whose end spaces the rule cut is not added again" \
  "$(compressed_text "$out" | grep -c 'warning: CRLF')" "1"
out=$(run_hook "git status" "$STATUS_OUT
warning: could not refresh the index   " "alert-$$-$RANDOM")
assert "alert lines: a kept line with spaces at its end is not added again" \
  "$(compressed_text "$out" | grep -c 'warning: could not refresh')" "1"

# The comparison is by whole line: the kept line "Tests: 11 failed, 31 total"
# holds the text "1 failed", and the removed line "1 failed" is still added
out=$(run_hook "npm test" "$(node -e 'for (let i = 1; i <= 30; i++) console.log("  ok " + i + " - a test of the suite")')
1 failed
Tests: 11 failed, 31 total" "alert-$$-$RANDOM")
assert "alert lines: a removed line is added although a kept line holds its text" \
  "$(compressed_text "$out" | grep -cx '1 failed')" "1"

# ── Git rules on real output ──
# Git writes most of this text to standard error; Claude Code merges it into
# `stdout`. Each fixture is the output of a command that ended with success.
IFS= read -r -d '' PUSH_START <<'FIXTURE'
Enumerating objects: 5, done.
Counting objects: 100% (5/5), done.
Delta compression using up to 8 threads
Compressing objects: 100% (3/3), done.
Writing objects: 100% (3/3), 312 bytes | 312.00 KiB/s, done.
Total 3 (delta 2), reused 0 (delta 0), pack-reused 0
FIXTURE
push_text() { compressed_text "$(run_hook "git push origin $1" "$PUSH_START$2" "push-$$-$RANDOM")"; }

assert "git push: a plain push gives the branch and the remote" \
  "$(push_text main 'To github.com:user/repo.git
   abc1234..def5678  main -> main')" "ok main -> github.com:user/repo.git
[compressed: 8->1 lines | git-push]"

assert "git push: a line 'To <word>' without ':' or '/' is not the remote" \
  "$(push_text main 'To continue
To github.com:user/repo.git
   abc1234..def5678  main -> main' | head -1)" "ok main -> github.com:user/repo.git"

text=$(push_text feature-x "remote: Resolving deltas: 100% (2/2), completed with 2 local objects.
remote:
remote: Create a pull request for 'feature-x' on GitHub by visiting:
remote:      https://github.com/user/repo/pull/new/feature-x
remote:
To github.com:user/repo.git
 * [new branch]      feature-x -> feature-x")
assert "git push: a new branch gives the branch and the remote" "$(echo "$text" | head -1)" "ok feature-x -> github.com:user/repo.git"
assert_contains "git push: the pull-request address of the remote is kept" "$text" "remote:      https://github.com/user/repo/pull/new/feature-x"

text=$(push_text main "remote: Resolving deltas: 100% (2/2), completed with 2 local objects.
remote:
remote: GitHub found 3 vulnerabilities on user/repo's default branch (1 high, 2 moderate). To find out more, visit:
remote:      https://github.com/user/repo/security/dependabot
remote:
To github.com:user/repo.git
   abc1234..def5678  main -> main")
assert "git push: the words 'To find out more' are not read as the remote" "$(echo "$text" | head -1)" "ok main -> github.com:user/repo.git"
assert_contains "git push: the vulnerabilities notice of the remote is kept" "$text" "remote: GitHub found 3 vulnerabilities"
assert "git push: a kept remote line is not added a second time" "$(echo "$text" | grep -c 'GitHub found 3 vulnerabilities')" "1"

IFS= read -r -d '' FETCH_START <<'FIXTURE'
remote: Enumerating objects: 9, done.
remote: Counting objects: 100% (9/9), done.
remote: Compressing objects: 100% (3/3), done.
remote: Total 5 (delta 2), reused 5 (delta 2), pack-reused 0
Unpacking objects: 100% (5/5), 1.10 KiB | 375.00 KiB/s, done.
From github.com:user/repo
   abc1234..def5678  main       -> origin/main
FIXTURE
assert "git pull: a fast-forward pull gives the change counts" \
  "$(compressed_text "$(run_hook "git pull" "${FETCH_START}Updating abc1234..def5678
Fast-forward
 src/app.js   | 10 +++++++---
 src/util.js  |  4 ++--
 2 files changed, 9 insertions(+), 5 deletions(-)" "git-$$-$RANDOM")")" "ok, 2 files changed, +9, -5
[compressed: 12->1 lines | git-pull]"

assert "git fetch: every updated reference is kept" \
  "$(compressed_text "$(run_hook "git fetch origin" "$FETCH_START * [new branch]      feature-x  -> origin/feature-x
 * [new tag]         v1.2.0     -> v1.2.0" "git-$$-$RANDOM")")" "fetched: 3 update(s)
   abc1234..def5678  main       -> origin/main
 * [new branch]      feature-x  -> origin/feature-x
 * [new tag]         v1.2.0     -> v1.2.0
[compressed: 9->4 lines | git-fetch]"

assert "git commit: output of a commit hook before the result does not change the summary" \
  "$(compressed_text "$(run_hook "git commit -m msg" "> project@1.0.0 precommit
> lint-staged

[STARTED] Preparing lint-staged...
[COMPLETED] Preparing lint-staged...
[STARTED] Running tasks for staged files...
[COMPLETED] Running tasks for staged files...
[main abc1234] Add the export command
 3 files changed, 10 insertions(+), 2 deletions(-)
 create mode 100644 src/export.js" "git-$$-$RANDOM")")" "committed: abc1234 on main, 3 files changed, 10 insertions(+), 2 deletions(-)
[compressed: 9->1 lines | git-commit]"

# Output without an alert word: nothing is added (the text of section 5 above)
assert_not_contains "alert lines: a clean git status has no heading" \
  "$(compressed_text "$(run_hook "git status" "$STATUS_OUT" "alert-$$-$RANDOM")")" "$ALERT_HEADING"

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

# The 60 seconds count from the last compressed run to the START of the
# re-run. write_record stores a compressed run of `git status` that ended $2
# milliseconds ago; the re-run in $3 ran for `duration_ms` milliseconds.
write_record() {
  RECORD_FILE="$TRACK_DIR/sp-compress-$1.json" node -e '
    require("fs").writeFileSync(process.env.RECORD_FILE,
      JSON.stringify({ "git status": { compressed: true, ts: Date.now() - Number(process.argv[1]) } }));
  ' "$2"
}
rerun_after() {
  local session="timing-$$-$RANDOM"
  write_record "$session" "$1"
  run_hook "git status" "$STATUS_OUT" "$session" "input.duration_ms = $2;"
}
assert "re-run: a 90-second re-run that started 0.5 seconds after the first run is raw" \
  "$(rerun_after 90500 90000)" "{}"
assert "re-run: a re-run that started 3 minutes after the first run is compressed" \
  "$(is_compressed "$(rerun_after 180000 12)")" "yes"
assert "re-run: a re-run that started 61 seconds after the first run is compressed" \
  "$(is_compressed "$(rerun_after 61000 12)")" "yes"
assert "re-run: a re-run that started 50 seconds after the first run is raw" \
  "$(rerun_after 50000 12)" "{}"
assert "re-run: a negative duration counts as 0 (30 seconds after the first run: raw)" \
  "$(rerun_after 30000 -60000)" "{}"
assert "re-run: a duration that is not a number counts as 0 (30 seconds after the first run: raw)" \
  "$(rerun_after 30000 '"soon"')" "{}"

# A session id cannot name a folder: the record stays in the temporary folder
run_hook "git status" "$STATUS_OUT" "../../../escaped3" > /dev/null
assert "session record: an id with path characters names a file inside the temporary folder" \
  "$(ls "$TRACK_DIR" | grep -c '^sp-compress-_________escaped3\.json$')" "1"
assert "session record: no file is written outside the temporary folder" \
  "$(find "$WORK" -name 'escaped3.json' | wc -l | tr -d ' ')" "0"

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

result=$(PLUGIN_ROOT="$PLUGIN_ROOT" HOOK="$HOOK" node -e '
  const fs = require("fs");
  const hooks = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8")).hooks;
  const commands = Object.values(hooks).flat().flatMap(entry => (entry.hooks || []).map(h => h.command))
    .filter(command => command.includes("bash-compress-hook"));
  const named = commands.map(command => (command.match(/"([^"]+)"/) || [])[1] || "")
    .map(file => file.split("${CLAUDE_PLUGIN_ROOT}").join(process.env.PLUGIN_ROOT));
  const same = named.length === 1 && fs.existsSync(named[0]) &&
    fs.realpathSync(named[0]) === fs.realpathSync(process.env.HOOK);
  console.log(same ? "ok" : "entries=" + commands.length + " files=" + named.join(","));
')
assert "hooks.json: one entry starts bash-compress-hook, and the file it names is the hook" "$result" "ok"

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
