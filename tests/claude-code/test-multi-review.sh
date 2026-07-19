#!/usr/bin/env bash
# Test: multi-review skill — N-round document review loop (behavioral, slow)
#
# Seeds a deliberately flawed spec, invokes the skill headlessly with N=2,
# and asserts the review-log contract from
# docs/specs/2026-07-19-multi-review-design.md:
#   (a) sidecar <doc-basename>-review-log.md exists with a Round 1 entry
#   (b) doc modified OR all Critical/Important dispositions are rejections
#   (c) log has a disposition line or an explicit no-findings verdict
#
# Requires the INSTALLED plugin to include multi-review — reinstall the
# plugin cache after editing skills/ before running this.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/../lib/timeout-shim.sh"
source "$SCRIPT_DIR/test-helpers.sh"

TEST_PROJECT=$(create_test_project)
trap "cleanup_test_project '$TEST_PROJECT'" EXIT

mkdir -p "$TEST_PROJECT/docs/specs"
SPEC="$TEST_PROJECT/docs/specs/test-feature-design.md"
cat > "$SPEC" << 'SPEC_EOF'
# Test Feature Design

## Requirements
- The exporter writes CSV files to the output directory.
- The exporter never writes any file to disk.

## Retry Behavior
Failed exports are retried a reasonable number of times.
SPEC_EOF
SPEC_SHA_BEFORE=$(shasum "$SPEC" | cut -d' ' -f1)

PROMPT="Invoke the superpowers-optimized:multi-review skill on the document $SPEC with N=2. Do not ask me any questions — use N=2 and proceed to completion."
# Deliberately no doc-type statement: the spec's Testing Strategy requires this
# test to exercise path-based inference (docs/specs/ -> spec); stating the type
# would override inference per the skill's Parameters rule.

cd "$PLUGIN_DIR" && timeout 1800 claude -p "$PROMPT" \
    --permission-mode bypassPermissions \
    --add-dir "$TEST_PROJECT" \
    2>&1 | tee "$TEST_PROJECT/output.txt" || true

LOG="$TEST_PROJECT/docs/specs/test-feature-design-review-log.md"
FAILURES=0

if [ ! -f "$LOG" ]; then
    echo "FAIL(a): review log $LOG was not created"
    FAILURES=$((FAILURES+1))
else
    if ! grep -q "^## Round 1" "$LOG"; then
        echo "FAIL(a): review log has no '## Round 1' entry"
        FAILURES=$((FAILURES+1))
    fi
    SPEC_SHA_AFTER=$(shasum "$SPEC" | cut -d' ' -f1)
    if [ "$SPEC_SHA_AFTER" = "$SPEC_SHA_BEFORE" ] && \
       grep -qE "^- \[(C|I)[0-9]+\] applied" "$LOG"; then
        echo "FAIL(b): log claims applied Critical/Important findings but the spec is byte-identical"
        FAILURES=$((FAILURES+1))
    fi
    if ! grep -qiE "applied|rejected:|deferred|no material issues|skipped|inconclusive" "$LOG"; then
        echo "FAIL(c): log has no disposition line and no no-findings verdict"
        FAILURES=$((FAILURES+1))
    fi
fi

if [ "$FAILURES" -eq 0 ]; then
    echo "PASS: multi-review behavioral test"
else
    echo "FAILED: $FAILURES assertion(s); transcript in $TEST_PROJECT/output.txt"
    exit 1
fi
