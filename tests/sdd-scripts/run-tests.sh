#!/usr/bin/env bash
# SDD workspace-script test suite: sdd-workspace, task-brief, review-package.
# Pure bash + git; no claude invocation.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

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
assert_file_matches() { # desc file extended-regex
  if grep -qE -- "$3" "$2"; then ok "$1"; else bad "$1 (no match for: $3)"; fi
}
assert_contains() { # desc text needle (fixed string)
  case "$2" in *"$3"*) ok "$1" ;; *) bad "$1 (missing: $3)" ;; esac
}
# Join the lines of file $1 into one line — each line trimmed of leading and
# trailing blanks, lines separated by one space — so that a prose fragment
# that the text wraps across a line break still matches as one fixed string.
fold_file() { # file
  awk '{ line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line); if (NR > 1) printf " "; printf "%s", line } END { print "" }' "$1"
}
assert_folded_contains() { # desc file needle (fixed string, matched across line breaks)
  if fold_file "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}
# sdd-workspace's arg-less stderr backstops (scoping line / legacy warning) and
# its archive notices are asserted from $ERRF, not left to scroll past a green
# run. Capture with `2>"$ERRF"` at the call site, then assert here.
#
# Every assertion is exhaustive about the WHOLE captured stream, never just a
# substring of it: capturing stderr would otherwise hide an unexpected new line
# — a future regression's only signal — behind a green run. Each assertion also
# clears the sink, so an assertion whose call site lost its `2>"$ERRF"` reads an
# empty file and fails instead of passing on the previous call's text.
stderr_dump() { tr '\n' '|' < "$ERRF"; }

assert_stderr_eq() {     # desc expected-full-line   (deterministic messages)
  assert_eq "$1" "$(cat "$ERRF")" "$2"
  : > "$ERRF"
}
assert_stderr_one() {    # desc needle   (one line only; for messages with a timestamp)
  if [ "$(grep -c '' < "$ERRF" | tr -d ' ')" = "1" ] && grep -qF -- "$2" "$ERRF"; then
    ok "$1"
  else
    bad "$1 (want exactly one line containing '$2', got: $(stderr_dump))"
  fi
  : > "$ERRF"
}
# Silence assertions cannot tell "captured nothing" from "never captured", so arm
# the sink with a sentinel first: a missing `2>"$ERRF"` leaves it in place and fails.
arm_stderr() { printf 'SENTINEL: stderr was never captured here\n' > "$ERRF"; }
assert_stderr_silent() { # desc
  assert_eq "$1" "$(cat "$ERRF")" ""
  : > "$ERRF"
}

# Fresh throwaway git repo; all tests run inside it.
# pwd -P resolves macOS's /var -> /private/var symlink so path assertions
# match what git rev-parse --show-toplevel prints.
REPO=$(mktemp -d)
: "${REPO:?mktemp failed — refusing to run with an empty repo path}"
REPO=$(cd "$REPO" && pwd -P)
# Stderr sink for the assertions above. Kept outside $REPO so it can never
# appear in a `git status --porcelain` assertion.
ERRF=$(mktemp)
: "${ERRF:?mktemp failed — refusing to run with an empty stderr sink}"
trap 'rm -rf "$REPO" "$ERRF"' EXIT
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

arm_stderr
BRIEF=$("$SCRIPTS/task-brief" plan.md 2 2>"$ERRF" | sed 's/^wrote //; s/:.*$//')
assert_stderr_silent "task-brief quiet on an unscoped workspace with no content"
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

# The brief ends at the next heading of the same or a higher level than the
# task heading (as many "#" characters or fewer), also when that heading is
# not a task: a plan section after the last task, or a phase heading between
# two tasks, is plan-level text and not part of the brief. The fixtures live
# in the workspace, which ignores itself, so the `git add -A` of a later
# section never commits them.
ENDS="$WS/brief-ends"
mkdir -p "$ENDS"
assert_brief() { # desc plan task-number; the expected whole brief comes on standard input
  local expected out="$ENDS/task-$3-of-${2##*/}"
  expected=$(cat)
  "$SCRIPTS/task-brief" "$2" "$3" "$out" > /dev/null
  assert_eq "$1" "$(cat "$out")" "$expected"
}
cat > "$ENDS/plan.md" << 'PLAN'
# Ends Plan

## Phase 1

### Task 1: Middle task

Body of the middle task.

#### Notes of the middle task

Notes text of the middle task.

## Phase 2

Phase two introduction text.

### Task 2: Last task

Body of the last task.

```bash
# a shell comment, which has the form of a level-1 heading
## Fenced level-2 heading
### Fenced level-3 heading
```

#not-a-heading: no blank follows the number sign

Last task text after the fence.

### Verification

Plan-level verification text.

## Self-Review

Plan-level self-review text.
PLAN
assert_brief "brief of a middle task ends at a higher-level heading that is not a task, and keeps its deeper heading" "$ENDS/plan.md" 1 << 'BRIEF'
### Task 1: Middle task

Body of the middle task.

#### Notes of the middle task

Notes text of the middle task.
BRIEF
assert_brief "brief of the last task ends at a same-level heading that is not a task; fenced headings and a '#' line with no blank stay in it" "$ENDS/plan.md" 2 << 'BRIEF'
### Task 2: Last task

Body of the last task.

```bash
# a shell comment, which has the form of a level-1 heading
## Fenced level-2 heading
### Fenced level-3 heading
```

#not-a-heading: no blank follows the number sign

Last task text after the fence.
BRIEF
cat > "$ENDS/plan-level-2.md" << 'PLAN'
## Task 1: Level-2 task

Body of the level-2 task.

### Step heading of the level-2 task

Step text of the level-2 task.

## Notes after the level-2 task

Plan-level notes text.

## Task 10: Task whose number starts with 1

Body of task ten.
PLAN
assert_brief "the level comes from the task heading: a level-2 task keeps a level-3 heading and ends at a level-2 heading" "$ENDS/plan-level-2.md" 1 << 'BRIEF'
## Task 1: Level-2 task

Body of the level-2 task.

### Step heading of the level-2 task

Step text of the level-2 task.
BRIEF
cat > "$ENDS/plan-empty-heading.md" << 'PLAN'
### Task 1: Task followed by an empty heading

Body of the task.

###

Text after an empty heading of the task level.

### Task 2: Next task

Body of the next task.
PLAN
assert_brief "an empty heading line '###' of the task level is a heading, so it ends the brief" "$ENDS/plan-empty-heading.md" 1 << 'BRIEF'
### Task 1: Task followed by an empty heading

Body of the task.
BRIEF

# CommonMark fence forms. A fence line has 0 to 3 spaces, then 3 or more
# backticks or 3 or more tildes; only the same character, at least as many
# times, followed by blanks only, closes it. A heading line inside any such
# fence must not end the brief. Each case has its own plan file, so that a
# fence that one case leaves open cannot change the result of another case.
cat > "$ENDS/plan-tilde.md" << 'PLAN'
### Task 1: First task

Body of the first task.

### Task 2: Last task with a tilde fence

~~~bash
# a shell comment at column 0
~~~

Task text after the tilde fence.

## Self-Review

Plan-level self-review text.
PLAN
assert_brief "fences: a column-0 '# comment' line inside a '~~~bash' fence of the last task stays in the brief" "$ENDS/plan-tilde.md" 2 << 'BRIEF'
### Task 2: Last task with a tilde fence

~~~bash
# a shell comment at column 0
~~~

Task text after the tilde fence.
BRIEF
cat > "$ENDS/plan-indented.md" << 'PLAN'
### Task 1: Fence indented by three spaces

- [ ] **Step 1: Show the plan text**

   ```markdown
### Heading line of the task level inside the indented fence
   ```

Task text after the indented fence.

### Task 2: Next task

Body of the next task.
PLAN
assert_brief "fences: a column-0 heading of the task level inside a fence indented by three spaces stays in the brief" "$ENDS/plan-indented.md" 1 << 'BRIEF'
### Task 1: Fence indented by three spaces

- [ ] **Step 1: Show the plan text**

   ```markdown
### Heading line of the task level inside the indented fence
   ```

Task text after the indented fence.
BRIEF
cat > "$ENDS/plan-two-characters.md" << 'PLAN'
### Task 1: Fences of the two characters

```text
~~~
### Heading line inside the backtick fence, after a tilde line
```

~~~text
```
### Heading line inside the tilde fence, after a backtick line
~~~

Task text after the two fences.

## Self-Review

Plan-level self-review text.
PLAN
assert_brief "fences: a '~~~' line does not close a backtick fence, and a backtick line does not close a tilde fence" "$ENDS/plan-two-characters.md" 1 << 'BRIEF'
### Task 1: Fences of the two characters

```text
~~~
### Heading line inside the backtick fence, after a tilde line
```

~~~text
```
### Heading line inside the tilde fence, after a backtick line
~~~

Task text after the two fences.
BRIEF
cat > "$ENDS/plan-info-string.md" << 'PLAN'
### Task 1: Longer fence line with text after it

```text
````markdown
### Heading line after a longer fence line that has an info string
```

Task text after the fence.

## Self-Review

Plan-level self-review text.
PLAN
assert_brief "fences: a longer backtick line followed by text does not close a backtick fence" "$ENDS/plan-info-string.md" 1 << 'BRIEF'
### Task 1: Longer fence line with text after it

```text
````markdown
### Heading line after a longer fence line that has an info string
```

Task text after the fence.
BRIEF
# The limits of the fence form: four spaces of indentation, a run of only two
# backticks, or a run of only two tildes, is not a fence, so the next task
# heading still ends the brief.
cat > "$ENDS/plan-not-fences.md" << 'PLAN'
### Task 1: Lines that only look like fences

    ```
``two backticks`` at the start of a line open no fence.
~~two tildes~~ at the start of a line open no fence.

### Task 2: Next task

Body of the next task.
PLAN
assert_brief "fences: a backtick run indented by four spaces, a run of two backticks, or a run of two tildes, opens no fence" "$ENDS/plan-not-fences.md" 1 << 'BRIEF'
### Task 1: Lines that only look like fences

    ```
``two backticks`` at the start of a line open no fence.
~~two tildes~~ at the start of a line open no fence.
BRIEF

# A fence that never closes hides every heading after it. The plan below means
# a "```bash" block inside a "```markdown" block, but by the CommonMark rules
# the "```" line after "run-x" closes the markdown block, and the last "```"
# line (line 11) opens a new block that never closes; the "~~~" line inside
# that block does not close it. The script keeps the brief and the exit
# status as they are, and prints one warning line that names the line of the
# fence that never closes.
cat > "$ENDS/plan-unclosed.md" << 'PLAN'
### Task 1: Write the skill file

Create the skill file with:

```markdown
## Usage
```bash
run-x
```
More text
```

### Task 2: Second task

~~~
Body of the second task.
PLAN
UNCLOSED_OUT="$ENDS/task-1-of-plan-unclosed.md"
"$SCRIPTS/task-brief" "$ENDS/plan-unclosed.md" 1 "$UNCLOSED_OUT" > /dev/null 2>"$ERRF"
assert_eq "a fence that never closes: the exit status stays 0" "$?" "0"
assert_stderr_eq "a fence that never closes: one warning line names the line of that fence" \
  "warning: the fence that opens at line 11 of $ENDS/plan-unclosed.md never closes, so no heading after that line can start or end a brief"
assert_eq "a fence that never closes: the brief stays the whole rest of the plan" "$(cat "$UNCLOSED_OUT")" "$(cat "$ENDS/plan-unclosed.md")"
arm_stderr
"$SCRIPTS/task-brief" "$ENDS/plan-two-characters.md" 1 "$ENDS/task-1-of-plan-two-characters.md" > /dev/null 2>"$ERRF"
assert_stderr_silent "no fence warning on a plan whose fences all close"

# Line endings. A plan checked out with core.autocrlf=true (the Git for
# Windows default) ends each line with a carriage return (CR) byte before the
# line feed. For every "Task <number>" heading of every plan above, the brief
# made from a CRLF copy of the plan must hold the same lines as the brief made
# from the plan itself, each line still ending with its CR byte, and the exit
# status must be the same.
to_crlf() { awk '{ printf "%s\r\n", $0 }' "$1"; }
CRLF_DIFFS=""
CRLF_RUNS=0
for plan in "$ENDS"/plan*.md; do
  crlf="$ENDS/crlf-${plan##*/}"
  to_crlf "$plan" > "$crlf"
  for t in $(sed -nE 's/^#+[[:blank:]]+Task[[:blank:]]+([0-9]+).*/\1/p' "$plan" | sort -un); do
    "$SCRIPTS/task-brief" "$plan" "$t" "$ENDS/lf-out.md" > /dev/null 2>&1
    lf_status=$?
    "$SCRIPTS/task-brief" "$crlf" "$t" "$ENDS/crlf-out.md" > /dev/null 2>&1
    crlf_status=$?
    if [ "$lf_status" != "$crlf_status" ] || [ "$(to_crlf "$ENDS/lf-out.md")" != "$(cat "$ENDS/crlf-out.md")" ]; then
      CRLF_DIFFS="$CRLF_DIFFS ${plan##*/}:task-$t"
    fi
    CRLF_RUNS=$((CRLF_RUNS+1))
  done
done
if [ -z "$CRLF_DIFFS" ] && [ "$CRLF_RUNS" -gt 0 ]; then
  ok "CRLF line endings give the same brief and exit status as LF, for all $CRLF_RUNS tasks of the plans above"
else
  bad "CRLF line endings give the same brief and exit status as LF (compared $CRLF_RUNS tasks; different:$CRLF_DIFFS)"
fi

bold "review-package (range mode)"

echo "base" > base.txt
git add base.txt && git commit --quiet -m "base commit"
BASE=$(git rev-parse HEAD)
echo "alpha" > alpha.txt
git add alpha.txt && git commit --quiet -m "task: add alpha"
echo "beta" > beta.txt
git add beta.txt && git commit --quiet -m "task: add beta"
HEAD_SHA=$(git rev-parse HEAD)

PKG=$("$SCRIPTS/review-package" "$BASE" "$HEAD_SHA" 2>"$ERRF" | sed 's/^wrote //; s/:.*$//')
# Fixture dependency: the legacy warning fires only because the task-brief
# section above wrote task-2-brief.md into $WS, making has_content true.
assert_stderr_eq "review-package surfaces the legacy backstop once the workspace has content" "warning: workspace has content but no plan.ref — a stale ledger from another plan may be present"
EXPECTED_PKG="$REPO/.superpowers/sdd/review-$(git rev-parse --short "$BASE")..$(git rev-parse --short "$HEAD_SHA").diff"
assert_eq "range package path" "$PKG" "$EXPECTED_PKG"
assert_file_contains "range: first commit in list" "$PKG" "task: add alpha"
assert_file_contains "range: second commit in list" "$PKG" "task: add beta"
assert_file_contains "range: stat summary present" "$PKG" "2 files changed"
assert_file_contains "range: alpha hunk present" "$PKG" "+alpha"
assert_file_contains "range: beta hunk present" "$PKG" "+beta"

"$SCRIPTS/review-package" deadbeef "$HEAD_SHA" 2>/dev/null
assert_eq "bad BASE exits 2" "$?" "2"

bold "review-package (--commits mode)"

echo "gamma" > gamma.txt
git add gamma.txt && git commit --quiet -m "task1: add gamma"
C1=$(git rev-parse HEAD)
echo "delta" > delta.txt
git add delta.txt && git commit --quiet -m "task2: add delta (sibling)"
echo "epsilon" > epsilon.txt
git add epsilon.txt && git commit --quiet -m "task1: add epsilon"
C3=$(git rev-parse HEAD)

CPKG=$("$SCRIPTS/review-package" --commits "$C1" "$C3" 2>"$ERRF" | sed 's/^wrote //; s/:.*$//')
assert_stderr_eq "--commits surfaces the legacy backstop too" "warning: workspace has content but no plan.ref — a stale ledger from another plan may be present"
EXPECTED_CPKG="$REPO/.superpowers/sdd/review-commits-$(git rev-parse --short "$C1")..$(git rev-parse --short "$C3").diff"
assert_eq "--commits package path" "$CPKG" "$EXPECTED_CPKG"
assert_file_contains "--commits: first commit present" "$CPKG" "+gamma"
assert_file_contains "--commits: second commit present" "$CPKG" "+epsilon"
assert_file_not_contains "--commits: sibling task's hunk excluded" "$CPKG" "+delta"
assert_file_not_contains "--commits: sibling subject excluded" "$CPKG" "task2: add delta (sibling)"

"$SCRIPTS/review-package" --commits deadbeef 2>/dev/null
assert_eq "--commits bad SHA exits 2" "$?" "2"
"$SCRIPTS/review-package" --commits 2>/dev/null
assert_eq "--commits with no SHAs exits 2" "$?" "2"

bold "sdd-workspace (plan scoping)"

# Legacy pre-fix state: workspace holds briefs/diffs from the sections
# above and no plan.ref. First scoped call must archive it under unknown-*.
# Fixture dependency: task-2-brief.md ("### Task 2: Second thing") comes from
# the task-brief section's plan.md; review-*.diff from the review-package
# sections — editing those sections changes this legacy fixture.
cat > planA.md << 'PLAN'
### Task 1: plan A task
PLAN
echo "old ledger" > "$WS/progress.md"
echo "dot" > "$WS/.hidden-note"
OUT=$("$SCRIPTS/sdd-workspace" planA.md 2>"$ERRF")
assert_stderr_one "first scoping archives the legacy workspace under unknown-*" "archived previous workspace to archive/unknown-"
assert_eq "scoped call prints same path" "$OUT" "$WS"
assert_eq "plan.ref holds repo-relative path" "$(cat "$WS/plan.ref")" "planA.md"
LEGACY=$(ls -d "$WS"/archive/unknown-* 2>/dev/null | head -n 1)
if [ -n "$LEGACY" ]; then ok "legacy content archived under unknown-*"; else bad "legacy content archived under unknown-*"; fi
assert_file_contains "legacy ledger intact in archive" "$LEGACY/progress.md" "old ledger"
assert_file_contains "brief archived intact" "$LEGACY/task-2-brief.md" "### Task 2: Second thing"
if ls "$LEGACY"/review-*.diff > /dev/null 2>&1; then ok "review diffs archived"; else bad "review diffs archived"; fi
assert_file_contains "dotfile archived" "$LEGACY/.hidden-note" "dot"
if [ ! -e "$WS/progress.md" ]; then ok "workspace root fresh after legacy archive"; else bad "workspace root fresh after legacy archive"; fi
if ls "$WS"/task-*-brief.md > /dev/null 2>&1 || ls "$WS"/review-*.diff > /dev/null 2>&1; then bad "workspace root free of briefs/diffs"; else ok "workspace root free of briefs/diffs"; fi
assert_file_contains ".gitignore remains at workspace root after archive" "$WS/.gitignore" "*"
if [ ! -e "$LEGACY/.gitignore" ]; then ok ".gitignore excluded from archive move"; else bad ".gitignore excluded from archive move"; fi
BRIEF2=$("$SCRIPTS/task-brief" plan.md 2 2>"$ERRF" | sed 's/^wrote //; s/:.*$//')
assert_stderr_eq "task-brief surfaces the scoping backstop naming the current plan" "workspace is scoped to plan planA.md"
assert_eq "task-brief path unchanged once workspace is plan-scoped" "$BRIEF2" "$REPO/.superpowers/sdd/task-2-brief.md"
assert_file_contains "task-brief content unchanged once workspace is plan-scoped" "$BRIEF2" "### Task 2: Second thing"

# Resume: same plan via relative, absolute, and subdirectory-relative paths.
echo "ledger A" > "$WS/progress.md"
"$SCRIPTS/sdd-workspace" planA.md > /dev/null
assert_file_contains "relative resume keeps ledger" "$WS/progress.md" "ledger A"
"$SCRIPTS/sdd-workspace" "$REPO/planA.md" > /dev/null
assert_file_contains "absolute resume keeps ledger" "$WS/progress.md" "ledger A"
mkdir -p subdir
(cd subdir && "$SCRIPTS/sdd-workspace" ../planA.md > /dev/null)
assert_file_contains "subdir-relative resume keeps ledger" "$WS/progress.md" "ledger A"
assert_eq "resume created no new archives" "$(ls "$WS/archive" | wc -l | tr -d ' ')" "1"

# Switch to plan B: A's workspace archived intact under its slug.
cat > planB.md << 'PLAN'
### Task 1: plan B task
PLAN
"$SCRIPTS/sdd-workspace" planB.md > /dev/null 2>"$ERRF"
assert_stderr_eq "plan switch names the archive slug it wrote" "archived previous workspace to archive/planA"
assert_eq "plan.ref switched to plan B" "$(cat "$WS/plan.ref")" "planB.md"
assert_file_contains "plan A ledger archived intact" "$WS/archive/planA/progress.md" "ledger A"
assert_file_contains "archived workspace keeps its plan.ref" "$WS/archive/planA/plan.ref" "planA.md"

# Empty plan.ref = crash-during-write recovery state -> legacy rule.
echo "ledger B" > "$WS/progress.md"
: > "$WS/plan.ref"
"$SCRIPTS/sdd-workspace" planA.md > /dev/null 2>"$ERRF"
assert_stderr_one "empty-ref recovery archives under unknown-*" "archived previous workspace to archive/unknown-"
assert_eq "plan.ref rewritten after empty-ref recovery" "$(cat "$WS/plan.ref")" "planA.md"
assert_eq "empty-ref content archived under unknown-*" "$(ls -d "$WS"/archive/unknown-* | wc -l | tr -d ' ')" "2"
NEW_UNKNOWN=$(ls -d "$WS"/archive/unknown-* | sort | tail -n 1)
assert_file_contains "empty-ref ledger archived intact (not dropped/truncated)" "$NEW_UNKNOWN/progress.md" "ledger B"
if [ ! -e "$WS/progress.md" ]; then ok "workspace root fresh after empty-ref archive"; else bad "workspace root fresh after empty-ref archive"; fi

# Slug collision: archive/planA already exists; archiving plan A's
# workspace again must land in planA-2.
echo "ledger A2" > "$WS/progress.md"
"$SCRIPTS/sdd-workspace" planB.md > /dev/null 2>"$ERRF"
assert_stderr_eq "collision notice names the suffixed slug" "archived previous workspace to archive/planA-2"
assert_file_contains "collision archive suffixed" "$WS/archive/planA-2/progress.md" "ledger A2"

# Out-of-repo plan: absolute physical identity, stable across calls.
EXT=$(mktemp -d)
EXT=$(cd "$EXT" && pwd -P)
: "${EXT:?mktemp -d failed — refusing to operate on absolute root paths}"
EXT_PLAN="$EXT/ext-plan.md"
cat > "$EXT/ext-plan.md" << 'PLAN'
### Task 1: external plan task
PLAN
"$SCRIPTS/sdd-workspace" "$EXT/ext-plan.md" > /dev/null 2>"$ERRF"
assert_stderr_eq "out-of-repo scoping archives the previous plan" "archived previous workspace to archive/planB"
assert_eq "out-of-repo plan.ref is absolute" "$(cat "$WS/plan.ref")" "$EXT/ext-plan.md"
echo "ext ledger" > "$WS/progress.md"
arm_stderr
"$SCRIPTS/sdd-workspace" "$EXT/ext-plan.md" > /dev/null 2>"$ERRF"
assert_stderr_silent "out-of-repo resume archives nothing and stays quiet"
assert_file_contains "out-of-repo resume keeps ledger" "$WS/progress.md" "ext ledger"
rm -rf "$EXT"

# Errors and arg-less stderr backstops (stdout must stay one path line).
"$SCRIPTS/sdd-workspace" nope.md 2>/dev/null
assert_eq "missing plan exits 2" "$?" "2"
ERR=$("$SCRIPTS/sdd-workspace" 2>&1 > /dev/null)
case "$ERR" in *"workspace is scoped to plan $EXT_PLAN"*) ok "arg-less prints scoping line naming current plan" ;; *) bad "arg-less prints scoping line naming current plan (got: $ERR)" ;; esac
OUT=$("$SCRIPTS/sdd-workspace" 2>/dev/null)
assert_eq "arg-less stdout unchanged" "$OUT" "$WS"
rm "$WS/plan.ref"
ERR=$("$SCRIPTS/sdd-workspace" 2>&1 > /dev/null)
case "$ERR" in *"no plan.ref"*) ok "arg-less warns on legacy workspace (no plan.ref)" ;; *) bad "arg-less warns on legacy workspace (no plan.ref) (got: $ERR)" ;; esac

# Fresh workspace (no content, no plan.ref): plan.ref written, no archive.
rm -rf "$WS"
"$SCRIPTS/sdd-workspace" planA.md > /dev/null
assert_eq "fresh workspace plan.ref written" "$(cat "$WS/plan.ref")" "planA.md"
if [ ! -d "$WS/archive" ]; then ok "fresh workspace created no archive"; else bad "fresh workspace created no archive"; fi

# Archive notice: switching plans must report where the previous workspace went.
echo "seed" > "$WS/progress.md"
ARCH_ERR=$("$SCRIPTS/sdd-workspace" planB.md 2>&1 >/dev/null)
case "$ARCH_ERR" in *"archived previous workspace to archive/planA"*) ok "archive notice printed with correct slug" ;; *) bad "archive notice printed with correct slug (got: $ARCH_ERR)" ;; esac

# Missing-plan rejection creates no workspace: this invariant holds only for
# the missing-file check, which runs before any mkdir/write. It does not
# extend to the newline check, which runs after mkdir -p and the .gitignore
# write.
rm -rf "$WS"
"$SCRIPTS/sdd-workspace" nope.md 2>/dev/null
assert_eq "missing plan (no prior workspace) exits 2" "$?" "2"
if [ ! -d "$WS" ]; then ok "missing plan: workspace not created"; else bad "missing plan: workspace not created"; fi

bold "sdd-workspace (CDPATH safety)"

# A shadowing CDPATH entry must never hijack the relative `cd` used to
# resolve the plan's directory (I1): the identity must stay single-line
# and name the real plan, not a same-named directory found via CDPATH.
rm -rf "$WS"
mkdir -p docs/plans
cat > docs/plans/planC.md << 'PLAN'
### Task 1: plan C task
PLAN
SHADOW_ROOT=$(mktemp -d)
SHADOW_ROOT=$(cd "$SHADOW_ROOT" && pwd -P)
: "${SHADOW_ROOT:?mktemp -d failed — refusing to operate on absolute root paths}"
mkdir -p "$SHADOW_ROOT/docs/plans"
echo "decoy" > "$SHADOW_ROOT/docs/plans/decoy.md"
env CDPATH="$SHADOW_ROOT" "$SCRIPTS/sdd-workspace" docs/plans/planC.md > /dev/null
assert_eq "CDPATH shadow: plan.ref is single line" "$(wc -l < "$WS/plan.ref" | tr -d ' ')" "1"
assert_eq "CDPATH shadow: plan.ref names correct plan" "$(cat "$WS/plan.ref")" "docs/plans/planC.md"
echo "cdpath ledger" > "$WS/progress.md"
env CDPATH="$SHADOW_ROOT" "$SCRIPTS/sdd-workspace" docs/plans/planC.md > /dev/null
assert_file_contains "CDPATH shadow: repeat call keeps ledger" "$WS/progress.md" "cdpath ledger"
rm -rf "$SHADOW_ROOT"

bold "sdd-workspace (newline-in-path rejection)"

# A plan path whose basename embeds a literal newline would corrupt
# plan.ref the same way a CDPATH hijack does (I1) — reject it before
# writing anything, and never touch an existing ledger.
NL_PLAN=$'weird\nplan.md'
printf '### Task 1: weird\n' > "$NL_PLAN" 2>/dev/null
if [ -f "$NL_PLAN" ]; then
  ERR=$("$SCRIPTS/sdd-workspace" "$NL_PLAN" 2>&1 >/dev/null)
  RC=$?
  assert_eq "newline plan path rejected (exit 2)" "$RC" "2"
  case "$ERR" in *"multiple lines"*) ok "newline plan path: error names newline rejection" ;; *) bad "newline plan path: error names newline rejection (got: $ERR)" ;; esac
  assert_eq "newline plan path: plan.ref untouched" "$(cat "$WS/plan.ref")" "docs/plans/planC.md"
  assert_file_contains "newline plan path: ledger untouched" "$WS/progress.md" "cdpath ledger"
else
  echo "  SKIP: filesystem rejects newlines in filenames — newline-in-path rejection tests skipped"
fi
rm -f "$NL_PLAN"

bold "sdd-workspace (symlinked plan path)"

# A plan reached through a symlinked parent directory must resolve to its
# real (physical) location (script's pwd -P at :29/:94), not the symlink's
# logical name — otherwise the identity recorded in plan.ref would drift
# depending on which symlinked name was used to reach the same real plan.
rm -rf "$WS"
mkdir -p realdir
cat > realdir/planSym.md << 'PLAN'
### Task 1: symlink test
PLAN
if ln -s realdir symlink-to-real 2>/dev/null && [ -L symlink-to-real ]; then
  "$SCRIPTS/sdd-workspace" symlink-to-real/planSym.md > /dev/null
  assert_eq "symlinked plan path: identity uses resolved real path" "$(cat "$WS/plan.ref")" "realdir/planSym.md"
  echo "ledger sym" > "$WS/progress.md"
  "$SCRIPTS/sdd-workspace" symlink-to-real/planSym.md > /dev/null
  assert_file_contains "symlinked plan path: repeat call keeps ledger" "$WS/progress.md" "ledger sym"
  if [ ! -d "$WS/archive" ]; then ok "symlinked plan path: no archive on repeat call"; else bad "symlinked plan path: no archive on repeat call"; fi
else
  echo "  SKIP: ln -s not supported on this filesystem — symlinked plan path tests skipped"
fi

bold "review-package (reviewer blinding)"

# A commit that carries both an ordinary source change and committed review
# material: the package must show the source hunk and hide the review files.
mkdir -p docs/superpowers-orchestrator/2026-08-25-foo/implementation
mkdir -p docs/superpowers-orchestrator/2026-08-25-foo/specs
echo "base for blinding" > blind-base.txt
git add blind-base.txt && git commit --quiet -m "base commit for blinding"
BLIND_BASE=$(git rev-parse HEAD)

echo "SECRETFINDING round 1 verdict" > docs/superpowers-orchestrator/2026-08-25-foo/implementation/foo-review-log.md
echo "SECRETFIXREPORT ran the tests" > docs/superpowers-orchestrator/2026-08-25-foo/implementation/foo-fix-reports.md
echo "SECRETSIDECAR spec round 1" > docs/superpowers-orchestrator/2026-08-25-foo/specs/foo-design-review-log.md
echo "SECRETORCH phase 1 done" > docs/superpowers-orchestrator/2026-08-25-foo/foo-orchestration-log.md
echo "SECRETDECISIONS open item" > docs/superpowers-orchestrator/2026-08-25-foo/plans-open.tmp
mkdir -p docs/superpowers-orchestrator/2026-08-25-foo/plans
mv docs/superpowers-orchestrator/2026-08-25-foo/plans-open.tmp docs/superpowers-orchestrator/2026-08-25-foo/plans/foo-open-decisions.md
echo "VISIBLESOURCE" > blind-src.txt
# The name rule and the anchoring (multi-code-review/SKILL.md, "Reviewer
# blinding — pathspecs"): only a file whose name matches one of the four
# sidecar patterns is hidden; a markdown file under implementation/ with any
# other name — a note, or a CLAUDE.md a branch could plant there — is
# visible, as is a non-markdown file; and a file outside
# docs/superpowers-orchestrator/ is visible even when its name or its folder
# matches a sidecar pattern.
echo "VISIBLEIMPLNOTE note whose name matches no sidecar pattern" > docs/superpowers-orchestrator/2026-08-25-foo/implementation/leak-check.md
echo "VISIBLEIMPLCLAUDEMD planted instructions" > docs/superpowers-orchestrator/2026-08-25-foo/implementation/CLAUDE.md
echo "VISIBLEIMPLJS" > docs/superpowers-orchestrator/2026-08-25-foo/implementation/code.js
mkdir -p notes src/implementation
echo "VISIBLENOTES" > notes/x-review-log.md
echo "VISIBLESRCIMPL" > src/implementation/real.js
git add -A && git commit --quiet -m "feature plus review material"
BLIND_HEAD=$(git rev-parse HEAD)

BPKG=$("$SCRIPTS/review-package" "$BLIND_BASE" "$BLIND_HEAD" 2>/dev/null | sed 's/^wrote //; s/:.*$//')
assert_file_contains "blinding: ordinary source change is visible" "$BPKG" "VISIBLESOURCE"
assert_file_not_contains "blinding: implementation review log hidden" "$BPKG" "SECRETFINDING"
assert_file_not_contains "blinding: implementation fix reports hidden" "$BPKG" "SECRETFIXREPORT"
assert_file_not_contains "blinding: spec review-log sidecar hidden" "$BPKG" "SECRETSIDECAR"
assert_file_not_contains "blinding: orchestration log hidden" "$BPKG" "SECRETORCH"
assert_file_not_contains "blinding: open-decisions file hidden" "$BPKG" "SECRETDECISIONS"
assert_file_contains "blinding: markdown under implementation/ whose name matches no sidecar pattern visible" "$BPKG" "VISIBLEIMPLNOTE"
assert_file_contains "blinding: a CLAUDE.md under implementation/ visible" "$BPKG" "VISIBLEIMPLCLAUDEMD"
assert_file_contains "blinding: non-markdown file under implementation/ visible" "$BPKG" "VISIBLEIMPLJS"
assert_file_contains "blinding: *-review-log.md outside the plugin folder visible" "$BPKG" "VISIBLENOTES"
assert_file_contains "blinding: implementation/ folder outside the plugin folder visible" "$BPKG" "VISIBLESRCIMPL"
# The six assertions above key on file CONTENT, which only the `git diff -U10`
# body can carry. The `## Files changed` section is a `git diff --stat`, which
# prints file NAMES and counts and no content at all, so a package whose
# `--stat` is un-blinded passes every one of them while still listing
# `…/implementation/foo-review-log.md` to the reviewer. This assertion keys on
# the path, so it is the only one that reaches the `--stat` edit in Step 3.
# It is negative-only: if the whole `## Files changed` section were dropped,
# or its command broke, the needle would also be absent and this would still
# pass for the wrong reason. Pair it with a positive control on blind-src.txt
# (short, so `--stat` never abbreviates it, unlike the long
# implementation/code.js path). The regex tolerates `--stat`'s column
# padding, which varies with how many files are in the diff — this suite
# reuses one repo across every section, so that count is not fixed.
assert_file_matches "blinding: a visible file's stat line is present" "$BPKG" 'blind-src\.txt +\| +[0-9]+ \+'
assert_file_not_contains "blinding: review file names absent from the stat summary" "$BPKG" "implementation/foo-review-log.md"

# A commit that touches ONLY review material must not appear in the commit
# list at all — a visible "chore(review)" subject with no hunks tells a
# reviewer that review rounds happened.
echo "SECRETFINDING round 2 verdict" >> docs/superpowers-orchestrator/2026-08-25-foo/implementation/foo-review-log.md
git add -A && git commit --quiet -m "chore(review): foo round 2 log"
BLIND_HEAD2=$(git rev-parse HEAD)
BLIND_OUT2=$("$SCRIPTS/review-package" "$BLIND_BASE" "$BLIND_HEAD2" 2>/dev/null)
BPKG2=$(printf '%s\n' "$BLIND_OUT2" | sed 's/^wrote //; s/:.*$//')
# Positive control: without it, a missing or empty $BPKG2 would make the
# negative assertion below report PASS for the wrong reason (grep can't read
# the file), so assert visible source is actually present first.
assert_file_contains "blinding: ordinary source still visible in the commit-list check" "$BPKG2" "VISIBLESOURCE"
# Positive control on the `## Commits` section itself: the assertions above
# key on the diff body, not this section, so a regression where
# `git log --oneline` prints nothing for this range would still pass them.
# Assert the visible commit's own subject appears here before checking that
# the review-only commit's subject does not.
assert_file_contains "blinding: ordinary commit's own subject appears in the commit list" "$BPKG2" "feature plus review material"
assert_file_not_contains "blinding: review-only commit absent from the commit list" "$BPKG2" "chore(review)"
# The printed summary line is also a blinding surface: `git rev-list --count`
# uses the same blind pathspecs, so a regression that counted the
# chore(review) commit anyway would go unnoticed since the test discards this
# line. $BLIND_HEAD2 adds exactly one commit that touches only blinded paths,
# so the pathspec-limited count over $BLIND_BASE..$BLIND_HEAD2 must stay 1.
BLIND_COUNT2=$(printf '%s\n' "$BLIND_OUT2" | sed -E 's/.*: ([0-9]+) commit\(s\).*/\1/')
assert_eq "blinding: printed commit count excludes the review-only commit" "$BLIND_COUNT2" "1"

# --commits mode must be blinded too. The spec requires blinding in BOTH
# modes, and the wave-execution path uses this one. Same commit, addressed by
# SHA instead of by range.
# Write it into $WS (the `.superpowers/sdd/` workspace, which carries a
# self-ignoring `.gitignore`), NOT into the repository root: a stray untracked
# file at the root would make Task 12's `git status --porcelain` assertion
# report dirty. The variable name avoids `CPKG`, already bound at line ~179.
BLIND_CPKG="$WS/blind-from-commits.diff"
"$SCRIPTS/review-package" --commits "$BLIND_HEAD" --out "$BLIND_CPKG" >/dev/null 2>&1
assert_file_contains "blinding (--commits): ordinary source change is visible" "$BLIND_CPKG" "VISIBLESOURCE"
assert_file_not_contains "blinding (--commits): implementation review log hidden" "$BLIND_CPKG" "SECRETFINDING"
# The remaining four secret needles from the range-mode check above, asserted
# here too: range mode uses `git diff` and --commits mode uses `git show`, so
# coverage on one command set does not transfer to the other.
assert_file_not_contains "blinding (--commits): implementation fix reports hidden" "$BLIND_CPKG" "SECRETFIXREPORT"
assert_file_not_contains "blinding (--commits): spec review-log sidecar hidden" "$BLIND_CPKG" "SECRETSIDECAR"
assert_file_not_contains "blinding (--commits): orchestration log hidden" "$BLIND_CPKG" "SECRETORCH"
assert_file_not_contains "blinding (--commits): open-decisions file hidden" "$BLIND_CPKG" "SECRETDECISIONS"
assert_file_contains "blinding (--commits): markdown under implementation/ whose name matches no sidecar pattern visible" "$BLIND_CPKG" "VISIBLEIMPLNOTE"
assert_file_contains "blinding (--commits): a CLAUDE.md under implementation/ visible" "$BLIND_CPKG" "VISIBLEIMPLCLAUDEMD"
assert_file_contains "blinding (--commits): non-markdown file under implementation/ visible" "$BLIND_CPKG" "VISIBLEIMPLJS"
assert_file_contains "blinding (--commits): *-review-log.md outside the plugin folder visible" "$BLIND_CPKG" "VISIBLENOTES"
assert_file_contains "blinding (--commits): implementation/ folder outside the plugin folder visible" "$BLIND_CPKG" "VISIBLESRCIMPL"
# Same reasoning for `git show --stat` in --commits mode, paired with the
# same positive control.
assert_file_matches "blinding (--commits): a visible file's stat line is present" "$BLIND_CPKG" 'blind-src\.txt +\| +[0-9]+ \+'
assert_file_not_contains "blinding (--commits): review file names absent from the stat summary" "$BLIND_CPKG" "implementation/foo-review-log.md"
# Positive control: the package's `## Commits` section must name THIS commit's
# own subject. $BLIND_HEAD's own diff already touches visible paths (e.g.
# VISIBLESOURCE), so `git log -1 --no-walk` finds a match at the commit
# itself and this holds whether or not `--no-walk` is present — the
# assertion on $BLIND_CPKG2 below is the one that isolates the walk.
assert_file_contains "blinding (--commits): ordinary commit's own subject appears in the commit list" "$BLIND_CPKG" "feature plus review material"

# The commit list must be blinded in --commits mode too: a commit touching
# ONLY review material must not appear, mirroring the range-mode assertion
# above. $BLIND_HEAD2 (the "chore(review): foo round 2 log" commit created
# above) already qualifies, so it is reused here rather than making a new one.
BLIND_CPKG2="$WS/blind-from-commits-2.diff"
"$SCRIPTS/review-package" --commits "$BLIND_HEAD2" --out "$BLIND_CPKG2" >/dev/null 2>&1
# Positive control: without it, a missing or empty $BLIND_CPKG2 would make the
# negative assertion below report PASS for the wrong reason (grep can't read
# the file), so assert the package header is actually present first.
assert_file_contains "blinding (--commits): review-only package still has its header" "$BLIND_CPKG2" "# Review package (explicit commits)"
assert_file_not_contains "blinding (--commits): review-only commit absent from the commit list" "$BLIND_CPKG2" "chore(review)"
# Discriminating control: $BLIND_HEAD2 touches ONLY review material, which
# the pathspecs exclude, so `git log -1 --no-walk` finds no match at the
# commit itself and prints nothing here. Without `--no-walk`
# (review-package:71), `git log -1` would instead walk past this blinded
# commit to the previous one that DOES touch a visible path — $BLIND_HEAD —
# and print ITS subject, "feature plus review material", here. The assertion
# above (on $BLIND_CPKG) cannot catch this: $BLIND_HEAD's own diff already
# matches the pathspec, so it passes with or without `--no-walk`. A
# regression that substitutes an unrelated ancestor's subject (history
# simplification walking past a blinded diff) would go undetected without
# this assertion — see V1.
assert_file_not_contains "blinding (--commits): review-only package does not leak an ancestor's subject via history walk" "$BLIND_CPKG2" "feature plus review material"

# Run from a subdirectory and assert on the package CONTENT, not on the exit
# status: `review-package` exits 0 from anywhere, with or without the
# pathspecs, so an exit-status check would pass for every implementation. The
# content check is the real discriminator — with a relative scope such as
# `-- .` the diff would be restricted to `subdir-for-anchor/` and VISIBLESOURCE
# would be missing; ':(top)' anchors every pathspec at the repository root.
mkdir -p subdir-for-anchor
BLIND_SUBPKG="$WS/blind-from-subdir.diff"
( cd subdir-for-anchor && "$SCRIPTS/review-package" "$BLIND_BASE" "$BLIND_HEAD" "$BLIND_SUBPKG" >/dev/null 2>&1 )
assert_file_contains "blinding: source visible when the package is built from a subdirectory" "$BLIND_SUBPKG" "VISIBLESOURCE"
assert_file_not_contains "blinding: review log hidden when built from a subdirectory" "$BLIND_SUBPKG" "SECRETFINDING"

# `subdir-for-anchor` is an empty directory; git stores no empty directories,
# so it leaves no untracked entry behind for Task 12's clean-tree assertion.

# A sidecar moved with `git mv` out of a legacy location (`docs/specs/`,
# `docs/plans/`) into the topic folder. Git pairs a rename only when both
# sides of the move are in the diff: with the destination excluded and the
# source not, the move degrades to a deletion of the source, and that
# deletion hunk carries the sidecar's WHOLE old content — every prior
# finding — into the package. The four legacy-location entries exclude the
# source side too. A moved file that is NOT a sidecar (the spec itself) is an
# ordinary rename the reviewer must still see.
mkdir -p docs/specs docs/plans
echo "SECRETLEGACYSPECLOG spec round 1 verdict" > docs/specs/x-design-review-log.md
echo "SECRETLEGACYPLANLOG plan round 1 verdict" > docs/plans/x-review-log.md
echo "SECRETLEGACYORCH phase 1 done" > docs/plans/x-orchestration-log.md
echo "SECRETLEGACYDECISIONS open item" > docs/plans/x-open-decisions.md
echo "VISIBLELEGACYSPEC design text" > docs/specs/x-design.md
git add -A && git commit --quiet -m "legacy-layout documents"
LEGACY_BASE=$(git rev-parse HEAD)
LEGACY_TOPIC=docs/superpowers-orchestrator/2026-08-25-x
mkdir -p "$LEGACY_TOPIC/specs" "$LEGACY_TOPIC/plans"
git mv docs/specs/x-design-review-log.md "$LEGACY_TOPIC/specs/x-design-review-log.md"
git mv docs/plans/x-review-log.md "$LEGACY_TOPIC/plans/x-review-log.md"
git mv docs/plans/x-orchestration-log.md "$LEGACY_TOPIC/x-orchestration-log.md"
git mv docs/plans/x-open-decisions.md "$LEGACY_TOPIC/plans/x-open-decisions.md"
git mv docs/specs/x-design.md "$LEGACY_TOPIC/specs/x-design.md"
git commit --quiet -m "migrate x to the topic folder"
LEGACY_HEAD=$(git rev-parse HEAD)
LEGACY_PKG=$("$SCRIPTS/review-package" "$LEGACY_BASE" "$LEGACY_HEAD" 2>/dev/null | sed 's/^wrote //; s/:.*$//')
# Positive control first: the moved spec is listed as a rename, so a missing
# or empty package cannot make the negative assertions below pass.
assert_file_contains "blinding (legacy move): the moved spec is still listed" "$LEGACY_PKG" "rename to $LEGACY_TOPIC/specs/x-design.md"
for legacy_path in docs/specs/x-design-review-log.md docs/plans/x-review-log.md docs/plans/x-orchestration-log.md docs/plans/x-open-decisions.md; do
  assert_file_not_contains "blinding (legacy move): no deletion entry for $legacy_path" "$LEGACY_PKG" "$legacy_path"
done
for needle in SECRETLEGACYSPECLOG SECRETLEGACYPLANLOG SECRETLEGACYORCH SECRETLEGACYDECISIONS; do
  assert_file_not_contains "blinding (legacy move): moved sidecar content absent ($needle)" "$LEGACY_PKG" "$needle"
done
# The same move addressed by SHA: --commits mode uses `git show`, not
# `git diff`, so range-mode coverage does not transfer.
LEGACY_CPKG="$WS/blind-legacy-move.diff"
"$SCRIPTS/review-package" --commits "$LEGACY_HEAD" --out "$LEGACY_CPKG" >/dev/null 2>&1
assert_file_contains "blinding (legacy move, --commits): the moved spec is still listed" "$LEGACY_CPKG" "rename to $LEGACY_TOPIC/specs/x-design.md"
assert_file_not_contains "blinding (legacy move, --commits): no deletion entry for the moved spec sidecar" "$LEGACY_CPKG" "docs/specs/x-design-review-log.md"
assert_file_not_contains "blinding (legacy move, --commits): moved sidecar content absent" "$LEGACY_CPKG" "SECRETLEGACYSPECLOG"

# Drift check: `blind_pathspecs` in review-package is the pathspec set a
# script actually executes; multi-code-review/SKILL.md and reviewer-prompt.md
# each copy it verbatim in prose, held in step with it only by a comment.
# Read the entries — ':(top)' plus the eight exclusions — out of
# review-package itself, rather than retyping them here, so a future edit to
# the array is caught even if the two docs are never touched.
SKILL_MD="$(dirname "$(dirname "$SCRIPTS")")/multi-code-review/SKILL.md"
REVIEWER_PROMPT_MD="$(dirname "$(dirname "$SCRIPTS")")/multi-code-review/reviewer-prompt.md"
BLIND_PATHSPECS=()
while IFS= read -r entry; do
  BLIND_PATHSPECS+=("$entry")
done < <(sed -n '/^blind_pathspecs=($/,/^)$/p' "$SCRIPTS/review-package" | grep -oE "':[^']*'" | sed "s/^'//; s/'\$//")
assert_eq "blinding drift check: blind_pathspecs has exactly nine entries (':(top)' plus eight exclusions)" "${#BLIND_PATHSPECS[@]}" "9"
for entry in "${BLIND_PATHSPECS[@]}"; do
  assert_file_contains "blinding drift check: SKILL.md still lists $entry" "$SKILL_MD" "$entry"
  assert_file_contains "blinding drift check: reviewer-prompt.md still lists $entry" "$REVIEWER_PROMPT_MD" "$entry"
done

bold "pipeline-mode git rules (multi-code-review)"

# Drift check target for rules 1, 2, and 4 below: a local re-implementation
# alone cannot fail if the documented block in SKILL.md drifts or is edited
# wrongly, so each rule's local test is paired with an assert_file_contains
# against the fenced block SKILL.md actually documents.
SKILL_MD="$(dirname "$(dirname "$SCRIPTS")")/multi-code-review/SKILL.md"

PTOPIC="docs/superpowers-orchestrator/2026-08-25-bar"
PLOG="$PTOPIC/implementation/bar-review-log.md"
mkdir -p "$PTOPIC/implementation"
echo "unrelated source" > unrelated.txt
git add unrelated.txt && git commit --quiet -m "base for pipeline rules"

# Rule 1: `git add` + a path-limited commit commits an untracked log while
# leaving an unrelated staged file staged.
echo "round 1 verdict" > "$PLOG"
# Before anything under $PTOPIC has ever been `git add`ed, the whole topic
# folder is untracked and git collapses it to a single "?? $PTOPIC/" line
# instead of listing the log file inside it. The exclude pathspec still has
# to hide that collapsed line, or the very first pipeline invocation for a
# topic would read dirty.
PRECOND_UNTRACKED_FOLDER=$(git status --porcelain -- ':(top)' ":(top,exclude)$PTOPIC/implementation/*")
# Positive control: without it, an ignored or never-created topic folder
# would also read clean above for the wrong reason. Confirm the untracked
# folder is actually visible to `git status` when the exclusion is dropped.
assert_eq "rule 2 positive control: without the exclusion, the untracked topic folder is visible" "$(git status --porcelain -- ':(top)')" "?? $PTOPIC/"
assert_eq "rule 2: brand-new topic folder (untracked, collapsed to one line) reads clean" "$PRECOND_UNTRACKED_FOLDER" ""
echo "staged by the user" > user-staged.txt
git add user-staged.txt
git add -- "$PLOG"
git commit --quiet -m "chore(review): bar round 1 log" -- "$PLOG"
assert_eq "rule 1: log is committed" "$(git log -1 --format=%s)" "chore(review): bar round 1 log"
assert_eq "rule 1: the user's staged file is still staged" "$(git diff --cached --name-only)" "user-staged.txt"
assert_file_contains "rule 1 drift check: SKILL.md still stages the log before committing" "$SKILL_MD" "git add -- <log> [<fix reports>]"
assert_file_contains "rule 1 drift check: SKILL.md still commits with the generic chore(review) subject" "$SKILL_MD" 'git commit -m "chore(review): <slug> round <i> log" -- <log> [<fix reports>]'
# The skipped (N=0) entry is committed too (rule 1), and the validation
# step 5 retry names its subject among the commits it may retry. Both
# places must keep naming the subject, or the entry is left uncommitted.
assert_file_contains "rule 1 drift check: SKILL.md still commits the skipped (N=0) entry with the skipped subject" "$SKILL_MD" 'same way, with subject `chore(review): <slug> skipped`'
assert_file_contains "validation step 5 drift check: SKILL.md still names the skipped subject among the commits it retries" "$SKILL_MD" 'entry (`chore(review): <slug> skipped`)'
# The decisions addendum (the user's answers to open items, supplied on a
# later dispatch) is committed under rule 1 with its own subject.
assert_file_contains "rule 1 drift check: SKILL.md still commits the decisions addendum with the decisions subject" "$SKILL_MD" 'with subject `chore(review): <slug> decisions`'

# Rule 2: the precondition pathspec reports clean with only the log modified,
# and dirty with a source file modified.
git commit --quiet -m "keep the user file out of the way" -- user-staged.txt
# By round 2 the topic's implementation folder is already tracked (it holds
# the committed round-1 log), but a fresh round's log or fix-report file
# starts out untracked inside it. The exclude pathspec has to hide that
# untracked file too, not only a modification to the already-tracked log.
echo "not yet staged" > "$PTOPIC/implementation/bar-fix-reports.md"
PRECOND_UNTRACKED_IN_TRACKED_FOLDER=$(git status --porcelain -- ':(top)' ":(top,exclude)$PTOPIC/implementation/*")
# Positive control: without it, an ignored or never-created fix-reports file
# would also read clean above for the wrong reason. Confirm the untracked
# file is actually visible to `git status` when the exclusion is dropped.
assert_eq "rule 2 positive control: without the exclusion, the untracked fix-reports file is visible" "$(git status --porcelain -- ':(top)')" "?? $PTOPIC/implementation/bar-fix-reports.md"
assert_eq "rule 2: untracked file in an already-tracked implementation folder reads clean" "$PRECOND_UNTRACKED_IN_TRACKED_FOLDER" ""
rm -f "$PTOPIC/implementation/bar-fix-reports.md"
echo "round 2 verdict" >> "$PLOG"
PRECOND=$(git status --porcelain -- ':(top)' ":(top,exclude)$PTOPIC/implementation/*")
assert_eq "rule 2: modified implementation log reads clean" "$PRECOND" ""
echo "changed" >> unrelated.txt
PRECOND2=$(git status --porcelain -- ':(top)' ":(top,exclude)$PTOPIC/implementation/*")
if [ -n "$PRECOND2" ]; then ok "rule 2: modified source file reads dirty"; else bad "rule 2: modified source file reads dirty"; fi
git checkout --quiet -- unrelated.txt
git add -- "$PLOG" && git commit --quiet -m "chore(review): bar round 2 log" -- "$PLOG"
assert_file_contains "rule 2 drift check: SKILL.md still excludes the topic's implementation folder" "$SKILL_MD" "git status --porcelain -- ':(top)' ':(top,exclude)<topic>/implementation/*'"

# Rule 4: the effective HEAD is the newest commit in BASE..HEAD that changes
# at least one path outside the blinding pathspec set — reviewable content.
# The commit subject plays no part: the loop's own `chore(review): <slug>
# round <i> log` commits are skipped because they change only the sidecar,
# not because of their subject.
#
# The lookup is used several times below, with different range bases. Define
# it once as a function rather than pasting the command repeatedly: two
# byte-identical copies of a logic block are exactly what the review rubric
# treats as a defect, and the repository's DRY rule forbids them. The
# function reads the pathspec set out of review-package ($BLIND_PATHSPECS,
# extracted by the blinding drift check above) instead of retyping it, so it
# follows the set the script actually executes. It is NOT required to be
# byte-identical to the version `multi-code-review/SKILL.md` documents — this
# test asserts the lookup's behavior, not the skill's wording.
effective_head_of() {
  local base="$1" effective_head
  effective_head=$(git log -1 --full-history --format=%H "$base..HEAD" -- "${BLIND_PATHSPECS[@]}")
  [ -n "$effective_head" ] || effective_head=$(git rev-parse "$base")
  printf '%s\n' "$effective_head"
}

PBASE=$(git rev-parse HEAD~3)
echo "real work" > real-work.txt
git add real-work.txt && git commit --quiet -m "feat: real work"
REAL_WORK_SHA=$(git rev-parse HEAD)
echo "round 3 verdict" >> "$PLOG"
git add -- "$PLOG" && git commit --quiet -m "chore(review): bar round 3 log" -- "$PLOG"

assert_eq "rule 4: effective HEAD skips the trailing review commit" \
  "$(effective_head_of "$PBASE")" "$REAL_WORK_SHA"

# Rule 4 keys on CONTENT, not on the commit subject. (i) A user commit whose
# subject starts with `chore(review):` but changes code is the effective
# HEAD: a subject-based walk would skip it, and the once-per-gate check would
# then treat the branch as already reviewed.
echo "code change under a review-looking subject" > b.txt
git add b.txt && git commit --quiet -m "chore(review): x"
CODE_UNDER_REVIEW_SUBJECT_SHA=$(git rev-parse HEAD)
assert_eq "rule 4 (i): a chore(review)-titled commit that changes code is the effective HEAD" \
  "$(effective_head_of "$PBASE")" "$CODE_UNDER_REVIEW_SUBJECT_SHA"
# (ii) A commit with an ordinary subject that changes only the review log is
# NOT the effective HEAD: it stays at the previous content commit.
echo "round 4 verdict" >> "$PLOG"
git add -- "$PLOG" && git commit --quiet -m "feat: y" -- "$PLOG"
assert_eq "rule 4 (ii): a feat-titled commit that changes only the review log is not the effective HEAD" \
  "$(effective_head_of "$PBASE")" "$CODE_UNDER_REVIEW_SUBJECT_SHA"

# (iii) Rule 4, degenerate case: a range with no content commit — here only
# the `feat: y` sidecar commit — falls back to BASE.
ONLY_BASE=$(git rev-parse HEAD~1)
assert_eq "rule 4 (iii): a range with no content commit falls back to BASE" \
  "$(effective_head_of "$ONLY_BASE")" "$ONLY_BASE"
# The fallback must normalize BASE: given as a short SHA (or a ref name),
# the result is still the full SHA the completion marker records.
assert_eq "rule 4 (iii): a range with no content commit given a short BASE falls back to the full SHA" \
  "$(effective_head_of "$(git rev-parse --short "$ONLY_BASE")")" "$ONLY_BASE"

# Drift check: the DRY comment above waives byte-identity between
# effective_head_of() and the fenced bash block skills/multi-code-review/SKILL.md
# documents. Without a check on that block, the "rule 4" assertions above
# only exercise the local helper, so they cannot fail if the documented block
# drifts or is edited wrongly. Assert the load-bearing lines this helper
# reproduces are still present in the SKILL.md block: the path-limited
# `git log -1` lookup carrying the same pathspec set review-package executes
# (rebuilt from $BLIND_PATHSPECS in the one-line quoted form the skill
# uses), the BASE fallback, and the absence of the former subject-based
# walk. $SKILL_MD was defined above, ahead of the rule 1 drift check, and
# reused here.
SKILL_SET=$(printf "'%s' " "${BLIND_PATHSPECS[@]}" | sed 's/ $//')
assert_file_contains "rule 4 drift check: SKILL.md still looks the effective HEAD up by content, with the blinding pathspecs" "$SKILL_MD" "effective_head=\$(git log -1 --full-history --format=%H \"\$BASE..HEAD\" -- $SKILL_SET)"
assert_file_contains "rule 4 drift check: SKILL.md still falls back to the resolved BASE when empty" "$SKILL_MD" '[ -n "$effective_head" ] || effective_head=$(git rev-parse "$BASE")'
assert_file_not_contains "rule 4 drift check: SKILL.md no longer keys the effective HEAD on the commit subject" "$SKILL_MD" "'chore(review):'*) continue ;;"
# The once-per-gate skip applies only to an invocation that ended with no
# open items; with open items, unchanged content and no answers, the loop
# returns BLOCKED instead of re-running. Pin the condition.
assert_file_contains "rule 4 drift check: SKILL.md still limits the once-per-gate skip to unresolved = 0 and user_decision = 0" "$SKILL_MD" '`unresolved = 0` and `user_decision = 0`'
# Resume after new code: when the effective HEAD has moved past the latest
# entry's completion marker, the orchestrator's code-review-loop controller
# always starts a new invocation — an answer alone never requests a
# re-review. The controller template holds the canonical copy of that rule
# (Deviation 5); pin the sentence there.
CODE_REVIEW_LOOP_PROMPT_MD="$(dirname "$(dirname "$SCRIPTS")")/orchestrating-development/code-review-loop-prompt.md"
assert_file_contains "resume drift check: code-review-loop-prompt.md still always starts a new invocation after the effective HEAD moved" "$CODE_REVIEW_LOOP_PROMPT_MD" 'controller ALWAYS starts a new invocation entry over the current'
# In the moved case (effective HEAD past the entry's marker) the decisions
# addendum must not update that entry's completion marker; the new entry's
# _Invocation line is committed together with it, so a retry never reads a
# marker that claims the new code was reviewed. Pin the Pipeline rule 4
# sentence.
assert_file_contains "rule 4 drift check: SKILL.md still leaves the completion marker unchanged when the addendum is written in the moved case" "$SKILL_MD" "the addendum leaves that entry's completion marker unchanged"

bold "TOPIC_DIR validation rule (multi-code-review)"

# Rules 1, 2, and 4 above each got a behavioral block plus a drift check
# against the documented text. The TOPIC_DIR validation rule (SKILL.md
# "Validation, before round 1", steps 1 and 4) got neither: a test extracts
# the basename regex straight out of SKILL.md and asserts what it accepts
# and rejects, so an edit that drops the trailing `$` or otherwise loosens
# the regex is caught here instead of only being caught by an agent
# following the skill at review time. $SKILL_MD was defined above, ahead of
# the rule 1 drift check, and reused here.
TOPIC_REGEX=$(grep -oE '`\^\[0-9\][^`]*\$`' "$SKILL_MD" | head -1 | tr -d '`')
if [ -n "$TOPIC_REGEX" ]; then
  ok "TOPIC_DIR validation: basename regex extracted from SKILL.md"
else
  bad "TOPIC_DIR validation: basename regex extracted from SKILL.md (found nothing)"
fi

topic_regex_matches() { [[ "$1" =~ $TOPIC_REGEX ]]; }

for good in "2026-08-25-artifact-layout" "2026-08-25-sum-fix"; do
  if topic_regex_matches "$good"; then
    ok "TOPIC_DIR validation: regex accepts $good"
  else
    bad "TOPIC_DIR validation: regex accepts $good"
  fi
done

for bad_case in "2026-8-25-foo" "Foo-Bar" "foo" "2026-08-25-"; do
  if topic_regex_matches "$bad_case"; then
    bad "TOPIC_DIR validation: regex rejects $bad_case"
  else
    ok "TOPIC_DIR validation: regex rejects $bad_case"
  fi
done

# Drift check: step 1's "direct child" requirement and step 4's
# `git check-ignore -q` check are the two other load-bearing parts of the
# validation rule with no behavioral test of their own (a fabricated
# repository root and blinding pathspec, both required to exercise them for
# real, are out of proportion to this rule's own risk) — assert their
# documented wording directly, in the same style as the rule 1/2/4 drift
# checks above.
assert_file_contains "TOPIC_DIR validation drift check: SKILL.md still requires a direct child of docs/superpowers-orchestrator/" "$SKILL_MD" "must be a direct child of \`docs/superpowers-orchestrator/\`"
assert_file_contains "TOPIC_DIR validation drift check: SKILL.md still requires git check-ignore -q to fail" "$SKILL_MD" "\`git check-ignore -q <log path>\` must **fail**"

bold "recovery greps stay intact"

# The batch controller finds task ticks with `git log --grep "task <n> complete"`
# and fix commits with the `review fixes (<slug>, round <i>)` subject. A
# pipeline-mode log commit must match neither.
#
# Both greps run against commits that REALLY EXIST in this throwaway
# repository: the three `chore(review): bar round <i> log` commits created
# above, plus one genuine tick commit and one genuine fix commit created here.
# Each grep therefore has a match it must find AND log commits it must not
# find, so a pipeline-mode subject that started colliding with either recovery
# pattern would fail this gate. (Matching a shell variable against a literal
# with `case` could never fail — both sides are written in this same file.)
echo "tick" > tick.txt
git add tick.txt && git commit --quiet -m "chore(plan): bar task 1 complete"
TICK_SHA=$(git rev-parse --short HEAD)
echo "fix" > fix.txt
git add fix.txt && git commit --quiet -m "review fixes (bar, round 1)"
FIX_SHA=$(git rev-parse --short HEAD)

# Control: each recovery grep finds its own commit. Without this the two
# "matches no review-log commit" assertions below would also pass if the grep
# matched nothing at all.
assert_eq "recovery grep: 'task 1 complete' finds exactly the tick commit" \
  "$(git log --grep 'task 1 complete' --format=%h | tr '\n' ' ' | sed 's/ *$//')" "$TICK_SHA"
assert_eq "recovery grep: 'review fixes (' finds exactly the fix commit" \
  "$(git log --grep 'review fixes (' --format=%h | tr '\n' ' ' | sed 's/ *$//')" "$FIX_SHA"

# The real assertions: neither recovery pattern matches a pipeline-mode
# `chore(review)` log commit.
assert_eq "recovery grep: 'task 1 complete' matches no review-log commit" \
  "$(git log --grep 'task 1 complete' --format=%s | grep -c 'chore(review)' | tr -d ' ')" "0"
assert_eq "recovery grep: 'review fixes (' matches no review-log commit" \
  "$(git log --grep 'review fixes (' --format=%s | grep -c 'chore(review)' | tr -d ' ')" "0"

bold "archive naming with a dateless plan basename"

# `sdd-workspace` names the archive folder from the OUTGOING plan's basename
# minus its extension (script line ~112, `slug=$(basename -- "$current")`).
# Archiving fires only when the plan identity changes, so the check switches
# from one plan to another. Under the new layout the plan basename carries no
# date prefix (`plans/<slug>.md` instead of `plans/<date>-<slug>.md`), so the
# archive folder is named `<slug>`. The rule is unchanged; this asserts the
# result, which the spec's testing strategy requires.
#
# Register a known outgoing plan explicitly, rather than relying on the
# state the "symlinked plan path" block above happens to leave behind: that
# block SKIPs on a filesystem without symlink support (e.g. Windows Git Bash
# without developer mode, a platform this repository claims to support),
# in which case no plan.ref exists here and the first switch below would
# report no prior workspace at all instead of an archive slug.
mkdir -p docs/superpowers-orchestrator/2026-08-25-prev/plans
echo "# plan" > docs/superpowers-orchestrator/2026-08-25-prev/plans/prev.md
"$SCRIPTS/sdd-workspace" docs/superpowers-orchestrator/2026-08-25-prev/plans/prev.md > /dev/null 2>/dev/null

mkdir -p docs/superpowers-orchestrator/2026-08-25-baz/plans
mkdir -p docs/superpowers-orchestrator/2026-08-25-qux/plans
echo "# plan" > docs/superpowers-orchestrator/2026-08-25-baz/plans/baz.md
echo "# plan" > docs/superpowers-orchestrator/2026-08-25-qux/plans/qux.md
"$SCRIPTS/sdd-workspace" docs/superpowers-orchestrator/2026-08-25-baz/plans/baz.md > /dev/null 2>"$ERRF"
assert_stderr_one "archive naming: switching to baz reports the prior plan's archive slug" "archived previous workspace to archive/prev"
echo "leftover" > "$WS/task-1-notes.md"
"$SCRIPTS/sdd-workspace" docs/superpowers-orchestrator/2026-08-25-qux/plans/qux.md > /dev/null 2>"$ERRF"
assert_stderr_one "archive naming: switching to qux reports baz's archive slug" "archived previous workspace to archive/baz"
if [ -d "$WS/archive/baz" ]; then
  ok "archive naming: dateless plan basename yields archive/baz"
else
  bad "archive naming: expected $WS/archive/baz, found: $(ls "$WS/archive" 2>/dev/null | tr '\n' ' ')"
fi

bold "review-package ignores configured diff helper programs"

# Worklist row 54. A repository can configure two kinds of helper program for
# a diff. A textconv filter turns a file into text before git compares it. An
# external diff driver replaces git's own comparison. Both print whatever the
# helper prints, so a package built through them would show a reviewer text
# that is not in the repository. This fixture configures both kinds and
# requires the package to hold the real lines and none of the helper's output.
HELPER_REPO=$(mktemp -d)
: "${HELPER_REPO:?mktemp failed — refusing to run with an empty repo path}"
HELPER_REPO=$(cd "$HELPER_REPO" && pwd -P)
trap 'rm -rf "$REPO" "$ERRF" "$HELPER_REPO"' EXIT
HELPER_OUTPUT="FABRICATED-BY-HELPER"
cd "$HELPER_REPO"
git init --quiet
git config user.email "test@test"
git config user.name "test"
# *.conv goes through a textconv filter, *.ext through a per-attribute
# external driver, and diff.external covers every other file.
printf '*.conv diff=convhelper\n*.ext diff=exthelper\n' > .gitattributes
echo "base" > base.txt
echo "old-conv-line" > m.conv
git add .gitattributes base.txt m.conv && git commit --quiet -m "base commit"
HELPER_BASE=$(git rev-parse HEAD)
echo "real-conv-line" > a.conv
echo "real-ext-line" > b.ext
# A modified file is the stronger case: a textconv filter turns both sides into
# the same helper text, so the change disappears from the diff completely.
echo "new-conv-line" > m.conv
echo "real-plain-line" > c.txt
git add a.conv b.ext c.txt m.conv && git commit --quiet -m "task: add three files, modify one"
HELPER_HEAD=$(git rev-parse HEAD)
git config diff.convhelper.textconv "echo $HELPER_OUTPUT #"
git config diff.exthelper.command "echo $HELPER_OUTPUT #"
git config diff.external "echo $HELPER_OUTPUT #"

assert_package_is_real() { # mode-label package-file
  local real
  assert_file_not_contains "$1: no helper output in the package" "$2" "$HELPER_OUTPUT"
  for real in "+real-conv-line" "+real-ext-line" "+real-plain-line" "-old-conv-line" "+new-conv-line"; do
    assert_file_contains "$1: package holds $real" "$2" "$real"
  done
}

"$SCRIPTS/review-package" "$HELPER_BASE" "$HELPER_HEAD" "$HELPER_REPO/range.diff" >/dev/null 2>&1
assert_package_is_real "helpers, range mode" "$HELPER_REPO/range.diff"
"$SCRIPTS/review-package" --commits "$HELPER_HEAD" --out "$HELPER_REPO/commits.diff" >/dev/null 2>&1
assert_package_is_real "helpers, --commits mode" "$HELPER_REPO/commits.diff"
cd "$REPO"
# `--stat` runs no helper program on git 2.50.1, so no fixture can show that a
# `--stat` read lost the options. The rule is one spelling on every read, so
# this check reads the script: each `git diff` or `git show` command line
# carries the options array.
PACKAGE_READS=$(grep -cE '^ *git (diff|show) ' "$SCRIPTS/review-package")
PACKAGE_READS_GUARDED=$(grep -cE '^ *git (diff|show) "\$\{no_helpers\[@\]\}" ' "$SCRIPTS/review-package")
assert_eq "review-package: every diff or show read carries the options array" "$PACKAGE_READS_GUARDED" "$PACKAGE_READS"
assert_eq "review-package: four diff or show reads" "$PACKAGE_READS" "4"

bold "parallel-wave commit rules (implementer-prompt.md, SKILL.md)"

# Item 17 of the 2026-10-06 design record. The implementers of a parallel wave
# share one working tree and one git index. The implementer template holds
# commit rules that apply only in a wave: commit with `git add -- <files>`,
# then with the task's own commit command ending with ` -- <files>`. Each
# sentence of those rules is pinned below, and next to it a scratch repository
# runs the git commands that the sentence prescribes. A change to the command
# shape or to a quoted git message therefore fails here.
SDD_DIR="$(dirname "$SCRIPTS")"
IMPLEMENTER_PROMPT_MD="$SDD_DIR/implementer-prompt.md"
SDD_SKILL_MD="$SDD_DIR/SKILL.md"
WAVE_DIR=$(mktemp -d)
: "${WAVE_DIR:?mktemp failed — refusing to run with an empty folder path}"
WAVE_DIR=$(cd "$WAVE_DIR" && pwd -P)
trap 'rm -rf "$REPO" "$ERRF" "$HELPER_REPO" "$WAVE_DIR"' EXIT

# The line that the controller writes into the Context, and the label of the
# rules that the line turns on. Both files must spell them the same way.
WAVE_LINE='`You run in a parallel wave.`'
WAVE_LABEL='Parallel wave only'
# Messages that git prints (in English: the suite guard sets LC_MESSAGES=C).
# The rules quote them; the git checks below prove that git prints them.
GIT_NO_MATCH='did not match any files'
GIT_NOTHING_TO_COMMIT='nothing to commit'
GIT_NO_CHANGES_ADDED='no changes added to commit'
GIT_NOTHING_ADDED='nothing added to commit'
GIT_LOCK_EXISTS='File exists'

# The section of the implementer template that holds the commit command shape
# and, after it, the wave rules. A fix dispatch of a wave task carries a copy
# of this whole section (SKILL.md, Constructing Reviewer Prompts).
COMMIT_SECTION_NAME='Commit Messages'
COMMIT_LEAD='Every commit you create carries the workstream trailers. If the task'"'"'s own commit step already specifies a command with `Session:` and `Stage:` trailers, use it verbatim; otherwise use this shape:'
COMMIT_SHAPE='git commit -m "<type>(<scope>): <what changed>" --trailer "Session: [SLUG]" --trailer "Stage: task N/[TASK_TOTAL]"'
# Each sentence of the rules, in the order of the text. The checks next to
# the git commands below pin them one by one. The whole-section check pins
# their order and that the section holds nothing else.
WAVE_RULE_TRIGGER="**$WAVE_LABEL.** Follow these rules only when your Context holds the line $WAVE_LINE"
WAVE_RULE_REASON='In a parallel wave, other agents share this working tree and its git index, so a bare `git commit` can commit files that they staged.'
WAVE_RULE_COMMANDS='Commit with two commands: first `git add -- <files>`, then the task'"'"'s own `git commit` command from above, with its message and trailers unchanged, ending with ` -- <files>`.'
WAVE_RULE_FILES='`<files>` names each file that this task created, changed or deleted, one by one. It is never empty, never a folder, a glob or `.`.'
WAVE_RULE_FILES_SOURCE='Build it from your own Edit, Write, `rm` and `mv` calls.'
WAVE_RULE_FILES_PROGRAM='Also list each file that a program you ran created, changed or deleted, for example a package installer, a code generator or a formatter. Find these files in the program'"'"'s output or in the files that the program is known to write. Confirm each one with `git status --porcelain -- <path>`; if it prints nothing, the file has no change, so leave it out.'
WAVE_RULE_FILES_NOT_TREE='Never add a path only because `git status`, `git diff` or `git diff --cached` on the whole tree lists it: in a wave, these commands also show the files of other agents.'
WAVE_RULE_FILES_EXISTING='List only a path that existed when the task started or that exists now; a path that the task created and later removed with `rm` or `mv` is not listed.'
WAVE_RULE_FORMATTER='Run a formatter or a code generator only on the files of this task. In a wave, a run on the whole tree also rewrites the files of other agents.'
WAVE_RULE_RENAME='Delete or rename a file with plain `rm` or `mv`, never with `git rm` or `git mv`. For a rename, list both the old path and the new path.'
WAVE_RULE_REPAIR="If \`git add\` says that a path $GIT_NO_MATCH, drop that path from \`git add\` only and keep it after \`--\`."
WAVE_RULE_NEVER_RUN='Never run `git add -A`, `git add .`, `git commit -a`, `git commit --amend`, `git stash` or `git reset`: each of them can take, change or remove the work of another agent. Run `git checkout` or `git restore` only on paths in `<files>`.'
WAVE_RULE_NO_COMMIT="If git makes no commit (it prints \"$GIT_NOTHING_TO_COMMIT\", \"$GIT_NO_CHANGES_ADDED\" or \"$GIT_NOTHING_ADDED\"), report no commit SHA; never report the current HEAD."
WAVE_RULE_LOCK="If git says it is unable to create \`index.lock\` (\"$GIT_LOCK_EXISTS\"), wait about ten seconds and run the same command again. Repeat this for at most two minutes in total. If the lock is still there after two minutes, stop and report BLOCKED with the git message. Never delete \`.git/index.lock\`."

# The rules must stand in the "Commit Messages" section, inside the fenced
# prompt, so that they reach the implementer. Every wording check of the
# rules reads this extract, not the whole file.
WAVE_COMMIT_SECTION="$WAVE_DIR/commit-section.txt"
awk -v name="$COMMIT_SECTION_NAME" '/^    ## Code Organization$/ { f = 0 } $0 == "    ## " name { f = 1 } f' "$IMPLEMENTER_PROMPT_MD" > "$WAVE_COMMIT_SECTION"
assert_folded_contains "wave rules: labelled, and followed only when the Context holds the wave line" \
  "$WAVE_COMMIT_SECTION" "$WAVE_RULE_TRIGGER"
# The whole section (blank lines left out) is the commit command shape and
# these rules, in this order, and nothing else. An added line that
# contradicts a rule, in the rules or before them, therefore fails here.
WAVE_SECTION_LINES="$WAVE_DIR/commit-section-lines.txt"
awk 'NF' "$WAVE_COMMIT_SECTION" > "$WAVE_SECTION_LINES"
assert_eq "wave rules: the whole \"$COMMIT_SECTION_NAME\" section is the commit command shape and exactly these rules in this order" "$(fold_file "$WAVE_SECTION_LINES")" \
  "## $COMMIT_SECTION_NAME $COMMIT_LEAD $COMMIT_SHAPE $WAVE_RULE_TRIGGER $WAVE_RULE_REASON $WAVE_RULE_COMMANDS - $WAVE_RULE_FILES $WAVE_RULE_FILES_SOURCE $WAVE_RULE_FILES_PROGRAM $WAVE_RULE_FILES_NOT_TREE $WAVE_RULE_FILES_EXISTING - $WAVE_RULE_FORMATTER - $WAVE_RULE_RENAME $WAVE_RULE_REPAIR - $WAVE_RULE_NEVER_RUN - $WAVE_RULE_NO_COMMIT - $WAVE_RULE_LOCK"
# Each "phrase|count" argument: the phrase occurs exactly count times in the
# folded file (a phrase that the text wraps across a line break counts too).
assert_phrase_counts() { # label file phrase|count...
  local label="$1" folded counted phrase
  folded=$(fold_file "$2")
  shift 2
  for counted in "$@"; do
    phrase="${counted%|*}"
    assert_eq "$label: '$phrase' occurs exactly ${counted##*|} time(s)" \
      "$(printf '%s\n' "$folded" | grep -oF -- "$phrase" | wc -l | tr -d ' ')" "${counted##*|}"
  done
}
# Outside the wave rules, the whole implementer template names none of the
# commands that the rules forbid and does not tell anyone to report the
# current HEAD. Each phrase below occurs exactly this number of times in the
# template, all inside the wave rules. A line added anywhere else in the
# template (for example "commit with `git commit -a`" in "Your Job")
# therefore fails here.
assert_phrase_counts "implementer template" "$IMPLEMENTER_PROMPT_MD" \
  'git add -A|1' 'git commit -a|1' 'git commit --amend|1' 'git stash|1' 'git reset|1' \
  'git checkout|1' 'git restore|1' 'git status|2' 'git diff|2' 'whole tree|2' 'formatter|2' \
  'current HEAD|1' 'index.lock|2'
# In the whole SKILL.md, the plan tick and its commit are named only in
# "Mark task complete", and the wave line only in Parallel Waves step 2 and
# in the fix dispatch rule. A line added elsewhere that commits the tick
# with no path list, or that withholds the wave line, therefore fails here.
assert_phrase_counts "SKILL.md" "$SDD_SKILL_MD" \
  'git commit|1' 'chore(plan)|1' 'tick|1' "${WAVE_LINE//\`/}|2"
# The rules change "the task's own git commit command from above", so they
# follow the commit command shape of the section directly, after one blank
# line.
COMMIT_SHAPE_LINE_NO=$(grep -nF -- "$COMMIT_SHAPE" "$WAVE_COMMIT_SECTION" | head -1 | cut -d: -f1)
WAVE_LABEL_LINE_NO=$(grep -nF "**$WAVE_LABEL.**" "$WAVE_COMMIT_SECTION" | head -1 | cut -d: -f1)
if [ -n "$COMMIT_SHAPE_LINE_NO" ] && [ -n "$WAVE_LABEL_LINE_NO" ] && [ "$WAVE_LABEL_LINE_NO" -eq $((COMMIT_SHAPE_LINE_NO + 2)) ]; then
  ok "wave rules: follow the commit command shape directly"
else
  bad "wave rules: follow the commit command shape directly (shape line '$COMMIT_SHAPE_LINE_NO', label line '$WAVE_LABEL_LINE_NO')"
fi

# SKILL.md, Parallel Waves step 2 writes the line; step 3 and the fix dispatch
# rule give a fix subagent of a wave task the same line and the same rules.
# Each check compares the whole step or the whole bullet, so that an added
# sentence that contradicts the rule fails here.
WAVE_STEP1='1. Build a wave of independent tasks.'
WAVE_STEP2_TEXT="2. Dispatch all implementers in a **single message** with multiple parallel Agent tool calls. Do not stagger across multiple messages. Write the line $WAVE_LINE into each implementer's Context: the implementers of a wave share one working tree and one git index, and the line turns on the \"$WAVE_LABEL\" commit rules of \`./implementer-prompt.md\`."
WAVE_STEP3_TEXT="3. Review each task with the single task-review gate. Build each task's package with \`scripts/review-package --commits <that task's reported commit SHAs>\` — NEVER a BASE..HEAD range in a wave: commits interleave, so a range would mix sibling tasks' changes into the review. If an implementer's report omits its commit SHAs, ask that implementer for them before reviewing. A fix subagent for a wave task gets the same Context line and the same commit rules (see Constructing Reviewer Prompts)."
WAVE_STEP4='4. Run integration verification after the wave completes.'
WAVE_STEP5='5. Update all completed task checkboxes in plan.md (`- [ ]` → `- [x]`) and sync state.md if present.'
WAVE_STEP6='6. Proceed to the next wave.'
WAVE_STEP2=$(grep -E '^2\. Dispatch all implementers in a \*\*single message\*\*' "$SDD_SKILL_MD")
assert_eq "SKILL.md Parallel Waves step 2: writes the wave line into each implementer's Context" "$WAVE_STEP2" "$WAVE_STEP2_TEXT"
WAVE_STEP3=$(grep -E '^3\. Review each task with the single task-review gate\.' "$SDD_SKILL_MD")
assert_eq "SKILL.md Parallel Waves step 3: a fix subagent for a wave task gets the same line and rules" "$WAVE_STEP3" "$WAVE_STEP3_TEXT"
# The whole list of Parallel Waves (steps 1 to 6, blank lines left out) is
# these six steps and nothing else, so that a sentence added to any step
# (for example "do not give a fix subagent the wave line") fails here.
WAVE_STEPS="$WAVE_DIR/wave-steps.txt"
awk '/^If any overlap or shared-state risk exists within a wave/ { exit } /^1\. Build a wave of independent tasks\.$/ { f = 1 } f && NF' "$SDD_SKILL_MD" > "$WAVE_STEPS"
assert_eq "SKILL.md Parallel Waves: the whole list is exactly steps 1 to 6" "$(fold_file "$WAVE_STEPS")" \
  "$WAVE_STEP1 $WAVE_STEP2_TEXT $WAVE_STEP3_TEXT $WAVE_STEP4 $WAVE_STEP5 $WAVE_STEP6"
# The fix dispatch rule is the last bullet of "Constructing Reviewer
# Prompts": everything from its first line to the heading
# "## Durable Progress" (blank lines left out) is this bullet and nothing
# else. A bullet or a sentence added after it therefore fails here.
FIX_DISPATCH_BULLET="$WAVE_DIR/fix-dispatch-bullet.txt"
awk '/^## Durable Progress$/ { exit } /^- Every fix dispatch carries the implementer contract/ { f = 1 } f && NF' "$SDD_SKILL_MD" > "$FIX_DISPATCH_BULLET"
assert_eq "SKILL.md fix dispatch rule: the last bullet before '## Durable Progress'; a wave task's fix dispatch carries the line and a copy of the whole \"$COMMIT_SECTION_NAME\" section" "$(fold_file "$FIX_DISPATCH_BULLET")" \
  "- Every fix dispatch carries the implementer contract: the fix subagent re-runs the tests covering its change, appends results to the report file, and the re-review is dispatched only once the report shows the covering tests, the command run, and the output. A fix dispatch for a task of a parallel wave also carries the line $WAVE_LINE and a copy of the whole \"$COMMIT_SECTION_NAME\" section of \`./implementer-prompt.md\`, filled in for that task. The \"$WAVE_LABEL\" rules in that section use the commit command shape that stands above them, so the copy holds both."
# The controller's plan tick (Core Flow, "Mark task complete") ends its
# `git commit` command with `-- <plan file>`. The git check further below
# runs that commit while a fix subagent of a wave has a staged file.
PLAN_TICK_LINE=$(grep -E '^- Mark task complete: ' "$SDD_SKILL_MD")
assert_eq "SKILL.md Mark task complete: the tick commit ends with '-- <plan file>'" "$PLAN_TICK_LINE" \
  '- Mark task complete: update the task'"'"'s checkbox in plan.md from `- [ ]` to `- [x]`, append the ledger line (see Durable Progress), commit the tick as `chore(plan): <slug> task <n> complete` (`<slug>` = plan basename with the `YYYY-MM-DD-` prefix and `.md` stripped), staging the plan file by explicit path and ending the `git commit` command with `-- <plan file>` (without that path list, the commit also takes files that a subagent of a running wave has staged), and sync `state.md` if it has a plan status section.'

WAVE_REPO="$WAVE_DIR/repo"
mkdir "$WAVE_REPO"
cd "$WAVE_REPO"
git init --quiet
git config user.email "test@test"
git config user.name "test"
echo "base" > base.txt
echo "renamed later" > old-name.txt
git add base.txt old-name.txt && git commit --quiet -m "wave base"
# The task's own commit command: the shape of the "Commit Messages" section,
# with its message and trailers, ending with ` -- <files>`.
WAVE_TRAILERS=(--trailer "Session: wave" --trailer "Stage: task 1/2")
wave_commit() { # subject file...
  git commit --quiet -m "$1" "${WAVE_TRAILERS[@]}" -- "${@:2}"
}
head_change() { git show -M --name-status --format= HEAD | tr '\t' ' '; }

# The reason: a bare `git commit` takes a sibling's staged file too.
echo "control sibling" > control-sibling.txt
git add control-sibling.txt
echo "control task" > control-task.txt
git add control-task.txt
git commit --quiet -m "control: bare commit"
assert_eq "wave rules control: a bare git commit also takes the sibling's staged file" \
  "$(git show --name-only --format= HEAD | sort | tr '\n' ' ')" "control-sibling.txt control-task.txt "
assert_folded_contains "wave rules: name the shared index as the reason" "$WAVE_COMMIT_SECTION" "$WAVE_RULE_REASON"

# The two commands: with a sibling's staged file, the task commit holds only
# the task's own file, the sibling's file stays staged, and the trailers that
# stand before ` -- <files>` are in the commit.
echo "sibling work" > sibling.txt
git add sibling.txt
echo "task work" > task.txt
# A list built from `git status` (or `git diff`) on the whole tree also names
# the sibling's file, so the rules build `<files>` from the task's own calls.
assert_eq "wave rules control: a list built from git status also names the sibling's file" \
  "$(git status --porcelain | cut -c4- | sort | tr '\n' ' ')" "sibling.txt task.txt "
assert_folded_contains "wave rules: build <files> from your own Edit, Write, rm and mv calls" \
  "$WAVE_COMMIT_SECTION" "$WAVE_RULE_FILES_SOURCE"
assert_folded_contains "wave rules: never add a path only because git status or git diff on the whole tree lists it" \
  "$WAVE_COMMIT_SECTION" "$WAVE_RULE_FILES_NOT_TREE"
wave_commit "feat(wave): task file" task.txt >/dev/null 2>&1
RC=$?
assert_eq "wave rules control: without git add first, the path-form commit of a new file fails" "$RC" "1"
git add -- task.txt
wave_commit "feat(wave): task file" task.txt
assert_eq "wave rules: the path-form commit holds only the task's own file" "$(head_change)" "A task.txt"
assert_eq "wave rules: the sibling's file stays staged" "$(git diff --cached --name-only)" "sibling.txt"
assert_eq "wave rules: the trailers before ' -- <files>' are in the commit" \
  "$(git log -1 --format='%(trailers:only,unfold)' | sed '/^$/d' | tr '\n' '|')" "Session: wave|Stage: task 1/2|"
assert_folded_contains "wave rules: git add -- <files>, then the task's own commit command ending with ' -- <files>'" "$WAVE_COMMIT_SECTION" "$WAVE_RULE_COMMANDS"
assert_folded_contains "wave rules: <files> names each file one by one; never empty, a folder, a glob or '.'" "$WAVE_COMMIT_SECTION" "$WAVE_RULE_FILES"
wave_commit "sibling commits its own file" sibling.txt
# `git commit --amend` after a sibling's commit replaces that commit: the
# commit SHA that the sibling reports is no longer on the branch.
SIBLING_SHA=$(git rev-parse HEAD)
echo "more task work" >> task.txt
git add -- task.txt
git commit --quiet --amend --no-edit -- task.txt
git merge-base --is-ancestor "$SIBLING_SHA" HEAD
RC=$?
assert_eq "wave rules control: git commit --amend after a sibling's commit removes that commit from the branch" "$RC" "1"
assert_folded_contains "wave rules: never git add -A, git add ., git commit -a, git commit --amend, git stash or git reset; git checkout or git restore only on paths in <files>" \
  "$WAVE_COMMIT_SECTION" "$WAVE_RULE_NEVER_RUN"

# A rename with plain `mv` and both paths listed is one rename commit (R100).
mv old-name.txt new-name.txt
git add -- old-name.txt new-name.txt
wave_commit "refactor(wave): rename with plain mv" old-name.txt new-name.txt
assert_eq "wave rules: plain mv with both paths listed gives one rename commit (R100)" "$(head_change)" "R100 old-name.txt new-name.txt"
assert_eq "wave rules: plain mv with both paths listed leaves nothing behind" "$(git status --porcelain)" ""
# Control: with only the new path listed, the commit makes no rename and the
# old path stays behind as a deletion.
mv new-name.txt only-new-listed.txt
git add -- only-new-listed.txt
wave_commit "control: only the new path listed" only-new-listed.txt
assert_eq "wave rules control: with only the new path listed, the commit only adds the new file" "$(head_change)" "A only-new-listed.txt"
assert_eq "wave rules control: with only the new path listed, the old path stays behind as a deletion" "$(git status --porcelain)" " D new-name.txt"
git add -- new-name.txt
wave_commit "control: commit the deletion left behind" new-name.txt
assert_folded_contains "wave rules: plain rm or mv, never git rm or git mv; a rename lists both paths" "$WAVE_COMMIT_SECTION" "$WAVE_RULE_RENAME"

# After `git mv`, `git add` of the old path fails. The repair drops the old
# path from `git add` only and keeps it after `--`: one rename commit (R100).
git mv only-new-listed.txt git-mv-name.txt
git add -- only-new-listed.txt git-mv-name.txt 2>"$ERRF"
RC=$?
assert_eq "wave rules control: after git mv, git add of the old path fails (exit 128)" "$RC" "128"
assert_stderr_one "wave rules control: git says that the old path $GIT_NO_MATCH" "$GIT_NO_MATCH"
git add -- git-mv-name.txt
wave_commit "refactor(wave): rename after git mv" only-new-listed.txt git-mv-name.txt
assert_eq "wave rules: after git mv, the old path dropped from git add only gives one rename commit (R100)" \
  "$(head_change)" "R100 only-new-listed.txt git-mv-name.txt"
assert_folded_contains "wave rules: on 'did not match', drop the path from git add only and keep it after --" "$WAVE_COMMIT_SECTION" "$WAVE_RULE_REPAIR"

# A path that the task created and later removed with `rm` is not known to
# git. Kept after `--`, it makes the commit fail; left out, as the rules
# say, the commit holds the files that exist.
echo "created and then removed" > created-then-removed.txt
echo "kept" > kept.txt
rm created-then-removed.txt
git add -- kept.txt
wave_commit "control: a removed new path kept after --" kept.txt created-then-removed.txt 2>"$ERRF"
RC=$?
assert_eq "wave rules control: a path created and removed inside the task, kept after --, makes the commit fail (exit 1)" "$RC" "1"
assert_stderr_one "wave rules control: git says that the removed new path did not match" "pathspec 'created-then-removed.txt' did not match"
wave_commit "feat(wave): a removed new path left out" kept.txt
assert_eq "wave rules: with the removed new path left out, the commit holds the existing file" "$(head_change)" "A kept.txt"
assert_folded_contains "wave rules: list only a path that existed when the task started or that exists now" \
  "$WAVE_COMMIT_SECTION" "$WAVE_RULE_FILES_EXISTING"

# A program that the task runs (here a stand-in for a package installer)
# rewrites the manifest and the lock file. `git status --porcelain -- <path>`
# confirms each file that the program is known to write: it prints a line for
# a changed file and nothing for an unchanged one. The task commit then holds
# the program's files with the task's own file, and a sibling's new file is
# still not in it.
printf '{"deps":{}}\n' > package.json
printf '{"lock":{}}\n' > package-lock.json
printf '{"lint":{}}\n' > lint-config.json
git add -- package.json package-lock.json lint-config.json
wave_commit "setup: package files" package.json package-lock.json lint-config.json
echo "sibling program work" > sibling-program.txt
echo 'require("x")' > feature.js
printf '{"deps":{"x":"1.0"}}\n' > package.json
printf '{"lock":{"x":"1.0.0"}}\n' > package-lock.json
assert_eq "wave rules control: git status --porcelain -- <path> prints a line for each file that the program changed" \
  "$(git status --porcelain -- package.json package-lock.json | tr '\n' '|')" " M package-lock.json| M package.json|"
assert_eq "wave rules control: git status --porcelain -- <path> prints nothing for a file that the program did not change" \
  "$(git status --porcelain -- lint-config.json)" ""
git add -- feature.js package.json package-lock.json
wave_commit "feat(wave): use library x" feature.js package.json package-lock.json
assert_eq "wave rules: the task commit holds the files that the program changed and the task's own file" \
  "$(head_change | sort | tr '\n' '|')" "A feature.js|M package-lock.json|M package.json|"
assert_eq "wave rules: the sibling's new file is still not in the task commit" \
  "$(git status --porcelain)" "?? sibling-program.txt"
assert_folded_contains "wave rules: also list each file that a program you ran created, changed or deleted; confirm each one with git status --porcelain -- <path>" \
  "$WAVE_COMMIT_SECTION" "$WAVE_RULE_FILES_PROGRAM"
assert_folded_contains "wave rules: run a formatter or a code generator only on the files of this task" \
  "$WAVE_COMMIT_SECTION" "$WAVE_RULE_FORMATTER"
rm sibling-program.txt

# The controller's plan tick: the plan file staged by explicit path and the
# commit ending with `-- <plan file>`. A file that a fix subagent of a
# running wave has staged stays staged and goes into the fix commit.
printf -- '- [ ] task 1\n' > plan.md
git add -- plan.md && wave_commit "plan" plan.md
echo "fix work" > fix-staged.txt
git add -- fix-staged.txt
printf -- '- [x] task 1\n' > plan.md
git add -- plan.md
git commit --quiet -m "chore(plan): wave task 1 complete" -- plan.md
assert_eq "plan tick: the commit ending with '-- <plan file>' holds only the plan file" "$(head_change)" "M plan.md"
assert_eq "plan tick: the file staged by the fix subagent stays staged" "$(git diff --cached --name-only)" "fix-staged.txt"
wave_commit "fix(wave): fix subagent file" fix-staged.txt
assert_eq "plan tick: the fix subagent's own commit holds its file" "$(head_change)" "A fix-staged.txt"

# A task with no change: the commit exits 1, makes no commit and takes
# nothing. Git words its refusal in three ways, by the state of the index and
# of the working tree, and the rules quote all three.
assert_no_change_commit() { # desc expected-git-message
  local head_before staged_before out rc
  head_before=$(git rev-parse HEAD)
  staged_before=$(git diff --cached --name-only)
  git add -- base.txt
  out=$(wave_commit "feat(wave): no change" base.txt 2>&1)
  rc=$?
  assert_eq "$1: the commit exits 1" "$rc" "1"
  assert_eq "$1: no commit is made" "$(git rev-parse HEAD)" "$head_before"
  assert_eq "$1: the staged files do not change" "$(git diff --cached --name-only)" "$staged_before"
  assert_contains "$1: git prints \"$2\"" "$out" "$2"
}
echo "sibling new file" > sibling-new.txt
git add sibling-new.txt
assert_no_change_commit "wave rules, no change, a sibling's new file staged" "$GIT_NOTHING_ADDED"
wave_commit "sibling commits its new file" sibling-new.txt
echo "sibling change" >> task.txt
git add task.txt
assert_no_change_commit "wave rules, no change, a sibling's change to a tracked file staged" "$GIT_NO_CHANGES_ADDED"
wave_commit "sibling commits its change" task.txt
assert_no_change_commit "wave rules, no change, clean working tree" "$GIT_NOTHING_TO_COMMIT"
assert_folded_contains "wave rules: when git makes no commit, report no commit SHA and never the current HEAD" "$WAVE_COMMIT_SECTION" "$WAVE_RULE_NO_COMMIT"

# A held index lock: git refuses and names the lock file. This check runs
# last and leaves the lock file in place; the EXIT trap removes the folder.
: > .git/index.lock
echo "changed while the index is locked" >> base.txt
LOCK_OUT=$(git add -- base.txt 2>&1)
RC=$?
assert_eq "wave rules control: git add fails (exit 128) while .git/index.lock exists" "$RC" "128"
assert_contains "wave rules control: git says it is unable to create index.lock (\"$GIT_LOCK_EXISTS\")" "$LOCK_OUT" "index.lock': $GIT_LOCK_EXISTS."
assert_folded_contains "wave rules: on a held index.lock, wait about ten seconds and run the same command again for at most two minutes, then report BLOCKED; never delete the lock" "$WAVE_COMMIT_SECTION" "$WAVE_RULE_LOCK"
cd "$REPO"

# ── The security review of Core Flow step 3 ──────────────────────────────
# The plan template's flag line "**Security flag:** `security`" promised a
# security review before the implementer is dispatched, and no skill defined
# it. Core Flow step 3 of the SDD skill now defines it: the pins below hold
# its trigger (a brief line that STARTS with the flag line, so that a quoted
# sentence elsewhere in the task does not count), its place between the
# task-brief step and the implementer dispatch, its report file, its
# plan-conflict rule, and the Parallel Waves sentence.
bold ""
bold "SDD SKILL.md: the security review of Core Flow step 3"
STEP3_TEXT="$WAVE_DIR/core-flow-step-3.txt"
awk '/^4\. Run the final whole-branch review loop\./ { exit } /^3\. For each task:$/ { f = 1 } f && NF' "$SDD_SKILL_MD" > "$STEP3_TEXT"
SECURITY_FLAG_LINE='**Security flag:** `security`'
assert_folded_contains "SKILL.md step 3: the trigger is a brief line that STARTS with the flag line, and the reviewer runs before the implementer" "$STEP3_TEXT" \
  "- Security review, when a line of the brief STARTS with \`\`$SECURITY_FLAG_LINE \`\` (the flag line of the plan template; a quoted sentence elsewhere in the task does not count): before the implementer, dispatch one reviewer that changes no file"
assert_folded_contains "SKILL.md step 3: the review stands after the task-brief step" "$STEP3_TEXT" \
  '- Run `scripts/task-brief PLAN_FILE N`. - Security review, when'
assert_folded_contains "SKILL.md step 3: the implementer dispatch stands after the review" "$STEP3_TEXT" \
  'You never lower its severity. - Then dispatch the implementer (`./implementer-prompt.md`) with the brief path'
assert_folded_contains "SKILL.md step 3: the report file is task-N-security-review.md beside the brief, written again at every first implementer dispatch" "$STEP3_TEXT" \
  'It writes its report to `task-N-security-review.md` beside the brief (written again at every first implementer dispatch of the task; a fix dispatch runs no review)'
assert_folded_contains "SKILL.md step 3: a plan-bound finding follows the plan-conflict rule of Constructing Reviewer Prompts and keeps its severity" "$STEP3_TEXT" \
  'follows the plan-conflict rule of Constructing Reviewer Prompts (interactive: ask the user which governs; Batched Autonomous Mode: journal it and end the batch). You never lower its severity.'
assert_folded_contains "SKILL.md Parallel Waves: a flagged task gets the review before the wave's implementers are dispatched" "$SDD_SKILL_MD" \
  'A task of the wave that carries the security flag gets the security review of Core Flow step 3 before the wave'"'"'s implementers are dispatched; your resolutions of its findings go into that implementer'"'"'s dispatch, as in the sequential flow.'
assert_folded_contains "SKILL.md Batched Autonomous Mode: the review gate points to the security review of Core Flow step 3" "$SDD_SKILL_MD" \
  'and the security review of Core Flow step 3 for `security`-flagged tasks'

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
