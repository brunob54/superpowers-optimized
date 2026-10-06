#!/usr/bin/env bash
# orchestrating-development wording test suite: static checks on the
# prompt-pointer dispatch text of skills/orchestrating-development/SKILL.md
# (the orchestrator) and on its four controller prompt templates.
# Pure bash + grep/awk; no claude invocation.
# Windows note: never reads standard input through its device path and uses
# no process substitution (neither is reliable in Git Bash on Windows) —
# extracted text goes through temp files.
#
# Contract source: docs/superpowers-orchestrator/2026-09-06-orchestrator-prompt-pointer/
# specs/orchestrator-prompt-pointer-design.md, section "Testing strategy"
# item 2.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ORCH_DIR="$ROOT/skills/orchestrating-development"
ORCH_SKILL="$ORCH_DIR/SKILL.md"
TEMPLATES=(plan-writer-prompt.md doc-review-loop-prompt.md batch-controller-prompt.md code-review-loop-prompt.md)
# The three templates that carry a `## Resume Answer` section.
RESUME_TEMPLATES=(plan-writer-prompt.md batch-controller-prompt.md code-review-loop-prompt.md)

# Section headings of the orchestrator, matched as whole lines.
H_REQUIRED='## Required Start'
H_DISPATCH='## Controller Dispatch Rules (apply to every phase)'
H_PHASE0='## Phase 0 — Setup (the only interactive moment)'
H_PHASE1='## Phase 1 — Plan Writing'
H_PHASE2='## Phase 2 — Plan Review Loop'
H_PHASE3='## Phase 3 — Implementation Batches'
H_PHASE4='## Phase 4 — Final Code Review Loop'
H_PHASE5='## Phase 5 — Completion'
H_ORCHLOG='## Orchestration Log Format'
H_RESUME='## Resume'
H_INRUN='## In-run rulings'
H_MAJOR='## Major-Error Stop Policy'
H_MARKER='## Report Marker'
H_TEMPLATES='## Prompt Templates'

# Wording contracts. Each is one fixed string.
POINTER_PREFIX='Your complete instructions are in the file'
POINTER_FIRST='Your complete instructions are in the file <ABSOLUTE PATH>.'
POINTER_READ='Read that file once, with the Read tool, before doing anything else, and follow it as your only instructions.'
POINTER_ONLY='Nothing else in that directory is for you; do not read any other file there.'
PROMPT_DIR_VARIABLE='$PROMPT_DIR'
MKTEMP='mktemp -d'
FILL_SCRIPT='fill-prompt.js'
TEST_S='test -s'
NEVER_READS='never read a template'
NEVER_REWRITTEN='written once and never rewritten'
SAME_POINTER='the same pointer to the same file'
NEVER_FAILED_FILE='never dispatch a pointer to a file that failed the check'
NO_FALLBACK='no inline fallback'
VALUE_WITHHELD='`[<id>] (<tag>): <verb and its text up to the quoted value> — <file:line> — secret-bearing finding, value withheld`'
# The withheld-line form before the verb-keeping amendment; must be absent.
VALUE_WITHHELD_OLD_FORM='`[<id>] (<tag>): <file:line> — secret-bearing finding, value withheld`'
# The 10-non-blank-line marker window, pinned positively in both passages
# that state it, and the superseded "hang" claim pinned negatively. `$H_MARKER`
# and `$H_TEMPLATES` already exist in this file (they bound the Major-Error
# Stop Policy range and the Prompt Templates range). `assert_folded_contains`
# joins the file's lines with single spaces before matching, so the window
# fragment matches even where the prose wraps between "10" and "non-blank".
MARKER_WINDOW='first 10 non-blank lines'
GUARD_HANG_OLD_CLAIM='hang the dispatch'
# The subagent guard (a SubagentStop hook) was removed. The marker stays,
# and these two sentences give its only reason now: the orchestrator parses
# a return from the marker line. Each is pinned as a whole sentence.
MARKER_REASON='Never remove the marker instruction from the four templates: a return without the marker is malformed, and a malformed return costs the identical retry and then a major-error stop.'
LOST_RETURNS_REASON="**Lost returns.** You start to read a reviewer's return at its \`<!-- multi-review report -->\` marker line, so a return without that marker cannot be parsed and is lost under the rule below."
# The whole Report Marker section, folded (each blank line folds into two
# spaces), so that an added sentence fails too, a sentence about the removed
# guard included.
MARKER_SECTION="$H_MARKER  Controller returns open with \`<!-- orchestration report -->\`. The Return contract (Controller Dispatch Rules) reads a return only from a line equal to that marker among the first 10 non-blank lines of the final message, so a return that carries a sentence above its marker line is still read. $MARKER_REASON  Nested reviewers inside the two loop controllers emit \`<!-- multi-review report -->\`, which the validation step of multi-doc-review and of multi-code-review looks for among the first 10 non-blank lines of each report. Forks dispatched under \`## In-run rulings\` open their return with that same \`<!-- multi-review report -->\` marker; a fork return without it is a lost return under that section's rule, never a reason to remove the marker instruction from the fork prompt."
# Words of the removed guard text outside that section. None may come back.
GUARD_HOOK_CLAUSE='the hook that also watches for this marker'
GUARD_FORK_LINE='action verb followed by a skill name'
# The Return contract's marker tolerance, pinned in halves so that no later
# edit can restore any of the extremes: the window (with the words
# "non-blank", so that a bare `10` cannot satisfy it), the marker's exact
# spelling, and the 15-line cap's new status as an instruction rather than a
# malformed condition.
RETURN_WINDOW='among the **first 10 non-blank lines**'
RETURN_MARKER='<!-- orchestration report -->'
RETURN_CAP_NOT_MALFORMED='a longer report is **not** malformed'
NO_HEREDOC='never with a heredoc'
# Paging-rule contracts (orchestration issue row 26): every controller
# template hands its skill body over to the Read tool by name, forbids a shell
# command such as `cat`, and ends the paging on a result that carries no
# PARTIAL notice. The two templates that carry the background-output rule
# also state that the rule governs background output files only.
PROMPT_OPEN='  prompt: |'
READ_TOOL_NOT_SHELL='with the Read tool, not with a shell command'
PAGE_UNTIL_NO_PARTIAL='until a result carries no PARTIAL notice'
BACKGROUND_RULE_SCOPE='That rule governs the output files of background commands only'
# The paging step's exit when the Read tool refuses a span for size, and the
# rule for a file the prompt only passes on by path or takes one block from.
HALVE_ON_REFUSAL='halving the limit when a call is refused for size'
PASS_ON_BY_PATH='A file you only pass on by path'
PASTE='paste'
FILL_DOT='Fill `./'
READ_DOT='Read `./'
# `## STOPPED` cause texts of the fatal rows, and the Node row's wording.
CAUSES=(
  'prompt directory could not be created — <error text>'
  'prompt file <name> not produced — <the script'"'"'s message, or "empty">'
  'Treated as the script failing'
  'value file <name> could not be written — <the error>'
  'value file <name> refused twice by protect-secrets — <the hook'"'"'s reason>'
  'prompt file <name> not read by <controller name>'
)
# One fragment per row of the not-mechanism table.
NOT_MECHANISM_ROWS=(
  'dies of the environment'
  'A slip in your own fill command'
  'treat it as a path lost from context'
  'unusable on format alone'
  'lost from your context'
  'reads another file in the directory'
  'stale directory from an earlier session'
)
# File names of the prompt directory.
FILE_NAMES=(
  'dispatch-<k>-plan-writer.md'
  'dispatch-<k>-plan-review.md'
  'dispatch-<k>-batch-<n>.md'
  'dispatch-<k>-code-review.md'
  'dispatch-<k>-answers.txt'
  'dispatch-<k>-probe-<n>.txt'
)
# Template wrapper and body contracts.
AGENT_LINE='Agent tool (general-purpose):'
NAME_PREFIX='  name: "orch-'
PROMPT_OPEN='  prompt: |'
NOTHING_ELSE='**Nothing else may be added to the prompt.**'
RESUME_HEADING='    ## Resume Answer'
FIXED_SENTENCE='    A section with no line below this sentence means the run has recorded no answer.'
PLACEHOLDER_LINE='    [RESUME_ANSWER]'
M_TOKEN='[M]'
SINGLE_LETTER_ERE='\[[A-Z]\]'
CHECKLIST_LINE='       `- [X] unresolved: <reason> — <finding summary>`.'
# The first line of the mirrored secrets-hook rule inside the stop policy.
PROBE_OPENING='**The secrets-hook probe.**'

PASS=0
FAIL=0
ERRORS=()
WORK="$(mktemp -d)"
: "${WORK:?mktemp failed — refusing to run with an empty work path}"
trap 'rm -rf "$WORK"' EXIT

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
ok()  { green "  PASS: $1"; PASS=$((PASS+1)); }
bad() { red "  FAIL: $1"; ERRORS+=("$1"); FAIL=$((FAIL+1)); }

assert_file_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}
assert_file_not_contains() { # desc file needle
  if grep -qF -- "$3" "$2"; then bad "$1 (must not contain: $3)"; else ok "$1"; fi
}
assert_file_not_contains_i() { # desc file needle (case-insensitive)
  if grep -qiF -- "$3" "$2"; then bad "$1 (must not contain, in any case: $3)"; else ok "$1"; fi
}
assert_file_has_line() { # desc file exact-line (whole-line match, fixed string)
  if grep -qxF -- "$3" "$2"; then ok "$1"; else bad "$1 (no line exactly: $3)"; fi
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
assert_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi
}

# Line number of the first line of file $1 equal to $2 as a whole line;
# empty when absent.
first_line_of() { grep -nxF -- "$2" "$1" | head -n 1 | cut -d: -f1; }
# Write the lines of file $2 from heading $3 (inclusive) to heading $4
# (exclusive) into file $5. A missing or inverted range writes an empty file
# and FAILs, so that every later check on that file fails visibly.
extract_range() { # label file start-heading end-heading out
  local start end
  start="$(first_line_of "$2" "$3")"
  end="$(first_line_of "$2" "$4")"
  if [ -z "$start" ] || [ -z "$end" ] || [ "$start" -ge "$end" ]; then
    : > "$5"
    bad "$1: could not locate the range '$3' .. '$4' in ${2#"$ROOT"/}"
    return
  fi
  awk -v s="$start" -v e="$end" 'NR >= s && NR < e' "$2" > "$5"
  ok "$1: range located ($start..$end)"
}
# The line right below the first line of file $1 that equals $2 as a whole
# line; empty when absent or last. The needle reaches awk through the
# environment so that no character of it is reinterpreted.
line_below() { # file exact-line
  needle="$2" awk 'BEGIN { n = ENVIRON["needle"] } found { print; exit } $0 == n { found = 1 }' "$1"
}

# Write the prompt block of template $1 — the lines after its `  prompt: |`
# line up to the closing fence — into file $2; empty when either is missing.
extract_prompt_block() { # file out
  open="$PROMPT_OPEN" awk 'BEGIN { o = ENVIRON["open"] } body && substr($0, 1, 3) == "```" { exit } body { print } $0 == o { body = 1 }' "$1" > "$2"
}

DISPATCH_RANGE="$WORK/dispatch.txt"
PHASE0_RANGE="$WORK/phase0.txt"
PHASES_RANGE="$WORK/phases.txt"
PHASE1_RANGE="$WORK/phase1.txt"
PHASE2_RANGE="$WORK/phase2.txt"
PHASE3_RANGE="$WORK/phase3.txt"
PHASE4_RANGE="$WORK/phase4.txt"
PHASE5_RANGE="$WORK/phase5.txt"
RESUME_RANGE="$WORK/resume.txt"
INRUN_RANGE="$WORK/inrun.txt"
MAJOR_RANGE="$WORK/major.txt"
TEMPLATES_RANGE="$WORK/templates.txt"
MARKER_RANGE="$WORK/marker.txt"

bold "0. Section ranges of the orchestrator"
REQUIRED_RANGE="$WORK/required.txt"
extract_range "Required Start" "$ORCH_SKILL" "$H_REQUIRED" "$H_DISPATCH" "$REQUIRED_RANGE"
extract_range "Controller Dispatch Rules" "$ORCH_SKILL" "$H_DISPATCH" "$H_PHASE0" "$DISPATCH_RANGE"
extract_range "Phase 0" "$ORCH_SKILL" "$H_PHASE0" "$H_PHASE1" "$PHASE0_RANGE"
extract_range "Phases 1 to 4" "$ORCH_SKILL" "$H_PHASE1" "$H_PHASE5" "$PHASES_RANGE"
extract_range "Phase 1" "$ORCH_SKILL" "$H_PHASE1" "$H_PHASE2" "$PHASE1_RANGE"
extract_range "Phase 2" "$ORCH_SKILL" "$H_PHASE2" "$H_PHASE3" "$PHASE2_RANGE"
extract_range "Phase 3" "$ORCH_SKILL" "$H_PHASE3" "$H_PHASE4" "$PHASE3_RANGE"
extract_range "Phase 4" "$ORCH_SKILL" "$H_PHASE4" "$H_PHASE5" "$PHASE4_RANGE"
extract_range "Phase 5" "$ORCH_SKILL" "$H_PHASE5" "$H_ORCHLOG" "$PHASE5_RANGE"
extract_range "Resume" "$ORCH_SKILL" "$H_RESUME" "$H_INRUN" "$RESUME_RANGE"
extract_range "In-run rulings" "$ORCH_SKILL" "$H_INRUN" "$H_MAJOR" "$INRUN_RANGE"
extract_range "Major-Error Stop Policy" "$ORCH_SKILL" "$H_MAJOR" "$H_MARKER" "$MAJOR_RANGE"
extract_range "Report Marker" "$ORCH_SKILL" "$H_MARKER" "$H_TEMPLATES" "$MARKER_RANGE"
# `## Prompt Templates` is the last section: its range runs to the end.
TEMPLATES_START="$(first_line_of "$ORCH_SKILL" "$H_TEMPLATES")"
if [ -n "$TEMPLATES_START" ]; then
  awk -v s="$TEMPLATES_START" 'NR >= s' "$ORCH_SKILL" > "$TEMPLATES_RANGE"
  ok "Prompt Templates: range located ($TEMPLATES_START..end)"
else
  : > "$TEMPLATES_RANGE"
  bad "Prompt Templates: heading '$H_TEMPLATES' not found"
fi

bold "1. Controller Dispatch Rules: the prompt directory, the fill, the check, the pointer"
for needle in "$MKTEMP" "$FILL_SCRIPT" "$TEST_S" "$POINTER_PREFIX" "$POINTER_READ" "$POINTER_ONLY" \
              "$NEVER_READS" "$NEVER_REWRITTEN" "$SAME_POINTER" "$NEVER_FAILED_FILE" \
              'cygpath -m' 'never held in a variable' 'the pointer only' "${FILE_NAMES[@]}"; do
  assert_folded_contains "dispatch rules: contains '$needle'" "$DISPATCH_RANGE" "$needle"
done
# Each pointer sentence stands on one physical line. The dispatch-rules
# text indents them inside a list item, so the indentation is trimmed
# before the whole-line match.
sed 's/^[[:space:]]*//; s/[[:space:]]*$//' "$DISPATCH_RANGE" > "$WORK/dispatch-trimmed.txt"
for s in "$POINTER_FIRST" "$POINTER_READ" "$POINTER_ONLY"; do
  assert_file_has_line "dispatch rules: pointer sentence on one physical line: '$s'" "$WORK/dispatch-trimmed.txt" "$s"
done
# Contract 1 invariant: the Agent call keeps its `name`, its `description`
# and its `model`.
for needle in 'The Agent call keeps its `name`' 'its `description` (the table above)' \
              'its `model` (the session model with the sonnet floor'; do
  assert_folded_contains "dispatch rules: the Agent call keeps '$needle'" "$DISPATCH_RANGE" "$needle"
done
# The file-name table is the orchestrator's own source of the four
# `description` strings — it never reads a template to obtain them — so each
# string must match the template's wrapper line exactly.
for t in "${TEMPLATES[@]}"; do
  desc="$(sed -n 's/^[[:space:]]*description: "\(.*\)"[[:space:]]*$/\1/p' "$ORCH_DIR/$t" | head -n 1)"
  if [ -z "$desc" ]; then
    bad "dispatch rules: $t carries no description line to compare"
  else
    assert_folded_contains "dispatch rules: the table gives $t's description '$desc'" "$DISPATCH_RANGE" "$desc"
  fi
done

bold "1b. Return contract: the marker may start any of the first 10 non-blank lines"
assert_folded_contains "dispatch rules: the return contract states the 10-non-blank-line window" \
  "$DISPATCH_RANGE" "$RETURN_WINDOW"
assert_folded_contains "dispatch rules: the return contract spells the orchestration marker exactly" \
  "$DISPATCH_RANGE" "$RETURN_MARKER"
assert_folded_contains "dispatch rules: the return contract says exceeding the 15-line cap is not malformed" \
  "$DISPATCH_RANGE" "$RETURN_CAP_NOT_MALFORMED"

bold "2. Negative needles over the whole orchestrator text"
assert_file_not_contains "orchestrator never holds the prompt directory in a shell variable" "$ORCH_SKILL" "$PROMPT_DIR_VARIABLE"
assert_file_not_contains_i "orchestrator never says '$PASTE'" "$ORCH_SKILL" "$PASTE"
for t in "${TEMPLATES[@]}"; do
  assert_file_not_contains "orchestrator never reads ./$t" "$ORCH_SKILL" "${READ_DOT}${t}"
done

bold "3. Major-Error Stop Policy: every failure of the mechanism is fatal, with its cause text"
for needle in "${CAUSES[@]}" "${NOT_MECHANISM_ROWS[@]}" "$NEVER_FAILED_FILE" \
              "$NO_FALLBACK" "$SAME_POINTER" 'hooks/safety/protect-secrets.js'; do
  assert_folded_contains "stop policy: contains '$needle'" "$MAJOR_RANGE" "$needle"
done
# The secrets-hook probe rule runs before every dispatch fill, so it lives in
# Controller Dispatch Rules — inside the first 5,000 tokens of the file, which
# is all that Claude Code attaches again after an auto-compaction. It is the
# LAST paragraph of that section, so that "from its bold opening to the end
# of the section" below is the probe rule alone.
for needle in "$VALUE_WITHHELD" "$NO_HEREDOC" 'hooks/safety/protect-secrets.js' \
              'dispatch-<k>-probe-<n>.txt' 'Never withhold a line on this outcome'; do
  assert_folded_contains "dispatch rules: the secrets-hook probe rule contains '$needle'" "$DISPATCH_RANGE" "$needle"
done
assert_file_not_contains "dispatch rules: withheld-line form keeps the ruling verb (no pre-amendment location-only form)" "$DISPATCH_RANGE" "$VALUE_WITHHELD_OLD_FORM"
assert_file_not_contains "stop policy: the secrets-hook probe rule no longer stands in the stop policy" "$MAJOR_RANGE" "$PROBE_OPENING"
# The mirrored secrets-hook rule stands alone: it must send the reader to no
# other skill's file for the hook rule. Scoped to the probe rule's own
# paragraphs — from its bold opening to the end of the section — so that a
# legitimate mention of multi-code-review elsewhere in the section does not
# fail the check.
PROBE_RANGE="$WORK/probe.txt"
PROBE_START="$(grep -nF -- "$PROBE_OPENING" "$DISPATCH_RANGE" | head -n 1 | cut -d: -f1)"
if [ -n "$PROBE_START" ]; then
  awk -v s="$PROBE_START" 'NR >= s' "$DISPATCH_RANGE" > "$PROBE_RANGE"
  ok "dispatch rules: secrets-hook probe rule located ($PROBE_START..end of section)"
else
  : > "$PROBE_RANGE"
  bad "dispatch rules: the secrets-hook probe rule opening '$PROBE_OPENING' was not found in Controller Dispatch Rules"
fi
assert_file_not_contains "dispatch rules: the secrets-hook rule names no multi-code-review skill file" "$PROBE_RANGE" 'multi-code-review/SKILL.md'
assert_file_not_contains "dispatch rules: the secrets-hook rule holds no 'see multi-code-review' cross-reference" "$PROBE_RANGE" 'see multi-code-review'

bold "3b. Report Marker and Lost returns state the 10-non-blank-line window and the parsing reason"
assert_folded_contains "report marker: states the 10-non-blank-line window" \
  "$MARKER_RANGE" "$MARKER_WINDOW"
assert_folded_contains "lost returns: states the 10-non-blank-line window" \
  "$INRUN_RANGE" "$MARKER_WINDOW"
assert_file_not_contains "orchestrator no longer claims an unmarked return hangs the dispatch" \
  "$ORCH_SKILL" "$GUARD_HANG_OLD_CLAIM"
assert_folded_contains "report marker: the marker is kept because the Return contract parses from it" \
  "$MARKER_RANGE" "$MARKER_REASON"
assert_folded_contains "lost returns: the label opens with the parsing reason" \
  "$INRUN_RANGE" "$LOST_RETURNS_REASON"
# The range ends with the blank line above the next heading, which folds
# into a trailing space.
assert_eq "report marker: the section holds these sentences and no other" \
  "$(fold_file "$MARKER_RANGE" | sed 's/ *$//')" "$MARKER_SECTION"
assert_folded_not_contains "return contract: names no hook that watches the marker" \
  "$DISPATCH_RANGE" "$GUARD_HOOK_CLAUSE"
assert_folded_not_contains "fork prompt: no rule about an action verb before a skill name" \
  "$INRUN_RANGE" "$GUARD_FORK_LINE"

bold "4. Prompt Templates: filled by the script, never read"
assert_folded_contains "prompt templates: names the fill script" "$TEMPLATES_RANGE" "$FILL_SCRIPT"
assert_folded_contains "prompt templates: never read by the orchestrator" "$TEMPLATES_RANGE" 'never read by the orchestrator'
for t in "${TEMPLATES[@]}"; do
  assert_file_has_line "prompt templates: lists ./$t" "$TEMPLATES_RANGE" "- \`./$t\`"
done

bold "5. The four templates: no single-letter placeholder, wrapper lines kept"
for t in "${TEMPLATES[@]}"; do
  f="$ORCH_DIR/$t"
  assert_file_not_contains "$t: no [M] token" "$f" "$M_TOKEN"
  assert_file_has_line "$t: Agent tool wrapper line" "$f" "$AGENT_LINE"
  assert_file_contains "$t: name line starts with orch-" "$f" "$NAME_PREFIX"
  assert_file_has_line "$t: prompt: | line" "$f" "$PROMPT_OPEN"
  # A substring check, not a whole line: plan-writer-prompt.md continues the
  # sentence on the same line, and that line stays byte-identical.
  assert_file_contains "$t: nothing-else line" "$f" "$NOTHING_ELSE"
  single="$(grep -cE -- "$SINGLE_LETTER_ERE" "$f" | tr -d ' ')"
  if [ "$t" = "doc-review-loop-prompt.md" ]; then
    assert_eq "$t: exactly one line with a single-letter bracket token (the checklist marker)" "$single" "1"
    assert_file_has_line "$t: the checklist marker line is byte-identical" "$f" "$CHECKLIST_LINE"
  else
    assert_eq "$t: no single-letter bracket token" "$single" "0"
  fi
done

bold "5b. Controllers that run commands read a background result through tail, never whole"
# Case 018 (Follow-up of 2026-09-05) measured Read results at 38-39% of a
# controller's window, and in one controller that class was a single 125 KB
# whole read of a background test-suite log — larger than every prompt the
# controller was given. Only the two templates that run commands carry the
# rule; the plan-writer controller runs none, and the doc-review controller
# runs only a read-only inspection command that prints a single line, so
# nothing needs reading through tail.
for t in batch-controller-prompt.md code-review-loop-prompt.md; do
  f="$ORCH_DIR/$t"
  assert_file_contains "$t: never reads a background command's output file whole" \
    "$f" 'Never read the output file of a background command whole.'
  assert_file_contains "$t: names tail as the way to read it" \
    "$f" '`tail -n 50 <path>`'
  assert_file_contains "$t: names grep for the detail" \
    "$f" "grep -n 'FAIL"
done
for t in plan-writer-prompt.md doc-review-loop-prompt.md; do
  assert_file_not_contains "$t: carries no background-read rule (its one command prints a single line)" \
    "$ORCH_DIR/$t" 'Never read the output file of a background command whole.'
done

bold "5c. Every controller template pages its skill body with the Read tool until no PARTIAL notice remains"
# Row 26 measured every controller opening its skill body with `cat`: all 21
# outputs were persisted to a 2 KB preview, and 9 controllers then received
# 67.6 to 96.2 percent of the sections their prompt names. The paging rule
# stands inside each prompt block, directly after the hand-over sentence.
for t in "${TEMPLATES[@]}"; do
  block="$WORK/paging-block-$t.txt"
  extract_prompt_block "$ORCH_DIR/$t" "$block"
  if [ -s "$block" ]; then ok "$t: prompt block extract is non-empty"; else bad "$t: prompt block extract is empty (no '$PROMPT_OPEN' block)"; fi
  assert_folded_contains "$t: prompt block names the Read tool and forbids a shell command" "$block" "$READ_TOOL_NOT_SHELL"
  assert_folded_contains "$t: prompt block pages until no PARTIAL notice remains" "$block" "$PAGE_UNTIL_NO_PARTIAL"
  assert_folded_contains "$t: prompt block halves the limit when a call is refused for size" "$block" "$HALVE_ON_REFUSAL"
  assert_folded_contains "$t: prompt block exempts a file only passed on by path" "$block" "$PASS_ON_BY_PATH"
done
for t in batch-controller-prompt.md code-review-loop-prompt.md; do
  assert_folded_contains "$t: the background-read rule is scoped to background output files" \
    "$ORCH_DIR/$t" "$BACKGROUND_RULE_SCOPE"
done
for t in plan-writer-prompt.md doc-review-loop-prompt.md; do
  assert_folded_not_contains "$t: carries no background-read scope sentence (it carries no background-read rule)" \
    "$ORCH_DIR/$t" "$BACKGROUND_RULE_SCOPE"
done

bold "5d. The batch controller reads each worker template whole and fills it, never composes a prompt"
# Row 28: on a real run, batch controller 4 never opened the implementer
# template. The template list was a verb-less fragment, and the SDD section
# that names the templates ("Prompt Templates") was not in the list of
# sections the controller is told to follow. The instruction now carries the
# verb "Read" (so the hand-over paragraph covers the two templates), lists
# the section, and says that every worker prompt IS the template filled.
BATCH_BLOCK="$WORK/worker-template-block.txt"
extract_prompt_block "$ORCH_DIR/batch-controller-prompt.md" "$BATCH_BLOCK"
assert_folded_contains "batch-controller-prompt.md: the section list names \"Prompt Templates\"" \
  "$BATCH_BLOCK" '"Hard Rules", "Prompt Templates"'
assert_folded_contains "batch-controller-prompt.md: each worker template is read whole before its first dispatch" \
  "$BATCH_BLOCK" 'Read each one whole before its first dispatch'
assert_folded_contains "batch-controller-prompt.md: a worker prompt is never composed from scratch" \
  "$BATCH_BLOCK" 'never into a prompt composed from scratch'
assert_folded_not_contains "batch-controller-prompt.md: the verb-less template fragment is gone" \
  "$BATCH_BLOCK" '[TASK_REVIEWER_PROMPT_PATH]. Scripts'

bold "6. The Resume Answer section: heading without a parenthetical, the fixed sentence, the placeholder below it"
for t in "${RESUME_TEMPLATES[@]}"; do
  f="$ORCH_DIR/$t"
  assert_file_has_line "$t: Resume Answer heading stands alone" "$f" "$RESUME_HEADING"
  assert_file_not_contains "$t: no omit parenthetical on the heading" "$f" '## Resume Answer (omit'
  assert_file_has_line "$t: the fixed sentence is one line of the body" "$f" "$FIXED_SENTENCE"
  assert_eq "$t: the placeholder line follows the fixed sentence directly" "$(line_below "$f" "$FIXED_SENTENCE")" "$PLACEHOLDER_LINE"
done
assert_file_not_contains "doc-review-loop-prompt.md: has no Resume Answer section" "$ORCH_DIR/doc-review-loop-prompt.md" 'Resume Answer'

bold "7. Phase 0 creates the prompt directory; Phases 1 to 4 fill, check and dispatch the pointer"
assert_folded_contains "phase 0: mktemp -d step" "$PHASE0_RANGE" "$MKTEMP"
assert_folded_contains "phase 0: names the creation-failure cause" "$PHASE0_RANGE" 'prompt directory could not be created'
for t in "${TEMPLATES[@]}"; do
  assert_folded_contains "phases: fill command names --template \"<base>/$t\"" "$PHASES_RANGE" "--template \"<base>/$t\""
done
for name in 'dispatch-<k>-plan-writer.md' 'dispatch-<k>-plan-review.md' 'dispatch-<k>-batch-<n>.md' 'dispatch-<k>-code-review.md'; do
  assert_folded_contains "phases: test -s on $name" "$PHASES_RANGE" "test -s \"<PROMPT_DIR>/$name\""
done
assert_file_not_contains "phases: no template is filled by hand (no 'Fill \`./' line)" "$PHASES_RANGE" "$FILL_DOT"
assert_folded_contains "phases: BATCH_NUMBER is not passed to the script" "$PHASES_RANGE" 'stands only in the template'"'"'s wrapper and is not passed to the script'
for phase_label in "Phase 1:$PHASE1_RANGE" "Phase 2:$PHASE2_RANGE" "Phase 3:$PHASE3_RANGE" "Phase 4:$PHASE4_RANGE"; do
  phase_name="${phase_label%%:*}"
  phase_range="${phase_label#*:}"
  assert_folded_contains "phases: $phase_name dispatches the pointer" "$phase_range" 'dispatch the pointer'
done

bold "8. Resume and In-run rulings: the answer lines go into a value file"
for needle in "$MKTEMP" 'a resumed session has none' 'dispatch-1-answers.txt' '`<k>` = 1' 'the only channel for it' 'no answer line' \
              'exactly as step 3 creates it' \
              'with the Write tool to `<PROMPT_DIR>/dispatch-1-answers.txt`' \
              "\`'RESUME_ANSWER='\`"; do
  assert_folded_contains "resume: contains '$needle'" "$RESUME_RANGE" "$needle"
done
for needle in 'dispatch-<k>-answers.txt' "$NO_HEREDOC" 'the only channel' 'a new fill under the next `<k>`' "$TEST_S" \
              'with the Write tool to `<PROMPT_DIR>/dispatch-<k>-answers.txt`' \
              "\`'RESUME_ANSWER=@<PROMPT_DIR>/dispatch-<k>-answers.txt'\`"; do
  assert_folded_contains "in-run rulings: contains '$needle'" "$INRUN_RANGE" "$needle"
done

bold "9. Phase 2 dispatches the plan-review controller for every N_plan"
assert_file_not_contains "phase 2: no N_plan=0 skip branch" "$PHASE2_RANGE" 'If N_plan = 0, log the skip'
assert_folded_contains "phase 2: names the N_plan=0 log line" "$PHASE2_RANGE" \
  '## Phase 2 — Plan review — rounds 0 (N_plan=0) — cap — unresolved 0'
assert_folded_contains "phase 2: the controller is dispatched for every N_plan value, 0 included" "$PHASE2_RANGE" \
  'The controller is dispatched for every `N_plan` value, 0 included'
assert_folded_contains "phase 2: N_plan=0 returns rounds=0 outcome=cap unresolved=0" "$PHASE2_RANGE" \
  'returns `rounds=0 outcome=cap unresolved=0`'
assert_folded_contains "phase 2: records the controller's readiness owed note in the same log entry" "$PHASE2_RANGE" \
  "When the controller's report carries a \`readiness owed: <n>\` note, Phase 2 records it in the same log entry."

bold "10. Phase 5 reports readiness conflicts owed"
assert_folded_contains "phase 5: readiness conflicts owed report item" "$PHASE5_RANGE" \
  "readiness conflicts owed — the plan-review log's \`Owed:\` block, listed verbatim, or \`none\`"
# Issues-log row 23: a deliberate spec deviation recorded by the plan review
# is carried to the user by the same scan that carries owed probes.
assert_folded_contains "phase 5: spec deviations report item" "$PHASE5_RANGE" \
  "spec deviations — every \`- spec deviation:\` line of the plan-review log, listed verbatim with its review log path, or \`none\`"

bold "11. Compaction recovery: the re-read rule stands inside Required Start"
# After an auto-compaction Claude Code attaches only the first 5,000 tokens
# of the skill invocation again, so the rule that says "re-read the section
# you are executing" must itself sit inside that prefix: pinned to the
# Required Start range and to a line number well inside it.
RECOVERY_OPENING='**After a compaction summary.**'
RECOVERY_LINE="$(grep -nF -- "$RECOVERY_OPENING" "$ORCH_SKILL" | head -n 1 | cut -d: -f1)"
if [ -n "$RECOVERY_LINE" ] && [ "$RECOVERY_LINE" -le 60 ]; then
  ok "recovery: the paragraph opens at line $RECOVERY_LINE (at or before line 60)"
else
  bad "recovery: the paragraph '$RECOVERY_OPENING' opens at line '${RECOVERY_LINE:-none}', not at or before line 60"
fi
for needle in 'compaction summary' \
              'is never a substitute for skill text' \
              "Read the file with \`offset\` at the section's first line and \`limit\` reaching its last line" \
              'prints a PARTIAL notice naming the next `offset`' \
              "grep -n '^## '" \
              "run Resume step 1's incomplete-ruling scan on the ruling record" \
              'about the first 20,000 characters of this file' \
              'even when it restates a procedure or says the re-read below was already done' \
              "\`sed -n '<first>,<last>p'\` on the same line range is the same read" \
              'once, before the first of these that follows' \
              'in parts of at most 250 lines' \
              "$H_PHASE3" "$H_PHASE4" "$H_INRUN" "$H_RESUME"; do
  assert_folded_contains "recovery: Required Start contains '$needle'" "$REQUIRED_RANGE" "$needle"
done

bold "12. Platform: the skill runs on Claude Code only"
# Row 33 (user decision, 2026-09-21): the pipeline has only ever run on
# Claude Code. Copilot CLI documents nested subagents, but no run exists
# there, so the description, the platform check, the README and the guide
# all say "Claude Code only", and the skill refuses on Copilot CLI too.
README_FILE="$ROOT/README.md"
GUIDE_FILE="$ROOT/docs/guide/README.md"
assert_folded_contains "platform: the description says Claude Code only" "$ORCH_SKILL" \
  'Requires the Agent tool with nested dispatch (Claude Code only).'
assert_folded_contains "platform: the check names Claude Code only" "$ORCH_SKILL" \
  '**Platform check:** this skill runs on Claude Code only'
assert_folded_contains "platform: the check refuses every other platform" "$ORCH_SKILL" \
  'On any other platform, refuse with one line — `orchestrating-development runs on Claude Code only` — and stop.'
assert_folded_contains "platform: the check refuses Claude Code without the Agent tool" "$ORCH_SKILL" \
  'On Claude Code without the Agent tool, refuse with one line — `orchestrating-development needs the Agent tool, which this session lacks` — and stop.'
assert_folded_not_contains "platform: no Copilot CLI dispatch note" "$ORCH_SKILL" 'Copilot CLI: `task`'
assert_folded_contains "platform: the brainstorming gate offers the pipeline for Claude Code only" \
  "$ROOT/skills/brainstorming/SKILL.md" '**Autonomous pipeline** (Claude Code only)'
assert_folded_contains "platform: the README says the skill refuses on Copilot CLI" "$README_FILE" \
  '`orchestrating-development` refuses to run on Copilot CLI'
assert_folded_not_contains "platform: the README no longer gives Copilot CLI the orchestration skills" "$README_FILE" \
  'which the orchestration skills need'
assert_folded_contains "platform: the README says the skill refuses on OpenCode" "$README_FILE" \
  '`orchestrating-development` runs on Claude Code only and refuses on OpenCode'
assert_folded_contains "platform: the guide overview says Claude Code only" "$GUIDE_FILE" \
  "§4's orchestration runs on Claude Code only"
assert_folded_contains "platform: the guide overview names Copilot CLI and OpenCode" "$GUIDE_FILE" \
  'Copilot CLI and OpenCode have never run it'
assert_folded_contains "platform: the guide requirement names Copilot CLI" "$GUIDE_FILE" \
  'On any other platform, Copilot CLI included, the skill refuses with one line.'

echo
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
exit 0
