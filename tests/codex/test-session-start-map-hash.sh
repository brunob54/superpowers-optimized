#!/usr/bin/env bash
# Unit test: the stale note for project-map.md in hooks/session-start.
#
# The header of project-map.md records a commit hash ("Git: <hash>"). The
# context-management skill records `git rev-parse --short HEAD`, and the
# length of a short hash grows with the number of objects in the repository
# (7 characters, then 8, and so on). The hook therefore reports a stale map
# only when the map hash is not the start of the full hash of HEAD. The note
# gives HEAD in the short form.
#
# Cases:
#   1. The map holds the full HEAD, `--short` HEAD, or `--short=8` HEAD: no
#      "project-map.md is stale" text.
#   2. The map holds the hash of HEAD~1, cut to 7 characters or whole (40),
#      or HEAD with one more character: the exact note, with HEAD in the
#      short form.
#   3. A repository with no commit: no note, and no "current HEAD is HEAD"
#      text (`git rev-parse HEAD` prints the word HEAD there).
#
# The checks look for the text "project-map.md is stale", never for the tag
# <project-map-stale>: the first part of the using-superpowers skill, which
# the hook always injects, holds that tag.
#
# Self-contained like tests/codex/test-session-start-budget.sh: no network
# (SUPERPOWERS_AUTO_UPDATE=0), a temporary HOME, CLAUDE_PLUGIN_ROOT set. Every
# run starts from an empty environment (env -i) and sets CLAUDE_PROJECT_DIR
# explicitly to the folder where the hook starts. The output is parsed with
# JSON.parse (Node).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HOOK="${REPO_ROOT}/hooks/session-start"
STALE_TEXT="project-map.md is stale"
MAP_SENTINEL="MAP-HASH-SENTINEL"

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

# run_case <label> <dir> <map hash>: writes project-map.md with the header
# "Git: <map hash>" into <dir>, then runs the hook in <dir> with
# CLAUDE_PROJECT_DIR set to <dir>. Checks exit status 0, an empty standard
# error and that the map itself is injected, and sets CTX to the
# additionalContext string of the Claude Code output branch. A hook that ends
# before it writes its JSON output counts as one failure and leaves CTX
# empty, so the assertions of the case still run and report.
run_case() {
  local label="$1" dir="$2"
  local raw="${TMP}/hook-output.json"
  local err="${TMP}/hook-error.txt"
  local pass=()
  printf '# Project Map\n_Generated: 2026-10-08 10:00 | Git: %s_\n\n## Critical Constraints\n- %s\n' \
    "$3" "$MAP_SENTINEL" > "$dir/project-map.md"
  [ -n "${SYSTEMROOT:-}" ] && pass+=("SYSTEMROOT=$SYSTEMROOT")
  [ -n "${TEMP:-}" ] && pass+=("TEMP=$TEMP")
  local code=0
  (cd "$dir" && env -i PATH="$PATH" HOME="$TMP_HOME" GIT_CEILING_DIRECTORIES="$TMP" \
      CLAUDE_PLUGIN_ROOT="$REPO_ROOT" SUPERPOWERS_AUTO_UPDATE=0 CLAUDE_PROJECT_DIR="$dir" \
      ${pass[@]+"${pass[@]}"} bash "$HOOK") > "$raw" 2> "$err" || code=$?
  assert_eq "${label}: exit status 0" "$code" "0"
  assert_eq "${label}: nothing on standard error" "$(cat "$err")" ""
  CTX=$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(j.hookSpecificOutput.additionalContext);' "$raw" 2>/dev/null) \
    || { CTX=""; bad "${label}: the hook wrote no valid JSON output"; }
  assert_contains "${label}: the map is injected" "$CTX" "$MAP_SENTINEL"
}

# commit <dir> <message>: one more empty commit in <dir>.
commit() {
  git -C "$1" -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false \
      commit -q --allow-empty -m "$2"
}

echo "session-start: the stale note for the hash of project-map.md"

REPO="${TMP}/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
commit "$REPO" first
commit "$REPO" second
HEAD_FULL=$(git -C "$REPO" rev-parse HEAD)
HEAD_SHORT=$(git -C "$REPO" rev-parse --short HEAD)
PARENT_FULL=$(git -C "$REPO" rev-parse HEAD~1)
PARENT_SHORT="${PARENT_FULL:0:7}"

# ── Case 1: a map hash that is the start of HEAD ───────────────────────────
for map_hash in "$HEAD_FULL" "$HEAD_SHORT" "$(git -C "$REPO" rev-parse --short=8 HEAD)"; do
  label="map hash of ${#map_hash} characters from HEAD"
  run_case "$label" "$REPO" "$map_hash"
  assert_absent "${label}: no '${STALE_TEXT}' text" "$CTX" "$STALE_TEXT"
done

# ── Case 2: a map hash that is not the start of HEAD ───────────────────────
# HEAD with one more character: HEAD is the start of the map hash, but the
# map hash is not the start of HEAD.
for map_hash in "$PARENT_SHORT" "$PARENT_FULL" "${HEAD_FULL}0"; do
  label="map hash of ${#map_hash} characters, not the start of HEAD"
  run_case "$label" "$REPO" "$map_hash"
  assert_contains "${label}: the note, with HEAD in the short form" "$CTX" \
    "${STALE_TEXT} — map records Git: ${map_hash} but current HEAD is ${HEAD_SHORT}."
done

# ── Case 3: a repository with no commit ────────────────────────────────────
UNBORN="${TMP}/unborn"
mkdir -p "$UNBORN"
git -C "$UNBORN" init -q
label="repository with no commit"
run_case "$label" "$UNBORN" "$PARENT_SHORT"
assert_absent "${label}: no '${STALE_TEXT}' text" "$CTX" "$STALE_TEXT"
assert_absent "${label}: no 'current HEAD is HEAD' text" "$CTX" "current HEAD is HEAD"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
