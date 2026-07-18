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

bold "task-brief"

cat > plan.md << 'PLAN'
# Some Plan

## Global Constraints
- constraint one

### Task 1: First thing

Body of task one.

- [ ] Step 1

### Task 2: Second thing

Body of task two.

```text
### Task 9: decoy inside a fence
```

Still task two text.

````markdown
```text
### Task 8: decoy inside nested fences
```
````

Past the nested decoy.

### Task 3: Third thing

Body of task three.
PLAN

BRIEF=$("$SCRIPTS/task-brief" plan.md 2 | sed 's/^wrote //; s/:.*$//')
assert_eq "brief path" "$BRIEF" "$REPO/.superpowers/sdd/task-2-brief.md"
assert_file_contains "brief has task 2 heading" "$BRIEF" "### Task 2: Second thing"
assert_file_contains "brief spans past the fenced decoy" "$BRIEF" "Still task two text."
assert_file_contains "fenced decoy heading kept inside brief" "$BRIEF" "### Task 9: decoy inside a fence"
assert_file_contains "brief spans past the nested-fence decoy" "$BRIEF" "Past the nested decoy."
assert_file_contains "nested decoy heading kept inside brief" "$BRIEF" "### Task 8: decoy inside nested fences"
assert_file_not_contains "brief excludes task 1" "$BRIEF" "Body of task one."
assert_file_not_contains "brief excludes task 3" "$BRIEF" "Body of task three."

"$SCRIPTS/task-brief" plan.md 99 2>/dev/null
assert_eq "missing task exits 3" "$?" "3"
"$SCRIPTS/task-brief" nope.md 1 2>/dev/null
assert_eq "missing plan exits 2" "$?" "2"

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
