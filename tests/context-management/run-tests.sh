#!/usr/bin/env bash
# context-management test suite: the archive script
# skills/context-management/scripts/archive-session-log.js on fixture
# folders, the rules of the skill text about the size of session-log.md, the
# architecture document, and the routing phrase of the skill-activator hook.
# Bash, node and git only; no claude invocation.
# Windows note: never reads standard input through its device path and uses
# no process substitution (neither is reliable in Git Bash on Windows).

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/skills/context-management/scripts/archive-session-log.js"
SKILL="$ROOT/skills/context-management/SKILL.md"
ARCH_DOC="$ROOT/docs/architecture/project-memory.md"
ACTIVATOR="$ROOT/hooks/skill-activator.js"

LOG_NAME='session-log.md'
ARCHIVE_NAME='session-log-archive.md'
HEADER_TITLE='# Session Log'
DEFAULT_KEEP=100
# An entry heading: "## " and a date (YYYY-MM-DD) at the start of a line.
ENTRY_HEADING='^## [0-9]{4}-[0-9]{2}-[0-9]{2}'
# The words that the pointer paragraph of the log must hold.
POINTER_RECALL='the automatic recall does not read'

PASS=0
FAIL=0
ERRORS=()

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

ok()  { green "  PASS: $1"; PASS=$((PASS+1)); }
bad() { red "  FAIL: $1"; ERRORS+=("$1"); FAIL=$((FAIL+1)); }

# check <label> <list of problems>: one PASS when the list is empty, else one
# FAIL that names every problem. A case collects its problems with `problem`.
check() { if [ -z "$2" ]; then ok "$1"; else bad "$1 ($2)"; fi; }
PROBLEMS=''
problem() { PROBLEMS="${PROBLEMS}${PROBLEMS:+; }$1"; }

# Join the lines of standard input into one line — each line trimmed of
# leading and trailing blanks, lines separated by one space — so that a prose
# fragment that the text wraps across a line break still matches as one
# fixed string.
fold_text() {
  awk '{ line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line); if (NR > 1) printf " "; printf "%s", line } END { print "" }'
}
# region <file> <start> <end>: print the lines of <file> from the first line
# that starts with the fixed string <start> to the line before the next line
# that starts with the fixed string <end>.
region() {
  awk -v s="$2" -v e="$3" 'f && index($0, e) == 1 { exit } index($0, s) == 1 { f = 1 } f' "$1"
}

# entry_date <i>: the date of entry number <i>. The month is 1 + (i-1)/28 and
# the day is 1 + (i-1)%28, so the dates are valid and ascending up to i = 336.
entry_date() { printf '2026-%02d-%02d' $(( 1 + ($1 - 1) / 28 )) $(( 1 + ($1 - 1) % 28 )); }
# entries <first> <last>: print the entries with these numbers, oldest first.
entries() {
  local i
  for ((i = $1; i <= $2; i++)); do
    printf '## %s 10:00 [saved]\nGoal: entry %03d\nDecisions:\n- decision %03d\n\n' "$(entry_date "$i")" "$i" "$i"
  done
}
# header: print the header of a fixture log (the text before the first entry).
header() { printf '%s\n\n' "$HEADER_TITLE"; }
# to_crlf: print standard input with a carriage return before every line end.
to_crlf() { awk '{ printf "%s\r\n", $0 }'; }
# count_entries <file>: the number of entry headings in <file>.
count_entries() { grep -cE "$ENTRY_HEADING" "$1"; }
# bytes <file>: the size of <file> in bytes.
bytes() { wc -c < "$1" | tr -d ' '; }
# starts_with <file> <prefix-file>, ends_with <file> <suffix-file>: exit 0
# when <file> starts (ends) with the exact bytes of the second file.
starts_with() { head -c "$(bytes "$2")" "$1" | cmp -s - "$2"; }
ends_with() { tail -c "$(bytes "$2")" "$1" | cmp -s - "$2"; }
# middle <file> <prefix-size> <suffix-size>: print the bytes of <file>
# between a prefix and a suffix of these sizes.
middle() { tail -c "+$(( $2 + 1 ))" "$1" | head -c "$(( $(bytes "$1") - $2 - $3 ))"; }

TMP="$(mktemp -d)"
: "${TMP:?mktemp failed}"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
OUTF="$TMP/out.txt"
ERRF="$TMP/err.txt"
# A home folder with no git configuration, so that no global excludes file of
# the user hides the archive in the git checks.
EMPTY_HOME="$TMP/home"
mkdir "$EMPTY_HOME"

# new_case <name>: make an empty fixture folder $TMP/<name>, leave its path in
# CASE_DIR, and clear the problem list.
new_case() { CASE_DIR="$TMP/$1"; mkdir "$CASE_DIR"; PROBLEMS=''; }
# make_log <count>: write a log with a header and <count> entries in CASE_DIR,
# and keep a copy of it in CASE_DIR.orig for the "no change" checks.
make_log() { { header; entries 1 "$1"; } > "$CASE_DIR/$LOG_NAME"; cp "$CASE_DIR/$LOG_NAME" "$CASE_DIR.orig"; }
# run_archive [arguments]: run the script in CASE_DIR; leave its exit code in
# CODE, its standard output in OUTF and its standard error in ERRF.
run_archive() {
  CODE=0
  (cd "$CASE_DIR" && HOME="$EMPTY_HOME" XDG_CONFIG_HOME="$EMPTY_HOME" node "$SCRIPT" "$@") > "$OUTF" 2> "$ERRF" || CODE=$?
}
# expect_unchanged: add a problem when the log differs from its copy or when
# an archive exists.
expect_unchanged() {
  cmp -s "$CASE_DIR/$LOG_NAME" "$CASE_DIR.orig" || problem "the log changed"
  [ ! -e "$CASE_DIR/$ARCHIVE_NAME" ] || problem "an archive was written"
}
# expect_code <code>: add a problem when CODE differs.
expect_code() { [ "$CODE" = "$1" ] || problem "exit code $CODE, expected $1; stderr: $(tr '\n' '|' < "$ERRF")"; }
# expect_counts <log-count> <archive-count>
expect_counts() {
  local log_count archive_count
  log_count="$(count_entries "$CASE_DIR/$LOG_NAME")"
  [ "$log_count" = "$1" ] || problem "the log holds $log_count entries, expected $1"
  archive_count="$(count_entries "$CASE_DIR/$ARCHIVE_NAME" 2>/dev/null)"
  [ "$archive_count" = "$2" ] || problem "the archive holds ${archive_count:-no} entries, expected $2"
}
# expect_pointer_paragraph <file>: add a problem unless <file> is one
# paragraph that names the archive and says that the automatic recall does
# not read it, followed by one blank line.
expect_pointer_paragraph() {
  local text body
  text="$(cat "$1"; printf x)"
  text="${text%x}"
  case "$text" in
    *"$ARCHIVE_NAME"*"$POINTER_RECALL"* | *"$POINTER_RECALL"*"$ARCHIVE_NAME"*) ;;
    *) problem "the text after the header does not name $ARCHIVE_NAME and say \"$POINTER_RECALL\": $text" ;;
  esac
  case "$text" in
    *$'\n\n') body="${text%$'\n\n'}" ;;
    *) problem "the pointer paragraph does not end with one blank line"; body="$text" ;;
  esac
  case "$body" in
    '' | *$'\n\n'* | *$'\n') problem "the text after the header is not one paragraph" ;;
  esac
  if grep -qE "$ENTRY_HEADING" "$1"; then problem "the pointer paragraph holds an entry heading"; fi
}

bold "Archive script: nothing to archive"

for count in "$DEFAULT_KEEP" 5; do
  new_case "at-or-below-$count"
  make_log "$count"
  run_archive
  expect_code 0
  [ "$(cat "$OUTF")" = "nothing to archive: $count entries, keep $DEFAULT_KEEP" ] \
    || problem "output: $(cat "$OUTF")"
  expect_unchanged
  check "$count entries, keep $DEFAULT_KEEP: prints \"nothing to archive\", exits 0, changes no file" "$PROBLEMS"
done

bold "Archive script: first run above the keep count"

new_case first-run
make_log 250
header > "$TMP/header.txt"
entries 1 150 > "$TMP/moved-1.txt"
entries 151 250 > "$TMP/kept-1.txt"
run_archive
expect_code 0
expect_counts 100 150
LOG="$CASE_DIR/$LOG_NAME"
ARCHIVE="$CASE_DIR/$ARCHIVE_NAME"
starts_with "$LOG" "$TMP/header.txt" || problem "the log does not start with its header"
ends_with "$LOG" "$TMP/kept-1.txt" || problem "the log does not end with entries 151 to 250, byte for byte"
middle "$LOG" "$(bytes "$TMP/header.txt")" "$(bytes "$TMP/kept-1.txt")" > "$TMP/pointer.txt"
expect_pointer_paragraph "$TMP/pointer.txt"
ends_with "$ARCHIVE" "$TMP/moved-1.txt" || problem "the archive does not end with entries 1 to 150, byte for byte"
middle "$ARCHIVE" 0 "$(bytes "$TMP/moved-1.txt")" > "$TMP/archive-title.txt"
head -1 "$TMP/archive-title.txt" | grep -qE '^# .+' \
  && [ "$(grep -c '' "$TMP/archive-title.txt")" = 2 ] && [ "$(tail -1 "$TMP/archive-title.txt")" = '' ] \
  || problem "the archive does not start with a one-line title and a blank line: $(tr '\n' '|' < "$TMP/archive-title.txt")"
check "250 entries: the log keeps its header, one pointer paragraph and entries 151-250; a new archive holds a title and entries 1-150" "$PROBLEMS"

PROBLEMS=''
OUTPUT="$(cat "$OUTF")"
[ "$(grep -c '' "$OUTF")" = 1 ] || problem "the output is not one line: $OUTPUT"
for fragment in 150 "$(entry_date 1)" "$(entry_date 150)" "$ARCHIVE_NAME" "$DEFAULT_KEEP"; do
  case "$OUTPUT" in *"$fragment"*) ;; *) problem "the output does not name $fragment: $OUTPUT" ;; esac
done
check "250 entries: one output line names the moved count, the first and last moved date, the archive and the kept count" "$PROBLEMS"

bold "Archive script: second run on the same folder"

PROBLEMS=''
entries 251 310 >> "$LOG"
entries 1 210 > "$TMP/moved-2.txt"
cat "$TMP/header.txt" "$TMP/pointer.txt" > "$TMP/expected-log-2.txt"
entries 211 310 >> "$TMP/expected-log-2.txt"
cat "$TMP/archive-title.txt" "$TMP/moved-2.txt" > "$TMP/expected-archive-2.txt"
run_archive
expect_code 0
expect_counts 100 210
cmp -s "$LOG" "$TMP/expected-log-2.txt" \
  || problem "the log is not the header, the same pointer paragraph and entries 211-310"
cmp -s "$ARCHIVE" "$TMP/expected-archive-2.txt" \
  || problem "the archive is not the same title and entries 1-210 in date order"
POINTERS="$(grep -c "$ARCHIVE_NAME" "$LOG")"
[ "$POINTERS" = 1 ] || problem "the log names the archive on $POINTERS lines"
check "second run: the archive gets entries 151-210 after the first ones; the log holds one pointer" "$PROBLEMS"

bold "Archive script: existing archive, keep argument, no header, CRLF"

new_case existing-archive
make_log 103
printf '# Old archive\nold line' > "$CASE_DIR/$ARCHIVE_NAME"
{ printf '# Old archive\nold line\n'; entries 1 3; } > "$TMP/expected-archive-3.txt"
run_archive
expect_code 0
cmp -s "$CASE_DIR/$ARCHIVE_NAME" "$TMP/expected-archive-3.txt" \
  || problem "the archive is not the old text, one added line end and entries 1-3"
check "an existing archive without a final newline gets a line end, then the moved entries" "$PROBLEMS"

new_case keep-argument
make_log 30
entries 21 30 > "$TMP/kept-4.txt"
entries 1 20 > "$TMP/moved-4.txt"
run_archive 10
expect_code 0
expect_counts 10 20
ends_with "$CASE_DIR/$LOG_NAME" "$TMP/kept-4.txt" || problem "the log does not end with entries 21-30"
ends_with "$CASE_DIR/$ARCHIVE_NAME" "$TMP/moved-4.txt" || problem "the archive does not end with entries 1-20"
check "keep argument 10 on 30 entries: keeps entries 21-30, moves entries 1-20" "$PROBLEMS"

new_case keep-equal
make_log 30
run_archive 30
expect_code 0
[ "$(cat "$OUTF")" = "nothing to archive: 30 entries, keep 30" ] || problem "output: $(cat "$OUTF")"
expect_unchanged
check "keep argument 30 on 30 entries: nothing to archive, no file changed" "$PROBLEMS"

new_case no-header
entries 1 101 > "$CASE_DIR/$LOG_NAME"
entries 2 101 > "$TMP/kept-5.txt"
run_archive
expect_code 0
expect_counts 100 1
ends_with "$CASE_DIR/$LOG_NAME" "$TMP/kept-5.txt" || problem "the log does not end with entries 2-101"
middle "$CASE_DIR/$LOG_NAME" 0 "$(bytes "$TMP/kept-5.txt")" > "$TMP/pointer-5.txt"
expect_pointer_paragraph "$TMP/pointer-5.txt"
check "a log with no header: the pointer paragraph comes first, then the kept entries" "$PROBLEMS"

new_case header-without-blank-line
printf '%s\n' "$HEADER_TITLE" > "$TMP/header-7.txt"
cat "$TMP/header-7.txt" > "$CASE_DIR/$LOG_NAME"
entries 1 101 >> "$CASE_DIR/$LOG_NAME"
entries 2 101 > "$TMP/kept-7.txt"
run_archive
expect_code 0
starts_with "$CASE_DIR/$LOG_NAME" "$TMP/header-7.txt" || problem "the log does not start with its header"
ends_with "$CASE_DIR/$LOG_NAME" "$TMP/kept-7.txt" || problem "the log does not end with entries 2-101"
middle "$CASE_DIR/$LOG_NAME" "$(bytes "$TMP/header-7.txt")" "$(bytes "$TMP/kept-7.txt")" > "$TMP/pointer-7.txt"
[ "$(head -c 1 "$TMP/pointer-7.txt" | tr '\n' 'N')" = N ] || problem "no blank line between the header and the pointer"
tail -c +2 "$TMP/pointer-7.txt" > "$TMP/pointer-7-body.txt"
expect_pointer_paragraph "$TMP/pointer-7-body.txt"
check "a header that ends without a blank line: one blank line, then the pointer paragraph" "$PROBLEMS"

new_case crlf
{ header; entries 1 103; } | to_crlf > "$CASE_DIR/$LOG_NAME"
header | to_crlf > "$TMP/header-6.txt"
entries 4 103 | to_crlf > "$TMP/kept-6.txt"
entries 1 3 | to_crlf > "$TMP/moved-6.txt"
run_archive
expect_code 0
expect_counts 100 3
starts_with "$CASE_DIR/$LOG_NAME" "$TMP/header-6.txt" || problem "the log does not start with its CRLF header"
ends_with "$CASE_DIR/$LOG_NAME" "$TMP/kept-6.txt" || problem "the log does not end with CRLF entries 4-103, byte for byte"
ends_with "$CASE_DIR/$ARCHIVE_NAME" "$TMP/moved-6.txt" || problem "the archive does not end with CRLF entries 1-3, byte for byte"
check "CRLF (carriage return and line feed) line ends: headings found, entries moved byte for byte" "$PROBLEMS"

bold "Archive script: refusals"

# Each invalid argument list is one line; the words of a line are the
# arguments. The empty line stands for one empty argument.
while IFS= read -r args; do
  new_case "invalid-$(printf '%s' "$args" | tr -c 'A-Za-z0-9' '_')x"
  make_log 103
  if [ -z "$args" ]; then run_archive ''; else run_archive $args; fi
  expect_code 2
  grep -qi 'usage' "$ERRF" || problem "no usage message on standard error"
  [ ! -s "$OUTF" ] || problem "standard output is not empty: $(cat "$OUTF")"
  expect_unchanged
  check "invalid argument list '$args': usage on standard error, exit 2, no file changed" "$PROBLEMS"
done <<'ARGS'
0
-3
abc
1.5

10 20
ARGS

new_case missing-log
run_archive
expect_code 1
grep -qF "$LOG_NAME" "$ERRF" || problem "standard error does not name $LOG_NAME"
[ -z "$(ls -A "$CASE_DIR")" ] || problem "a file was written: $(ls -A "$CASE_DIR")"
check "no $LOG_NAME in the folder: message on standard error, exit 1, no file written" "$PROBLEMS"

# The script writes the archive first. When the log cannot be written, the
# moved entries are then in both files, and no entry is lost. The root user
# can write a read-only file, so the check does not run as root.
if [ "$(id -u)" = 0 ]; then
  bold "  SKIP: a read-only log (the root user can write a read-only file)"
else
  new_case read-only-log
  make_log 101
  entries 1 1 > "$TMP/moved-8.txt"
  chmod 444 "$CASE_DIR/$LOG_NAME"
  run_archive
  chmod 644 "$CASE_DIR/$LOG_NAME"
  [ "$CODE" != 0 ] || problem "exit code 0"
  cmp -s "$CASE_DIR/$LOG_NAME" "$CASE_DIR.orig" || problem "the log changed"
  ends_with "$CASE_DIR/$ARCHIVE_NAME" "$TMP/moved-8.txt" 2>/dev/null || problem "the archive does not hold the moved entry"
  check "a read-only log: non-zero exit, the log unchanged, the archive already holds the moved entry" "$PROBLEMS"
fi

bold "Archive script: git"

new_case outside-git
make_log 101
if (cd "$CASE_DIR" && git rev-parse --is-inside-work-tree) > /dev/null 2>&1; then
  problem "precondition: the temporary folder is inside a git work tree"
fi
run_archive
expect_code 0
expect_counts 100 1
check "outside a git work tree: exit 0 and the archive is written" "$PROBLEMS"

new_case inside-git
(cd "$CASE_DIR" && HOME="$EMPTY_HOME" XDG_CONFIG_HOME="$EMPTY_HOME" git init -q) > /dev/null 2>&1
make_log 101
run_archive
expect_code 0
(cd "$CASE_DIR" && HOME="$EMPTY_HOME" XDG_CONFIG_HOME="$EMPTY_HOME" git check-ignore -q "$ARCHIVE_NAME") \
  || problem "git check-ignore does not report $ARCHIVE_NAME as ignored"
STATUS="$(cd "$CASE_DIR" && HOME="$EMPTY_HOME" XDG_CONFIG_HOME="$EMPTY_HOME" git status --porcelain)"
case "$STATUS" in *"$ARCHIVE_NAME"*) problem "git status lists the archive: $STATUS" ;; esac
[ ! -e "$CASE_DIR/.gitignore" ] || problem "a .gitignore was written"
check "inside a git work tree: git ignores the archive through the exclude file, no .gitignore" "$PROBLEMS"

bold "Skill text: step 4 of the save procedure"

SQ="'"
BT='`'
STEP4="$(region "$SKILL" '4. Append a `[saved]` entry' '5. When the `[saved]` entry already exists' | fold_text)"
STEP4_RULES=(
  "After the save, count the entries of the log with ${BT}grep -c ${SQ}^## .*\\[saved\\]${SQ} session-log.md${BT}."
  'When the count is above 200, add one line to your reply that gives the count and offers to archive the log; the user can answer, for example, "archive the session log".'
  'Write this line only once per session.'
  'Do not ask a question that waits for an answer, and do not move any entry before the user says yes.'
)
for rule in "${STEP4_RULES[@]}"; do
  PROBLEMS=''
  case "$STEP4" in *"$rule"*) ;; *) problem "missing between step 4 and step 5" ;; esac
  check "step 4 holds: $rule" "$PROBLEMS"
done

bold "Skill text: session-log.md Format and Maintenance"

MAINTENANCE="$(region "$SKILL" '## session-log.md Format and Maintenance' '## Project Map' | fold_text)"
MAINTENANCE_RULES=(
  'Archive old entries when the user asks for it, for example with "archive the session log".'
  'Run `node "<skill-dir>/scripts/archive-session-log.js"` with the Bash tool from the folder that holds `session-log.md` (`<skill-dir>` is this skill'"'"'s base directory).'
  'The script keeps the newest 100 entries in `session-log.md` and moves the older entries, unchanged, to the end of `session-log-archive.md` in the same folder.'
  'Report the one line that the script prints.'
  'The automatic recall of the hooks does not read `session-log-archive.md`; search it with `grep` when you need older history.'
)
for rule in "${MAINTENANCE_RULES[@]}"; do
  PROBLEMS=''
  case "$MAINTENANCE" in *"$rule"*) ;; *) problem "missing in the section" ;; esac
  check "the maintenance section holds: $rule" "$PROBLEMS"
done
# This check passes before the change too: it guards a rule that must stay.
PROBLEMS=''
case "$MAINTENANCE" in *'mark it rather than deleting: append `[superseded by YYYY-MM-DD]`'*) ;; *) problem "missing" ;; esac
check "the maintenance section keeps the rule: a superseded decision is marked, not deleted" "$PROBLEMS"

PROBLEMS=''
if grep -qF '6 months' "$SKILL"; then problem "found at line $(grep -nF '6 months' "$SKILL" | cut -d: -f1 | tr '\n' ' ')"; fi
check "the skill has no \"6 months\" rule" "$PROBLEMS"

bold "Architecture document"

PROBLEMS=''
if grep -qF '6 months' "$ARCH_DOC"; then problem "\"6 months\" found at line $(grep -nF '6 months' "$ARCH_DOC" | cut -d: -f1 | tr '\n' ' ')"; fi
grep -qF "$ARCHIVE_NAME" "$ARCH_DOC" || problem "$ARCHIVE_NAME is not named"
check "docs/architecture/project-memory.md: no \"6 months\" rule; the archive rule names $ARCHIVE_NAME" "$PROBLEMS"

bold "Skill-activator routing"

# route <prompt>: the skill that the skill-activator hook ranks first, or "none".
route() {
  node -e 'const { matchSkills } = require(process.argv[1]); const m = matchSkills(process.argv[2]); process.stdout.write(m.length ? m[0].skill : "none");' "$ACTIVATOR" "$1"
}
for prompt in 'archive the session log' 'please archive session-log.md now'; do
  ROUTE="$(route "$prompt")"
  PROBLEMS=''
  [ "$ROUTE" = context-management ] || problem "ranked first: $ROUTE"
  check "the prompt \"$prompt\" routes to context-management" "$PROBLEMS"
done

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
exit 0
