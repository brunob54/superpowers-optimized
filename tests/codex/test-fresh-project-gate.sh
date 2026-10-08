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
#      the outcome that the skill names for each folder: the output starts
#      with the text that the first outcome names (no repository), the
#      output is a folder path (the top folder of the repository), or any
#      other output (an error). The rule of the first outcome ("starts
#      with" or "contains", and its text) is also read from the skill text.
#      For a folder path, the skill's command that tells whether the session
#      folder is the top folder must agree with a comparison of the two
#      folders.
#   2. Wording. The gate section, from its heading to "**Step 2b", is
#      pinned whole (the lines are joined first, so a new line wrapping does
#      not matter). The check stands before the quoted message, and exactly
#      three outcomes stand before the message. The whole file names
#      `git init --quiet` exactly twice. The first part of the skill names
#      no `git init`, and no text outside the gate section names it.
#   3. Size. The whole skill file stays at or under 20,000 characters, the
#      part of a skill that Claude Code attaches again after a compaction,
#      so the gate text is never cut off.
# The first part of the skill (the text that hooks/session-start injects)
# is limited in size by tests/codex/test-session-start-budget.sh.
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
# The gate section ends before the line that starts with this text.
GATE_END='**Step 2b'
# The line of the skill file below which hooks/session-start injects nothing.
INJECTION_MARKER='session-start-injection-ends'
# The first line of the quoted message of the gate.
MESSAGE_START='> Before I start:'
GIT_INIT='git init'
GIT_INIT_RUN='git init --quiet'
# The confirm line names `git init --quiet` twice: once for a folder with no
# repository, once for a separate repository that the user asked for.
GIT_INIT_RUN_COUNT=2
# Claude Code attaches about the first 20,000 characters of an invoked skill
# again after a compaction (tests/claude-code/compaction-probe.md).
REATTACH_LIMIT=20000
# The word of the earlier gate message that promised an automatic log.
OLD_LOG_PROMISE='auto-captures'
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
# before the line that starts with GATE_END, or before the next "## "
# heading if that comes first.
gate_section() {
  awk -v h="$GATE_HEADING" -v e="$GATE_END" '$0 == h { on = 1; print; next } on && (/^## / || index($0, e) == 1) { exit } on { print }' "$SKILL"
}

# expected_gate: prints the gate section as the skill must hold it, from its
# heading to the line before GATE_END. Any change of a sentence makes the
# test fail; then this text and the skill text are changed together.
# The rules that these lines hold:
#   - The check runs in the session folder before the message is shown, and
#     LC_ALL=C makes git print its messages in English.
#   - First outcome: only an output that STARTS with "fatal: not a git
#     repository (or any" means that no repository holds the folder. Both
#     messages of git for that state start so (the second one ends "parent
#     up to mount point"). A linked worktree whose main repository was moved
#     prints "fatal: not a git repository: <path>"; that is an error, and a
#     `git init` there fails (measured: exit code 128).
#   - Folder path: the message offers a separate repository only in a
#     sub-folder. At the top folder of a repository (`git rev-parse
#     --show-prefix` prints an empty line) a `git init` creates no second
#     repository, so the offer and its reason are left out.
#   - Any other output: no `git init` line, the error is quoted, no
#     `git init`.
#   - On confirm: `git init --quiet` only when no repository holds the
#     folder. The one exception is the separate repository, and only after
#     a folder path. Its warning names both cases of the outer repository:
#     a folder that it does not track becomes an embedded repository unless
#     it is ignored; files that it tracks stay tracked even when the folder
#     is ignored (measured: the outer `git add -A` still commits them).
#   - context-management is told to write project-map.md in the session
#     folder: its own text says "at the project root", which a model can
#     read as the top folder of the outer repository, where step 2 and
#     hooks/session-start do not look.
#   - The context-snapshot.json note only when no repository held the
#     folder: in a sub-folder of a repository with a commit,
#     hooks/context-engine.js already wrote the snapshot at session start.
expected_gate() {
  cat <<'EOF'
## Fresh project gate (Entry Sequence step 2, full text)

When both conditions of Entry Sequence step 2 are true, first run this check in the session folder (the folder the session was opened in), before you show the message below:

```bash
LC_ALL=C git rev-parse --show-toplevel 2>&1
```

Read the output of the check. It decides the `git init` line of the message and what you run on confirm:
- **The output starts with `fatal: not a git repository (or any`:** no git repository holds this folder. Show the message as written. Other errors can also contain `not a git repository`, for example `fatal: not a git repository: <path>` in a linked worktree whose main repository was moved; they belong to the last case below.
- **The output is a folder path:** this folder is already inside the git repository at that path. In the message, replace the `git init` line with this line: "- git: this folder is already inside the git repository at <path>; I will not create another one. If you want a separate repository for this folder, say so." (<path> is the output of the check.) The reason: in a sub-folder, a `git init` creates a second repository inside the first one, and later commits go to the wrong repository. When `git rev-parse --show-prefix` prints an empty line, the session folder is the top folder of the repository, not a sub-folder: end the line after "I will not create another one." and offer no separate repository, because a `git init` there creates no second repository.
- **Any other output (an error):** leave the `git init` line out of the message, quote the error to the user, and run no `git init`.

Then **pause before proceeding** and tell the user exactly this, with the `git init` line changed as the check decided:

> Before I start: this directory has no memory files set up yet. That matters for how well I perform across sessions.
>
> **Without setup, every future session on this project starts from scratch:**
> - I re-explore the project structure even if I mapped it last session
> - I re-read files I already understood
> - I may re-propose approaches that were already tried and rejected
> - I lose the "why" behind every decision the moment the session ends
>
> **A ~30-second setup changes that permanently:**
> - `git init` — enables staleness tracking so I only re-read files that actually changed *(creates `.git` only, nothing else)*
> - `project-map.md` — I read this at every future session start instead of re-exploring blind
> - `session-log.md` — I record decisions and rejected approaches here when you say 'save state' or when a hook reminds me, so future sessions start with: *"I see from last session that X was rejected because Y — building with that constraint already applied"* instead of rediscovering it
>
> **Set this up before we build, or start immediately?**

Wait for the user's answer before continuing.
- **If they confirm:** run `git init --quiet` only when no git repository holds this folder (the first case above; do not ask again — the user just confirmed). In every other case, run no `git init`, with one exception: the check printed a folder path, the `git init` line of the message was replaced by a line that offered a separate repository, and the user asked for one. In that case, run `git init --quiet` and tell the user this: if the outer repository tracks no file in this folder, a `git add -A` in the outer repository records this folder as an embedded repository (a pointer to the new repository, without any of its files), unless the outer repository ignores this folder; if the outer repository already tracks files in this folder, it keeps tracking them, also when it ignores this folder, so both repositories track the same files. After that, in every case, invoke `context-management` for map generation only, and tell it to write `project-map.md` in the session folder, also when that folder is a sub-folder of a repository: step 2 and the session-start hook look for the map only in the session folder, not at the top folder of the repository. Return to step 3 when done. Only in the first case above (no git repository held this folder), note: `context-snapshot.json` will not be created in this session — the context-engine hook already ran at session start before git existed. It will be created on the next session start, provided the session is opened from this project's root directory. If no commits exist yet it will be mostly empty; it populates fully after the first commit.
- **If they decline:** proceed to step 3.
EOF
}

# fold: joins the lines of standard input with one space and removes the
# blanks at the start and the end of each line, so that a sentence that a
# line break splits still matches as one fixed string.
fold() {
  awk '{ line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line); if (NR > 1) printf " "; printf "%s", line } END { print "" }'
}

GATE="$(gate_section)"
GATE_FOLDED="$(printf '%s\n' "$GATE" | fold)"
FILE_FOLDED="$(fold < "$SKILL")"
# The first part of the skill: the lines above the marker line.
FIRST_PART_FOLDED="$(awk -v m="$INJECTION_MARKER" 'index($0, m) { exit } { print }' "$SKILL" | fold)"

# count_in <folded text> <fixed string>: prints how many times the text holds
# the string.
count_in() {
  printf '%s\n' "$1" | awk -v s="$2" '{ n = 0; t = $0; while ((i = index(t, s)) > 0) { n++; t = substr(t, i + length(s)) } print n }'
}

# assert_count <label> <folded text> <fixed string> <expected number>
assert_count() {
  local count
  count="$(count_in "$2" "$3")"
  if [ "$count" -eq "$4" ]; then
    ok "$1"
  else
    bad "$1 (found ${count} times, expected $4: $3)"
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

# The rule of the first outcome, read from its bullet: "- **The output starts
# with `<text>`:**" or "- **The output contains `<text>`:**". NO_REPO_RULE is
# "starts with" or "contains"; NO_REPO_TEXT is the text in backticks.
no_repo_bullet="$(printf '%s\n' "$GATE" | sed -nE 's/^- \*\*The output (starts with|contains) `([^`]*)`:\*\*.*/\1|\2/p' | sed -n '1p')"
NO_REPO_RULE="${no_repo_bullet%%|*}"
NO_REPO_TEXT="${no_repo_bullet#*|}"

# The command that tells whether the session folder is the top folder of
# the repository, read from the sentence "When `<command>` prints an empty
# line". Empty when the skill has no such sentence.
TOP_FOLDER_CMD="$(printf '%s\n' "$GATE_FOLDED" | sed -nE 's/.*When `([^`]*)` prints an empty line.*/\1/p')"

# outcome_of <output>: the outcome that the skill text gives to an output of
# the check. A folder path is one line that names a folder that exists.
outcome_of() {
  if [ -n "$NO_REPO_TEXT" ]; then
    case "$NO_REPO_RULE" in
      "starts with") case "$1" in "$NO_REPO_TEXT"*) echo "$OUT_NONE"; return ;; esac ;;
      contains) case "$1" in *"$NO_REPO_TEXT"*) echo "$OUT_NONE"; return ;; esac ;;
    esac
  fi
  case "$1" in
    *$'\n'*) echo "$OUT_ERROR"; return ;;
  esac
  if [ -n "$1" ] && [ -d "$1" ]; then echo "$OUT_FOLDER"; else echo "$OUT_ERROR"; fi
}

# same_folder <path> <path>: true when the two paths name the same folder.
# Both are made physical with `cd <path> && pwd -P` before the comparison,
# because git and the shell can write one folder in two ways: through a
# symbolic link, or as C:/... and /c/... on Windows Git Bash.
same_folder() {
  local a b
  a="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  b="$(cd "$2" 2>/dev/null && pwd -P)" || return 1
  [ "$a" = "$b" ]
}

# top_folder_by_rule <folder>: prints "yes" when the skill's command for the
# top folder prints an empty line in <folder>, else "no". With no such
# command in the skill, the skill offers a separate repository in every
# folder, as if no folder were a top folder: "no".
top_folder_by_rule() {
  if [ -n "$TOP_FOLDER_CMD" ] && [ -z "$(cd "$1" && bash -c "$TOP_FOLDER_CMD" 2>&1)" ]; then
    echo yes
  else
    echo no
  fi
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
  elif [ -n "$top" ] && ! same_folder "$out" "$top"; then
    bad "${label}: the check printed ${out}, expected the top folder ${top}"
  elif [ "$want" = "$OUT_FOLDER" ]; then
    # The skill offers a separate repository only when the session folder
    # is not the top folder. Its rule must agree with the folders.
    local by_rule by_path=no
    by_rule="$(top_folder_by_rule "$dir")"
    if same_folder "$out" "$dir"; then by_path=yes; fi
    if [ "$by_rule" = "$by_path" ]; then
      ok "${label}: outcome '${want}', top folder: ${by_path}"
    else
      bad "${label}: top folder by the skill's rule (${TOP_FOLDER_CMD:-no rule}): ${by_rule}; by a comparison of the folders: ${by_path}"
    fi
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

# The skill matches the English text "fatal: not a git repository". LC_ALL=C makes
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

# The whole section, pinned. The lines are joined before the comparison; on
# a difference, the differing lines are printed.
if [ "$GATE_FOLDED" = "$(expected_gate | fold)" ]; then
  ok "the gate section, from its heading to '${GATE_END}', is the pinned text"
else
  bad "the gate section, from its heading to '${GATE_END}', differs from the pinned text (expected_gate) — lines '<' pinned, '>' in the skill:"
  diff <(expected_gate) <(printf '%s\n' "$GATE") | sed 's/^/         /' || true
fi

# The first outcome matches the start of the output, not any part of it:
# the error of a moved linked worktree also contains "not a git repository".
if [ "$NO_REPO_RULE" = "starts with" ] && [ -n "$NO_REPO_TEXT" ]; then
  ok "the first outcome matches the start of the output: ${NO_REPO_TEXT}"
else
  bad "the first outcome does not match the start of the output (rule: '${NO_REPO_RULE}', text: '${NO_REPO_TEXT}')"
fi

if [ -n "$TOP_FOLDER_CMD" ]; then
  ok "the folder-path outcome names the command for the top folder: ${TOP_FOLDER_CMD}"
else
  bad "the folder-path outcome names no command that tells whether the session folder is the top folder"
fi

# `git init` outside the gate section: the first part of the skill is
# injected into every session, and a rule there or anywhere else in the file
# could run `git init` without the check.
assert_count "the whole file names \`${GIT_INIT_RUN}\` exactly ${GIT_INIT_RUN_COUNT} times" \
  "$FILE_FOLDED" "\`${GIT_INIT_RUN}\`" "$GIT_INIT_RUN_COUNT"
assert_count "the first part of the skill (above the marker line) names no ${GIT_INIT}" \
  "$FIRST_PART_FOLDED" "$GIT_INIT" 0
assert_count "the whole file names ${GIT_INIT} only inside the gate section" \
  "$FILE_FOLDED" "$GIT_INIT" "$(count_in "$GATE_FOLDED" "$GIT_INIT")"
# No hook writes session-log.md: the AI writes each entry when the user asks
# or when a hook reminds it. The earlier message promised an automatic log.
assert_count "the whole file does not say ${OLD_LOG_PROMISE}" "$FILE_FOLDED" "$OLD_LOG_PROMISE" 0

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

  # A linked worktree kept inside its main repository (as the skill
  # using-git-worktrees does), after the main repository was moved: the
  # .git file of the worktree names a folder that no longer exists.
  MOVED_FROM="$TMP_ROOT/main-before-move"
  MOVED_TO="$TMP_ROOT/main-after-move"
  git init -q "$MOVED_FROM"
  printf '.worktrees/\n' > "$MOVED_FROM/.gitignore"
  git -C "$MOVED_FROM" add .gitignore
  commit "$MOVED_FROM" init
  git -C "$MOVED_FROM" worktree add -q "$MOVED_FROM/.worktrees/feature"
  mv "$MOVED_FROM" "$MOVED_TO"

  # A symbolic link to the root of the repository. git prints the physical
  # path, which is another way to write the same folder. (On Windows Git
  # Bash, `ln -s` can copy the folder instead; the case then still passes.)
  REPO_LINK="$TMP_ROOT/repo-link"
  ln -s "$REPO" "$REPO_LINK"

  assert_outcome "a fresh folder with no repository above it" "$TMP_ROOT/fresh" "$OUT_NONE" ""
  assert_outcome "a linked worktree whose main repository was moved" "$MOVED_TO/.worktrees/feature" "$OUT_ERROR" ""
  assert_outcome "the root of a repository" "$REPO" "$OUT_FOLDER" "$REPO"
  assert_outcome "the root of a repository, opened through a symbolic link" "$REPO_LINK" "$OUT_FOLDER" "$REPO_LINK"
  assert_outcome "the root of a linked worktree" "$WORKTREE" "$OUT_FOLDER" "$WORKTREE"
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
