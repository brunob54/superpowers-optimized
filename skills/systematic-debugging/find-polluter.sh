#!/usr/bin/env bash
# Bisection script to find which test creates unwanted files/state
# Usage: ./find-polluter.sh <file_or_dir_to_check> <test_pattern>
# Example: ./find-polluter.sh 'src/.git' 'src/**/*.test.ts'
# The file or folder to check must not exist when the script starts; the
# script stops if it does. Do not use '.git' alone: at the root of a git
# repository it always exists.

set -e

if [ $# -ne 2 ]; then
  echo "Usage: $0 <file_to_check> <test_pattern>"
  echo "Example: $0 'src/.git' 'src/**/*.test.ts'"
  exit 1
fi

POLLUTION_CHECK="$1"
TEST_PATTERN="$2"

echo "🔍 Searching for test that creates: $POLLUTION_CHECK"
echo "Test pattern: $TEST_PATTERN"
echo ""

# Get list of test files.
# `find .` prints every path with "./" in front, so the pattern is used with
# "./" in front too. A "./" that the caller already wrote is removed first.
# The pattern is also used as the caller wrote it: then a leading "*" matches
# the "." of "./", so '*/tests/*.py' matches ./tests/a.py.
PATH_PREFIX="./"
# In a `find -path` pattern, "*" also matches "/". So "**/" matches one or
# more folder levels, never zero: 'src/**/*.test.ts' alone misses
# src/a.test.ts. add_path_tests adds one `-path` test for each choice of
# keeping or removing each "**/" (2^k tests for k "**/"). So each "**/" can
# match zero folder levels while another "**/" matches one or more.
ANY_FOLDERS="**/"
FIND_TESTS=()
# add_path_tests <part already built> <rest of the pattern>
add_path_tests() {
  case "$2" in
    *"$ANY_FOLDERS"*)
      local before="${2%%"$ANY_FOLDERS"*}" after="${2#*"$ANY_FOLDERS"}"
      add_path_tests "$1$before$ANY_FOLDERS" "$after"
      add_path_tests "$1$before" "$after"
      ;;
    *) FIND_TESTS+=(-o -path "$1$2") ;;
  esac
}
add_path_tests "" "$TEST_PATTERN"
add_path_tests "$PATH_PREFIX" "${TEST_PATTERN#"$PATH_PREFIX"}"
# "${FIND_TESTS[@]:1}" leaves out the first "-o".
TEST_FILES=$(find . \( "${FIND_TESTS[@]:1}" \) | sort)

# An empty list must not be reported as "all tests clean".
if [ -z "$TEST_FILES" ]; then
  echo "No test file matches the pattern: $TEST_PATTERN"
  echo "The pattern is relative to the current folder: $(pwd)"
  exit 1
fi
TOTAL=$(echo "$TEST_FILES" | wc -l | tr -d ' ')

echo "Found $TOTAL test files"
echo ""

COUNT=0
# Read the list one line at a time, so that a file name with a space stays
# one name. The list comes on file descriptor 3, not on standard input, so a
# test runner that reads its standard input cannot take the rest of the list.
while IFS= read -r TEST_FILE <&3; do
  COUNT=$((COUNT + 1))

  # A test that runs while the pollution exists cannot show whether it
  # creates it. Stop instead of skipping the test: a run with skipped tests
  # must never end with "all tests clean".
  if [ -e "$POLLUTION_CHECK" ]; then
    echo "⚠️  Pollution already exists before test $COUNT/$TOTAL: $POLLUTION_CHECK"
    echo "   Remove it, or name a path that no test should create, and run again."
    exit 1
  fi

  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE"

  # Run the test
  npm test "$TEST_FILE" > /dev/null 2>&1 || true

  # Check if pollution appeared
  if [ -e "$POLLUTION_CHECK" ]; then
    echo ""
    echo "🎯 FOUND POLLUTER!"
    echo "   Test: $TEST_FILE"
    echo "   Created: $POLLUTION_CHECK"
    echo ""
    echo "Pollution details:"
    ls -la "$POLLUTION_CHECK"
    echo ""
    echo "To investigate:"
    echo "  npm test $TEST_FILE    # Run just this test"
    echo "  cat $TEST_FILE         # Review test code"
    exit 1
  fi
done 3<<< "$TEST_FILES"

echo ""
echo "✅ No polluter found - all tests clean!"
exit 0
