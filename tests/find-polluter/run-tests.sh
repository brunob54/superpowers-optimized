#!/usr/bin/env bash
# find-polluter test suite: skills/systematic-debugging/find-polluter.sh on a
# fixture folder. A stand-in `npm` that is first on PATH records each call and
# can create the pollution file; no real test runner runs. Pure bash; no
# claude invocation. The script runs under the bash that runs this suite, so
# `/bin/bash tests/find-polluter/run-tests.sh` tests it under bash 3.2 on macOS.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).
#
# The defect that these cases close: `find` prints every path with a leading
# "./", so the documented pattern 'src/**/*.test.ts' matched no file. The
# script then counted the empty list as 1 file, ran no test and reported
# "No polluter found - all tests clean!" with exit code 0.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/skills/systematic-debugging/find-polluter.sh"
TRACING_DOC="$ROOT/skills/systematic-debugging/root-cause-tracing.md"
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
# The script output is held in $OUT; assert_line matches a whole line with
# grep -x, so "Found 3 test files" never matches "Found 31 test files".
out_dump() { printf '%s' "$OUT" | tr '\n' '|'; }
assert_line() { # desc exact-line
  if printf '%s\n' "$OUT" | grep -qxF -- "$2"; then ok "$1"; else bad "$1 (no line '$2' in: $(out_dump))"; fi
}
assert_has() { # desc needle
  if printf '%s\n' "$OUT" | grep -qF -- "$2"; then ok "$1"; else bad "$1 (missing '$2' in: $(out_dump))"; fi
}
assert_lacks() { # desc needle
  if printf '%s\n' "$OUT" | grep -qF -- "$2"; then bad "$1 (must not contain '$2': $(out_dump))"; else ok "$1"; fi
}
assert_file_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}
assert_file_lacks() { # desc file needle
  if grep -qF -- "$3" "$2"; then bad "$1 (must not contain: $3)"; else ok "$1"; fi
}

# The example that the script header and root-cause-tracing.md show. Its
# pollution path must not exist at a repository root, because the script
# stops when the pollution path exists before a test runs. '.git' always
# exists there, so the old example '.git' must be gone.
DOC_PATTERN='src/**/*.test.ts'
DOC_EXAMPLE="'src/.git' '$DOC_PATTERN'"
OLD_EXAMPLE="'.git' '$DOC_PATTERN'"
POLLUTION='polluted'
CLEAN_MESSAGE='No polluter found - all tests clean!'
FOUND_MESSAGE='FOUND POLLUTER!'
NO_MATCH_MESSAGE='No test file matches the pattern'
EXISTS_MESSAGE='Pollution already exists before test 1/'
# The test files of the main fixture, as `find` prints them.
FILE_TOP='./src/a.test.ts'
FILE_SUB='./src/sub/b.test.ts'
# Its name ends in "a.test.ts" but it is not directly in src/.
FILE_DATA='./src/sub/data.test.ts'
FILE_DEEP='./src/sub/deep/c.test.ts'
# 'src/**/*.test.ts' must not match this file: "src" is not the first folder.
FILE_INNER_SRC='./lib/src/sub/n.test.ts'
FOUND_ALL='Found 4 test files'

# pwd -P resolves macOS's /var -> /private/var symbolic link.
TMP=$(mktemp -d)
: "${TMP:?mktemp failed — refusing to run with an empty fixture path}"
TMP=$(cd "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT

BIN="$TMP/bin"
FIXTURE="$TMP/project"
export NPM_LOG="$TMP/npm-calls.log"
export POLLUTION

# The stand-in npm. The script calls it as `npm test <file>`. It records
# "<file>" on one line of $NPM_LOG and creates the pollution file when <file>
# is the file named in $POLLUTE_ON. It runs no real test. A real test runner
# can read its standard input, so the stand-in reads all of it: a file list
# that the script gives to npm on standard input is then lost.
mkdir -p "$BIN"
cat > "$BIN/npm" <<'EOF'
#!/bin/sh
cat > /dev/null
printf '%s\n' "$2" >> "$NPM_LOG"
if [ -n "${POLLUTE_ON:-}" ] && [ "$2" = "$POLLUTE_ON" ]; then
  touch "$POLLUTION"
fi
exit 0
EOF
chmod +x "$BIN/npm"

# make_fixture <folder> <file>...: creates each file, and its folders, in <folder>.
make_fixture() {
  local dir="$1" f
  shift
  for f in "$@"; do
    mkdir -p "$(dirname "$dir/$f")"
    touch "$dir/$f"
  done
}

# Main fixture: four test files at three depths under src/, one source file
# that is not a test, and two test files outside src/.
make_fixture "$FIXTURE" "$FILE_TOP" "$FILE_SUB" "$FILE_DATA" "$FILE_DEEP" \
  ./src/helper.ts ./lib/x.test.ts "$FILE_INNER_SRC"

# run_polluter_in <folder> <pattern> [<test file that creates the pollution>]
# Runs the script in <folder> with the stand-in npm first on PATH and with
# standard input from /dev/null. Sets OUT (standard output and standard
# error), CODE (the exit code) and CALLS (the test files that the stand-in
# npm received, one per line). Then removes the pollution file, so that the
# next run starts without it.
run_polluter_in() {
  : > "$NPM_LOG"
  OUT=$(cd "$1" && POLLUTE_ON="${3:-}" PATH="$BIN:$PATH" "$BASH" "$SCRIPT" "$POLLUTION" "$2" 2>&1 < /dev/null)
  CODE=$?
  CALLS=$(cat "$NPM_LOG")
  rm -f "$1/$POLLUTION"
}
# run_polluter <pattern> [<test file that creates the pollution>]: the same
# in the main fixture.
run_polluter() { run_polluter_in "$FIXTURE" "$@"; }

ALL_FILES="$FILE_TOP
$FILE_SUB
$FILE_DATA
$FILE_DEEP"

bold "1. The documented pattern finds every test file at every depth"
run_polluter "$DOC_PATTERN"
assert_line "the count is 4" "$FOUND_ALL"
assert_eq "npm runs each test file once, in sorted order" "$CALLS" "$ALL_FILES"
assert_line "no polluter is reported" "✅ $CLEAN_MESSAGE"
assert_eq "exit status is 0" "$CODE" "0"

bold "2. The same pattern with a leading ./ finds the same files"
run_polluter "./$DOC_PATTERN"
assert_line "the count is 4" "$FOUND_ALL"
assert_eq "npm runs each test file once" "$CALLS" "$ALL_FILES"

bold "3. **/ matches zero folder levels: a file directly in src/"
run_polluter 'src/**/a.test.ts'
assert_eq "only the file directly in src/ runs" "$CALLS" "$FILE_TOP"

bold "4. **/ matches several folder levels"
run_polluter 'src/**/c.test.ts'
assert_eq "only the file two levels down runs" "$CALLS" "$FILE_DEEP"

bold "5. The script stops at the first test that creates the pollution"
run_polluter "$DOC_PATTERN" "$FILE_SUB"
assert_line "the polluter is reported" "🎯 $FOUND_MESSAGE"
assert_line "the polluter is named" "   Test: $FILE_SUB"
assert_eq "the tests after the polluter do not run" "$CALLS" "$FILE_TOP
$FILE_SUB"
assert_eq "exit status is 1" "$CODE" "1"

bold "6. A pattern that matches no file stops with an error"
run_polluter 'tests/**/*.spec.ts'
assert_has "the message names the problem" "$NO_MATCH_MESSAGE"
assert_lacks "no clean result is reported" "$CLEAN_MESSAGE"
assert_lacks "an empty list is not counted as one file" "Found 1 test files"
assert_eq "npm never runs" "$CALLS" ""
assert_eq "exit status is 1" "$CODE" "1"

bold "7. The usage text shows the example that case 1 runs, in both copies"
for doc in "$SCRIPT" "$TRACING_DOC"; do
  assert_file_contains "$(basename "$doc") shows the example" "$doc" "$DOC_EXAMPLE"
  assert_file_lacks "$(basename "$doc") no longer shows the '.git' example" "$doc" "$OLD_EXAMPLE"
done

bold "8. A leading * still matches the . of ./, as in the version before ./ was added"
STAR="$TMP/star"
make_fixture "$STAR" ./tests/test_a.py ./pkg/tests/test_b.py
run_polluter_in "$STAR" '*/tests/*.py'
assert_eq "both files run" "$CALLS" "./pkg/tests/test_b.py
./tests/test_a.py"

bold "9. Each **/ matches zero or more folder levels, independently of the other"
NESTED="$TMP/nested"
NESTED_FILES='./src/__tests__/a.test.ts
./src/__tests__/deep/b.test.ts
./src/zone/__tests__/c.test.ts
./src/zone/__tests__/deep/d.test.ts'
# Word splitting on the newlines gives one argument per file; no name has a space.
make_fixture "$NESTED" $NESTED_FILES
run_polluter_in "$NESTED" 'src/**/__tests__/**/*.test.ts'
assert_eq "all four keep/remove choices of the two **/ run" "$CALLS" "$NESTED_FILES"

bold "10. A pollution path that exists before the first test stops the run"
touch "$FIXTURE/$POLLUTION"
run_polluter "$DOC_PATTERN"
assert_has "the message names the problem" "$EXISTS_MESSAGE"
assert_lacks "no clean result is reported" "$CLEAN_MESSAGE"
assert_eq "npm never runs" "$CALLS" ""
assert_eq "exit status is 1" "$CODE" "1"

bold "11. A test file name with a space stays one name"
SPACES="$TMP/spaces"
SPACE_FILE='./src/one two.test.ts'
make_fixture "$SPACES" "$SPACE_FILE" ./src/three.test.ts
run_polluter_in "$SPACES" "$DOC_PATTERN"
assert_line "the count is 2" "Found 2 test files"
assert_eq "npm runs each whole name once" "$CALLS" "$SPACE_FILE
./src/three.test.ts"
assert_lacks "the counter never goes past the total" "[3/2]"

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
