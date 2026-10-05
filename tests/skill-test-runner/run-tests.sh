#!/usr/bin/env bash
# skill-test-runner test suite: the exit code and the status line of
# tests/claude-code/run-skill-tests.sh (the runner of the slow behavioural
# suites). Pure bash; no claude invocation: a stand-in `claude` script is
# placed first on PATH, and the runner only asks it for its version.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).
#
# The defect (finding 1 of the 2026-10-03 review): `--test <name>` with a
# name that is not a file inside tests/claude-code/ printed "[SKIP] Test file
# not found", and the run still ended with "STATUS: PASSED" and exit code 0.
# A path (`--test tests/claude-code/test-multi-code-review.sh`) and a
# misspelled name both looked like a passed run.
# Two more defects of the same kind: with two `--test` options, the runner
# ran only the second test; with an empty name (`--test ""`), it ran the
# default list. Both runs ended with "STATUS: PASSED".

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER_NAME='run-skill-tests.sh'
RUNNER_FOLDER='tests/claude-code'
RUNNER="$ROOT/$RUNNER_FOLDER/$RUNNER_NAME"
SHIM_NAME='timeout-shim.sh'
# The text that the runner prints on the status line of its summary.
STATUS_PASSED='STATUS: PASSED'
STATUS_FAILED='STATUS: FAILED'
# The runner must name the expected form of a test name when a test file is
# not found.
EXPECTED_FORM="a file name inside $RUNNER_FOLDER/"
# The exit code of a run that has a failed test.
FAILED_RUN_CODE=1
# The runner prints this text before the name of each test that it runs.
RUNNING_TEXT='Running:'
PASS=0
FAIL=0
ERRORS=()

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

ok()  { green "  PASS: $1"; PASS=$((PASS+1)); }
bad() { red "  FAIL: $1"; ERRORS+=("$1"); FAIL=$((FAIL+1)); }

assert_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi
}
# assert_out_has <desc> <text>: the output of the last run holds <text>.
# On a failure, the message shows only the lines of the output that name a
# file that is not found, and the status line.
assert_out_has() {
  case "$OUT" in
    *"$2"*) ok "$1" ;;
    *) bad "$1 (no '$2' in the output: $(printf '%s\n' "$OUT" | grep -E 'not found|STATUS:' | tr '\n' '|'))" ;;
  esac
}
# assert_out_lacks <desc> <text>: the output of the last run does not hold
# <text>. On a failure, the message shows the lines that hold <text>.
assert_out_lacks() {
  case "$OUT" in
    *"$2"*) bad "$1 ('$2' is in the output: $(printf '%s\n' "$OUT" | grep -F -- "$2" | tr '\n' '|'))" ;;
    *) ok "$1" ;;
  esac
}

WORK="$(mktemp -d)"
: "${WORK:?mktemp failed — refusing to run with an empty fixture path}"
trap 'rm -rf "$WORK"' EXIT

# The stand-in `claude`: the runner calls `claude --version` and checks that
# the command exists. Nothing else of the real CLI is needed here.
STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
printf '#!/usr/bin/env bash\necho "stand-in claude for the skill-test-runner suite"\n' > "$STUB_DIR/claude"
chmod +x "$STUB_DIR/claude"

# run_runner <runner> <argument>...: run a runner with the stand-in `claude`
# first on PATH. The standard output goes to OUT and the exit code to CODE.
# The standard error is not captured, so the guard of this suite still sees a
# "command not found" line of the runner.
run_runner() {
  local runner="$1"
  shift
  CODE=0
  OUT="$(PATH="$STUB_DIR:$PATH" bash "$runner" "$@")" || CODE=$?
}

# check_not_found <desc> <test name>: a run with a test name that is not a
# file inside tests/claude-code/ fails, and its message names the expected
# form of the name.
check_not_found() {
  run_runner "$RUNNER" --test "$2"
  assert_eq "$1: the exit code is $FAILED_RUN_CODE" "$CODE" "$FAILED_RUN_CODE"
  assert_out_has "$1: the status line says the run failed" "$STATUS_FAILED"
  assert_out_has "$1: the message names the expected form" "$EXPECTED_FORM"
}

bold "A test file that is not found fails the run"
check_not_found "a path instead of a file name" "$RUNNER_FOLDER/test-multi-code-review.sh"
check_not_found "a misspelled file name" "test-multi-code-reviw.sh"

bold "A test file that is found and passes still passes the run"
# A copy of the runner in a temporary tree, next to a fixture test that ends
# with exit code 0. The runner finds its tests in its own folder, so the
# fixture test is never written into tests/claude-code/.
COPY_FOLDER="$WORK/$RUNNER_FOLDER"
COPY_RUNNER="$COPY_FOLDER/$RUNNER_NAME"
mkdir -p "$COPY_FOLDER" "$WORK/tests/lib"
cp "$RUNNER" "$COPY_RUNNER"
cp "$ROOT/tests/lib/$SHIM_NAME" "$WORK/tests/lib/$SHIM_NAME"

# write_fixture <test name> <exit code>: write a fixture test into the copy
# tree. The fixture test only ends with <exit code>.
write_fixture() {
  printf '#!/usr/bin/env bash\nexit %s\n' "$2" > "$COPY_FOLDER/$1"
}

FIXTURE_TEST='test-fixture-passes.sh'
write_fixture "$FIXTURE_TEST" 0
run_runner "$COPY_RUNNER" --test "$FIXTURE_TEST"
assert_eq "a fixture test that passes: the exit code is 0" "$CODE" "0"
assert_out_has "a fixture test that passes: the status line says the run passed" "$STATUS_PASSED"

# The runner accepts one test name only. These texts are in the message of
# the runner when it stops on a second --test or on an empty name.
REPEATED_OPTION_TEXT='option --test appears more than once'
EMPTY_NAME_TEXT='option --test has an empty test name'
FAILING_FIXTURE_TEST='test-fixture-fails.sh'
write_fixture "$FAILING_FIXTURE_TEST" "$FAILED_RUN_CODE"
# The runner runs this test when no test name is given (its default list).
DEFAULT_TEST='test-subagent-driven-development.sh'
write_fixture "$DEFAULT_TEST" 0

# check_rejected <desc> <message text> <argument>...: the copy of the runner
# stops before it runs any test. The exit code is not 0, the output holds
# <message text>, and the run does not end with "STATUS: PASSED".
check_rejected() {
  local desc="$1" text="$2"
  shift 2
  run_runner "$COPY_RUNNER" "$@"
  local code_desc="$desc: the exit code is not 0"
  if [ "$CODE" -ne 0 ]; then ok "$code_desc"; else bad "$code_desc (got 0)"; fi
  assert_out_has "$desc: the message names the problem" "$text"
  assert_out_lacks "$desc: no test runs" "$RUNNING_TEXT"
  assert_out_lacks "$desc: the status line does not say the run passed" "$STATUS_PASSED"
}

bold "Two --test options stop the run before any test runs"
# The first named test fails and the second one passes. A runner that keeps
# only the second name skips the failing test and ends with "STATUS: PASSED".
check_rejected "two --test options" "$REPEATED_OPTION_TEXT" \
  --test "$FAILING_FIXTURE_TEST" --test "$FIXTURE_TEST"

bold "An empty test name stops the run before any test runs"
# The copy tree holds a passing test with the name of the default list. A
# runner that reads an empty name as "no name" runs that test and passes.
check_rejected "an empty test name" "$EMPTY_NAME_TEXT" --test ""

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
