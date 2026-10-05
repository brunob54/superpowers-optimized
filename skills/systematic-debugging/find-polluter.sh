#!/usr/bin/env bash
# Bisection script to find which test creates unwanted files/state
# Usage: ./find-polluter.sh <file_or_dir_to_check> <test_pattern>
# Example: ./find-polluter.sh '.git' 'src/**/*.test.ts'

set -e

if [ $# -ne 2 ]; then
  echo "Usage: $0 <file_to_check> <test_pattern>"
  echo "Example: $0 '.git' 'src/**/*.test.ts'"
  exit 1
fi

POLLUTION_CHECK="$1"
TEST_PATTERN="$2"

echo "🔍 Searching for test that creates: $POLLUTION_CHECK"
echo "Test pattern: $TEST_PATTERN"
echo ""

# Get list of test files.
# `find .` prints every path with "./" in front, so the pattern gets "./" in
# front too. A "./" that the caller already wrote is removed first.
PATH_PREFIX="./"
FIND_PATTERN="$PATH_PREFIX${TEST_PATTERN#"$PATH_PREFIX"}"
# In a `find -path` pattern, "*" also matches "/". So "**/" matches one or
# more folder levels, never zero: 'src/**/*.test.ts' alone misses
# src/a.test.ts. The second pattern, with every "**/" removed, matches the
# files that have no folder level in that place.
ANY_FOLDERS="**/"
NO_FOLDER_PATTERN="${FIND_PATTERN//"$ANY_FOLDERS"/}"
TEST_FILES=$(find . \( -path "$FIND_PATTERN" -o -path "$NO_FOLDER_PATTERN" \) | sort)

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
for TEST_FILE in $TEST_FILES; do
  COUNT=$((COUNT + 1))

  # Skip if pollution already exists
  if [ -e "$POLLUTION_CHECK" ]; then
    echo "⚠️  Pollution already exists before test $COUNT/$TOTAL"
    echo "   Skipping: $TEST_FILE"
    continue
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
done

echo ""
echo "✅ No polluter found - all tests clean!"
exit 0
