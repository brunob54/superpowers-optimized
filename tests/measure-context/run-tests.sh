#!/usr/bin/env bash
# measure-context test suite: unit tests on tools/measure-context.js, the
# committed script that takes the acceptance measure of worklist row 13 fix 1
# (docs/orchestration-issues.md, Cases 017 and 018). Pure bash + node; no
# claude invocation.
# Windows note: never reads standard input through its device path and uses
# no process substitution (neither is reliable in Git Bash on Windows) —
# everything goes through temp files.
#
# The fixture `fixtures/synthetic.jsonl` is built so that every class holds a
# different, hand-chosen number of bytes, and so that one requestId is written
# three times with the same usage object. That repetition is the counting trap
# the script exists to avoid: a naive sum over records overcounts tokens by 3
# to 5 times on a real transcript.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/tools/measure-context.js"
FIX="$ROOT/tests/measure-context/fixtures"
FIXTURE="$FIX/synthetic.jsonl"
# Row 27 fixtures (see the comment before section 7).
FIX_PAGED_TO_END="$FIX/read-paged-to-end.jsonl"
FIX_PAGED_SHORT="$FIX/read-paged-short.jsonl"
FIX_NOT_PAGED="$FIX/read-not-paged.jsonl"
FIX_CAT_GAPS="$FIX/cat-persisted-gaps.jsonl"
FIX_SKILL="$FIX/skill-call.jsonl"
FIX_OPEN_RANGE="$FIX/open-range.jsonl"
FIX_CAT_THEN_READ="$FIX/cat-then-read-cut.jsonl"
# The on-disk fixture reads two real files from the fixtures directory, so
# the template's @@FIX@@ is replaced with that directory at run time.
FIX_ON_DISK_TEMPLATE="$FIX/pipeline-on-disk.template.jsonl"
# Review finding 14 fixtures (see the comment before section 18). The two
# templates name files that the suite writes at run time, so their @@FIX@@
# is replaced with a directory under the work path.
FIX_AT_READ_TIME_TEMPLATE="$FIX/total-at-read-time.template.jsonl"
FIX_FAILED_RESULTS="$FIX/failed-results.jsonl"
FIX_READ_REFUSED="$FIX/read-refused.jsonl"
FIX_PERSISTED_COPY_TEMPLATE="$FIX/persisted-copy.template.jsonl"
FIX_CHANGED_DURING_SESSION="$FIX/changed-during-session.jsonl"
FIX_LAST_LINE_NOT_SHOWN="$FIX/last-line-not-shown.jsonl"
FIX_FAILED_BASH="$FIX/failed-bash.jsonl"
# The labels of a total that does not come from a Read record.
SOURCE_DISK_TODAY="counted on disk today"
SOURCE_PERSISTED_COPY="counted on the persisted copy"
SOURCE_NOTICE="from a PARTIAL notice"
SOURCE_READ_RESULT="from a Read result"

# The fixture's hand-chosen byte counts, by class.
EXP_AGENT_PROMPTS=100
EXP_FILL_COMMANDS=48
EXP_VALUE_FILES=50
EXP_OTHER_WRITES=30
EXP_BASH_COMMANDS=20
EXP_READ_RESULTS=40
EXP_BASH_RESULTS=25
EXP_AGENT_REPORTS=15
EXP_ATTACHMENTS=60
EXP_USER_MESSAGES=10
EXP_ASSISTANT_TEXT=12
EXP_CONTENT=459
EXP_PROMPT_MATERIAL=198
# The fixture holds three distinct requests, at 1110, 5000 and 2000 context
# tokens. The peak is the largest single request, never their sum (8110), and
# never inflated by the three records that repeat request 2.
EXP_PEAK=5000
EXP_ASSISTANT_RECORDS=5
EXP_DISTINCT_REQUESTS=3
EXP_SUM_OF_REQUESTS=8110
# The prompt-material line names its three components; the issues log cites it.
EXP_PROMPT_LINE='agent-prompts + fill-commands + value-files'

PASS=0
FAIL=0
ERRORS=()
WORK="$(mktemp -d)"
: "${WORK:?mktemp failed — refusing to run with an empty work path}"
trap 'rm -rf "$WORK"' EXIT
OUTF="$WORK/stdout.txt"
ERRF="$WORK/stderr.txt"
JSONF="$WORK/measure.json"
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

# Read one field out of the JSON report with node, so the test never parses
# JSON with grep.
field() { # dotted-path
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = process.argv[2].split(".").reduce((o, k) => (o === undefined ? o : o[k]), data);
    process.stdout.write(String(value));
  ' "$JSONF" "$1"
}

run_json() { # transcript
  node "$SCRIPT" "$1" --json >"$JSONF" 2>"$ERRF"
  STATUS=$?
}
run_text() { # transcript
  node "$SCRIPT" "$1" >"$OUTF" 2>"$ERRF"
  STATUS=$?
}

# Write a transcript from a template: every @@FIX@@ becomes the directory, so
# that the transcript names files that exist on disk at run time.
fill_template() { # template directory out
  node -e '
    const fs = require("fs");
    const [template, directory, out] = process.argv.slice(1);
    const dir = JSON.stringify(directory).slice(1, -1);
    fs.writeFileSync(out, fs.readFileSync(template, "utf8").split("@@FIX@@").join(dir));
  ' "$1" "$2" "$3"
}

# Write a file of COUNT lines, "<word> 1" to "<word> COUNT", with a final
# newline. The directory of the file is created when it is missing.
write_lines() { # file count word
  node -e '
    const fs = require("fs");
    const path = require("path");
    const [file, count, word] = process.argv.slice(1);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Array.from({ length: Number(count) }, (_, i) => `${word} ${i + 1}\n`).join(""));
  ' "$1" "$2" "$3"
}

bold "1. The script runs on the fixture and reports every class"
run_json "$FIXTURE"
assert_eq "exits 0 on a readable transcript" "$STATUS" "0"
assert_eq "agent-prompts counts the Agent tool's prompt field" "$(field totals.agent-prompts)" "$EXP_AGENT_PROMPTS"
assert_eq "fill-commands counts a Bash command that fills a template" "$(field totals.fill-commands)" "$EXP_FILL_COMMANDS"
assert_eq "value-files counts a Write to a dispatch-<k>- file" "$(field totals.value-files)" "$EXP_VALUE_FILES"
assert_eq "other-writes counts a Write to any other path" "$(field totals.other-writes)" "$EXP_OTHER_WRITES"
assert_eq "bash-commands counts a Bash command that is not a fill" "$(field totals.bash-commands)" "$EXP_BASH_COMMANDS"
assert_eq "read-results are attributed to the Read tool by tool_use_id" "$(field totals.read-results)" "$EXP_READ_RESULTS"
assert_eq "bash-results are attributed to the Bash tool by tool_use_id" "$(field totals.bash-results)" "$EXP_BASH_RESULTS"
assert_eq "agent-reports are attributed to the Agent tool by tool_use_id" "$(field totals.agent-reports)" "$EXP_AGENT_REPORTS"
assert_eq "attachments count the harness attachment records" "$(field totals.attachments)" "$EXP_ATTACHMENTS"
assert_eq "user-messages count a plain string message" "$(field totals.user-messages)" "$EXP_USER_MESSAGES"
assert_eq "assistant-text counts the model's own prose" "$(field totals.assistant-text)" "$EXP_ASSISTANT_TEXT"

bold "2. The classes are a partition: they sum to the reported content"
assert_eq "content equals the sum of every class" "$(field content)" "$EXP_CONTENT"
SUM="$(node -e '
  const fs = require("fs");
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(Object.values(d.totals).reduce((a, b) => a + b, 0)));
' "$JSONF")"
assert_eq "the class totals add up to content, with nothing uncounted" "$SUM" "$EXP_CONTENT"

bold "3. Prompt material is the three dispatch classes and nothing else"
assert_eq "prompt material is agent-prompts + fill-commands + value-files" "$(field promptMaterial)" "$EXP_PROMPT_MATERIAL"
PCT="$(node -e '
  const fs = require("fs");
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(d.promptMaterialPercent.toFixed(2));
' "$JSONF")"
assert_eq "the percentage is prompt material over content" "$PCT" "43.14"

bold "4. Token figures deduplicate on requestId — the counting trap"
assert_eq "the fixture really repeats one request across records" "$(field assistantRecords)" "$EXP_ASSISTANT_RECORDS"
assert_eq "distinct requests are counted, not records" "$(field distinctRequests)" "$EXP_DISTINCT_REQUESTS"
assert_eq "peak context is the largest single request" "$(field peakTokens)" "$EXP_PEAK"
# The two numbers the peak must never be: the sum of the distinct requests, and
# anything inflated by the repeated records.
if [ "$(field peakTokens)" = "$EXP_SUM_OF_REQUESTS" ]; then
  bad "peak context must not be the sum of the requests"
else
  ok "peak context is not the sum of the requests"
fi

bold "5. The report names the units and the limits it works under"
run_text "$FIXTURE"
assert_eq "the text report exits 0" "$STATUS" "0"
assert_file_contains "the report says the peak is a maximum, not a sum" "$OUTF" 'a maximum over requests, never a sum'
assert_file_contains "the report says the token figures are deduplicated" "$OUTF" 'deduplicated on requestId'
assert_file_contains "the report names the prompt-material components" "$OUTF" "$EXP_PROMPT_LINE"
# Thinking text is not stored in a transcript (only its signature), so its
# bytes are missing from content and every share is an upper bound. A reader
# who is told this cannot mistake a share for an exact figure.
assert_file_contains "the report warns that thinking text is not stored" "$OUTF" 'thinking blocks carry a signature'
assert_file_contains "the report states the direction of that error" "$OUTF" 'upper bound'

bold "6. Bad input fails loudly, never silently"
run_json "$WORK/does-not-exist.jsonl"
assert_eq "a missing transcript exits 2" "$STATUS" "2"
assert_file_contains "a missing transcript names itself" "$ERRF" 'no such transcript'
node "$SCRIPT" >"$OUTF" 2>"$ERRF"; STATUS=$?
assert_eq "no argument exits 2" "$STATUS" "2"
assert_file_contains "no argument prints the usage line" "$ERRF" 'usage: node tools/measure-context.js'

# --- Worklist row 27: file coverage over both hand-over routes, PARTIAL
# notices, the model-visible denominator, and the skill body.
#
# The Read route: a Read call returns at most about 25,000 tokens, then a
# notice "PARTIAL view — <path>: showing lines A-B of T total" names the
# next offset. The cat route: a Bash `cat <file>` whose output exceeds
# 30,000 characters is persisted to a file; the result holds a 2 KB
# preview and the persisted path, which the agent may read back in ranges.
#
# Line numbering: the Read tool counts the empty line after a file's final
# newline as a line, so its total is one more than sed or wc count. The
# fixtures whose total comes only from Read say "of 7 total" for six lines;
# the tool subtracts that line unless a page shows text on the last line.

# The PARTIAL notices line, from its counts. The count "end not proven" is
# zero when it is left out.
partial_line() { # count paged-to-end paged-short not-paged persisted [end-not-proven]
  printf 'PARTIAL notices: %s (paged to the end: %s, paged short: %s, end not proven: %s, not paged: %s; of these on a persisted output file: %s)' "$1" "$2" "$3" "${6:-0}" "$4" "$5"
}
# The PARTIAL notice counts of the JSON report.
assert_partial_notices() { # desc count paged-to-end paged-short not-paged persisted [end-not-proven]
  assert_eq "$1: count" "$(field partialNotices.count)" "$2"
  assert_eq "$1: paged to the end" "$(field partialNotices.pagedToEnd)" "$3"
  assert_eq "$1: paged short" "$(field partialNotices.pagedShort)" "$4"
  assert_eq "$1: not paged" "$(field partialNotices.notPaged)" "$5"
  assert_eq "$1: on a persisted output file" "$(field partialNotices.persistedThenRead)" "$6"
  assert_eq "$1: end not proven" "$(field partialNotices.endNotProven)" "${7:-0}"
}

# One row of the file coverage, from its five figures.
assert_coverage_row() { # desc index total source ranges percent last-line-reached
  assert_eq "$1: total lines" "$(field "fileCoverage.$2.totalLines")" "$3"
  assert_eq "$1: source of the total" "$(field "fileCoverage.$2.totalLinesSource")" "$4"
  assert_eq "$1: received ranges" "$(field "fileCoverage.$2.receivedRanges")" "$5"
  assert_eq "$1: coverage" "$(field "fileCoverage.$2.coveragePercent")" "$6"
  assert_eq "$1: last line reached" "$(field "fileCoverage.$2.lastLineReached")" "$7"
}

# How many lines of the text report hold a needle.
report_lines_with() { # needle
  grep -cF -- "$1" "$OUTF"
}

bold "7. Read route: a PARTIAL notice, then paged to the end by offset"
run_json "$FIX_PAGED_TO_END"
assert_eq "exits 0" "$STATUS" "0"
assert_partial_notices "one notice counted once, although it sits in an attachment and the Read result also says truncatedByTokenCap" 1 1 0 0 0
assert_eq "one file is listed: the one whose first read was cut" "$(field fileCoverage.length)" "1"
assert_eq "the listed file is the cut one" "$(field fileCoverage.0.path)" "/tmp/mc-fixture/big.md"
assert_eq "the first read's route is Read" "$(field fileCoverage.0.firstRoute)" "Read"
# The last page shows text on line 6, the Read total, so the file has no
# empty final line and the total stays 6.
assert_eq "total lines come from the notice, kept at 6 because the last page shows text on line 6" "$(field fileCoverage.0.totalLines)" "6"
assert_eq "the two pages are merged into one received range" "$(field fileCoverage.0.receivedRanges)" "1-6"
assert_eq "six lines were received" "$(field fileCoverage.0.receivedLines)" "6"
assert_eq "coverage is complete" "$(field fileCoverage.0.coveragePercent)" "100"
assert_eq "nothing is uncovered" "$(field fileCoverage.0.uncoveredRanges)" "none"
assert_eq "the last line was reached" "$(field fileCoverage.0.lastLineReached)" "true"
assert_eq "the small file read whole in one call is counted, not listed" "$(field fullyReceivedFiles)" "1"

bold "8. Read route: paged short by one line, the notice inside the tool result"
run_json "$FIX_PAGED_SHORT"
assert_partial_notices "a notice inside the tool_result text is found and classified as paged short" 1 0 1 0 0
assert_eq "the Read total of 7 is six real lines: no page showed line 7, so the empty final line is subtracted" "$(field fileCoverage.0.totalLines)" "6"
assert_eq "lines 1-5 of 6 were received" "$(field fileCoverage.0.receivedRanges)" "1-5"
assert_eq "coverage is five sixths" "$(field fileCoverage.0.coveragePercent)" "83.3"
assert_eq "the last line is the uncovered range" "$(field fileCoverage.0.uncoveredRanges)" "6"
assert_eq "the last line was not reached" "$(field fileCoverage.0.lastLineReached)" "false"
assert_eq "no file was fully received in one call" "$(field fullyReceivedFiles)" "0"

bold "9. Read route: not paged at all (a grep and a heredoc body are not reads of lines)"
run_json "$FIX_NOT_PAGED"
assert_partial_notices "the notice is classified as not paged" 1 0 0 1 0
# The fixture ends with `cat >> notes.md <<'EOF'` whose body mentions
# `sed -n '1,50p' <the cut file>`: data written by the command, not a read.
assert_eq "only the first page was received; the heredoc body is not a read" "$(field fileCoverage.0.receivedRanges)" "1-3"
assert_eq "coverage is one half" "$(field fileCoverage.0.coveragePercent)" "50"
assert_eq "lines 4-6 are uncovered" "$(field fileCoverage.0.uncoveredRanges)" "4-6"
assert_eq "the last line was not reached" "$(field fileCoverage.0.lastLineReached)" "false"

bold "10. cat route: a persisted cat, then sed ranges and a Read leaving gaps"
run_json "$FIX_CAT_GAPS"
assert_partial_notices "no PARTIAL notice exists on the cat route" 0 0 0 0 0
assert_eq "the file behind the persisted output is listed once" "$(field fileCoverage.length)" "1"
assert_eq "it is listed under its own path, not the persisted path" "$(field fileCoverage.0.path)" "/tmp/mc-fixture/body.md"
assert_eq "the first read's route is cat" "$(field fileCoverage.0.firstRoute)" "cat"
assert_eq "total lines come from the later Read of the persisted path, whose last page shows text on line 12" "$(field fileCoverage.0.totalLines)" "12"
# The preview holds two complete lines and a third cut in the middle; the
# sed ranges go through a shell variable that names the persisted path, one
# as two ranges in one expression (`5,6p;7p`), one as two `-e` expressions;
# the `grep | sed -n '1,2p'` filters grep output and receives no file lines;
# the Read of the persisted path is mapped back to the file.
assert_eq "preview lines, sed ranges and Read range are united" "$(field fileCoverage.0.receivedRanges)" "1-2, 5-8, 10-12"
assert_eq "nine lines were received" "$(field fileCoverage.0.receivedLines)" "9"
assert_eq "coverage is three quarters" "$(field fileCoverage.0.coveragePercent)" "75"
assert_eq "the gaps are named" "$(field fileCoverage.0.uncoveredRanges)" "3-4, 9"
assert_eq "the last line was reached by the Read" "$(field fileCoverage.0.lastLineReached)" "true"

bold "11. Skill body: the usage jump at the Skill call, and skill-directory reads"
run_json "$FIX_SKILL"
assert_eq "one Skill call is counted" "$(field skillBody.calls)" "1"
# The request that made the Skill call held 1000 context tokens; the next
# request held 5000. The jump is the skill body plus whatever else arrived
# with it, which is what the row asks for.
assert_eq "the skill body is the context growth from the Skill call's request to the next" "$(field skillBody.tokens)" "4000"
assert_eq "the Skill call is named" "$(field skillBody.perCall.0.skill)" "plug:foo"
assert_eq "one read under a /skills/ path is counted" "$(field skillDirectoryReads)" "1"

bold "12. Model-visible denominator: hook_success and prompt_snapshot are excluded"
# The fixture's attachments: hook_success 52 bytes, prompt_snapshot 52 bytes,
# one other attachment 30 bytes. Content over every record is 289 bytes.
assert_eq "the existing table still counts every attachment record" "$(field totals.attachments)" "134"
assert_eq "the existing content figure is unchanged" "$(field content)" "289"
assert_eq "the model-visible content excludes the two record kinds" "$(field modelVisible.content)" "185"
assert_eq "the model-visible attachments keep only what the model sees" "$(field modelVisible.totals.attachments)" "30"
assert_eq "the excluded hook_success bytes are reported" "$(field modelVisible.excluded.hook_success)" "52"
assert_eq "the excluded prompt_snapshot bytes are reported" "$(field modelVisible.excluded.prompt_snapshot)" "52"

bold "13. The text report prints the new lines in a fixed format"
run_text "$FIX_CAT_GAPS"
assert_eq "the text report exits 0" "$STATUS" "0"
assert_file_contains "the existing prompt-material line is still printed" "$OUTF" "$EXP_PROMPT_LINE"
assert_file_contains "the two share tables are labelled" "$OUTF" 'Shares over every record'
assert_file_contains "the model-visible table names what it excludes" "$OUTF" 'Model-visible shares (without hook_success and prompt_snapshot attachment records'
assert_file_contains "the PARTIAL notices summary line" "$OUTF" "$(partial_line 0 0 0 0 0)"
assert_file_contains "the file coverage heading" "$OUTF" 'File coverage (files whose first read was cut; lines received over both routes):'
assert_file_contains "one line per cut file" "$OUTF" '/tmp/mc-fixture/body.md | first read: cat, persisted | total lines: 12 (from a Read result) | received: 1-2, 5-8, 10-12 (9 lines) | coverage: 75.0% | uncovered: 3-4, 9 | last line reached: yes'
assert_file_contains "the count of files fully received in one call" "$OUTF" 'Files fully received in one call: 0'
run_text "$FIX_SKILL"
assert_file_contains "the skill body line" "$OUTF" 'Skill body: 4,000 tokens over 1 Skill call'
assert_file_contains "the skill-directory reads count" "$OUTF" 'skill-directory reads: 1'
run_text "$FIX_PAGED_TO_END"
assert_file_contains "a Read-route line names the notice and the source of the total" "$OUTF" '/tmp/mc-fixture/big.md | first read: Read, cut by a PARTIAL notice | total lines: 6 (from a PARTIAL notice) | received: 1-6 (6 lines) | coverage: 100.0% | uncovered: none | last line reached: yes'
assert_file_contains "the PARTIAL notices line counts the paged notice" "$OUTF" "$(partial_line 1 1 0 0 0)"
# Row 28: a file a controller never opened cannot appear in this list, so a
# maintainer checks that a named template was opened by reading the list.
assert_file_contains "the count of files fully received in one call is one" "$OUTF" 'Files fully received in one call: 1'
assert_file_has_line "each file received whole is listed on its own line under the count" "$OUTF" '    /tmp/mc-fixture/small.md'

bold "14. The original fixture is unchanged by the new sections"
run_json "$FIXTURE"
assert_partial_notices "no PARTIAL notice in the original fixture" 0 0 0 0 0
assert_eq "no cut file in the original fixture" "$(field fileCoverage.length)" "0"
assert_eq "no Skill call in the original fixture" "$(field skillBody.calls)" "0"
assert_eq "a string attachment is model-visible" "$(field modelVisible.content)" "$EXP_CONTENT"

bold "15. Pipelines and files on disk: cat | sed, awk patterns, head caps, cd, tail"
# The template names two real files under the fixtures directory, so the
# total comes from the file on disk (the persisted copies do not exist).
ON_DISK="$WORK/pipeline-on-disk.jsonl"
fill_template "$FIX_ON_DISK_TEMPLATE" "$FIX" "$ON_DISK"
run_json "$ON_DISK"
assert_eq "exits 0" "$STATUS" "0"
assert_eq "two cut files are listed" "$(field fileCoverage.length)" "2"
# six-lines.txt: a persisted cat (one complete preview line), then
# `cat FILE | sed -n '2,3p'`: the range of the second pipe segment applies
# to the file named in the first, so 3 of 6 lines were received.
assert_eq "six-lines: total lines are counted on disk" "$(field fileCoverage.0.totalLines)" "6"
assert_eq "six-lines: the total's source is the disk, and the label says that the count is today's" "$(field fileCoverage.0.totalLinesSource)" "$SOURCE_DISK_TODAY"
assert_eq "six-lines: no pattern range was resolved, so no source is named for one" "$(field fileCoverage.0.patternRangesSource)" "null"
assert_eq "six-lines: cat | sed receives the sed range of the file, not the whole file" "$(field fileCoverage.0.receivedRanges)" "1-3"
assert_eq "six-lines: coverage is one half" "$(field fileCoverage.0.coveragePercent)" "50"
assert_eq "six-lines: the last line was not reached" "$(field fileCoverage.0.lastLineReached)" "false"
# sections.txt (10 lines, headings at 2, 6 and 9): preview line 1;
# `awk '/^## A/,/^## B/' | head -2` gives 2-3 (the pattern range 2-6 capped
# by head); `cd <dir> && sed -n '/^## B/,/b2/p' sections.txt` gives 6-8 (the
# relative name resolves through cd; the record has no cwd);
# `awk 'NR>=5 && NR<=5'` gives 5; `tail -n +9 | head -1` gives 9;
# `tail -n 1` gives 10 (its position needs the on-disk total).
assert_eq "sections: total lines are counted on disk" "$(field fileCoverage.1.totalLines)" "10"
assert_eq "sections: pattern ranges, head caps, cd, awk NR and both tail forms are united" "$(field fileCoverage.1.receivedRanges)" "1-3, 5-10"
assert_eq "sections: coverage is nine tenths" "$(field fileCoverage.1.coveragePercent)" "90"
assert_eq "sections: line 4 is the only gap" "$(field fileCoverage.1.uncoveredRanges)" "4"
assert_eq "sections: the last line was reached" "$(field fileCoverage.1.lastLineReached)" "true"
assert_eq "sections: the pattern ranges are resolved on the file as it is on disk today, and the row says so" "$(field fileCoverage.1.patternRangesSource)" "on disk today"
run_text "$ON_DISK"
assert_file_contains "sections: the text report names the source of the pattern ranges beside the received lines" "$OUTF" 'received: 1-3, 5-10 (9 lines; pattern ranges resolved on disk today)'

bold "16. An open range (awk 'NR>=N') after a notice counts as paging"
run_json "$FIX_OPEN_RANGE"
assert_eq "the Read total of 7 is six real lines" "$(field fileCoverage.0.totalLines)" "6"
assert_eq "the open range runs to the end of the file" "$(field fileCoverage.0.receivedRanges)" "1-6"
assert_eq "coverage is complete" "$(field fileCoverage.0.coveragePercent)" "100"
assert_partial_notices "the notice is classified as paged to the end although the only later read is an open range" 1 1 0 0 0

bold "17. A persisted cat, then a Read of the persisted path that is cut"
run_json "$FIX_CAT_THEN_READ"
assert_eq "the file is listed under its own path" "$(field fileCoverage.0.path)" "/tmp/mc-fixture/body.md"
assert_eq "the first read's route is cat" "$(field fileCoverage.0.firstRoute)" "cat"
# The preview ends exactly on a newline: both lines are complete.
assert_eq "a preview cut exactly on a newline keeps both complete lines" "$(field fileCoverage.0.events.0)" "cat persisted (2 complete preview lines) -> 1-2"
# The last page shows line 7 empty: the Read total of 7 is six real lines.
assert_eq "the empty final line shown by the last page is subtracted from the total" "$(field fileCoverage.0.totalLines)" "6"
assert_eq "coverage is complete" "$(field fileCoverage.0.coveragePercent)" "100"
assert_eq "the last line was reached" "$(field fileCoverage.0.lastLineReached)" "true"
assert_partial_notices "the notice on the persisted copy is paged to the end and counted as persisted-then-read" 1 1 0 0 1

# --- Review finding 14: the total line count of a file is the one the
# transcript states, and a failed Read delivers no line.
#
# A Read record states the total of the file at the time of the read
# (`toolUseResult.file.totalLines`, and the "of T total" of a PARTIAL
# notice). The file on disk today can be longer or shorter, so its count is
# only the fallback, and the report then labels it "counted on disk today".
# A tool result with `is_error: true` on a Read call delivered no line. A
# Read that the tool refused for the size of the file is a cut first read
# with no line received. On a Bash call `is_error` is the exit status of the
# whole command, so a `cat` inside a failed command still counts.

bold "18. The total at the time of the read comes before the file on disk today"
# The files as they are today. The transcript read grew.txt when it had 100
# lines and shrank.txt when it had 300; deleted.txt is not written at all.
THEN_DIR="$WORK/at-read-time"
write_lines "$THEN_DIR/grew.txt" 300 line
write_lines "$THEN_DIR/shrank.txt" 100 line
write_lines "$THEN_DIR/no-total.txt" 100 line
write_lines "$THEN_DIR/refused.txt" 100 line
write_lines "$THEN_DIR/whole.txt" 300 line
write_lines "$THEN_DIR/refused-then-page.txt" 300 line
AT_READ_TIME="$WORK/total-at-read-time.jsonl"
fill_template "$FIX_AT_READ_TIME_TEMPLATE" "$THEN_DIR" "$AT_READ_TIME"
run_json "$AT_READ_TIME"
assert_eq "exits 0" "$STATUS" "0"
assert_eq "six cut files are listed" "$(field fileCoverage.length)" "6"
# grew.txt: a notice "1-50 of 101 total", then a page 51-101 whose last line
# is the empty line 101. The Read total of 101 is 100 real lines, all received.
assert_coverage_row "a file that grew after it was paged to the end" 0 100 "$SOURCE_NOTICE" "1-100" 100 true
# shrank.txt: a notice "1-100 of 301 total", then a page 101-150.
assert_coverage_row "a file that became shorter after half of it was read" 1 300 "$SOURCE_NOTICE" "1-150" 50 false
assert_coverage_row "a file that no longer exists" 2 100 "$SOURCE_NOTICE" "1-80" 80 false
# no-total.txt: the Read record is cut but states no total, and no notice
# states one, so the count on disk is the only source.
assert_coverage_row "a cut Read record without a total falls back to the disk" 3 100 "$SOURCE_DISK_TODAY" "1-50" 50 false
# refused.txt: the Read was refused for size and nothing was read afterwards.
assert_coverage_row "a refused Read with no later read, the file still on disk" 4 100 "$SOURCE_DISK_TODAY" "none" 0 false
# refused-then-page.txt: refused, then a page 1-50 whose record states 101
# total. No notice states a total, and the file has 300 lines today.
assert_coverage_row "the total of a Read record, without a notice, comes before the disk" 5 100 "$SOURCE_READ_RESULT" "1-50" 50 false
assert_partial_notices "each notice is classified on the total of its own record" 4 1 2 1 0
assert_eq "a file read whole in one call stays counted as fully received, whatever its length today" "$(field fullyReceivedFiles)" "1"
run_text "$AT_READ_TIME"
assert_eq "the label of today's disk count is printed on the two fallback rows only" "$(report_lines_with "$SOURCE_DISK_TODAY")" "2"
assert_file_contains "a row with a total from the record names that source" "$OUTF" "grew.txt | first read: Read, cut by a PARTIAL notice | total lines: 100 ($SOURCE_NOTICE) | received: 1-100 (100 lines) | coverage: 100.0% | uncovered: none | last line reached: yes"
assert_file_contains "a fallback row carries the label" "$OUTF" "no-total.txt | first read: Read, cut by a PARTIAL notice | total lines: 100 ($SOURCE_DISK_TODAY) | received: 1-50 (50 lines) | coverage: 50.0%"
assert_file_contains "a refused Read with the file on disk is a row at zero percent" "$OUTF" "refused.txt | first read: Read, refused for size | total lines: 100 ($SOURCE_DISK_TODAY) | received: none (0 lines) | coverage: 0.0% | uncovered: 1-100 | last line reached: no"

bold "19. A failed Read delivers no line; a cat inside a failed Bash command still counts"
run_json "$FIX_FAILED_RESULTS"
assert_eq "exits 0" "$STATUS" "0"
# missing.md: one Read that failed (the file does not exist). later.md: the
# same failure, then a Read that is cut. small.md: `cat small.md; ls absent`
# ends with exit status 1 because of the `ls`, after the cat printed the file.
assert_eq "the file whose failed Read was followed by a cut Read is the only row" "$(field fileCoverage.length)" "1"
assert_eq "the row is that file" "$(field fileCoverage.0.path)" "/tmp/mc-fixture/later.md"
assert_coverage_row "the failed Read is not the first read, so the cut Read is" 0 6 "$SOURCE_NOTICE" "1-3" 50 false
assert_eq "a Read that failed for another reason than size is not a refusal" "$(field fileCoverage.0.refusedForSize)" "false"
assert_partial_notices "the notice of the cut Read is counted" 1 0 0 1 0
assert_eq "only the file that the cat printed is fully received" "$(field fullyReceivedFiles)" "1"
assert_eq "one path is listed" "$(field fullyReceivedPaths.length)" "1"
assert_eq "the path is the file of the cat, although its command has is_error" "$(field fullyReceivedPaths.0)" "/tmp/mc-fixture/small.md"

bold "20. A Read refused for the size of the file is a cut first read with no line"
run_json "$FIX_READ_REFUSED"
assert_eq "exits 0" "$STATUS" "0"
assert_eq "the four refused files and the one cut by a notice are listed" "$(field fileCoverage.length)" "5"
# whole-then-refused.md: one Read delivered the whole file, a later Read
# was refused. a-directory: a Read that failed with another text (EISDIR).
assert_eq "only the file read whole before its refusal is fully received" "$(field fullyReceivedFiles)" "1"
assert_eq "a refusal after a whole first read leaves the file fully received, and a Read that failed with a third error text is not a read" "$(field fullyReceivedPaths.0)" "/tmp/mc-fixture/whole-then-refused.md"
# The one notice is that of noticed.md (below); a refusal is not a notice.
assert_partial_notices "a refusal is not a PARTIAL notice, and a refused page does not page a notice" 1 0 0 1 0
# huge.md: "exceeds maximum allowed size", then one page 1-50; the page's
# record states 101 total, which is 100 real lines.
assert_eq "the first read's route is Read" "$(field fileCoverage.0.firstRoute)" "Read"
assert_eq "the row says that the first read was refused" "$(field fileCoverage.0.refusedForSize)" "true"
assert_coverage_row "refused, then half of the file in one page" 0 100 "$SOURCE_READ_RESULT" "1-50" 50 false
# huge-tokens.md: "exceeds maximum allowed tokens" and no later read. No
# record states a total and the file is not on disk; no line received is
# zero percent of any total.
assert_eq "the token form of the refusal is a refusal too" "$(field fileCoverage.1.refusedForSize)" "true"
assert_coverage_row "refused, never read afterwards, the file not on disk" 1 null null "none" 0 false
assert_eq "no line was received" "$(field fileCoverage.1.receivedLines)" "0"
# huge-all.md: refused, a page 1-3, a page refused again (not a first read:
# it only delivers nothing), then a page 4-7 whose line 7 is empty.
assert_coverage_row "refused, then paged to the end" 2 6 "$SOURCE_READ_RESULT" "1-6" 100 true
# noticed.md: a first read cut by a notice at line 3 of 6, then a page that
# was refused. The refusal is not the first read, so the row keeps its kind.
assert_eq "a refusal after a first read does not make the first read a refusal" "$(field fileCoverage.3.refusedForSize)" "false"
assert_coverage_row "cut by a notice, then a refused page" 3 6 "$SOURCE_NOTICE" "1-3" 50 false
# huge-tail.md: refused, then `tail -n +5`: lines were received from line 5
# to an end that no record and no file states, so the figures stay unknown.
assert_coverage_row "refused, then an open range, the total unknown" 4 null null "none" null null
run_json "$FIX_PAGED_SHORT"
assert_eq "a first read cut by a PARTIAL notice is not a refusal" "$(field fileCoverage.0.refusedForSize)" "false"
run_text "$FIX_READ_REFUSED"
assert_file_contains "the text report names the refusal as the first read" "$OUTF" "/tmp/mc-fixture/huge.md | first read: Read, refused for size | total lines: 100 ($SOURCE_READ_RESULT) | received: 1-50 (50 lines) | coverage: 50.0% | uncovered: 51-100 | last line reached: no"
assert_file_contains "a first read cut by a notice keeps its label when a later page is refused" "$OUTF" "/tmp/mc-fixture/noticed.md | first read: Read, cut by a PARTIAL notice | total lines: 6 ($SOURCE_NOTICE)"
assert_file_contains "a refusal with nothing read afterwards prints zero percent, not unknown" "$OUTF" "/tmp/mc-fixture/huge-tokens.md | first read: Read, refused for size | total lines: unknown | received: none (0 lines) | coverage: 0.0% | uncovered: unknown | last line reached: no"
assert_eq "no row of this report rests on today's disk" "$(report_lines_with "$SOURCE_DISK_TODAY")" "0"

bold "21. A persisted cat: the persisted copy comes before the file on disk today"
# grew.txt was 100 lines "line N" when the cat ran, and Claude Code saved
# that text; today the file has 300 other lines. shrank.txt was printed by
# `cat shrank.txt; echo done`, so its saved output is not the file alone.
# after-cd.txt was printed by `cd <dir> && cat after-cd.txt`: the cd prints
# nothing, so that saved output is the file alone.
COPY_DIR="$WORK/persisted"
write_lines "$COPY_DIR/grew.txt" 300 changed
write_lines "$COPY_DIR/tool-results/grew-copy.txt" 100 line
write_lines "$COPY_DIR/shrank.txt" 100 line
write_lines "$COPY_DIR/tool-results/two-units.txt" 150 line
write_lines "$COPY_DIR/after-cd.txt" 300 changed
write_lines "$COPY_DIR/tool-results/after-cd-copy.txt" 100 line
write_lines "$COPY_DIR/plan.txt" 100 line
write_lines "$COPY_DIR/tool-results/log-and-plan.txt" 300 line
write_lines "$COPY_DIR/twice.txt" 300 changed
write_lines "$COPY_DIR/tool-results/twice-first.txt" 100 line
write_lines "$COPY_DIR/tool-results/twice-second.txt" 200 line
PERSISTED_COPY="$WORK/persisted-copy.jsonl"
fill_template "$FIX_PERSISTED_COPY_TEMPLATE" "$COPY_DIR" "$PERSISTED_COPY"
run_json "$PERSISTED_COPY"
assert_eq "exits 0" "$STATUS" "0"
# Two preview lines, `sed -n '3,50p'` on the copy, then the pattern range
# /^line 60$/,/^line 100$/, which matches the copy and not the file today.
assert_coverage_row "the total and the pattern range come from the persisted copy" 0 100 "$SOURCE_PERSISTED_COPY" "1-50, 60-100" 91 true
assert_eq "the row names the source of the pattern range" "$(field fileCoverage.0.patternRangesSource)" "on the persisted copy"
assert_coverage_row "a saved output of two commands is not a copy of the file, so the disk is counted" 1 100 "$SOURCE_DISK_TODAY" "1-2" 2 false
assert_coverage_row "a cd before the cat leaves the saved output a copy of the file" 2 100 "$SOURCE_PERSISTED_COPY" "1-2" 2 false
# plan.txt was printed by `git log; cat plan.txt`; a Read of that saved
# output is cut, and its record, the notice in its text and the notice in
# an attachment record all state 301 total, which is the line count of the
# output of both commands. The file has 100 lines.
assert_eq "a Read of a saved output of two commands does not state the total of the file" "$(field fileCoverage.3.totalLines)" "100"
assert_eq "the total of that file is counted on disk" "$(field fileCoverage.3.totalLinesSource)" "$SOURCE_DISK_TODAY"
# twice.txt was printed by two cats. A pattern range was resolved on the
# first saved copy (100 lines) before the second cat saved 200 lines.
assert_coverage_row "the newest saved copy of a file gives the total" 4 200 "$SOURCE_PERSISTED_COPY" "1-200" 100 true
run_text "$PERSISTED_COPY"
assert_file_contains "the text report names the persisted copy for the total and for the pattern range" "$OUTF" "grew.txt | first read: cat, persisted | total lines: 100 ($SOURCE_PERSISTED_COPY) | received: 1-50, 60-100 (91 lines; pattern ranges resolved on the persisted copy) | coverage: 91.0%"
assert_eq "the label of today's disk count is on the two fallback rows" "$(report_lines_with "$SOURCE_DISK_TODAY")" "2"

bold "22. A file that changed during the session: the newest stated total starts a new version"
# A Read record or a notice that states another total than the one before
# it shows that the file changed. Line numbers of the reads before the
# change do not name the same lines afterwards, so the row holds the reads
# since the newest change, and names the earlier versions with their figures.
run_json "$FIX_CHANGED_DURING_SESSION"
assert_eq "exits 0" "$STATUS" "0"
assert_eq "four cut files are listed" "$(field fileCoverage.length)" "4"
# shrunk.md: a notice "1-500 of 1001 total"; then pages 1-200 and 201-401
# whose records state 401 total, the last one showing line 401 empty.
assert_coverage_row "a file that became shorter and was then read to its end" 0 400 "$SOURCE_READ_RESULT" "1-400" 100 true
assert_eq "the row counts one earlier version" "$(field fileCoverage.0.earlierVersions.length)" "1"
assert_eq "the earlier version keeps its own total" "$(field fileCoverage.0.earlierVersions.0.totalLines)" "1000"
assert_eq "the earlier version keeps the source of its total" "$(field fileCoverage.0.earlierVersions.0.totalLinesSource)" "$SOURCE_NOTICE"
assert_eq "the earlier version keeps its own coverage" "$(field fileCoverage.0.earlierVersions.0.coveragePercent)" "50"
assert_eq "the earlier version did not reach its last line" "$(field fileCoverage.0.earlierVersions.0.lastLineReached)" "false"
# grown.md: read to the end at 100 lines; then one page 1-100 whose record
# states 201 total. The second half of the file as it is now was never read.
assert_coverage_row "a file that grew after it was read to its end" 1 200 "$SOURCE_READ_RESULT" "1-100" 50 false
assert_eq "the version read to its end is kept as an earlier version" "$(field fileCoverage.1.earlierVersions.0.coveragePercent)" "100"
assert_eq "that earlier version reached its last line" "$(field fileCoverage.1.earlierVersions.0.lastLineReached)" "true"
# cut-again.md: read to the end at 100 lines; then a Read cut by a notice
# "1-100 of 201 total" and one page 101-150.
assert_coverage_row "a second notice on a grown file" 2 200 "$SOURCE_NOTICE" "1-150" 75 false
# no-record.md: a notice "1-50 of 101 total"; then a cut Read whose record
# has no structured result, so only the notice in its text states the new
# total of 201, and its lines 1-100 are read from the line numbers.
assert_coverage_row "the read that states a new total only in its notice keeps its own lines" 3 200 "$SOURCE_NOTICE" "1-100" 50 false
# A notice is paged to the end when the last line was reached in its own
# version or in a later one: the notices of shrunk.md, of grown.md and the
# first of cut-again.md. The second notice of cut-again.md is paged short,
# although the version before it was read to its end. Of no-record.md, the
# first notice is paged short and the second is not paged.
assert_partial_notices "each notice is judged on its own version and the later ones" 6 3 2 1 0
# whole-then-changed.md: one Read delivered the whole file; a later page
# states another total. The file was received whole once, which stays true.
assert_eq "a file received whole in one call stays so after it changed" "$(field fullyReceivedFiles)" "1"
assert_eq "that file is the one listed" "$(field fullyReceivedPaths.0)" "/tmp/mc-fixture/whole-then-changed.md"
run_text "$FIX_CHANGED_DURING_SESSION"
assert_file_contains "the text report names the earlier version after the figures of the newest one" "$OUTF" "/tmp/mc-fixture/shrunk.md | first read: Read, cut by a PARTIAL notice | total lines: 400 ($SOURCE_READ_RESULT) | received: 1-400 (400 lines) | coverage: 100.0% | uncovered: none | last line reached: yes | changed during the session: 1 earlier version (1000 lines, 50.0%)"
assert_eq "every row of a changed file says so" "$(report_lines_with "changed during the session")" "4"
run_json "$FIX_PAGED_SHORT"
assert_eq "a file whose records state one total has no earlier version" "$(field fileCoverage.0.earlierVersions.length)" "0"
run_text "$FIX_PAGED_SHORT"
assert_eq "the row of an unchanged file does not say that it changed" "$(report_lines_with "changed during the session")" "0"

bold "23. The last numbered line of the Read count: shown, received by a range, or never shown"
# The Read count T is one more than the lines with text when the file ends
# with a newline. Only a page that shows line T tells whether line T is
# empty. When no page showed it, the report assumes a final newline for the
# total (T - 1 lines), but it does not say "last line reached: yes" or 100
# percent unless a range ran past line T - 1.
run_json "$FIX_LAST_LINE_NOT_SHOWN"
assert_eq "exits 0" "$STATUS" "0"
assert_eq "seven cut files are listed" "$(field fileCoverage.length)" "7"
# unshown.md: 101 lines and no final newline, so the Read count is 101;
# pages 1-50 and 51-100. Line 101 is text that was never received.
assert_coverage_row "every line but the last numbered one, which no page showed" 0 100 "$SOURCE_NOTICE" "1-100" null null
assert_eq "the row says that the end is not proven" "$(field fileCoverage.0.endNotProven)" "true"
assert_eq "no claim is made about uncovered lines" "$(field fileCoverage.0.uncoveredRanges)" "null"
# past-end.md: `sed -n '51,200p'` ran past the end of the file, so the last
# line was received whether it is line 100 or line 101.
assert_coverage_row "a range past the end proves the last line" 1 100 "$SOURCE_NOTICE" "1-100" 100 true
assert_eq "that row is proven" "$(field fileCoverage.1.endNotProven)" "false"
assert_coverage_row "a range to the end of the file proves the last line" 2 100 "$SOURCE_NOTICE" "1-100" 100 true
# shown-text.md: the last page shows text on line 101: no final newline.
assert_coverage_row "a page that shows text on the last numbered line" 3 101 "$SOURCE_NOTICE" "1-101" 100 true
# short.md: pages 1-50 and 51-80. Line 100 was not received, so "no" is
# true with and without a final newline.
assert_coverage_row "a read that stops before the last line with text" 4 100 "$SOURCE_NOTICE" "1-80" 80 false
assert_eq "a row that is short for certain is not marked as not proven" "$(field fileCoverage.4.endNotProven)" "false"
# gap.md: pages 1-50 and 61-100: a gap, and the end not proven.
assert_coverage_row "a gap before an end that is not proven" 5 100 "$SOURCE_NOTICE" "1-50, 61-100" 90 null
assert_eq "the gap is named" "$(field fileCoverage.5.uncoveredRanges)" "51-60"
assert_eq "the row with a gap is marked too" "$(field fileCoverage.5.endNotProven)" "true"
# whole-later.md: a notice at line 50, then a `cat` that printed the file:
# a range from line 1 to the end of the file.
assert_coverage_row "a cat of the whole file proves the last line" 6 100 "$SOURCE_NOTICE" "1-100" 100 true
assert_partial_notices "a notice whose end is not proven is neither paged to the end nor paged short" 7 4 1 0 0 2
run_text "$FIX_LAST_LINE_NOT_SHOWN"
assert_file_contains "the text report gives the reason beside the unknown figures" "$OUTF" "/tmp/mc-fixture/unshown.md | first read: Read, cut by a PARTIAL notice | total lines: 100 ($SOURCE_NOTICE) | received: 1-100 (100 lines) | coverage: unknown | uncovered: unknown | last line reached: unknown (line 101 of the Read count was never shown; it is text when the file has no final newline)"
assert_file_contains "the PARTIAL notices line counts the notices whose end is not proven" "$OUTF" "$(partial_line 7 4 1 0 0 2)"
assert_eq "the reason is printed on the two rows that are not proven" "$(report_lines_with "was never shown")" "2"

bold "24. A failed Bash command: one printing step is skipped, several steps are tracked"
# On a Bash result `is_error` is the exit status of the whole command. With
# one printing step it is the status of that step, which printed no file.
# With several steps, a step before the failure may have printed.
run_json "$FIX_FAILED_BASH"
assert_eq "exits 0" "$STATUS" "0"
# absent.md (`cat absent.md`) and absent-too.md (`cd <dir> && cat
# absent-too.md`) were never printed: neither is a row nor fully received.
assert_eq "three cut files are listed" "$(field fileCoverage.length)" "3"
assert_eq "a failed cat that is the only printing step is not a file received whole" "$(field fullyReceivedFiles)" "0"
# cut.md: a notice at line 3 of 6. `sed -n '4,5p' cut.md; ls absent` failed
# at the ls, after the sed printed. `sed -n '6,6p' cut.md` failed by itself.
assert_coverage_row "a range in a failed command of several steps counts, a failed one-step range does not" 0 6 "$SOURCE_NOTICE" "1-5" 83.3 false
assert_partial_notices "the range of the failed command of several steps pages the notice" 1 0 1 0 0
# saved.md: `cat saved.md; ls absent` failed at the ls; the saved output
# and its two complete preview lines are tracked.
assert_eq "a failed command of several steps with a saved output starts the cat route" "$(field fileCoverage.1.firstRoute)" "cat"
assert_coverage_row "the preview lines of that saved output count" 1 null null "1-2" null null
# long-line.md: a persisted cat whose preview holds no complete line, and
# nothing read afterwards: no line received, of a total that nothing states.
assert_eq "the file is not a refused one" "$(field fileCoverage.2.refusedForSize)" "false"
assert_coverage_row "no line received is zero percent, also for a file that was not refused" 2 null null "none" 0 false

echo
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
exit 0
