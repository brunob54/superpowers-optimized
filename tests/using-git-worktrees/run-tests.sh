#!/usr/bin/env bash
# using-git-worktrees test suite: the steps "Check the spec and the plan" and
# "Move the spec and the plan into the worktree" of
# skills/using-git-worktrees/SKILL.md. A worktree is a second working folder
# of the same git repository.
# The check, the branch command, the worktree command, the move commands and
# the commit command are copied out of the skill text and run on fixture
# repositories, so a check fails when the text that the model runs changes.
# The wording checks join wrapped lines first.
# Pure bash, git, awk, sed, grep and cksum; no claude invocation.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).
#
# The defect that the steps close: a new worktree holds only committed files.
# The skills that write a spec and a plan do not commit them. The worktree
# then had no spec and no plan, and a commit of the plan that ran in the first
# folder landed on the branch of that folder.
# The design: the worktree is created first, the untracked spec and plan are
# moved into it, each by its own path, and they are committed there on the new
# branch. Nothing is committed on the branch of the first folder.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL="$REPO/skills/using-git-worktrees/SKILL.md"
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
# assert_lacks <desc> <text> <extended regular expression> [<grep options>]:
# no line of the text matches the expression. Letter case is ignored; with
# the options `-E` in the fourth place it is not. An empty text fails, so a
# section that was not found does not look like a success.
assert_lacks() {
  local found
  found=$(printf '%s\n' "$2" | grep "${4:--iE}" -- "$3" | head -3)
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
# The text that the skill must hold
# ---------------------------------------------------------------------------

CHECK_HEADING='### 2. Check the spec and the plan'
CREATE_HEADING='### 3. Create worktree and branch'
MOVE_HEADING='### 4. Move the spec and the plan into the worktree'
# Every heading line of the skill, in the order of the file.
HEADINGS_EXPECTED="# Using Git Worktrees
## Required Start
## Directory Selection Priority
## Safety Check
## Creation Steps
### 1. Detect project root and branch name
$CHECK_HEADING
$CREATE_HEADING
$MOVE_HEADING
### 5. Run project setup
### 6. Run baseline tests
## Failure Handling
## Success Output
## Integration"
# The sections whose text this change does not write: each heading with the
# checksum (the first number that `cksum` prints) of the text below it, wrapped
# lines joined. The first entry is the text above the first heading. A sentence
# that is added to one of these sections, for example "step 2 can wait",
# changes the checksum.
START_OF_FILE='(the text above the first heading)'
SECTION_SUMS_EXPECTED="$START_OF_FILE	2105280590
# Using Git Worktrees	1063324953
## Required Start	1733568800
## Directory Selection Priority	3730224365
## Safety Check	969179287
## Creation Steps	4294967295
### 1. Detect project root and branch name	2796213261
$CREATE_HEADING	3280141730
### 5. Run project setup	1017929623
### 6. Run baseline tests	591315796
## Failure Handling	1111839692
## Success Output	2932263891
## Integration	1012482212"

# The places of the five values in a command of the skill text.
FILE_PLACEHOLDER='<file-path>'
TOP_PATH_PLACEHOLDER='<path-from-the-top>'
WT_FILE_PLACEHOLDER='<worktree-file-path>'
BRANCH_PLACEHOLDER='<BRANCH_NAME>'
WORKTREE_PLACEHOLDER='<path>'
# The first words of the line that the check prints for a path that does not
# exist, and of the line that the first move command prints for a file that
# the worktree already holds.
NO_PATH='no such path'
ALREADY_THERE='already in the worktree'
# The mark that `git status --porcelain` prints for a file that git ignores,
# for an untracked file, for a modified file and for a staged new file.
IGNORED_MARK='!!'
UNTRACKED_MARK='??'
MODIFIED_MARK=' M'
STAGED_NEW_MARK='A '
# The first words of the two test lines.
EXISTS_PREFIX="[ -e \"$FILE_PLACEHOLDER\" ] || echo \""
PRESENT_PREFIX="[ ! -e \"$WT_FILE_PLACEHOLDER\" ] || echo \""
EXISTS_CMD_EXPECTED="$EXISTS_PREFIX$NO_PATH: $FILE_PLACEHOLDER\""
STATUS_CMD_EXPECTED="git status --porcelain --ignored --untracked-files=all -- \"$FILE_PLACEHOLDER\""
CHECK_CMD_EXPECTED="$EXISTS_CMD_EXPECTED$NL$STATUS_CMD_EXPECTED"
BRANCH_CMD_EXPECTED="git checkout -b $BRANCH_PLACEHOLDER"
WORKTREE_CMD_EXPECTED="git worktree add $WORKTREE_PLACEHOLDER -b $BRANCH_PLACEHOLDER"
PRESENT_CMD_EXPECTED="$PRESENT_PREFIX$ALREADY_THERE: $WT_FILE_PLACEHOLDER\""
MKDIR_CMD_EXPECTED="mkdir -p \"\$(dirname \"$WT_FILE_PLACEHOLDER\")\""
MV_CMD_EXPECTED="mv \"$FILE_PLACEHOLDER\" \"$WT_FILE_PLACEHOLDER\""
ADD_CMD_EXPECTED="git -C \"$WORKTREE_PLACEHOLDER\" add -- \"$WT_FILE_PLACEHOLDER\""
MOVE_CMDS_EXPECTED="$PRESENT_CMD_EXPECTED$NL$MKDIR_CMD_EXPECTED$NL$MV_CMD_EXPECTED$NL$ADD_CMD_EXPECTED"
COMMIT_SUBJECT="docs: spec and plan of $BRANCH_PLACEHOLDER"
COMMIT_CMD_EXPECTED="git -C \"$WORKTREE_PLACEHOLDER\" commit -m \"$COMMIT_SUBJECT\" -- \"$WT_FILE_PLACEHOLDER\""
# The workspace file that names the plan of the work for a later session, and
# the search that finds the lines of it that name a moved file.
STATE_FILE='state.md'
SEARCH_PREFIX='grep -n -F "'
SEARCH_CMD_EXPECTED="$SEARCH_PREFIX$TOP_PATH_PLACEHOLDER\" $STATE_FILE"

# Every sentence of the two steps, in the order of the step. A list item
# starts with "- " in the skill text; the marker is added where the sentences
# are joined (see CHECK_STEP_EXPECTED and MOVE_STEP_EXPECTED).
C_WHY='A new worktree holds only committed files. A spec or a plan that is not committed is absent there.'
C_PLAN="Step 4 moves such a file into the worktree and commits it on \`$BRANCH_PLACEHOLDER\`."
C_BEFORE='This step runs before the worktree exists, because some results forbid a worktree.'
C_SKIP='Skip this step and step 4 when the calling skill names no spec and no plan, and for a file that is already inside a worktree.'
C_PATH="\`$FILE_PLACEHOLDER\` is the path of the spec or of the plan that the calling skill names."
C_ABSOLUTE='Write it as an absolute path: git reads a relative path from the folder the command runs in, so a relative path fails in a sub-folder.'
C_RUN_CHECK='Run this check, both lines, one time for the spec and one time for the plan.'
C_FIRST_ITEM='For each file, apply the first list item that matches the result.'
C_NO_PATH="A line \`$NO_PATH\`: the path is wrong."
C_NO_PATH_ONCE='Correct it and run the check one more time.'
C_NO_PATH_AGAIN='When the line comes again: show it to the user, and step 4 does not move this file.'
C_ERROR='An error text, or an exit status that is not 0: create no worktree.'
C_SHOW_ERROR='Show the error to the user.'
C_IGNORED="A line that starts with \`$IGNORED_MARK\`: git ignores the file, so no commit can carry it into a worktree."
C_NO_WORKTREE='Create no worktree.'
C_BRANCH="Create the branch in this folder with \`$BRANCH_CMD_EXPECTED\`, which keeps the untracked and the ignored files."
C_BRANCH_NEXT='Then go on with step 5 in this folder.'
C_UNTRACKED="A line that starts with \`$UNTRACKED_MARK\`: the file is untracked, and step 4 moves it."
C_APPROVAL="When a rule of the user or of the project (for example in \`CLAUDE.md\` or \`AGENTS.md\`) forbids a commit without approval, ask the user once, before step 3, whether step 4 may commit the file on \`$BRANCH_PLACEHOLDER\`."
C_APPROVAL_NO='On "no": create no worktree and create the branch in this folder, as the list item before this one says.'
C_OTHER="A line that starts with another mark (\`$MODIFIED_MARK\` is a modified file): git tracks the file, and the file holds a change that is not committed."
C_OTHER_WHY='The worktree gets the committed state of the file, without that change.'
C_OTHER_ASK='Ask the user to choose one of two ways: the user commits the file, or the branch is created in this folder.'
C_OTHER_AGAIN='After a commit by the user, run the check for this file one more time.'
C_OTHER_BRANCH="For the other way: create no worktree and create the branch in this folder, as the list item about \`$IGNORED_MARK\` says."
C_CLEAN='No output: the file is committed.'
C_CLEAN_HELD='The worktree will hold it, and step 4 does not move it.'
CHECK_STEP_ITEM_COUNT=6

M_WHEN="Run this step only when the command of step 3 has ended with exit status 0, and only for a file whose check in step 2 printed a \`$UNTRACKED_MARK\` line."
M_ONLY='Each file is named by its own path: no other file of its folder is moved or committed.'
M_DEST="\`$WT_FILE_PLACEHOLDER\` is the place of the file inside the worktree: the path of the worktree, then the path of the file from the top of the repository."
M_EXAMPLE="For the file \`docs/a/plan.md\` of the repository it is \`$WORKTREE_PLACEHOLDER/docs/a/plan.md\`."
M_RUN='Run these four commands for one file, one command at a time, in this order.'
M_NEXT_FILE='Then run them for the next file.'
M_PRESENT="The first command prints a line \`$ALREADY_THERE\`: never overwrite that file."
M_STOP='Run no later command of this step.'
M_PRESENT_ASK='Tell the user that both files exist, and ask what to do.'
M_FAILED="A command ends with an exit status that is not 0: run no later command of this step."
M_SHOW_ERROR='Show the error to the user.'
M_WHERE='Say where the file is now: in the folder of step 2 when the `mv` command has not succeeded, and in the worktree, not committed, when it has.'
M_COMMIT='After the last file, commit the moved files with this command.'
M_COMMIT_NAMES='Name every moved file in it, each path between its own quotes, and no other path.'
M_COMMIT_FAILED='The commit ends with an exit status that is not 0 (for example, a commit hook refuses it): run it no second time, and do not switch the hook off.'
M_COMMIT_WHERE='Say that the moved files are in the worktree, staged and not committed, and that the folder of step 2 holds no copy of them.'
M_COMMIT_DONE='The commit ends with exit status 0: go on with step 5.'
M_USE='From then on, the spec and the plan of this work are the files inside the worktree: use the path inside the worktree in every command and in every edit.'
M_WRONG_BRANCH="A commit of the plan that runs in the folder of step 2 lands on the branch of that folder, not on \`$BRANCH_PLACEHOLDER\`."
M_TELL='Tell the user the new absolute path of each moved file.'
M_STATE="When \`$STATE_FILE\` at the top of the repository of step 2 names the old path of a moved file, write the path inside the worktree there, as an absolute path, in this step."
M_STATE_FIND="\`$SEARCH_CMD_EXPECTED\`, run in that top folder with the path of the file from the top of the repository, prints the lines that name the file; a line that already holds the path inside the worktree needs no change."
M_PROMPT='When this session gives the user a prompt for a later session, that prompt names the path inside the worktree.'
MOVE_STEP_ITEM_COUNT=4

# join_texts <text>...: the texts joined with one space.
join_texts() {
  local joined='' part
  for part in "$@"; do joined="$joined${joined:+ }$part"; done
  printf '%s' "$joined"
}
FENCE_START='```bash'
FENCE_END='```'
CHECK_STEP_EXPECTED=$(join_texts "$C_WHY" "$C_PLAN" "$C_BEFORE" "$C_SKIP" "$C_PATH" "$C_ABSOLUTE" \
  "$C_RUN_CHECK" "$FENCE_START" "$EXISTS_CMD_EXPECTED" "$STATUS_CMD_EXPECTED" "$FENCE_END" "$C_FIRST_ITEM" \
  "- $C_NO_PATH" "$C_NO_PATH_ONCE" "$C_NO_PATH_AGAIN" \
  "- $C_ERROR" "$C_SHOW_ERROR" \
  "- $C_IGNORED" "$C_NO_WORKTREE" "$C_BRANCH" "$C_BRANCH_NEXT" \
  "- $C_UNTRACKED" "$C_APPROVAL" "$C_APPROVAL_NO" \
  "- $C_OTHER" "$C_OTHER_WHY" "$C_OTHER_ASK" "$C_OTHER_AGAIN" "$C_OTHER_BRANCH" \
  "- $C_CLEAN" "$C_CLEAN_HELD")
MOVE_STEP_EXPECTED=$(join_texts "$M_WHEN" "$M_ONLY" "$M_DEST" "$M_EXAMPLE" "$M_RUN" "$M_NEXT_FILE" \
  "$FENCE_START" "$PRESENT_CMD_EXPECTED" "$MKDIR_CMD_EXPECTED" "$MV_CMD_EXPECTED" "$ADD_CMD_EXPECTED" "$FENCE_END" \
  "- $M_PRESENT" "$M_STOP" "$M_PRESENT_ASK" \
  "- $M_FAILED" "$M_SHOW_ERROR" "$M_WHERE" \
  "$M_COMMIT" "$M_COMMIT_NAMES" "$FENCE_START" "$COMMIT_CMD_EXPECTED" "$FENCE_END" \
  "- $M_COMMIT_FAILED" "$M_SHOW_ERROR" "$M_COMMIT_WHERE" \
  "- $M_COMMIT_DONE" \
  "$M_USE" "$M_WRONG_BRANCH" \
  "$M_TELL" "$M_STATE" "$M_STATE_FIND" "$M_PROMPT")

# ---------------------------------------------------------------------------
# Text taken out of the skill file
# ---------------------------------------------------------------------------

# fold_text: standard input with every run of blanks and line breaks made one
# space, and no blank at the start or at the end. The prose of a skill wraps,
# so a phrase can stand on two lines.
fold_text() { tr '\n\t' '  ' | tr -s ' ' | sed 's/^ //; s/ $//'; }

# A heading line is a line that starts with `#` marks and a blank, outside a
# fenced block: a fenced block of the skill holds shell comment lines that
# start with `# `.
# headings: every heading line of the skill file.
headings() {
  awk '/^```/ { fence = !fence; next } !fence && /^#+ / { print }' "$SKILL" 2>/dev/null
}
# section <heading>: the lines of the skill file after the line <heading>, up
# to the next heading line. For $START_OF_FILE: the lines above the first
# heading.
section() {
  awk -v h="$1" -v start="$START_OF_FILE" '
    BEGIN { f = (h == start) }
    /^```/ { fence = !fence }
    !fence && /^#+ / { if (f) exit; if ($0 == h) f = 1; next }
    f { print }' "$SKILL" 2>/dev/null
}
# section_sum <heading>: the checksum of the text of the section, wrapped
# lines joined.
section_sum() { section "$1" | fold_text | cksum | cut -d' ' -f1; }
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
# fence_line_count <text>: the number of lines of the text that start or end a
# fenced block.
fence_line_count() { printf '%s\n' "$1" | grep -c '^[[:space:]]*```'; }
# block <text> <number>: the lines of the ```bash block of the text with that
# number (1 is the first), without the fences.
block() {
  printf '%s\n' "$1" | awk -v want="$2" '
    /^```bash$/ { n++; c = (n == want); next }
    c && /^```$/ { exit }
    c { print }'
}
# line_number <text> <number>: that line of the text.
line_number() { printf '%s\n' "$1" | sed -n "${2}p"; }
# code_span <text> <first words>: the first text between two ` characters of
# <text> that starts with <first words>. Both reach awk through the
# environment, so no character of them is read as a pattern.
code_span() {
  text="$1" prefix="$2" awk 'BEGIN {
    n = split(ENVIRON["text"], part, "`")
    for (i = 2; i <= n; i += 2) if (index(part[i], ENVIRON["prefix"]) == 1) { print part[i]; exit }
  }'
}
# line_of <fixed text>: the number of the first line of the skill file that
# holds the text; 0 when no line holds it.
line_of() {
  local number
  number=$(grep -nF -- "$1" "$SKILL" 2>/dev/null | head -1 | cut -d: -f1)
  echo "${number:-0}"
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

CHECK_STEP=$(section "$CHECK_HEADING")
MOVE_STEP=$(section "$MOVE_HEADING")
CHECK_CMD=$(block "$CHECK_STEP" 1)
IGNORED_ITEM=$(bullet "$CHECK_STEP" "A line that starts with \`$IGNORED_MARK\`")
BRANCH_CMD=$(code_span "$IGNORED_ITEM" 'git checkout')
WORKTREE_CMD=$(block "$(section "$CREATE_HEADING")" 1)
MOVE_CMDS=$(block "$MOVE_STEP" 1)
COMMIT_CMD=$(block "$MOVE_STEP" 2)
SEARCH_CMD=$(code_span "$MOVE_STEP" "$SEARCH_PREFIX")

# with_values <text>: the text with each placeholder replaced by the name of a
# shell variable. The quotes around a path come from the skill text, so a
# command that the skill writes without quotes fails on a path with a space.
with_values() {
  printf '%s\n' "$1" | sed "s/$FILE_PLACEHOLDER/\$FILE_PATH/g; s/$WT_FILE_PLACEHOLDER/\$WT_FILE/g; s/$BRANCH_PLACEHOLDER/\$BRANCH/g; s/$WORKTREE_PLACEHOLDER/\$WT/g; s/$TOP_PATH_PLACEHOLDER/\$TOP_PATH/g"
}
# runnable <command>: the command with the placeholders replaced, when the
# command is one line that starts with `git `, with the first words of one of
# the two test lines, with `mkdir -p "`, with `mv "` or with the first words
# of the search in the state file. In every other case
# the result is empty and the command is not run: a behaviour check must never
# run an arbitrary line of a changed skill file.
runnable() {
  [ "$(line_count "$1")" -eq 1 ] || return 0
  case "$1" in
    'git '*|"$EXISTS_PREFIX"*|"$PRESENT_PREFIX"*|'mkdir -p "'*|'mv "'*|"$SEARCH_PREFIX"*) with_values "$1" ;;
  esac
}
EXISTS_RUN=$(runnable "$(line_number "$CHECK_CMD" 1)")
STATUS_RUN=$(runnable "$(line_number "$CHECK_CMD" 2)")
BRANCH_RUN=$(runnable "$BRANCH_CMD")
WORKTREE_RUN=$(runnable "$WORKTREE_CMD")
PRESENT_RUN=$(runnable "$(line_number "$MOVE_CMDS" 1)")
MKDIR_RUN=$(runnable "$(line_number "$MOVE_CMDS" 2)")
MV_RUN=$(runnable "$(line_number "$MOVE_CMDS" 3)")
ADD_RUN=$(runnable "$(line_number "$MOVE_CMDS" 4)")
COMMIT_RUN=$(runnable "$COMMIT_CMD")
SEARCH_RUN=$(runnable "$SEARCH_CMD")
# commit_run_for <count>: the commit command with one quoted path for each
# moved file, as the sentence after the command tells ("Name every moved file
# in it, each path between its own quotes"). The paths are $WT_FILE_1,
# $WT_FILE_2 and so on.
commit_run_for() {
  local names='' i=1
  while [ "$i" -le "$1" ]; do
    names="$names${names:+ }\"\$WT_FILE_$i\""
    i=$((i+1))
  done
  printf '%s\n' "$COMMIT_RUN" | sed "s/\"\\\$WT_FILE\"/$names/"
}

# The values of the placeholders for the next run.
FILE_PATH=''
WT_FILE=''
WT_FILE_1=''
WT_FILE_2=''
TOP_PATH=''
NO_COMMAND='(the skill text holds no command that this suite can run)'
# run_lines <folder> <command>...: run the commands, one after the other, in
# <folder>; a command that fails ends the run. $FILE_PATH, $WT_FILE,
# $WT_FILE_1, $WT_FILE_2 and $TOP_PATH hold the values that the caller has set, $BRANCH
# the branch name of the fixture and $WT the worktree path of the fixture.
# Leaves the output (both streams) in OUT and the exit code in CODE. An empty
# command runs nothing: OUT then holds a message, so that no check passes on
# an empty output, and RAN is 0.
run_lines() {
  local folder="$1" command
  shift
  for command in "$@"; do
    if [ -z "$command" ]; then OUT="$NO_COMMAND"; CODE=1; RAN=0; return 0; fi
  done
  CODE=0
  RAN=1
  OUT=$( { cd "$folder" && BRANCH="$FEATURE_BRANCH" && WT="$WORKTREE" && for command in "$@"; do
    eval "$command" || exit $?
  done; } 2>&1 ) || CODE=$?
}
# check_file <folder> <path>: the two lines of the check of step 2.
check_file() {
  FILE_PATH="$2"
  run_lines "$1" "$EXISTS_RUN" "$STATUS_RUN"
}
# create_worktree: the worktree command of step 3, in the main checkout.
create_worktree() { run_lines "$MAIN" "$WORKTREE_RUN"; }
# create_branch: the branch command of step 2, in the main checkout.
create_branch() { run_lines "$MAIN" "$BRANCH_RUN"; }
# move_file <folder> <path from the top of the repository>: the four commands
# of step 4 for one file, as the step tells: the first command alone, and the
# three other commands only when the first one printed nothing. MOVED is 1
# when all four ran and none failed.
move_file() {
  FILE_PATH="$MAIN/$2"
  WT_FILE="$WORKTREE/$2"
  MOVED=0
  run_lines "$1" "$PRESENT_RUN"
  if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ] && [ -z "$OUT" ]; then
    run_lines "$1" "$MKDIR_RUN" "$MV_RUN" "$ADD_RUN"
    if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ]; then MOVED=1; fi
  fi
}
# commit_moved <folder> <path from the top>...: the commit command of step 4
# with every named file.
commit_moved() {
  local folder="$1"
  shift
  WT_FILE_1="$WORKTREE/$1"
  WT_FILE_2="$WORKTREE/${2:-}"
  run_lines "$folder" "$(commit_run_for "$#")"
}
# do_steps <folder> <path from the top>...: step 3, then step 4 for the files.
# ALL_MOVED is 1 when the worktree was created and every file was moved.
do_steps() {
  local folder="$1" file
  shift
  ALL_MOVED=0
  create_worktree
  if [ "$RAN" -ne 1 ] || [ "$CODE" -ne 0 ]; then return 0; fi
  for file in "$@"; do
    move_file "$folder" "$file"
    if [ "$MOVED" -ne 1 ]; then return 0; fi
  done
  ALL_MOVED=1
  commit_moved "$folder" "$@"
}
# assert_ran_ok <desc>: a command ran and ended with exit code 0.
assert_ran_ok() {
  if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ]; then ok "$1"; else bad "$1 (exit code $CODE, output: $(one_line "$OUT"))"; fi
}
# assert_ran_failed <desc>: a command ran, ended with an exit code that is not
# 0, and printed a text.
assert_ran_failed() {
  if [ "$RAN" -eq 1 ] && [ "$CODE" -ne 0 ] && [ -n "$OUT" ]; then ok "$1"; else bad "$1 (exit code $CODE, output: $(one_line "$OUT"))"; fi
}
# assert_eq_when <desc> <actual> <expected> <flag>: assert_eq, and a failure
# when <flag> is not 1. The flag says that the commands before the check ran
# and succeeded, so the check cannot pass on a fixture that nothing changed.
assert_eq_when() {
  if [ "$4" = 1 ]; then assert_eq "$1" "$2" "$3"; else bad "$1 (the commands before this check did not all run and succeed)"; fi
}
# ran_ok: prints 1 when the last run ran a command and ended with exit code 0.
ran_ok() { if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ]; then echo 1; else echo 0; fi; }
# assert_out_lacks <desc> <fixed text>: a command ran, and no line of its
# output holds the text.
assert_out_lacks() {
  if [ "$RAN" -eq 1 ] && ! printf '%s\n' "$OUT" | grep -qF -- "$2"; then ok "$1"; else bad "$1 (got: $(one_line "$OUT"))"; fi
}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FEATURE_BRANCH='feature/demo'
BASE_BRANCH='main'
LAYOUT_ROOT='docs/superpowers-orchestrator'
TOPIC_NAME='2026-10-04-demo'
SPEC_FILE='specs/demo-design.md'
SPEC_LOG_FILE='specs/demo-design-review-log.md'
PLAN_FILE='plans/demo.md'
# A file of the topic folder that no skill names.
PRIVATE_FILE='credentials.env'
TRACKED_FILE='src/a.js'
OPEN_TASK='- [ ] task 1'
DONE_TASK='- [x] task 1'
EXPECTED_SUBJECT="docs: spec and plan of $FEATURE_BRANCH"

# new_fixture <name> [<topic folder from the top>] [<line for .gitignore>]: a
# repository $TMP/<name> with one commit on the branch main and a tracked
# .gitignore, and an untracked topic folder with a spec, its review log, a
# plan and a private file. Leaves the paths in MAIN and WORKTREE, and the
# paths from the top of the repository in TOPIC_REL, SPEC_REL and PLAN_REL.
new_fixture() {
  MAIN="$TMP/$1"
  WORKTREE="$MAIN/.worktrees/demo"
  TOPIC_REL="${2:-$LAYOUT_ROOT/$TOPIC_NAME}"
  SPEC_REL="$TOPIC_REL/$SPEC_FILE"
  PLAN_REL="$TOPIC_REL/$PLAN_FILE"
  git init -q "$MAIN"
  git -C "$MAIN" symbolic-ref HEAD "refs/heads/$BASE_BRANCH"
  mkdir "$MAIN/src"
  echo 'first version' > "$MAIN/$TRACKED_FILE"
  printf '%s\n' '.worktrees/' "${3:-ignored-by-rule.md}" > "$MAIN/.gitignore"
  git -C "$MAIN" add -A
  git -C "$MAIN" commit -q -m 'base'
  write_topic
}
# write_topic: the four untracked files of the topic folder of the fixture.
write_topic() {
  mkdir -p "$MAIN/$TOPIC_REL/specs" "$MAIN/$TOPIC_REL/plans"
  echo '# Demo design' > "$MAIN/$SPEC_REL"
  echo '# Demo design review log' > "$MAIN/$TOPIC_REL/$SPEC_LOG_FILE"
  printf '# Demo plan\n\n%s\n' "$OPEN_TASK" > "$MAIN/$PLAN_REL"
  echo 'TOKEN=secret' > "$MAIN/$TOPIC_REL/$PRIVATE_FILE"
}
# commit_in_main <path from the top>...: commit the files with plain git on
# the branch of the main checkout.
commit_in_main() {
  git -C "$MAIN" add -- "$@"
  git -C "$MAIN" commit -q -m 'docs in the first folder' -- "$@"
}
# tick <plan file>: mark the task of the plan as done.
tick() { printf '# Demo plan\n\n%s\n' "$DONE_TASK" > "$1"; }
# commit_count <branch>: the number of commits of the branch of the fixture; 0
# when the branch does not exist.
commit_count() { git -C "$MAIN" rev-list --count "$1" -- 2>/dev/null || echo 0; }
# head_files <folder>: the paths of the newest commit in that working folder,
# sorted, one per line.
head_files() { git -C "$1" show --name-only --format= HEAD 2>/dev/null | sort; }
# sorted <line>...: the arguments, sorted, one per line.
sorted() { printf '%s\n' "$@" | sort; }
# main_status: the whole status of the main checkout of the fixture.
main_status() { git -C "$MAIN" status --porcelain --untracked-files=all 2>&1; }
# The two files of the topic folder that the steps must not touch, as the
# status of the main checkout names them.
left_alone() { printf '%s\n%s' "$UNTRACKED_MARK $TOPIC_REL/$PRIVATE_FILE" "$UNTRACKED_MARK $TOPIC_REL/$SPEC_LOG_FILE"; }
# assert_moved <desc> <path from the top>...: after steps 3 and 4, the main
# checkout holds no copy of the files, the worktree holds them, the newest
# commit of the worktree holds exactly these paths, and the status of the main
# checkout has no line for them.
assert_moved() {
  local desc="$1" file here=1 lines=0
  shift
  for file in "$@"; do
    if [ -e "$MAIN/$file" ] || [ ! -f "$WORKTREE/$file" ]; then here=0; fi
    if main_status | grep -qF -- "$file"; then lines=1; fi
  done
  if [ "$ALL_MOVED" -eq 1 ] && [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ]; then
    ok "$desc: every command of steps 3 and 4 succeeds"
  else
    bad "$desc: every command of steps 3 and 4 succeeds (exit code $CODE, output: $(one_line "$OUT"))"
  fi
  if [ "$here" -eq 1 ]; then
    ok "$desc: the worktree holds the files, and the first folder holds no copy"
  else
    bad "$desc: the worktree holds the files, and the first folder holds no copy"
  fi
  assert_eq "$desc: the commit in the worktree holds exactly the moved paths" \
    "$(head_files "$WORKTREE")" "$(sorted "$@")"
  if [ "$lines" -eq 0 ]; then
    ok "$desc: the status of the first folder has no line for the moved files"
  else
    bad "$desc: the status of the first folder has no line for the moved files (status: $(one_line "$(main_status)"))"
  fi
}

# ---------------------------------------------------------------------------
bold "1. What git does (why the steps exist)"
# ---------------------------------------------------------------------------

new_fixture defect
git -C "$MAIN" worktree add -q "$WORKTREE" -b "$FEATURE_BRANCH"
label="a new worktree holds no untracked spec and no untracked plan"
if [ -d "$WORKTREE" ] && [ ! -e "$WORKTREE/$TOPIC_REL" ]; then ok "$label"; else bad "$label"; fi
tick "$MAIN/$PLAN_REL"
commit_in_main "$PLAN_REL"
assert_eq "a commit of the plan in the first folder lands on $BASE_BRANCH (2 commits there)" \
  "$(commit_count "$BASE_BRANCH")" '2'
assert_eq "the same commit is not on $FEATURE_BRANCH (1 commit there)" \
  "$(commit_count "$FEATURE_BRANCH")" '1'

# Why the steps move the files and do not copy them: a copy stays untracked in
# the first folder, and git then refuses the merge of the branch there.
new_fixture copy-defect
git -C "$MAIN" worktree add -q "$WORKTREE" -b "$FEATURE_BRANCH"
mkdir -p "$WORKTREE/$TOPIC_REL/plans"
cp "$MAIN/$PLAN_REL" "$WORKTREE/$PLAN_REL"
git -C "$WORKTREE" add -- "$PLAN_REL"
git -C "$WORKTREE" commit -q -m 'plan copy' -- "$PLAN_REL"
CODE=0
OUT=$(git -C "$MAIN" merge --no-edit "$FEATURE_BRANCH" 2>&1) || CODE=$?
label="after a copy in place of a move, git refuses the merge in the first folder"
if [ "$CODE" -ne 0 ]; then ok "$label"; else bad "$label (output: $(one_line "$OUT"))"; fi

# ---------------------------------------------------------------------------
bold "2. The skill text holds the steps and their commands"
# ---------------------------------------------------------------------------

assert_eq "the skill has exactly these headings, in this order" "$(headings)" "$HEADINGS_EXPECTED"
assert_eq "the fenced block of step 2 holds the two lines of the check" \
  "$CHECK_CMD" "$CHECK_CMD_EXPECTED"
assert_eq "the list item about an ignored file holds the branch command" \
  "$BRANCH_CMD" "$BRANCH_CMD_EXPECTED"
assert_eq "the fenced block of step 3 holds the worktree command" \
  "$WORKTREE_CMD" "$WORKTREE_CMD_EXPECTED"
assert_eq "the first fenced block of step 4 holds the four move commands" \
  "$MOVE_CMDS" "$MOVE_CMDS_EXPECTED"
assert_eq "the second fenced block of step 4 holds the commit command" \
  "$COMMIT_CMD" "$COMMIT_CMD_EXPECTED"
assert_eq "step 4 holds the search in the state file" "$SEARCH_CMD" "$SEARCH_CMD_EXPECTED"
# The words of the worktree command in every spelling: any letter case, any
# run of blanks or line breaks between the two words.
assert_eq "the skill names 'worktree add' exactly one time, in every spelling" \
  "$(fold_text < "$SKILL" | grep -oiE 'worktree[[:space:]]+add' | wc -l | tr -d ' ')" '1'
CHECK_LINE=$(line_of "$STATUS_CMD_EXPECTED")
WORKTREE_LINE=$(line_of "$WORKTREE_CMD_EXPECTED")
MV_LINE=$(line_of "$MV_CMD_EXPECTED")
COMMIT_LINE=$(line_of "$COMMIT_CMD_EXPECTED")
label="in the skill file the check stands before the worktree command, the move after it, and the commit after the move"
if [ "$CHECK_LINE" -gt 0 ] && [ "$CHECK_LINE" -lt "$WORKTREE_LINE" ] \
  && [ "$WORKTREE_LINE" -lt "$MV_LINE" ] && [ "$MV_LINE" -lt "$COMMIT_LINE" ]; then
  ok "$label"
else
  bad "$label (lines: check $CHECK_LINE, worktree $WORKTREE_LINE, move $MV_LINE, commit $COMMIT_LINE; 0 means absent)"
fi

# ---------------------------------------------------------------------------
bold "3. The check of step 2 on fixture repositories"
# ---------------------------------------------------------------------------

new_fixture check-untracked
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "an untracked plan gives one '$UNTRACKED_MARK' line, and no line for another file of its folder" \
  "$OUT" "$UNTRACKED_MARK $PLAN_REL"
assert_eq "the check on an untracked plan gives exit code 0" "$CODE" '0'
check_file "$MAIN" "$MAIN/$SPEC_REL"
assert_eq "an untracked spec gives one '$UNTRACKED_MARK' line" "$OUT" "$UNTRACKED_MARK $SPEC_REL"
check_file "$MAIN/src" "$MAIN/$PLAN_REL"
assert_eq "a run in a sub-folder with the absolute path gives the same line" "$OUT" "$UNTRACKED_MARK $PLAN_REL"
check_file "$MAIN/src" "$PLAN_REL"
out_has_line "a run in a sub-folder with the relative path prints the line '$NO_PATH'" "$NO_PATH: $PLAN_REL"
assert_out_lacks "a run in a sub-folder with the relative path prints no '$UNTRACKED_MARK' line" "$UNTRACKED_MARK"
check_file "$MAIN" "$MAIN/$PLAN_REL-typo"
assert_eq "a path that does not exist gives the line '$NO_PATH', and it is the only line" \
  "$OUT" "$NO_PATH: $MAIN/$PLAN_REL-typo"
check_file "$MAIN" ''
out_has_line "an empty path gives the line '$NO_PATH'" "$NO_PATH: "
assert_ran_failed "an empty path gives an exit code that is not 0"
assert_out_lacks "an empty path does not report on the whole repository" "$PRIVATE_FILE"
check_file "$MAIN" "$TMP"
assert_ran_failed "a path outside the repository gives an exit code that is not 0, and an error text"

new_fixture check-tracked
commit_in_main "$SPEC_REL" "$PLAN_REL"
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "a committed plan gives no output" "$OUT" ''
assert_eq "a committed plan gives exit code 0" "$CODE" '0'
tick "$MAIN/$PLAN_REL"
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "a modified tracked plan gives one '$MODIFIED_MARK' line" "$OUT" "$MODIFIED_MARK $PLAN_REL"
# The sentence "The worktree gets the committed state of the file, without
# that change", and the reason why step 4 is not run for such a file.
create_worktree
assert_eq "the worktree gets the committed state of a modified plan, without the change" \
  "$(grep -cxF -- "$OPEN_TASK" "$WORKTREE/$PLAN_REL" 2>/dev/null)" '1'

new_fixture check-staged
git -C "$MAIN" add -- "$PLAN_REL"
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "a new plan that is staged and not committed gives one '$STAGED_NEW_MARK' line" \
  "$OUT" "$STAGED_NEW_MARK $PLAN_REL"

new_fixture check-ignored '' 'docs/'
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "a plan in an ignored docs/ folder gives one '$IGNORED_MARK' line" "$OUT" "$IGNORED_MARK $PLAN_REL"

# A user can hide untracked files from `git status` with a setting. The check
# must name the file all the same.
new_fixture check-setting
git -C "$MAIN" config status.showUntrackedFiles no
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "with status.showUntrackedFiles=no the '$UNTRACKED_MARK' line is printed" "$OUT" "$UNTRACKED_MARK $PLAN_REL"

# Git prints a path with a space between two " characters.
new_fixture check-space "$LAYOUT_ROOT/2026-10-04-my demo"
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "a path with a space gives one '$UNTRACKED_MARK' line" "$OUT" "$UNTRACKED_MARK \"$PLAN_REL\""

mkdir -p "$TMP/no-repository/docs"
echo 'plan' > "$TMP/no-repository/docs/plan.md"
MAIN="$TMP/no-repository"
check_file "$MAIN" "$MAIN/docs/plan.md"
assert_ran_failed "a folder that is not a git repository gives an exit code that is not 0, and an error text"

# ---------------------------------------------------------------------------
bold "4. Step 3, then step 4: the files move into the worktree and are committed there"
# ---------------------------------------------------------------------------

new_fixture move-untracked
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
assert_moved "untracked spec and plan" "$SPEC_REL" "$PLAN_REL"
assert_eq "the files that no skill names stay untracked in the first folder, and nothing else is there" \
  "$(main_status)" "$(left_alone)"
label="the worktree holds no file of the topic folder that no skill names"
if [ "$ALL_MOVED" -eq 1 ] && [ ! -e "$WORKTREE/$TOPIC_REL/$PRIVATE_FILE" ] && [ ! -e "$WORKTREE/$TOPIC_REL/$SPEC_LOG_FILE" ]; then
  ok "$label"
else
  bad "$label"
fi
assert_eq "no commit is made on $BASE_BRANCH (1 commit there), and one on $FEATURE_BRANCH (2 commits there)" \
  "$(commit_count "$BASE_BRANCH") $(commit_count "$FEATURE_BRANCH")" '1 2'
assert_eq "the subject of the commit names the branch" \
  "$(git -C "$WORKTREE" log -1 --format=%s 2>/dev/null)" "$EXPECTED_SUBJECT"
# The step run a second time, with the path that the calling skill named.
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "a second run of the check with the first path gives the line '$NO_PATH', and it is the only line" \
  "$OUT" "$NO_PATH: $MAIN/$PLAN_REL"
create_worktree
assert_ran_failed "a second run of the worktree command fails"
label="after the failed second run the worktree still holds the spec and the plan"
if [ -f "$WORKTREE/$SPEC_REL" ] && [ -f "$WORKTREE/$PLAN_REL" ]; then ok "$label"; else bad "$label"; fi
# The sentences at the end of step 4: the plan of the work is the file inside
# the worktree.
{
  tick "$WORKTREE/$PLAN_REL"
  git -C "$WORKTREE" add -- "$PLAN_REL"
  git -C "$WORKTREE" commit -q -m 'chore(plan): demo task 1 complete' -- "$PLAN_REL"
} 2>/dev/null
assert_eq "a commit of the plan inside the worktree lands on $FEATURE_BRANCH (3 commits there)" \
  "$(commit_count "$FEATURE_BRANCH")" '3'
# The later merge of the branch in the first folder.
CODE=0
OUT=$(git -C "$MAIN" merge -q --no-edit "$FEATURE_BRANCH" 2>&1) || CODE=$?
label="the later merge of $FEATURE_BRANCH into $BASE_BRANCH in the first folder succeeds, and the first folder then holds the spec and the plan"
if [ "$ALL_MOVED" -eq 1 ] && [ "$CODE" -eq 0 ] && [ -f "$MAIN/$SPEC_REL" ] && [ -f "$MAIN/$PLAN_REL" ]; then
  ok "$label"
else
  bad "$label (exit code $CODE, output: $(one_line "$OUT"))"
fi

new_fixture move-plan-only
commit_in_main "$SPEC_REL"
check_file "$MAIN" "$MAIN/$SPEC_REL"
assert_eq "a committed spec gives no output" "$OUT" ''
do_steps "$MAIN" "$PLAN_REL"
assert_moved "committed spec, untracked plan" "$PLAN_REL"
label="the worktree holds the committed spec too, and the first folder keeps its committed spec"
if [ "$ALL_MOVED" -eq 1 ] && [ -f "$WORKTREE/$SPEC_REL" ] && [ -f "$MAIN/$SPEC_REL" ]; then ok "$label"; else bad "$label"; fi

new_fixture move-detached
git -C "$MAIN" checkout -q --detach
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
assert_moved "detached HEAD" "$SPEC_REL" "$PLAN_REL"
assert_eq "detached HEAD: the commit is on $FEATURE_BRANCH only ($BASE_BRANCH has 1 commit)" \
  "$(commit_count "$BASE_BRANCH") $(commit_count "$FEATURE_BRANCH")" '1 2'

new_fixture move-space "$LAYOUT_ROOT/2026-10-04-my demo"
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
assert_moved "a path with a space" "$SPEC_REL" "$PLAN_REL"

new_fixture move-outside-layout 'notes/work'
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
assert_moved "a spec and a plan outside $LAYOUT_ROOT" "$SPEC_REL" "$PLAN_REL"

new_fixture move-setting
git -C "$MAIN" config status.showUntrackedFiles no
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
assert_moved "status.showUntrackedFiles=no" "$SPEC_REL" "$PLAN_REL"

new_fixture move-sub-folder
do_steps "$MAIN/src" "$SPEC_REL" "$PLAN_REL"
assert_moved "the commands of step 4 run in a sub-folder" "$SPEC_REL" "$PLAN_REL"

# A merge that has stopped on a conflict in the first folder. The commit of
# step 4 runs in the worktree, so it must not end that merge.
new_fixture move-during-merge
{
  git -C "$MAIN" checkout -q -b other
  echo 'other version' > "$MAIN/$TRACKED_FILE"
  git -C "$MAIN" commit -q -a -m 'other'
  git -C "$MAIN" checkout -q "$BASE_BRANCH"
  echo 'main version' > "$MAIN/$TRACKED_FILE"
  git -C "$MAIN" commit -q -a -m 'main'
  git -C "$MAIN" merge other
} >/dev/null 2>&1
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
assert_moved "a merge in progress in the first folder" "$SPEC_REL" "$PLAN_REL"
label="the merge in the first folder is still in progress, with its conflict"
if [ "$ALL_MOVED" -eq 1 ] && git -C "$MAIN" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
  && main_status | grep -qxF -- "UU $TRACKED_FILE"; then
  ok "$label"
else
  bad "$label (status: $(one_line "$(main_status)"))"
fi

# A repository with no commit. Git 2.42 and later create the worktree on a
# branch with no commit; an older git refuses. Both results are correct for
# the steps: the files move only after a worktree command that succeeded.
MAIN="$TMP/move-no-commit"
WORKTREE="$MAIN/.worktrees/demo"
TOPIC_REL="$LAYOUT_ROOT/$TOPIC_NAME"
SPEC_REL="$TOPIC_REL/$SPEC_FILE"
PLAN_REL="$TOPIC_REL/$PLAN_FILE"
git init -q "$MAIN"
git -C "$MAIN" symbolic-ref HEAD "refs/heads/$BASE_BRANCH"
write_topic
check_file "$MAIN" "$MAIN/$PLAN_REL"
assert_eq "a repository with no commit: the check gives one '$UNTRACKED_MARK' line" "$OUT" "$UNTRACKED_MARK $PLAN_REL"
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
if [ "$ALL_MOVED" -eq 1 ]; then
  assert_moved "a repository with no commit (this git creates the worktree)" "$SPEC_REL" "$PLAN_REL"
else
  label="a repository with no commit (this git creates no worktree): the worktree command fails, and the files stay in the first folder"
  if [ "$RAN" -eq 1 ] && [ "$CODE" -ne 0 ] && [ -f "$MAIN/$SPEC_REL" ] && [ -f "$MAIN/$PLAN_REL" ]; then
    ok "$label"
  else
    bad "$label (exit code $CODE, output: $(one_line "$OUT"))"
  fi
fi

# The commands name the moved files only: a file that is staged in the
# worktree for another reason stays staged, and an untracked file in the
# folder of the plan inside the worktree stays untracked.
EXTRA_FILE='extra.txt'
SIBLING_FILE='plans/sibling.md'
new_fixture commit-only-moved
create_worktree
{
  mkdir -p "$WORKTREE/$TOPIC_REL/plans"
  echo 'sibling' > "$WORKTREE/$TOPIC_REL/$SIBLING_FILE"
  echo 'extra' > "$WORKTREE/$EXTRA_FILE"
  git -C "$WORKTREE" add -- "$EXTRA_FILE"
} 2>/dev/null
move_file "$MAIN" "$PLAN_REL"
commit_moved "$MAIN" "$PLAN_REL"
assert_ran_ok "the commit command succeeds while another file is staged in the worktree"
assert_eq "the commit holds only the moved plan" "$(head_files "$WORKTREE")" "$PLAN_REL"
assert_eq_when "the other staged file stays staged, and the other file of the folder stays untracked" \
  "$(git -C "$WORKTREE" status --porcelain --untracked-files=all 2>&1)" \
  "$STAGED_NEW_MARK $EXTRA_FILE$NL$UNTRACKED_MARK $TOPIC_REL/$SIBLING_FILE" "$(ran_ok)"

# ---------------------------------------------------------------------------
bold "5. Step 4 when a command must not run, or fails"
# ---------------------------------------------------------------------------

# The same path is already present in the worktree.
OTHER_CONTENT='another plan'
new_fixture present
create_worktree
{
  mkdir -p "$WORKTREE/$TOPIC_REL/plans"
  echo "$OTHER_CONTENT" > "$WORKTREE/$PLAN_REL"
} 2>/dev/null
move_file "$MAIN" "$PLAN_REL"
out_has_line "a file that the worktree already holds: the first command prints the line '$ALREADY_THERE'" \
  "$ALREADY_THERE: $WORKTREE/$PLAN_REL"
label="a file that the worktree already holds is not overwritten, and the file of the first folder stays"
if [ "$RAN" -eq 1 ] && [ "$MOVED" -eq 0 ] && [ "$(cat "$WORKTREE/$PLAN_REL" 2>/dev/null)" = "$OTHER_CONTENT" ] \
  && grep -qxF -- "$OPEN_TASK" "$MAIN/$PLAN_REL" 2>/dev/null; then
  ok "$label"
else
  bad "$label"
fi
move_file "$MAIN" "$SPEC_REL"
label="for a file that the worktree does not hold, the first command prints nothing, and the file moves"
if [ "$MOVED" -eq 1 ] && [ -z "$OUT" ]; then ok "$label"; else bad "$label (output: $(one_line "$OUT"))"; fi

# The `mv` command fails: the file to move does not exist.
new_fixture move-fails
create_worktree
move_file "$MAIN" "$PLAN_REL-typo"
assert_ran_failed "the move of a file that does not exist ends with an exit code that is not 0, and an error text"
assert_eq_when "after a failed move nothing is staged in the worktree" \
  "$(git -C "$WORKTREE" status --porcelain 2>&1)" '' "$RAN"

# A commit hook that refuses every commit. The hooks folder of the repository
# is used by the worktree too.
new_fixture hook
printf '#!/bin/sh\necho "hook: refused" >&2\nexit 1\n' > "$MAIN/.git/hooks/pre-commit"
chmod +x "$MAIN/.git/hooks/pre-commit"
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
assert_ran_failed "a commit hook that refuses: the commit command ends with an exit code that is not 0, and an error text"
assert_eq_when "after the refused commit no commit is on $FEATURE_BRANCH (1 commit there)" \
  "$(commit_count "$FEATURE_BRANCH")" '1' "$ALL_MOVED"
assert_eq "after the refused commit the moved files are in the worktree, staged and not committed" \
  "$(git -C "$WORKTREE" status --porcelain 2>&1)" "$STAGED_NEW_MARK $PLAN_REL$NL$STAGED_NEW_MARK $SPEC_REL"
label="after the refused commit the first folder holds no copy of the moved files"
if [ "$ALL_MOVED" -eq 1 ] && [ ! -e "$MAIN/$SPEC_REL" ] && [ ! -e "$MAIN/$PLAN_REL" ]; then ok "$label"; else bad "$label"; fi

# The search in the state file, after the move. The file is a workspace file
# at the top of the first folder; it is not moved.
# search_state <folder> <path from the top>: the search command of step 4.
search_state() {
  TOP_PATH="$2"
  run_lines "$1" "$SEARCH_RUN"
}
PLAN_LINE_START='Plan file: '
new_fixture state-file
printf '## Current Goal\nDemo\n\n## Plan\n%s%s\nNext task: 1\n' "$PLAN_LINE_START" "$PLAN_REL" > "$MAIN/$STATE_FILE"
do_steps "$MAIN" "$SPEC_REL" "$PLAN_REL"
search_state "$MAIN" "$PLAN_REL"
assert_eq_when "after the move, the search prints the line of the state file that names the old path of the plan" \
  "$OUT" "5:$PLAN_LINE_START$PLAN_REL" "$ALL_MOVED"
search_state "$MAIN" "$SPEC_REL"
label="the search for a file that the state file does not name prints nothing"
if [ "$RAN" -eq 1 ] && [ -z "$OUT" ]; then ok "$label"; else bad "$label (exit code $CODE, output: $(one_line "$OUT"))"; fi
# A line that already holds the path inside the worktree is printed too: the
# new path ends with the path from the top of the repository.
printf '## Plan\n%s%s\n' "$PLAN_LINE_START" "$WORKTREE/$PLAN_REL" > "$MAIN/$STATE_FILE"
search_state "$MAIN" "$PLAN_REL"
assert_eq "the search prints a line that already holds the path inside the worktree" \
  "$OUT" "2:$PLAN_LINE_START$WORKTREE/$PLAN_REL"
search_state "$MAIN/src" "$PLAN_REL"
assert_ran_failed "the search in a sub-folder, which holds no state file, ends with an exit code that is not 0, and an error text"
new_fixture state-file-space "$LAYOUT_ROOT/2026-10-04-my demo"
printf '## Plan\n%s%s\n' "$PLAN_LINE_START" "$PLAN_REL" > "$MAIN/$STATE_FILE"
search_state "$MAIN" "$PLAN_REL"
assert_eq "the search finds a path with a space" "$OUT" "2:$PLAN_LINE_START$PLAN_REL"
# The search reads the path as a fixed text: `[draft]` in a regular expression
# would match one letter, and the line would not be found.
MARKS_PATH='notes/v1 [draft]/plan.md'
printf '## Plan\n%s%s\n' "$PLAN_LINE_START" "$MARKS_PATH" > "$MAIN/$STATE_FILE"
search_state "$MAIN" "$MARKS_PATH"
assert_eq "the search finds a path with the characters [ and ]" "$OUT" "2:$PLAN_LINE_START$MARKS_PATH"

# ---------------------------------------------------------------------------
bold "6. The branch in the same folder"
# ---------------------------------------------------------------------------

# assert_branch_keeps <desc>: the branch command of the skill ran, the main
# checkout is on the feature branch, the spec and the plan are on disk, and
# the repository has no second working folder.
assert_branch_keeps() {
  create_branch
  if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ] \
    && [ "$(git -C "$MAIN" symbolic-ref --short HEAD 2>/dev/null)" = "$FEATURE_BRANCH" ] \
    && [ -f "$MAIN/$PLAN_REL" ] && [ -f "$MAIN/$SPEC_REL" ] \
    && [ "$(git -C "$MAIN" worktree list | wc -l | tr -d ' ')" = '1' ]; then
    ok "$1"
  else
    bad "$1 (exit code $CODE, output: $(one_line "$OUT"))"
  fi
}
new_fixture branch-ignored '' 'docs/'
assert_branch_keeps "the branch command keeps an ignored spec and plan in the same folder, and the repository has one working folder"
new_fixture branch-untracked
assert_branch_keeps "the branch command keeps an untracked spec and plan in the same folder"
new_fixture branch-modified
commit_in_main "$SPEC_REL" "$PLAN_REL"
tick "$MAIN/$PLAN_REL"
assert_branch_keeps "the branch command keeps a modified tracked plan in the same folder"
assert_eq_when "after the branch command the plan still holds its change" \
  "$(grep -cxF -- "$DONE_TASK" "$MAIN/$PLAN_REL" 2>/dev/null)" '1' "$(ran_ok)"
new_fixture branch-detached
git -C "$MAIN" checkout -q --detach
assert_branch_keeps "the branch command works on a detached HEAD"

# ---------------------------------------------------------------------------
bold "7. The two steps: their sentences, and nothing that weakens them"
# ---------------------------------------------------------------------------

# The checks of group 2 prove that each command is present. A sentence that
# is added to a step, for example an exception, passes all of them. The next
# checks compare the whole step, so an added sentence, an added list item and
# an added command block fail, whatever their words are.
# assert_step <name> <text of the step> <expected text> <item count> <fence line count>
assert_step() {
  local label folded
  folded=$(printf '%s\n' "$2" | fold_text)
  label="$1 holds exactly its sentences, in their order, and no other text"
  if [ "$folded" = "$3" ]; then ok "$label"; else bad "$label ($(first_difference "$folded" "$3"))"; fi
  assert_eq "$1 has exactly $4 list items" "$(item_count "$2")" "$4"
  assert_eq "$1 has exactly $5 lines that start or end a fenced block" "$(fence_line_count "$2")" "$5"
}
assert_step 'step 2' "$CHECK_STEP" "$CHECK_STEP_EXPECTED" "$CHECK_STEP_ITEM_COUNT" 2
assert_step 'step 4' "$MOVE_STEP" "$MOVE_STEP_EXPECTED" "$MOVE_STEP_ITEM_COUNT" 4

# Text outside the two steps can weaken them: a new section, or a sentence in
# another section ("step 2 can wait"). The heading check of group 2 fails for
# a new section. The next checks fail for a changed text in every other
# section.
while IFS='	' read -r heading expected_sum; do
  assert_eq "the text of the section '$heading' is unchanged (checksum)" "$(section_sum "$heading")" "$expected_sum"
done <<EOF
$SECTION_SUMS_EXPECTED
EOF

SKILL_TEXT=$(cat "$SKILL" 2>/dev/null)
# Words that make a step a matter of choice, and the option that switches the
# commit hooks off. No letter case hides them.
WEAKENING_WORDS='optional|--no-verify|fast path'
assert_lacks "the skill holds none of the words: $WEAKENING_WORDS" "$SKILL_TEXT" "$WEAKENING_WORDS"
# Words that start an exception to a rule.
EXCEPTION_WORDS='unless|except'
assert_lacks "the skill holds no word that starts an exception ($EXCEPTION_WORDS)" "$SKILL_TEXT" "$EXCEPTION_WORDS"
# The force option: `--force`, and `-f` that is not a part of a longer option
# or word. The setup commands of step 5 hold `[ -f <file> ]`, a file test:
# those lines are left out. Letter case counts here: `grep -F` (search for a
# fixed text) in step 4 is no force option.
FORCE_OPTION='--force|(^|[^-[:alnum:]])-f([^-[:alnum:]]|$)'
assert_lacks "the skill holds no force option" "$(printf '%s\n' "$SKILL_TEXT" | grep -v '^if \[ -f ')" "$FORCE_OPTION" -E
# A command that stages or commits more than the named files, a copy in place
# of the move, and a stash.
WIDE_COMMANDS='git add +(-A|--all|-u|\.)|commit +(-a|--all)|(^|[^[:alnum:]])cp +|git stash'
assert_lacks "the skill holds no command that stages every file, copies a file or makes a stash" "$SKILL_TEXT" "$WIDE_COMMANDS"

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
