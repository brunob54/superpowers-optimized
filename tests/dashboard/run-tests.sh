#!/usr/bin/env bash
# dashboard test suite: skills/pickup/scripts/git-runs.js and the dashboard
# skill (skills/dashboard: the scripts, the page template and SKILL.md). Each
# unit has one Node test file, tests/dashboard/test-*.js, which builds its own
# fixture git repositories. Pure bash, git and node; no claude invocation.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILED_FILES=()

for test_file in "$DIR"/test-*.js; do
  printf '\033[1m%s\033[0m\n' "$(basename "$test_file")"
  node "$test_file"
  status=$?
  if [ "$status" -ne 0 ]; then FAILED_FILES+=("$(basename "$test_file")"); fi
done

printf '\n'
if [ "${#FAILED_FILES[@]}" -eq 0 ]; then
  printf '\033[0;32m%s\033[0m\n' "dashboard suite: every test file passed"
  exit 0
fi
printf '\033[0;31m%s\033[0m\n' "dashboard suite: failed files: ${FAILED_FILES[*]}"
exit 1
