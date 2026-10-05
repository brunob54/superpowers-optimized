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

# The pattern form that the script header and root-cause-tracing.md show.
DOC_PATTERN='src/**/*.test.ts'
POLLUTION='polluted'
CLEAN_MESSAGE='No polluter found - all tests clean!'
FOUND_MESSAGE='FOUND POLLUTER!'
NO_MATCH_MESSAGE='No test file matches the pattern'
# The test files of the fixture, as `find` prints them.
FILE_TOP='./src/a.test.ts'
FILE_SUB='./src/sub/b.test.ts'
FILE_DEEP='./src/sub/deep/c.test.ts'

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
# is the file named in $POLLUTE_ON. It runs no real test.
mkdir -p "$BIN"
cat > "$BIN/npm" <<'EOF'
#!/bin/sh
printf '%s\n' "$2" >> "$NPM_LOG"
if [ -n "${POLLUTE_ON:-}" ] && [ "$2" = "$POLLUTE_ON" ]; then
  touch "$POLLUTION"
fi
exit 0
EOF
chmod +x "$BIN/npm"

# Fixture: three test files at three depths under src/, one source file that
# is not a test, and one test file outside src/.
mkdir -p "$FIXTURE/src/sub/deep" "$FIXTURE/lib"
for f in "$FILE_TOP" "$FILE_SUB" "$FILE_DEEP" ./src/helper.ts ./lib/x.test.ts; do
  touch "$FIXTURE/$f"
done

# run_polluter <pattern> [<test file that creates the pollution>]
# Runs the script in the fixture folder with the stand-in npm first on PATH.
# Sets OUT (standard output and standard error), CODE (the exit code) and
# CALLS (the test files that the stand-in npm received, one per line).
run_polluter() {
  rm -f "$FIXTURE/$POLLUTION"
  : > "$NPM_LOG"
  OUT=$(cd "$FIXTURE" && POLLUTE_ON="${2:-}" PATH="$BIN:$PATH" "$BASH" "$SCRIPT" "$POLLUTION" "$1" 2>&1)
  CODE=$?
  CALLS=$(cat "$NPM_LOG")
}

ALL_FILES="$FILE_TOP
$FILE_SUB
$FILE_DEEP"

bold "1. The documented pattern finds every test file at every depth"
run_polluter "$DOC_PATTERN"
assert_line "the count is 3" "Found 3 test files"
assert_eq "npm runs each test file once, in sorted order" "$CALLS" "$ALL_FILES"
assert_line "no polluter is reported" "✅ $CLEAN_MESSAGE"
assert_eq "exit status is 0" "$CODE" "0"

bold "2. The same pattern with a leading ./ finds the same files"
run_polluter "./$DOC_PATTERN"
assert_line "the count is 3" "Found 3 test files"
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

bold "7. The usage text shows the pattern form that case 1 runs"
assert_file_contains "the script header shows it" "$SCRIPT" "'$DOC_PATTERN'"
assert_file_contains "root-cause-tracing.md shows it" "$TRACING_DOC" "'$DOC_PATTERN'"

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
