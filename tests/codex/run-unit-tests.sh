#!/usr/bin/env bash
# Unit test runner for superpowers-orchestrator Codex hooks
#
# Run from the repo root:
#   bash tests/codex/run-unit-tests.sh
#
# Or from within the tests/codex/ directory:
#   bash run-unit-tests.sh
#
# Requirements: node (any version >= 16), git

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "=================================================="
echo " superpowers-orchestrator — Codex Hook Unit Tests"
echo "=================================================="
echo " Repo root: ${REPO_ROOT}"
echo " Node:      $(node --version 2>/dev/null || echo 'NOT FOUND')"
echo ""

PASS=0
FAIL=0
ERRORS=()

run_test() {
  local label="$1"
  local file="$2"
  # Interpreter that runs the test file: node (default) or bash.
  local runner="${3:-node}"
  echo "── ${label}"
  if "${runner}" "${file}"; then
    PASS=$(( PASS + 1 ))
  else
    FAIL=$(( FAIL + 1 ))
    ERRORS+=("${label}")
  fi
  echo ""
}

run_test "pretool-bash-adapter" "${SCRIPT_DIR}/test-pretool-bash-adapter.js"
run_test "posttool-bash-compress-adapter" "${SCRIPT_DIR}/test-posttool-bash-compress-adapter.js"
run_test "stop-adapter"         "${SCRIPT_DIR}/test-stop-adapter.js"
run_test "stop-reminders (Claude Stop shape)" "${SCRIPT_DIR}/test-stop-reminders.js"
run_test "name-list (the parser of the name-list switches)" "${SCRIPT_DIR}/test-name-list.js"
run_test "session-start-adapter" "${SCRIPT_DIR}/test-session-start-adapter.js"
run_test "session-start (superpowers-defaults block)" "${SCRIPT_DIR}/test-session-start-defaults-block.sh" bash
run_test "session-start (10,000-character budget)" "${SCRIPT_DIR}/test-session-start-budget.sh" bash
run_test "session-start (context-snapshot block only for the present HEAD)" "${SCRIPT_DIR}/test-session-start-snapshot.sh" bash
run_test "session-start (active work log notice)" "${SCRIPT_DIR}/test-session-start-worklog-notice.sh" bash
run_test "session-start (update check only in a clone of the plugin)" "${SCRIPT_DIR}/test-session-start-update-check.sh" bash
run_test "session-start (memory files of the folder in CLAUDE_PROJECT_DIR)" "${SCRIPT_DIR}/test-session-start-project-dir.sh" bash
run_test "session-start (stale note for the hash of project-map.md)" "${SCRIPT_DIR}/test-session-start-map-hash.sh" bash
run_test "check-no-superpowers-defaults-setting" "${SCRIPT_DIR}/test-check-no-superpowers-defaults-setting.sh" bash
run_test "check-no-secrets-rules-managed-setting" "${SCRIPT_DIR}/test-check-no-secrets-rules-setting.sh" bash
run_test "claude-code work folder" "${SCRIPT_DIR}/test-claude-code-workdir.sh" bash
run_test "skill-activator (UserPromptSubmit)" "${SCRIPT_DIR}/test-skill-activator.js"
run_test "block-dangerous-commands (PreToolUse Bash)" "${SCRIPT_DIR}/test-block-dangerous-commands.js"
run_test "protect-secrets (PreToolUse Read, Edit, Write, Grep, Bash)" "${SCRIPT_DIR}/test-protect-secrets.js"
run_test "track-edits and context-engine (git ignore entries)" "${SCRIPT_DIR}/test-git-exclude-hooks.js"
run_test "context-engine (file names in the snapshot)" "${SCRIPT_DIR}/test-context-engine.js"
run_test "save marker (track-edits, stop-reminders, context-management save command)" "${SCRIPT_DIR}/test-track-edits.js"
run_test "version files (every place states one version)" "${SCRIPT_DIR}/test-version-files.js"
run_test "script line ends (every #! file checks out with LF)" "${SCRIPT_DIR}/test-script-line-ends.js"
run_test "using-superpowers (fresh project gate checks for a git repository)" "${SCRIPT_DIR}/test-fresh-project-gate.sh" bash

echo "=================================================="
echo " Results: ${PASS} suites passed, ${FAIL} suites failed"
if [ "${FAIL}" -gt 0 ]; then
  echo " Failed suites:"
  for e in "${ERRORS[@]}"; do
    echo "   - ${e}"
  done
  echo "=================================================="
  exit 1
else
  echo " All unit tests passed."
  echo "=================================================="
fi
