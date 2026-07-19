#!/usr/bin/env bash
# Test: subagent-driven-development — Batched Autonomous Mode
# Verifies the mode section is understood: batch boundary, handoff, autonomy, resume
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/test-helpers.sh"

SKILL_FILE="../../skills/subagent-driven-development/SKILL.md"

echo "=== Test: batched autonomous mode ==="
echo ""

# Test 1: Batch boundary conditions
echo "Test 1: Batch boundary..."

output=$(run_claude "Read the file at $SKILL_FILE. In Batched Autonomous Mode, list the conditions that end a batch." 60 "Read")

if assert_contains "$output" "60%\|pressure" "Mentions context pressure boundary"; then
    : # pass
else
    exit 1
fi

if assert_contains "$output" "3 tasks\|fallback" "Mentions measurement-failure fallback cap"; then
    : # pass
else
    exit 1
fi

echo ""

# Test 2: Handoff document
echo "Test 2: Handoff contract..."

output=$(run_claude "Read the file at $SKILL_FILE. In Batched Autonomous Mode, where is the handoff written at batch end and what is its size limit?" 60 "Read")

if assert_contains "$output" "state.md" "Handoff written to state.md"; then
    : # pass
else
    exit 1
fi

if assert_contains "$output" "100" "100-line cap mentioned"; then
    : # pass
else
    exit 1
fi

echo ""

# Test 3: Autonomy policy
echo "Test 3: Autonomy policy..."

output=$(run_claude "Read the file at $SKILL_FILE. In Batched Autonomous Mode, what happens when a task is BLOCKED mid-batch? Does the orchestrator guess?" 60 "Read")

if assert_contains "$output" "end.*batch\|batch.*early\|stop" "Batch ends early on blocker"; then
    : # pass
else
    exit 1
fi

if assert_contains "$output" "[Nn]ever.*guess\|no.*guess\|does not guess\|doesn't guess" "No best-guessing"; then
    : # pass
else
    exit 1
fi

echo ""

# Test 4: Resume reconciliation
echo "Test 4: Resume procedure..."

output=$(run_claude "Read the file at $SKILL_FILE. In the Resume Procedure of Batched Autonomous Mode, which artifacts are authoritative for position: state.md, or plan.md checkboxes plus git?" 60 "Read")

if assert_contains "$output" "plan.md.*git\|checkboxes.*git\|git.*checkbox\|git.*authoritative" "plan.md + git authoritative"; then
    : # pass
else
    exit 1
fi

echo ""
echo "=== All batched autonomous mode tests passed ==="
