#!/usr/bin/env bash
# Unit test: check_no_secrets_rules_managed_setting (tests/claude-code/test-helpers.sh)
#
# The behavioural test test-subagent-hook-scope.sh expects the protect-secrets rule echo-secret-var to refuse a
# command. If that rule is switched off, the test would print the false conclusion "Subagents bypass safety
# hooks". The test clears the switch SUPERPOWERS_SECRETS_RULES_OFF with `--settings`, which ranks above user,
# project and local settings. Only managed settings rank above it, so the function stops the test when a managed
# settings file sets the variable. The two real managed paths are absolute and cannot be redirected, so each case
# below passes its own fixture paths as arguments; the function uses the two real paths only without arguments.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../claude-code/test-helpers.sh
source "${REPO_ROOT}/tests/claude-code/test-helpers.sh"

PASS=0
FAIL=0
ok()  { PASS=$(( PASS + 1 )); echo "  ok   - $1"; }
bad() { FAIL=$(( FAIL + 1 )); echo "  FAIL - $1"; }

VARIABLE=SUPERPOWERS_SECRETS_RULES_OFF
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# run_function <file...>: sets FUNCTION_STATUS and FUNCTION_OUTPUT.
run_function() {
  FUNCTION_OUTPUT="$(check_no_secrets_rules_managed_setting "$@" 2>&1)" && FUNCTION_STATUS=0 || FUNCTION_STATUS=$?
}

# expect_status <label> <wanted status> <file...>
expect_status() {
  local label="$1" wanted="$2"
  shift 2
  run_function "$@"
  if [ "$FUNCTION_STATUS" -eq "$wanted" ]; then ok "$label: exits $wanted"; else bad "$label: expected exit $wanted, got $FUNCTION_STATUS ($FUNCTION_OUTPUT)"; fi
}

printf '{"env": {"%s": "env-file"}}\n' "$VARIABLE" > "$WORK/with-value.json"
printf '{"env": {"%s": ""}}\n' "$VARIABLE" > "$WORK/with-empty-value.json"
printf '{"env": {"SUPERPOWERS_REVIEW_ROUNDS": "3"}}\n' > "$WORK/other-variable.json"

expect_status "a file that sets the variable" 1 "$WORK/with-value.json"
if echo "$FUNCTION_OUTPUT" | grep -qF -- "$VARIABLE" && echo "$FUNCTION_OUTPUT" | grep -qF -- "$WORK/with-value.json"; then
  ok "the message names the variable and the file"
else
  bad "the message does not name the variable and the file ($FUNCTION_OUTPUT)"
fi
expect_status "a file that sets the variable to an empty value" 1 "$WORK/with-empty-value.json"
expect_status "a file that sets another variable" 0 "$WORK/other-variable.json"
expect_status "a file that does not exist" 0 "$WORK/missing.json"
expect_status "the second of two files sets the variable" 1 "$WORK/other-variable.json" "$WORK/with-value.json"
if echo "$FUNCTION_OUTPUT" | grep -qF -- "$WORK/with-value.json"; then
  ok "the message names the second file"
else
  bad "the message does not name the second file ($FUNCTION_OUTPUT)"
fi

echo ""
echo "check_no_secrets_rules_managed_setting: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
