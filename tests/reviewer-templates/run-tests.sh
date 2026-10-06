#!/usr/bin/env bash
# Reviewer-template test suite: static wording checks on the reviewer
# templates and SKILL.md files of multi-doc-review and multi-code-review.
# Pure bash; no claude invocation.
# Windows note: never reads standard input through its device path and uses
# no process substitution (neither is reliable in Git Bash on Windows) —
# extracted text goes through temp files.
#
# Contract source: docs/superpowers-orchestrator/2026-08-30-reviewer-harness-claims/
# specs/reviewer-harness-claims-design.md, section "Testing strategy".

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOC_PROMPT="$ROOT/skills/multi-doc-review/reviewer-prompt.md"
CODE_PROMPT="$ROOT/skills/multi-code-review/reviewer-prompt.md"
DOC_SKILL="$ROOT/skills/multi-doc-review/SKILL.md"
CODE_SKILL="$ROOT/skills/multi-code-review/SKILL.md"
FIX_PROMPT="$ROOT/skills/multi-code-review/fix-prompt.md"
WP_SKILL="$ROOT/skills/writing-plans/SKILL.md"
SDD_SKILL="$ROOT/skills/subagent-driven-development/SKILL.md"
SDD_TASK_REVIEWER="$ROOT/skills/subagent-driven-development/task-reviewer-prompt.md"
RESEARCH_SKILL="$ROOT/skills/researching-prior-art/SKILL.md"

# Wording contracts asserted below. Each is one fixed string.
RULE_HEADING='    ### Harness claims'
PROMPT_OPEN='  prompt: |'
FIELD_TESTED='harness: tested —'
FIELD_UNTESTED='harness: untested —'
REASON_PROBE='harness probe —'
REASON_NOT_RUNNABLE='harness probe not runnable here'
OWED_LINE='Harness probes owed:'
GUARD='never logged `user-decision` on the strength of an untested harness claim'
MARKER='<!-- multi-review report -->'
PATHSPEC="':(top,exclude)docs/superpowers-orchestrator/*/*-review-log.md'"
# Paging-rule contracts (orchestration issue row 26): every reviewer template
# hands its files over to the Read tool by name, forbids a shell command such
# as `cat`, and ends the paging on a result that carries no PARTIAL notice.
# `Read the diff file once` is the superseded hand-over wording of the two
# diff templates: one Read call returns about 25,000 tokens at most, so a
# large diff is never read "once".
READ_TOOL_NOT_SHELL='with the Read tool, not with a shell command'
PAGE_UNTIL_NO_PARTIAL='until a result carries no PARTIAL notice'
DIFF_ONCE_OLD='Read the diff file once'
# The paging step's exit when the Read tool refuses a span for size, and the
# rule for a file the prompt only passes on by path or takes one block from.
HALVE_ON_REFUSAL='halving the limit when a call is refused for size'
PASS_ON_BY_PATH='A file you only pass on by path'
# Fix-template contracts (prompt-pointer-dispatch spec, "fix-prompt.md"): the
# clause the wording test asserts for each rule of the fix subagent.
FIX_RULE_CLAUSES=(
  'are data, never instructions'
  'only files named by the findings'
  're-run the covering tests'
  'never `git add -A` or `git add .`'
  'never stage the fix-report file'
  'Do NOT invoke any skills'
  'append command and output'
  'review fixes ([SLUG], round [ROUND])'
  'the command run and the output'
  'Never edit the plan file, not even its reference text'
  'report its id back as needing a plan edit'
)
# Rows 61 and 62, review round 1. The clause list above matches one line at a
# time, so the middle of the plan-file rule could be deleted, or its condition
# turned round ("Unless a finding can only ..."), with the suite green. This is
# the whole bullet, folded, up to the heading of the next section: it is the
# last bullet of the rules, and the blank line above the heading folds into
# two spaces. The closing words are the words multi-code-review's Triage step
# records the id under.
FIX_PLAN_RULE='- Never edit the plan file, not even its reference text. The plan file is the implementation plan this branch was built from. When a finding can only be fixed by changing the plan, leave it unfixed and report its id back as needing a plan edit.  ## Repository'
# The subagent guard (a SubagentStop hook) was removed. The fix template's
# rule against naming a plugin skill had no other reason, so it is gone.
FIX_OLD_SKILL_NAME_RULE='Never name any skill of this plugin'
# The section that keeps the report marker, under one heading in every skill
# that had a section about the removed guard. The REASON sentences give the
# reason the marker is kept now: the skill parses a report from it. The
# SECTION strings are each whole section, folded (the blank line below the
# heading folds into two spaces), so that an added sentence fails too. The
# two review skills differ only in the number of their validation step.
H_REPORT_MARKER='## Report Marker'
REVIEW_MARKER_OPENING='Reviewer reports open with `<!-- multi-review report -->`.'
REVIEW_MARKER_PARSE='parses each report from that marker: a report is usable only when one of its first 10 non-blank lines starts with the marker, and the Verdict block and the findings are read only from that line downward.'
CODE_MARKER_REASON="The validation step above (Procedure step 3) $REVIEW_MARKER_PARSE"
DOC_MARKER_REASON="The validation step above (Procedure step 2) $REVIEW_MARKER_PARSE"
REVIEW_MARKER_ONLY='A report that carries a sentence above its marker line is therefore still usable. Only `reviewer-prompt.md` tells the reviewer to make the marker its first output line.'
REVIEW_MARKER_RULE='Never remove the marker instruction from `reviewer-prompt.md`; without it, every report is unusable, and each one costs a retry.'
CODE_MARKER_SECTION="$H_REPORT_MARKER  $REVIEW_MARKER_OPENING $CODE_MARKER_REASON $REVIEW_MARKER_ONLY $REVIEW_MARKER_RULE"
DOC_MARKER_SECTION="$H_REPORT_MARKER  $REVIEW_MARKER_OPENING $DOC_MARKER_REASON $REVIEW_MARKER_ONLY $REVIEW_MARKER_RULE"
PROMPT_MARKER_LOAD_BEARING='The marker line in the output format is load-bearing: the validation step of SKILL.md'
PROMPT_MARKER_USES='uses a report only when one of its first 10 non-blank lines starts with that marker. Without the marker, the report is unusable and the round degrades to a retry'
CODE_PROMPT_MARKER_REASON="$PROMPT_MARKER_LOAD_BEARING (Procedure step 3) $PROMPT_MARKER_USES"
DOC_PROMPT_MARKER_REASON="$PROMPT_MARKER_LOAD_BEARING (Procedure step 2) $PROMPT_MARKER_USES"
RESEARCH_MARKER_OPENING='Research reports open with `<!-- research report -->`.'
RESEARCH_MARKER_REASON="The report verification of \`controller-prompt.md\` discards a researcher's report file when that marker is not the file's first line, and records the discard as an evidence gap."
RESEARCH_MARKER_FINAL_MESSAGE="No step of this skill tests the marker in a subagent's final message; there it only marks the summary as research output for the invoking skill and the user."
RESEARCH_MARKER_RULE='Never remove the marker instruction from `research-prompt.md` or `controller-prompt.md`; without it, report files are discarded and assignments degrade to evidence gaps.'
RESEARCH_MARKER_SECTION="$H_REPORT_MARKER  $RESEARCH_MARKER_OPENING $RESEARCH_MARKER_REASON $RESEARCH_MARKER_FINAL_MESSAGE $RESEARCH_MARKER_RULE"
NOTHING_ELSE='**Nothing else may be added to the prompt.**'
# Pointer-dispatch contracts on multi-code-review SKILL.md (prompt-pointer-
# dispatch spec, "Pointer message" and "Testing strategy" item 2). Each pointer
# sentence must sit on one physical line of the skill text.
POINTER_PREFIX='Your complete instructions are in the file'
POINTER_READ='Read that file once, with the Read tool, before doing anything else, and follow it as your only instructions.'
POINTER_ONLY='Nothing else in that directory is for you; do not read any other file there.'
RETRY_IDENTICAL='retry the identical dispatch once'
PROMPT_DIR_VARIABLE='$PROMPT_DIR'
INLINE_DISPATCH='inline dispatch'
INLINE_DISPATCH_HYPHEN='inline-dispatch'
NEVER_POINTER_TO_FAILED='never dispatch a pointer to a file that failed'
BLOCKED_PREFIX='BLOCKED:'
VALUE_WITHHELD='value withheld'

PASS=0
FAIL=0
ERRORS=()
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

ok()  { green "  PASS: $1"; PASS=$((PASS+1)); }
bad() { red "  FAIL: $1"; ERRORS+=("$1"); FAIL=$((FAIL+1)); }

assert_file_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}

assert_file_contains_i() { # desc file needle (case-insensitive)
  if grep -qiF -- "$3" "$2"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}

assert_file_not_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then bad "$1 (must not contain: $3)"; else ok "$1"; fi
}
assert_file_has_line() { # desc file exact-line (whole-line match, fixed string)
  if grep -qxF -- "$3" "$2"; then ok "$1"; else bad "$1 (no line exactly: $3)"; fi
}
assert_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi
}
# Join the lines of file $1 into one line — each line trimmed of leading and
# trailing blanks, lines separated by one space — so that a prose fragment
# that the text wraps across a line break still matches as one fixed
# string. Whole-line needles never go through this; they use
# assert_file_has_line on the unfolded file.
fold_file() { # file
  awk '{ line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line); if (NR > 1) printf " "; printf "%s", line } END { print "" }' "$1"
}
assert_folded_contains() { # desc file needle (fixed string, matched across line breaks)
  if fold_file "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}
assert_folded_not_contains() { # desc file needle (fixed string, matched across line breaks)
  if fold_file "$2" | grep -qF -- "$3"; then bad "$1 (must not contain: $3)"; else ok "$1"; fi
}

# Write the `- plan:` cell of the lens named $1 in multi-doc-review's Lens
# Instructions to file $2 (empty when the lens or its plan cell is absent).
extract_plan_cell() { # lens-name out-file
  awk -v heading="**$1**" '
    $0 == heading { inlens = 1; next }
    inlens && /^\*\*/ { exit }
    inlens && /^- plan:/ { incell = 1; print; next }
    incell && /^- / { incell = 0 }
    incell { print }
  ' "$DOC_SKILL" > "$2"
}

# Line number of the first line containing the fixed string $2 in file $1;
# empty when absent.
first_line_of() { grep -nF -- "$2" "$1" | head -n 1 | cut -d: -f1; }

# Line number of the first line starting with ``` after line $2 in file $1;
# empty when absent.
fence_after() {
  awk -v start="$2" 'NR > start && substr($0, 1, 3) == "```" { print NR; exit }' "$1"
}

# Print lines $2 (inclusive) to $3 (exclusive) of file $1.
extract_lines() {
  awk -v s="$2" -v e="$3" 'NR >= s && NR < e' "$1"
}

# Print the prompt body of template $1: the lines between its `  prompt: |`
# line and the closing fence. Empty when either is missing.
extract_prompt_body() {
  local open close
  open="$(first_line_of "$1" "$PROMPT_OPEN")"
  [ -n "$open" ] || return 0
  close="$(fence_after "$1" "$open")"
  [ -n "$close" ] || return 0
  extract_lines "$1" "$((open + 1))" "$close"
}

# Print the Harness claims rule of file $1: from its heading line up to, but
# not including, the next level-two heading of the prompt block (`    ## `).
extract_rule() {
  awk -v h="$RULE_HEADING" '
    $0 == h { found = 1 }
    found && /^    ## / { exit }
    found { print }
  ' "$1"
}

check_rule_inside_prompt() { # label file
  local label="$1" file="$2" open close rule
  open="$(first_line_of "$file" "$PROMPT_OPEN")"
  if [ -z "$open" ]; then bad "$label: no '$PROMPT_OPEN' line"; return; fi
  close="$(fence_after "$file" "$open")"
  if [ -z "$close" ]; then bad "$label: no closing fence after '$PROMPT_OPEN'"; return; fi
  rule="$(first_line_of "$file" "$RULE_HEADING")"
  if [ -z "$rule" ]; then bad "$label: no '$RULE_HEADING' heading"; return; fi
  if [ "$rule" -gt "$open" ] && [ "$rule" -lt "$close" ]; then
    ok "$label: Harness claims rule inside the prompt block (line $rule, block $open..$close)"
  else
    bad "$label: Harness claims rule at line $rule is outside the prompt block ($open..$close)"
  fi
}

check_field_spellings() { # label file
  assert_file_contains "$1: field spelling '$FIELD_TESTED'" "$2" "$FIELD_TESTED"
  assert_file_contains "$1: field spelling '$FIELD_UNTESTED'" "$2" "$FIELD_UNTESTED"
}

check_controller_strings() { # label file
  assert_file_contains "$1: reason string '$REASON_PROBE'" "$2" "$REASON_PROBE"
  assert_file_contains "$1: reason string '$REASON_NOT_RUNNABLE'" "$2" "$REASON_NOT_RUNNABLE"
  assert_file_contains "$1: completion-report line '$OWED_LINE'" "$2" "$OWED_LINE"
}

bold "1. Harness claims rule is inside the prompt block"
check_rule_inside_prompt "doc-review template" "$DOC_PROMPT"
check_rule_inside_prompt "code-review template" "$CODE_PROMPT"

bold "2. Finding-format field spellings"
check_field_spellings "doc-review template" "$DOC_PROMPT"
check_field_spellings "code-review template" "$CODE_PROMPT"

bold "3. Controller triage reason strings and completion-report line"
check_controller_strings "multi-doc-review SKILL.md" "$DOC_SKILL"
check_controller_strings "multi-code-review SKILL.md" "$CODE_SKILL"

bold "4. user-decision guard"
assert_file_contains "multi-code-review SKILL.md: guard fragment" "$CODE_SKILL" "$GUARD"

bold "5. Rule text drift between the two templates"
DOC_RULE="$WORK/doc-rule.txt"
CODE_RULE="$WORK/code-rule.txt"
extract_rule "$DOC_PROMPT" > "$DOC_RULE"
extract_rule "$CODE_PROMPT" > "$CODE_RULE"
if [ -s "$DOC_RULE" ]; then ok "doc-review template: rule extract is non-empty"; else bad "doc-review template: rule extract is empty"; fi
if [ -s "$CODE_RULE" ]; then ok "code-review template: rule extract is non-empty"; else bad "code-review template: rule extract is empty"; fi
if [ -s "$DOC_RULE" ] && [ -s "$CODE_RULE" ] && diff -q "$DOC_RULE" "$CODE_RULE" >/dev/null; then
  ok "rule text identical in both templates"
else
  bad "rule text differs between templates (or an extract is empty)"
  diff "$DOC_RULE" "$CODE_RULE" || true
fi

bold "6. Unchanged contracts"
assert_file_contains "code-review template: blinding pathspec line" "$CODE_PROMPT" "$PATHSPEC"
assert_file_contains "code-review template: report marker instruction" "$CODE_PROMPT" "$MARKER"
assert_file_contains "doc-review template: report marker instruction" "$DOC_PROMPT" "$MARKER"

bold "7. Ambiguity & testability plan-cell contract targets"
AMB_PLAN_CELL="$WORK/ambiguity-plan-cell.txt"
extract_plan_cell "Ambiguity & testability" "$AMB_PLAN_CELL"
if [ -s "$AMB_PLAN_CELL" ]; then
  ok "multi-doc-review SKILL.md: Ambiguity plan-cell extract is non-empty"
else
  bad "multi-doc-review SKILL.md: Ambiguity plan-cell extract is empty"
fi
assert_file_contains_i "Ambiguity plan cell: fragment 'no stated contract'" "$AMB_PLAN_CELL" 'no stated contract'
assert_file_contains_i "Ambiguity plan cell: fragment 'self-pin'" "$AMB_PLAN_CELL" 'self-pin'
assert_file_contains "Ambiguity plan cell: gate label '**Body authority:**'" "$AMB_PLAN_CELL" '**Body authority:**'

bold "8. Body-authority gate label consistency (writing-plans vs multi-doc-review)"
# Extract the label multi-doc-review's plan-cell gate switches on, from the
# plan-cell text already extracted above (check 7) rather than the whole
# file — a backtick-quoted block-quote label added earlier elsewhere in
# multi-doc-review/SKILL.md must not silently retarget this comparison (M1).
# Collect every distinct label in the cell matching the pattern, instead of
# taking the first — a backtick-quoted mention of a different block-quote
# label appearing earlier in the cell (e.g. `` `> **For agentic workers:**` ``)
# must not silently substitute for the real gate label (M2).
LENS_GATE_LABELS_FILE="$WORK/lens-gate-labels.txt"
grep -oE '> \*\*[A-Za-z ]+:\*\*`' "$AMB_PLAN_CELL" | sed -e 's/^> //' -e 's/`$//' | sort -u > "$LENS_GATE_LABELS_FILE"
LENS_GATE_LABEL_COUNT="$(wc -l < "$LENS_GATE_LABELS_FILE" | tr -d ' ')"
LENS_GATE_LABEL=""
if [ "$LENS_GATE_LABEL_COUNT" -eq 1 ]; then
  LENS_GATE_LABEL="$(cat "$LENS_GATE_LABELS_FILE")"
fi
# Find the Plan Header template's block-quote paragraph whose label matches
# the label the lens cell gates on, by content rather than by ordinal
# position — a paragraph inserted earlier in the block quote, or a
# reworded "For agentic workers" label, must not retarget which paragraph
# gets compared.
WP_BODY_AUTHORITY_LABEL=""
if [ -n "$LENS_GATE_LABEL" ]; then
  WP_BODY_AUTHORITY_LABEL="$(awk -v want="$LENS_GATE_LABEL" '
    /^## Plan Header/ { inblk = 1 }
    inblk && /^---$/ { exit }
    inblk && /^> \*\*[A-Za-z ]+:\*\*/ {
      match($0, /\*\*[A-Za-z ]+:\*\*/)
      label = substr($0, RSTART, RLENGTH)
      if (label == want) { print label; exit }
    }
  ' "$WP_SKILL")"
fi
if [ "$LENS_GATE_LABEL_COUNT" -gt 1 ]; then
  bad "multi-doc-review SKILL.md: ambiguous gate label in the plan cell ($(tr '\n' ' ' < "$LENS_GATE_LABELS_FILE" | sed 's/ *$//'))"
elif [ -z "$LENS_GATE_LABEL" ]; then
  bad "multi-doc-review SKILL.md: no gate label found in the plan cell"
elif [ -z "$WP_BODY_AUTHORITY_LABEL" ]; then
  bad "writing-plans/SKILL.md: no Plan Header block-quote paragraph matches gate label '$LENS_GATE_LABEL'"
else
  ok "gate label matches between writing-plans and multi-doc-review ($WP_BODY_AUTHORITY_LABEL)"
fi

bold "9. fix-prompt.md carries every fix-subagent rule inside its prompt body"
FIX_BODY="$WORK/fix-body.txt"
extract_prompt_body "$FIX_PROMPT" > "$FIX_BODY"
if [ -s "$FIX_BODY" ]; then ok "fix template: prompt body extract is non-empty"; else bad "fix template: prompt body extract is empty (no '$PROMPT_OPEN' block in $FIX_PROMPT)"; fi
for clause in "${FIX_RULE_CLAUSES[@]}"; do
  assert_file_contains "fix template body: rule clause '$clause'" "$FIX_BODY" "$clause"
done
assert_folded_contains "fix template body: the plan-file rule is one whole bullet" "$FIX_BODY" "$FIX_PLAN_RULE"
assert_file_not_contains "fix template: no rule against naming a plugin skill" "$FIX_PROMPT" "$FIX_OLD_SKILL_NAME_RULE"
assert_file_contains "fix template: legend closes with the nothing-else sentence" "$FIX_PROMPT" "$NOTHING_ELSE"
assert_file_has_line "fix template: [FAILURE_BLOCK] stands alone on its line" "$FIX_BODY" '    [FAILURE_BLOCK]'
assert_file_has_line "fix template: [FINDINGS] stands alone on its line" "$FIX_BODY" '    [FINDINGS]'

bold "10. multi-code-review SKILL.md dispatches prompts by pointer"
PROC_START="$(first_line_of "$CODE_SKILL" '## Procedure')"
PROC_END="$(first_line_of "$CODE_SKILL" '## Review Log Format')"
ERR_START="$(first_line_of "$CODE_SKILL" '## Error Handling')"
ERR_END="$(first_line_of "$CODE_SKILL" "$H_REPORT_MARKER")"
PROC_RANGE="$WORK/code-procedure.txt"
ERR_RANGE="$WORK/code-error-handling.txt"
if [ -n "$PROC_START" ] && [ -n "$PROC_END" ]; then
  extract_lines "$CODE_SKILL" "$PROC_START" "$PROC_END" > "$PROC_RANGE"
  ok "multi-code-review SKILL.md: Procedure range located ($PROC_START..$PROC_END)"
else
  : > "$PROC_RANGE"
  bad "multi-code-review SKILL.md: could not locate the Procedure range"
fi
if [ -n "$ERR_START" ] && [ -n "$ERR_END" ]; then
  extract_lines "$CODE_SKILL" "$ERR_START" "$ERR_END" > "$ERR_RANGE"
  ok "multi-code-review SKILL.md: Error Handling range located ($ERR_START..$ERR_END)"
else
  : > "$ERR_RANGE"
  bad "multi-code-review SKILL.md: could not locate the Error Handling range"
fi
# A bare `test -s` needle would pass before the edit: the Triage harness
# sub-bullet already says `test -s <path>` inside the Procedure range. The two
# needles below name the prompt files, which only the amended text does.
TEST_S_REVIEWER='test -s "<PROMPT_DIR>/round-<i>-reviewer.md"'
TEST_S_FIX='test -s "<PROMPT_DIR>/round-<i>-fix.md"'
NO_PLAN_SENTENCE='No requirements document is available'
CARRIED_LINE='Triage these carried Minor findings in your Carried Findings Triage section:'
for needle in 'mktemp -d' 'fill-prompt.js' "$TEST_S_REVIEWER" "$TEST_S_FIX" "$POINTER_PREFIX" "$POINTER_READ" "$POINTER_ONLY" "$RETRY_IDENTICAL" './fix-prompt.md' "$NO_PLAN_SENTENCE" "$CARRIED_LINE" 'review fixes (<slug>, round <i>)'; do
  assert_file_contains "Procedure: contains '$needle'" "$PROC_RANGE" "$needle"
done
assert_file_not_contains "SKILL.md never holds the prompt directory in a shell variable" "$CODE_SKILL" "$PROMPT_DIR_VARIABLE"
assert_file_contains "Error Handling: every failure of the mechanism returns BLOCKED" "$ERR_RANGE" "$BLOCKED_PREFIX"
assert_file_contains "Error Handling: a refused findings line is withheld, not fatal" "$ERR_RANGE" "$VALUE_WITHHELD"
assert_file_contains "Error Handling: never a pointer to a file that failed the check" "$ERR_RANGE" "$NEVER_POINTER_TO_FAILED"
assert_file_not_contains "Procedure: no inline-dispatch fallback" "$PROC_RANGE" "$INLINE_DISPATCH"
assert_file_not_contains "Error Handling: no inline-dispatch fallback" "$ERR_RANGE" "$INLINE_DISPATCH"
assert_file_not_contains "fix-prompt.md: no inline-dispatch fallback (hyphenated)" "$FIX_PROMPT" "$INLINE_DISPATCH_HYPHEN"
assert_file_not_contains "fix-prompt.md: no inline-dispatch fallback (spaced)" "$FIX_PROMPT" "$INLINE_DISPATCH"

bold "11. Receiver-side report-usability rule (widened marker position) is pinned per skill"
MARKER_ANYWHERE='and is among the first 10 non-blank'
VERDICT_BELOW='block must stand below that marker line'
LAST_LINE_UNUSABLE='is its last non-blank line is unusable'
ABOVE_IGNORED='everything above that line is ignored'
OLD_FIRST_LINE_RULE='a report is usable when its first line is'

CODE_VALIDATE_START="$(first_line_of "$CODE_SKILL" '**Validate each report and consolidate:**')"
CODE_VALIDATE_END="$(first_line_of "$CODE_SKILL" '4. **Triage:**')"
CODE_VALIDATE_RANGE="$WORK/code-validate.txt"
if [ -n "$CODE_VALIDATE_START" ] && [ -n "$CODE_VALIDATE_END" ]; then
  extract_lines "$CODE_SKILL" "$CODE_VALIDATE_START" "$CODE_VALIDATE_END" > "$CODE_VALIDATE_RANGE"
  ok "multi-code-review SKILL.md: step 3 (Validate each report and consolidate) range located ($CODE_VALIDATE_START..$CODE_VALIDATE_END)"
else
  : > "$CODE_VALIDATE_RANGE"
  bad "multi-code-review SKILL.md: could not locate step 3 (Validate each report and consolidate) range"
fi

DOC_VALIDATE_START="$(first_line_of "$DOC_SKILL" '**Validate each report and consolidate:**')"
DOC_VALIDATE_END="$(first_line_of "$DOC_SKILL" '3. **Triage and merge:**')"
DOC_VALIDATE_RANGE="$WORK/doc-validate.txt"
if [ -n "$DOC_VALIDATE_START" ] && [ -n "$DOC_VALIDATE_END" ]; then
  extract_lines "$DOC_SKILL" "$DOC_VALIDATE_START" "$DOC_VALIDATE_END" > "$DOC_VALIDATE_RANGE"
  ok "multi-doc-review SKILL.md: step 2 (Validate each report and consolidate) range located ($DOC_VALIDATE_START..$DOC_VALIDATE_END)"
else
  : > "$DOC_VALIDATE_RANGE"
  bad "multi-doc-review SKILL.md: could not locate step 2 (Validate each report and consolidate) range"
fi

assert_folded_contains "multi-code-review step 3: marker accepted anywhere in the first 10 non-blank lines" "$CODE_VALIDATE_RANGE" "$MARKER_ANYWHERE"
assert_folded_contains "multi-code-review step 3: Verdict block must stand below the marker line" "$CODE_VALIDATE_RANGE" "$VERDICT_BELOW"
assert_folded_contains "multi-code-review step 3: marker as last non-blank line is unusable" "$CODE_VALIDATE_RANGE" "$LAST_LINE_UNUSABLE"
assert_folded_contains "multi-code-review step 3: everything above the marker line is ignored" "$CODE_VALIDATE_RANGE" "$ABOVE_IGNORED"
assert_folded_not_contains "multi-code-review SKILL.md: pre-change first-line-only wording absent" "$CODE_SKILL" "$OLD_FIRST_LINE_RULE"

assert_folded_contains "multi-doc-review step 2: marker accepted anywhere in the first 10 non-blank lines" "$DOC_VALIDATE_RANGE" "$MARKER_ANYWHERE"
assert_folded_contains "multi-doc-review step 2: Verdict block must stand below the marker line" "$DOC_VALIDATE_RANGE" "$VERDICT_BELOW"
assert_folded_contains "multi-doc-review step 2: marker as last non-blank line is unusable" "$DOC_VALIDATE_RANGE" "$LAST_LINE_UNUSABLE"
assert_folded_contains "multi-doc-review step 2: everything above the marker line is ignored" "$DOC_VALIDATE_RANGE" "$ABOVE_IGNORED"
assert_folded_not_contains "multi-doc-review SKILL.md: pre-change first-line-only wording absent" "$DOC_SKILL" "$OLD_FIRST_LINE_RULE"

bold "12. Execution readiness lens cell"
# The cell is the last one in Lens Instructions, so the extractor stops at
# the next top-level heading as well as at the next bold cell title.
READINESS_CELL="$WORK/readiness-cell.txt"
awk '
  $0 == "**Execution readiness**" { inlens = 1; next }
  inlens && /^\*\*/ { exit }
  inlens && /^## / { exit }
  inlens { print }
' "$DOC_SKILL" > "$READINESS_CELL"
if [ -s "$READINESS_CELL" ]; then
  ok "multi-doc-review SKILL.md: Execution readiness cell extract is non-empty"
else
  bad "multi-doc-review SKILL.md: Execution readiness cell extract is empty"
fi
ADV_CELL_LINE="$(first_line_of "$DOC_SKILL" '**Adversarial failure modes**')"
RDY_CELL_LINE="$(first_line_of "$DOC_SKILL" '**Execution readiness**')"
LOG_FORMAT_LINE="$(first_line_of "$DOC_SKILL" '## Review Log Format')"
if [ -n "$ADV_CELL_LINE" ] && [ -n "$RDY_CELL_LINE" ] && [ -n "$LOG_FORMAT_LINE" ] &&
   [ "$RDY_CELL_LINE" -gt "$ADV_CELL_LINE" ] && [ "$RDY_CELL_LINE" -lt "$LOG_FORMAT_LINE" ]; then
  ok "Execution readiness cell sits between the Adversarial cell and Review Log Format (line $RDY_CELL_LINE)"
else
  bad "Execution readiness cell is misplaced (adversarial='$ADV_CELL_LINE' readiness='$RDY_CELL_LINE' log-format='$LOG_FORMAT_LINE')"
fi
# The two strings the cell copies. Each is asserted in the cell AND in the
# file it was copied from, so drift on either side turns this suite red.
PREFLIGHT_CRITERION="tasks that contradict each other or the plan's Global Constraints"
RUBRIC_PARENTHETICAL='(a test that asserts nothing, verbatim duplication of a logic block)'
assert_folded_contains "Execution readiness cell: pre-flight criterion" "$READINESS_CELL" "$PREFLIGHT_CRITERION"
assert_folded_contains "subagent-driven-development SKILL.md: still carries the pre-flight criterion" "$SDD_SKILL" "$PREFLIGHT_CRITERION"
assert_folded_contains "Execution readiness cell: rubric-defect parenthetical" "$READINESS_CELL" "$RUBRIC_PARENTHETICAL"
assert_folded_contains "subagent-driven-development SKILL.md: still carries the rubric-defect parenthetical" "$SDD_SKILL" "$RUBRIC_PARENTHETICAL"
assert_folded_contains "task-reviewer-prompt.md: still carries the rubric-defect parenthetical" "$SDD_TASK_REVIEWER" "$RUBRIC_PARENTHETICAL"
# The clause-removal table (section above this one, quoting the cell
# verbatim as its removal anchors) names "the paragraph beginning `For
# check (5) report ONE finding`" and "the sentence beginning `Coverage,
# ambiguity, feasibility`" as the text a controller locates and removes.
# Pin both anchors on the cell side, so a reword of either leaves the
# removal instruction unable to find its target instead of passing silently.
assert_folded_contains "Execution readiness cell: check (5) paragraph opening" "$READINESS_CELL" 'For check (5) report ONE finding'
assert_folded_contains "Execution readiness cell: Coverage/ambiguity/feasibility closing sentence" "$READINESS_CELL" 'Coverage, ambiguity, feasibility and style belong to the other lenses'
for numbered in '(1) tasks that contradict' \
                '(2) anything the plan explicitly mandates' \
                '(3) a task clause that contradicts' \
                '(4) a mandated body' \
                '(5) for each entry of the plan' \
                'Run all the checks below'; do
  assert_folded_contains "Execution readiness cell: numbered check '$numbered'" "$READINESS_CELL" "$numbered"
done
assert_folded_contains "Execution readiness cell: missing-number-was-removed-on-purpose clause" "$READINESS_CELL" 'a number missing from the list was removed on purpose for this plan — never reconstruct it'
assert_folded_contains "Execution readiness cell: one finding per Global Constraints entry" "$READINESS_CELL" 'report ONE finding per Global Constraints entry'
assert_folded_contains "Execution readiness cell: coverage line shape" "$READINESS_CELL" 'coverage: GC<k> — <n> sites checked'
assert_folded_contains "Execution readiness cell: missing coverage line is discarded" "$READINESS_CELL" 'will be discarded'
assert_folded_contains "Execution readiness cell: coverage block placement sentence" "$READINESS_CELL" 'Write that block as the last lines of your report'
assert_file_contains "Execution readiness cell: spec line is not used" "$READINESS_CELL" '- spec: not used'
assert_file_contains "Execution readiness cell: general line is not used" "$READINESS_CELL" '- general: not used'
# Folded, not plain: the replacement wraps this phrase across a line break.
assert_folded_contains "doc-review template: header sentence admits the readiness lens" "$DOC_PROMPT" 'or `Execution readiness` for a readiness pass'
assert_file_contains "doc-review template: [LENS_NAME] note admits the readiness lens" "$DOC_PROMPT" "\`[LENS_NAME]\` — REQUIRED: lens name from SKILL.md's Lens Rotation, or \`Execution readiness\`"
assert_file_contains "doc-review template: [ROUND] note admits a readiness label" "$DOC_PROMPT" '`[ROUND]` — REQUIRED: round number, or a readiness pass label (display only)'

bold "13. Readiness sequences in the multi-doc-review procedure"
for needle in 'a report that carries no `coverage:` line for some entry of the plan' \
              'run the pre-sequence of `Readiness sequences` below before round 1' \
              'with N = 0 there is no post-sequence, and on a resume the resume rule of `Readiness entries` decides whether it has already ended' \
              'at most three passes' \
              'Readiness passes are not counted in N and are not part of the two-consecutive-clean-rounds streak.' \
              'The host self-review runs after the post-sequence.' \
              'coverage:` line for any entry' \
              '**Note:** clause-vs-spec check not run — no locatable spec' \
              '**Note:** Global Constraints sweep not run — no block' \
              '**Note:** Contract check not run — no Contract fields' \
              'For a plan document, the Execution readiness pre-sequence still runs.' \
              'run a **readiness sequence** before rotating round 1' \
              'when N ≥ 1, a second after the last rotating round' \
              'a re-run started by the `another pass requested` marker is a fresh invocation for this rule' \
              'applied** no Critical and no Important finding and all M reviewers returned a usable report' \
              'the cap is one instead of three when the plan has no locatable spec' \
              '| no locatable spec | check (3) | `**Note:** clause-vs-spec check not run — no locatable spec` |' \
              '| no `**Global Constraints:**` block | check (5) and the run of sentences from `For check (5) report ONE finding` up to, but not including, the sentence beginning `Coverage, ambiguity, feasibility`, which carries the `coverage: GC<k>` shape | `**Note:** Global Constraints sweep not run — no block` |' \
              'the run of sentences that starts at `For check (5) report ONE finding` and runs up to, but not including, the sentence beginning `Coverage, ambiguity, feasibility`' \
              '| no task carries `**Contract:**` | check (4) | `**Note:** Contract check not run — no Contract fields` |' \
              'Removing a clause never renumbers the checks that remain: the numbers of the surviving checks are left exactly as they are' \
              '1-based position among the plan'"'"'s `**Global Constraints:**` block'"'"'s top-level list items' \
              'repeated or out-of-range `<k>` counts as a missing line for the position it skips' \
              'A **readiness pass** is one review dispatched under the lens `Execution readiness`: M reviewers filled from `reviewer-prompt.md` with `[LENS_NAME]` = `Execution readiness`, `[LENS_INSTRUCTIONS]` = that lens'"'"'s `plan:` cell and `[ROUND]` = `readiness <pre|post> <p>`, every other placeholder as a rotating round fills it' \
              'Invalid N (not an integer 0–10) → tier 2, else tier 3.' \
              'N = 0 → skip the rotating loop, log;'; do
  assert_folded_contains "multi-doc-review SKILL.md: procedure carries '$needle'" "$DOC_SKILL" "$needle"
done
assert_folded_contains "multi-doc-review SKILL.md: the N parameter keeps its N=0 sentence" "$DOC_SKILL" 'N = 0 skips the loop and logs a `skipped` entry.'
# The After-the-loop step must trigger the post-sequence in place, symmetric
# with the pre-sequence trigger at the round loop's firing site.
assert_folded_contains "multi-doc-review SKILL.md: After-the-loop step triggers the readiness post-sequence" "$DOC_SKILL" 'For a plan document, the post-sequence of `Readiness sequences` (below) runs first, before the self-review'
# The post-sequence trigger must carry the same resume guard as the
# pre-sequence trigger — otherwise a resume after the post-sequence ended
# re-runs it before falling into the self-review.
assert_folded_contains "multi-doc-review SKILL.md: post-sequence trigger carries a resume guard" "$DOC_SKILL" 'no post-sequence, and on a resume the resume rule of `Readiness entries` decides whether it has already ended.'
# The readiness prose must never spell the cell title in bold: section 12
# resolves the cell by the first `**Execution readiness**` line in the file.
READINESS_BOLD_COUNT="$(grep -cF -- '**Execution readiness**' "$DOC_SKILL" | tr -d ' ')"
assert_eq "multi-doc-review SKILL.md: exactly one bold Execution readiness title (the lens cell)" "$READINESS_BOLD_COUNT" "1"
# Position: the subsection must land in the Procedure, after the After-the-loop
# step and before the Lens Rotation heading. Without this, a subsection dropped
# into the wrong section passes every needle above.
SEQ_LINE="$(first_line_of "$DOC_SKILL" '### Readiness sequences (plan documents only)')"
AFTER_LOOP_LINE="$(first_line_of "$DOC_SKILL" '**After the loop:**')"
LENS_ROT_LINE="$(first_line_of "$DOC_SKILL" '## Lens Rotation')"
if [ -n "$SEQ_LINE" ] && [ -n "$AFTER_LOOP_LINE" ] && [ -n "$LENS_ROT_LINE" ] &&
   [ "$SEQ_LINE" -gt "$AFTER_LOOP_LINE" ] && [ "$SEQ_LINE" -lt "$LENS_ROT_LINE" ]; then
  ok "Readiness sequences subsection sits after **After the loop:** and before Lens Rotation (line $SEQ_LINE)"
else
  bad "Readiness sequences subsection is misplaced (after-loop='$AFTER_LOOP_LINE' seq='$SEQ_LINE' lens-rotation='$LENS_ROT_LINE')"
fi
# The Lens Rotation table must never gain an Execution readiness row: the
# release's promise that the readiness pass is uncounted in N would break
# with the suite still green.
LENS_INSTR_LINE="$(first_line_of "$DOC_SKILL" '## Lens Instructions')"
LENS_ROTATION_RANGE="$WORK/lens-rotation-table.txt"
if [ -n "$LENS_ROT_LINE" ] && [ -n "$LENS_INSTR_LINE" ] && [ "$LENS_ROT_LINE" -lt "$LENS_INSTR_LINE" ]; then
  extract_lines "$DOC_SKILL" "$LENS_ROT_LINE" "$LENS_INSTR_LINE" > "$LENS_ROTATION_RANGE"
else
  : > "$LENS_ROTATION_RANGE"
  bad "multi-doc-review SKILL.md: Lens Rotation table range could not be resolved (lens-rotation='$LENS_ROT_LINE' lens-instructions='$LENS_INSTR_LINE')"
fi
assert_folded_not_contains "multi-doc-review SKILL.md: Lens Rotation table does not list Execution readiness" "$LENS_ROTATION_RANGE" 'Execution readiness'

bold "14. Triage of a readiness finding"
# Position: the triage subsection follows the sequences subsection and still
# precedes the Lens Rotation heading.
TRIAGE_LINE="$(first_line_of "$DOC_SKILL" '### Triage of a readiness finding')"
SEQ_LINE_14="$(first_line_of "$DOC_SKILL" '### Readiness sequences (plan documents only)')"
LENS_ROT_LINE_14="$(first_line_of "$DOC_SKILL" '## Lens Rotation')"
if [ -n "$TRIAGE_LINE" ] && [ -n "$SEQ_LINE_14" ] && [ -n "$LENS_ROT_LINE_14" ] &&
   [ "$TRIAGE_LINE" -gt "$SEQ_LINE_14" ] && [ "$TRIAGE_LINE" -lt "$LENS_ROT_LINE_14" ]; then
  ok "Triage subsection sits after the sequences subsection and before Lens Rotation (line $TRIAGE_LINE)"
else
  bad "Triage subsection is misplaced (seq='$SEQ_LINE_14' triage='$TRIAGE_LINE' lens-rotation='$LENS_ROT_LINE_14')"
fi
# Scope the needle loop below to the triage subsection itself: without this,
# a needle that also matches text elsewhere in the file stays green when the
# subsection's own copy of that text is deleted.
TRIAGE_RANGE="$WORK/triage-of-a-readiness-finding.txt"
if [ -n "$TRIAGE_LINE" ] && [ -n "$LENS_ROT_LINE_14" ] && [ "$TRIAGE_LINE" -lt "$LENS_ROT_LINE_14" ]; then
  extract_lines "$DOC_SKILL" "$TRIAGE_LINE" "$LENS_ROT_LINE_14" > "$TRIAGE_RANGE"
else
  : > "$TRIAGE_RANGE"
  bad "multi-doc-review SKILL.md: Triage of a readiness finding range could not be resolved (triage='$TRIAGE_LINE' lens-rotation='$LENS_ROT_LINE_14')"
fi
for needle in 'rejected: not a conflict' \
              'rejected: plan-mandated' \
              'rejected: undecidable at this gate' \
              'out of lens scope' \
              'A readiness finding never produces an unresolved: line, in any caller.' \
              'reverses an amendment made earlier in the same sequence' \
              '`rejected: plan-mandated — <text>`, never amended' \
              'amend the plan side, `applied`' \
              'amend the side the spec decides against; failing that, the side the Global Constraints block decides against' \
              'the spec contradicts itself' \
              'without searching for a second side'; do
  assert_folded_contains "multi-doc-review SKILL.md: Triage of a readiness finding subsection carries '$needle'" "$TRIAGE_RANGE" "$needle"
done
# These needles pin text that lives in the skill's Error Handling section,
# not the triage subsection above; no narrower already-resolved range holds
# them, so they stay asserted against the whole file.
for needle in 'Readiness pass whose reports are all unusable (u = 0) → `inconclusive`, and the pass is open' \
              'a readiness entry with a missing or malformed' \
              'as a round is' \
              'for a plan document the Execution readiness pre-sequence still runs'; do
  assert_folded_contains "multi-doc-review SKILL.md: Error Handling section carries '$needle'" "$DOC_SKILL" "$needle"
done

bold "15. Readiness log entries, completeness, resume and the completion report"
assert_file_has_line "multi-doc-review SKILL.md: readiness entry heading shape" "$DOC_SKILL" '## Readiness <pre|post> <p> — Execution readiness — <model>'
assert_file_has_line "multi-doc-review SKILL.md: readiness entry result line" "$DOC_SKILL" '**Result:** <settled|open>'
# The silent-failure guard the skill names for itself: keying completeness on
# the absence of a `## Readiness` heading would misclassify an invocation
# interrupted during pass 1 of its pre-sequence as pre-release, silently.
assert_folded_contains "multi-doc-review SKILL.md: never key completeness on the absence of a Readiness heading" "$DOC_SKILL" \
  '**Never use the absence of a `## Readiness` heading as that test.**'
# Without this pinned, deleting the sentence would let a readiness entry take
# the round-entry body including a `**Converged:**` line, and the
# once-per-gate recognition rule (which counts `**Converged:** yes` at the
# start of a line of a round entry) would then read a readiness entry as a
# converged round entry.
assert_folded_contains "multi-doc-review SKILL.md: readiness entry body carries no Converged line" "$DOC_SKILL" \
  'The rest of the entry is the round-entry body above under the same rules, with no `**Converged:**` line.'
# The plan variant of the invocation line must exist as its own whole line,
# and the writing step must be told to emit the field: without both, the
# plan-blob comparison is inert because no entry ever carries the field.
assert_file_has_line "multi-doc-review SKILL.md: plan invocation-line shape carries plan-blob" "$DOC_SKILL" \
  '_Invocation <k> — YYYY-MM-DD — N=<n> M=<m> — <invoker> — plan-blob <sha>_   <!-- plan documents -->'
assert_file_has_line "multi-doc-review SKILL.md: the non-plan invocation-line shape is unchanged" "$DOC_SKILL" \
  '_Invocation <k> — YYYY-MM-DD — N=<n> M=<m> — <invoker>_'
for needle in '**Host self-review:** done' \
              'r counts ## Round headings only.' \
              'open (all inconclusive)' \
              '`Owed:` block' \
              'gains ` — superseded` at the end of its heading' \
              'has ended' \
              'compared as whole words' \
              'Readiness pre:' \
              'Readiness post:' \
              'Readiness conflicts applied:' \
              'Readiness conflicts owed:' \
              'rounds=0 outcome=cap unresolved=0' \
              'the invocation line, the one-line `skipped` entry, the readiness entries of the pre-sequence, then the self-review marker' \
              'git hash-object' \
              'the plan'"'"'s content hash as a trailing `plan-blob <sha>` field' \
              'counts as changed, so it never blocks'; do
  assert_folded_contains "multi-doc-review SKILL.md: log format carries '$needle'" "$DOC_SKILL" "$needle"
done
# The 'has ended' needle above is also matched by two unrelated sentences
# ("its pre-sequence has ended and the self-review marker is present" /
# "its pre-sequence has ended, its post-sequence has ended"), so it stays
# green even if the sequence-end definition sentence itself is deleted or
# reworded. Pin the definition sentence itself with a fragment that occurs
# once in the file, so removing or rewording it turns this suite red.
assert_folded_contains "multi-doc-review SKILL.md: sequence-end definition sentence is present" "$DOC_SKILL" 'A sequence **has ended** when its last pass reads'
assert_folded_contains "multi-doc-review SKILL.md: completion report keeps the harness line" "$DOC_SKILL" 'Harness probes owed:'
# Issues-log row 23: a deliberate spec deviation made by the plan review
# reached the user only through excluded state. The controller now writes
# one fixed line under the disposition or self-review note that made the
# deviation, and the completion report always carries a `Spec deviations:`
# line; the orchestrator's Phase 5 report scans the log for that shape.
assert_file_has_line "multi-doc-review SKILL.md: the spec deviation line shape" "$DOC_SKILL" \
  '- spec deviation: <what the plan now says> — spec: <what the spec says> (<spec path>) — <why kept>'
assert_folded_contains "multi-doc-review SKILL.md: the spec deviation line is the only carrier" "$DOC_SKILL" \
  'That line is the durable record and the only carrier'
assert_folded_contains "multi-doc-review SKILL.md: a prose remark never replaces the line" "$DOC_SKILL" \
  'a prose remark such as "flag this to the user" never replaces it'
assert_folded_contains "multi-doc-review SKILL.md: completion report always carries Spec deviations:" "$DOC_SKILL" \
  'or `Spec deviations: none`. Both lines are always written; a report without either is defective.'
# The compact orchestration report shape, and the gate value it depends on,
# carry no assertion elsewhere: pin both so the path this pipeline actually
# runs (gate: orchestration) stays covered.
assert_folded_contains "multi-doc-review SKILL.md: gate: orchestration writes the compact readiness-owed note" "$DOC_SKILL" \
  'the controller writes at most one note instead, `readiness owed: <n>`'
assert_folded_contains "multi-doc-review SKILL.md: invocation note admits the gate: orchestration invoker" "$DOC_SKILL" \
  '`gate: writing-plans` | `gate: orchestration` | `direct`'
# Position: the readiness-entries subsection is the last block of the Review
# Log Format section, standing after the Skipped-invocations paragraph and
# immediately before the Error Handling heading.
RDY_ENTRIES_LINE="$(first_line_of "$DOC_SKILL" '### Readiness entries')"
SKIPPED_LINE="$(first_line_of "$DOC_SKILL" 'Skipped invocations (N=0)')"
ERR_HANDLING_LINE="$(first_line_of "$DOC_SKILL" '## Error Handling')"
if [ -n "$RDY_ENTRIES_LINE" ] && [ -n "$SKIPPED_LINE" ] && [ -n "$ERR_HANDLING_LINE" ] &&
   [ "$RDY_ENTRIES_LINE" -gt "$SKIPPED_LINE" ] && [ "$RDY_ENTRIES_LINE" -lt "$ERR_HANDLING_LINE" ]; then
  ok "Readiness entries subsection sits after the Skipped-invocations paragraph and before Error Handling (line $RDY_ENTRIES_LINE)"
else
  bad "Readiness entries subsection is misplaced (skipped='$SKIPPED_LINE' entries='$RDY_ENTRIES_LINE' error-handling='$ERR_HANDLING_LINE')"
fi
# The once-per-gate N=0 sentence must be narrowed to spec/general documents,
# so the file never carries two rules for the same input.
assert_folded_contains "multi-doc-review SKILL.md: once-per-gate N=0 sentence is narrowed" "$DOC_SKILL" \
  'For a `spec` or a `general` document, an entry whose recorded N is `0`'
assert_folded_contains "multi-doc-review SKILL.md: once-per-gate defers a plan N=0 entry to Readiness entries" "$DOC_SKILL" \
  'For a plan document a skipped run still ran the readiness pre-sequence'
# The unnarrowed sentence must be gone, or the file carries two rules for one
# input. Folded, because the sentence wraps across line breaks in the file.
assert_folded_not_contains "multi-doc-review SKILL.md: the unnarrowed N=0 once-per-gate sentence is gone" "$DOC_SKILL" \
  'An entry whose recorded N is `0` (a skipped entry) does not block'
# The Otherwise entry condition must carry the same narrowing, or the file
# states two rules for a plan resume with N=0.
assert_folded_contains "multi-doc-review SKILL.md: Otherwise entry condition narrows the N=0 resume clause" "$DOC_SKILL" \
  '`N=0` on a resume of a `spec` or a `general` document above'
# The On-a-resume narrowing: a plan document treats N = 0 as an ordinary
# value that continues under Readiness entries, rather than being abandoned
# under Otherwise the way a spec or general document is. Without these
# pinned, a later edit could revert the clause and a plan resume with N = 0
# would fall through to Otherwise, appending a second invocation note and
# re-running the whole pre-sequence.
assert_folded_contains "multi-doc-review SKILL.md: On a resume narrows plan N=0 to an ordinary value" "$DOC_SKILL" \
  'For a plan document N = 0 is an ordinary value'
assert_folded_contains "multi-doc-review SKILL.md: On a resume routes plan N=0 under the resume order" "$DOC_SKILL" \
  'continues the interrupted entry under the resume order'
assert_folded_contains "multi-doc-review SKILL.md: On a resume keeps the narrowed spec-and-general form" "$DOC_SKILL" \
  'For a `spec` or a `general` document, `N=0` abandons the interrupted entry instead of resuming it and is handled under **Otherwise** below (which logs the `skipped` entry), not here.'
# The plan-blob rewrite must be ordered where the marker is written, because a
# resume enters at On a resume and never reads the Otherwise branch.
assert_folded_contains "multi-doc-review SKILL.md: the marker site orders the plan-blob rewrite" "$DOC_SKILL" \
  'you rewrite the invocation line'"'"'s `plan-blob` value to what `git hash-object "<plan path>"`'
# The marker site must restrict its subject the way the once-per-gate test and
# the resume order already do. Unrestricted, a resume of a pre-release plan
# entry stamps the marker and a new plan-blob field into an entry an earlier
# release wrote, and the next invocation then reads that entry as one this
# release wrote and runs a pre-sequence the plan never owed.
assert_folded_contains "multi-doc-review SKILL.md: the marker site excludes a pre-release plan entry" "$DOC_SKILL" \
  'For a plan document whose invocation line carries a `plan-blob` field, at that same moment you rewrite the invocation line'"'"'s `plan-blob` value to what `git hash-object "<plan path>"` prints then; a plan entry with no such field owes neither the field nor the marker'
# The resume paragraph must not state that the whole invocation line is
# frozen: the marker site rewrites one field of it, and a controller reads
# the resume paragraph first.
assert_folded_contains "multi-doc-review SKILL.md: the resume rule names the plan-blob exception" "$DOC_SKILL" \
  'The `plan-blob` field is the one exception: it is rewritten once, at the marker'
# A complete N = 0 plan entry must not block a later invocation that asks for
# rotating rounds: without this clause the entry is complete, the once-per-gate
# step refuses to re-run the loop, and a requested review is silently skipped.
assert_folded_contains "multi-doc-review SKILL.md: a complete N=0 plan entry never blocks an N>=1 invocation" "$DOC_SKILL" \
  'A complete N = 0 plan entry never blocks a later invocation whose N is 1 or more'
# The once-per-gate interrupted test must carry the same (N >= 1) qualifier the
# Resume paragraph uses. Without it, an N = 0 plan entry runs no post-sequence,
# that sequence never "has ended", and the clause routes a complete entry to
# On a resume — the opposite of the rule stated under Readiness entries.
assert_folded_contains "multi-doc-review SKILL.md: the once-per-gate interrupted test qualifies the post-sequence with N>=1" "$DOC_SKILL" \
  'whose post-sequence has not ended (N ≥ 1) or whose self-review marker is absent'
# The subject of that same interrupted test must be restricted to entries
# this release wrote. Without the restriction, a pre-release entry — which
# never carries the self-review marker — is routed to On a resume and made to
# run a host self-review the gate does not owe.
assert_folded_contains "multi-doc-review SKILL.md: the once-per-gate interrupted test only classifies entries this release wrote" "$DOC_SKILL" \
  'calls interrupted only an entry this release wrote (its invocation line carries a `plan-blob` field)'
# ... and it must state the route for an entry without the field, or that
# input has no route at all.
assert_folded_contains "multi-doc-review SKILL.md: the once-per-gate interrupted test sends a pre-release plan entry to Readiness entries" "$DOC_SKILL" \
  'An entry with no `plan-blob` field owes no marker, and `Readiness entries` decides it.'
# The resume order must carry the same restriction as the once-per-gate test:
# a pre-release plan entry owes no marker, so the marker-absent stage must not
# make it run a host self-review and stamp a marker into an older entry.
assert_folded_contains "multi-doc-review SKILL.md: the resume order restricts the marker-absent stage to entries this release wrote" "$DOC_SKILL" \
  'marker absent on an entry whose invocation line carries a `plan-blob` field → the host self-review, then the marker. An entry with no such field skips that stage, because it owes no marker.'
# A pre-release entry must not be described with the word the same paragraph
# defines as a comparison, because that paragraph gives such an entry the
# opposite outcome (it counts as changed).
assert_folded_contains "multi-doc-review SKILL.md: a pre-release entry is decided by the pre-release rule, not called unchanged" "$DOC_SKILL" \
  'the once-per-gate rule decides it, as that rule stood before this release.'

bold "16. multi-doc-review SKILL.md stays inside its size budget"
# The Phase 2 controller and the writing-plans host session read this file
# whole. Measured: 788 lines before 7.14.0, the Execution readiness feature
# added 291 (1079 lines); the spec-deviation line of 7.16.0 added 17 and
# recovered 22 by reflowing Procedure step 3 at 88 columns, so the file
# stood at 1075 under the 1080 maximum; the repository-premise clause of the
# Correctness plan cell (orchestration issue row 8) added 3, so it stands at
# 1078. Figure set by release 7.14.0; it supersedes the
# 938 the design document names, because the plan review added five
# corrections whose prose the smaller figure could not hold. A further
# addition must first recover lines by reflowing, per the plan's Global
# Constraint 1.
MDR_MAX_LINES=1080
MDR_LINES="$(awk 'END { print NR }' "$DOC_SKILL")"
if [ "$MDR_LINES" -le "$MDR_MAX_LINES" ]; then
  ok "multi-doc-review SKILL.md is $MDR_LINES lines (max $MDR_MAX_LINES)"
else
  bad "multi-doc-review SKILL.md is $MDR_LINES lines, over the $MDR_MAX_LINES-line budget"
fi

bold "17. The doc-review-loop controller template accepts N_PLAN = 0"
DOC_LOOP_PROMPT="$ROOT/skills/orchestrating-development/doc-review-loop-prompt.md"
assert_file_contains "doc-review-loop template: [N_PLAN] range starts at 0" "$DOC_LOOP_PROMPT" '`[N_PLAN]` — REQUIRED: integer 0–10'
assert_folded_contains "doc-review-loop template: host self-review after the post-sequence" "$DOC_LOOP_PROMPT" 'The host self-review runs after the post-sequence.'
assert_folded_contains "doc-review-loop template: counts rotating entries only" "$DOC_LOOP_PROMPT" 'count rotating entries only'
assert_folded_contains "doc-review-loop template: defers to the skill's completeness rule" "$DOC_LOOP_PROMPT" "the skill's completeness rule"
assert_folded_contains "doc-review-loop template: Deviation 3 is unchanged" "$DOC_LOOP_PROMPT" 'A Critical/Important finding is `unresolved` only when applying it was attempted and failed twice'
assert_folded_contains "doc-review-loop template: controller may run read-only inspection commands" "$DOC_LOOP_PROMPT" "run the read-only inspection commands the skill's procedure names"
# The background-read exemption elsewhere (its one command prints a single
# line) holds only because the controller's read-only allowance is itself
# restricted to one command. Pin that restriction so a later widening of the
# allowed command set does not silently invalidate the exemption.
assert_folded_contains "doc-review-loop template: the read-only allowance is restricted to one command" "$DOC_LOOP_PROMPT" \
  'today that is one command, `git hash-object "<plan path>"`, and nothing else.'
assert_folded_contains "doc-review-loop template: readiness finding disposed under triage, never logged as unresolved" "$DOC_LOOP_PROMPT" "A readiness finding is disposed under the skill's \"Triage of a readiness finding\", never logged as unresolved."
assert_folded_contains "doc-review-loop template: appends the Loop complete line when it is absent" "$DOC_LOOP_PROMPT" 'and append the `_Loop complete_` line when it is absent.'
# Deviation 2's completeness rule reaches an entry written by an earlier
# release through one of its own clauses, not through a special case in this
# template: pin that clause so deleting it from the template cannot leave
# every suite green.
assert_folded_contains "doc-review-loop template: the earlier-release clause of the completeness rule owes no post-sequence" "$DOC_LOOP_PROMPT" 'by whichever of its clauses applied, the clause for an entry written by an earlier release included, which owes no post-sequence'

bold "18. The Read tool's limit is stated as measured: about 25,000 tokens per call, then a PARTIAL notice"
# Both files once claimed "at most 2000 lines by default". The measured
# behaviour is a token cap: one call returns about 25,000 tokens and prints a
# PARTIAL notice naming the next offset. Pin the corrected sentence and the
# absence of the line-count claim in both files.
TOKEN_EFFICIENCY_SKILL="$ROOT/skills/token-efficiency/SKILL.md"
assert_folded_contains "multi-code-review: the failure-text cap names the Read tool's token limit" "$CODE_SKILL" \
  'one Read tool call returns about 25,000 tokens at most and then prints a PARTIAL notice naming the next offset'
assert_file_not_contains "multi-code-review: no 'at most 2000 lines' claim remains" "$CODE_SKILL" 'at most 2000 lines'
assert_folded_contains "token-efficiency: rule 6 names the PARTIAL notice and the next offset" "$TOKEN_EFFICIENCY_SKILL" \
  'prints a PARTIAL notice naming the next `offset`'
assert_file_not_contains "token-efficiency: no '2,000 lines' claim remains" "$TOKEN_EFFICIENCY_SKILL" '2,000 lines'

bold "19. Every reviewer template pages its files with the Read tool until no PARTIAL notice remains"
# Row 26 measured 22 partial Read views on two transcripts, all by reviewers
# or a code-review controller, and 21 of 21 controller `cat` calls persisted
# to a 2 KB preview. The paging rule stands inside each prompt block (the only
# part the fill script copies), directly after the hand-over sentence.
PAGING_TEMPLATES=("$CODE_PROMPT" "$SDD_TASK_REVIEWER" "$DOC_PROMPT")
for f in "${PAGING_TEMPLATES[@]}"; do
  name="${f#"$ROOT"/skills/}"
  body="$WORK/paging-body-$(echo "$name" | tr '/' '_').txt"
  extract_prompt_body "$f" > "$body"
  if [ -s "$body" ]; then ok "$name: prompt body extract is non-empty"; else bad "$name: prompt body extract is empty (no '$PROMPT_OPEN' block)"; fi
  assert_folded_contains "$name: prompt body names the Read tool and forbids a shell command" "$body" "$READ_TOOL_NOT_SHELL"
  assert_folded_contains "$name: prompt body pages until no PARTIAL notice remains" "$body" "$PAGE_UNTIL_NO_PARTIAL"
  assert_folded_contains "$name: prompt body halves the limit when a call is refused for size" "$body" "$HALVE_ON_REFUSAL"
  assert_folded_contains "$name: prompt body exempts a file only passed on by path" "$body" "$PASS_ON_BY_PATH"
done
for f in "$CODE_PROMPT" "$SDD_TASK_REVIEWER"; do
  assert_folded_not_contains "${f#"$ROOT"/skills/}: no longer says '$DIFF_ONCE_OLD'" "$f" "$DIFF_ONCE_OLD"
done

bold "20. The SDD per-task flow names both worker templates in the steps that dispatch them"
# Row 28: the implementer step named no template while the reviewer step did,
# so a batch controller composed the implementer prompt from scratch. Both
# dispatch steps now name the template file the controller must fill.
assert_folded_contains "subagent-driven-development SKILL.md: the implementer step names implementer-prompt.md" \
  "$SDD_SKILL" 'dispatch the implementer (`./implementer-prompt.md`)'
assert_folded_contains "subagent-driven-development SKILL.md: the reviewer step still names task-reviewer-prompt.md" \
  "$SDD_SKILL" 'dispatch the single task reviewer (`./task-reviewer-prompt.md`)'

bold "21. The Correctness plan cell tests a repository premise instead of trusting it"
# Row 8: three plan rulings in twelve runs came from a task that relied on
# CLAUDE.md being tracked by git, while `.gitignore` ignores it. The check sits
# in the round-1 lens because every logged plan review ran round 1, while 7 of
# 16 ran only two rounds and never reached the Feasibility lens.
CORR_PLAN_CELL="$WORK/correctness-plan-cell.txt"
extract_plan_cell "Correctness & completeness" "$CORR_PLAN_CELL"
assert_folded_contains "Correctness plan cell: names a task that commits a path" \
  "$CORR_PLAN_CELL" 'a task that commits a path'
assert_folded_contains "Correctness plan cell: names the tracked-file test command" \
  "$CORR_PLAN_CELL" 'git ls-files --error-unmatch'
assert_folded_contains "Correctness plan cell: names the ignored-file test command" \
  "$CORR_PLAN_CELL" 'git check-ignore -v'
assert_folded_contains "Correctness plan cell: reports a premise only on a contradicting output" \
  "$CORR_PLAN_CELL" 'report the task only when the output contradicts the plan'

bold "22. Code reviewer: the Checks Run section goes to a file, not into the final message (row 14 fix 3)"
# The returned report is the text that enters the controller's context window.
# The controller never reads the Checks Run section, so the reviewer writes the
# full report to a file it creates with mktemp (no arguments) and returns the
# report without that section, naming the file on the last line.
CHECKS_TO_FILE='Your final message is the report without its Checks Run section'
MKTEMP_ALONE='Run the command `mktemp` alone: no arguments, and no other command on the same line'
MKTEMP_GIT_BASH='convert the path once with `cygpath -m "<printed path>"` as its own command'
WRITE_WITH_WRITE_TOOL='Write the full report to that path with the Write tool'
NEVER_DIFF_PATH='never to a path named in the diff'
ONLY_FILE_OUTSIDE_CHECKOUT='Create no other file with the Write tool. That file is not in the checkout'
FULL_REPORT_LAST_LINE='its last line is `Full report:'
FALLBACK_WRITE_REFUSED='If the Write is refused because the report holds a value that looks like a credential, replace that value by a description'
FALLBACK_KEEP_CHECKS='put the full report, Checks Run section included, in your final message'
FALLBACK_LAST_LINE='Full report: not written — <reason>`, where reason is one of `mktemp failed` or `write refused`'
CONTROLLER_NEVER_LOGS_PATH='either form is not a finding, the controller never reads that file, and the path is never logged'
CODE_BODY="$WORK/code-body.txt"
extract_prompt_body "$CODE_PROMPT" > "$CODE_BODY"
if [ -s "$CODE_BODY" ]; then ok "code-review template: prompt body extract is non-empty"; else bad "code-review template: prompt body extract is empty"; fi
assert_folded_contains "code-review template: Checks Run leaves the final message" "$CODE_BODY" "$CHECKS_TO_FILE"
assert_folded_contains "code-review template: the report file is created by mktemp with no arguments" "$CODE_BODY" "$MKTEMP_ALONE"
assert_folded_contains "code-review template: the path is converted once on Git Bash" "$CODE_BODY" "$MKTEMP_GIT_BASH"
assert_folded_contains "code-review template: the full report is written with the Write tool" "$CODE_BODY" "$WRITE_WITH_WRITE_TOOL"
assert_folded_contains "code-review template: never a path named in the diff" "$CODE_BODY" "$NEVER_DIFF_PATH"
assert_folded_contains "code-review template: no other file is created and the report file is outside the checkout" "$CODE_BODY" "$ONLY_FILE_OUTSIDE_CHECKOUT"
assert_folded_contains "code-review template: the final message ends with the report path" "$CODE_BODY" "$FULL_REPORT_LAST_LINE"
assert_folded_contains "code-review template: a Write refused for a credential-like value is retried with the value replaced" "$CODE_BODY" "$FALLBACK_WRITE_REFUSED"
assert_folded_contains "code-review template: the fallback keeps Checks Run in the final message" "$CODE_BODY" "$FALLBACK_KEEP_CHECKS"
assert_folded_contains "code-review template: the fallback last line is pinned" "$CODE_BODY" "$FALLBACK_LAST_LINE"
assert_folded_contains "code-review template: the returns legend names the report file" "$CODE_PROMPT" 'the path of the full report file'
assert_folded_not_contains "code-review template: the returns legend no longer lists checks run" "$CODE_PROMPT" 'with file:line references, checks run,'
assert_folded_contains "multi-code-review step 3: the Full report line is not a finding and its path is never logged" "$CODE_VALIDATE_RANGE" "$CONTROLLER_NEVER_LOGS_PATH"

echo
bold "A reviewer's own diff read turns off configured helper programs (worklist row 54)"

# When the diff file is missing, a reviewer fetches the diff itself. A
# repository can configure a helper program for a diff (a textconv filter or
# an external diff driver), and git then prints the helper's output instead of
# the code. Each fallback read must carry both options, and each file must
# state the rule and its reason, so a later edit cannot keep the options and
# lose the reason.
REQUESTING_REVIEWER="$ROOT/skills/requesting-code-review/code-reviewer.md"
GUARD_OPTIONS='--no-ext-diff --no-textconv'
# A content read, found by its shape and not by one spelling: `git`, then any
# global options (`--no-pager`), then `diff`, `show` or `log -p`.
CONTENT_READ_RE='git( -[^ ]+)* (diff|show|log -p)'
NAMES_ONLY_RE="$CONTENT_READ_RE --name-only"
HELPER_RULE='Keep `--no-ext-diff --no-textconv` on every diff you run yourself'
# The skill file speaks to the orchestrator, not to the reviewer, so it words
# the same rule differently.
HELPER_RULE_SKILL='each carrying `--no-ext-diff --no-textconv`'
HELPER_REASON="prints the helper's output instead of the code"

count_folded_re() { # file extended-regex -> number of matches across line breaks
  fold_file "$1" | grep -oE -- "$2" | wc -l | tr -d ' '
}
# Number of content reads in file $1 that lack the two options. A name-only
# read prints file names and runs no helper program, so it is not counted.
unguarded_reads() { # file
  local all names guarded
  all=$(count_folded_re "$1" "$CONTENT_READ_RE")
  names=$(count_folded_re "$1" "$NAMES_ONLY_RE")
  guarded=$(count_folded_re "$1" "$CONTENT_READ_RE $GUARD_OPTIONS")
  echo $((all - names - guarded))
}
assert_diff_reads_guarded() { # desc file rule-sentence
  local guarded
  guarded=$(count_folded_re "$2" "$CONTENT_READ_RE $GUARD_OPTIONS")
  if [ "$guarded" -gt 0 ]; then ok "$1: holds a content read with both options ($guarded)"; else bad "$1: no content read with both options"; fi
  assert_eq "$1: no content read lacks the two options" "$(unguarded_reads "$2")" "0"
  # The opposite options, written later on the same command, turn the helper
  # programs on again. The leading blank keeps `--no-ext-diff` from matching.
  assert_folded_not_contains "$1: never turns an external diff driver on" "$2" " --ext-diff"
  assert_folded_not_contains "$1: never turns a textconv filter on" "$2" " --textconv"
  assert_folded_contains "$1: states the rule" "$2" "$3"
  assert_folded_contains "$1: states the reason" "$2" "$HELPER_REASON"
}

# The skill file describes the package's diff elsewhere in prose, so only its
# fallback bullet is checked: from the bullet's first line to the next bullet.
CODE_FALLBACK_RANGE="$WORK/code-fallback-range.md"
awk '/^- `review-package` missing or failing/ { on = 1; print; next } on && /^- / { exit } on { print }' "$CODE_SKILL" > "$CODE_FALLBACK_RANGE"

# Outside the fallback bullet the skill file names the package's two-dot diff
# once, in prose, as a description and not as a command to run. Any further
# content read without the two options changes this count.
CODE_SKILL_PROSE_MENTIONS=1
assert_eq "multi-code-review SKILL.md: no new content read without the two options" "$(unguarded_reads "$CODE_SKILL")" "$CODE_SKILL_PROSE_MENTIONS"
assert_diff_reads_guarded "multi-code-review reviewer template" "$CODE_PROMPT" "$HELPER_RULE"
assert_diff_reads_guarded "multi-code-review SKILL.md no-package fallback" "$CODE_FALLBACK_RANGE" "$HELPER_RULE_SKILL"
assert_diff_reads_guarded "task reviewer template" "$SDD_TASK_REVIEWER" "$HELPER_RULE"
assert_diff_reads_guarded "requesting-code-review reviewer template" "$REQUESTING_REVIEWER" "$HELPER_RULE"

bold "23. Report Marker: each skill keeps its report marker because it parses reports from it (the subagent guard was removed)"
# Print the level-two section of file $1 whose heading line is $2: from that
# line up to, but not including, the next level-two heading, or to the end of
# the file. Empty when the heading is absent. The heading reaches awk through
# the environment so that no character of it is reinterpreted.
extract_section() { # file heading
  heading="$2" awk 'BEGIN { h = ENVIRON["heading"] } $0 == h { on = 1; print; next } on && /^## / { exit } on { print }' "$1"
}
check_marker_section() { # label file reason-sentence never-remove-sentence whole-section
  local range="$WORK/report-marker-section.txt"
  extract_section "$2" "$H_REPORT_MARKER" > "$range"
  if [ -s "$range" ]; then ok "$1: has the section '$H_REPORT_MARKER'"; else bad "$1: no section '$H_REPORT_MARKER'"; fi
  assert_folded_contains "$1: Report Marker gives the parsing reason" "$range" "$3"
  assert_folded_contains "$1: Report Marker keeps the never-remove rule" "$range" "$4"
  # A blank line above the next heading folds into a trailing space.
  assert_eq "$1: Report Marker holds these sentences and no other" \
    "$(fold_file "$range" | sed 's/ *$//')" "$5"
}
check_marker_section "multi-code-review SKILL.md" "$CODE_SKILL" "$CODE_MARKER_REASON" "$REVIEW_MARKER_RULE" "$CODE_MARKER_SECTION"
check_marker_section "multi-doc-review SKILL.md" "$DOC_SKILL" "$DOC_MARKER_REASON" "$REVIEW_MARKER_RULE" "$DOC_MARKER_SECTION"
check_marker_section "researching-prior-art SKILL.md" "$RESEARCH_SKILL" "$RESEARCH_MARKER_REASON" "$RESEARCH_MARKER_RULE" "$RESEARCH_MARKER_SECTION"
assert_folded_contains "multi-code-review reviewer template: the marker is load-bearing for the validation step" \
  "$CODE_PROMPT" "$CODE_PROMPT_MARKER_REASON"
assert_folded_contains "multi-doc-review reviewer template: the marker is load-bearing for the validation step" \
  "$DOC_PROMPT" "$DOC_PROMPT_MARKER_REASON"

echo
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
exit 0
