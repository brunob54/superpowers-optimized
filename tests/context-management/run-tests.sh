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

# Isolation: the user's global and system git configuration must not change a
# result, and no git variable of the caller may point git at another
# repository. Commit identities come from the environment, so no fixture
# needs a config write.
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

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
# Each entry holds non-ASCII bytes (UTF-8 for "é" and an em dash, and the
# byte 0xFF, which is not valid UTF-8), so a script that does not keep the
# exact bytes fails the byte checks. The last four body lines look like
# headings but do not start an entry: "## " is not at the start of the line,
# there are three "#", there is no space, or blanks stand before "##".
entries() {
  local i
  for ((i = $1; i <= $2; i++)); do
    printf '## %s 10:00 [saved]\nGoal: entry %03d caf\303\251 \342\200\224 \377\nDecisions:\n- decision %03d\nsee ## 2026-01-09\n### 2026-01-08\n##2026-01-07\n   ## 2026-01-06\n\n' "$(entry_date "$i")" "$i" "$i"
  done
}
# header: print the header of a fixture log (the text before the first entry).
header() { printf '%s\n\n' "$HEADER_TITLE"; }
# to_crlf: print standard input with a carriage return before every line end.
to_crlf() { awk '{ printf "%s\r\n", $0 }'; }
# count_entries <file>: the number of entry headings in <file>. The fixtures
# hold a byte that is not valid UTF-8: -a and the C locale make grep read
# every file as text.
count_entries() { LC_ALL=C grep -c -a -E "$ENTRY_HEADING" "$1"; }
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
# A home folder with no git files. GIT_CONFIG_GLOBAL does not switch off the
# default global excludes file ($XDG_CONFIG_HOME/git/ignore, else
# $HOME/.config/git/ignore), which could hide the archive in the git checks.
EMPTY_HOME="$TMP/home"
mkdir "$EMPTY_HOME"
export HOME="$EMPTY_HOME" XDG_CONFIG_HOME="$EMPTY_HOME"

# Fault injection for the archive script, loaded with `node --require`: around
# the writes of the script, do the action named in INJECT. Each action
# stands for an event that a real run can meet: another session appends to
# the log or rewrites it, or a write does not store the expected bytes.
INJECT_JS="$TMP/inject.js"
cat > "$INJECT_JS" <<'JS'
const fs = require('fs');
const path = require('path');
const realAppend = fs.appendFileSync;
const realWrite = fs.writeFileSync;
const action = process.env.INJECT;
const { APPENDED_ENTRY, REWRITTEN_LOG } = process.env;
// Node's appendFileSync calls fs.writeFileSync, so a write can pass two
// wrappers; only the outer one acts.
let depth = 0;
function wrap(real) {
  return function (file, data, ...rest) {
    if (depth > 0) return real.call(fs, file, data, ...rest);
    depth++;
    try {
      const name = typeof file === 'string' ? path.basename(file) : '';
      if (name === 'session-log-archive.md' && action === 'corrupt-archive') data += 'X';
      if (name === 'session-log.md' && action === 'corrupt-log') data = data.slice(0, -1);
      if (name === 'session-log.md' && action === 'append-then-fail-log-write') {
        realAppend.call(fs, 'session-log.md', APPENDED_ENTRY);
        const error = new Error('EACCES: permission denied');
        error.code = 'EACCES';
        throw error;
      }
      const result = real.call(fs, file, data, ...rest);
      if (name === 'session-log-archive.md' && action === 'append-log') realAppend.call(fs, 'session-log.md', APPENDED_ENTRY);
      if (name === 'session-log-archive.md' && action === 'rewrite-log') realWrite.call(fs, 'session-log.md', REWRITTEN_LOG);
      if (name === 'session-log.md' && action === 'append-after-log-write') realAppend.call(fs, 'session-log.md', APPENDED_ENTRY);
      return result;
    } finally {
      depth--;
    }
  };
}
fs.appendFileSync = wrap(realAppend);
fs.writeFileSync = wrap(realWrite);
JS
# The texts that the injected actions write; inject.js reads them from the
# environment.
export APPENDED_ENTRY=$'## 2026-12-28 10:00 [saved]\nGoal: appended during the run\n\n'
export REWRITTEN_LOG=$'# Rewritten by another session\n'
INJECT=''
RUN_PATH="$PATH"

# new_case <name>: make an empty fixture folder $TMP/<name>, leave its path in
# CASE_DIR, and clear the problem list.
new_case() { CASE_DIR="$TMP/$1"; mkdir "$CASE_DIR"; PROBLEMS=''; }
# make_log <count>: write a log with a header and <count> entries in CASE_DIR,
# and keep a copy of it in CASE_DIR.orig for the "no change" checks.
make_log() { { header; entries 1 "$1"; } > "$CASE_DIR/$LOG_NAME"; cp "$CASE_DIR/$LOG_NAME" "$CASE_DIR.orig"; }
# run_archive [arguments]: run the script in CASE_DIR; leave its exit code in
# CODE, its standard output in OUTF and its standard error in ERRF.
# INJECT names an action of the fault injection (empty: none); RUN_PATH is
# the PATH of the script.
run_archive() {
  local preload=()
  [ -z "$INJECT" ] || preload=(--require "$INJECT_JS")
  CODE=0
  (cd "$CASE_DIR" && INJECT="$INJECT" PATH="$RUN_PATH" node ${preload[@]+"${preload[@]}"} "$SCRIPT" "$@") > "$OUTF" 2> "$ERRF" || CODE=$?
}
# run_injected <action> [arguments]: run_archive with that injected action.
run_injected() { INJECT="$1"; shift; run_archive "$@"; INJECT=''; }
# expect_one_message <fragment>: add a problem unless standard error is one
# line that holds <fragment> (a message, not a stack trace).
expect_one_message() {
  [ "$(grep -c '' "$ERRF")" = 1 ] || problem "standard error is not one line: $(tr '\n' '|' < "$ERRF")"
  grep -qF -- "$1" "$ERRF" || problem "standard error does not say \"$1\""
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
    '' | $'\n'* | *$'\n\n'* | *$'\n') problem "the text after the header is not one paragraph" ;;
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
for file in "$LOG_NAME" "$ARCHIVE_NAME"; do
  LF_ONLY="$(LC_ALL=C grep -c -a -v $'\r$' "$CASE_DIR/$file")"
  [ "$LF_ONLY" = 0 ] || problem "$file has $LF_ONLY lines that end without a carriage return"
done
middle "$CASE_DIR/$LOG_NAME" "$(bytes "$TMP/header-6.txt")" "$(bytes "$TMP/kept-6.txt")" > "$TMP/pointer-6.txt"
[ "$(grep -c '' "$TMP/pointer-6.txt")" = 2 ] && [ "$(sed -n 2p "$TMP/pointer-6.txt")" = $'\r' ] \
  && sed -n 1p "$TMP/pointer-6.txt" | grep -qF "$ARCHIVE_NAME" \
  || problem "after the header (which ends with its blank line) the log does not hold the pointer line and one blank line: $(od -c "$TMP/pointer-6.txt" | head -3 | tr '\n' '|')"
check "CRLF (carriage return and line feed) line ends: headings found, entries moved byte for byte, new lines end with CRLF, one blank line before the pointer" "$PROBLEMS"

new_case crlf-heading-lf-blank
printf '# Log\r\n\r\n## 2026-01-01 [saved]\r\nGoal: a\r\n\n## 2026-01-02 [saved]\r\nGoal: b\r\n\n## 2026-01-03 [saved]\r\n' > "$CASE_DIR/$LOG_NAME"
run_archive 1
expect_code 0
head -1 "$CASE_DIR/$ARCHIVE_NAME" | LC_ALL=C grep -q -a $'\r$' || problem "the archive title line ends without a carriage return"
check "a CRLF heading line whose entry ends with an LF blank line: the new lines take the line end of the heading line" "$PROBLEMS"

# fence_variant <n>: print fenced entry number <n> (1 to 4), dated 2026-01-03.
# Inside each block stand "## YYYY-MM-DD" lines and fence lines that must not
# close the block.
fence_variant() {
  printf '## 2026-01-03 10:00 [saved]\nGoal: fence variant %s\n' "$1"
  case "$1" in
    1) printf '```markdown\n## 2026-01-03 10:00 [saved]\n``` not a closing fence\n## 2026-01-03 11:00 [saved]\n```\n' ;;
    2) printf '~~~~\n~~~\n## 2026-01-03 11:00 [saved]\n~~~~\n' ;;
    3) printf '~~~\n```\n## 2026-01-03 11:00 [saved]\n~~~\n' ;;
    4) printf '   ```\n## 2026-01-03 11:00 [saved]\n   ```\n' ;;
  esac
  printf -- '- after the block\n\n'
}
FENCE_VARIANTS=(
  'backticks with an info string, and a fence line that carries text'
  'tildes with a shorter inner run'
  'tildes with an inner run of backticks'
  'backticks indented by three spaces'
)
# expect_moved_count <n>: add a problem unless the output says that <n>
# entries were moved. A split of a moved entry keeps its bytes, but not this
# count.
expect_moved_count() {
  case "$(cat "$OUTF")" in "archived $1 entries "*) ;; *) problem "the output does not say \"archived $1 entries\": $(cat "$OUTF")" ;; esac
}
# fence_fixture <name> <log part after entries 1-2> <expected kept part>
# <expected moved part after entries 1-2> <moved count>: one run with keep 1,
# for the fenced entry VARIANT and the line ends of CONVERT. Each part is the
# name of a shell function that prints it (`:` prints nothing).
fence_fixture() {
  CASE_DIR="$TMP/$1"
  mkdir "$CASE_DIR"
  { header; entries 1 2; $2; } | "$CONVERT" > "$CASE_DIR/$LOG_NAME"
  { header; cat "$TMP/pointer.txt"; $3; } | "$CONVERT" > "$TMP/expected-log-$1.txt"
  { entries 1 2; $4; } | "$CONVERT" > "$TMP/expected-moved-$1.txt"
  run_archive 1
  expect_code 0
  cmp -s "$CASE_DIR/$LOG_NAME" "$TMP/expected-log-$1.txt" || problem "$1: the log is not the header, the pointer and the expected kept entry"
  ends_with "$CASE_DIR/$ARCHIVE_NAME" "$TMP/expected-moved-$1.txt" 2>/dev/null || problem "$1: the archive does not end with the expected moved entries"
  expect_moved_count "$5"
}
# The fenced entry, and the fenced entry followed by entry 4.
fenced() { fence_variant "$VARIANT"; }
fenced_then_4() { fence_variant "$VARIANT"; entries 4 4; }
entry_4() { entries 4 4; }
for eol in LF CRLF; do
  if [ "$eol" = CRLF ]; then CONVERT=to_crlf; else CONVERT=cat; fi
  for VARIANT in 1 2 3 4; do
    PROBLEMS=''
    # The fenced entry is the last one: a split would keep only its end.
    fence_fixture "fence-$eol-$VARIANT-last" fenced fenced : 2
    # A plain entry follows: a block that does not close would swallow it.
    fence_fixture "fence-$eol-$VARIANT-closed" fenced_then_4 entry_4 fenced 3
    check "$eol: fence of ${FENCE_VARIANTS[$((VARIANT - 1))]}: a \"## YYYY-MM-DD\" line inside does not start an entry, and the block closes" "$PROBLEMS"
  done
done

new_case byte-order-mark
{ printf '\357\273\277'; entries 1 101; } > "$CASE_DIR/$LOG_NAME"
printf '\357\273\277' > "$TMP/bom.txt"
entries 2 101 > "$TMP/kept-9.txt"
entries 1 1 > "$TMP/moved-9.txt"
run_archive
expect_code 0
starts_with "$CASE_DIR/$LOG_NAME" "$TMP/bom.txt" || problem "the log does not start with the byte order mark"
ends_with "$CASE_DIR/$LOG_NAME" "$TMP/kept-9.txt" || problem "the log does not end with entries 2-101"
middle "$CASE_DIR/$LOG_NAME" 3 "$(bytes "$TMP/kept-9.txt")" > "$TMP/pointer-9.txt"
expect_pointer_paragraph "$TMP/pointer-9.txt"
ends_with "$CASE_DIR/$ARCHIVE_NAME" "$TMP/moved-9.txt" 2>/dev/null || problem "the archive does not end with entry 1"
check "a UTF-8 byte order mark before the first entry: the mark stays first, entry 1 is moved" "$PROBLEMS"

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

# The script writes the archive first. When the log write then fails, the
# script removes what it appended to the archive. The root user can write a
# read-only file, so the check does not run as root.
if [ "$(id -u)" = 0 ]; then
  bold "  SKIP: a read-only log (the root user can write a read-only file)"
else
  new_case read-only-log
  make_log 101
  chmod 444 "$CASE_DIR/$LOG_NAME"
  run_archive
  chmod 644 "$CASE_DIR/$LOG_NAME"
  expect_code 1
  expect_one_message 'unchanged'
  expect_unchanged
  run_archive
  expect_code 0
  expect_counts 100 1
  check "a read-only log: one message, exit 1, the archive write undone; a second run moves each entry once" "$PROBLEMS"
fi

for name in "$LOG_NAME" "$ARCHIVE_NAME"; do
  new_case "folder-$name"
  if [ "$name" = "$ARCHIVE_NAME" ]; then make_log 101; fi
  mkdir "$CASE_DIR/$name"
  run_archive
  expect_code 1
  expect_one_message 'is a folder'
  if [ "$name" = "$ARCHIVE_NAME" ]; then
    cmp -s "$CASE_DIR/$LOG_NAME" "$CASE_DIR.orig" || problem "the log changed"
  else
    [ ! -e "$CASE_DIR/$ARCHIVE_NAME" ] || problem "an archive was written"
  fi
  check "a folder in place of $name: one message, exit 1, no file changed" "$PROBLEMS"
done

bold "Archive script: events during the run (fault injection)"

new_case append-during-run
make_log 103
entries 4 103 > "$TMP/kept-10.txt"
printf '%s' "$APPENDED_ENTRY" >> "$TMP/kept-10.txt"
entries 1 3 > "$TMP/moved-10.txt"
run_injected append-log
expect_code 0
ends_with "$CASE_DIR/$LOG_NAME" "$TMP/kept-10.txt" || problem "the log does not end with entries 4-103 and the entry appended during the run"
ends_with "$CASE_DIR/$ARCHIVE_NAME" "$TMP/moved-10.txt" || problem "the archive does not end with entries 1-3"
check "an entry appended to the log after the archive write is kept at the end of the log" "$PROBLEMS"

new_case rewrite-during-run
make_log 103
printf '# Old archive\n' > "$CASE_DIR/$ARCHIVE_NAME"
cp "$CASE_DIR/$ARCHIVE_NAME" "$TMP/archive-11.txt"
run_injected rewrite-log
expect_code 1
expect_one_message 'unchanged'
[ "$(cat "$CASE_DIR/$LOG_NAME"; printf x)" = "${REWRITTEN_LOG}x" ] || problem "the script changed the log that another session rewrote"
cmp -s "$CASE_DIR/$ARCHIVE_NAME" "$TMP/archive-11.txt" || problem "the archive does not hold its old bytes again"
check "the log rewritten (not appended) after the archive write: one message, exit 1, the archive back to its old bytes" "$PROBLEMS"

new_case corrupt-archive
make_log 103
run_injected corrupt-archive
expect_code 1
expect_one_message "$ARCHIVE_NAME does not hold the expected bytes"
expect_unchanged
check "the archive does not hold the expected bytes after its write: exit 1, the archive write undone, the log unchanged" "$PROBLEMS"

new_case corrupt-log
make_log 103
run_injected corrupt-log
expect_code 1
expect_one_message "$LOG_NAME does not hold the expected bytes"
check "the log does not hold the expected bytes after its write: one message, exit 1" "$PROBLEMS"

new_case append-after-log-write
make_log 103
header > "$TMP/header-12.txt"
entries 4 103 > "$TMP/kept-12.txt"
printf '%s' "$APPENDED_ENTRY" >> "$TMP/kept-12.txt"
run_injected append-after-log-write
expect_code 0
starts_with "$CASE_DIR/$LOG_NAME" "$TMP/header-12.txt" || problem "the log does not start with its header"
ends_with "$CASE_DIR/$LOG_NAME" "$TMP/kept-12.txt" || problem "the log does not end with entries 4-103 and the entry appended after the write"
check "an entry appended to the log just after the log write: exit 0, the entry stays" "$PROBLEMS"

new_case append-then-fail-log-write
make_log 103
cp "$CASE_DIR.orig" "$TMP/expected-log-13.txt"
printf '%s' "$APPENDED_ENTRY" >> "$TMP/expected-log-13.txt"
run_injected append-then-fail-log-write
expect_code 1
expect_one_message 'unchanged'
cmp -s "$CASE_DIR/$LOG_NAME" "$TMP/expected-log-13.txt" || problem "the log is not its old text and the appended entry"
[ ! -e "$CASE_DIR/$ARCHIVE_NAME" ] || problem "the archive write was not undone"
run_archive
expect_code 0
expect_counts 100 4
check "an entry appended just before a failed log write: the archive write undone; a second run moves each entry once" "$PROBLEMS"

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

# The exclude entry that hooks/git-exclude.js writes for the archive.
EXCLUDE_ENTRY="/$ARCHIVE_NAME"

new_case inside-git
git -C "$CASE_DIR" init -q
make_log 101
run_archive
expect_code 0
git -C "$CASE_DIR" check-ignore -q "$ARCHIVE_NAME" || problem "git check-ignore does not report $ARCHIVE_NAME as ignored"
grep -qxF "$EXCLUDE_ENTRY" "$CASE_DIR/.git/info/exclude" || problem "the exclude file has no entry $EXCLUDE_ENTRY"
STATUS="$(git -C "$CASE_DIR" status --porcelain)"
case "$STATUS" in *"$ARCHIVE_NAME"*) problem "git status lists the archive: $STATUS" ;; esac
[ ! -e "$CASE_DIR/.gitignore" ] || problem "a .gitignore was written"
check "inside a git work tree: git ignores the archive through the exclude file, no .gitignore" "$PROBLEMS"

new_case tracked-log
git -C "$CASE_DIR" init -q
make_log 101
git -C "$CASE_DIR" add "$LOG_NAME"
git -C "$CASE_DIR" commit -q -m log
run_archive
expect_code 0
if grep -qxF "$EXCLUDE_ENTRY" "$CASE_DIR/.git/info/exclude" 2>/dev/null; then problem "the exclude file hides the archive"; fi
STATUS="$(git -C "$CASE_DIR" status --porcelain)"
case "$STATUS" in *"?? $ARCHIVE_NAME"*) ;; *) problem "git status does not list the archive as untracked: $STATUS" ;; esac
grep -qF "$LOG_NAME is tracked by git, so this script did not hide $ARCHIVE_NAME from git: commit it together with $LOG_NAME" "$OUTF" \
  || problem "the output does not say to commit the archive: $(cat "$OUTF")"
check "git tracks the log: no exclude entry, and the output says to commit the archive together with the log" "$PROBLEMS"

# A save of another session while git runs: a fake git first appends one
# entry to the log, then runs the real git. Windows cannot start a bash
# script named "git" from node, so the check does not run there.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) bold "  SKIP: a save during the git step (no fake git on Windows)" ;;
  *)
    new_case save-during-git
    git -C "$CASE_DIR" init -q
    make_log 101
    mkdir "$TMP/fakebin"
    {
      printf '#!/bin/sh\nreal_git='"'"'%s'"'"'\n' "$(command -v git)"
      cat <<'FAKE'
n=$(( $(cat git-calls 2>/dev/null || echo 0) + 1 ))
echo "$n" > git-calls
printf '## 2026-12-28 10:00 [saved]\nGoal: concurrent save %s\n\n' "$n" >> session-log.md
exec "$real_git" "$@"
FAKE
    } > "$TMP/fakebin/git"
    chmod +x "$TMP/fakebin/git"
    RUN_PATH="$TMP/fakebin:$PATH"
    run_archive
    RUN_PATH="$PATH"
    expect_code 0
    CALLS="$(cat "$CASE_DIR/git-calls" 2>/dev/null)"
    [ "${CALLS:-0}" -gt 0 ] || problem "the fake git never ran"
    cat "$CASE_DIR/$LOG_NAME" "$CASE_DIR/$ARCHIVE_NAME" 2>/dev/null | LC_ALL=C grep -a '^Goal: concurrent save ' > "$TMP/saved-during-git.txt"
    TOTAL="$(grep -c '' "$TMP/saved-during-git.txt")"
    UNIQUE="$(sort -u "$TMP/saved-during-git.txt" | grep -c '')"
    [ "$TOTAL" = "${CALLS:-0}" ] && [ "$UNIQUE" = "$TOTAL" ] \
      || problem "${CALLS:-0} entries were saved during the git step; the log and the archive hold $TOTAL ($UNIQUE different)"
    check "entries saved while the script runs git are kept" "$PROBLEMS"
    ;;
esac

bold "Skill text: step 4 of the save procedure"

SQ="'"
BT='`'
STEP4="$(region "$SKILL" '4. Append a `[saved]` entry' '5. When the `[saved]` entry already exists' | fold_text)"
STEP4_RULES=(
  "After the save, count the entries of the log with ${BT}grep -c -a -E ${SQ}^## [0-9]{4}-[0-9]{2}-[0-9]{2}${SQ} session-log.md${BT}."
  'This is the rule of the archive script: an entry starts at a line with `## ` and a date (the script also skips such a line inside a fenced code block).'
  'The option `-a` makes `grep` read the file as text: without it, the `grep` of the Claude Code Bash tool prints nothing for a file that holds a byte that is not valid UTF-8 (Unicode Transformation Format, 8-bit).'
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
  'After a save, step 4 offers this when the log holds more than 200 entries.'
  'To keep another number of entries, give that number as the only argument.'
  'Report the one line that the script prints.'
  'When the script exits with a non-zero code, report its output and change no file by hand.'
  'The automatic recall (the session-start hook and the prompt hook, which add log entries to the context of a session) does not read `session-log-archive.md`; search it with `grep` when you need older history.'
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

bold "Skill text: routing and the search of older history"

STEP0="$(region "$SKILL" '| User said | Go to |' 'Do not default to' | fold_text)"
FRONTMATTER="$(awk 'NR == 1 && /^---$/ { f = 1; next } f && /^---$/ { exit } f' "$SKILL" | fold_text)"
STEP3="$(region "$SKILL" '**Step 3 — Adjust based on hit count:**' '**Step 4 — Surface what matters.**' | fold_text)"
STEP6="$(region "$SKILL" '6. In a new session' '## session-log.md Format and Maintenance' | fold_text)"
# Each line: a label, a tab, the text to search, a tab, the fixed string.
while IFS="$(printf '\t')" read -r label text rule; do
  PROBLEMS=''
  case "${!text}" in *"$rule"*) ;; *) problem "missing" ;; esac
  check "$label holds: $rule" "$PROBLEMS"
done <<'RULES'
the frontmatter description	FRONTMATTER	"create project map", "archive the session log", cross-session handoff needed
the route table	STEP0	| "archive the session log" | [session-log.md Format and Maintenance](#session-logmd-format-and-maintenance) section |
step 3 of the start-of-task search	STEP3	- **0 hits on all keywords** → when `session-log-archive.md` exists, run the same `grep` commands on it. With 0 hits there too, fall back to `project-map.md` Critical Constraints.
step 6 of the save procedure	STEP6	With 0 hits there, grep `session-log-archive.md` too when it exists.
RULES

KEYWORD_RULE='The option `-a` makes `grep` read the file as text: without it, the `grep` of the Claude Code Bash tool prints nothing for a file that holds a byte that is not valid UTF-8 (Unicode Transformation Format, 8-bit). One case remains: the `grep` of macOS misses a keyword that stands after such a byte on the same line.'
bold "Skill text: the keyword search commands"

# The commands of the start-of-task search and of step 3 of the save
# procedure, copied from the skill text, run with the system grep on a log
# that holds the byte 0xFF on a line without a keyword. Without -a, the grep
# of the Claude Code Bash tool (ugrep) prints nothing for such a file
# (measured); the textual check below requires -a. Not checked, an accepted
# limit: the grep of macOS in a UTF-8 locale misses a keyword that stands
# after such a byte on the same line, also with -a (measured).
new_case keyword-search
printf '# Session Log\n\n## 2026-01-01 10:00 [saved]\nGoal: caf\303\251 \377 note\nDecisions: hook auth bad\n\n## 2026-01-02 10:00 [saved]\nGoal: Hook deploy\nOpen: HOOK bad\n' > "$CASE_DIR/$LOG_NAME"
# skill_command <placeholder>: the one command of the skill that holds the
# placeholder, from a code block line or from an inline code span.
skill_command() {
  { grep -E "^ *grep .*\"$1\"" "$SKILL" | sed 's/^ *//'
    grep -o "\`[^\`]*\"$1\"[^\`]*\`" "$SKILL" | tr -d '\`'; }
}
# Each line: a placeholder, a tab, the keywords that replace the
# placeholders of its command (<a>=<b>,...), a tab, the expected line count.
while IFS="$(printf '\t')" read -r placeholder swaps expected; do
  PROBLEMS=''
  COMMAND="$(skill_command "$placeholder")"
  [ "$(printf '%s\n' "$COMMAND" | grep -c '')" = 1 ] || problem "not exactly one command holds $placeholder: $COMMAND"
  for swap in $(printf '%s' "$swaps" | tr ',' ' '); do COMMAND="${COMMAND//${swap%%=*}/${swap#*=}}"; done
  (cd "$CASE_DIR" && LC_ALL=C.UTF-8 bash -c "$COMMAND") > "$OUTF" 2>/dev/null
  LINES="$(grep -c '' "$OUTF")"
  [ "$LINES" = "$expected" ] || problem "$COMMAND printed $LINES lines, expected $expected"
  # Every printed line holds the last keyword (a "binary file matches"
  # message of grep does not).
  OTHER="$(LC_ALL=C grep -c -i -a -v -- "${swap#*=}" "$OUTF")"
  [ "$OTHER" = 0 ] || problem "$COMMAND printed $OTHER lines without \"${swap#*=}\""
  check "the skill command with $placeholder finds every line with the keyword in a log that holds a byte that is not UTF-8" "$PROBLEMS"
done <<'COMMANDS'
<keyword1>	<keyword1>=hook	3
<keyword2>	<keyword2>=bad	2
<kw1>	<kw1>=hook,<kw2>=bad	2
<keyword>	<keyword>=hook	3
COMMANDS
PROBLEMS=''
UNSAFE="$(grep -n 'grep -i "' "$SKILL")"
[ -z "$UNSAFE" ] || problem "keyword grep without -a: $UNSAFE"
case "$(fold_text < "$SKILL")" in *"$KEYWORD_RULE"*) ;; *) problem "missing: $KEYWORD_RULE" ;; esac
check "every keyword grep of the skill reads bytes as text, and the skill says why" "$PROBLEMS"

PROBLEMS=''
if grep -qF '6 months' "$SKILL"; then problem "found at line $(grep -nF '6 months' "$SKILL" | cut -d: -f1 | tr '\n' ' ')"; fi
check "the skill has no \"6 months\" rule" "$PROBLEMS"

bold "Skill text: the commit hash that project-map.md records"

# Step 1 of the generation procedure and the header line of the template
# name the same short form of the hash. The session-start hook accepts any
# map hash that is the start of the full hash of HEAD.
STEP1="$(region "$SKILL" '1. **Check for git:**' '2. **Map the structure:**' | fold_text)"
STEP1_RULE='- If git exists → record `git rev-parse --short HEAD` as the staleness hash.'
MAP_HEADER='_Generated: YYYY-MM-DD HH:MM | Git: <short-hash> | (or: Staleness: timestamps)_'
OLD_STEP1='record `git rev-parse HEAD`'
PROBLEMS=''
case "$STEP1" in *"$STEP1_RULE"*) ;; *) problem "step 1 does not hold: $STEP1_RULE" ;; esac
grep -qxF -- "$MAP_HEADER" "$SKILL" || problem "no template header line: $MAP_HEADER"
check "step 1 records the short hash that the template header names (Git: <short-hash>)" "$PROBLEMS"
PROBLEMS=''
case "$(fold_text < "$SKILL")" in *"$OLD_STEP1"*) problem "found" ;; esac
check "the skill no longer says: $OLD_STEP1" "$PROBLEMS"

bold "Architecture document"

PROBLEMS=''
if grep -qF '6 months' "$ARCH_DOC"; then problem "\"6 months\" found at line $(grep -nF '6 months' "$ARCH_DOC" | cut -d: -f1 | tr '\n' ' ')"; fi
DOC_RULE='The log is keyword-searchable and per-project. When it holds more than 200 entries, the context-management skill says so after a save and offers an archive; on the user'"'"'s request, a script keeps the newest 100 entries and moves the older ones to `session-log-archive.md`, which the automatic recall does not read.'
case "$(fold_text < "$ARCH_DOC")" in *"$DOC_RULE"*) ;; *) problem "the archive rule is missing: $DOC_RULE" ;; esac
check "docs/architecture/project-memory.md: no \"6 months\" rule; the archive rule names 200, 100 and $ARCHIVE_NAME" "$PROBLEMS"

bold "Documents: where the older entries are"

# After an archive, the older entries are in session-log-archive.md, and the
# automatic recall reads only session-log.md. Each document names both files.
# Each line: a document, a tab, the sentence that the document must hold.
README_DOC="$ROOT/README.md"
GUIDE_DOC="$ROOT/docs/guide/README.md"
while IFS="$(printf '\t')" read -r doc sentence; do
  PROBLEMS=''
  case "$(fold_text < "$doc")" in *"$sentence"*) ;; *) problem "missing" ;; esac
  check "${doc#"$ROOT"/} holds: $sentence" "$PROBLEMS"
done <<EOF
$ARCH_DOC	For older history — decisions from earlier in a project's lifetime — Claude can grep \`$LOG_NAME\`, then \`$ARCHIVE_NAME\`, for keywords relevant to the current task.
$README_DOC	Only the most recent entries are injected at session start, and only while they fit the session-start hook's 10,000-character output budget — older entries are lookup-only, surfaced via keyword grep when a task touches the same area; entries that an archive moved to \`$ARCHIVE_NAME\` are not surfaced.
$GUIDE_DOC	The archive step also hides \`$ARCHIVE_NAME\` from \`git status\` with an exclude entry, unless git tracks \`$LOG_NAME\`; then commit the archive together with the log.
$ARCH_DOC	The next session reads \`state.md\` first to restore context. Then it greps \`$LOG_NAME\` for relevant history, and then \`$ARCHIVE_NAME\`, which holds the older entries after an archive.
EOF
# The line of the flow diagram, compared whole: the tree characters and the
# indentation are part of it.
DIAGRAM_LINE="            ├── For older session history: Grep $LOG_NAME, then $ARCHIVE_NAME, for task keywords"
PROBLEMS=''
grep -qxF -- "$DIAGRAM_LINE" "$ARCH_DOC" || problem "missing"
check "docs/architecture/project-memory.md holds the diagram line: $DIAGRAM_LINE" "$PROBLEMS"
# The old wordings, each of which named only session-log.md for older
# history. A check of the whole document for a grep without the archive name
# would also match two lines that name no file to grep (the session-log.md
# line of "Over time" and the "Token-efficient by design" paragraph).
ARCH_FOLDED="$(fold_text < "$ARCH_DOC")"
OLD_ARCH_GREPS=(
  "Claude can \`Grep $LOG_NAME\`"
  "then greps \`$LOG_NAME\` for relevant history."
  "Grep $LOG_NAME for task keywords"
)
for old in "${OLD_ARCH_GREPS[@]}"; do
  PROBLEMS=''
  case "$ARCH_FOLDED" in *"$old"*) problem "found" ;; esac
  check "docs/architecture/project-memory.md no longer says: $old" "$PROBLEMS"
done

bold "Hot Files and how $LOG_NAME is written"

# No hook writes session-log.md, and no entry has a `Files:` line: the AI
# writes each [saved] entry with the skill, when the user asks or when the
# decision-log reminder of the stop hook asks. Step 5 of the map procedure
# therefore takes Hot Files from git.
STEP5="$(region "$SKILL" '5. **Identify hot files:**' '6. **Write `project-map.md`' | fold_text)"
HOT_FILES_COMMAND="git log -n 30 --name-only --format= | grep -v ${SQ}^\$${SQ} | sort | uniq -c | sort -rn | head -10"
STEP5_RULE="5. **Identify hot files:** With git, list the files that recent commits changed most often, for example with ${BT}${HOT_FILES_COMMAND}${BT}. Leave out release and version files (the version file, release notes, package manifests): every release changes them, so they say nothing about the work. Without git, list the files edited most in this session. These are the ones most likely to need freshness checks on future sessions."
OLD_STEP5="${BT}Files:${BT} lines"
PROBLEMS=''
case "$STEP5" in *"$STEP5_RULE"*) ;; *) problem "missing between step 5 and step 6" ;; esac
check "step 5 holds: $STEP5_RULE" "$PROBLEMS"
PROBLEMS=''
case "$(fold_text < "$SKILL")" in *"$OLD_STEP5"*) problem "found" ;; esac
check "the skill no longer says: $OLD_STEP5" "$PROBLEMS"

# docs/architecture/project-memory.md: sentences (searched in the folded
# text), then lines compared whole (a table row, a list item, a line of the
# flow diagram), then the old wordings, which said that a hook writes the log.
ARCH_SENTENCES=(
  'A chronological log of the decisions made in past sessions. The AI writes each entry with the `context-management` skill.'
  'No hook writes to `session-log.md`. The AI writes each entry with the `context-management` skill, in two cases:'
  '- You ask for it, for example with "save state".'
  '- The `stop-reminders` hook reminds it. When files such as skills, hooks, `CLAUDE.md`, specs or plans were edited since the last `[saved]` entry, the hook blocks the end of the turn and asks the AI to write a `[saved]` entry. Set `SUPERPOWERS_STOP_REMINDERS_OFF=decision-log` to switch this reminder off.'
  'Each `[saved]` entry contains the goal, decisions made, approaches rejected, and open questions — structured for future recall.'
  '**Zero setup for new projects.** `session-log.md` starts with the first `[saved]` entry, which the AI writes when you say "save state" or when the stop hook reminds it.'
  'This fork (superpowers-orchestrator) implements the same episodic memory concept as a lighter-weight, dependency-free variant: plain markdown files, keyword grep instead of vector search, and entries that the AI writes with the `context-management` skill (on request or after a stop-hook reminder) instead of a separate archiving process.'
  '**Additive, never destructive.** The save step of the `context-management` skill appends a new `[saved]` entry to `session-log.md` and never deletes an entry: when a new decision contradicts an old one, it only adds `[superseded by YYYY-MM-DD]` to the heading line of the old entry. The archive step runs only when you ask for it; it moves the oldest entries, unchanged, to `session-log-archive.md`.'
)
for sentence in "${ARCH_SENTENCES[@]}"; do
  PROBLEMS=''
  case "$ARCH_FOLDED" in *"$sentence"*) ;; *) problem "missing" ;; esac
  check "docs/architecture/project-memory.md holds: $sentence" "$PROBLEMS"
done
# The Hot Files line of the sample map: the old one listed a manifest, a file
# that step 5 now leaves out.
OLD_HOT_FILES_LINE='hooks/session-start, hooks/stop-reminders.js, .claude-plugin/plugin.json'
NEW_HOT_FILES_LINE='hooks/session-start, hooks/stop-reminders.js, hooks/skill-activator.js'
ARCH_LINES=(
  '| `session-log.md` | `context-management` skill, on request or after a stop-hook reminder | Episodic history of what happened across all sessions |'
  '5. Identify hot files from `git log --name-only` over recent commits (the most often changed files, without release and version files)'
  '            ├── [reminder] Stop hook asks for a [saved] entry after edits of skills, hooks, specs or plans'
  "$NEW_HOT_FILES_LINE"
  '- `hooks/stop-reminders.js` — the stop hook: when a turn ends, it reminds the AI about source edits without test changes, uncommitted files of the session, a missing `[saved]` entry (the decision-log reminder), a `state.md` older than the latest edits, and large `session-log.md` entries; it writes no session-log entry'
)
for line in "${ARCH_LINES[@]}"; do
  PROBLEMS=''
  grep -qxF -- "$line" "$ARCH_DOC" || problem "missing"
  check "docs/architecture/project-memory.md holds the line: $line" "$PROBLEMS"
done
OLD_ARCH_WRITERS=(
  '[auto]'
  'built up automatically'
  'Stop hook (automatic)'
  'starts building automatically'
  'automatic stop-hook writing'
  "from ${BT}${LOG_NAME}${BT} history"
  'auto-appends'
  'The stop hook only appends'
  "$OLD_HOT_FILES_LINE"
)
for old in "${OLD_ARCH_WRITERS[@]}"; do
  PROBLEMS=''
  case "$ARCH_FOLDED" in *"$old"*) problem "found" ;; esac
  check "docs/architecture/project-memory.md no longer says: $old" "$PROBLEMS"
done

bold "Skill text: where the session-start hook finds the map, and when it injects it"

# The hook tests for the file with `[ -f "project-map.md" ]`, after it has
# changed to the folder in CLAUDE_PROJECT_DIR. It adds the map last of the
# memory sections, so a large map is left out of its output. The step names
# that folder by what the AI can observe: a Bash command cannot read
# CLAUDE_PROJECT_DIR, so a rule that depends on the variable cannot be
# followed.
MAP_STEP6="$(region "$SKILL" '6. **Write `project-map.md` at the project root**' '```markdown' | fold_text)"
MAP_STEP6_RULE='The session-start hook looks for it with `[ -f "project-map.md" ]` in the folder where the session was started (Claude Code gives that folder to hooks as `CLAUDE_PROJECT_DIR`; a Bash command cannot read this variable) — if it'"'"'s anywhere else, the hook cannot find it and every future session loses the map.'
OLD_MAP_CONDITION='when Claude Code sets that variable'
MAP_SIZE="$(region "$SKILL" 'Keep `project-map.md` under 150 lines.' '## Guardrails' | fold_text)"
MAP_SIZE_RULE='The session-start hook injects the map only when it fits in the room that the rest of its output leaves, because the map comes last in the hook'"'"'s order of memory sections; a larger map is not injected, and step 6 of the using-superpowers entry sequence reads it from the file.'
OLD_MAP_LOOKUP="${BT}ls project-map.md"
PROBLEMS=''
case "$MAP_STEP6" in *"$MAP_STEP6_RULE"*) ;; *) problem "missing in step 6 of the map procedure" ;; esac
check "step 6 of the map procedure holds: $MAP_STEP6_RULE" "$PROBLEMS"
PROBLEMS=''
case "$MAP_SIZE" in *"$MAP_SIZE_RULE"*) ;; *) problem "missing after the size rule" ;; esac
check "the size rule of the map holds: $MAP_SIZE_RULE" "$PROBLEMS"
for old in "$OLD_MAP_LOOKUP" "$OLD_MAP_CONDITION"; do
  PROBLEMS=''
  case "$(fold_text < "$SKILL")" in *"$old"*) problem "found" ;; esac
  check "the skill no longer says: $old" "$PROBLEMS"
done

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
ROUTE="$(route 'unarchive the session log')"
PROBLEMS=''
[ "$ROUTE" != context-management ] || problem "ranked first: $ROUTE"
check "the prompt \"unarchive the session log\" does not route to context-management" "$PROBLEMS"

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
exit 0
