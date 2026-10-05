#!/usr/bin/env bash
# skill-test-runner test suite: the exit code and the status line of
# tests/claude-code/run-skill-tests.sh (the runner of the slow behavioural
# suites). Pure bash; no claude invocation: a stand-in `claude` script is
# placed first on PATH, and the runner only asks it for its version.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).
#
# The defect (finding 1 of the 2026-10-05 review): `--test <name>` with a
# name that is not a file inside tests/claude-code/ printed "[SKIP] Test file
# not found", and the run still ended with "STATUS: PASSED" and exit code 0.
# A path (`--test tests/claude-code/test-multi-code-review.sh`) and a
# misspelled name both looked like a passed run.

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
mkdir -p "$COPY_FOLDER" "$WORK/tests/lib"
cp "$RUNNER" "$COPY_FOLDER/$RUNNER_NAME"
cp "$ROOT/tests/lib/$SHIM_NAME" "$WORK/tests/lib/$SHIM_NAME"
FIXTURE_TEST='test-fixture-passes.sh'
printf '#!/usr/bin/env bash\nexit 0\n' > "$COPY_FOLDER/$FIXTURE_TEST"
run_runner "$COPY_FOLDER/$RUNNER_NAME" --test "$FIXTURE_TEST"
assert_eq "a fixture test that passes: the exit code is 0" "$CODE" "0"
assert_out_has "a fixture test that passes: the status line says the run passed" "$STATUS_PASSED"

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
