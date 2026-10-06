#!/usr/bin/env bash
# fill-prompt test suite: unit tests on
# skills/multi-code-review/scripts/fill-prompt.js. Pure bash + node; no
# claude invocation.
# Windows note: never reads standard input through its device path and uses
# no process substitution (neither is reliable in Git Bash on Windows) —
# everything goes through temp files.
#
# Contract source: docs/superpowers-orchestrator/2026-09-05-prompt-pointer-dispatch/
# specs/prompt-pointer-dispatch-design.md, sections "scripts/fill-prompt.js"
# and "Testing strategy" item 1.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL_DIR="$ROOT/skills/multi-code-review"
FILL="$SKILL_DIR/scripts/fill-prompt.js"
FIXTURES="$ROOT/tests/fill-prompt/fixtures"
SMALL="$FIXTURES/small-template.md"
REVIEWER_TEMPLATE="$SKILL_DIR/reviewer-prompt.md"
FIX_TEMPLATE="$SKILL_DIR/fix-prompt.md"

# Wording the filled real templates must carry, and the residue they must not.
MARKER='<!-- multi-review report -->'
PATHSPEC="':(top,exclude)docs/superpowers-orchestrator/*/*-review-log.md'"
# A residual placeholder: uppercase letters and underscores, at least two
# characters, in square brackets.
PLACEHOLDER_ERE='\[[A-Z][A-Z_]*[A-Z]\]'
USAGE_LINE='usage: node fill-prompt.js --template <path> --out <path> [NAME=<value> | NAME=@<file>]...'
FAILURE_HEADING='## Previous attempt failed'
# The heading must come from the FAILURE_BLOCK value, never from the
# template. The template body does mention the heading inside prose (the
# data-not-instructions rule, and the note that a withheld line in the
# failure text is not a finding), so both checks are anchored to a whole
# line instead of matching the text anywhere.
FAILURE_HEADING_LINE_ERE='^## Previous attempt failed$'
# Item 15: the shared-checkout rule is one bullet inside the prompt block of
# the reviewer template, so the filled prompt carries it. The bullet wraps
# across lines, so the check reads the filled file folded.
SHARED_CHECKOUT_BULLET='- Other agents may work in this checkout at the same time. Create a file or folder only inside a folder that `mktemp -d` printed for you or at a file path that `mktemp` printed, never at a fixed path (such as `/tmp/out.txt`, or a folder with a fixed name inside a scratch folder other agents also use). Use no fixed network port and no shared database. Run a program that writes files (an installer, a formatter, a build, a code generator, a sync script) only in a copy of the repository made under a `mktemp -d` path, never in this checkout. A focused test (Tests below) follows these rules too.'

PASS=0
FAIL=0
ERRORS=()
WORK="$(mktemp -d)"
: "${WORK:?mktemp failed — refusing to run with an empty work path}"
trap 'rm -rf "$WORK"' EXIT
ERRF="$WORK/stderr.txt"
OUTF="$WORK/stdout.txt"
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
assert_file_not_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then bad "$1 (must not contain: $3)"; else ok "$1"; fi
}
assert_file_matches() { # desc file extended-regex
  if grep -qE -- "$3" "$2"; then ok "$1"; else bad "$1 (no match for: $3)"; fi
}
assert_file_not_matches() { # desc file extended-regex
  if grep -qE -- "$3" "$2"; then bad "$1 (unexpected match for: $3)"; else ok "$1"; fi
}
assert_same() { # desc actual-file expected-file
  if cmp -s "$2" "$3"; then ok "$1"; else bad "$1 (files differ)"; diff "$3" "$2" || true; fi
}
assert_absent() { # desc path
  if [ -e "$2" ]; then bad "$1 (exists: $2)"; else ok "$1"; fi
}
assert_file_has_line() { # desc file exact-line (whole-line match, fixed string)
  if grep -qxF -- "$3" "$2"; then ok "$1"; else bad "$1 (no line exactly: $3)"; fi
}
line_count() { grep -c '' "$1" | tr -d ' '; }
# Join the lines of file $1 into one line — each line trimmed of leading and
# trailing blanks, lines separated by one space — so that a sentence that the
# text wraps across a line break still matches as one fixed string.
fold_file() { # file
  awk '{ line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line); if (NR > 1) printf " "; printf "%s", line } END { print "" }' "$1"
}
assert_folded_contains() { # desc file needle (fixed string, matched across line breaks)
  if fold_file "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}
# The dedented LAST line of a template's prompt body: the line just above the
# closing fence of the template's first fenced block — the first line that is
# exactly three backticks after the `prompt: |` line — with its leading
# whitespace removed. Used to check that no fenced example inside a body was
# taken as the closing fence, which would truncate the filled output.
last_body_line() { # template
  awk '/^```$/ && seen { print prev; exit } /^[[:space:]]*prompt: \|$/ { seen = 1 } { prev = $0 }' "$1" \
    | sed 's/^[[:space:]]*//'
}

# Run the script; exit status in $STATUS, stderr in $ERRF, stdout in $OUTF.
fill() {
  node "$FILL" "$@" >"$OUTF" 2>"$ERRF"
  STATUS=$?
}
# The small template with the two fixed values and the four variable ones.
small_fill() { # out OPTIONAL_LINE INLINE_VALUE BODY_VALUE SHARED
  fill --template "$SMALL" --out "$1" ROUND=3 LENS_NAME=Security \
    "OPTIONAL_LINE=$2" "INLINE_VALUE=$3" "BODY_VALUE=$4" "SHARED=$5"
}

bold "1. Byte-for-byte fill of the small template"
small_fill "$WORK/full.md" "Optional line present." plain "@$FIXTURES/body-value.md" shared
assert_eq "full fill exits 0" "$STATUS" "0"
assert_eq "full fill prints nothing on stdout" "$(cat "$OUTF")" ""
assert_eq "full fill prints nothing on stderr" "$(cat "$ERRF")" ""
assert_same "full fill matches expected-full.md byte for byte" "$WORK/full.md" "$FIXTURES/expected-full.md"

bold "2. Values survive unchanged and are never re-substituted"
small_fill "$WORK/special.md" "" plain "@$FIXTURES/special-value.md" shared
assert_eq "special value: exits 0" "$STATUS" "0"
assert_file_contains "special value: \$HOME survives" "$WORK/special.md" '$HOME'
assert_file_contains "special value: backtick-quoted word survives" "$WORK/special.md" '`word`'
assert_file_contains "special value: pathspec survives" "$WORK/special.md" "$PATHSPEC"
assert_file_contains "special value: \$& and \$1 survive (replace specials not interpreted)" "$WORK/special.md" '$& $1'
assert_file_contains "special value: command substitution text survives as text" "$WORK/special.md" '$(echo no)'
small_fill "$WORK/bracket.md" "" plain "@$FIXTURES/bracket-value.md" shared
assert_eq "bracket value: exits 0" "$STATUS" "0"
assert_file_contains "bracket value: inserted verbatim" "$WORK/bracket.md" 'see [C1] and [ROUND] verbatim'
assert_eq "bracket value: the body's own [ROUND] was filled, only the value's stays" "$(grep -cF '[ROUND]' "$WORK/bracket.md" | tr -d ' ')" "1"
assert_file_contains "bracket value: report-id tokens in the body are untouched" "$WORK/bracket.md" 'Report ids such as [C1] and [I1] stay.'

bold "3. Empty values: whole-line removal versus a shared line"
small_fill "$WORK/empty.md" "" plain "@$FIXTURES/body-value.md" ""
assert_eq "empty values: exits 0" "$STATUS" "0"
assert_file_not_contains "empty whole-line value removes its line" "$WORK/empty.md" 'OPTIONAL_LINE'
assert_eq "empty whole-line value: one line fewer than the full fill" "$(line_count "$WORK/empty.md")" "7"
assert_file_contains "empty shared-line value substitutes the empty string" "$WORK/empty.md" 'Shared line with  here.'

bold "4. @file values, trailing newlines, malformed body"
sed '3d' "$FIXTURES/expected-full.md" > "$WORK/expected-no-optional.md"
small_fill "$WORK/nl.md" "@$FIXTURES/newline-only.md" plain "@$FIXTURES/body-value.md" shared
assert_eq "newline-only @file: exits 0" "$STATUS" "0"
assert_same "newline-only @file counts as empty and removes the whole line" "$WORK/nl.md" "$WORK/expected-no-optional.md"
fill --template "$FIXTURES/bad-indent-template.md" --out "$WORK/bad.md" ROUND=1
assert_eq "body line indented less than the first exits 2" "$STATUS" "2"
assert_file_contains "bad indent: message says the template is malformed" "$ERRF" 'malformed template'
# The number must be the line of the template FILE (line 7 of the fixture),
# not an offset counted from the first body line.
assert_file_contains "bad indent: message names the template file line" "$ERRF" 'template line 7 is not indented at least as far as the first body line'
assert_absent "bad indent: nothing written" "$WORK/bad.md"

bold "5. Strictness and exit codes"
fill --template "$SMALL" --out "$WORK/s3.md" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain "BODY_VALUE=@$FIXTURES/body-value.md"
assert_eq "uncovered placeholder exits 3" "$STATUS" "3"
assert_file_contains "uncovered placeholder: message names it" "$ERRF" 'SHARED'
assert_absent "uncovered placeholder: nothing written" "$WORK/s3.md"
fill --template "$SMALL" --out "$WORK/s4.md" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain BODY_VALUE=x SHARED=y NOT_HERE=1
assert_eq "unknown name exits 4" "$STATUS" "4"
assert_file_contains "unknown name: message names it" "$ERRF" 'NOT_HERE'
assert_absent "unknown name: nothing written" "$WORK/s4.md"
fill --template "$SMALL" --out "$WORK/s4b.md" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain BODY_VALUE=x SHARED=y LEGEND_ONLY=1
assert_eq "name that appears only in the legend exits 4" "$STATUS" "4"
assert_file_contains "legend-only name: message names it" "$ERRF" 'LEGEND_ONLY'
fill --template "$SMALL" --out "$WORK/wrap.md" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain BODY_VALUE=x SHARED=y WRAPPER_ONLY=z
assert_eq "name that appears only in the wrapper is accepted (exit 0)" "$STATUS" "0"
fill --template "$SMALL" --out "$WORK/s1a.md" --bogus ROUND=3
assert_eq "unknown option exits 1" "$STATUS" "1"
assert_eq "unknown option: usage line on stderr" "$(cat "$ERRF")" "$USAGE_LINE"
fill --template "$SMALL" ROUND=3
assert_eq "missing --out exits 1" "$STATUS" "1"
fill --out "$WORK/s1c.md" ROUND=3
assert_eq "missing --template exits 1" "$STATUS" "1"
fill --template "$SMALL" --template "$SMALL" --out "$WORK/s1d.md" ROUND=3
assert_eq "repeated --template exits 1" "$STATUS" "1"
fill --template "$SMALL" --out "$WORK/s1e.md" ROUND=3 ROUND=4
assert_eq "repeated NAME exits 1" "$STATUS" "1"
fill --template "$WORK/missing-template.md" --out "$WORK/s1e2.md" ROUND=3 ROUND=4
assert_eq "repeated NAME with an unreadable template still exits 1 (usage before file reads)" "$STATUS" "1"
fill --template "$SMALL" --out "$WORK/s1f.md" lowercase=1
assert_eq "argument that is not NAME=<rest> exits 1" "$STATUS" "1"
fill --template "$SMALL" ROUND=3 --out
assert_eq "option without a value exits 1" "$STATUS" "1"
fill --template "$SMALL" --out "$WORK/s5.md" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain "BODY_VALUE=@$WORK/does-not-exist.md" SHARED=y
assert_eq "missing @file exits 5" "$STATUS" "5"
assert_file_contains "missing @file: message names the file" "$ERRF" 'does-not-exist.md'
assert_absent "missing @file: nothing written" "$WORK/s5.md"
fill --template "$FIXTURES/no-prompt-template.md" --out "$WORK/s2.md" ROUND=3
assert_eq "template without a prompt block exits 2" "$STATUS" "2"
assert_absent "template without a prompt block: nothing written" "$WORK/s2.md"
fill --template "$WORK/missing-template.md" --out "$WORK/s5b.md" ROUND=3
assert_eq "unreadable --template exits 5" "$STATUS" "5"
fill --template "$SMALL" --out "$WORK/no-such-dir/out.md" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain BODY_VALUE=x SHARED=y
assert_eq "unwritable --out exits 5" "$STATUS" "5"

bold "6. The real reviewer template"
printf '%s\n' 'Lens text with $ signs, `code` and [C1]-style ids.' > "$WORK/lens.txt"
printf '%s\n' '## Carried Findings' 'Triage these carried Minor findings in your Carried Findings Triage section:' '- [M1] a.py:1 — carried from the host gate' > "$WORK/carried.txt"
PLAN_LINE_VALUE='Plan/requirements the branch implements (read it first): /repo/docs/plan.md'
fill --template "$REVIEWER_TEMPLATE" --out "$WORK/reviewer.md" ROUND=1 REPO_ROOT=/repo BASE_SHA=aaa111 HEAD_SHA=bbb222 PACKAGE_FILE=/repo/.superpowers/sdd/review-1.md 'LENS_NAME=Correctness & spec alignment' "LENS_INSTRUCTIONS=@$WORK/lens.txt" "PLAN_LINE=$PLAN_LINE_VALUE" "CARRIED_BLOCK=@$WORK/carried.txt"
assert_eq "reviewer template: full value set exits 0" "$STATUS" "0"
assert_eq "reviewer template: first output line is the dedented first body line" "$(head -n 1 "$WORK/reviewer.md")" 'You are an independent code reviewer. You review ONE branch diff'
assert_file_contains "reviewer template: marker line present" "$WORK/reviewer.md" "$MARKER"
assert_file_contains "reviewer template: blinding pathspec line present" "$WORK/reviewer.md" "$PATHSPEC"
assert_file_contains "reviewer template: plan line filled" "$WORK/reviewer.md" "$PLAN_LINE_VALUE"
assert_file_contains "reviewer template: carried block filled" "$WORK/reviewer.md" '## Carried Findings'
assert_file_contains "reviewer template: lens name filled into the lens heading" "$WORK/reviewer.md" '**Correctness & spec alignment.** Lens text with $ signs'
assert_file_not_matches "reviewer template: no residual placeholder" "$WORK/reviewer.md" "$PLACEHOLDER_ERE"
assert_folded_contains "reviewer template: the filled prompt holds the shared-checkout bullet" "$WORK/reviewer.md" "$SHARED_CHECKOUT_BULLET"
# Round 4 [M1]: the whole body reached the output — a fenced example inside
# the body taken as the closing fence would cut everything below it.
REVIEWER_LAST_BODY_LINE="$(last_body_line "$REVIEWER_TEMPLATE")"
assert_eq "reviewer template: last output line is the dedented last body line" "$(tail -n 1 "$WORK/reviewer.md")" "$REVIEWER_LAST_BODY_LINE"
fill --template "$REVIEWER_TEMPLATE" --out "$WORK/reviewer2.md" ROUND=2 REPO_ROOT=/repo BASE_SHA=aaa111 HEAD_SHA=bbb222 PACKAGE_FILE=/repo/.superpowers/sdd/review-2.md 'LENS_NAME=Adversarial red-team' "LENS_INSTRUCTIONS=@$WORK/lens.txt" PLAN_LINE= CARRIED_BLOCK=
assert_eq "reviewer template: empty PLAN_LINE and CARRIED_BLOCK exit 0" "$STATUS" "0"
assert_file_not_contains "reviewer template: empty plan line omitted" "$WORK/reviewer2.md" 'Plan/requirements'
assert_file_not_matches "reviewer template: no residual placeholder without plan or carried block" "$WORK/reviewer2.md" "$PLACEHOLDER_ERE"
NO_PACKAGE_VALUE='none — fetch the diff yourself via the git commands below'
fill --template "$REVIEWER_TEMPLATE" --out "$WORK/reviewer2b.md" ROUND=2 REPO_ROOT=/repo BASE_SHA=aaa111 HEAD_SHA=bbb222 "PACKAGE_FILE=$NO_PACKAGE_VALUE" 'LENS_NAME=Adversarial red-team' "LENS_INSTRUCTIONS=@$WORK/lens.txt" PLAN_LINE= CARRIED_BLOCK=
assert_eq "reviewer template: quoted no-package PACKAGE_FILE value (contains spaces) exits 0" "$STATUS" "0"
assert_file_contains "reviewer template: no-package value inserted verbatim" "$WORK/reviewer2b.md" "$NO_PACKAGE_VALUE"
fill --template "$REVIEWER_TEMPLATE" --out "$WORK/reviewer3.md" ROUND=1 REPO_ROOT=/repo BASE_SHA=aaa111 HEAD_SHA=bbb222 PACKAGE_FILE=/repo/x.md LENS_NAME=x "LENS_INSTRUCTIONS=@$WORK/lens.txt" PLAN_LINE= CARRIED_BLOCK= PLAN_PATH=/repo/docs/plan.md
assert_eq "reviewer template: PLAN_PATH (legend only) exits 4" "$STATUS" "4"
assert_file_contains "reviewer template: PLAN_PATH message names it" "$ERRF" 'PLAN_PATH'

bold "6b. Hardening: line endings, trailing blank body line, output file mode"
# S5: a template whose lines are mostly LF but the fence-open line ends
# CRLF. Splitting on the detected end-of-line string (instead of on either
# line ending) would leave the plain-LF lines merged into one line holding
# an embedded bare newline; locks that this never happens and that, once
# CRLF is the detected end-of-line, every output line ends with CR.
MIXED_EOL_TEMPLATE="$WORK/mixed-eol-template.md"
printf '```\r\n' > "$MIXED_EOL_TEMPLATE"
printf 'Agent tool (general-purpose):\n' >> "$MIXED_EOL_TEMPLATE"
printf '  prompt: |\n' >> "$MIXED_EOL_TEMPLATE"
printf '    First line [ROUND].\n' >> "$MIXED_EOL_TEMPLATE"
printf '    Second line.\n' >> "$MIXED_EOL_TEMPLATE"
printf '```\n' >> "$MIXED_EOL_TEMPLATE"
fill --template "$MIXED_EOL_TEMPLATE" --out "$WORK/mixed-eol.md" ROUND=3
assert_eq "mixed line endings: exits 0" "$STATUS" "0"
MIXED_EOL_LINE_COUNT="$(line_count "$WORK/mixed-eol.md")"
MIXED_EOL_CR_COUNT="$(grep -c $'\r$' "$WORK/mixed-eol.md" | tr -d ' ')"
assert_eq "mixed line endings: output has exactly 2 lines (fails if the file is missing)" "$MIXED_EOL_LINE_COUNT" "2"
assert_eq "mixed line endings: no output line holds an embedded bare newline (every line ends with CR)" "$MIXED_EOL_CR_COUNT" "$MIXED_EOL_LINE_COUNT"
printf 'First line 3.\nSecond line.\n' > "$WORK/mixed-eol-expected.txt"
tr -d '\r' < "$WORK/mixed-eol.md" > "$WORK/mixed-eol-normalized.txt"
assert_same "mixed line endings: LF-normalized output matches the expected text" "$WORK/mixed-eol-normalized.txt" "$WORK/mixed-eol-expected.txt"

# S7: a template whose body's last line before the closing fence is blank
# (whitespace only). Skipping the trailing-blank-line drop would leave that
# blank line in the dedented body, so the written output would end with two
# newlines instead of exactly one; locks the single-trailing-newline
# invariant byte for byte.
TRAILING_BLANK_TEMPLATE="$WORK/trailing-blank-template.md"
printf '```\n' > "$TRAILING_BLANK_TEMPLATE"
printf 'Agent tool (general-purpose):\n' >> "$TRAILING_BLANK_TEMPLATE"
printf '  prompt: |\n' >> "$TRAILING_BLANK_TEMPLATE"
printf '    First line [ROUND].\n' >> "$TRAILING_BLANK_TEMPLATE"
printf '    Second line.\n' >> "$TRAILING_BLANK_TEMPLATE"
printf '    \n' >> "$TRAILING_BLANK_TEMPLATE"
printf '```\n' >> "$TRAILING_BLANK_TEMPLATE"
fill --template "$TRAILING_BLANK_TEMPLATE" --out "$WORK/trailing-blank.md" ROUND=3
assert_eq "trailing blank body line: exits 0" "$STATUS" "0"
printf 'First line 3.\nSecond line.\n' > "$WORK/trailing-blank-expected.txt"
assert_same "trailing blank body line: output matches expected byte for byte (exactly one trailing newline)" "$WORK/trailing-blank.md" "$WORK/trailing-blank-expected.txt"

# S3: the output file's permissions are owner read/write only.
OUTPUT_MODE_FILE="$WORK/mode-check.md"
fill --template "$SMALL" --out "$OUTPUT_MODE_FILE" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain BODY_VALUE=x SHARED=y
assert_eq "output file mode: fill exits 0" "$STATUS" "0"
UNAME_S="$(uname -s)"
case "$UNAME_S" in
  MINGW*|MSYS*)
    ok "output file mode: owner read/write only (skipped on Git Bash — Windows emulates POSIX permissions)"
    ;;
  *)
    OUTPUT_MODE="$(ls -ld "$OUTPUT_MODE_FILE" | cut -c1-10)"
    assert_eq "output file mode: owner read/write only" "$OUTPUT_MODE" "-rw-------"
    ;;
esac

bold "7. The real fix template"
printf '%s\n' '- [C1] Critical — src/a.py:10 — off-by-one in the range end' '- [I1] Important — src/b.py:3 — missing null check' > "$WORK/findings.txt"
fill --template "$FIX_TEMPLATE" --out "$WORK/fix.md" ROUND=2 SLUG=my-branch REPO_ROOT=/repo FIX_REPORT_FILE=/repo/docs/x/implementation/my-branch-fix-reports.md "FINDINGS=@$WORK/findings.txt" FAILURE_BLOCK=
assert_eq "fix template: first dispatch (empty FAILURE_BLOCK) exits 0" "$STATUS" "0"
assert_file_contains "fix template: generic commit subject filled" "$WORK/fix.md" 'review fixes (my-branch, round 2)'
assert_file_contains "fix template: findings inserted verbatim" "$WORK/fix.md" '- [C1] Critical — src/a.py:10 — off-by-one in the range end'
assert_file_contains "fix template: fix-report path filled" "$WORK/fix.md" '/repo/docs/x/implementation/my-branch-fix-reports.md'
assert_file_not_matches "fix template: no failure heading on the first dispatch" "$WORK/fix.md" "$FAILURE_HEADING_LINE_ERE"
assert_file_not_matches "fix template: no residual placeholder" "$WORK/fix.md" "$PLACEHOLDER_ERE"
# Round 4 [M1]: same whole-body check as for the reviewer template above.
# Amendment 4 put every rule of the fix template before its variable blocks,
# so `[FAILURE_BLOCK]` is now the last body line. An empty whole-line value
# removes that line, so the first dispatch's output must end with the body
# line before it — the fill must still not drop the template's tail.
FIX_LAST_BODY_LINE="$(last_body_line "$FIX_TEMPLATE")"
assert_eq "fix template: [FAILURE_BLOCK] is the last body line" "$FIX_LAST_BODY_LINE" "[FAILURE_BLOCK]"
FIX_PREV_BODY_LINE="$(grep -B 2 '^    \[FAILURE_BLOCK\]$' "$FIX_TEMPLATE" | head -n 1 | sed 's/^[[:space:]]*//')"
assert_eq "fix template: last output line is the body line before [FAILURE_BLOCK]" "$(tail -n 1 "$WORK/fix.md")" "$FIX_PREV_BODY_LINE"
printf '%s\n' "$FAILURE_HEADING" 'covering tests failed: 2 errors in tests/test_a.py' > "$WORK/failure.txt"
fill --template "$FIX_TEMPLATE" --out "$WORK/fix-retry.md" ROUND=2 SLUG=my-branch REPO_ROOT=/repo FIX_REPORT_FILE=/repo/docs/x/implementation/my-branch-fix-reports.md "FINDINGS=@$WORK/findings.txt" "FAILURE_BLOCK=@$WORK/failure.txt"
assert_eq "fix template: re-dispatch (FAILURE_BLOCK from file) exits 0" "$STATUS" "0"
assert_file_matches "fix template: failure heading present on the re-dispatch" "$WORK/fix-retry.md" "$FAILURE_HEADING_LINE_ERE"
assert_file_contains "fix template: failure text present on the re-dispatch" "$WORK/fix-retry.md" 'covering tests failed: 2 errors in tests/test_a.py'
assert_file_not_matches "fix template: no residual placeholder on the re-dispatch" "$WORK/fix-retry.md" "$PLACEHOLDER_ERE"

bold "8. Round 2 fixes: refuse to overwrite --out, and trailing blank after fill"
# M1: filling onto an existing --out whose content DIFFERS exits 5 and leaves
# the existing file's content unchanged; no temporary file is left behind
# either.
EXISTING_OUT="$WORK/existing.md"
printf 'pre-existing content\n' > "$EXISTING_OUT"
fill --template "$SMALL" --out "$EXISTING_OUT" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain BODY_VALUE=x SHARED=y
assert_eq "existing --out: exits 5" "$STATUS" "5"
assert_file_contains "existing --out: message names the path" "$ERRF" "$EXISTING_OUT"
assert_eq "existing --out: content unchanged" "$(cat "$EXISTING_OUT")" "pre-existing content"
# The atomic write names its temporary file `.<out basename>.<pid>.<hex>.tmp`
# in the output directory; none may survive the refusal.
assert_eq "existing --out: no temporary file left behind" "$(find "$WORK" -maxdepth 1 -name '.existing.md.*' | wc -l | tr -d ' ')" "0"

# Round 4 [M1]: a repeat of a fill whose first run completed — the caller lost
# the tool result and re-issued the same command — finds an --out whose content
# is byte-identical to what this run would write, so it exits 0 without writing
# anything. The file is unchanged and no temporary file survives.
IDENTICAL_OUT="$WORK/identical.md"
fill --template "$SMALL" --out "$IDENTICAL_OUT" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain BODY_VALUE=x SHARED=y
assert_eq "identical repeat: the first fill exits 0" "$STATUS" "0"
cp "$IDENTICAL_OUT" "$WORK/identical-expected.txt"
fill --template "$SMALL" --out "$IDENTICAL_OUT" ROUND=3 LENS_NAME=Security OPTIONAL_LINE= INLINE_VALUE=plain BODY_VALUE=x SHARED=y
assert_eq "identical repeat: exits 0" "$STATUS" "0"
assert_same "identical repeat: content unchanged byte for byte" "$IDENTICAL_OUT" "$WORK/identical-expected.txt"
assert_eq "identical repeat: no temporary file left behind" "$(find "$WORK" -maxdepth 1 -name '.identical.md.*' | wc -l | tr -d ' ')" "0"

# M2: a template whose last body line is a whole-line placeholder given the
# empty value. Dropping trailing blanks BEFORE fill would miss the blank
# line that fill's removal of the placeholder line exposes as the new last
# line, leaving two trailing newlines; locks the single-trailing-newline
# invariant for this case too.
TRAILING_PLACEHOLDER_TEMPLATE="$WORK/trailing-placeholder-template.md"
printf '```\n' > "$TRAILING_PLACEHOLDER_TEMPLATE"
printf 'Agent tool (general-purpose):\n' >> "$TRAILING_PLACEHOLDER_TEMPLATE"
printf '  prompt: |\n' >> "$TRAILING_PLACEHOLDER_TEMPLATE"
printf '    First line [ROUND].\n' >> "$TRAILING_PLACEHOLDER_TEMPLATE"
printf '    Second line.\n' >> "$TRAILING_PLACEHOLDER_TEMPLATE"
printf '    [OPT]\n' >> "$TRAILING_PLACEHOLDER_TEMPLATE"
printf '```\n' >> "$TRAILING_PLACEHOLDER_TEMPLATE"
fill --template "$TRAILING_PLACEHOLDER_TEMPLATE" --out "$WORK/trailing-placeholder.md" ROUND=3 OPT=
assert_eq "trailing whole-line placeholder given the empty value: exits 0" "$STATUS" "0"
printf 'First line 3.\nSecond line.\n' > "$WORK/trailing-placeholder-expected.txt"
assert_same "trailing whole-line placeholder given the empty value: output matches expected byte for byte (exactly one trailing newline)" "$WORK/trailing-placeholder.md" "$WORK/trailing-placeholder-expected.txt"

bold "9. Round 4 fix: a fenced example inside the prompt body"
# I3: the body of this template holds a fenced example whose opening fence is
# at column 0. Taking that fence as the closing fence would truncate the body
# (the marker line after the example would be lost) and still exit 0; the
# template must be rejected instead.
INNER_FENCE_OUT="$WORK/inner-fence.md"
fill --template "$FIXTURES/inner-fence-template.md" --out "$INNER_FENCE_OUT" ROUND=1
assert_eq "fenced example inside the body exits 2" "$STATUS" "2"
assert_file_contains "inner fence: message says the template is malformed" "$ERRF" 'malformed template'
assert_file_contains "inner fence: message gives the reason" "$ERRF" 'the first fenced block closes inside the prompt body'
assert_absent "inner fence: nothing written" "$INNER_FENCE_OUT"

# M1: the same example written with a language tag on its opening fence and
# its content at column 0. The tagged fence can never be the closing fence,
# so the example's own bare fence is the candidate close and the indented
# marker line below it rejects the template.
INNER_FENCE_C0_OUT="$WORK/inner-fence-column0.md"
fill --template "$FIXTURES/inner-fence-column0-template.md" --out "$INNER_FENCE_C0_OUT" ROUND=1
assert_eq "tagged fenced example with column-0 content exits 2" "$STATUS" "2"
assert_file_contains "inner fence, column-0 content: message gives the reason" "$ERRF" 'the first fenced block closes inside the prompt body'
assert_absent "inner fence, column-0 content: nothing written" "$INNER_FENCE_C0_OUT"

bold "10. The orchestrating-development review-loop templates take M_REVIEWERS"
# Contract source: docs/superpowers-orchestrator/2026-09-06-orchestrator-prompt-pointer/
# specs/orchestrator-prompt-pointer-design.md, "Template changes" item 1 and
# "Testing strategy" item 1.
ORCH_DIR="$ROOT/skills/orchestrating-development"
DOC_LOOP_TEMPLATE="$ORCH_DIR/doc-review-loop-prompt.md"
CODE_LOOP_TEMPLATE="$ORCH_DIR/code-review-loop-prompt.md"
# The doc-review-loop body holds one bracketed single capital letter that is
# not a placeholder: the checklist marker of its Deviation 3. It must reach
# the output unchanged (dedented by the body's four-space indentation).
CHECKLIST_LINE='   `- [X] unresolved: <reason> — <finding summary>`.'
# Every value of the doc-review-loop template except the M argument.
doc_loop_fill() { # out M-argument
  fill --template "$DOC_LOOP_TEMPLATE" --out "$1" \
    'MULTI_DOC_REVIEW_SKILL_PATH=/plug/multi-doc-review/SKILL.md' \
    'REVIEWER_PROMPT_PATH=/plug/multi-doc-review/reviewer-prompt.md' \
    'WRITING_PLANS_SKILL_PATH=/plug/writing-plans/SKILL.md' \
    'PLAN_PATH=/repo/docs/plan.md' 'SPEC_PATH=/repo/docs/spec.md' 'N_PLAN=3' "$2"
}
# Every value of the code-review-loop template except the M argument and the
# RESUME_ANSWER argument.
code_loop_fill() { # out M-argument RESUME_ANSWER-argument
  fill --template "$CODE_LOOP_TEMPLATE" --out "$1" \
    'MULTI_CODE_REVIEW_SKILL_PATH=/plug/multi-code-review/SKILL.md' \
    'REVIEWER_PROMPT_PATH=/plug/multi-code-review/reviewer-prompt.md' \
    'TOPIC_DIR=/repo/docs/superpowers-orchestrator/2026-09-06-topic' 'BASE_SHA=abc1234' \
    'N_CODE=3' 'PLAN_PATH=/repo/docs/plan.md' 'LEDGER_PATH=/repo/.superpowers/sdd/progress.md' \
    "$2" "$3"
}
doc_loop_fill "$WORK/doc-loop.md" 'M_REVIEWERS=2'
assert_eq "doc-review-loop template: M_REVIEWERS=2 exits 0" "$STATUS" "0"
assert_file_contains "doc-review-loop template: M filled into the parameter line" "$WORK/doc-loop.md" '- M (reviewers per lens): 2   (fill the review log'"'"'s invocation'
assert_file_not_matches "doc-review-loop template: no residual placeholder" "$WORK/doc-loop.md" "$PLACEHOLDER_ERE"
assert_file_not_contains "doc-review-loop template: no [M] token left" "$WORK/doc-loop.md" '[M]'
assert_file_has_line "doc-review-loop template: the checklist marker line stays byte-identical" "$WORK/doc-loop.md" "$CHECKLIST_LINE"
doc_loop_fill "$WORK/doc-loop-m.md" 'M=2'
assert_eq "doc-review-loop template: M=2 is a usage error (exit 1)" "$STATUS" "1"
assert_eq "doc-review-loop template: M=2 prints the usage line" "$(cat "$ERRF")" "$USAGE_LINE"
assert_absent "doc-review-loop template: M=2 writes nothing" "$WORK/doc-loop-m.md"
code_loop_fill "$WORK/code-loop.md" 'M_REVIEWERS=1' 'RESUME_ANSWER='
assert_eq "code-review-loop template: M_REVIEWERS=1 exits 0" "$STATUS" "0"
assert_file_contains "code-review-loop template: M filled into the parameter line" "$WORK/code-loop.md" '- M (reviewers per lens): 1   (fill the review log'"'"'s invocation'
assert_file_not_matches "code-review-loop template: no residual placeholder" "$WORK/code-loop.md" "$PLACEHOLDER_ERE"
assert_file_not_contains "code-review-loop template: no [M] token left" "$WORK/code-loop.md" '[M]'
code_loop_fill "$WORK/code-loop-m.md" 'M=1' 'RESUME_ANSWER='
assert_eq "code-review-loop template: M=1 is a usage error (exit 1)" "$STATUS" "1"
assert_absent "code-review-loop template: M=1 writes nothing" "$WORK/code-loop-m.md"

bold "11. The Resume Answer section: plan-writer and code-review-loop templates"
# Contract source: the spec's "Template changes" item 2 and "Testing
# strategy" item 1: an empty RESUME_ANSWER removes the placeholder line and
# keeps the heading and the fixed sentence; a two-line value file inserts
# both lines directly below the fixed sentence.
PLAN_WRITER_TEMPLATE="$ORCH_DIR/plan-writer-prompt.md"
RESUME_HEADING='## Resume Answer'
FIXED_SENTENCE='A section with no line below this sentence means the run has recorded no answer.'
# The line right below the fixed sentence in file $1; empty when the sentence
# is absent or is the last line. The sentence reaches awk through the
# environment so that no character of it is reinterpreted.
line_below_fixed_sentence() { # file
  s="$FIXED_SENTENCE" awk 'BEGIN { s = ENVIRON["s"] } found { print; exit } index($0, s) > 0 { found = 1 }' "$1"
}
FIRST_ANSWER='[I2] (orchestrator): plan governs: "clause" — docs/plan.md'
SECOND_ANSWER='[C3] (user): fix it'
printf '%s\n' "$FIRST_ANSWER" "$SECOND_ANSWER" > "$WORK/two-answers.txt"
plan_writer_fill() { # out RESUME_ANSWER-argument
  fill --template "$PLAN_WRITER_TEMPLATE" --out "$1" \
    'WRITING_PLANS_SKILL_PATH=/plug/writing-plans/SKILL.md' \
    'SPEC_PATH=/repo/docs/spec.md' 'PLAN_PATH=/repo/docs/plan.md' "$2"
}
# Assertions shared by the templates that carry the section: $1 label,
# $2 the output of a fill with the empty value, $3 the output of a fill with
# the two-line value file, $4 the template (for the last-body-line check),
# $5 the expected first answer line, $6 the expected second answer line.
check_resume_section() { # label empty-out two-out template first-answer second-answer
  assert_file_has_line "$1: empty value keeps the Resume Answer heading" "$2" "$RESUME_HEADING"
  assert_file_not_contains "$1: empty value leaves no omit parenthetical" "$2" '## Resume Answer (omit'
  assert_file_has_line "$1: empty value keeps the fixed sentence" "$2" "$FIXED_SENTENCE"
  assert_eq "$1: empty value leaves no answer line below the fixed sentence" "$(line_below_fixed_sentence "$2")" ""
  assert_file_not_matches "$1: no residual placeholder with the empty value" "$2" "$PLACEHOLDER_ERE"
  assert_eq "$1: last output line is the dedented last body line" "$(tail -n 1 "$2")" "$(last_body_line "$4")"
  assert_eq "$1: the first answer line sits directly below the fixed sentence" "$(line_below_fixed_sentence "$3")" "$5"
  assert_file_has_line "$1: the second answer line is inserted" "$3" "$6"
  assert_file_not_matches "$1: no residual placeholder with the value file" "$3" "$PLACEHOLDER_ERE"
}
plan_writer_fill "$WORK/pw-empty.md" 'RESUME_ANSWER='
assert_eq "plan-writer template: empty RESUME_ANSWER exits 0" "$STATUS" "0"
assert_eq "plan-writer template: first output line is the dedented first body line" "$(head -n 1 "$WORK/pw-empty.md")" 'You are an autonomous plan-writing controller. You write ONE'
plan_writer_fill "$WORK/pw-two.md" "RESUME_ANSWER=@$WORK/two-answers.txt"
assert_eq "plan-writer template: two-line answer file exits 0" "$STATUS" "0"
check_resume_section "plan-writer template" "$WORK/pw-empty.md" "$WORK/pw-two.md" "$PLAN_WRITER_TEMPLATE" "$FIRST_ANSWER" "$SECOND_ANSWER"
code_loop_fill "$WORK/cl-empty.md" 'M_REVIEWERS=1' 'RESUME_ANSWER='
assert_eq "code-review-loop template: empty RESUME_ANSWER exits 0" "$STATUS" "0"
code_loop_fill "$WORK/cl-two.md" 'M_REVIEWERS=1' "RESUME_ANSWER=@$WORK/two-answers.txt"
assert_eq "code-review-loop template: two-line answer file exits 0" "$STATUS" "0"
check_resume_section "code-review-loop template" "$WORK/cl-empty.md" "$WORK/cl-two.md" "$CODE_LOOP_TEMPLATE" "$FIRST_ANSWER" "$SECOND_ANSWER"
assert_file_contains "code-review-loop template: Deviation 2 keys BLOCKED on the absence of an answer line" "$WORK/cl-empty.md" '`## Resume Answer` holds no'

bold "12. The batch-controller template: no BATCH_NUMBER, the Resume Answer section, the never-rewrite guard"
BATCH_TEMPLATE="$ORCH_DIR/batch-controller-prompt.md"
AMEND_FIRST_LINE='An `amend plan: …` answer in this section is the record of an'
TASK_FIRST_ANSWER='[task 2/1] (orchestrator): plan governs: "clause" — docs/plan.md'
TASK_SECOND_ANSWER='[task 3] (user): amend plan: use the constant'
printf '%s\n' "$TASK_FIRST_ANSWER" "$TASK_SECOND_ANSWER" > "$WORK/task-answers.txt"
# Every value of the batch template except the task list and the
# RESUME_ANSWER argument. BATCH_NUMBER is never passed: it stands only in the
# wrapper, which the script does not write.
batch_fill() { # out TASK_LIST-value RESUME_ANSWER-argument
  fill --template "$BATCH_TEMPLATE" --out "$1" \
    'SDD_SKILL_PATH=/plug/subagent-driven-development/SKILL.md' \
    'SDD_SCRIPTS_DIR=/plug/subagent-driven-development/scripts' \
    'IMPLEMENTER_PROMPT_PATH=/plug/subagent-driven-development/implementer-prompt.md' \
    'TASK_REVIEWER_PROMPT_PATH=/plug/subagent-driven-development/task-reviewer-prompt.md' \
    'PLAN_PATH=/repo/docs/plan.md' "TASK_LIST=$2" 'TASK_RANGE=4..6' 'FIRST_BATCH=yes' "$3"
}
batch_fill "$WORK/batch-empty.md" '4, 5, 6' 'RESUME_ANSWER='
assert_eq "batch template: fills without BATCH_NUMBER and exits 0" "$STATUS" "0"
assert_file_contains "batch template: quoted task list inserted verbatim" "$WORK/batch-empty.md" 'Tasks to implement, in order: 4, 5, 6'
assert_file_contains "batch template: the task list is substituted inside the pre-flight sentence too" "$WORK/batch-empty.md" 'never best-guess a number inside `4, 5, 6`'
assert_file_contains "batch template: task range filled into the return line" "$WORK/batch-empty.md" 'BATCH_COMPLETE tasks=4..6'
assert_file_has_line "batch template: empty value keeps the amend-plan paragraph" "$WORK/batch-empty.md" "$AMEND_FIRST_LINE"
batch_fill "$WORK/batch-two.md" '4, 5, 6' "RESUME_ANSWER=@$WORK/task-answers.txt"
assert_eq "batch template: two-line answer file exits 0" "$STATUS" "0"
check_resume_section "batch template" "$WORK/batch-empty.md" "$WORK/batch-two.md" "$BATCH_TEMPLATE" "$TASK_FIRST_ANSWER" "$TASK_SECOND_ANSWER"
# The never-rewrite guard: a dispatched name reused with different content
# exits 5 and leaves the file as it was.
batch_fill "$WORK/batch-empty.md" '7, 8' 'RESUME_ANSWER='
assert_eq "batch template: re-filling a dispatched name with different content exits 5" "$STATUS" "5"
assert_file_contains "batch template: the refusal says the file already exists" "$ERRF" 'file already exists'
assert_file_contains "batch template: the existing file is unchanged" "$WORK/batch-empty.md" 'Tasks to implement, in order: 4, 5, 6'
# An unquoted task list splits into three arguments; the second is not
# NAME=<value>, so the script exits 1 before reading anything.
fill --template "$BATCH_TEMPLATE" --out "$WORK/batch-unquoted.md" TASK_LIST=4, 5, 6
assert_eq "batch template: an unquoted task list is a usage error (exit 1)" "$STATUS" "1"
assert_absent "batch template: unquoted task list writes nothing" "$WORK/batch-unquoted.md"

bold "13. The orchestrator's fill commands name exactly the body placeholders of their templates"
# The spec's drift guard ("Testing strategy" item 1): every 'NAME= token of
# each fenced block of the orchestrator's text that holds fill-prompt.js,
# keyed by the template on that block's --template line, must equal the
# template body's placeholder set. Wrapper-only names (BATCH_NUMBER) are not
# passed, so the body set is the comparison target.
ORCH_SKILL="$ROOT/skills/orchestrating-development/SKILL.md"
BLOCKS_DIR="$WORK/orch-blocks"
mkdir -p "$BLOCKS_DIR"
# One file per fenced block of the orchestrator's text (a fence may be
# indented inside a list item).
awk -v dir="$BLOCKS_DIR" '
  /^[ \t]*```/ { if (inblk) { close(out); inblk = 0 } else { inblk = 1; n++; out = dir "/block-" n ".txt" }; next }
  inblk { print > out }
' "$ORCH_SKILL"
# The `[NAME]` placeholders of the prompt body of template $1 — the lines
# after its `prompt: |` line up to the closing fence — one name per line,
# sorted, unique.
template_body_names() { # template
  awk '/^```[ \t]*$/ && seen { exit } seen { print } /^[[:space:]]*prompt: \|[[:space:]]*$/ { seen = 1 }' "$1" \
    | grep -oE "$PLACEHOLDER_ERE" | tr -d '[]' | sort -u
}
FILL_BLOCKS=0
SEEN_TEMPLATES="$WORK/seen-templates.txt"
: > "$SEEN_TEMPLATES"
for blk in "$BLOCKS_DIR"/block-*.txt; do
  [ -e "$blk" ] || continue
  grep -qF 'fill-prompt.js' "$blk" || continue
  FILL_BLOCKS=$((FILL_BLOCKS+1))
  tmpl="$(sed -n 's/.*--template "[^"]*\/\([^"/]*\)".*/\1/p' "$blk" | head -n 1)"
  if [ -z "$tmpl" ] || [ ! -f "$ORCH_DIR/$tmpl" ]; then
    bad "fill block $(basename "$blk"): names no existing template ('$tmpl')"
    continue
  fi
  printf '%s\n' "$tmpl" >> "$SEEN_TEMPLATES"
  grep -oE "'[A-Z][A-Z_]*[A-Z]=" "$blk" | sed -e "s/^'//" -e 's/=$//' | sort -u > "$WORK/cmd-names.txt"
  template_body_names "$ORCH_DIR/$tmpl" > "$WORK/body-names.txt"
  if cmp -s "$WORK/cmd-names.txt" "$WORK/body-names.txt"; then
    ok "fill command for $tmpl names exactly its body placeholders ($(tr '\n' ' ' < "$WORK/cmd-names.txt" | sed 's/ *$//'))"
  else
    bad "fill command for $tmpl and its body placeholders differ"
    diff "$WORK/body-names.txt" "$WORK/cmd-names.txt" || true
  fi
done
assert_eq "the orchestrator holds one fill block per template (four)" "$FILL_BLOCKS" "4"
sort -u "$SEEN_TEMPLATES" > "$WORK/seen-templates-sorted.txt"
cat > "$WORK/expected-templates.txt" <<'EOF'
batch-controller-prompt.md
code-review-loop-prompt.md
doc-review-loop-prompt.md
plan-writer-prompt.md
EOF
assert_same "the filled templates are exactly the four expected ones" "$WORK/seen-templates-sorted.txt" "$WORK/expected-templates.txt"

echo
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
exit 0
