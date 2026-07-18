# SDD Token Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port upstream v6.0.0's token-saving SDD review rework (merged task reviewer, file handoffs via workspace scripts, mandatory explicit models, narration rule) into this fork without losing fork features.
**Architecture:** Three bash scripts create a git-ignored workspace (`.superpowers/sdd/`) and generate task briefs and review packages as files; a single `task-reviewer-prompt.md` replaces the two per-task reviewer prompts; `SKILL.md` is edited section-by-section to route all handoffs through files and require explicit models; `writing-plans` gains a Global Constraints block. Spec: `docs/specs/2026-07-18-sdd-token-optimization-design.md`.
**Tech Stack:** Bash (3.2-compatible, Git Bash-safe), awk (BSD-compatible), git, Markdown skill files.
**Assumptions:** Assumes sessions execute skill scripts via the Bash tool (Git Bash on Windows) — will NOT work in an environment without bash/git/awk. Assumes plans use `Task N` headings (any `#` depth) — `task-brief` will NOT extract tasks from plans with other heading conventions.

**Global Constraints (bind every task):**
- Bash scripts must run on macOS bash 3.2 and Windows Git Bash: no `/dev/stdin`, no bash-4+ features (no negative array indices, no `readarray`), no GNU-only awk/sed flags.
- Scripts are committed executable (`chmod +x` before `git add`).
- Workspace path is exactly `<repo-root>/.superpowers/sdd/`; ledger file is exactly `progress.md` inside it.
- The skill-leakage banner appears verbatim in every prompt template: "You are a focused subagent. Do NOT invoke any skills from the superpowers-optimized plugin. Do NOT use the Skill tool. Your only job is the task described below."
- The narration rule appears verbatim: "Narration: between tool calls, narrate at most one short line — the ledger and the tool results carry the record."
- In wave mode, review packages are built ONLY with `--commits` — never a BASE..HEAD range.
- Version everywhere is `6.8.0`: `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.universal.yaml` (`meta` → `version:`).
- Do NOT modify `hooks/skill-rules.json` or `skills/requesting-code-review/`.

---

## File Structure

- Create: `skills/subagent-driven-development/scripts/sdd-workspace` — resolve/create the workspace dir, print its path (single source of truth for location).
- Create: `skills/subagent-driven-development/scripts/task-brief` — extract one task's text from a plan into a brief file.
- Create: `skills/subagent-driven-development/scripts/review-package` — write commit list + stat + `-U10` diff to a package file (range mode and `--commits` wave mode).
- Create: `skills/subagent-driven-development/task-reviewer-prompt.md` — merged reviewer template (spec + quality verdicts).
- Create: `tests/sdd-scripts/run-tests.sh` — fast unit suite for the three scripts.
- Modify: `skills/subagent-driven-development/implementer-prompt.md` — brief-file input, report-file output, required model.
- Modify: `skills/subagent-driven-development/SKILL.md` — single review gate, file handoffs, new sections, model rules.
- Delete: `skills/subagent-driven-development/spec-reviewer-prompt.md`, `skills/subagent-driven-development/code-quality-reviewer-prompt.md`.
- Modify: `skills/writing-plans/SKILL.md` — Global Constraints block in the plan header.
- Modify: `tests/claude-code/test-subagent-driven-development.sh`, `tests/claude-code/test-subagent-driven-development-integration.sh`, `tests/claude-code/README.md` — merged-gate and brief-file assertions, doc sync.
- Modify: `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.universal.yaml`, `RELEASE-NOTES.md` — v6.8.0.

---

### Task 1: Script test harness + `sdd-workspace`

**Files:**
- Create: `tests/sdd-scripts/run-tests.sh`
- Create: `skills/subagent-driven-development/scripts/sdd-workspace`

**Security flag:** `none`

- [ ] **Step 1: Write the test harness with the sdd-workspace section (failing first)**

Create `tests/sdd-scripts/run-tests.sh` with exactly:

```bash
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
```

Then: `chmod +x tests/sdd-scripts/run-tests.sh`

- [ ] **Step 2: Run to verify failure**

Run: `bash tests/sdd-scripts/run-tests.sh`
Expected: FAIL / error — `sdd-workspace: No such file or directory`

- [ ] **Step 3: Implement `sdd-workspace`**

Create `skills/subagent-driven-development/scripts/sdd-workspace` with exactly:

```bash
#!/usr/bin/env bash
# Resolve and ensure the working-tree directory SDD uses for its short-lived
# artifacts: task briefs, implementer reports, review packages, and the
# progress ledger. Print the directory's absolute path.
#
# The workspace lives in the working tree (not under .git/) because agents
# cannot write into .git/ (protected path) — which would block an implementer
# subagent from writing its report file. A self-ignoring .gitignore keeps the
# workspace out of `git status` and out of accidental commits without
# modifying any tracked file.
#
# Single source of truth for the workspace location, so task-brief and
# review-package cannot drift to different directories.
#
# Usage: sdd-workspace
set -euo pipefail

root=$(git rev-parse --show-toplevel)
dir="$root/.superpowers/sdd"
mkdir -p "$dir"
printf '*\n' > "$dir/.gitignore"
cd "$dir" && pwd
```

Then: `chmod +x skills/subagent-driven-development/scripts/sdd-workspace`

- [ ] **Step 4: Run to verify pass**

Run: `bash tests/sdd-scripts/run-tests.sh`
Expected: PASS — 5 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
git add tests/sdd-scripts/run-tests.sh skills/subagent-driven-development/scripts/sdd-workspace
git commit -m "Add SDD workspace script and script test harness"
```

---

### Task 2: `task-brief` script

**Files:**
- Create: `skills/subagent-driven-development/scripts/task-brief`
- Modify: `tests/sdd-scripts/run-tests.sh`

**Security flag:** `none`

- [ ] **Step 1: Add failing tests**

In `tests/sdd-scripts/run-tests.sh`, insert immediately BEFORE the line `bold ""` (the results block):

`````bash
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
`````

- [ ] **Step 2: Run to verify failure**

Run: `bash tests/sdd-scripts/run-tests.sh`
Expected: FAIL — `task-brief: No such file or directory` (sdd-workspace section still passes)

- [ ] **Step 3: Implement `task-brief`**

Create `skills/subagent-driven-development/scripts/task-brief` with exactly:

```bash
#!/usr/bin/env bash
# Extract one task's full text from an implementation plan into a file the
# implementer reads in one call, so the task text never has to be pasted
# through the controller's context.
#
# Usage: task-brief PLAN_FILE TASK_NUMBER [OUTFILE]
# Default OUTFILE: <repo-root>/.superpowers/sdd/task-<N>-brief.md
# (per worktree; concurrent runs in the same working tree share it).
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: task-brief PLAN_FILE TASK_NUMBER [OUTFILE]" >&2
  exit 2
fi

plan=$1
n=$2
[ -f "$plan" ] || { echo "no such plan file: $plan" >&2; exit 2; }

if [ $# -eq 3 ]; then
  out=$3
else
  dir=$("$(cd "$(dirname "$0")" && pwd)/sdd-workspace")
  out="$dir/task-${n}-brief.md"
fi

awk -v n="$n" '
  # CommonMark fencing: a closing fence must be at least as long as its
  # opener, so a shorter fence nested inside a fenced block is content.
  /^```/ {
    match($0, /^`+/)
    if (!infence) { infence = 1; flen = RLENGTH }
    else if (RLENGTH >= flen) { infence = 0 }
  }
  !infence && /^#+[ \t]+Task[ \t]+[0-9]+/ {
    intask = ($0 ~ ("^#+[ \t]+Task[ \t]+" n "([^0-9]|$)"))
  }
  intask { print }
' "$plan" > "$out"

if [ ! -s "$out" ]; then
  echo "task ${n} not found in ${plan} (no heading matching 'Task ${n}')" >&2
  exit 3
fi

echo "wrote ${out}: $(wc -l < "$out" | tr -d ' ') lines"
```

Then: `chmod +x skills/subagent-driven-development/scripts/task-brief`

- [ ] **Step 4: Run to verify pass**

Run: `bash tests/sdd-scripts/run-tests.sh`
Expected: PASS — 15 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
git add skills/subagent-driven-development/scripts/task-brief tests/sdd-scripts/run-tests.sh
git commit -m "Add task-brief script: plan task text moves as a file"
```

---

### Task 3: `review-package` script (range + `--commits` modes)

**Files:**
- Create: `skills/subagent-driven-development/scripts/review-package`
- Modify: `tests/sdd-scripts/run-tests.sh`

**Security flag:** `none`

- [ ] **Step 1: Add failing tests**

In `tests/sdd-scripts/run-tests.sh`, insert immediately BEFORE the line `bold ""` (the results block):

```bash
bold "review-package (range mode)"

echo "base" > base.txt
git add base.txt && git commit --quiet -m "base commit"
BASE=$(git rev-parse HEAD)
echo "alpha" > alpha.txt
git add alpha.txt && git commit --quiet -m "task: add alpha"
echo "beta" > beta.txt
git add beta.txt && git commit --quiet -m "task: add beta"
HEAD_SHA=$(git rev-parse HEAD)

PKG=$("$SCRIPTS/review-package" "$BASE" "$HEAD_SHA" | sed 's/^wrote //; s/:.*$//')
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

CPKG=$("$SCRIPTS/review-package" --commits "$C1" "$C3" | sed 's/^wrote //; s/:.*$//')
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bash tests/sdd-scripts/run-tests.sh`
Expected: FAIL — `review-package: No such file or directory` (earlier sections still pass)

- [ ] **Step 3: Implement `review-package`**

Create `skills/subagent-driven-development/scripts/review-package` with exactly:

```bash
#!/usr/bin/env bash
# Generate a review package the reviewer reads in one call: commit list,
# stat summary, and the diff with extended context, written to a file.
#
# Range mode (sequential execution):
#   review-package BASE HEAD [OUTFILE]
#   Uses the recorded per-task BASE (never HEAD~1) so multi-commit tasks stay
#   intact. Default OUTFILE: <workspace>/review-<base7>..<head7>.diff
#   (named per range, so a re-review after fixes gets a distinct fresh file).
#
# Explicit-commit mode (wave execution — fork extension):
#   review-package --commits SHA [SHA...] [--out OUTFILE]
#   Builds the package from the implementer's reported commit SHAs, because
#   wave tasks commit interleaved on one branch and a BASE..HEAD range would
#   mix sibling tasks' changes into the review.
#   Default OUTFILE: <workspace>/review-commits-<first7>..<last7>.diff
set -euo pipefail

usage() {
  echo "usage: review-package BASE HEAD [OUTFILE]" >&2
  echo "       review-package --commits SHA [SHA...] [--out OUTFILE]" >&2
  exit 2
}

script_dir=$(cd "$(dirname "$0")" && pwd)

if [ "${1:-}" = "--commits" ]; then
  shift
  out=""
  commits=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) [ $# -ge 2 ] || usage; out=$2; shift 2 ;;
      *) commits+=("$1"); shift ;;
    esac
  done
  [ "${#commits[@]}" -ge 1 ] || usage
  for c in "${commits[@]}"; do
    git rev-parse --verify --quiet "${c}^{commit}" >/dev/null || { echo "bad commit: $c" >&2; exit 2; }
  done
  if [ -z "$out" ]; then
    dir=$("$script_dir/sdd-workspace")
    first=$(git rev-parse --short "${commits[0]}")
    last=$(git rev-parse --short "${commits[$((${#commits[@]} - 1))]}")
    out="$dir/review-commits-${first}..${last}.diff"
  fi
  {
    echo "# Review package (explicit commits)"
    echo
    echo "## Commits"
    for c in "${commits[@]}"; do
      git log -1 --oneline "$c"
    done
    echo
    echo "## Files changed (per commit)"
    for c in "${commits[@]}"; do
      git show --stat --format="%h %s" "$c"
      echo
    done
    echo "## Diff"
    for c in "${commits[@]}"; do
      git show -U10 --format="### commit %h %s" "$c"
      echo
    done
  } > "$out"
  echo "wrote ${out}: ${#commits[@]} commit(s), $(wc -c < "$out" | tr -d ' ') bytes"
  exit 0
fi

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  usage
fi

base=$1
head=$2

git rev-parse --verify --quiet "$base" >/dev/null || { echo "bad BASE: $base" >&2; exit 2; }
git rev-parse --verify --quiet "$head" >/dev/null || { echo "bad HEAD: $head" >&2; exit 2; }

if [ $# -eq 3 ]; then
  out=$3
else
  dir=$("$script_dir/sdd-workspace")
  out="$dir/review-$(git rev-parse --short "$base")..$(git rev-parse --short "$head").diff"
fi

{
  echo "# Review package: ${base}..${head}"
  echo
  echo "## Commits"
  git log --oneline "${base}..${head}"
  echo
  echo "## Files changed"
  git diff --stat "${base}..${head}"
  echo
  echo "## Diff"
  git diff -U10 "${base}..${head}"
} > "$out"

count=$(git rev-list --count "${base}..${head}")
echo "wrote ${out}: ${count} commit(s), $(wc -c < "$out" | tr -d ' ') bytes"
```

Then: `chmod +x skills/subagent-driven-development/scripts/review-package`

Deviation note (intentional, matches spec intent): `--commits` mode emits per-commit stats under "Files changed (per commit)" rather than a single combined stat — git cannot produce one stat across non-contiguous commits.

- [ ] **Step 4: Run to verify pass**

Run: `bash tests/sdd-scripts/run-tests.sh`
Expected: PASS — 29 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
git add skills/subagent-driven-development/scripts/review-package tests/sdd-scripts/run-tests.sh
git commit -m "Add review-package script with range and --commits (wave) modes"
```

---

### Task 4: Merged `task-reviewer-prompt.md`

**Files:**
- Create: `skills/subagent-driven-development/task-reviewer-prompt.md`

**Security flag:** `none`

- [ ] **Step 1: Create the template**

Create `skills/subagent-driven-development/task-reviewer-prompt.md` with exactly:

````markdown
# Task Reviewer Prompt Template

Use this template when dispatching a task reviewer subagent. The reviewer
reads the task's diff once and returns two verdicts: spec compliance and
code quality.

**Purpose:** Verify one task's implementation matches its requirements (nothing
more, nothing less) and is well-built (clean, tested, maintainable)

```
Task tool (general-purpose):
  description: "Review Task N (spec + quality)"
  model: [MODEL — REQUIRED: choose per SKILL.md Model Selection; an omitted
         model silently inherits the session's most expensive one]
  prompt: |
    You are reviewing one task's implementation: first whether it matches its
    requirements, then whether it is well-built. This is a task-scoped gate,
    not a merge review — a broad whole-branch review happens separately after
    all tasks are complete.

    ## Subagent Rules

    You are a focused subagent. Do NOT invoke any skills from the
    superpowers-optimized plugin. Do NOT use the Skill tool. Your only job
    is the task described below.

    ## What Was Requested

    Read the task brief: [BRIEF_FILE]

    Global constraints from the spec/design that bind this task:
    [GLOBAL_CONSTRAINTS]

    ## What the Implementer Claims They Built

    Read the implementer's report: [REPORT_FILE]

    ## Diff Under Review

    **Base:** [BASE_SHA]
    **Head:** [HEAD_SHA]
    **Diff file:** [DIFF_FILE]

    Read the diff file once — it contains the commit list, a stat summary,
    and the full diff with surrounding context, and it is your view of the
    change. The diff's context lines ARE the changed files: do not Read a
    changed file separately unless a hunk you must judge is cut off
    mid-function — and say so in your report. Do not re-run git commands.
    Only if the diff file is missing may you fetch the diff yourself:
    `git diff --stat [BASE_SHA]..[HEAD_SHA]` and `git diff [BASE_SHA]..[HEAD_SHA]`
    — this is a failure fallback, not an alternative workflow. If the Base/Head
    lines above were replaced by a commit list (wave mode), do not fall back to
    a range diff — it would include sibling tasks' commits; stop and report the
    missing diff file instead.
    Do not crawl the broader codebase. Inspect code outside the diff only
    to evaluate a concrete risk you can name — one focused check per named
    risk, and name both the risk and what you checked in your report.
    Cross-cutting changes are legitimate named risks: if the diff changes
    lock ordering, a function or API contract, or shared mutable state,
    checking the call sites is the right method.

    Your review is read-only on this checkout. Do not mutate the working
    tree, the index, HEAD, or branch state in any way.

    ## Do Not Trust the Report

    Treat the implementer's report as unverified claims about the code. It
    may be incomplete, inaccurate, or optimistic. Verify the claims against
    the diff. Design rationales in the report are claims too: "left it per
    YAGNI," "kept it simple deliberately," or any other justification is the
    implementer grading their own work. Judge the code on its merits — a
    stated rationale never downgrades a finding's severity.

    ## Tests

    The implementer already ran the tests and reported results with TDD
    evidence for exactly this code. Do not re-run the suite to confirm their
    report. Run a test only when reading the code raises a specific doubt
    that no existing run answers — and then a focused test, never a
    package-wide suite, race detector run, or repeated/high-count loop. If
    heavy validation seems warranted, recommend it in your report instead of
    running it. If you cannot run commands in this environment, name the
    test you would run.

    Warnings or other noise in the implementer's reported test output are
    findings — test output should be pristine.

    ## Part 1: Spec Compliance

    Compare the diff against What Was Requested:

    - **Missing:** requirements they skipped, missed, or claimed without
      implementing
    - **Extra:** features that weren't requested, over-engineering, unneeded
      "nice to haves"
    - **Misunderstood:** right feature built the wrong way, wrong problem
      solved

    If a requirement cannot be verified from this diff alone (it lives in
    unchanged code or spans tasks), report it as a ⚠️ item instead of
    broadening your search.

    ## Part 2: Code Quality

    **Code quality:**
    - Clean separation of concerns?
    - Proper error handling?
    - DRY without premature abstraction?
    - Edge cases handled?

    **Tests:**
    - Do the new and changed tests verify real behavior, not mocks?
    - Are the task's edge cases covered?

    **Structure:**
    - Does each file have one clear responsibility with a well-defined interface?
    - Are units decomposed so they can be understood and tested independently?
    - Is the implementation following the file structure from the plan?
    - Did this change create new files that are already large, or
      significantly grow existing files? (Don't flag pre-existing file
      sizes — focus on what this change contributed.)

    Your report should point at evidence: file:line references for every
    finding and for any check you would otherwise answer with a bare
    "yes." A tight report that cites lines gives the controller everything
    it needs.

    Your final message is the report itself: begin directly with the
    spec-compliance verdict. Every line is a verdict, a finding with
    file:line, or a check you ran — no preamble, no process narration,
    no closing summary.

    ## Calibration

    Categorize issues by actual severity. Not everything is Critical.
    Important means this task cannot be trusted until it is fixed: incorrect
    or fragile behavior, a missed requirement, or maintainability damage you
    would block a merge over — verbatim duplication of a logic block,
    swallowed errors, tests that assert nothing. "Coverage could be broader"
    and polish suggestions are Minor.
    If the plan or brief explicitly mandates something this rubric calls a
    defect (a test that asserts nothing, verbatim duplication of a logic
    block), that IS a finding — report it as Important, labeled
    plan-mandated. The plan's authorship does not grade its own work; the
    human decides.
    Acknowledge what was done well before listing issues — accurate praise
    helps the implementer trust the rest of the feedback.

    ## Output Format

    ### Spec Compliance

    - ✅ Spec compliant | ❌ Issues found: [what's missing/extra/misunderstood,
      with file:line references]
    - ⚠️ Cannot verify from diff: [requirements you could not verify from the
      diff alone, and what the controller should check — report alongside the
      ✅/❌ verdict for everything you could verify]

    ### Strengths
    [What's well done? Be specific.]

    ### Issues

    #### Critical (Must Fix)
    #### Important (Should Fix)
    #### Minor (Nice to Have)

    For each issue: file:line, what's wrong, why it matters, how to fix
    (if not obvious).

    ### Assessment

    **Task quality:** [Approved | Needs fixes]

    **Reasoning:** [1-2 sentence technical assessment]
```

**Placeholders:**
- `[MODEL]` — REQUIRED: reviewer model per SKILL.md Model Selection
- `[BRIEF_FILE]` — REQUIRED: the task brief file (`scripts/task-brief PLAN N`
  prints the path; same file the implementer worked from)
- `[GLOBAL_CONSTRAINTS]` — the binding requirements copied verbatim from
  the plan's Global Constraints section or the spec: exact values, formats,
  and stated relationships between components (not process rules — those
  are already in this template)
- `[REPORT_FILE]` — REQUIRED: the file the implementer wrote its detailed
  report to
- `[BASE_SHA]` — commit before this task
- `[HEAD_SHA]` — current commit
  (in wave mode, replace the Base/Head lines with the task's reported commit
  list — there is no meaningful per-task range on a shared wave branch)
- `[DIFF_FILE]` — REQUIRED: the path the controller wrote the review
  package to (`scripts/review-package BASE HEAD`, or in a wave
  `scripts/review-package --commits SHA...`, prints the unique path it
  wrote; the package never enters the controller's context)

**Reviewer returns:** Spec Compliance verdict (✅/❌/⚠️), Strengths, Issues
(Critical/Important/Minor), Task quality verdict

A fix dispatch can address spec gaps and quality findings together;
re-review after fixes covers both verdicts.
````

- [ ] **Step 2: Verify**

Run: `grep -c "Subagent Rules\|REQUIRED\|Cannot verify from diff" skills/subagent-driven-development/task-reviewer-prompt.md`
Expected: a count ≥ 6 (banner present, REQUIRED model + placeholders, ⚠️ verdict present)

- [ ] **Step 3: Commit**

```bash
git add skills/subagent-driven-development/task-reviewer-prompt.md
git commit -m "Add merged task-reviewer template: one reviewer, two verdicts"
```

---

### Task 5: Rewrite `implementer-prompt.md`

**Files:**
- Modify: `skills/subagent-driven-development/implementer-prompt.md` (full replacement)

**Security flag:** `none`

- [ ] **Step 1: Replace the file content**

Replace the entire content of `skills/subagent-driven-development/implementer-prompt.md` with:

````markdown
# Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent.

```
Task tool (general-purpose):
  description: "Implement Task N: [task name]"
  model: [MODEL — REQUIRED: choose per SKILL.md Model Selection; an omitted
         model silently inherits the session's most expensive one]
  prompt: |
    You are implementing Task N: [task name]

    ## Subagent Rules

    You are a focused subagent. Do NOT invoke any skills from the
    superpowers-optimized plugin. Do NOT use the Skill tool. Your only job
    is the task described below.

    ## Task Description

    Read your task brief first: [BRIEF_FILE]
    It is your requirements, with the exact values to use verbatim.

    ## Context

    [Scene-setting: where this task fits, interfaces and decisions from
    earlier tasks the brief cannot know, resolutions of any ambiguity the
    controller noticed in the brief]

    ## Before You Begin

    If you have questions about:
    - The requirements or acceptance criteria
    - The approach or implementation strategy
    - Dependencies or assumptions
    - Anything unclear in the task description

    **Ask them now.** Raise any concerns before starting work.

    ## Your Job

    Once you're clear on requirements:
    1. Implement exactly what the task specifies
    2. Write tests (following TDD if the task says to)
    3. Verify implementation works
    4. Commit your work
    5. Self-review (see below)
    6. Report back

    Work from: [directory]

    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    It's always OK to pause and clarify. Don't guess or make assumptions.

    While iterating, run the focused test for what you're changing; run the
    full suite once before committing, not after every edit.

    ## Code Organization

    You reason best about code you can hold in context at once, and your edits are more
    reliable when files are focused. Keep this in mind:
    - Follow the file structure defined in the plan
    - Each file should have one clear responsibility with a well-defined interface
    - If a file you're creating is growing beyond the plan's intent, stop and report
      it as DONE_WITH_CONCERNS — don't split files on your own without plan guidance
    - If an existing file you're modifying is already large or tangled, work carefully
      and note it as a concern in your report
    - In existing codebases, follow established patterns. Improve code you're touching
      the way a good developer would, but don't restructure things outside your task.

    ## When You're in Over Your Head

    It is always OK to stop and say "this is too hard for me." Bad work is worse than
    no work. You will not be penalized for escalating.

    **STOP and escalate when:**
    - The task requires architectural decisions with multiple valid approaches
    - You need to understand code beyond what was provided and can't find clarity
    - You feel uncertain about whether your approach is correct
    - The task involves restructuring existing code in ways the plan didn't anticipate
    - You've been reading file after file trying to understand the system without progress

    **How to escalate:** Report back with status BLOCKED or NEEDS_CONTEXT. Describe
    specifically what you're stuck on, what you've tried, and what kind of help you need.
    The controller can provide more context, re-dispatch with a more capable model,
    or break the task into smaller pieces.

    ## Before Reporting Back: Self-Review

    Review your work with fresh eyes. Ask yourself:

    **Completeness:**
    - Did I fully implement everything in the spec?
    - Did I miss any requirements?
    - Are there edge cases I didn't handle?

    **Quality:**
    - Is this my best work?
    - Are names clear and accurate (match what things do, not how they work)?
    - Is the code clean and maintainable?

    **Discipline:**
    - Did I avoid overbuilding (YAGNI)?
    - Did I only build what was requested?
    - Did I follow existing patterns in the codebase?

    **Testing:**
    - Do tests actually verify behavior (not just mock behavior)?
    - Did I follow TDD if required?
    - Are tests comprehensive?
    - Is the test output pristine (no stray warnings or noise)?

    If you find issues during self-review, fix them now before reporting.

    ## After Review Findings

    If a reviewer finds issues and you fix them, re-run the tests that cover
    the amended code and append the results to your report file. Reviewers
    will not re-run tests for you — your report is the test evidence.

    ## Report Format

    Write your full report to [REPORT_FILE]:
    - What you implemented (or what you attempted, if blocked)
    - What you tested and test results
    - **TDD Evidence** (if TDD was required for this task):
      - RED: command run, relevant failing output before implementation, and why the failure was expected
      - GREEN: command run and relevant passing output after implementation
    - Files changed
    - Self-review findings (if any)
    - Any issues or concerns

    Then report back with ONLY (under 15 lines — the detail lives in the
    report file):
    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - Commits created (short SHA + subject) — the controller builds your
      review package from these SHAs in wave mode; list every commit
    - One-line test summary (e.g. "14/14 passing, output pristine")
    - Your concerns, if any
    - The report file path

    If BLOCKED or NEEDS_CONTEXT, put the specifics in the final message
    itself — the controller acts on it directly.

    Use DONE_WITH_CONCERNS if you completed the work but have doubts about correctness.
    Use BLOCKED if you cannot complete the task. Use NEEDS_CONTEXT if you need
    information that wasn't provided. Never silently produce work you're unsure about.
```

**Placeholders:**
- `[MODEL]` — REQUIRED: implementer model per SKILL.md Model Selection
- `[BRIEF_FILE]` — REQUIRED: `scripts/task-brief PLAN_FILE N` prints the path
- `[REPORT_FILE]` — REQUIRED: same directory and stem as the brief
  (brief `…/task-N-brief.md` → report `…/task-N-report.md`)
- `[directory]` — the working directory for the task
````

- [ ] **Step 2: Verify**

Run: `grep -c "BRIEF_FILE\|REPORT_FILE\|REQUIRED" skills/subagent-driven-development/implementer-prompt.md && grep -c "FULL task text" skills/subagent-driven-development/implementer-prompt.md`
Expected: first count ≥ 6; second command exits 1 with count 0 (old inline-paste marker gone)

- [ ] **Step 3: Commit**

```bash
git add skills/subagent-driven-development/implementer-prompt.md
git commit -m "Implementer works from brief file, reports to file, model required"
```

---

### Task 6: SKILL.md — single gate, waves, batched mode, hard rules; delete old prompts

**Files:**
- Modify: `skills/subagent-driven-development/SKILL.md`
- Delete: `skills/subagent-driven-development/spec-reviewer-prompt.md`, `skills/subagent-driven-development/code-quality-reviewer-prompt.md`

**Security flag:** `none`

**Does NOT cover:** the new sections (Pre-Flight, File Handoffs, ⚠️ Items, Constructing Reviewer Prompts, Durable Progress) and Model Selection additions — those are Task 7. After this task no references to deleted files remain. Steps 2 and 5 intentionally insert forward references to Task 7's sections (Pre-Flight Plan Review, Handling Reviewer ⚠️ Items, Durable Progress); they dangle until Task 7 lands — expected, not a defect.

- [ ] **Step 1: Replace the per-task cluster and edges in the dot graph**

In the `Core Flow` dot graph, replace the `cluster_per_task` subgraph nodes:

```dot
    subgraph cluster_per_task {
        label="Per Task";
        "Record BASE, write task brief, dispatch implementer" [shape=box];
        "Implementer asks questions?" [shape=diamond];
        "Answer questions, provide context" [shape=box];
        "Implementer implements, tests, self-reviews, writes report file" [shape=box];
        "Generate review package, dispatch task reviewer" [shape=box];
        "Spec ✅ and quality approved?" [shape=diamond];
        "Dispatch fix subagent (spec + quality findings together)" [shape=box];
        "Mark task complete, append ledger line" [shape=box];
    }
```

and replace the per-task edges with:

```dot
    "Read plan, extract all tasks, create tracking" -> "Record BASE, write task brief, dispatch implementer";
    "Record BASE, write task brief, dispatch implementer" -> "Implementer asks questions?";
    "Implementer asks questions?" -> "Answer questions, provide context" [label="yes"];
    "Answer questions, provide context" -> "Record BASE, write task brief, dispatch implementer";
    "Implementer asks questions?" -> "Implementer implements, tests, self-reviews, writes report file" [label="no"];
    "Implementer implements, tests, self-reviews, writes report file" -> "Generate review package, dispatch task reviewer";
    "Generate review package, dispatch task reviewer" -> "Spec ✅ and quality approved?";
    "Spec ✅ and quality approved?" -> "Dispatch fix subagent (spec + quality findings together)" [label="no"];
    "Dispatch fix subagent (spec + quality findings together)" -> "Generate review package, dispatch task reviewer" [label="re-review"];
    "Spec ✅ and quality approved?" -> "Mark task complete, append ledger line" [label="yes"];
    "Mark task complete, append ledger line" -> "More tasks?";
    "More tasks?" -> "Record BASE, write task brief, dispatch implementer" [label="yes"];
```

Keep the outer nodes (`Final whole-branch review`, `Shut down spawned subagents`, `Invoke finishing-a-development-branch`) and their edges unchanged.

- [ ] **Step 2: Replace the numbered Core Flow list**

Replace list items 1–3 (keep 4–6: final review, shutdown, finishing) with:

```markdown
1. Read the plan once and extract all tasks. Run `scripts/sdd-workspace` (from this skill's directory) once to create the artifact workspace, and check `.superpowers/sdd/progress.md` for a ledger from an earlier session — tasks it marks complete are DONE; never re-dispatch them.
2. Create task tracking for all tasks. Run the Pre-Flight Plan Review (below) before dispatching Task 1.
3. For each task:
- Record BASE: `git rev-parse HEAD` before dispatching.
- Run `scripts/task-brief PLAN_FILE N` and dispatch the implementer with the brief path, a report-file path (`task-N-report.md` beside the brief), and an explicit model.
- Resolve implementer questions before coding.
- Require the implementer's ≤15-line status return; the detail lives in its report file.
- Run `scripts/review-package BASE HEAD` (never `HEAD~1` — it silently drops all but the last commit of a multi-commit task) and dispatch the single task reviewer (`./task-reviewer-prompt.md`) with the brief, report, and package paths.
- Resolve any ⚠️ "cannot verify from diff" items yourself (see Handling Reviewer ⚠️ Items).
- If the review finds Critical/Important issues: dispatch ONE fix subagent for all of them (spec gaps and quality findings together), have it append to the report file, then re-review — the re-review covers both verdicts.
- Mark task complete: update the task's checkbox in plan.md from `- [ ]` to `- [x]`, append the ledger line (see Durable Progress), and sync `state.md` if it has a plan status section.
   - For complex or high-risk tasks, validate the approach against requirements and consider simpler alternatives before or after the implementer's work.
   - For tasks centered on frontend/UI, apply `frontend-design` standards to guide structure, styling, and accessibility.
```

- [ ] **Step 3: Update Parallel Waves**

Replace step 3 of the Parallel Waves numbered list ("Review each task with the same two-stage gate.") with:

```markdown
3. Review each task with the single task-review gate. Build each task's package with `scripts/review-package --commits <that task's reported commit SHAs>` — NEVER a BASE..HEAD range in a wave: commits interleave, so a range would mix sibling tasks' changes into the review. If an implementer's report omits its commit SHAs, ask that implementer for them before reviewing.
```

- [ ] **Step 4: Update Handling Implementer Status (DONE)**

Replace the `**DONE:** Proceed to spec compliance review.` line with:

```markdown
**DONE:** Generate the review package (`scripts/review-package BASE HEAD`, from this skill's directory — it prints the unique file path it wrote; BASE is the commit you recorded before dispatching the implementer — never `HEAD~1`), then dispatch the task reviewer with the printed path. In a wave, use `--commits` with the implementer's reported SHAs instead.
```

- [ ] **Step 5: Update Batched Autonomous Mode wording**

- In Batch Loop step 2, replace `(implementer → spec review → quality review → update plan.md checkbox → commit)` with `(implementer → task review (both verdicts) → update plan.md checkbox → commit)`.
- Replace `Review gates are NOT relaxed: full spec-compliance and code-quality review per task, and pre-implementation security review for `security`-flagged tasks.` with `Review gates are NOT relaxed: the full task review (spec-compliance AND code-quality verdicts) per task, and pre-implementation security review for `security`-flagged tasks. A conflict found by the Pre-Flight Plan Review is a blocker: journal it under `## Open Issues` and end the batch — never best-guess a plan conflict.`

Note: both target strings wrap across two lines in SKILL.md (at "spec review →/quality review" and "review per/task") — match them including the line break, not as single lines.

- [ ] **Step 6: Update Hard Rules**

Replace:
- `- Do not skip spec review.` and `- Do not skip quality review.` (two lines) with `- Do not skip the task review — both verdicts, spec compliance and code quality.`
- `- Do not ask subagents to read long plan files when task text can be passed directly.` with `- Do not paste task text, diffs, or reports into dispatch prompts when a workspace file can carry them — pass paths (see File Handoffs).`

Append to the Hard Rules list:

```markdown
- Never coach a reviewer: no "do not flag X", no pre-rated severities, no suppressed findings.
- Narration: between tool calls, narrate at most one short line — the ledger and the tool results carry the record.
```

- [ ] **Step 7: Update Prompt Templates section and delete old files**

Replace the Prompt Templates list with:

```markdown
Use:
- `./implementer-prompt.md`
- `./task-reviewer-prompt.md`
```

Then:

```bash
git rm skills/subagent-driven-development/spec-reviewer-prompt.md skills/subagent-driven-development/code-quality-reviewer-prompt.md
```

Also update the `## Integration` section: replace `- Use `requesting-code-review` templates for quality review structure.` with `- The final whole-branch review uses `requesting-code-review/code-reviewer.md` on the most capable model.`

Also update the Model Selection table's `opus` row: replace `complex spec review` with `complex design review` — otherwise the Step 8 grep below finds a leftover "spec review" at that row and fails.

- [ ] **Step 8: Verify consistency**

Run: `grep -rn "spec-reviewer-prompt\|code-quality-reviewer-prompt\|two-stage gate\|spec review\|quality review" skills/subagent-driven-development/SKILL.md`
Expected: no hits (all references to the deleted files and the two-stage flow are gone; "task review" phrasing remains)

Run: `bash tests/sdd-scripts/run-tests.sh`
Expected: PASS (scripts untouched — guards against accidental edits)

- [ ] **Step 9: Commit**

```bash
git add -A skills/subagent-driven-development
git commit -m "SDD: single task-review gate; wave packages via --commits; narration rule"
```

---

### Task 7: SKILL.md — new sections + Model Selection additions

**Files:**
- Modify: `skills/subagent-driven-development/SKILL.md`

**Security flag:** `none`

- [ ] **Step 1: Insert Pre-Flight Plan Review after the Core Flow numbered list** (immediately before `## Parallel Waves`)

```markdown
## Pre-Flight Plan Review

Before dispatching Task 1, scan the plan once for conflicts:

- tasks that contradict each other or the plan's Global Constraints
- anything the plan explicitly mandates that the review rubric treats as a
  defect (a test that asserts nothing, verbatim duplication of a logic block)

Present everything you find to the user as one batched question — each
finding beside the plan text that mandates it, asking which governs —
before execution begins, not one interrupt per discovery mid-plan. If the
scan is clean, proceed without comment. The review loop remains the net for
conflicts that only emerge from implementation. (In Batched Autonomous Mode
a pre-flight conflict is a blocker — journal it and end the batch.)
```

- [ ] **Step 2: Insert File Handoffs, Handling Reviewer ⚠️ Items, Constructing Reviewer Prompts, and Durable Progress** (all four sections, one block, immediately after the `## Handling Implementer Status` section, before `## Hard Rules`)

```markdown
## File Handoffs

Everything you paste into a dispatch prompt — and everything a subagent
prints back — stays resident in your context for the rest of the session
and is re-read on every later turn. Hand artifacts over as files in the
workspace (`scripts/sdd-workspace` prints its path):

- **Task brief:** before dispatching an implementer, run this skill's
  `scripts/task-brief PLAN_FILE N` — it extracts the task's full text to a
  uniquely named file and prints the path. Compose the dispatch so the
  brief stays the single source of requirements. Your dispatch should
  contain: (1) one line on where this task fits in the project; (2) the
  brief path, introduced as "read this first — it is your requirements,
  with the exact values to use verbatim"; (3) interfaces and decisions
  from earlier tasks that the brief cannot know; (4) your resolution of
  any ambiguity you noticed in the brief; (5) the report-file path and
  report contract. Exact values (numbers, magic strings, signatures, test
  cases) appear only in the brief.
- **Report file:** name the implementer's report file after the brief
  (brief `…/task-N-brief.md` → report `…/task-N-report.md`) and put it in
  the dispatch prompt. The implementer writes the full report there and
  returns only status, commits, a one-line test summary, and concerns.
- **Reviewer inputs:** the task reviewer gets three paths — the same brief
  file, the report file, and the review package — plus the global
  constraints that bind the task, copied verbatim from the plan.
- Fix dispatches append their fix report (with test results) to the same
  report file and return a short summary; re-reviews read the updated file.
- A dispatch prompt describes one task, not the session's history. Do not
  paste accumulated prior-task summaries into later dispatches — a fresh
  subagent needs its task, the interfaces it touches, and the global
  constraints. Nothing else.

## Handling Reviewer ⚠️ Items

The task reviewer may report "⚠️ Cannot verify from diff" items —
requirements that live in unchanged code or span tasks. These do not block
the rest of the review, but you must resolve each one yourself before
marking the task complete: you hold the plan and cross-task context the
reviewer lacks. If you confirm an item is a real gap, treat it as a failed
spec verdict — send it back to the implementer and re-review.

## Constructing Reviewer Prompts

Per-task reviews are task-scoped gates. The broad review happens once, at
the final whole-branch review. When you fill a reviewer template:

- Do not add open-ended directives like "check all uses" or "run race
  tests if useful" without a concrete, task-specific reason.
- Do not ask a reviewer to re-run tests the implementer already ran on the
  same code — the implementer's report carries the test evidence.
- Do not pre-judge findings for the reviewer — never instruct a reviewer
  to ignore or not flag a specific issue. If the prompt you are writing
  contains "do not flag," "don't treat X as a defect," "at most Minor," or
  "the plan chose" — stop: you are pre-judging, usually to spare yourself
  a review loop.
- Dispatch ONE fix subagent for all of a review's Critical and Important
  findings. Record Minor findings in the progress ledger as you go, and
  point the final whole-branch review at that list so it can triage which
  must be fixed before merge. A roll-up nobody reads is a silent discard.
- A finding labeled plan-mandated — or any finding that conflicts with
  what the plan's text requires — is the user's decision, like any plan
  contradiction: present the finding and the plan text, ask which governs.
  (In Batched Autonomous Mode: journal it and end the batch.)
- The final whole-branch review gets a package too: run
  `scripts/review-package MERGE_BASE HEAD` (MERGE_BASE = the commit the
  branch started from, e.g. `git merge-base main HEAD`) and include the
  printed path in the final review dispatch.
- If the final whole-branch review returns findings, dispatch ONE fix
  subagent with the complete findings list — not one fixer per finding.
  Per-finding fixers each rebuild context and re-run suites.
- Every fix dispatch carries the implementer contract: the fix subagent
  re-runs the tests covering its change, appends results to the report
  file, and the re-review is dispatched only once the report shows the
  covering tests, the command run, and the output.

## Durable Progress

Conversation memory does not survive compaction. A controller that loses
its place re-dispatches entire completed task sequences — the single most
expensive failure mode. Track progress in a ledger file, not only in todos:

- At skill start, check for a ledger: `.superpowers/sdd/progress.md`.
  Tasks listed there as complete are DONE — do not re-dispatch them.
- When a task's review comes back clean, append one line:
  `Task N: complete (commits <base7>..<head7>, review clean)` — plus
  `Minor: <finding>` lines for any Minor findings being carried forward.
- plan.md checkboxes + git log remain authoritative for position (as the
  Batched Autonomous Mode resume procedure defines); the ledger adds the
  commit ranges for post-compaction recovery and the Minor-finding list
  for final-review triage. After compaction, trust the ledger and
  `git log` over your own recollection.
- `git clean -fdx` destroys the ledger (it is git-ignored scratch); if
  that happens, recover from `git log`.
```

- [ ] **Step 3: Extend Model Selection**

Append to the `## Model Selection for Agent Tool Calls` section (after the existing "Apply via the `model` parameter…" paragraph):

```markdown
**Always specify the model explicitly when dispatching a subagent.** An
omitted model inherits your session's model — often the most capable and
most expensive — which silently defeats this section. Every prompt
template marks `model:` as REQUIRED.

**Turn count beats token price.** Wall-clock and context cost scale with
how many turns a subagent takes, and the cheapest models routinely take
2-3× the turns on multi-step work — costing more overall. Use `sonnet` as
the floor for reviewers and for implementers working from prose
descriptions. Use `haiku` for an implementer only when the plan text
contains the complete code to write (transcription plus testing) or for a
single-file mechanical fix. Scale reviewer models to the diff's size,
complexity, and risk — a subtle concurrency change deserves `opus`; the
final whole-branch review always runs on `opus`, not the session default.
```

- [ ] **Step 4: Verify**

Run: `grep -c "^## " skills/subagent-driven-development/SKILL.md && grep -n "Pre-Flight Plan Review\|File Handoffs\|Reviewer ⚠️ Items\|Constructing Reviewer Prompts\|Durable Progress\|Turn count beats token price" skills/subagent-driven-development/SKILL.md`
Expected: every pattern present. The five new section names each appear exactly once as a `## ` heading; additional hits are intentional cross-references (Core Flow list, Hard Rules, Batched Mode wording) — do NOT delete them to reduce counts. "Turn count beats token price" appears exactly once.

Run: `grep -rn "spec-reviewer-prompt\|code-quality-reviewer-prompt\|two-stage gate\|spec review\|quality review" skills/subagent-driven-development/SKILL.md`
Expected: no hits (Task 6's guard still holds after this task's insertions — the ⚠️ Items section says "failed spec verdict", not "failed spec review")

Run: `bash tests/codex/run-unit-tests.sh`
Expected: PASS (hook units unaffected — guard)

- [ ] **Step 5: Commit**

```bash
git add skills/subagent-driven-development/SKILL.md
git commit -m "SDD: file handoffs, pre-flight review, ledger, model-required guidance"
```

---

### Task 8: writing-plans Global Constraints block

**Files:**
- Modify: `skills/writing-plans/SKILL.md`

**Security flag:** `none`

- [ ] **Step 1: Add the block to the Plan Header template**

In the `## Plan Header` template of `skills/writing-plans/SKILL.md`, insert after the `**Assumptions:**` line:

```markdown
**Global Constraints:** <rules that bind every task — version floors, dependency limits, naming and copy, exact values — copied verbatim from the spec. subagent-driven-development hands this block verbatim to every reviewer as its attention lens. Omit only if the spec truly has none; a missing block forces the SDD controller to re-derive constraints from the spec on every dispatch.>
```

- [ ] **Step 2: Verify**

Run: `grep -n "Global Constraints" skills/writing-plans/SKILL.md`
Expected: 1+ hits inside the Plan Header template

- [ ] **Step 3: Commit**

```bash
git add skills/writing-plans/SKILL.md
git commit -m "writing-plans: plans carry a Global Constraints block for SDD reviewers"
```

---

### Task 9: Update behavioral tests to the merged gate

**Files:**
- Modify: `tests/claude-code/test-subagent-driven-development.sh`
- Modify: `tests/claude-code/test-subagent-driven-development-integration.sh`
- Modify: `tests/claude-code/README.md`

**Security flag:** `none`

**Does NOT cover:** running the behavioral suites (slow, invoke real `claude`; they run in CI / on demand). Verification here is static: the scripts must reference only the merged-gate concepts and stay syntactically valid.

- [ ] **Step 1: Update `test-subagent-driven-development.sh`**

- Test 2: replace the question `"Read the file at $SKILL_FILE. Answer yes or no: does spec compliance review happen before code quality review in subagent-driven-development?"` with `"Read the file at $SKILL_FILE. Answer yes or no: does a single task reviewer return both a spec-compliance verdict and a code-quality verdict in subagent-driven-development?"`, and replace the assert pattern `"[Yy]es\|spec.*compliance.*before\|compliance.*first\|compliance.*then.*quality\|quality.*after.*compliance"` with `"[Yy]es\|both.*verdict\|single.*review\|one review\|two verdict"` and its description `"Spec compliance before code quality"` with `"Single reviewer, both verdicts"`.
- Test 5: replace `"what is the spec compliance reviewer's attitude toward the implementer's report?"` with `"what is the task reviewer's attitude toward the implementer's report?"`; in the follow-up assertion, replace pattern `"read.*code\|inspect.*code\|verify.*code"` with `"read.*code\|inspect.*code\|verify.*code\|read.*diff\|verify.*diff"` (the reviewer's view of the change is the diff file).
- Test 7 (asserts the OLD inline-paste contract — the port inverts it): replace the comment `# Test 7: Verify full task text is provided` with `# Test 7: Verify task hand-off via brief file`; replace the question `"Read the file at $SKILL_FILE and answer: how does the controller provide task information to the implementer subagent? Does it make them read a file or provide it directly?"` with `"Read the file at $SKILL_FILE and answer: how does the controller hand the task requirements to the implementer subagent? Does it paste the task text into the prompt or point at a file?"`; replace the assert pattern `"provide.*directly\|full.*text\|paste\|include.*prompt\|inline\|passed.*directly"` with `"brief\|task-brief\|read.*file\|file.*path\|workspace"` and its description `"Provides text directly"` with `"Hands over a brief file"`.

- [ ] **Step 2: Update `test-subagent-driven-development-integration.sh`**

- Line ~15: `echo "  2. Full task text provided to subagents"` → `echo "  2. Task briefs handed to subagents as files"`
- Line ~16: `echo "  4. Spec compliance review before code quality"` → `echo "  4. Single task review returns spec + quality verdicts"`
- Line ~19: `echo "  6. Spec reviewer reads code independently"` → `echo "  6. Task reviewer verifies the diff independently"`
- Both prompt blocks (~128 and ~143): `2. Provide full task text to subagents (don't make them read files)` → `2. Hand each subagent its task brief file (don't paste task text into prompts)` — the old line instructs the controller to violate the new File Handoffs rule mid-run
- Both prompt blocks (~129-131 and ~144-146): `4. Run spec compliance review before code quality review` → `4. Run the single task review (spec compliance + code quality verdicts)`
- Line ~271-273: `echo "Test 8: No extra features added (spec compliance)..."` → `echo "Test 8: No extra features added (task review, spec verdict)..."`; `echo "  [WARN] Extra features found (spec review should have caught this)"` → `echo "  [WARN] Extra features found (task review should have caught this)"`
- Line ~300: `echo "  ✓ Provides full task text to subagents"` → `echo "  ✓ Hands task briefs to subagents as files"`
- Lines ~302-303: `echo "  ✓ Runs spec compliance before code quality"` → `echo "  ✓ Runs the single task review (both verdicts)"`; `echo "  ✓ Spec reviewer verifies independently"` → `echo "  ✓ Task reviewer verifies independently"`

- [ ] **Step 3: Update `tests/claude-code/README.md`**

The README describes what these two tests verify; keep it in sync with the merged gate:

- Line ~87: `- Workflow ordering (spec compliance before code quality)` → `- Workflow ordering (single task review, spec + quality verdicts)`
- Line ~104: `  - Full task text provided in subagent prompts` → `  - Task briefs handed to subagents as workspace files`
- Line ~106: `  - Spec compliance review happens before code quality` → `  - A single task review returns both spec-compliance and code-quality verdicts`
- Line ~107: `  - Spec reviewer reads code independently` → `  - Task reviewer verifies the diff independently`

- [ ] **Step 4: Verify**

Run: `bash -n tests/claude-code/test-subagent-driven-development.sh && bash -n tests/claude-code/test-subagent-driven-development-integration.sh && grep -c "spec compliance review before\|spec.*compliance.*before\|[Ff]ull task text" tests/claude-code/test-subagent-driven-development*.sh tests/claude-code/README.md`
Expected: both `bash -n` clean; grep exits 1 (0 remaining "before" orderings AND 0 remaining "full task text" inline-paste references in the tests or the README)

- [ ] **Step 5: Commit**

```bash
git add tests/claude-code/test-subagent-driven-development.sh tests/claude-code/test-subagent-driven-development-integration.sh tests/claude-code/README.md
git commit -m "Behavioral tests and README assert the merged task-review gate"
```

---

### Task 10: Release bookkeeping — v6.8.0

**Files:**
- Modify: `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.universal.yaml`, `RELEASE-NOTES.md`

**Security flag:** `none`

**Does NOT cover:** tagging (user decides when to tag), the plugin-cache reinstall (post-merge/manual step), and the live Codex validation (needs a Codex machine — run the repo-adapter smoke checks from `tests/codex/post-push-validation-checklist.md` only).

- [ ] **Step 1: Bump version to 6.8.0 in all four files**

- `VERSION`: replace content with `6.8.0`
- `.claude-plugin/plugin.json`: update the `"version"` field to `"6.8.0"`
- `.claude-plugin/marketplace.json`: update the version field(s) referencing the current version to `6.8.0`
- `plugin.universal.yaml`: update the `meta` block's `version:` to `"6.8.0"` — touch nothing else in this file (its hook wiring is known-stale, but the version must not drift; it is currently in sync)

- [ ] **Step 2: Add the RELEASE-NOTES entry**

Insert at the top of the version entries in `RELEASE-NOTES.md`:

```markdown
## v6.8.0 (2026-07-18)

### Subagent-Driven Development: token-optimized review flow (port of upstream v6.0.0)

Ports obra/superpowers v6.0.0's measured cost rework (~2x faster, ~50-60% fewer tokens in upstream evals), adapted to this fork's Parallel Waves and Batched Autonomous Mode.

- **One reviewer per task, two verdicts.** `spec-reviewer-prompt.md` and `code-quality-reviewer-prompt.md` are replaced by a single `task-reviewer-prompt.md` returning a spec-compliance verdict and a quality verdict, plus a "⚠️ cannot verify from diff" verdict the controller resolves itself. One fix pass clears both; reviewers are read-only and immune to implementer rationales.
- **Handoffs move as files.** New scripts `sdd-workspace`, `task-brief`, and `review-package` write task briefs, implementer reports, and review diffs (commit list + stat + `-U10` diff) to `.superpowers/sdd/`. Dispatch prompts carry paths, not pasted text.
- **Fork extension: `review-package --commits SHA...`** builds a wave task's package from its own reported commits — a BASE..HEAD range would mix interleaved sibling tasks' changes. Range fallback is banned in waves.
- **Every dispatch names its model.** Templates mark `model:` REQUIRED (an omitted model silently inherits the session's most expensive one), with turn-count-beats-token-price guidance; the final whole-branch review always runs on the most capable model.
- **Controller discipline:** at most one narration line between tool calls; a durable progress ledger (`.superpowers/sdd/progress.md`) prevents re-dispatching completed tasks after compaction; pre-flight plan review; ONE fix subagent per review's findings; reviewer coaching banned.
- **writing-plans:** plans now carry a Global Constraints block, handed verbatim to every reviewer.
- New fast test suite: `tests/sdd-scripts/run-tests.sh`.
```

- [ ] **Step 3: Verify**

Run: `cat VERSION && grep '"version"' .claude-plugin/plugin.json .claude-plugin/marketplace.json && grep -n 'version: "6.8.0"' plugin.universal.yaml && grep -n "v6.8.0" RELEASE-NOTES.md | head -2`
Expected: `6.8.0` everywhere (including the yaml `meta` version); RELEASE-NOTES entry present at top

Run: `bash tests/sdd-scripts/run-tests.sh && bash tests/codex/run-unit-tests.sh`
Expected: both PASS

- [ ] **Step 4: Commit**

```bash
git add VERSION .claude-plugin/plugin.json .claude-plugin/marketplace.json plugin.universal.yaml RELEASE-NOTES.md
git commit -m "v6.8.0 - SDD token-optimized review flow (upstream v6.0.0 port)"
```
