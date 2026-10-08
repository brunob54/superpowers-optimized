#!/usr/bin/env bash
# Unit test: hooks/session-start reads the memory files of the project folder
# that Claude Code names in CLAUDE_PROJECT_DIR.
#
# Claude Code sets CLAUDE_PROJECT_DIR to the project folder. The hook process
# can start in another folder: after a `cd` in the session, the hook of the
# "compact" event runs in the new folder. The memory files (project-map.md,
# session-log.md, state.md, known-issues.md) live in the project folder, so
# the hook changes to that folder before it reads them. The active work log
# notice is built before that change: it stays the notice of the folder where
# the hook started (for example a linked worktree on another branch).
#
# Fixture: a git repository with the four memory files at its top folder, a
# sub-folder src/, a folder docs/ that holds a product document named
# known-issues.md, and a linked worktree on its own branch, one commit ahead,
# with one active work log. The memory files are not committed, so the
# worktree does not hold them.
#
# Cases:
#   1. Variable set to the project folder, hook started there: the four
#      sections of the project folder, no false stale note.
#   2. Variable set, hook started in src/ and in docs/: the output is the
#      output of case 1; the known issues of docs/ are not injected.
#   3. Variable set, hook started in the linked worktree: the sections of the
#      project folder, no "project-map.md is stale" text (the map records the
#      HEAD of the project folder, not of the worktree), and the work log
#      notice of the worktree.
#   4. Variable not set: the behaviour of the hook before the variable was
#      read. In src/ and in the worktree no memory section is injected; in
#      docs/ the known issues of docs/ are injected. A variable that is empty
#      or that names a missing folder gives the same output as no variable.
#
# Self-contained like tests/codex/test-session-start-budget.sh: no network
# (SUPERPOWERS_AUTO_UPDATE=0), a temporary HOME, CLAUDE_PLUGIN_ROOT set. Every
# run starts from an empty environment (env -i) and sets or leaves out
# CLAUDE_PROJECT_DIR explicitly. The output is parsed with JSON.parse (Node).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HOOK="${REPO_ROOT}/hooks/session-start"
STALE_TEXT="project-map.md is stale"
# One text in each memory file of the project folder, and one in the product
# document docs/known-issues.md.
MAP_SENTINEL="ROOT-MAP-SENTINEL"
LOG_SENTINEL="ROOT-LOG-SENTINEL"
STATE_SENTINEL="ROOT-STATE-SENTINEL"
ISSUE_SENTINEL="ROOT-ISSUE-SENTINEL"
DOCS_ISSUE_SENTINEL="DOCS-ISSUE-SENTINEL"
ROOT_SENTINELS=("$MAP_SENTINEL" "$LOG_SENTINEL" "$STATE_SENTINEL" "$ISSUE_SENTINEL")
KNOWN_ISSUES_FILE="known-issues.md"
WORKLOG_PATH="docs/worklogs/side-log.md"
# Run modes of run_case.
MODE_SET="set"
MODE_UNSET="unset"

export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
TMP=$(mktemp -d)
TMP=$(cd "$TMP" && pwd -P)
TMP_HOME=$(mktemp -d)
trap 'rm -rf "$TMP" "$TMP_HOME"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$(( PASS + 1 )); echo "  ok   - $1"; }
bad() { FAIL=$(( FAIL + 1 )); echo "  FAIL - $1"; }

# assert_eq <label> <actual> <expected>
assert_eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi
}
# assert_contains <label> <haystack> <needle>
assert_contains() {
  case "$2" in
    *"$3"*) ok "$1" ;;
    *) bad "$1" ;;
  esac
}
# assert_absent <label> <haystack> <needle>
assert_absent() {
  case "$2" in
    *"$3"*) bad "$1" ;;
    *) ok "$1" ;;
  esac
}
# assert_same <label> <actual> <expected>: like assert_eq, but does not print
# the two texts, which are whole hook outputs.
assert_same() {
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (the two outputs differ)"; fi
}

# run_case <label> <dir> set <value> | run_case <label> <dir> unset: runs the
# hook with <dir> as the working directory, with CLAUDE_PROJECT_DIR set to
# <value> or not set. Checks exit status 0 and an empty standard error, and
# sets CTX to the additionalContext string of the Claude Code output branch.
# A hook that ends before it writes its JSON output counts as one failure and
# leaves CTX empty, so the assertions of the case still run and report.
run_case() {
  local label="$1" dir="$2" mode="$3"
  local raw="${TMP}/hook-output.json"
  local err="${TMP}/hook-error.txt"
  local project=()
  local pass=()
  case "$mode" in
    "$MODE_SET") project=("CLAUDE_PROJECT_DIR=$4") ;;
    "$MODE_UNSET") ;;
    *) bad "${label}: unknown run mode '${mode}'"; CTX=""; return ;;
  esac
  [ -n "${SYSTEMROOT:-}" ] && pass+=("SYSTEMROOT=$SYSTEMROOT")
  [ -n "${TEMP:-}" ] && pass+=("TEMP=$TEMP")
  local code=0
  (cd "$dir" && env -i PATH="$PATH" HOME="$TMP_HOME" GIT_CEILING_DIRECTORIES="$TMP" \
      CLAUDE_PLUGIN_ROOT="$REPO_ROOT" SUPERPOWERS_AUTO_UPDATE=0 \
      ${project[@]+"${project[@]}"} ${pass[@]+"${pass[@]}"} bash "$HOOK") \
      > "$raw" 2> "$err" || code=$?
  assert_eq "${label}: exit status 0" "$code" "0"
  assert_eq "${label}: nothing on standard error" "$(cat "$err")" ""
  CTX=$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(j.hookSpecificOutput.additionalContext);' "$raw" 2>/dev/null) \
    || { CTX=""; bad "${label}: the hook wrote no valid JSON output"; }
}

# expect_project_sections <label>: $CTX holds the four memory sections of the
# project folder, not the known issues of docs/, and no stale note for the map.
expect_project_sections() {
  local sentinel
  for sentinel in "${ROOT_SENTINELS[@]}"; do
    assert_contains "$1: the project folder's text ${sentinel} is injected" "$CTX" "$sentinel"
  done
  assert_absent "$1: the known issues of docs/ are not injected" "$CTX" "$DOCS_ISSUE_SENTINEL"
  assert_absent "$1: no '${STALE_TEXT}' text" "$CTX" "$STALE_TEXT"
}

# commit <dir> <message>: one more commit in <dir> with what is staged.
commit() {
  git -C "$1" -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false \
      commit -q --allow-empty -m "$2"
}

echo "session-start: memory files of the folder in CLAUDE_PROJECT_DIR"

# ── Fixture ─────────────────────────────────────────────────────────────────
PROJECT="${TMP}/project"
WORKTREE="${TMP}/worktree"
MISSING="${TMP}/missing-folder"
mkdir -p "$PROJECT/src" "$PROJECT/docs"
git -C "$PROJECT" init -q
commit "$PROJECT" first
printf '# Project Map\nGenerated: 2026-10-08 | Git: %s\n\n## Critical Constraints\n- %s\n' \
  "$(git -C "$PROJECT" rev-parse --short HEAD)" "$MAP_SENTINEL" > "$PROJECT/project-map.md"
printf '# Session log\n\n## 2026-10-08 10:00 [saved]\n- %s\n' "$LOG_SENTINEL" > "$PROJECT/session-log.md"
printf 'Current Goal: %s\n' "$STATE_SENTINEL" > "$PROJECT/state.md"
printf '# Known issues\n\n## %s\nSolution: none.\n' "$ISSUE_SENTINEL" > "$PROJECT/$KNOWN_ISSUES_FILE"
printf '# Known issues of the product\n\n## %s\nA product document.\n' "$DOCS_ISSUE_SENTINEL" \
  > "$PROJECT/docs/$KNOWN_ISSUES_FILE"
# The linked worktree: branch side, one commit ahead of the project folder,
# with an active work log that only this branch holds.
git -C "$PROJECT" worktree add -q -b side "$WORKTREE"
mkdir -p "$(dirname "$WORKTREE/$WORKLOG_PATH")"
printf '<!-- Work log: status=active slug=side-log created=2026-10-08 -->\n\n# Work log: side\n' \
  > "$WORKTREE/$WORKLOG_PATH"
git -C "$WORKTREE" add "$WORKLOG_PATH"
commit "$WORKTREE" side

# ── Case 1: variable set, hook started in the project folder ───────────────
label="variable set, started in the project folder"
run_case "$label" "$PROJECT" "$MODE_SET" "$PROJECT"
BASE_SET="$CTX"
expect_project_sections "$label"

# ── Case 2: variable set, hook started in src/ and in docs/ ────────────────
for folder in src docs; do
  label="variable set, started in ${folder}/"
  run_case "$label" "$PROJECT/$folder" "$MODE_SET" "$PROJECT"
  expect_project_sections "$label"
  assert_same "${label}: the output equals the output in the project folder" "$CTX" "$BASE_SET"
done

# ── Case 3: variable set, hook started in the linked worktree ──────────────
label="variable set, started in the linked worktree"
run_case "$label" "$WORKTREE" "$MODE_SET" "$PROJECT"
expect_project_sections "$label"
assert_contains "${label}: the work log notice names the worktree's work log" "$CTX" \
  "Active work logs under ${WORKTREE}: ${WORKLOG_PATH}."

# ── Case 4: variable not set ───────────────────────────────────────────────
label="variable not set, started in the project folder"
run_case "$label" "$PROJECT" "$MODE_UNSET"
assert_same "${label}: the output equals the output with the variable set" "$CTX" "$BASE_SET"
for folder in "$PROJECT/src" "$PROJECT/docs" "$WORKTREE"; do
  name="${folder#"$TMP"/}"
  label="variable not set, started in ${name}"
  run_case "$label" "$folder" "$MODE_UNSET"
  base_unset="$CTX"
  for sentinel in "${ROOT_SENTINELS[@]}"; do
    assert_absent "${label}: the project folder's text ${sentinel} is not injected" "$CTX" "$sentinel"
  done
  if [ "$folder" = "$PROJECT/docs" ]; then
    assert_contains "${label}: the known issues of docs/ are injected" "$CTX" "$DOCS_ISSUE_SENTINEL"
  fi
  # An empty value, then a folder that does not exist: the `cd` of the hook
  # is skipped or fails, and the hook goes on in its own folder.
  for value in "" "$MISSING"; do
    label="variable '${value#"$TMP"/}', started in ${name}"
    run_case "$label" "$folder" "$MODE_SET" "$value"
    assert_same "${label}: the output equals the output with no variable" "$CTX" "$base_unset"
  done
done

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
