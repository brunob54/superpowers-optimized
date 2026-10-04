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
NL=$'\n'

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
# assert_lacks <desc> <text> <extended regular expression>: no line of the
# text matches the expression; letter case is ignored. An empty text fails,
# so a section that was not found does not look like a success.
assert_lacks() {
  local found
  found=$(printf '%s\n' "$2" | grep -iE -- "$3" | head -3)
  if [ -n "$2" ] && [ -z "$found" ]; then ok "$1"; else bad "$1 (found: '$(one_line "$found")')"; fi
}
# The output of a run is held in $OUT; this matches a whole line with
# grep -x, so a path never matches a longer path.
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
# The text that the paragraph must hold
# ---------------------------------------------------------------------------

HEADING='### Removing a worktree'
# The words that an option uses to point at the paragraph.
POINTER='"Removing a worktree"'
# The places of the two paths in a command of the skill text.
PLACEHOLDER='<worktree-path>'
MAIN_PLACEHOLDER='<main-checkout-path>'
# The start of a git command that runs in the main checkout.
MAIN_PREFIX="git -C \"$MAIN_PLACEHOLDER\""
CHECK_CMD_EXPECTED="git -C \"$PLACEHOLDER\" status --porcelain --ignored --untracked-files=normal"
REMOVE_CMD_EXPECTED="$MAIN_PREFIX worktree remove \"$PLACEHOLDER\""
FORCE_OPTION='--force'
# The workspace files of the plugin. The content of the first three exists
# nowhere else.
SAVED_LOG='session-log.md'
STATE_FILE='state.md'
KNOWN_ISSUES='known-issues.md'
PROJECT_MAP='project-map.md'
# The git setting of a user that hides untracked files from `git status`.
UNTRACKED_SETTING='status.showUntrackedFiles'

# Every sentence of the paragraph, in the order of the paragraph. A list item
# starts with "- " in the skill text; the marker is added where the sentences
# are joined (see PARAGRAPH_EXPECTED).
S_SCOPE='Options 1, 2 and 4 remove a worktree (a second working folder of the same repository) only with this procedure.'
S_WHY="\`git worktree remove\` refuses when the worktree holds a modified file. It refuses for an untracked file only while the git setting \`$UNTRACKED_SETTING\` is not \`no\`. It does not refuse for a file that git ignores: it deletes that file with no message. Git ignores the workspace files of this plugin (\`$SAVED_LOG\`, \`$STATE_FILE\`, \`$KNOWN_ISSUES\`, \`$PROJECT_MAP\`), because the hooks of the plugin hide them from git."
S_MAIN_PATH='First take the path of the main checkout: the first line of `git worktree list`.'
S_MAIN_WHY='The session can run inside the worktree, and a git command fails in a folder that no longer exists.'
S_MAIN_RULE="So run the removal, and every later git command, with \`$MAIN_PREFIX\`."
S_RUN_CHECK='Then run this check.'
S_GIVE_PATH="Give the path of the worktree: without \`-C \"$PLACEHOLDER\"\` the command reports on the folder it runs in."
RULE_FAILED='The check fails (an error text, or an exit status that is not 0): do not remove the worktree.'
RULE_FAILED_SHOW='Show the error to the user.'
RULE_NO_OUTPUT="No output: run \`$REMOVE_CMD_EXPECTED\`."
RULE_STOP='Any output: do not remove the worktree yet.'
RULE_EACH='Each line names a file or a folder that the removal deletes; `!!` marks one that git ignores.'
RULE_SHOW='Show the lines to the user.'
RULE_SAY="Say which lines are workspace files of the plugin: \`$SAVED_LOG\`, \`$STATE_FILE\` and \`$KNOWN_ISSUES\` hold content that exists nowhere else."
RULE_ASK='Ask the user which files to move to the main checkout and which files to delete.'
RULE_MOVE='A file to move: move it to the same relative path in the main checkout.'
RULE_NEVER_OVERWRITE='Never overwrite a file there: when the destination already exists, leave both files in place and ask the user what to do with them.'
RULE_AFTER='After the user has answered for every line: run the removal command of the list item "No output".'
RULE_FORCE_ALLOWED="If git refuses because of a modified or an untracked file, the answer of the user to delete that file allows \`$FORCE_OPTION\`."
RULE_NEVER_FORCE="Never pass \`$FORCE_OPTION\` to the removal command before the user has answered."
PARAGRAPH_ITEM_COUNT=6

# join_texts <text>...: the texts joined with one space.
join_texts() {
  local joined='' part
  for part in "$@"; do joined="$joined${joined:+ }$part"; done
  printf '%s' "$joined"
}
PARAGRAPH_EXPECTED=$(join_texts "$S_SCOPE" "$S_WHY" "$S_MAIN_PATH" "$S_MAIN_WHY" "$S_MAIN_RULE" \
  "$S_RUN_CHECK" "$S_GIVE_PATH" '```bash' "$CHECK_CMD_EXPECTED" '```' \
  "- $RULE_FAILED" "$RULE_FAILED_SHOW" \
  "- $RULE_NO_OUTPUT" \
  "- $RULE_STOP" "$RULE_EACH" "$RULE_SHOW" "$RULE_SAY" "$RULE_ASK" \
  "- $RULE_MOVE" "$RULE_NEVER_OVERWRITE" \
  "- $RULE_AFTER" "$RULE_FORCE_ALLOWED" \
  "- $RULE_NEVER_FORCE")

# ---------------------------------------------------------------------------
# Text taken out of the skill file
# ---------------------------------------------------------------------------

# fold_text: standard input with every run of blanks and line breaks made one
# space, and no blank at the start or at the end. The prose of a skill wraps,
# so a phrase can stand on two lines.
fold_text() { tr '\n\t' '  ' | tr -s ' ' | sed 's/^ //; s/ $//'; }

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
# item_count <text>: the number of list items of the text that start at the
# left margin.
item_count() { printf '%s\n' "$1" | grep -c '^- '; }
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
# first_difference <actual> <expected>: the position of the first character
# that differs, and the text of both around that position.
first_difference() {
  actual="$1" expected="$2" awk 'BEGIN {
    a = ENVIRON["actual"]; e = ENVIRON["expected"]
    n = length(a) > length(e) ? length(a) : length(e)
    for (i = 1; i <= n; i++) if (substr(a, i, 1) != substr(e, i, 1)) break
    s = i > 30 ? i - 30 : 1
    printf "first difference at character %d; the text there: \"%s\"; expected there: \"%s\"", i, substr(a, s, 90), substr(e, s, 90)
  }'
}

PARAGRAPH=$(section "$HEADING")
PARAGRAPH_FOLDED=$(printf '%s\n' "$PARAGRAPH" | fold_text)
# The lines of the first ```bash block of the paragraph, without the fences.
CHECK_CMD=$(printf '%s\n' "$PARAGRAPH" | awk '/^```bash$/ { c = 1; next } c && /^```$/ { exit } c { print }')
# The removal command: the first text between two ` characters of the list
# item "No output:".
REMOVE_CMD=$(bullet "$PARAGRAPH" 'No output:' | awk -F'`' '{ print $2; exit }')

# with_paths <text>: the text with each placeholder replaced by the name of a
# shell variable. The quotes around a path come from the skill text, so a
# command that the skill writes without quotes fails on a path with a space.
with_paths() {
  printf '%s\n' "$1" | sed "s/$PLACEHOLDER/\$WT/g; s/$MAIN_PLACEHOLDER/\$MAIN_CO/g"
}
# runnable <command>: the command with the placeholders replaced, when the
# command is one line that starts with `git ` and names the worktree
# placeholder. In every other case the result is empty and the command is not
# run: a behaviour check must never run an arbitrary line of a changed skill
# file.
runnable() {
  case "$1" in
    *"$PLACEHOLDER"*) ;;
    *) return 0 ;;
  esac
  if [ "$(line_count "$1")" -eq 1 ] && [ "${1#git }" != "$1" ]; then
    with_paths "$1"
  fi
}
CHECK_RUN=$(runnable "$CHECK_CMD")
REMOVE_RUN=$(runnable "$REMOVE_CMD")
# The start of a later git command, when the removal command of the skill
# starts with it.
case "$REMOVE_CMD" in
  "$MAIN_PREFIX "*) MAIN_PREFIX_RUN=$(with_paths "$MAIN_PREFIX") ;;
  *) MAIN_PREFIX_RUN='' ;;
esac

NO_COMMAND='(the skill text holds no command that this suite can run)'
# run_in <folder> <worktree path> <command>...: run the commands, one after
# the other, in <folder>; a command that fails ends the run. $WT holds
# <worktree path> and $MAIN_CO holds the main checkout of the fixture. Leaves
# the output (both streams) in OUT and the exit code in CODE. An empty command
# runs nothing: OUT then holds a message, so that no check passes on an empty
# output, and RAN is 0.
run_in() {
  local folder="$1" worktree="$2" command
  shift 2
  for command in "$@"; do
    if [ -z "$command" ]; then OUT="$NO_COMMAND"; CODE=1; RAN=0; return 0; fi
  done
  CODE=0
  RAN=1
  OUT=$( { cd "$folder" && WT="$worktree" && MAIN_CO="$MAIN" && for command in "$@"; do
    eval "$command" || exit $?
  done; } 2>&1 ) || CODE=$?
}
# run_check <folder> <worktree path>: the check command of the skill.
run_check() { run_in "$1" "$2" "$CHECK_RUN"; }
# run_remove <folder> <worktree path>: the removal command of the skill.
run_remove() { run_in "$1" "$2" "$REMOVE_RUN"; }

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# A file name that the tracked .gitignore of every fixture ignores.
RULE_IGNORED='ignored-by-rule.md'
DEPENDENCY_FOLDER='node_modules'
DEPENDENCY_FILE_COUNT=40
UNTRACKED_FILE='notes.md'
UNTRACKED_FOLDER='drafts'
FEATURE_BRANCH='feat'

# new_fixture <name>: a repository $TMP/<name> with one commit on the branch
# main, a tracked .gitignore, and a linked worktree .worktrees/feat on the
# feature branch. Leaves the two paths in MAIN and WT.
new_fixture() {
  MAIN="$TMP/$1"
  WT="$MAIN/.worktrees/$FEATURE_BRANCH"
  git init -q "$MAIN"
  git -C "$MAIN" symbolic-ref HEAD refs/heads/main
  mkdir "$MAIN/src"
  echo 'first version' > "$MAIN/src/a.js"
  printf '%s\n' '.worktrees/' "$RULE_IGNORED" "$DEPENDENCY_FOLDER/" > "$MAIN/.gitignore"
  git -C "$MAIN" add -A
  git -C "$MAIN" commit -q -m 'base'
  git -C "$MAIN" worktree add -q "$WT" -b "$FEATURE_BRANCH"
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
add_untracked()       { echo 'new notes' > "$WT/$UNTRACKED_FILE"; }
add_modified()        { echo 'second version' >> "$WT/src/a.js"; }
add_untracked_folder() {
  mkdir -p "$WT/$UNTRACKED_FOLDER/sub"
  echo 'one' > "$WT/$UNTRACKED_FOLDER/one.md"
  echo 'two' > "$WT/$UNTRACKED_FOLDER/sub/two.md"
}
add_dependency_folder() {
  local i=0
  mkdir -p "$WT/$DEPENDENCY_FOLDER/package"
  while [ "$i" -lt "$DEPENDENCY_FILE_COUNT" ]; do
    echo "$i" > "$WT/$DEPENDENCY_FOLDER/package/file-$i.js"
    i=$((i+1))
  done
}
# The setting stands in the configuration of the fixture repository, which the
# main checkout and the worktree share.
hide_untracked_by_setting() { git -C "$MAIN" config "$UNTRACKED_SETTING" no; }
# merge_feature: commit one file on the feature branch and merge that branch
# into main, as Option 1 does before it removes the worktree.
merge_feature() {
  echo 'feature' > "$WT/src/b.js"
  git -C "$WT" add -A
  git -C "$WT" commit -q -m 'feature'
  git -C "$MAIN" merge -q "$FEATURE_BRANCH"
}
# feature_branch_exists: exit code 0 while the fixture has the feature branch.
feature_branch_exists() {
  git -C "$MAIN" rev-parse -q --verify "refs/heads/$FEATURE_BRANCH" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
bold "1. Git deletes a file without a message (why the rule exists)"
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

new_fixture defect-setting
hide_untracked_by_setting
add_untracked
CODE=0
OUT=$(git -C "$MAIN" worktree remove "$WT" 2>&1) || CODE=$?
label="with $UNTRACKED_SETTING=no, git worktree remove deletes an untracked file: exit code 0, no message"
if [ "$CODE" -eq 0 ] && [ -z "$OUT" ] && [ ! -e "$WT/$UNTRACKED_FILE" ]; then
  ok "$label"
else
  bad "$label (exit code $CODE, output: $(one_line "$OUT"))"
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
  "$PARAGRAPH_FOLDED" "$S_RUN_CHECK" "$CHECK_CMD_EXPECTED"
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
out_has_line "an untracked file is named" "?? $UNTRACKED_FILE"
out_has_line "a modified tracked file is named" ' M src/a.js'

new_fixture dependencies
add_dependency_folder
run_check "$MAIN" "$WT"
assert_eq "an ignored folder with $DEPENDENCY_FILE_COUNT files gives one line, which names the folder" \
  "$OUT" "!! $DEPENDENCY_FOLDER/"

# A user can hide untracked files from `git status` with a setting. The check
# must name them all the same, and still give one line for a folder.
new_fixture setting
hide_untracked_by_setting
add_untracked
add_untracked_folder
add_ignored_by_rule
add_dependency_folder
run_check "$MAIN" "$WT"
assert_eq "with $UNTRACKED_SETTING=no: untracked and ignored files are named, and a folder is one line" \
  "$OUT" "?? $UNTRACKED_FOLDER/$NL?? $UNTRACKED_FILE$NL!! $RULE_IGNORED$NL!! $DEPENDENCY_FOLDER/"

new_fixture 'with space'
hide_like_the_hook "$SAVED_LOG"
run_check "$MAIN" "$WT"
assert_eq "a worktree path with a space: the hidden $SAVED_LOG is named" "$OUT" "!! $SAVED_LOG"

new_fixture gone
run_check "$MAIN" "$WT-that-does-not-exist"
label="the check on a folder that does not exist fails: an exit code that is not 0, and an error text"
if [ "$RAN" -eq 1 ] && [ "$CODE" -ne 0 ] && [ -n "$OUT" ]; then
  ok "$label"
else
  bad "$label (exit code $CODE, output: $(one_line "$OUT"))"
fi

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
if [ "$RAN" -eq 1 ] && ! printf '%s\n' "$OUT" | grep -qF -- '.worktrees'; then
  ok "$label"
else
  bad "$label (got: $(one_line "$OUT"))"
fi
# assert_same_as_reference <desc>: a command ran, and its output equals the
# output of the run in the main checkout.
assert_same_as_reference() {
  if [ "$RAN" -eq 1 ] && [ "$OUT" = "$REFERENCE" ]; then
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
bold "4. The removal command, and the commands after it"
# ---------------------------------------------------------------------------

# assert_removed <desc>: the removal command ran with exit code 0, and the
# folder of the worktree is gone.
assert_removed() {
  if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ] && [ ! -e "$WT" ]; then
    ok "$1"
  else
    bad "$1 (exit code $CODE, output: $(one_line "$OUT"))"
  fi
}

new_fixture remove-clean
run_remove "$MAIN" "$WT"
assert_removed "the removal command removes a clean worktree"

new_fixture 'remove with space'
run_remove "$MAIN" "$WT"
assert_removed "the removal command removes a worktree whose path holds a space"

# The removal command of the skill must hold no force option: git itself then
# protects a modified or an untracked file.
new_fixture remove-untracked
add_untracked
run_remove "$MAIN" "$WT"
if [ "$RAN" -eq 1 ] && [ "$CODE" -ne 0 ] && [ -f "$WT/$UNTRACKED_FILE" ]; then
  ok "the removal command leaves a worktree with an untracked file in place"
else
  bad "the removal command leaves a worktree with an untracked file in place (exit code $CODE, output: $(one_line "$OUT"))"
fi

# Option 1 merges the feature branch first. The order "delete the branch,
# then remove the worktree" cannot be carried out.
new_fixture order
merge_feature
CODE=0
OUT=$(git -C "$MAIN" branch -d "$FEATURE_BRANCH" 2>&1) || CODE=$?
if [ "$CODE" -ne 0 ]; then
  ok "git refuses to delete the merged branch while its worktree exists"
else
  bad "git refuses to delete the merged branch while its worktree exists (output: $(one_line "$OUT"))"
fi

# The session can run inside the worktree. After the removal, the folder of
# the session no longer exists.
new_fixture inside-plain
merge_feature
CODE=0
OUT=$( { cd "$WT/src" && git worktree remove "$WT" && git branch -d "$FEATURE_BRANCH"; } 2>&1 ) || CODE=$?
label="inside the removed worktree, a git command without -C fails"
if [ "$CODE" -ne 0 ] && [ ! -e "$WT" ] && feature_branch_exists; then
  ok "$label"
else
  bad "$label (exit code $CODE, output: $(one_line "$OUT"))"
fi

assert_eq "the removal command starts with '$MAIN_PREFIX'" \
  "${REMOVE_CMD%% worktree remove*}" "$MAIN_PREFIX"
new_fixture inside
merge_feature
hide_like_the_hook "$SAVED_LOG"
BRANCH_RUN=''
if [ -n "$MAIN_PREFIX_RUN" ]; then BRANCH_RUN="$MAIN_PREFIX_RUN branch -d $FEATURE_BRANCH"; fi
run_in "$WT/src" "$WT" "$CHECK_RUN"
assert_eq "inside the worktree, the check names the hidden $SAVED_LOG" "$OUT" "!! $SAVED_LOG"
run_in "$WT/src" "$WT" "$REMOVE_RUN" "$BRANCH_RUN"
label="inside the worktree: the removal command, then the branch deletion with the same start, both succeed"
if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ] && [ ! -e "$WT" ] && ! feature_branch_exists; then
  ok "$label"
else
  bad "$label (exit code $CODE, output: $(one_line "$OUT"))"
fi

# ---------------------------------------------------------------------------
bold "5. The rule: its condition and its consequence"
# ---------------------------------------------------------------------------

# pin <desc> <first words of the list item> <sentence>: the list item holds
# the sentence.
pin() { text_has "$1" "$(bullet "$PARAGRAPH" "$2")" "$3"; }

pin "a failed check forbids the removal" 'The check fails' "$RULE_FAILED"
pin "a failed check: the error is shown to the user" 'The check fails' "$RULE_FAILED_SHOW"
pin "the list item 'Any output:' forbids the removal" 'Any output:' "$RULE_STOP"
pin "the list item 'Any output:' tells to show the lines" 'Any output:' "$RULE_SHOW"
pin "the list item 'Any output:' tells to say which lines are workspace files, and names the three with content that exists nowhere else" \
  'Any output:' "$RULE_SAY"
pin "the list item 'Any output:' tells to ask the user: move or delete" 'Any output:' "$RULE_ASK"
assert_before "the lines are shown before the question" \
  "$(bullet "$PARAGRAPH" 'Any output:')" "$RULE_SHOW" "$RULE_ASK"
pin "a file is moved to the same relative path in the main checkout" 'A file to move:' "$RULE_MOVE"
pin "a file that already exists at the destination is never overwritten, and the user is asked" \
  'A file to move:' "$RULE_NEVER_OVERWRITE"
pin "the removal after the answers uses the removal command of 'No output'" \
  'After the user has answered for every line:' "$RULE_AFTER"
pin "the force option is allowed only when git refuses for a modified or an untracked file that the user told to delete" \
  'After the user has answered for every line:' "$RULE_FORCE_ALLOWED"
pin "no force option before the answer of the user" 'Never pass' "$RULE_NEVER_FORCE"
text_has "the main checkout is named by a command, and every later git command runs there" \
  "$PARAGRAPH_FOLDED" "$S_MAIN_PATH $S_MAIN_WHY $S_MAIN_RULE"
# The force option stands in two sentences only: the one that forbids it
# before the answer, and the one that allows it after the answer.
assert_eq "the skill names the force option exactly two times" \
  "$(grep -o -- "$FORCE_OPTION" "$SKILL" | wc -l | tr -d ' ')" '2'

# The checks above prove that each sentence is present. A sentence that is
# added between them, for example an exception, passes all of them. The next
# checks compare the whole paragraph, so an added sentence, an added list
# item and an added command block fail, whatever their words are.
label="the paragraph holds exactly these sentences, in this order, and no other text"
if [ "$PARAGRAPH_FOLDED" = "$PARAGRAPH_EXPECTED" ]; then
  ok "$label"
else
  bad "$label ($(first_difference "$PARAGRAPH_FOLDED" "$PARAGRAPH_EXPECTED"))"
fi
assert_eq "the paragraph has exactly $PARAGRAPH_ITEM_COUNT list items" \
  "$(item_count "$PARAGRAPH")" "$PARAGRAPH_ITEM_COUNT"
assert_eq "the paragraph has exactly one fenced block (two fence lines)" \
  "$(printf '%s\n' "$PARAGRAPH" | grep -c '^[[:space:]]*```')" '2'

# ---------------------------------------------------------------------------
bold "6. Options 1, 2 and 4 use the paragraph, and nothing weakens it"
# ---------------------------------------------------------------------------

# Words that start an exception to a rule. The section "Hard Rules" of the
# skill holds one of them, so this check runs on the paragraph and on the
# three options, not on the whole file.
EXCEPTION_WORDS='unless|except'
assert_no_exception() { # name text
  assert_lacks "$1 holds no word that starts an exception ($EXCEPTION_WORDS)" "$2" "$EXCEPTION_WORDS"
}
assert_no_exception "the paragraph" "$PARAGRAPH"
# The short form of the force option: `-f` that is not a part of a longer
# option or word.
SHORT_FORCE='(^|[^-[:alnum:]])-f([^-[:alnum:]]|$)'
# A recursive delete of a folder with rm, in place of the removal by git.
RECURSIVE_DELETE='rm +-[a-z]*r'
SKILL_TEXT=$(cat "$SKILL" 2>/dev/null)
assert_lacks "the skill holds no short force option (-f)" "$SKILL_TEXT" "$SHORT_FORCE"
assert_lacks "the skill holds no recursive delete with rm" "$SKILL_TEXT" "$RECURSIVE_DELETE"

REMOVE_WORD='emove'
# check_option <number> <item count> <line>: the option has exactly <item
# count> list items at the left margin, one of them is exactly <line>, every
# line that speaks of a removal holds the pointer, and no word starts an
# exception.
check_option() {
  local name="Option $1" option bare
  option=$(section "### Option $1")
  assert_eq "$name has exactly $2 list items at the left margin" "$(item_count "$option")" "$2"
  if printf '%s\n' "$option" | grep -qxF -- "$3"; then
    ok "$name holds the line: $3"
  else
    bad "$name holds the line: $3"
  fi
  bare=$(printf '%s\n' "$option" | grep -F -- "$REMOVE_WORD" | grep -vF -- "$POINTER")
  if [ -n "$option" ] && [ -z "$bare" ]; then
    ok "$name has no removal line without the pointer"
  else
    bad "$name has no removal line without the pointer (found: $(one_line "$bare"))"
  fi
  assert_no_exception "$name" "$option"
}
REMOVE_ITEM="- Remove worktree (follow $POINTER below)"
check_option 1 6 "$REMOVE_ITEM"
check_option 2 3 "- Keep worktree by default (remove only if user asks; then follow $POINTER below)"
check_option 4 3 "$REMOVE_ITEM, then delete branch"
assert_before "Option 1 removes the worktree before it deletes the merged branch" \
  "$(section '### Option 1')" "$REMOVE_ITEM" '- Delete merged branch'

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
