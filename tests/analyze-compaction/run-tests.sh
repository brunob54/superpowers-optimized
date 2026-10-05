#!/usr/bin/env bash
# analyze-compaction test suite: unit tests on tools/analyze-compaction.js,
# the script that reads one session transcript and reports what the session
# did right after each context compaction (the compaction probe of
# tests/claude-code/compaction-probe.md judges its verdict from this output).
# Pure bash + node; no claude invocation.
# Windows note: never reads standard input through its device path and uses
# no process substitution (neither is reliable in Git Bash on Windows) —
# everything goes through temp files.
#
# The fixture `fixtures/compaction.jsonl` is hand-built (19 records, indexes
# 0 to 18): a Skill call and its injection, an automatic compaction with its
# summary and re-attachments, then the reads and writes the guard asks for in
# every form the tool must recognise (a grep of the headings, a Read cut by a
# notice in the result text, a Read cut by a notice that comes as a separate
# attachment record, a sed read of a range, a ruling appended by a Bash
# heredoc, an Agent dispatch, a ruling written by Edit and one by Write), and
# finally a manual compaction with nothing after it. One requestId is written
# twice so the deduplication of API calls is exercised.
# The fixture `fixtures/edge-cases.jsonl` holds a `null` line, a blank line
# and two records without a `message` field.
# The fixture `fixtures/redirect-targets.jsonl` holds one compaction and then
# 33 Bash calls. Each call is one form of a redirect target, of a variable
# assignment or of a heredoc. Section 8 names the form of each call and says
# whether the tool must mark it as a log write. Every call except 24 holds
# one heading; only the headings of the marked calls are collected.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/tools/analyze-compaction.js"
FIX="$ROOT/tests/analyze-compaction/fixtures"
FIXTURE="$FIX/compaction.jsonl"
FIX_EDGE="$FIX/edge-cases.jsonl"
FIX_REDIRECT="$FIX/redirect-targets.jsonl"
MARK_LOG_WRITE=' <-- ruling/log write'
# What call_mark prints.
MARKED=marked
UNMARKED=unmarked

# The fixture's hand-chosen figures.
EXP_RECORDS=19
EXP_DISTINCT_REQUESTS=9
EXP_TOOL_USE=9
EXP_COMPACTIONS=2
EXP_INJECTION_LINE='Skill injections: 1 (record 1: 77 bytes)'
EXP_INVOKED_TOTAL='invoked_skills attachments in the whole file: 1'
EXP_COMPACTION_1='record 2  16:00:00  trigger=auto  preTokens=100000  postTokens=20000'
EXP_COMPACTION_2='record 18  17:40:00  trigger=manual  preTokens=66000  postTokens=14000'
EXP_SUMMARY_1='summary (record 3): Summary: the re-read of Phase 4 was already done.'
EXP_SUMMARY_2='summary (none found): '
EXP_REATTACHED_SKILLS='re-attached invoked_skills: 1 (orchestrating-development 122 chars)'
EXP_REATTACHED_HOOK='re-attached hook_success: 1 (SessionStart:compact stdout 40 chars)'
EXP_REATTACHED_CONTEXT='re-attached hook_additional_context: 0'
# The eight tool calls between the two compactions, one output line each.
EXP_LIST_HEADER='next 8 tool calls:'
EXP_GREP="  1. Bash grep -n '^## ' /x/skills/orchestrating-development/SKILL.md <-- grep '^## '"
EXP_READ_TEXT_NOTICE='  2. Read orchestrating-development/SKILL.md (offset=843, limit=400) <-- PARTIAL'
EXP_READ_ATTACHMENT_NOTICE='  3. Read orchestrating-development/SKILL.md (offset=1101, limit=142) <-- PARTIAL'
# The sed command is 151 characters long: the tool keeps the first 100, then
# " … ", then the last 40, so the file name stays visible.
EXP_SED="  4. Bash sed -n '1201,1243p' /home/user/.claude/plugins/cache/superpowers-orchestrator/superpowers-orchestrat … kills/orchestrating-development/SKILL.md <-- SKILL.md sed 1201-1243"
EXP_HEREDOC="  5. Bash cat >> /x/docs/orchestration-log.md <<'EOF'\\n## RULING 1 — phase 4\\nEOF$MARK_LOG_WRITE"
EXP_AGENT='  6. Agent fork-1 — Fork 1 <-- Agent dispatch'
EXP_EDIT="  7. Edit orchestration-log.md$MARK_LOG_WRITE"
EXP_WRITE="  8. Write open-decisions.md$MARK_LOG_WRITE"
EXP_NOTHING_AFTER='  (no tool calls after this compaction)'
EXP_HEADINGS='RULING/STOPPED headings written: 3 — rec 14: ## RULING 1 — phase 4; rec 16: ## RULING 2 — phase 4; rec 17: ## STOPPED — probe'
OLD_AGENT_STOP='(list ended at an Agent dispatch)'
# Call 1 is the Skill call at record 0; call 2 is the grep at record 6, the
# first API call after compaction 1, so the C column marks it. Its context is
# 10 + 1000 + 5 tokens.
EXP_C_ROW='    2 C  rec    6  16:02:00  ctx    1015  Bash'
EXP_USAGE='usage: node tools/analyze-compaction.js <transcript.jsonl> [--after N]'
EXP_AFTER_ERROR='--after needs a positive integer'
# The redirect-targets fixture: 33 calls, and the 19 headings of calls 1 to 6,
# 12 to 21, 26, 27 and 31 (call N is record N). The headings of the unmarked
# calls must not be collected.
EXP_REDIRECT_LIST_HEADER='next 33 tool calls:'
# More than the 33 calls, so the default cap of 30 listed calls hides none.
REDIRECT_AFTER=40
EXP_REDIRECT_HEADINGS='RULING/STOPPED headings written: 19 — '\
'rec 1: ## RULING 1 — double quotes; rec 2: ## RULING 2 — single quotes; '\
'rec 3: ## RULING 3 — variable; rec 4: ## STOPPED — braces; '\
'rec 5: ## RULING 4 — new line; rec 6: ## RULING 5 — semicolon; '\
'rec 12: ## RULING 11 — substitution in a value; rec 13: ## RULING 12 — substitution in a target; '\
'rec 14: ## RULING 13 — variable directory; rec 15: ## STOPPED — overwrite; '\
'rec 16: ## RULING 14 — ampersand; rec 17: ## RULING 15 — comment; '\
'rec 18: ## RULING 16 — or; rec 19: ## RULING 17 — two assignments; '\
'rec 20: ## RULING 18 — continued line; rec 21: ## RULING 19 — after an unclosed operator; '\
'rec 26: ## RULING 23 — after an empty delimiter; rec 27: ## RULING 24 — parenthesis in quotes; '\
'rec 31: ## RULING 28 — nested substitution'

PASS=0
FAIL=0
ERRORS=()
WORK="$(mktemp -d)"
: "${WORK:?mktemp failed — refusing to run with an empty work path}"
trap 'rm -rf "$WORK"' EXIT
OUTF="$WORK/stdout.txt"
ERRF="$WORK/stderr.txt"
STATUS=0

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

ok()  { green "  PASS: $1"; PASS=$((PASS+1)); }
bad() { red "  FAIL: $1"; ERRORS+=("$1"); FAIL=$((FAIL+1)); }

assert_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi
}
assert_file_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}
assert_file_has_line() { # desc file line (the whole line, byte-exact)
  if grep -qxF -- "$3" "$2"; then ok "$1"; else bad "$1 (no such line: $3)"; fi
}
assert_file_not_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then bad "$1 (must not contain: $3)"; else ok "$1"; fi
}

run_text() { # transcript [args...]
  node "$SCRIPT" "$@" >"$OUTF" 2>"$ERRF"
  STATUS=$?
}

# Prints $MARKED when line N of the tool-call list in the last output ends
# with the ruling/log write mark, and $UNMARKED otherwise.
call_mark() { # call-number
  if grep -E "^  $1\\. " "$OUTF" | grep -q -- "$MARK_LOG_WRITE\$"; then echo "$MARKED"; else echo "$UNMARKED"; fi
}

bold "1. Header figures"
run_text "$FIXTURE"
assert_eq "exits 0 on a readable transcript" "$STATUS" "0"
assert_file_has_line "records are counted" "$OUTF" "records: $EXP_RECORDS"
assert_file_has_line "API calls are deduplicated on requestId" "$OUTF" "distinct API calls (requestIds): $EXP_DISTINCT_REQUESTS"
assert_file_has_line "tool_use blocks are counted" "$OUTF" "assistant tool_use blocks: $EXP_TOOL_USE"
assert_file_has_line "compactions are counted" "$OUTF" "compactions: $EXP_COMPACTIONS"
assert_file_has_line "a Skill injection is measured in bytes" "$OUTF" "$EXP_INJECTION_LINE"
assert_file_has_line "invoked_skills attachments are counted over the whole file" "$OUTF" "$EXP_INVOKED_TOTAL"
assert_file_has_line "the first API call after a compaction carries the C mark" "$OUTF" "$EXP_C_ROW"

bold "2. Compaction blocks: trigger, token figures, summary, re-attachments"
assert_file_has_line "compaction 1 is automatic with its token figures" "$OUTF" "$EXP_COMPACTION_1"
assert_file_has_line "compaction 2 is manual with its token figures" "$OUTF" "$EXP_COMPACTION_2"
assert_file_has_line "the summary text is previewed with its record index" "$OUTF" "$EXP_SUMMARY_1"
assert_file_has_line "a compaction without a summary says so" "$OUTF" "$EXP_SUMMARY_2"
assert_file_has_line "the re-attached skill is named by its base directory with its length" "$OUTF" "$EXP_REATTACHED_SKILLS"
assert_file_has_line "the re-run hook is listed with its stdout length" "$OUTF" "$EXP_REATTACHED_HOOK"
assert_file_has_line "no hook_additional_context is reported as 0" "$OUTF" "$EXP_REATTACHED_CONTEXT"
assert_file_has_line "compaction 2 has nothing after it" "$OUTF" "$EXP_NOTHING_AFTER"

bold "3. The tool-call list after compaction 1: every mark, no early stop"
assert_file_has_line "all eight calls up to the next compaction are listed" "$OUTF" "$EXP_LIST_HEADER"
assert_file_has_line "the grep of section headings is marked" "$OUTF" "$EXP_GREP"
assert_file_has_line "a Read cut by a notice in the result text is marked PARTIAL" "$OUTF" "$EXP_READ_TEXT_NOTICE"
assert_file_has_line "a Read cut by a read_truncation_notice attachment is marked PARTIAL" "$OUTF" "$EXP_READ_ATTACHMENT_NOTICE"
assert_file_has_line "a sed read of SKILL.md keeps the file name and is marked with its range" "$OUTF" "$EXP_SED"
assert_file_has_line "a ruling appended by a Bash heredoc is marked" "$OUTF" "$EXP_HEREDOC"
assert_file_has_line "an Agent call is marked and does not end the list" "$OUTF" "$EXP_AGENT"
assert_file_has_line "a ruling written by Edit after the dispatch is listed and marked" "$OUTF" "$EXP_EDIT"
assert_file_has_line "a ruling written by Write after the dispatch is listed and marked" "$OUTF" "$EXP_WRITE"
assert_file_not_contains "the list no longer stops at an Agent dispatch" "$OUTF" "$OLD_AGENT_STOP"

bold "4. Headings: heredoc, Edit and Write rulings are all collected"
assert_file_has_line "three headings with their record indexes" "$OUTF" "$EXP_HEADINGS"

bold "5. --after N caps the list"
run_text "$FIXTURE" --after 2
assert_eq "exits 0" "$STATUS" "0"
assert_file_has_line "two calls are listed" "$OUTF" "next 2 tool calls:"
assert_file_not_contains "the third call is not listed" "$OUTF" "  3. Read"

bold "6. Records that must not crash the tool"
run_text "$FIX_EDGE"
assert_eq "a null line, a blank line and records without message exit 0" "$STATUS" "0"
assert_eq "no stack trace on stderr" "$(grep -c '^    at ' "$ERRF")" "0"
assert_file_has_line "the compaction after them is still counted" "$OUTF" "compactions: 1"

bold "7. Argument and file errors are one-line messages"
run_text "$WORK/no-such-transcript.jsonl"
assert_eq "a missing file exits 1" "$STATUS" "1"
assert_eq "a missing file prints one line on stderr" "$(wc -l <"$ERRF" | tr -d ' ')" "1"
assert_eq "a missing file prints no stack trace" "$(grep -c '^    at ' "$ERRF")" "0"
run_text
assert_eq "no argument exits 1" "$STATUS" "1"
assert_file_has_line "no argument prints the usage line" "$ERRF" "$EXP_USAGE"
run_text "$FIXTURE" --after 0
assert_eq "--after 0 exits 1" "$STATUS" "1"
assert_file_has_line "--after 0 names the rule" "$ERRF" "$EXP_AFTER_ERROR"

bold "8. Redirect targets in quotes or in a variable"
run_text "$FIX_REDIRECT" --after "$REDIRECT_AFTER"
assert_eq "exits 0" "$STATUS" "0"
assert_file_has_line "all 33 calls are listed" "$OUTF" "$EXP_REDIRECT_LIST_HEADER"
assert_eq "a target in double quotes is marked" "$(call_mark 1)" "$MARKED"
assert_eq "a target in single quotes is marked" "$(call_mark 2)" "$MARKED"
assert_eq "\$L assigned before && is marked" "$(call_mark 3)" "$MARKED"
assert_eq "\${D} assigned a quoted value before ; is marked" "$(call_mark 4)" "$MARKED"
assert_eq "\"\${LOG}\" assigned on the line before is marked" "$(call_mark 5)" "$MARKED"
assert_eq "a quoted target followed directly by ; is marked" "$(call_mark 6)" "$MARKED"
assert_eq "a variable assigned in another call stays unmarked" "$(call_mark 7)" "$UNMARKED"
assert_eq "a command substitution that makes the file name stays unmarked" "$(call_mark 8)" "$UNMARKED"
assert_eq "an assignment that is only a command prefix stays unmarked" "$(call_mark 9)" "$UNMARKED"
assert_eq "a variable name in single quotes stays unmarked" "$(call_mark 10)" "$UNMARKED"
assert_eq "a variable assigned after the redirect stays unmarked" "$(call_mark 11)" "$UNMARKED"
assert_eq "an assigned value that starts with an unquoted \$(...) is marked" "$(call_mark 12)" "$MARKED"
assert_eq "an unquoted target that starts with \$(...) is marked" "$(call_mark 13)" "$MARKED"
assert_eq "a target \$R/<log file name> is marked" "$(call_mark 14)" "$MARKED"
assert_eq "a single > into a log file is marked" "$(call_mark 15)" "$MARKED"
assert_eq "a target followed directly by && is marked" "$(call_mark 16)" "$MARKED"
assert_eq "an assignment followed by a # comment is marked" "$(call_mark 17)" "$MARKED"
assert_eq "an assignment followed by || is marked" "$(call_mark 18)" "$MARKED"
assert_eq "an assignment followed by a second assignment and ; is marked" "$(call_mark 19)" "$MARKED"
assert_eq "an assignment followed by a backslash and a new line is marked" "$(call_mark 20)" "$MARKED"
assert_eq "a heredoc after a quoted <<EOF that never closes is marked" "$(call_mark 21)" "$MARKED"
assert_eq "L assigned a log path and then another file stays unmarked" "$(call_mark 22)" "$UNMARKED"
assert_eq "a log write that is only text in a heredoc body stays unmarked" "$(call_mark 23)" "$UNMARKED"
assert_eq "a commit message heredoc inside \"\$(...)\" that names the log stays unmarked" "$(call_mark 24)" "$UNMARKED"
assert_eq "two assignments that are only command prefixes stay unmarked" "$(call_mark 25)" "$UNMARKED"
assert_eq "an empty delimiter after '<<' does not hide the next heredoc" "$(call_mark 26)" "$MARKED"
assert_eq "a ) inside quotes does not close a \$(...)" "$(call_mark 27)" "$MARKED"
assert_eq "a prefix assignment before an assignment on a later line stays unmarked" "$(call_mark 28)" "$UNMARKED"
assert_eq "an assignment followed by a single & stays unmarked" "$(call_mark 29)" "$UNMARKED"
assert_eq "an assignment followed by a single | stays unmarked" "$(call_mark 30)" "$UNMARKED"
assert_eq "a \$(...) inside a \$(...) is read to its outer )" "$(call_mark 31)" "$MARKED"
assert_eq "a <<-EOF body closed by <tab>EOF stays unmarked" "$(call_mark 32)" "$UNMARKED"
assert_eq "a <<EOF body that holds a <tab>EOF line stays unmarked" "$(call_mark 33)" "$UNMARKED"
assert_file_has_line "the headings of the marked calls, and only those, are collected" "$OUTF" "$EXP_REDIRECT_HEADINGS"

echo
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
exit 0
