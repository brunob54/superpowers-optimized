#!/usr/bin/env bash
# using-git-worktrees test suite: the step "Commit the spec and the plan" of
# skills/using-git-worktrees/SKILL.md. A worktree is a second working folder
# of the same git repository.
# The check, the commit commands, the branch command and the worktree command
# are copied out of the skill text and run on fixture repositories, so a check
# fails when the text that the model runs changes. The wording checks join
# wrapped lines first.
# Pure bash, git, awk, sed and grep; no claude invocation.
# Windows note: avoids /dev/stdin (not available in Git Bash on Windows).
#
# The defect that the step closes: a new worktree holds only committed files.
# The skills that write a spec and a plan do not commit them. The worktree
# then had no spec and no plan, and a commit of the plan that ran in the first
# folder landed on the branch of that folder.

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
# The text that the step must hold
# ---------------------------------------------------------------------------

STEPS_HEADING='## Creation Steps'
HEADING='### 2. Commit the spec and the plan'
CREATE_HEADING='### 3. Create worktree and branch'
# The headings of the section "Creation Steps", in their order.
STEP_HEADINGS_EXPECTED="### 1. Detect project root and branch name$NL$HEADING$NL$CREATE_HEADING$NL### 4. Run project setup$NL### 5. Run baseline tests"
# The places of the three values in a command of the skill text.
TOPIC_PLACEHOLDER='<topic-folder>'
BRANCH_PLACEHOLDER='<BRANCH_NAME>'
WORKTREE_PLACEHOLDER='<path>'
# The folder that holds every topic folder.
LAYOUT_ROOT='docs/superpowers-orchestrator'
# The first words of the line that the check prints for a path that does not
# exist.
NO_PATH='no such path'
# The mark that `git status --porcelain` prints for a file that git ignores,
# for an untracked file and for a modified file.
IGNORED_MARK='!!'
UNTRACKED_MARK='??'
MODIFIED_MARK=' M'
# The first words of the first line of the check.
EXISTS_PREFIX="[ -e \"$TOPIC_PLACEHOLDER\" ] || echo \""
EXISTS_CMD_EXPECTED="$EXISTS_PREFIX$NO_PATH: $TOPIC_PLACEHOLDER\""
STATUS_CMD_EXPECTED="git status --porcelain --ignored --untracked-files=all -- \"$TOPIC_PLACEHOLDER\""
CHECK_CMD_EXPECTED="$EXISTS_CMD_EXPECTED$NL$STATUS_CMD_EXPECTED"
ADD_CMD_EXPECTED="git add -- \"$TOPIC_PLACEHOLDER\""
COMMIT_SUBJECT="docs: spec and plan of $BRANCH_PLACEHOLDER"
COMMIT_CMD_EXPECTED="git commit -m \"$COMMIT_SUBJECT\" -- \"$TOPIC_PLACEHOLDER\""
BRANCH_CMD_EXPECTED="git checkout -b $BRANCH_PLACEHOLDER"
WORKTREE_CMD_EXPECTED="git worktree add $WORKTREE_PLACEHOLDER -b $BRANCH_PLACEHOLDER"

# Every sentence of the step, in the order of the step. A list item starts
# with "- " in the skill text; the marker is added where the sentences are
# joined (see STEP_EXPECTED).
S_WHY='A new worktree holds only committed files. A spec or a plan that is not committed is absent there.'
S_SKIP='Skip this step when the calling skill names no spec and no plan.'
S_FOLDER="The topic folder is the folder \`$LAYOUT_ROOT/<date>-<slug>/\` that holds the spec and the plan of this work: the folder above the \`specs/\` or \`plans/\` folder of the path that the calling skill names."
S_FILE="For a spec or a plan that is not under \`$LAYOUT_ROOT/\`, run this step once for each such file, with the path of the file in place of the topic folder."
S_ABSOLUTE='Write the path as an absolute path: git reads a relative path from the folder the command runs in, so a relative path fails in a sub-folder.'
S_RUN_CHECK='Run this check, both lines.'
S_FIRST_ITEM='Apply the first list item that matches the result.'
RULE_NO_PATH="A line \`$NO_PATH\`: correct the path and run the check again."
RULE_ERROR='An error text, or an exit status that is not 0: create no worktree.'
RULE_ERROR_SHOW='Show the error to the user.'
RULE_IGNORED="A line that starts with \`$IGNORED_MARK\` and names the spec or the plan: git ignores that file, so no commit can carry it into a worktree."
RULE_NO_WORKTREE='Create no worktree.'
RULE_BRANCH="Create the branch in this folder with \`$BRANCH_CMD_EXPECTED\`, which keeps the untracked and the ignored files."
RULE_BRANCH_NEXT='Then go on with step 4 in this folder.'
RULE_COMMIT="A line that starts with another mark than \`$IGNORED_MARK\` (\`$UNTRACKED_MARK\` is an untracked file, \`$MODIFIED_MARK\` is a modified file): the file is not committed."
RULE_APPROVAL='When a rule of the user or of the project (for example in `CLAUDE.md` or `AGENTS.md`) forbids a commit without approval, ask the user once.'
RULE_APPROVAL_NO='On "no": create no worktree and create the branch in this folder, as the list item before this one says.'
RULE_COMMIT_RUN="On \"yes\", and when no such rule exists: run \`$ADD_CMD_EXPECTED\`, then \`$COMMIT_CMD_EXPECTED\`, on the current branch."
RULE_CHECK_AGAIN='Then run the check again.'
RULE_GO_ON="No output, or only \`$IGNORED_MARK\` lines: go on with step 3."
RULE_NOT_HELD="The worktree will not hold a file of a \`$IGNORED_MARK\` line."
S_COPY='After step 3 the worktree holds its own copy of the topic folder.'
S_USE_COPY='From then on, the spec and the plan of this work are the copies inside the worktree: use the path inside the worktree in every command and in every edit.'
S_WRONG_BRANCH="A commit of the plan that runs in the folder of this step lands on the branch of that folder, not on \`$BRANCH_PLACEHOLDER\`."
STEP_ITEM_COUNT=5

# join_texts <text>...: the texts joined with one space.
join_texts() {
  local joined='' part
  for part in "$@"; do joined="$joined${joined:+ }$part"; done
  printf '%s' "$joined"
}
STEP_EXPECTED=$(join_texts "$S_WHY" "$S_SKIP" "$S_FOLDER" "$S_FILE" "$S_ABSOLUTE" \
  "$S_RUN_CHECK" '```bash' "$EXISTS_CMD_EXPECTED" "$STATUS_CMD_EXPECTED" '```' "$S_FIRST_ITEM" \
  "- $RULE_NO_PATH" \
  "- $RULE_ERROR" "$RULE_ERROR_SHOW" \
  "- $RULE_IGNORED" "$RULE_NO_WORKTREE" "$RULE_BRANCH" "$RULE_BRANCH_NEXT" \
  "- $RULE_COMMIT" "$RULE_APPROVAL" "$RULE_APPROVAL_NO" "$RULE_COMMIT_RUN" "$RULE_CHECK_AGAIN" \
  "- $RULE_GO_ON" "$RULE_NOT_HELD" \
  "$S_COPY" "$S_USE_COPY" "$S_WRONG_BRANCH")

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
# first_block <text>: the lines of the first ```bash block of the text,
# without the fences.
first_block() {
  printf '%s\n' "$1" | awk '/^```bash$/ { c = 1; next } c && /^```$/ { exit } c { print }'
}
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
# offset_of <text> <needle>: the 1-based position of the first occurrence of
# the fixed text <needle> in <text>; 0 when it is absent.
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

STEP=$(section "$HEADING")
STEP_FOLDED=$(printf '%s\n' "$STEP" | fold_text)
CHECK_CMD=$(first_block "$STEP")
EXISTS_CMD=$(printf '%s\n' "$CHECK_CMD" | sed -n '1p')
STATUS_CMD=$(printf '%s\n' "$CHECK_CMD" | sed -n '2p')
COMMIT_ITEM=$(bullet "$STEP" 'A line that starts with another mark')
ADD_CMD=$(code_span "$COMMIT_ITEM" 'git add')
COMMIT_CMD=$(code_span "$COMMIT_ITEM" 'git commit')
IGNORED_ITEM=$(bullet "$STEP" "A line that starts with \`$IGNORED_MARK\`")
BRANCH_CMD=$(code_span "$IGNORED_ITEM" 'git checkout')
WORKTREE_CMD=$(first_block "$(section "$CREATE_HEADING")")

# with_values <text>: the text with each placeholder replaced by the name of a
# shell variable. The quotes around a path come from the skill text, so a
# command that the skill writes without quotes fails on a path with a space.
with_values() {
  printf '%s\n' "$1" | sed "s/$TOPIC_PLACEHOLDER/\$TOPIC_PATH/g; s/$BRANCH_PLACEHOLDER/\$BRANCH/g; s/$WORKTREE_PLACEHOLDER/\$WT/g"
}
# runnable <command>: the command with the placeholders replaced, when the
# command is one line that starts with `git ` or with the first words of the
# existence test. In every other case the result is empty and the command is
# not run: a behaviour check must never run an arbitrary line of a changed
# skill file.
runnable() {
  [ "$(line_count "$1")" -eq 1 ] || return 0
  case "$1" in
    'git '*|"$EXISTS_PREFIX"*) with_values "$1" ;;
  esac
}
EXISTS_RUN=$(runnable "$EXISTS_CMD")
STATUS_RUN=$(runnable "$STATUS_CMD")
ADD_RUN=$(runnable "$ADD_CMD")
COMMIT_RUN=$(runnable "$COMMIT_CMD")
BRANCH_RUN=$(runnable "$BRANCH_CMD")
WORKTREE_RUN=$(runnable "$WORKTREE_CMD")

NO_COMMAND='(the skill text holds no command that this suite can run)'
# run_in <folder> <topic path> <command>...: run the commands, one after the
# other, in <folder>; a command that fails ends the run. $TOPIC_PATH holds
# <topic path>, $BRANCH the branch name of the fixture and $WT the worktree
# path of the fixture. Leaves the output (both streams) in OUT and the exit
# code in CODE. An empty command runs nothing: OUT then holds a message, so
# that no check passes on an empty output, and RAN is 0.
run_in() {
  local folder="$1" topic="$2" command
  shift 2
  for command in "$@"; do
    if [ -z "$command" ]; then OUT="$NO_COMMAND"; CODE=1; RAN=0; return 0; fi
  done
  CODE=0
  RAN=1
  OUT=$( { cd "$folder" && TOPIC_PATH="$topic" && BRANCH="$FEATURE_BRANCH" && WT="$WORKTREE" && for command in "$@"; do
    eval "$command" || exit $?
  done; } 2>&1 ) || CODE=$?
}
# run_check <folder> <topic path>: the two lines of the check of the skill.
run_check() { run_in "$1" "$2" "$EXISTS_RUN" "$STATUS_RUN"; }
# run_commit <folder> <topic path>: the two commit commands of the skill.
run_commit() { run_in "$1" "$2" "$ADD_RUN" "$COMMIT_RUN"; }
# run_worktree: the worktree command of the skill, in the main checkout.
run_worktree() { run_in "$MAIN" "$TOPIC" "$WORKTREE_RUN"; }
# run_branch: the branch command of the skill, in the main checkout.
run_branch() { run_in "$MAIN" "$TOPIC" "$BRANCH_RUN"; }
# assert_ran_ok <desc>: a command ran and ended with exit code 0.
assert_ran_ok() {
  if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ]; then ok "$1"; else bad "$1 (exit code $CODE, output: $(one_line "$OUT"))"; fi
}
# assert_ran_failed <desc>: a command ran, ended with an exit code that is not
# 0, and printed a text.
assert_ran_failed() {
  if [ "$RAN" -eq 1 ] && [ "$CODE" -ne 0 ] && [ -n "$OUT" ]; then ok "$1"; else bad "$1 (exit code $CODE, output: $(one_line "$OUT"))"; fi
}

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
TOPIC_NAME='2026-10-04-demo'
SPEC_FILE='specs/demo-design.md'
SPEC_LOG_FILE='specs/demo-design-review-log.md'
PLAN_FILE='plans/demo.md'
TRACKED_FILE='src/a.js'
OTHER_UNTRACKED='notes.md'
# A file name that git ignores in the fixture "one ignored file".
FINDER_FILE='.DS_Store'
OPEN_TASK='- [ ] task 1'
DONE_TASK='- [x] task 1'

# new_fixture <name> [<line for .gitignore>] [<topic folder name>]: a
# repository $TMP/<name> with one commit on the branch main and a tracked
# .gitignore, and an untracked topic folder with a spec, its review log and a
# plan. Leaves the paths in MAIN, WORKTREE, TOPIC_REL (from the top of the
# repository) and TOPIC (absolute).
new_fixture() {
  MAIN="$TMP/$1"
  WORKTREE="$MAIN/.worktrees/demo"
  TOPIC_REL="$LAYOUT_ROOT/${3:-$TOPIC_NAME}"
  TOPIC="$MAIN/$TOPIC_REL"
  git init -q "$MAIN"
  git -C "$MAIN" symbolic-ref HEAD "refs/heads/$BASE_BRANCH"
  mkdir "$MAIN/src"
  echo 'first version' > "$MAIN/$TRACKED_FILE"
  printf '%s\n' '.worktrees/' "${2:-ignored-by-rule.md}" > "$MAIN/.gitignore"
  git -C "$MAIN" add -A
  git -C "$MAIN" commit -q -m 'base'
  mkdir -p "$TOPIC/specs" "$TOPIC/plans"
  echo '# Demo design' > "$TOPIC/$SPEC_FILE"
  echo '# Demo design review log' > "$TOPIC/$SPEC_LOG_FILE"
  printf '# Demo plan\n\n%s\n' "$OPEN_TASK" > "$TOPIC/$PLAN_FILE"
}
# commit_topic: commit the topic folder of the fixture with plain git.
commit_topic() {
  git -C "$MAIN" add -- "$TOPIC_REL"
  git -C "$MAIN" commit -q -m 'topic' -- "$TOPIC_REL"
}
# tick <plan file>: mark the task of the plan as done.
tick() { printf '# Demo plan\n\n%s\n' "$DONE_TASK" > "$1"; }
# status_lines <mark> <topic path from the top> <file>...: the lines that
# `git status --porcelain` prints for the files, one per file.
status_lines() {
  local mark="$1" topic="$2" file lines=''
  shift 2
  for file in "$@"; do lines="$lines${lines:+$NL}$mark $topic/$file"; done
  printf '%s' "$lines"
}
# three_lines <mark>: the status lines of the plan, the review log and the
# spec of the fixture, in the order of git.
three_lines() { status_lines "$1" "$TOPIC_REL" "$PLAN_FILE" "$SPEC_LOG_FILE" "$SPEC_FILE"; }
# commit_count <branch>: the number of commits of the branch of the fixture.
commit_count() { git -C "$MAIN" rev-list --count "$1" 2>/dev/null; }
# head_files: the paths of the newest commit of the fixture, one per line.
head_files() { git -C "$MAIN" show --name-only --format= HEAD 2>/dev/null; }
# main_status: the whole status of the main checkout of the fixture.
main_status() { git -C "$MAIN" status --porcelain --untracked-files=all 2>&1; }
# worktree_holds <file>...: exit code 0 when the worktree of the fixture holds
# every file of the topic folder that is named.
worktree_holds() {
  local file
  for file in "$@"; do [ -f "$WORKTREE/$TOPIC_REL/$file" ] || return 1; done
}
THREE_FILES="$PLAN_FILE $SPEC_LOG_FILE $SPEC_FILE"

# ---------------------------------------------------------------------------
bold "1. A new worktree holds only committed files (why the step exists)"
# ---------------------------------------------------------------------------

new_fixture defect
git -C "$MAIN" worktree add -q "$WORKTREE" -b "$FEATURE_BRANCH"
label="without the step, the new worktree holds no spec and no plan"
if [ -d "$WORKTREE" ] && [ ! -e "$WORKTREE/$TOPIC_REL" ]; then ok "$label"; else bad "$label"; fi
tick "$TOPIC/$PLAN_FILE"
git -C "$MAIN" add -- "$TOPIC_REL/$PLAN_FILE"
git -C "$MAIN" commit -q -m 'chore(plan): demo task 1 complete' -- "$TOPIC_REL/$PLAN_FILE"
assert_eq "a commit of the plan in the first folder lands on $BASE_BRANCH (2 commits there)" \
  "$(commit_count "$BASE_BRANCH")" '2'
assert_eq "the same commit is not on $FEATURE_BRANCH (1 commit there)" \
  "$(commit_count "$FEATURE_BRANCH")" '1'
echo 'other' > "$MAIN/$OTHER_UNTRACKED"
label="a status call with '--' and no path reports on the whole repository"
if git -C "$MAIN" status --porcelain --untracked-files=all -- | grep -qxF -- "$UNTRACKED_MARK $OTHER_UNTRACKED"; then
  ok "$label"
else
  bad "$label"
fi

# ---------------------------------------------------------------------------
bold "2. The skill text holds the step and its commands"
# ---------------------------------------------------------------------------

assert_eq "the skill has exactly one heading '$HEADING'" \
  "$(grep -cxF -- "$HEADING" "$SKILL")" '1'
assert_eq "the section '$STEPS_HEADING' has exactly these five step headings, in this order" \
  "$(awk -v h="$STEPS_HEADING" '$0 == h { f = 1; next } f && /^## / { exit } f && /^### / { print }' "$SKILL")" \
  "$STEP_HEADINGS_EXPECTED"
assert_eq "the fenced block of the step holds the two lines of the check" \
  "$CHECK_CMD" "$CHECK_CMD_EXPECTED"
assert_eq "the list item about an uncommitted file holds the command that stages the topic folder" \
  "$ADD_CMD" "$ADD_CMD_EXPECTED"
assert_eq "the list item about an uncommitted file holds the commit command" \
  "$COMMIT_CMD" "$COMMIT_CMD_EXPECTED"
assert_eq "the list item about an ignored spec or plan holds the branch command" \
  "$BRANCH_CMD" "$BRANCH_CMD_EXPECTED"
assert_eq "the fenced block of step 3 holds the worktree command" \
  "$WORKTREE_CMD" "$WORKTREE_CMD_EXPECTED"
assert_eq "the skill names 'git worktree add' exactly one time" \
  "$(grep -o -- 'git worktree add' "$SKILL" | wc -l | tr -d ' ')" '1'
# A command that no sentence tells to run is only an example to the reader.
assert_before "a sentence with a verb tells to run the check, before the check" \
  "$STEP_FOLDED" "$S_RUN_CHECK" "$STATUS_CMD_EXPECTED"
assert_before "the check stands before the commit command" \
  "$STEP_FOLDED" "$STATUS_CMD_EXPECTED" "$COMMIT_CMD_EXPECTED"
COMMIT_LINE=$(line_of "$COMMIT_CMD_EXPECTED")
WORKTREE_LINE=$(line_of "$WORKTREE_CMD_EXPECTED")
label="the commit command stands before the worktree command in the skill file"
if [ "$COMMIT_LINE" -gt 0 ] && [ "$COMMIT_LINE" -lt "$WORKTREE_LINE" ]; then
  ok "$label"
else
  bad "$label (line of the commit command: $COMMIT_LINE; line of the worktree command: $WORKTREE_LINE; 0 means absent)"
fi

# ---------------------------------------------------------------------------
bold "3. The check on fixture repositories"
# ---------------------------------------------------------------------------

new_fixture untracked
echo 'other' > "$MAIN/$OTHER_UNTRACKED"
run_check "$MAIN" "$TOPIC"
assert_eq "an untracked spec, review log and plan give three '$UNTRACKED_MARK' lines, and no line for a file outside the topic folder" \
  "$OUT" "$(three_lines "$UNTRACKED_MARK")"
assert_eq "the check on an untracked topic folder gives exit code 0" "$CODE" '0'
REFERENCE="$OUT"
run_check "$MAIN/src" "$TOPIC"
label="a run in a sub-folder with the absolute path gives the same three lines"
if [ "$RAN" -eq 1 ] && [ "$OUT" = "$REFERENCE" ]; then ok "$label"; else bad "$label (got: $(one_line "$OUT"))"; fi
run_check "$MAIN/src" "$TOPIC_REL"
out_has_line "a run in a sub-folder with the relative path prints the line '$NO_PATH'" "$NO_PATH: $TOPIC_REL"
assert_out_lacks "a run in a sub-folder with the relative path names no file of the topic folder" "$PLAN_FILE"
run_check "$MAIN" "$TOPIC-typo"
assert_eq "a path that does not exist gives the line '$NO_PATH', and it is the only line" \
  "$OUT" "$NO_PATH: $TOPIC-typo"
run_check "$MAIN" ''
out_has_line "an empty path gives the line '$NO_PATH'" "$NO_PATH: "
assert_ran_failed "an empty path gives an exit code that is not 0"
assert_out_lacks "an empty path does not report on the whole repository" "$OTHER_UNTRACKED"
run_check "$MAIN" "$TMP"
assert_ran_failed "a path outside the repository gives an exit code that is not 0, and an error text"
run_check "$MAIN" "$TOPIC/$PLAN_FILE"
assert_eq "the path of the plan file in place of the topic folder gives one line, for the plan" \
  "$OUT" "$(status_lines "$UNTRACKED_MARK" "$TOPIC_REL" "$PLAN_FILE")"

new_fixture modified
commit_topic
run_check "$MAIN" "$TOPIC"
assert_eq "a committed topic folder gives no output" "$OUT" ''
assert_eq "a committed topic folder gives exit code 0" "$CODE" '0'
tick "$TOPIC/$PLAN_FILE"
run_check "$MAIN" "$TOPIC"
assert_eq "a modified tracked plan gives one '$MODIFIED_MARK' line" \
  "$OUT" "$(status_lines "$MODIFIED_MARK" "$TOPIC_REL" "$PLAN_FILE")"

new_fixture ignored 'docs/'
run_check "$MAIN" "$TOPIC"
assert_eq "an ignored docs/ folder gives three '$IGNORED_MARK' lines" \
  "$OUT" "$(three_lines "$IGNORED_MARK")"

new_fixture one-ignored "$FINDER_FILE"
echo 'finder data' > "$TOPIC/$FINDER_FILE"
run_check "$MAIN" "$TOPIC"
assert_eq "one ignored file in an untracked topic folder: three '$UNTRACKED_MARK' lines and one '$IGNORED_MARK' line" \
  "$OUT" "$(three_lines "$UNTRACKED_MARK")$NL$(status_lines "$IGNORED_MARK" "$TOPIC_REL" "$FINDER_FILE")"

# A user can hide untracked files from `git status` with a setting. The check
# must name them all the same.
new_fixture setting
git -C "$MAIN" config status.showUntrackedFiles no
run_check "$MAIN" "$TOPIC"
assert_eq "with status.showUntrackedFiles=no the three '$UNTRACKED_MARK' lines are printed" \
  "$OUT" "$(three_lines "$UNTRACKED_MARK")"

# Git prints a path with a space between two " characters.
new_fixture space '' '2026-10-04-my demo'
run_check "$MAIN" "$TOPIC"
assert_eq "a topic folder path with a space gives three '$UNTRACKED_MARK' lines" \
  "$OUT" "$UNTRACKED_MARK \"$TOPIC_REL/$PLAN_FILE\"$NL$UNTRACKED_MARK \"$TOPIC_REL/$SPEC_LOG_FILE\"$NL$UNTRACKED_MARK \"$TOPIC_REL/$SPEC_FILE\""

mkdir -p "$TMP/no-repository/docs"
run_in "$TMP/no-repository" "$TMP/no-repository/docs" "$EXISTS_RUN" "$STATUS_RUN"
assert_ran_failed "a folder that is not a git repository gives an exit code that is not 0, and an error text"

# ---------------------------------------------------------------------------
bold "4. The commit commands, then the worktree command"
# ---------------------------------------------------------------------------

# assert_step_done <desc> <file>...: after the commit commands and the
# worktree command of the skill, the check prints nothing and the worktree
# holds the files.
assert_step_done() {
  local desc="$1"
  shift
  run_check "$MAIN" "$TOPIC"
  assert_eq "$desc: after the commit the check gives no output" "$OUT" ''
  run_worktree
  assert_ran_ok "$desc: the worktree command succeeds"
  if worktree_holds "$@"; then
    ok "$desc: the worktree holds the spec, its review log and the plan"
  else
    bad "$desc: the worktree holds the spec, its review log and the plan"
  fi
}

new_fixture commit-untracked
echo 'other' > "$MAIN/$OTHER_UNTRACKED"
echo 'second version' >> "$MAIN/$TRACKED_FILE"
git -C "$MAIN" add -- "$TRACKED_FILE"
run_commit "$MAIN" "$TOPIC"
assert_ran_ok "the commit commands succeed on an untracked topic folder"
assert_eq "the commit holds exactly the plan, the review log and the spec" \
  "$(head_files)" "$TOPIC_REL/$PLAN_FILE$NL$TOPIC_REL/$SPEC_LOG_FILE$NL$TOPIC_REL/$SPEC_FILE"
assert_eq "the commit is on the current branch ($BASE_BRANCH has 2 commits)" "$(commit_count "$BASE_BRANCH")" '2'
assert_eq "the subject of the commit names the branch of the worktree" \
  "$(git -C "$MAIN" log -1 --format=%s)" "docs: spec and plan of $FEATURE_BRANCH"
assert_eq "an unrelated staged file stays staged, and an unrelated untracked file stays untracked" \
  "$(main_status)" "M  $TRACKED_FILE$NL$UNTRACKED_MARK $OTHER_UNTRACKED"
# shellcheck disable=SC2086
assert_step_done "untracked spec and plan" $THREE_FILES
assert_eq "the branch of the worktree starts at the commit of the spec and the plan" \
  "$(git -C "$MAIN" rev-parse --verify --quiet "$FEATURE_BRANCH")" "$(git -C "$MAIN" rev-parse --verify --quiet "$BASE_BRANCH")"
# The sentences after the list: the plan of the work is the copy inside the
# worktree.
# Without a worktree the three commands fail; the two checks after them then
# fail, and the error texts of the commands are not needed.
{
  tick "$WORKTREE/$TOPIC_REL/$PLAN_FILE"
  git -C "$WORKTREE" add -- "$TOPIC_REL/$PLAN_FILE"
  git -C "$WORKTREE" commit -q -m 'chore(plan): demo task 1 complete' -- "$TOPIC_REL/$PLAN_FILE"
} 2>/dev/null
assert_eq "a commit of the plan copy inside the worktree lands on $FEATURE_BRANCH (3 commits there)" \
  "$(commit_count "$FEATURE_BRANCH")" '3'
assert_eq "the same commit leaves $BASE_BRANCH as it was (2 commits)" "$(commit_count "$BASE_BRANCH")" '2'

new_fixture commit-modified
commit_topic
tick "$TOPIC/$PLAN_FILE"
run_commit "$MAIN" "$TOPIC"
assert_ran_ok "the commit commands succeed on a modified tracked plan"
assert_eq "the commit of a modified plan holds only the plan" "$(head_files)" "$TOPIC_REL/$PLAN_FILE"
# shellcheck disable=SC2086
assert_step_done "modified tracked plan" $THREE_FILES
assert_eq "the plan copy inside the worktree holds the modification" \
  "$(grep -cxF -- "$DONE_TASK" "$WORKTREE/$TOPIC_REL/$PLAN_FILE" 2>/dev/null)" '1'

new_fixture commit-space '' '2026-10-04-my demo'
run_commit "$MAIN" "$TOPIC"
assert_ran_ok "the commit commands succeed on a topic folder path with a space"
# shellcheck disable=SC2086
assert_step_done "a path with a space" $THREE_FILES

new_fixture commit-sub-folder
run_commit "$MAIN/src" "$TOPIC"
assert_ran_ok "the commit commands succeed in a sub-folder with the absolute path"
# shellcheck disable=SC2086
assert_step_done "a run in a sub-folder" $THREE_FILES

new_fixture commit-setting
git -C "$MAIN" config status.showUntrackedFiles no
run_commit "$MAIN" "$TOPIC"
assert_ran_ok "the commit commands succeed with status.showUntrackedFiles=no"
# shellcheck disable=SC2086
assert_step_done "status.showUntrackedFiles=no" $THREE_FILES

new_fixture commit-plan-file
run_commit "$MAIN" "$TOPIC/$PLAN_FILE"
assert_ran_ok "the commit commands succeed with the path of the plan file in place of the topic folder"
assert_eq "the commit of a plan file path holds only the plan" "$(head_files)" "$TOPIC_REL/$PLAN_FILE"
assert_eq "the spec and its review log stay untracked after the commit of a plan file path" \
  "$(main_status)" "$(status_lines "$UNTRACKED_MARK" "$TOPIC_REL" "$SPEC_LOG_FILE" "$SPEC_FILE")"

new_fixture commit-one-ignored "$FINDER_FILE"
echo 'finder data' > "$TOPIC/$FINDER_FILE"
run_commit "$MAIN" "$TOPIC"
assert_ran_ok "the commit commands succeed on a topic folder with one ignored file"
run_check "$MAIN" "$TOPIC"
assert_eq "after the commit, the check prints only the '$IGNORED_MARK' line of the ignored file" \
  "$OUT" "$(status_lines "$IGNORED_MARK" "$TOPIC_REL" "$FINDER_FILE")"
run_worktree
label="the worktree holds the spec and the plan, and not the ignored file"
# shellcheck disable=SC2086
if worktree_holds $THREE_FILES && [ ! -e "$WORKTREE/$TOPIC_REL/$FINDER_FILE" ]; then ok "$label"; else bad "$label"; fi

# Two marks that the step does not name: a deleted tracked file (` D`) and a
# new file that is staged and not committed (`A `).
NEW_FILE='plans/demo-notes.md'
new_fixture commit-other-marks
commit_topic
rm "$TOPIC/$SPEC_LOG_FILE"
echo '# Demo notes' > "$TOPIC/$NEW_FILE"
git -C "$MAIN" add -- "$TOPIC_REL/$NEW_FILE"
run_check "$MAIN" "$TOPIC"
assert_eq "a staged new file and a deleted tracked file give one line each" \
  "$OUT" "A  $TOPIC_REL/$NEW_FILE$NL D $TOPIC_REL/$SPEC_LOG_FILE"
run_commit "$MAIN" "$TOPIC"
assert_ran_ok "the commit commands succeed on a staged new file and a deleted tracked file"
assert_eq "the commit holds the new file and the deletion" \
  "$(head_files)" "$TOPIC_REL/$NEW_FILE$NL$TOPIC_REL/$SPEC_LOG_FILE"
assert_step_done "a staged new file and a deleted tracked file" "$PLAN_FILE" "$SPEC_FILE" "$NEW_FILE"

# The sentence "no commit can carry it into a worktree": git refuses to stage
# a file that it ignores.
new_fixture commit-ignored 'docs/'
run_commit "$MAIN" "$TOPIC"
assert_ran_failed "the commit commands fail on an ignored docs/ folder"
assert_eq "no commit is made for an ignored docs/ folder ($BASE_BRANCH has 1 commit)" "$(commit_count "$BASE_BRANCH")" '1'

# ---------------------------------------------------------------------------
bold "5. The branch in the same folder"
# ---------------------------------------------------------------------------

# assert_branch_keeps <desc>: the branch command of the skill ran, the main
# checkout is on the feature branch, the three files are on disk, and the
# repository has no second working folder.
assert_branch_keeps() {
  run_branch
  if [ "$RAN" -eq 1 ] && [ "$CODE" -eq 0 ] \
    && [ "$(git -C "$MAIN" symbolic-ref --short HEAD 2>/dev/null)" = "$FEATURE_BRANCH" ] \
    && [ -f "$TOPIC/$PLAN_FILE" ] && [ -f "$TOPIC/$SPEC_FILE" ] && [ -f "$TOPIC/$SPEC_LOG_FILE" ] \
    && [ "$(git -C "$MAIN" worktree list | wc -l | tr -d ' ')" = '1' ]; then
    ok "$1"
  else
    bad "$1 (exit code $CODE, output: $(one_line "$OUT"))"
  fi
}
new_fixture branch-ignored 'docs/'
assert_branch_keeps "the branch command keeps an ignored spec and plan in the same folder"
new_fixture branch-untracked
assert_branch_keeps "the branch command keeps an untracked spec and plan in the same folder, and the repository has one working folder"

# ---------------------------------------------------------------------------
bold "6. The step: its sentences, and nothing that weakens it"
# ---------------------------------------------------------------------------

# The checks of group 2 prove that each command is present. A sentence that
# is added to the step, for example an exception, passes all of them. The
# next checks compare the whole step, so an added sentence, an added list
# item and an added command block fail, whatever their words are.
label="the step holds exactly these sentences, in this order, and no other text"
if [ "$STEP_FOLDED" = "$STEP_EXPECTED" ]; then
  ok "$label"
else
  bad "$label ($(first_difference "$STEP_FOLDED" "$STEP_EXPECTED"))"
fi
assert_eq "the step has exactly $STEP_ITEM_COUNT list items" "$(item_count "$STEP")" "$STEP_ITEM_COUNT"
assert_eq "the step has exactly one fenced block (two fence lines)" \
  "$(printf '%s\n' "$STEP" | grep -c '^[[:space:]]*```')" '2'
# Words that start an exception to a rule.
EXCEPTION_WORDS='unless|except'
assert_lacks "the step holds no word that starts an exception ($EXCEPTION_WORDS)" "$STEP" "$EXCEPTION_WORDS"
# The force option: `--force`, and `-f` that is not a part of a longer option
# or word.
FORCE_OPTION='--force|(^|[^-[:alnum:]])-f([^-[:alnum:]]|$)'
assert_lacks "the step holds no force option" "$STEP" "$FORCE_OPTION"
# A command that stages or commits files outside the topic folder.
WIDE_COMMIT='git add +(-A|--all|-u|\.)|git commit +(-a|--all)'
SKILL_TEXT=$(cat "$SKILL" 2>/dev/null)
assert_lacks "the skill holds no command that stages or commits every file" "$SKILL_TEXT" "$WIDE_COMMIT"
# A sentence outside the step can weaken the step, for example "step 2 can
# wait until the worktree exists". Such a sentence names the step, a commit,
# a spec or a plan. Today three lines outside the step match: the commit of
# the .gitignore change, and the two skill names `writing-plans` and
# `executing-plans` in the section "Integration". The check compares the
# matching lines as whole lines, so a new matching line fails, and a sentence
# added to one of the three lines fails too.
OUTSIDE_WORDS='commit|spec|plan|step 2'
OUTSIDE_LINES_EXPECTED='2. **Commit the `.gitignore` change immediately** before proceeding — an uncommitted ignore entry is easy to lose and leaves the worktree contents exposed to accidental staging.
- `writing-plans`
- `executing-plans` — REQUIRED before executing any tasks'
assert_eq "outside the step, exactly three lines of the skill name a commit, a spec, a plan or step 2" \
  "$(awk -v h="$HEADING" '$0 == h { f = 1; next } f && /^#/ { f = 0 } !f' "$SKILL" 2>/dev/null | grep -iE -- "$OUTSIDE_WORDS")" \
  "$OUTSIDE_LINES_EXPECTED"
# The section that creates the worktree must not create it in a second place,
# and must hold one command block only.
assert_eq "step 3 has exactly one fenced block (two fence lines)" \
  "$(section "$CREATE_HEADING" | grep -c '^[[:space:]]*```')" '2'

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
