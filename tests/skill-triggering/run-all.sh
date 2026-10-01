#!/bin/bash
# Run all skill triggering tests
# Usage: ./run-all.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPTS_DIR="$SCRIPT_DIR/prompts"

SKILLS=(
    "systematic-debugging"
    # brainstorming, not test-driven-development: the routing guide reaches
    # test-driven-development only after systematic-debugging has run, so no
    # single naive prompt can select it. The prompt kept here is the feature
    # request that this suite used to file under test-driven-development; the
    # router sends it to brainstorming, which is the documented behaviour for a
    # request that introduces behaviour and carries no design yet.
    "brainstorming"
    "writing-plans"
    "dispatching-parallel-agents"
    "executing-plans"
    "subagent-driven-development"
    "requesting-code-review"
    "multi-doc-review"
    "multi-code-review"
    "worklog"
    "dashboard"
)

echo "=== Running Skill Triggering Tests ==="
echo ""

PASSED=0
FAILED=0
RESULTS=()

for skill in "${SKILLS[@]}"; do
    prompt_file="$PROMPTS_DIR/${skill}.txt"

    if [ ! -f "$prompt_file" ]; then
        echo "⚠️  SKIP: No prompt file for $skill"
        continue
    fi

    echo "Testing: $skill"

    # A pipeline's exit status is the status of its LAST command. Piping the
    # test into "tee" would therefore report success whenever tee could write
    # its file, and the real result of run-test.sh would be thrown away. Run
    # the test on its own, keep its status, then show the log.
    test_log="/tmp/skill-test-$skill.log"
    test_rc=0
    # Turn budget. The entry sequence spends several turns before it can route:
    # using-superpowers, token-efficiency, and a memory/staleness check each
    # take one. A budget of 3 ended most sessions after the entry point and
    # before the target skill, which reads as a routing failure that did not
    # happen. Measured on 2026-09-01: at 3 turns 3 of 9 skills triggered, and
    # the transcripts showed the model naming the correct destination as its
    # turns ran out.
    "$SCRIPT_DIR/run-test.sh" "$skill" "$prompt_file" 8 > "$test_log" 2>&1 || test_rc=$?
    cat "$test_log"

    if [ "$test_rc" -eq 0 ]; then
        PASSED=$((PASSED + 1))
        RESULTS+=("✅ $skill")
    else
        FAILED=$((FAILED + 1))
        RESULTS+=("❌ $skill")
    fi

    echo ""
    echo "---"
    echo ""
done

echo ""
echo "=== Summary ==="
for result in "${RESULTS[@]}"; do
    echo "  $result"
done
echo ""
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
