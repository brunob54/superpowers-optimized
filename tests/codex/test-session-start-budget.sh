#!/usr/bin/env bash
# Unit test: hooks/session-start keeps its additionalContext at or under
# 10,000 characters, on an empty directory, on a directory whose workspace
# files all fit, and on directories whose workspace files do not all fit.
#
# Why 10,000: Claude Code keeps a hook's additionalContext in the model's
# context only up to 10,000 characters. From 10,001 it writes the text to a
# file and keeps a 2,000-character preview (measured 2026-09-17, worklist row
# 37). Everything past the preview is never read: on this repository that was
# the Entry Sequence, every workspace file and the <superpowers-defaults>
# block that six skills read.
#
# What the hook must do to stay under the budget, and what is asserted here:
#   1. Inject only the first part of skills/using-superpowers/SKILL.md, the
#      text above the marker line; the Skill tool loads the whole file.
#   2. Add workspace files in priority order (state.md, the project-map-stale
#      note, session-log.md, known-issues.md, context-snapshot.json,
#      project-map.md), each whole when it fits the remaining budget, and
#      name the skipped ones with their sizes in one <not-injected> line.
#   3. Keep the <superpowers-defaults> block last and complete.
#   4. Write every section wrapper with real newline bytes, not the two
#      characters backslash and n (a defect of the older wrappers).
#   5. Stay at or under the budget when the <active-work-logs> notice names
#      three work logs with 40-character slugs (case 8).
# The injected skill part is limited to INJECTION_PIN characters, so that it
# cannot exceed the budget again without a test failing.
#
# Self-contained like tests/codex/test-session-start-defaults-block.sh: no
# network (SUPERPOWERS_AUTO_UPDATE=0), a temporary HOME, CLAUDE_PLUGIN_ROOT
# set. The output is parsed with JSON.parse (Node), and lengths are measured
# as JavaScript String.length, the unit Claude Code's limit is measured in.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HOOK="${REPO_ROOT}/hooks/session-start"
SKILL="${REPO_ROOT}/skills/using-superpowers/SKILL.md"
LIMIT=10000
INJECTION_PIN=6400
MARKER="session-start-injection-ends"
OPEN_TAG="<superpowers-defaults>"
CLOSE_TAG="</superpowers-defaults>"
NOT_INJECTED_TAG="<not-injected>"
NL=$'\n'
# The map header hash used by every fixture; it never equals the fixture
# repository's HEAD, so the project-map-stale note is always produced.
STALE_MAP_HASH="0000000"
# The first line of the <session-log> section. It names both files that hold
# older entries: an archive moves the oldest entries to
# session-log-archive.md. OLD_LOG_NOTE is a part of the earlier line, which
# named only session-log.md.
LOG_NOTE='*(Last saved decisions from session-log.md — older entries: grep session-log.md, then session-log-archive.md)*'
OLD_LOG_NOTE="full history searchable"

TMP_HOME=$(mktemp -d)
TMP_EMPTY=$(mktemp -d)
TMP_REPO=$(mktemp -d)
trap 'rm -rf "$TMP_HOME" "$TMP_EMPTY" "$TMP_REPO"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$(( PASS + 1 )); echo "  ok   - $1"; }
bad() { FAIL=$(( FAIL + 1 )); echo "  FAIL - $1"; }

# run_hook_in <dir> [VAR=value ...]: runs the hook with <dir> as the working
# directory, with any extra variable assignments, and prints the
# additionalContext string of the Claude Code output branch. The pipeline
# fails when the output is not valid JSON.
run_hook_in() {
  local dir="$1"
  shift
  local extra=("$@")
  local pass=()
  [ -n "${SYSTEMROOT:-}" ] && pass+=("SYSTEMROOT=$SYSTEMROOT")
  [ -n "${TEMP:-}" ] && pass+=("TEMP=$TEMP")
  (cd "$dir" && env -i PATH="$PATH" HOME="$TMP_HOME" \
      CLAUDE_PLUGIN_ROOT="$REPO_ROOT" SUPERPOWERS_AUTO_UPDATE=0 \
      ${pass[@]+"${pass[@]}"} \
      ${extra[@]+"${extra[@]}"} bash "$HOOK") \
    | node -e '
      const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
      process.stdout.write(j.hookSpecificOutput.additionalContext);'
}

# js_length: prints the JavaScript String.length of standard input.
js_length() {
  node -e 'process.stdout.write(String(require("fs").readFileSync(0, "utf8").length));'
}

# text_of <characters> <prefix>: prints lines of about 90 characters, each
# starting with <prefix>, until the text is at least <characters> long.
text_of() {
  node -e '
    const n = Number(process.argv[1]), p = process.argv[2];
    let s = "", i = 0;
    while (s.length < n) s += p + " line " + (++i) + " abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij\n";
    process.stdout.write(s);' "$1" "$2"
}

expected_block() {
  printf '\n\n%s\nreviewers-per-lens=1\nreview-rounds=3\nbatch-task-cap=3\n%s' "$OPEN_TAG" "$CLOSE_TAG"
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

# assert_common <case label> <context>: the checks every case must pass.
assert_common() {
  local label="$1" ctx="$2" len
  len=$(printf '%s' "$ctx" | js_length)
  if [ "$len" -le "$LIMIT" ]; then
    ok "${label}: ${len} characters, at or under ${LIMIT}"
  else
    bad "${label}: ${len} characters, over ${LIMIT}"
  fi
  case "$ctx" in
    *"$(expected_block)") ok "${label}: the context ends with the complete defaults block" ;;
    *) bad "${label}: the context does not end with the complete defaults block" ;;
  esac
  assert_contains "${label}: </EXTREMELY_IMPORTANT> is present" "$ctx" "</EXTREMELY_IMPORTANT>"
  assert_contains "${label}: the Entry Sequence is injected" "$ctx" "## Entry Sequence"
  assert_contains "${label}: the complexity rules are injected" "$ctx" "### Hard overrides"
  assert_absent "${label}: the skill's front matter is not injected" "$ctx" "name: using-superpowers"
  assert_absent "${label}: the marker line itself is not injected" "$ctx" "$MARKER"
  assert_absent "${label}: text below the marker (the Routing Guide) is not injected" "$ctx" "## Routing Guide"
  # A real newline before each wrapper tag: the older wrappers were built
  # with a bash double-quoted "\n" and reached the model as backslash and n.
  assert_absent "${label}: no literal backslash-n sequence in the context" "$ctx" '\n'
}

# write_map <body text>: a project-map.md under 200 lines with a stale hash.
write_map() {
  printf '# Project Map\n*Generated 2026-01-01 | Git: %s*\n\n## Directory Structure\n%s\n## Critical Constraints\n- none\n\n## Hot Files\n- none\n' "$STALE_MAP_HASH" "$1"
}

# write_snapshot: a small context-snapshot.json in the current directory. Its
# git_hash is the commit that is HEAD there: the hook injects the snapshot
# only when the two are equal (tests/codex/test-session-start-snapshot.sh).
write_snapshot() {
  printf '{"generated_at":"2026-01-01T10:00:00.000Z","git_hash":"%s","changed_files":["snapshot-sentinel.js"],"recent_commits":["abc1234 init"]}\n' \
    "$(git rev-parse HEAD)" > context-snapshot.json
}

clear_workspace() {
  rm -f "$TMP_REPO/state.md" "$TMP_REPO/session-log.md" "$TMP_REPO/known-issues.md" \
        "$TMP_REPO/project-map.md" "$TMP_REPO/context-snapshot.json"
}

echo "session-start: 10,000-character budget"

# ── Case 1: the skill file's injected part ──────────────────────────────────
marker_count=$(grep -c -F -- "$MARKER" "$SKILL" || true)
if [ "$marker_count" -eq 1 ]; then
  ok "SKILL.md carries the marker exactly once"
else
  bad "SKILL.md carries the marker ${marker_count} times, expected exactly 1"
fi
injected_len=$(node -e '
  const fs = require("fs");
  const [file, marker] = process.argv.slice(1);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let i = 0;
  if (lines[0] === "---") { i = 1; while (i < lines.length && lines[i] !== "---") i++; i++; }
  const body = [];
  for (; i < lines.length && !lines[i].includes(marker); i++) body.push(lines[i]);
  process.stdout.write(String(body.join("\n").length));' "$SKILL" "$MARKER")
if [ "$injected_len" -le "$INJECTION_PIN" ]; then
  ok "the injected skill part is ${injected_len} characters, at or under ${INJECTION_PIN}"
else
  bad "the injected skill part is ${injected_len} characters, over ${INJECTION_PIN}"
fi
below_marker=$(sed -n "/${MARKER}/,\$p" "$SKILL")
assert_contains "the Routing Guide stays in the file, below the marker" "$below_marker" "## Routing Guide"

# ── Case 2: empty directory, no git repository ─────────────────────────────
ctx_empty=$(run_hook_in "$TMP_EMPTY")
assert_common "empty directory" "$ctx_empty"
assert_absent "empty directory: nothing is reported as not injected" "$ctx_empty" "$NOT_INJECTED_TAG"

# The remaining cases share one fixture repository with one commit, so that
# the project-map-stale note can be produced. Its output with no workspace
# file gives the free room the later cases size their files against.
(
  cd "$TMP_REPO"
  git init -q
  git -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false \
      commit -q --allow-empty -m init
)
free_room=$(( LIMIT - $(run_hook_in "$TMP_REPO" | js_length) ))

# ── Case 3: every workspace file fits ──────────────────────────────────────
# Five small files: all five sections and the stale note must be injected,
# each wrapper tag on its own line, and no <not-injected> line may appear.
# The <session-log> section starts with LOG_NOTE.
(
  cd "$TMP_REPO"
  printf 'Current Goal: STATE-SENTINEL small fixture, active task\n' > state.md
  printf '## 2026-01-01 10:00 [saved]\nGoal: SESSION-LOG-SENTINEL\n' > session-log.md
  printf '## KNOWN-ISSUES-SENTINEL issue\nfix: none\n' > known-issues.md
  write_map 'PROJECT-MAP-SENTINEL' > project-map.md
  write_snapshot
)
ctx_small=$(run_hook_in "$TMP_REPO")
clear_workspace
assert_common "small workspace files" "$ctx_small"
for tag in state project-map-stale session-log known-issues context-snapshot project-map; do
  assert_contains "small workspace files: <${tag}> is injected on its own line" "$ctx_small" "${NL}<${tag}>"
done
for s in STATE-SENTINEL SESSION-LOG-SENTINEL KNOWN-ISSUES-SENTINEL PROJECT-MAP-SENTINEL snapshot-sentinel.js; do
  assert_contains "small workspace files: ${s} is injected" "$ctx_small" "$s"
done
assert_absent "small workspace files: nothing is reported as not injected" "$ctx_small" "$NOT_INJECTED_TAG"
assert_contains "small workspace files: the <session-log> section starts with the note that names both log files" \
  "$ctx_small" "${NL}<session-log>${NL}${LOG_NOTE}${NL}"
# A search that ignores letter case. A here-string, not a pipe: under
# pipefail, a printf ended early by grep -q would make the pipeline fail.
if grep -qiF -- "$OLD_LOG_NOTE" <<< "$ctx_small"; then
  bad "small workspace files: the output still holds '${OLD_LOG_NOTE}'"
else
  ok "small workspace files: the output does not hold '${OLD_LOG_NOTE}' (any letter case)"
fi

# ── Case 4: priority order ─────────────────────────────────────────────────
# Three files of 60% of the free room each: any one fits alone, no two fit
# together. Only the first in priority order, state.md, may be injected;
# session-log.md and project-map.md must be named in the <not-injected>
# line with their sizes. A hook that adds the files in another order
# injects another file and fails here. The sizing holds while the free
# room is at least 1,375 characters (60% of it then still leaves room for
# the hook's 200-character margin and its 400-character pointer reserve).
part=$(( free_room * 6 / 10 ))
(
  cd "$TMP_REPO"
  { printf 'Current Goal: STATE-SENTINEL priority fixture, active task\n'; text_of "$part" state; } > state.md
  { printf '## 2026-01-01 10:00 [saved]\nGoal: SESSION-LOG-SENTINEL\n'; text_of "$part" log; } > session-log.md
  write_map "PROJECT-MAP-SENTINEL${NL}$(text_of "$part" map)" > project-map.md
)
ctx_prio=$(run_hook_in "$TMP_REPO")
clear_workspace
assert_common "priority order" "$ctx_prio"
assert_contains "priority order: state.md, first in priority, is injected" "$ctx_prio" "STATE-SENTINEL"
assert_contains "priority order: the project-map-stale note is injected" "$ctx_prio" "<project-map-stale>"
assert_absent "priority order: session-log.md content is not injected" "$ctx_prio" "SESSION-LOG-SENTINEL"
assert_absent "priority order: project-map.md content is not injected" "$ctx_prio" "PROJECT-MAP-SENTINEL"
prio_pointer=$(printf '%s' "$ctx_prio" | grep -F -- "$NOT_INJECTED_TAG" || true)
for f in session-log.md project-map.md; do
  assert_contains "priority order: <not-injected> names ${f}" "$prio_pointer" "$f"
done
assert_absent "priority order: <not-injected> does not name state.md" "$prio_pointer" "state.md"
assert_contains "priority order: <not-injected> gives sizes in characters" "$prio_pointer" " characters)"

# ── Case 5: workspace files larger than the whole budget ───────────────────
# session-log.md, known-issues.md and project-map.md are each larger than
# the budget on their own and must be named in the <not-injected> line;
# the small state.md and context-snapshot.json must be injected whole.
# write_oversized_workspace: the workspace files of case 5 in $TMP_REPO;
# case 8 uses them too.
write_oversized_workspace() {
  (
    cd "$TMP_REPO"
    { printf 'Current Goal: STATE-SENTINEL budget fixture, active task\n'; text_of 500 state; } > state.md
    {
      printf '## 2026-01-01 10:00 [saved]\nGoal: SESSION-LOG-SENTINEL one\n'; text_of "$LIMIT" log
      printf '## 2026-01-02 10:00 [saved]\nGoal: SESSION-LOG-SENTINEL two\n'; text_of "$LIMIT" log
    } > session-log.md
    for i in 1 2 3 4 5; do
      printf '## KNOWN-ISSUES-SENTINEL issue %d\n' "$i"; text_of "$(( LIMIT / 4 ))" issue
    done > known-issues.md
    write_map "PROJECT-MAP-SENTINEL${NL}$(text_of "$LIMIT" map)" > project-map.md
    write_snapshot
  )
}
write_oversized_workspace
ctx_full=$(run_hook_in "$TMP_REPO")
clear_workspace
assert_common "oversized workspace files" "$ctx_full"
assert_contains "oversized workspace files: state.md is injected whole" "$ctx_full" "STATE-SENTINEL"
assert_contains "oversized workspace files: the project-map-stale note is injected" "$ctx_full" "<project-map-stale>"
assert_contains "oversized workspace files: context-snapshot.json is injected" "$ctx_full" "snapshot-sentinel.js"
for s in SESSION-LOG-SENTINEL KNOWN-ISSUES-SENTINEL PROJECT-MAP-SENTINEL; do
  assert_absent "oversized workspace files: ${s} content is not injected" "$ctx_full" "$s"
done
full_pointer=$(printf '%s' "$ctx_full" | grep -F -- "$NOT_INJECTED_TAG" || true)
for f in session-log.md known-issues.md project-map.md; do
  assert_contains "oversized workspace files: <not-injected> names ${f}" "$full_pointer" "$f"
done
for f in state.md context-snapshot.json; do
  assert_absent "oversized workspace files: <not-injected> does not name ${f}" "$full_pointer" "$f"
done

# ── Case 6: characters the budget must measure the way Claude Code does ────
# A state.md of 2,150 emoji outside the Basic Multilingual Plane is 2,150
# code points but 4,300 UTF-16 code units and 8,600 UTF-8 bytes. Under a
# UTF-8 locale a bash ${#var} count would let it in and the output would
# exceed the limit (11,573 characters were measured on the first version of
# the budget). The output must stay at or under the limit under both locales.
(
  cd "$TMP_REPO"
  { printf 'Current Goal: STATE-SENTINEL emoji fixture, active task\n'
    node -e 'process.stdout.write("\u{1F534}".repeat(2150) + "\n")'; } > state.md
)
ctx_emoji_utf8=$(run_hook_in "$TMP_REPO" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8)
ctx_emoji_c=$(run_hook_in "$TMP_REPO" LC_ALL=C)
clear_workspace
assert_common "emoji state.md under a UTF-8 locale" "$ctx_emoji_utf8"
assert_common "emoji state.md under the C locale" "$ctx_emoji_c"

# ── Case 7: control characters in a workspace file ─────────────────────────
# A form feed, a bell and \x01 in state.md must not make the JSON invalid
# (the older bash escaper handled only tab, newline and carriage return).
(
  cd "$TMP_REPO"
  printf 'Current Goal: STATE-SENTINEL control fixture, active task\nform feed \f bell \a one \001 end\n' > state.md
)
if ctx_control=$(run_hook_in "$TMP_REPO"); then
  ok "control characters in state.md: the output is valid JSON"
  assert_contains "control characters in state.md: the file is injected" "$ctx_control" "STATE-SENTINEL control fixture"
else
  bad "control characters in state.md: the output is not valid JSON"
fi
clear_workspace

# ── Case 8: three active work logs with 40-character slugs ─────────────────
# The <active-work-logs> notice belongs to the notices, which are always
# included, so its room comes out of the room of the workspace sections.
# With three active 40-character work logs and the oversized workspace files
# of case 5, the output must stay at or under the limit and the whole notice
# must still be present (this fixture's root is a short temporary path, so
# the root-truncation branch of the notice does not fire here).
(
  cd "$TMP_REPO"
  mkdir -p docs/worklogs
  for letter in a b c; do
    slug="${letter}$(printf '%39s' '' | tr ' ' w)"
    printf '<!-- Work log: status=active slug=%s created=2026-09-21 -->\n' "$slug" > "docs/worklogs/${slug}.md"
  done
)
write_oversized_workspace
ctx_worklogs=$(run_hook_in "$TMP_REPO")
clear_workspace
rm -rf "$TMP_REPO/docs"
assert_common "three 40-character work logs" "$ctx_worklogs"
assert_contains "three 40-character work logs: the notice is injected" "$ctx_worklogs" "<active-work-logs>"
for letter in a b c; do
  slug="${letter}$(printf '%39s' '' | tr ' ' w)"
  assert_contains "three 40-character work logs: the $letter slug is named" "$ctx_worklogs" "docs/worklogs/${slug}.md"
done
assert_contains "three 40-character work logs: the notice is closed" "$ctx_worklogs" "</active-work-logs>"

# ── Case 9: the room left for files must count the notice's own size ───────
# Reuses the three 40-character work logs of case 8, alone (no other
# workspace files yet), to measure the room the notice for them leaves:
# room_with_notice = LIMIT minus the output length with only that notice
# added. notice_size is how much smaller that room is than free_room (the
# room with no notice, measured before case 3). A single state.md is then
# sized to room_with_notice raw characters: its own wrapper (an opening tag
# and a heading line) always makes the wrapped section a few dozen to about
# two hundred characters longer than the raw text, which is enough to place
# it just over the true room (so a budget that counts the notice correctly
# skips it and stays at or under the limit with the whole notice present),
# while staying under the true room plus the notice's own size (so a budget
# that leaves the notice out of its count would find room for it and take
# the output over the limit). This fails when the budget leaves the notice
# out of its count, and passes on the branch.
(
  cd "$TMP_REPO"
  mkdir -p docs/worklogs
  for letter in a b c; do
    slug="${letter}$(printf '%39s' '' | tr ' ' w)"
    printf '<!-- Work log: status=active slug=%s created=2026-09-21 -->\n' "$slug" > "docs/worklogs/${slug}.md"
  done
)
room_with_notice=$(( LIMIT - $(run_hook_in "$TMP_REPO" | js_length) ))
notice_size=$(( free_room - room_with_notice ))
(
  cd "$TMP_REPO"
  { printf 'Current Goal: STATE-SENTINEL room fixture, active task\n'; text_of "$room_with_notice" state; } > state.md
)
ctx_room=$(run_hook_in "$TMP_REPO")
clear_workspace
rm -rf "$TMP_REPO/docs"
assert_common "the room left counts the notice" "$ctx_room"
assert_contains "the room left counts the notice: the notice is injected" "$ctx_room" "<active-work-logs>"
for letter in a b c; do
  slug="${letter}$(printf '%39s' '' | tr ' ' w)"
  assert_contains "the room left counts the notice: the $letter slug is named" "$ctx_room" "docs/worklogs/${slug}.md"
done
assert_contains "the room left counts the notice: the notice is closed" "$ctx_room" "</active-work-logs>"
assert_absent "the room left counts the notice: state.md content is not injected" "$ctx_room" "STATE-SENTINEL"
room_pointer=$(printf '%s' "$ctx_room" | grep -F -- "$NOT_INJECTED_TAG" || true)
assert_contains "the room left counts the notice: <not-injected> names state.md" "$room_pointer" "state.md"
echo "  (room_with_notice=${room_with_notice}, notice_size=${notice_size})"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
