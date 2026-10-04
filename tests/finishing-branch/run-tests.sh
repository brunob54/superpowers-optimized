#!/usr/bin/env bash
# finishing-branch test suite: the paragraph "Removing a worktree" of
# skills/finishing-a-development-branch/SKILL.md. A worktree is a second
# working folder of the same git repository.
# The check command and the removal command are copied out of the skill text
# and run on fixture repositories, so a check fails when the text that the
# model runs changes. The wording checks join wrapped lines first.
# Pure bash, git, awk, sed and grep; no claude invocation.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).
#
# The defect that the paragraph closes: `git worktree remove` deletes a file
# that git ignores, with no message. The hooks of the plugin hide the
# workspace files (session-log.md, state.md, known-issues.md, project-map.md)
# from git, so the removal of a worktree deleted them without a question.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL="$REPO/skills/finishing-a-development-branch/SKILL.md"
PASS=0
FAIL=0
ERRORS=()

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

ok()   { green "  PASS: $1"; PASS=$((PASS+1)); }
bad()  { red "  FAIL: $1"; ERRORS+=("$1"); FAIL=$((FAIL+1)); }

# one_line <text>: the text with every line break shown as `|`, for a message.
one_line() { printf '%s' "$1" | tr '\n' '|'; }

assert_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$(one_line "$3")', got '$(one_line "$2")')"; fi
}
text_has() { # desc text needle (fixed text, case-sensitive)
  case "$2" in
    *"$3"*) ok "$1" ;;
    *) bad "$1 (missing: $3)" ;;
  esac
}
# The output of a run is held in $OUT; these match a whole line with grep -x,
# so a path never matches a longer path.
out_has_line() { # desc exact-line
  if printf '%s\n' "$OUT" | grep -qxF -- "$2"; then ok "$1"; else bad "$1 (no line '$2' in: $(one_line "$OUT"))"; fi
}
# line_count <text>: the number of lines of the text; 0 for an empty text.
line_count() {
  if [ -z "$1" ]; then echo 0; else printf '%s\n' "$1" | wc -l | tr -d ' '; fi
}

# Isolation: the user's global and system git configuration must not change a
# result, and git must never find a repository above a fixture folder.
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME='Fixture Author'
export GIT_AUTHOR_EMAIL='fixture@example.com'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
# pwd -P resolves macOS's /var -> /private/var symbolic link, so a fixture
# path equals the path that git prints.
TMP=$(mktemp -d)
: "${TMP:?mktemp failed — refusing to run with an empty fixture path}"
TMP=$(cd "$TMP" && pwd -P)
trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export GIT_CEILING_DIRECTORIES="$TMP"

# ---------------------------------------------------------------------------
# Text taken out of the skill file
# ---------------------------------------------------------------------------

HEADING='### Removing a worktree'
# The words that an option uses to point at the paragraph.
POINTER='"Removing a worktree"'
# The place of the worktree path in a command of the skill text.
PLACEHOLDER='<worktree-path>'
CHECK_CMD_EXPECTED="git -C $PLACEHOLDER status --porcelain --ignored"
REMOVE_CMD_EXPECTED="git worktree remove $PLACEHOLDER"
FORCE_OPTION='--force'
# The workspace files whose content exists nowhere else.
SAVED_LOG='session-log.md'
STATE_FILE='state.md'
KNOWN_ISSUES='known-issues.md'

# fold_text: standard input with every run of blanks and line breaks made one
# space. The prose of a skill wraps, so a phrase can stand on two lines.
fold_text() { tr '\n\t' '  ' | tr -s ' '; }

# section <heading>: the lines of the skill file after the line <heading>, up
# to the next heading line.
section() {
  awk -v h="$1" '$0 == h { f = 1; next } f && /^#/ { exit } f { print }' "$SKILL" 2>/dev/null
}
# bullet <text> <first words>: the list item of <text> whose first line starts
# with "- <first words>", with its continuation lines, joined to one line.
bullet() {
  printf '%s\n' "$1" | awk -v p="- $2" '
    index($0, p) == 1 { f = 1; print; next }
    f && (/^- / || /^$/) { exit }
    f { print }' | fold_text
}
# offset_of <text> <needle>: the 1-based position of the first occurrence of
# the fixed text <needle> in <text>; 0 when it is absent. Both reach awk
# through the environment, so no character of them is read as a pattern.
offset_of() {
  hay="$1" needle="$2" awk 'BEGIN { print index(ENVIRON["hay"], ENVIRON["needle"]) }'
}
# assert_before <desc> <text> <earlier> <later>: both fixed texts are present
# and <earlier> starts before <later>.
assert_before() {
  local first second
  first=$(offset_of "$2" "$3")
  second=$(offset_of "$2" "$4")
  if [ "$first" -gt 0 ] && [ "$second" -gt 0 ] && [ "$first" -lt "$second" ]; then
    ok "$1"
  else
    bad "$1 (position of '$3': $first; position of '$4': $second; 0 means absent)"
  fi
}

PARAGRAPH=$(section "$HEADING")
PARAGRAPH_FOLDED=$(printf '%s\n' "$PARAGRAPH" | fold_text)
# The lines of the first ```bash block of the paragraph, without the fences.
CHECK_CMD=$(printf '%s\n' "$PARAGRAPH" | awk '/^```bash$/ { c = 1; next } c && /^```$/ { exit } c { print }')
NO_OUTPUT_BULLET=$(bullet "$PARAGRAPH" 'No output:')
ANY_OUTPUT_BULLET=$(bullet "$PARAGRAPH" 'Any output:')
# The removal command: the first text between two ` characters of the list
# item "No output:".
REMOVE_CMD=$(printf '%s\n' "$NO_OUTPUT_BULLET" | awk -F'`' '{ print $2; exit }')

# runnable <command>: the command with the placeholder replaced by "$WT", when
# the command is one line that starts with `git ` and names the placeholder.
# In every other case the result is empty and the command is not run: a
# behaviour check must never run an arbitrary line of a changed skill file.
runnable() {
  case "$1" in
    *"$PLACEHOLDER"*) ;;
    *) return 0 ;;
  esac
  if [ "$(line_count "$1")" -eq 1 ] && [ "${1#git }" != "$1" ]; then
    printf '%s\n' "$1" | sed "s/$PLACEHOLDER/\"\$WT\"/g"
  fi
}
CHECK_RUN=$(runnable "$CHECK_CMD")
REMOVE_RUN=$(runnable "$REMOVE_CMD")

NO_COMMAND='(the skill text holds no command that this suite can run)'
# run_check <folder> <worktree path>: run the check command of the skill in
# <folder> with <worktree path> in the place of the placeholder. Leaves the
# output (both streams) in OUT and the exit code in CODE. Without a command,
# OUT holds a message, so that no check passes on an empty output.
run_check() {
  if [ -z "$CHECK_RUN" ]; then OUT="$NO_COMMAND"; CODE=1; return 0; fi
  CODE=0
  OUT=$(cd "$1" && WT="$2" && eval "$CHECK_RUN" 2>&1) || CODE=$?
}
# run_remove <folder> <worktree path>: the same for the removal command.
# RAN is 1 when a command ran.
run_remove() {
  if [ -z "$REMOVE_RUN" ]; then OUT="$NO_COMMAND"; CODE=1; RAN=0; return 0; fi
  CODE=0
  RAN=1
  OUT=$(cd "$1" && WT="$2" && eval "$REMOVE_RUN" 2>&1) || CODE=$?
}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# A file name that the tracked .gitignore of every fixture ignores.
RULE_IGNORED='ignored-by-rule.md'
DEPENDENCY_FOLDER='node_modules'
DEPENDENCY_FILE_COUNT=40

# new_fixture <name>: a repository $TMP/<name> with one commit on the branch
# main, a tracked .gitignore, and a linked worktree .worktrees/feat on the
# branch feat. Leaves the two paths in MAIN and WT.
new_fixture() {
  MAIN="$TMP/$1"
  WT="$MAIN/.worktrees/feat"
  git init -q "$MAIN"
  git -C "$MAIN" symbolic-ref HEAD refs/heads/main
  mkdir "$MAIN/src"
  echo 'first version' > "$MAIN/src/a.js"
  printf '%s\n' '.worktrees/' "$RULE_IGNORED" "$DEPENDENCY_FOLDER/" > "$MAIN/.gitignore"
  git -C "$MAIN" add -A
  git -C "$MAIN" commit -q -m 'base'
  git -C "$MAIN" worktree add -q "$WT" -b feat
}
# hide_like_the_hook <name>: write a saved entry to the file <name> at the top
# of the worktree, and add the entry that hooks/git-exclude.js writes for such
# a file (`/<name>`) to the exclude file that git names inside the worktree.
hide_like_the_hook() {
  local exclude_file
  printf '## 2026-10-04 [saved]\n- Decisions: keep the parser\n' > "$WT/$1"
  exclude_file=$(cd "$WT" && git rev-parse --git-path info/exclude)
  mkdir -p "$(dirname "$exclude_file")"
  printf '/%s\n' "$1" >> "$exclude_file"
}
add_ignored_by_rule() { echo 'local notes' > "$WT/$RULE_IGNORED"; }
add_untracked()       { echo 'new notes' > "$WT/notes.md"; }
add_modified()        { echo 'second version' >> "$WT/src/a.js"; }
add_dependency_folder() {
  local i=0
  mkdir -p "$WT/$DEPENDENCY_FOLDER/package"
  while [ "$i" -lt "$DEPENDENCY_FILE_COUNT" ]; do
    echo "$i" > "$WT/$DEPENDENCY_FOLDER/package/file-$i.js"
    i=$((i+1))
  done
}

# ---------------------------------------------------------------------------
bold "1. Git deletes an ignored file without a message (why the rule exists)"
# ---------------------------------------------------------------------------

new_fixture defect
hide_like_the_hook "$SAVED_LOG"
if grep -qxF -- "/$SAVED_LOG" "$MAIN/.git/info/exclude" 2>/dev/null; then
  ok "a linked worktree uses the exclude file of the main checkout"
else
  bad "a linked worktree uses the exclude file of the main checkout"
fi
assert_eq "plain git status --porcelain prints nothing for the hidden $SAVED_LOG" \
  "$(git -C "$WT" status --porcelain 2>&1)" ''
CODE=0
OUT=$(git -C "$MAIN" worktree remove "$WT" 2>&1) || CODE=$?
if [ "$CODE" -eq 0 ] && [ -z "$OUT" ] && [ ! -e "$WT/$SAVED_LOG" ]; then
  ok "git worktree remove deletes the hidden $SAVED_LOG: exit code 0, no message"
else
  bad "git worktree remove deletes the hidden $SAVED_LOG: exit code 0, no message (exit code $CODE, output: $(one_line "$OUT"))"
fi

# ---------------------------------------------------------------------------
bold "2. The skill text holds the check command and the removal command"
# ---------------------------------------------------------------------------

assert_eq "the skill has exactly one heading '$HEADING'" \
  "$(grep -cxF -- "$HEADING" "$SKILL")" '1'
assert_eq "the fenced block of the paragraph holds the check command" \
  "$CHECK_CMD" "$CHECK_CMD_EXPECTED"
assert_eq "the list item 'No output:' holds the removal command" \
  "$REMOVE_CMD" "$REMOVE_CMD_EXPECTED"
# A command that no sentence tells to run is only an example to the reader.
assert_before "a sentence with a verb tells to run the check, before the check command" \
  "$PARAGRAPH_FOLDED" 'Run this check first.' "$CHECK_CMD_EXPECTED"
assert_before "the check command stands before the list item 'No output:'" \
  "$PARAGRAPH_FOLDED" "$CHECK_CMD_EXPECTED" '- No output:'

# ---------------------------------------------------------------------------
bold "3. The check command on fixture worktrees"
# ---------------------------------------------------------------------------

# Every run of this group starts in the main checkout, except where the label
# says otherwise. The main checkout ignores `.worktrees/`, so a command that
# reports on the folder it runs in prints a line there.
new_fixture clean
run_check "$MAIN" "$WT"
assert_eq "a clean worktree gives no output" "$OUT" ''
assert_eq "a clean worktree gives exit code 0" "$CODE" '0'

new_fixture hidden
hide_like_the_hook "$SAVED_LOG"
run_check "$MAIN" "$WT"
assert_eq "a $SAVED_LOG hidden through the exclude file is named, and it is the only line" \
  "$OUT" "!! $SAVED_LOG"

new_fixture by-rule
add_ignored_by_rule
run_check "$MAIN" "$WT"
out_has_line "a file ignored by a tracked .gitignore is named" "!! $RULE_IGNORED"

new_fixture uncommitted
add_untracked
add_modified
run_check "$MAIN" "$WT"
out_has_line "an untracked file is named" '?? notes.md'
out_has_line "a modified tracked file is named" ' M src/a.js'

new_fixture dependencies
add_dependency_folder
run_check "$MAIN" "$WT"
assert_eq "an ignored folder with $DEPENDENCY_FILE_COUNT files gives one line, which names the folder" \
  "$OUT" "!! $DEPENDENCY_FOLDER/"

new_fixture all
hide_like_the_hook "$SAVED_LOG"
add_ignored_by_rule
add_untracked
add_modified
add_dependency_folder
run_check "$MAIN" "$WT"
REFERENCE="$OUT"
assert_eq "a worktree with all five kinds gives five lines" "$(line_count "$OUT")" '5'
# The main checkout ignores `.worktrees/`; a report on it would name that folder.
label="a run in the main checkout does not report on the main checkout"
if [ -n "$CHECK_RUN" ] && ! printf '%s\n' "$OUT" | grep -qF -- '.worktrees'; then
  ok "$label"
else
  bad "$label (got: $(one_line "$OUT"))"
fi
# assert_same_as_reference <desc>: a command ran, and its output equals the
# output of the run in the main checkout.
assert_same_as_reference() {
  if [ -n "$CHECK_RUN" ] && [ "$OUT" = "$REFERENCE" ]; then
    ok "$1"
  else
    bad "$1 (got: $(one_line "$OUT"))"
  fi
}
run_check "$WT/src" "$WT"
assert_same_as_reference "a run in a sub-folder of the worktree gives the same lines"
run_check "$MAIN" "$WT/src"
assert_same_as_reference "a sub-folder of the worktree as the path gives the same lines"

# ---------------------------------------------------------------------------
bold "4. The removal command and the order of Option 1"
# ---------------------------------------------------------------------------

new_fixture remove-clean
run_remove "$MAIN" "$WT"
if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ] && [ ! -e "$WT" ]; then
  ok "the removal command removes a clean worktree"
else
  bad "the removal command removes a clean worktree (exit code $CODE, output: $(one_line "$OUT"))"
fi

# The removal command of the skill must hold no force option: git itself then
# protects a modified or an untracked file.
new_fixture remove-untracked
add_untracked
run_remove "$MAIN" "$WT"
if [ "$RAN" -eq 1 ] && [ "$CODE" -ne 0 ] && [ -f "$WT/notes.md" ]; then
  ok "the removal command leaves a worktree with an untracked file in place"
else
  bad "the removal command leaves a worktree with an untracked file in place (exit code $CODE, output: $(one_line "$OUT"))"
fi

# Option 1 merges the feature branch first. The order "delete the branch,
# then remove the worktree" cannot be carried out.
new_fixture order
echo 'feature' > "$WT/src/b.js"
git -C "$WT" add -A
git -C "$WT" commit -q -m 'feature'
git -C "$MAIN" merge -q feat
CODE=0
OUT=$(git -C "$MAIN" branch -d feat 2>&1) || CODE=$?
if [ "$CODE" -ne 0 ]; then
  ok "git refuses to delete the merged branch while its worktree exists"
else
  bad "git refuses to delete the merged branch while its worktree exists (output: $(one_line "$OUT"))"
fi
run_remove "$MAIN" "$WT"
BRANCH_CODE=0
BRANCH_OUT=$(git -C "$MAIN" branch -d feat 2>&1) || BRANCH_CODE=$?
if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ] && [ "$BRANCH_CODE" -eq 0 ]; then
  ok "the removal command first, then the branch deletion: both succeed"
else
  bad "the removal command first, then the branch deletion: both succeed (removal: exit code $CODE, $(one_line "$OUT"); branch: exit code $BRANCH_CODE, $(one_line "$BRANCH_OUT"))"
fi

# ---------------------------------------------------------------------------
bold "5. The rule: its condition and its consequence"
# ---------------------------------------------------------------------------

RULE_STOP='Any output: do not remove the worktree yet.'
RULE_SHOW='Show the lines to the user.'
RULE_ASK='Ask the user which files to move to the main checkout and which files to delete.'
text_has "the list item 'Any output:' forbids the removal" "$ANY_OUTPUT_BULLET" "$RULE_STOP"
text_has "the list item 'Any output:' tells to show the lines" "$ANY_OUTPUT_BULLET" "$RULE_SHOW"
text_has "the list item 'Any output:' tells to ask the user: move or delete" "$ANY_OUTPUT_BULLET" "$RULE_ASK"
text_has "the list item 'Any output:' names the workspace files with content that exists nowhere else" \
  "$ANY_OUTPUT_BULLET" "\`$SAVED_LOG\`, \`$STATE_FILE\` and \`$KNOWN_ISSUES\` hold content that exists nowhere else"
assert_before "the lines are shown before the question" "$ANY_OUTPUT_BULLET" "$RULE_SHOW" "$RULE_ASK"
text_has "a file that already exists at the destination is never overwritten, and the user is asked" \
  "$PARAGRAPH_FOLDED" 'Never overwrite a file there: when the destination already exists, leave both files in place and ask the user what to do with them.'
text_has "the move names the main checkout by a command" \
  "$PARAGRAPH_FOLDED" 'the first line of `git worktree list`'
text_has "no force option before the answer of the user" \
  "$PARAGRAPH_FOLDED" "Never pass \`$FORCE_OPTION\` to \`git worktree remove\` before the user has answered."
# The force option stands in two sentences only: the one that forbids it
# before the answer, and the one that allows it after the answer.
FORCE_AFTER_ANSWER=$(bullet "$PARAGRAPH" 'After the user has answered for every line:')
text_has "the force option is allowed only by the answer of the user to delete the file" \
  "$FORCE_AFTER_ANSWER" "the answer of the user to delete that file allows \`$FORCE_OPTION\`"
assert_eq "the skill names the force option exactly two times" \
  "$(grep -o -- "$FORCE_OPTION" "$SKILL" | wc -l | tr -d ' ')" '2'

# ---------------------------------------------------------------------------
bold "6. Options 1, 2 and 4 use the paragraph"
# ---------------------------------------------------------------------------

REMOVE_WORD='emove'
for number in 1 2 4; do
  OPTION=$(section "### Option $number")
  text_has "Option $number points at the paragraph" "$OPTION" "$POINTER"
  # Every line of the option that speaks of a removal must hold the pointer.
  BARE=$(printf '%s\n' "$OPTION" | grep -F -- "$REMOVE_WORD" | grep -vF -- "$POINTER")
  if [ -n "$OPTION" ] && [ -z "$BARE" ]; then
    ok "Option $number has no removal line without the pointer"
  else
    bad "Option $number has no removal line without the pointer (found: $(one_line "$BARE"))"
  fi
done
OPTION_1=$(section '### Option 1')
assert_before "Option 1 removes the worktree before it deletes the merged branch" \
  "$OPTION_1" '- Remove worktree' '- Delete merged branch'
OPTION_4=$(section '### Option 4')
assert_before "Option 4 removes the worktree before it deletes the branch" \
  "$OPTION_4" 'Remove worktree' 'delete branch'

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
