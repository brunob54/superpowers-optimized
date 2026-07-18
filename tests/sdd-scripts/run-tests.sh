#!/usr/bin/env bash
# SDD workspace-script test suite: sdd-workspace, task-brief, review-package.
# Pure bash + git; no claude invocation.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).

set -u

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/skills/subagent-driven-development/scripts"
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
assert_file_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}
assert_file_not_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then bad "$1 (must not contain: $3)"; else ok "$1"; fi
}

# Fresh throwaway git repo; all tests run inside it.
# pwd -P resolves macOS's /var -> /private/var symlink so path assertions
# match what git rev-parse --show-toplevel prints.
REPO=$(mktemp -d)
REPO=$(cd "$REPO" && pwd -P)
trap 'rm -rf "$REPO"' EXIT
cd "$REPO"
git init --quiet
git config user.email "test@test"
git config user.name "test"

bold "sdd-workspace"

WS=$("$SCRIPTS/sdd-workspace")
assert_eq "prints workspace path" "$WS" "$REPO/.superpowers/sdd"
[ -d "$WS" ] && ok "workspace directory created" || bad "workspace directory created"
assert_file_contains "self-ignoring gitignore" "$WS/.gitignore" "*"
WS2=$("$SCRIPTS/sdd-workspace")
assert_eq "idempotent second run" "$WS2" "$WS"
git add -A
STATUS=$(git status --porcelain)
assert_eq "workspace invisible to git status" "$STATUS" ""
git reset --quiet

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
