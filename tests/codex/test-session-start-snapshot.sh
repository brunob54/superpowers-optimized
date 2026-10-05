#!/usr/bin/env bash
# Unit test: the <context-snapshot> block of hooks/session-start.
#
# hooks/context-engine.js writes context-snapshot.json. Claude Code starts
# every hook of one event at the same moment, so hooks/session-start reads
# the file before the engine of the same event has written it: the file that
# the hook reads is the snapshot of an EARLIER event. The hook therefore
# injects the block only when the snapshot records the commit that is HEAD
# now (field git_hash, compared with `git rev-parse HEAD`), and the block
# states when the snapshot was taken, because two of its statements (the
# blast radius, and the commits made since the snapshot before it) are not
# decided by the commit alone.
#
# Cases:
#   1. Equal hash: the exact block, with the time of the snapshot in its
#      first line.
#   2. Equal hash, and the snapshot counts commits made since the snapshot
#      before it: the exact block; the file list is printed once.
#   3. A new commit after the snapshot (the old hash): the same output as
#      with no file. An assertion "the block is absent" alone would also pass
#      on a hook that printed a note, so every case without a block compares
#      the whole output with the output of the same folder with no file.
#   4. A hash that is a prefix of HEAD, and a hash that starts with HEAD.
#   5. No git_hash field; an empty git_hash.
#   6. A file cut in the middle (the engine is writing it).
#   7. A repository with no commit, with three values of git_hash.
#   8. A folder that is not a repository.
#   9. No time in the snapshot, or a text that is not a time.
#  10. Equal hash and no changed file: no block.
#  11. The hook starts in a sub-folder of the repository.
#  12. A snapshot too large for the output budget: named in <not-injected>
#      when its hash is HEAD, not named when its hash is old; the output
#      stays at or under 10,000 characters.
#  13. The two skills that read the file compare git_hash with HEAD.
#
# Self-contained like tests/codex/test-session-start-budget.sh: no network
# (SUPERPOWERS_AUTO_UPDATE=0), a temporary HOME, CLAUDE_PLUGIN_ROOT set. The
# output is parsed with JSON.parse (Node).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HOOK="${REPO_ROOT}/hooks/session-start"
SNAPSHOT_FILE="context-snapshot.json"
OPEN_TAG="<context-snapshot>"
CLOSE_TAG="</context-snapshot>"
NOT_INJECTED_TAG="<not-injected>"
LIMIT=10000
NL=$'\n'
# The time that every fixture snapshot records, and the form the block gives it.
TAKEN_FIELD="2026-01-02T03:04:05.678Z"
TAKEN_TEXT="2026-01-02 03:04 UTC"
HEADING="Snapshot taken ${TAKEN_TEXT} at the commit that is HEAD now."
COMMITS_LINES="Recent commits:${NL}  abc1234 RECENT-SENTINEL"
BLAST_LINES="Blast radius at the time of the snapshot (dependents to review):${NL}  snapshot-sentinel.js → dependent-sentinel.js"
SKILL_COMPARE='run `git rev-parse HEAD` and compare to `git_hash` in the file'

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

# run_hook <dir>: runs the hook with <dir> as the working directory. Sets
# HOOK_CODE to its exit status, HOOK_ERR to its standard error and CTX to the
# additionalContext string of the Claude Code output branch. A hook that ends
# before it writes its JSON output counts as one failure and leaves CTX
# empty, so the assertions of the case still run and report.
run_hook() {
  local raw="${TMP}/hook-output.json"
  local err="${TMP}/hook-error.txt"
  local pass=()
  [ -n "${SYSTEMROOT:-}" ] && pass+=("SYSTEMROOT=$SYSTEMROOT")
  [ -n "${TEMP:-}" ] && pass+=("TEMP=$TEMP")
  HOOK_CODE=0
  (cd "$1" && env -i PATH="$PATH" HOME="$TMP_HOME" GIT_CEILING_DIRECTORIES="$TMP" \
      CLAUDE_PLUGIN_ROOT="$REPO_ROOT" SUPERPOWERS_AUTO_UPDATE=0 \
      ${pass[@]+"${pass[@]}"} bash "$HOOK") > "$raw" 2> "$err" || HOOK_CODE=$?
  HOOK_ERR=$(cat "$err")
  CTX=$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(j.hookSpecificOutput.additionalContext);' "$raw" 2>/dev/null) \
    || { CTX=""; bad "the hook wrote no valid JSON output (exit status ${HOOK_CODE})"; }
}

# block: prints the text between the two tags of the block in $CTX, or the
# word ABSENT.
block() {
  printf '%s' "$CTX" | node -e '
    const [open, close] = process.argv.slice(1);
    const ctx = require("fs").readFileSync(0, "utf8");
    const from = ctx.indexOf("\n" + open + "\n");
    const to = ctx.indexOf("\n" + close);
    process.stdout.write(from < 0 || to < from ? "ABSENT" : ctx.slice(from + open.length + 2, to));' \
    "$OPEN_TAG" "$CLOSE_TAG"
}

# js_length: prints the JavaScript String.length of standard input.
js_length() {
  node -e 'process.stdout.write(String(require("fs").readFileSync(0, "utf8").length));'
}

# commit <dir> <message>: one more commit in <dir>.
commit() {
  git -C "$1" -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false \
      commit -q --allow-empty -m "$2"
}

# head_of <dir>: prints the full hash of the commit that is HEAD in <dir>.
head_of() {
  git -C "$1" rev-parse HEAD
}

# write_snapshot <dir> <git_hash> [<JSON object>]: a snapshot file in <dir>
# with the fields that the engine writes. The JSON object replaces fields; a
# field whose value is null is left out of the file.
write_snapshot() {
  node -e '
    const [dir, file, hash, taken, extra] = process.argv.slice(1);
    const snapshot = Object.assign({
      generated_at: taken,
      git_hash: hash,
      changed_files: ["snapshot-sentinel.js"],
      change_stat: "",
      recent_commits: ["abc1234 RECENT-SENTINEL"],
      blast_radius: { "snapshot-sentinel.js": ["dependent-sentinel.js"] },
      cross_session_files: [],
      cross_session_commit_count: 0,
    }, JSON.parse(extra || "{}"));
    for (const key of Object.keys(snapshot)) if (snapshot[key] === null) delete snapshot[key];
    require("fs").writeFileSync(require("path").join(dir, file), JSON.stringify(snapshot, null, 2));' \
    "$1" "$SNAPSHOT_FILE" "$2" "$TAKEN_FIELD" "${3:-}"
}

# expect_no_block <label> <dir> <context of <dir> with no file>: the hook ends
# with status 0, prints nothing on standard error, and its output is the same
# as with no snapshot file. Removes the snapshot file afterwards.
expect_no_block() {
  run_hook "$2"
  assert_eq "$1: exit status 0" "$HOOK_CODE" "0"
  assert_eq "$1: nothing on standard error" "$HOOK_ERR" ""
  if [ "$CTX" = "$3" ]; then
    ok "$1: the output is the same as with no snapshot file"
  else
    bad "$1: the output differs from the output with no snapshot file (block: $(block))"
  fi
  rm -f "$2/$SNAPSHOT_FILE"
}

echo "session-start: the context-snapshot block"

REPO="${TMP}/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
commit "$REPO" first
commit "$REPO" second
OLD_HEAD=$(git -C "$REPO" rev-parse HEAD~1)
HEAD_NOW=$(head_of "$REPO")

run_hook "$REPO"
BASE_REPO="$CTX"
assert_eq "no snapshot file: exit status 0" "$HOOK_CODE" "0"
assert_eq "no snapshot file: nothing on standard error" "$HOOK_ERR" ""
assert_eq "no snapshot file: no block" "$(block)" "ABSENT"
assert_absent "no snapshot file: the output does not name the file" "$BASE_REPO" "$SNAPSHOT_FILE"

# ── Case 1: equal hash ──────────────────────────────────────────────────────
write_snapshot "$REPO" "$HEAD_NOW"
run_hook "$REPO"
assert_eq "equal hash: exit status 0" "$HOOK_CODE" "0"
assert_eq "equal hash: the exact block" "$(block)" \
  "${HEADING}${NL}Files changed by the newest commit: snapshot-sentinel.js${NL}${COMMITS_LINES}${NL}${BLAST_LINES}"
assert_absent "equal hash: nothing is reported as not injected" "$CTX" "$NOT_INJECTED_TAG"
# The labels of the older block. "Changed since last commit" was printed for
# a list whose base could be an earlier session start.
assert_absent "equal hash: the label 'Changed since last commit' is gone" "$CTX" "Changed since last commit"
assert_absent "equal hash: the label 'Changed since last session' is gone" "$CTX" "Changed since last session"
rm -f "$REPO/$SNAPSHOT_FILE"

# A time with another offset is printed as Coordinated Universal Time (UTC).
write_snapshot "$REPO" "$HEAD_NOW" '{"generated_at":"2026-01-02T05:04:05+02:00"}'
run_hook "$REPO"
assert_contains "a time with the offset +02:00 is printed in UTC" "$(block)" "$HEADING"
rm -f "$REPO/$SNAPSHOT_FILE"

# ── Case 2: commits made since the snapshot before this one ────────────────
# The engine then writes the same list to changed_files and to
# cross_session_files; the block prints it once.
write_snapshot "$REPO" "$HEAD_NOW" \
  '{"changed_files":["snapshot-sentinel.js","second-sentinel.js"],"cross_session_files":["snapshot-sentinel.js","second-sentinel.js"],"cross_session_commit_count":2}'
run_hook "$REPO"
assert_eq "commits since the snapshot before: the exact block" "$(block)" \
  "${HEADING}${NL}Commits made between the snapshot before this one and this one: 2. Files they changed: snapshot-sentinel.js, second-sentinel.js${NL}${COMMITS_LINES}${NL}${BLAST_LINES}"
rm -f "$REPO/$SNAPSHOT_FILE"

# One commit: the same wording, because the base of the list is the snapshot
# before, also when that is the commit before HEAD.
write_snapshot "$REPO" "$HEAD_NOW" '{"cross_session_files":["snapshot-sentinel.js"],"cross_session_commit_count":1}'
run_hook "$REPO"
assert_contains "one commit since the snapshot before: the count is 1" "$(block)" \
  "Commits made between the snapshot before this one and this one: 1. Files they changed: snapshot-sentinel.js${NL}"
assert_absent "one commit since the snapshot before: not called the newest commit" "$(block)" "newest commit"
rm -f "$REPO/$SNAPSHOT_FILE"

# ── Case 3: the old hash ───────────────────────────────────────────────────
write_snapshot "$REPO" "$OLD_HEAD"
expect_no_block "old hash (the commit before HEAD)" "$REPO" "$BASE_REPO"

# The same file is injected, then a commit is made: the comparison is with
# the HEAD of this moment, not with a stored value.
MOVING="${TMP}/moving"
mkdir -p "$MOVING"
git -C "$MOVING" init -q
commit "$MOVING" first
write_snapshot "$MOVING" "$(head_of "$MOVING")"
run_hook "$MOVING"
assert_contains "before a new commit: the block is injected" "$(block)" "$HEADING"
commit "$MOVING" second
run_hook "$MOVING"
assert_eq "after a new commit: the same file gives no block" "$(block)" "ABSENT"
assert_absent "after a new commit: no text of the snapshot is injected" "$CTX" "snapshot-sentinel.js"
assert_absent "after a new commit: the output does not name the file" "$CTX" "$SNAPSHOT_FILE"

# ── Case 4: a part of the hash is not the hash ─────────────────────────────
write_snapshot "$REPO" "$(printf '%s' "$HEAD_NOW" | cut -c1-7)"
expect_no_block "hash cut to 7 characters" "$REPO" "$BASE_REPO"
write_snapshot "$REPO" "${HEAD_NOW}0"
expect_no_block "hash with one more character" "$REPO" "$BASE_REPO"

# ── Case 5: no hash ────────────────────────────────────────────────────────
write_snapshot "$REPO" "" '{"git_hash":null}'
expect_no_block "no git_hash field" "$REPO" "$BASE_REPO"
write_snapshot "$REPO" ""
expect_no_block "empty git_hash" "$REPO" "$BASE_REPO"

# ── Case 6: a file cut in the middle ───────────────────────────────────────
write_snapshot "$REPO" "$HEAD_NOW"
node -e '
  const fs = require("fs");
  const text = fs.readFileSync(process.argv[1], "utf8");
  fs.writeFileSync(process.argv[1], text.slice(0, Math.floor(text.length / 2)));' "$REPO/$SNAPSHOT_FILE"
expect_no_block "file cut in the middle" "$REPO" "$BASE_REPO"
: > "$REPO/$SNAPSHOT_FILE"
expect_no_block "empty file" "$REPO" "$BASE_REPO"

# ── Case 7: a repository with no commit ────────────────────────────────────
# `git rev-parse HEAD` fails there and prints the word HEAD on standard
# output; neither that word nor an empty text may count as an equal hash.
UNBORN="${TMP}/unborn"
mkdir -p "$UNBORN"
git -C "$UNBORN" init -q
run_hook "$UNBORN"
BASE_UNBORN="$CTX"
write_snapshot "$UNBORN" ""
expect_no_block "no commit, empty git_hash (what the engine writes there)" "$UNBORN" "$BASE_UNBORN"
write_snapshot "$UNBORN" "HEAD"
expect_no_block "no commit, git_hash is the word HEAD" "$UNBORN" "$BASE_UNBORN"
write_snapshot "$UNBORN" "$HEAD_NOW"
expect_no_block "no commit, git_hash of another repository" "$UNBORN" "$BASE_UNBORN"

# ── Case 8: a folder that is not a repository ──────────────────────────────
PLAIN="${TMP}/plain"
mkdir -p "$PLAIN"
run_hook "$PLAIN"
BASE_PLAIN="$CTX"
write_snapshot "$PLAIN" "$HEAD_NOW"
expect_no_block "not a repository, git_hash of a repository" "$PLAIN" "$BASE_PLAIN"
write_snapshot "$PLAIN" ""
expect_no_block "not a repository, empty git_hash" "$PLAIN" "$BASE_PLAIN"

# ── Case 9: no time in the snapshot ────────────────────────────────────────
# Without the time the block could not say which moment its blast radius
# describes, so the hook injects no block.
write_snapshot "$REPO" "$HEAD_NOW" '{"generated_at":null}'
expect_no_block "equal hash, no generated_at field" "$REPO" "$BASE_REPO"
write_snapshot "$REPO" "$HEAD_NOW" '{"generated_at":"not a time"}'
expect_no_block "equal hash, generated_at is not a time" "$REPO" "$BASE_REPO"
# JavaScript reads the number 0 as the first second of the year 1970.
write_snapshot "$REPO" "$HEAD_NOW" '{"generated_at":0}'
expect_no_block "equal hash, generated_at is a number" "$REPO" "$BASE_REPO"

# ── Case 10: no changed file ───────────────────────────────────────────────
write_snapshot "$REPO" "$HEAD_NOW" '{"changed_files":[],"blast_radius":{}}'
expect_no_block "equal hash, no changed file" "$REPO" "$BASE_REPO"

# ── Case 11: the hook starts in a sub-folder ───────────────────────────────
# The engine writes the file into the folder of the session, and the hook
# reads it there; HEAD is the HEAD of the repository around that folder.
mkdir -p "$REPO/sub"
write_snapshot "$REPO/sub" "$HEAD_NOW"
run_hook "$REPO/sub"
assert_contains "sub-folder, equal hash: the block is injected" "$(block)" "$HEADING"
write_snapshot "$REPO/sub" "$OLD_HEAD"
run_hook "$REPO/sub"
assert_eq "sub-folder, old hash: no block" "$(block)" "ABSENT"
rm -rf "$REPO/sub"

# ── Case 12: a snapshot too large for the budget ───────────────────────────
MANY=$(node -e '
  const names = [];
  for (let i = 0; i < 400; i++) names.push("folder/large-fixture-" + i + ".js");
  process.stdout.write(JSON.stringify({ changed_files: names }));')
write_snapshot "$REPO" "$HEAD_NOW" "$MANY"
run_hook "$REPO"
large_len=$(printf '%s' "$CTX" | js_length)
if [ "$large_len" -le "$LIMIT" ]; then
  ok "large snapshot, equal hash: ${large_len} characters, at or under ${LIMIT}"
else
  bad "large snapshot, equal hash: ${large_len} characters, over ${LIMIT}"
fi
assert_eq "large snapshot, equal hash: no block" "$(block)" "ABSENT"
large_pointer=$(printf '%s' "$CTX" | grep -F -- "$NOT_INJECTED_TAG" || true)
assert_contains "large snapshot, equal hash: <not-injected> names the file" "$large_pointer" "${SNAPSHOT_FILE} ("
assert_contains "large snapshot, equal hash: <not-injected> gives the size in characters" "$large_pointer" " characters)"
write_snapshot "$REPO" "$OLD_HEAD" "$MANY"
expect_no_block "large snapshot, old hash (not named in <not-injected>)" "$REPO" "$BASE_REPO"

# ── Case 13: the skills that read the file ─────────────────────────────────
# The file on disk describes the last session start; after a commit made in
# the session it is old. Both skills compare its hash with HEAD first.
for skill in requesting-code-review systematic-debugging; do
  text=$(cat "${REPO_ROOT}/skills/${skill}/SKILL.md")
  assert_contains "skill ${skill}: compares git_hash with HEAD" "$text" "$SKILL_COMPARE"
  assert_contains "skill ${skill}: names the equal case" "$text" '**Hashes match (fresh):**'
  assert_contains "skill ${skill}: names the unequal case" "$text" '**Hashes differ (stale):**'
done
debugging=$(cat "${REPO_ROOT}/skills/systematic-debugging/SKILL.md")
assert_contains "skill systematic-debugging: an old snapshot is not used" "$debugging" \
  '**Hashes differ (stale):** the snapshot is from a previous commit; do not use it'
assert_absent "skill systematic-debugging: the file is not read without the comparison" "$debugging" \
  'exists at the project root: read it.'

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
