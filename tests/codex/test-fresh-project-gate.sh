#!/usr/bin/env bash
# Unit test: the fresh project gate of skills/using-superpowers/SKILL.md
# (the section "## Fresh project gate" in the second part of the skill)
# checks for a git repository before it offers or runs `git init`.
#
# The defect that this test guards against (item 14, design record of
# 2026-10-06): the gate ran `git init --quiet` on every confirm. In a
# sub-folder of an existing repository, this created a second repository
# inside the first one. A commit made in a tracked sub-folder then went to
# the inner repository. A later `git add -A` in the outer repository
# committed a gitlink (mode 160000, a pointer to the inner repository) and
# none of the files of a new sub-folder.
#
# What is asserted:
#   1. Behaviour. The check command is copied out of the skill text, so a
#      change of the command in the skill changes what this test runs. It
#      runs in scratch folders and repositories, and its output must give
#      the outcome that the skill names for each folder: the output contains
#      "not a git repository", the output is a folder path (the top folder
#      of the repository), or any other output (an error).
#   2. Wording. The check stands before the quoted message. Each outcome has
#      its sentence. The confirm line runs `git init --quiet` only on "not a
#      git repository", or for a separate repository that the user asked
#      for, with the embedded-repository warning. The context-snapshot.json
#      note applies only when the check printed "not a git repository".
#      context-management writes
#      project-map.md in the session folder.
#   3. Size. The whole skill file stays at or under 20,000 characters, the
#      part of a skill that Claude Code attaches again after a compaction,
#      so the gate text is never cut off.
# The first part of the skill (the text that hooks/session-start injects)
# is pinned by tests/codex/test-session-start-budget.sh, not here.
#
# Self-contained: every scratch repository is built in one temporary
# folder, with a temporary HOME, no system git configuration and
# GIT_CEILING_DIRECTORIES set to the temporary folder, so that no repository
# above it and no setting of the user changes an outcome.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SKILL="${REPO_ROOT}/skills/using-superpowers/SKILL.md"
GATE_HEADING='## Fresh project gate (Entry Sequence step 2, full text)'
# The first line of the quoted message of the gate.
MESSAGE_START='> Before I start:'
NOT_A_REPO='not a git repository'
GIT_INIT_RUN='git init --quiet'
SNAPSHOT_FILE='context-snapshot.json'
# Claude Code attaches about the first 20,000 characters of an invoked skill
# again after a compaction (tests/claude-code/compaction-probe.md).
REATTACH_LIMIT=20000
# The three outcomes of the check, as the skill text names them.
OUT_NONE='no repository'
OUT_FOLDER='folder path'
OUT_ERROR='other output'

# `pwd -P`: git prints the physical path of a top folder (on macOS the
# temporary folder is under /var, a symbolic link to /private/var).
TMP_ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP_ROOT"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$(( PASS + 1 )); echo "  ok   - $1"; }
bad() { FAIL=$(( FAIL + 1 )); echo "  FAIL - $1"; }

# gate_section: prints the section of the gate, from its heading to the line
# before the next "## " heading.
gate_section() {
  awk -v h="$GATE_HEADING" '$0 == h { on = 1; print; next } on && /^## / { exit } on { print }' "$SKILL"
}

# fold: joins the lines of standard input with one space and removes the
# blanks at the start and the end of each line, so that a sentence that a
# line break splits still matches as one fixed string.
fold() {
  awk '{ line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line); if (NR > 1) printf " "; printf "%s", line } END { print "" }'
}

GATE="$(gate_section)"
GATE_FOLDED="$(printf '%s\n' "$GATE" | fold)"

# assert_gate_has <label> <fixed string>: the folded gate section holds it.
assert_gate_has() {
  case "$GATE_FOLDED" in
    *"$2"*) ok "$1" ;;
    *) bad "$1 (missing: $2)" ;;
  esac
}

# assert_gate_count <label> <fixed string> <expected number>: the folded gate
# section holds the string exactly that many times.
assert_gate_count() {
  local count
  count=$(printf '%s\n' "$GATE_FOLDED" | awk -v s="$2" '{ n = 0; t = $0; while ((i = index(t, s)) > 0) { n++; t = substr(t, i + length(s)) } print n }')
  if [ "$count" -eq "$3" ]; then
    ok "$1"
  else
    bad "$1 (found ${count} times, expected $3: $2)"
  fi
}

# first_line_of <pattern>: prints the number of the first line of the gate
# section that matches the extended regular expression, or 0.
first_line_of() {
  printf '%s\n' "$GATE" | awk -v p="$1" '$0 ~ p { print NR; found = 1; exit } END { if (!found) print 0 }'
}

# The check command: the content of the first fenced code block of the gate
# section.
CHECK_CMD="$(printf '%s\n' "$GATE" | awk '/^```/ { if (on) exit; on = 1; next } on { print }')"

# outcome_of <output>: the outcome that the skill text gives to an output of
# the check. A folder path is one line that names a folder that exists.
outcome_of() {
  case "$1" in
    *"$NOT_A_REPO"*) echo "$OUT_NONE"; return ;;
    *$'\n'*) echo "$OUT_ERROR"; return ;;
  esac
  if [ -n "$1" ] && [ -d "$1" ]; then echo "$OUT_FOLDER"; else echo "$OUT_ERROR"; fi
}

# run_check <folder> [VAR=value ...]: runs the check command in <folder>,
# with any extra variable assignments, and prints its output. A non-zero
# exit code of the check is expected in some folders and is not a failure.
run_check() {
  local dir="$1"
  shift
  (cd "$dir" && env ${@+"$@"} bash -c "$CHECK_CMD") 2>&1 || true
}

# assert_outcome <label> <folder> <outcome> <top folder or empty> [VAR=value ...]
assert_outcome() {
  local label="$1" dir="$2" want="$3" top="$4" out got
  shift 4
  out="$(run_check "$dir" ${@+"$@"})"
  got="$(outcome_of "$out")"
  if [ "$got" != "$want" ]; then
    bad "${label}: outcome '${got}', expected '${want}' (output: ${out})"
  elif [ -n "$top" ] && [ "$out" != "$top" ]; then
    bad "${label}: the check printed ${out}, expected the top folder ${top}"
  else
    ok "${label}: outcome '${want}'"
  fi
}

echo "using-superpowers: fresh project gate checks for a git repository"

# ── Wording ────────────────────────────────────────────────────────────────
if [ -n "$GATE" ]; then
  ok "the skill has the section: ${GATE_HEADING}"
else
  bad "the skill has no section: ${GATE_HEADING}"
fi

check_lines=$(printf '%s\n' "$CHECK_CMD" | awk 'NF { n++ } END { print n + 0 }')
if [ "$check_lines" -eq 1 ]; then
  ok "the first code block of the gate holds one command: ${CHECK_CMD}"
else
  bad "the first code block of the gate holds ${check_lines} non-empty lines, expected one command"
fi

# The skill matches the English text "not a git repository". LC_ALL=C makes
# git print its messages in English under every locale. This machine may have
# no git translations, so the behaviour cases below cannot show the need.
case "$CHECK_CMD" in
  "LC_ALL=C "*) ok "the check command sets LC_ALL=C, so git prints its messages in English" ;;
  *) bad "the check command does not start with LC_ALL=C: ${CHECK_CMD}" ;;
esac

fence_line=$(first_line_of '^```')
message_line=$(first_line_of "^${MESSAGE_START}")
if [ "$fence_line" -gt 0 ] && [ "$message_line" -gt "$fence_line" ]; then
  ok "the check (line ${fence_line} of the section) stands before the quoted message (line ${message_line})"
else
  bad "the check (line ${fence_line} of the section) does not stand before the quoted message (line ${message_line})"
fi

# The three outcomes are the only bullets before the message. An added bullet
# (for example a second rule for a folder path) would contradict them.
outcome_bullets=$(printf '%s\n' "$GATE" | awk -v last="$message_line" 'NR < last && /^- \*\*/ { n++ } END { print n + 0 }')
if [ "$outcome_bullets" -eq 3 ]; then
  ok "the gate lists exactly three outcomes before the message"
else
  bad "the gate lists ${outcome_bullets} bullets before the message, expected the three outcomes"
fi

assert_gate_has "the gate runs the check first, in the session folder" \
  'When both conditions of Entry Sequence step 2 are true, first run this check in the session folder (the folder the session was opened in), before you show the message below:'
assert_gate_has "the gate tells the model to read the output of the check" \
  'Read the output of the check. It decides the `git init` line of the message and what you run on confirm:'
assert_gate_has "outcome 'not a git repository': the message as written" \
  "- **The output contains \`${NOT_A_REPO}\`:** no git repository holds this folder. Show the message as written."
assert_gate_has "outcome 'folder path': the folder is inside that repository" \
  '- **The output is a folder path:** this folder is already inside the git repository at that path.'
assert_gate_has "outcome 'folder path': the replacement line of the message" \
  'In the message, replace the `git init` line with this line: "- git: this folder is already inside the git repository at <path>; I will not create another one. If you want a separate repository for this folder, say so." (<path> is the output of the check.)'
assert_gate_has "outcome 'folder path': the reason not to run git init" \
  'The reason: a `git init` here creates a second repository inside the first one, and later commits go to the wrong repository.'
assert_gate_has "outcome 'other output': no git init line, quote the error, no git init" \
  '- **Any other output (an error):** leave the `git init` line out of the message, quote the error to the user, and run no `git init`.'
assert_gate_has "the message stays the same except for the git init line" \
  'Then **pause before proceeding** and tell the user exactly this, with the `git init` line changed as the check decided:'

assert_gate_has "the confirm line runs git init only on 'not a git repository'" \
  "- **If they confirm:** run \`${GIT_INIT_RUN}\` only when the check printed \`${NOT_A_REPO}\` (do not ask again — the user just confirmed)."
assert_gate_has "the confirm line: no git init in every other case, except a separate repository" \
  "In every other case, run no \`git init\`, unless the user asked for a separate repository: then run \`${GIT_INIT_RUN}\` and tell the user this: a \`git add -A\` in the outer repository records this folder as an embedded repository (a pointer to the new repository, without any of its files), unless the outer repository ignores this folder."
assert_gate_count "the gate names \`${GIT_INIT_RUN}\` only in its two conditional sentences" \
  "\`${GIT_INIT_RUN}\`" 2
assert_gate_count "the gate says to run \`git init\` only in its two conditional sentences" \
  'run `git init' 2
assert_gate_has "context-management writes project-map.md in the session folder" \
  'Then invoke `context-management` for map generation only; it writes `project-map.md` in the session folder. Return to step 3 when done.'
# Not "only when git init ran": in a sub-folder of a repository with a
# commit, hooks/context-engine.js already wrote the snapshot at session start
# (measured 2026-10-06), so the note is false after a separate-repository
# `git init` there.
assert_gate_has "the ${SNAPSHOT_FILE} note applies only when the check printed '${NOT_A_REPO}'" \
  "Only when the check printed \`${NOT_A_REPO}\`, note: \`${SNAPSHOT_FILE}\` will not be created in this session"
assert_gate_count "the gate names ${SNAPSHOT_FILE} only in its conditional note" \
  "$SNAPSHOT_FILE" 1

# ── Size ───────────────────────────────────────────────────────────────────
skill_len=$(node -e 'process.stdout.write(String(require("fs").readFileSync(process.argv[1], "utf8").length));' "$SKILL")
if [ "$skill_len" -le "$REATTACH_LIMIT" ]; then
  ok "the skill file is ${skill_len} characters, at or under ${REATTACH_LIMIT}"
else
  bad "the skill file is ${skill_len} characters, over ${REATTACH_LIMIT}: the gate text is not attached again after a compaction"
fi

# ── Behaviour: the check command in scratch folders ────────────────────────
# Isolation from the user's git settings and from any repository above the
# temporary folder.
export HOME="${TMP_ROOT}/home"
export XDG_CONFIG_HOME="${HOME}/.config"
export GIT_CONFIG_NOSYSTEM=1
export GIT_CEILING_DIRECTORIES="$TMP_ROOT"
mkdir -p "$HOME"
commit() { # folder message
  git -C "$1" -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false commit -q -m "$2"
}

if [ "$check_lines" -eq 1 ]; then
  # A fresh folder: no repository in it or above it.
  mkdir -p "$TMP_ROOT/fresh"

  # A repository with one commit: a tracked, an untracked and an ignored
  # sub-folder.
  REPO="$TMP_ROOT/repo"
  mkdir -p "$REPO/tracked" "$REPO/untracked" "$REPO/ignored"
  git init -q "$REPO"
  printf 'ignored/\n' > "$REPO/.gitignore"
  printf 'tracked\n' > "$REPO/tracked/file.txt"
  printf 'untracked\n' > "$REPO/untracked/file.txt"
  printf 'ignored\n' > "$REPO/ignored/file.txt"
  git -C "$REPO" add .gitignore tracked/file.txt
  commit "$REPO" init

  # A linked worktree of that repository; its sub-folder "tracked" is
  # checked out from the commit.
  WORKTREE="$TMP_ROOT/linked"
  git -C "$REPO" worktree add -q "$WORKTREE"

  # A repository with no commit, and a sub-folder of it.
  NO_COMMIT="$TMP_ROOT/no-commit"
  mkdir -p "$NO_COMMIT/sub"
  git init -q "$NO_COMMIT"

  # A bare repository.
  BARE="$TMP_ROOT/bare.git"
  git init -q --bare "$BARE"

  assert_outcome "a fresh folder with no repository above it" "$TMP_ROOT/fresh" "$OUT_NONE" ""
  assert_outcome "the root of a repository" "$REPO" "$OUT_FOLDER" "$REPO"
  assert_outcome "a tracked sub-folder" "$REPO/tracked" "$OUT_FOLDER" "$REPO"
  assert_outcome "an untracked sub-folder" "$REPO/untracked" "$OUT_FOLDER" "$REPO"
  assert_outcome "an ignored sub-folder" "$REPO/ignored" "$OUT_FOLDER" "$REPO"
  assert_outcome "a sub-folder of a linked worktree" "$WORKTREE/tracked" "$OUT_FOLDER" "$WORKTREE"
  assert_outcome "a sub-folder of a repository with no commit" "$NO_COMMIT/sub" "$OUT_FOLDER" "$NO_COMMIT"
  assert_outcome "inside .git" "$REPO/.git" "$OUT_ERROR" ""
  assert_outcome "a bare repository" "$BARE" "$OUT_ERROR" ""
  # GIT_TEST_ASSUME_DIFFERENT_OWNER=1 makes git treat the repository as owned
  # by another user, as if safe.directory did not allow it.
  assert_outcome "dubious ownership" "$REPO/tracked" "$OUT_ERROR" "" GIT_TEST_ASSUME_DIFFERENT_OWNER=1
else
  bad "the behaviour cases did not run: no single check command was found in the gate section"
fi

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
