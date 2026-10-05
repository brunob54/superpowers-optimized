# Claude Code Skills Tests

Automated tests for superpowers skills using Claude Code CLI.

## Overview

This test suite verifies that skills are loaded correctly and Claude follows them as expected. Tests invoke Claude Code in headless mode (`claude -p`) and verify the behavior.

## Requirements

- Claude Code CLI installed and in PATH (`claude --version` should work)
- Local superpowers plugin installed (see main README for installation)

## Running Tests

### Run all fast tests (recommended):
```bash
./run-skill-tests.sh
```

### Run integration tests (slow, 10-30 minutes):
```bash
./run-skill-tests.sh --integration
```

### Run specific test:
```bash
./run-skill-tests.sh --test test-subagent-driven-development.sh
```

The name after `--test` is a file name inside `tests/claude-code/`, not a path.
A name that is not found fails the run.

### Run with verbose output:
```bash
./run-skill-tests.sh --verbose
```

### Set custom timeout:
```bash
./run-skill-tests.sh --timeout 1800  # 30 minutes for integration tests
```

## Test Structure

### test-helpers.sh
Common functions for skills testing:
- `run_claude "prompt" [timeout] [allowed_tools]` - Run Claude with prompt in a fresh empty work folder, removed afterwards (a prompt must use absolute paths)
- `run_claude_in_workdir "$CLAUDE_WORKDIR" timeout claude_args...` - Run `claude` inside a work folder and return its exit status; every direct `claude` call of a suite must use it (`tests/codex/test-claude-code-workdir.sh` checks this)
- `create_claude_workdir` - Create an empty work folder and print its physical path; fails when `mktemp` fails
- `assert_workdir_empty label dir` - Fail when the run wrote into its work folder, or when the folder does not exist
- `cleanup_claude_workdir dir...` - Remove work folders; refuses an empty path, `/`, the home folder, the current directory and the plugin repository
- `assert_contains output pattern name` - Verify pattern exists
- `assert_not_contains output pattern name` - Verify pattern absent
- `assert_count output pattern count name` - Verify exact count
- `assert_order output pattern_a pattern_b name` - Verify order
- `create_test_project` - Create temp test directory
- `cleanup_test_project dir...` - Remove every directory given
- `create_transcript_dir` - Create a folder for session transcripts, outside the test project and the work folder (an untracked transcript in the test project makes its git working tree not clean)
- `finish_transcript_dir status dir` - In the EXIT trap: remove the transcript folder after a success, keep it and print its path after a failure
- `create_test_plan project_dir` - Create sample plan file

### Test Files

Each test file:
1. Sources `test-helpers.sh`
2. Runs Claude Code with specific prompts
3. Verifies expected behavior using assertions
4. Returns 0 on success, non-zero on failure

## Example Test

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/test-helpers.sh"

echo "=== Test: My Skill ==="

# Ask Claude about the skill
output=$(run_claude "What does the my-skill skill do?" 30)

# Verify response
assert_contains "$output" "expected behavior" "Skill describes behavior"

echo "=== All tests passed ==="
```

## Current Tests

### Fast Tests (run by default)

#### test-subagent-driven-development.sh
Tests skill content and requirements (~2 minutes):
- Skill loading and accessibility
- Workflow ordering (single task review, spec + quality verdicts)
- Self-review requirements documented
- Plan reading efficiency documented
- Spec compliance reviewer skepticism documented
- Review loops documented
- Task context provision documented

### Integration Tests (use --integration flag)

#### test-subagent-driven-development-integration.sh
Full workflow execution test (~10-30 minutes):
- Creates real test project with Node.js setup
- Creates implementation plan with 2 tasks
- Executes plan using subagent-driven-development
- Verifies actual behaviors:
  - Plan read once at start (not per task)
  - Task briefs handed to subagents as workspace files
  - Subagents perform self-review before reporting
  - A single task review returns both spec-compliance and code-quality verdicts
  - Task reviewer verifies the diff independently
  - Working implementation is produced
  - Tests pass
  - Proper git commits created

**What it tests:**
- The workflow actually works end-to-end
- Our improvements are actually applied
- Subagents follow the skill correctly
- Final code is functional and tested

#### test-researching-prior-art.sh

Merged-report contract of the researching-prior-art skill on a seeded fixture repo (slow; use `--timeout 1800`).

#### test-researching-prior-art-gate.sh

Brainstorming presents the research-gate message verbatim and dispatches nothing before the N answer (slow; use `--timeout 1800`).

## Adding New Tests

1. Create new test file: `test-<skill-name>.sh`
2. Source test-helpers.sh
3. Write tests using `run_claude` (or `run_claude_in_workdir`) and assertions; never call `claude` directly, never `cd` into the plugin repository, and write transcripts with `tee` into a `create_transcript_dir` folder, not into the test project
4. Add to test list in `run-skill-tests.sh`
5. Make executable: `chmod +x test-<skill-name>.sh`

## Timeout Considerations

- Default timeout: 5 minutes per test
- Claude Code may take time to respond
- Adjust with `--timeout` if needed
- Tests should be focused to avoid long runs

## Debugging Failed Tests

With `--verbose`, you'll see full Claude output:
```bash
./run-skill-tests.sh --verbose --test test-subagent-driven-development.sh
```

Without verbose, only failures show output.

## CI/CD Integration

To run in CI:
```bash
# Run with explicit timeout for CI environments
./run-skill-tests.sh --timeout 900

# Exit code 0 = success, non-zero = failure
```

## Notes

- Tests verify skill *instructions*, not full execution
- Full workflow tests would be very slow
- Focus on verifying key skill requirements
- Tests should be deterministic
- Avoid testing implementation details
