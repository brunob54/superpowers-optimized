# Batched Autonomous Mode for subagent-driven-development — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a batched, resumable, fully-autonomous execution mode to subagent-driven-development: implement up to X tasks per session, stop at ≥60% context pressure, write a handoff into `state.md`, resume cleanly after `/clear`.

**Architecture:** The pressure-estimation logic already in `hooks/skill-activator.js` gains a session-autodiscovery variant and a `--pressure` CLI entry point the orchestrator calls between tasks. `skills/subagent-driven-development/SKILL.md` gains a Batched Autonomous Mode section (batch loop, handoff contract, autonomy policy, resume procedure). `hooks/skill-rules.json` gains batch/resume triggers. Spec: `docs/specs/2026-07-06-sdd-batched-autonomous-mode-design.md`.

**Tech Stack:** Node.js (stdlib only) for hooks + unit tests; Markdown skill files; bash for integration tests.

**Assumptions:**
- Assumes Claude Code session JSONLs live at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` — will NOT work if Claude Code changes that layout (CLI then returns `{"error":"unmeasurable"}` and the 3-task fallback cap applies).
- Assumes the most-recently-modified JSONL belongs to the current session — will NOT hold with a second concurrently active session in the same project (fallback cap covers the failure).
- Assumes live sessions run the installed plugin copy under `~/.claude/plugins/cache/` — behavioral verification of SKILL.md changes requires reinstalling the local plugin first.

---

### Task 1: Session-autodiscovery pressure functions in skill-activator.js

**Files:**
- Modify: `hooks/skill-activator.js`
- Test: `tests/codex/test-skill-activator.js`

**Security flag:** `none`

**Does NOT cover:** selecting among multiple *concurrently active* sessions (latest mtime wins; misattribution is accepted and mitigated by the CLI fallback in Task 2). Does not cover non-default `~/.claude` locations.

- [ ] **Step 1: Write failing tests**

Append to `tests/codex/test-skill-activator.js`, directly after the existing `getContextPressure` test block (before the final summary/exit lines at the bottom of the file — keep those last):

```js
// ── Context pressure — session autodiscovery ─────────────────────────────────

const {
  findLatestSessionJsonl,
  getContextPressureAuto,
} = require('../../hooks/skill-activator');

console.log('\nContext pressure — findLatestSessionJsonl / getContextPressureAuto');

function withTempHome(fn) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-auto-'));
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  try {
    return fn(tmpHome);
  } finally {
    process.env.USERPROFILE = orig.up;
    process.env.HOME = orig.home;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

test('findLatestSessionJsonl returns null when project dir does not exist', () => {
  withTempHome((tmpHome) => {
    const result = findLatestSessionJsonl(path.join(tmpHome, 'no-such-project'));
    assert.strictEqual(result, null);
  });
});

test('findLatestSessionJsonl picks the most recently modified jsonl', () => {
  withTempHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const projDir = cwdToProjectDir(cwd);
    const turns = [{ input_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 10 }];
    const oldPath = makeJsonlSession('session-old', projDir, tmpHome, turns);
    const newPath = makeJsonlSession('session-new', projDir, tmpHome, turns);
    // Force distinct mtimes — same-millisecond writes are common
    const now = Date.now() / 1000;
    fs.utimesSync(oldPath, now - 100, now - 100);
    fs.utimesSync(newPath, now, now);
    assert.strictEqual(findLatestSessionJsonl(cwd), newPath);
  });
});

test('findLatestSessionJsonl ignores non-jsonl files', () => {
  withTempHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const projDir = cwdToProjectDir(cwd);
    const projectPath = path.join(tmpHome, '.claude', 'projects', projDir);
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'notes.txt'), 'not a session');
    assert.strictEqual(findLatestSessionJsonl(cwd), null);
  });
});

test('getContextPressureAuto returns pressure from the latest session', () => {
  withTempHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const projDir = cwdToProjectDir(cwd);
    // Old session at 80%, new session at 20% — auto must report the NEW one
    const oldPath = makeJsonlSession('session-old', projDir, tmpHome, [
      { input_tokens: 0, cache_creation_input_tokens: 160000, cache_read_input_tokens: 0, output_tokens: 10 },
    ]);
    const newPath = makeJsonlSession('session-new', projDir, tmpHome, [
      { input_tokens: 0, cache_creation_input_tokens: 40000, cache_read_input_tokens: 0, output_tokens: 10 },
    ]);
    const now = Date.now() / 1000;
    fs.utimesSync(oldPath, now - 100, now - 100);
    fs.utimesSync(newPath, now, now);
    const result = getContextPressureAuto(cwd);
    assert.ok(result !== null, 'Should return a result');
    assert.strictEqual(result.percent, 20);
    assert.strictEqual(result.overThreshold, false);
  });
});

test('getContextPressureAuto returns null when no sessions exist', () => {
  withTempHome((tmpHome) => {
    assert.strictEqual(getContextPressureAuto(path.join(tmpHome, 'empty-project')), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/codex/test-skill-activator.js`
Expected: FAIL — `findLatestSessionJsonl is not a function` (new exports missing).

- [ ] **Step 3: Implement**

In `hooks/skill-activator.js`, insert after the `getContextPressure` function (after its closing brace, before `buildContextPressureBlock`):

```js
/**
 * Find the most recently modified session JSONL for this project.
 * Used when the caller does not know its own session id (e.g. --pressure CLI).
 * Returns the full path, or null if the project dir is absent or has no sessions.
 */
function findLatestSessionJsonl(cwd) {
  const projectDir = cwdToProjectDir(cwd);
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const projectPath = path.join(homeDir, '.claude', 'projects', projectDir);

  let files;
  try {
    files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
  } catch {
    return null;
  }

  let latest = null;
  let latestMtime = -1;
  for (const f of files) {
    const full = path.join(projectPath, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.mtimeMs > latestMtime) {
      latestMtime = st.mtimeMs;
      latest = full;
    }
  }
  return latest;
}

/**
 * Context pressure from the most recently modified session JSONL.
 * Same return shape as getContextPressure; null when unmeasurable.
 */
function getContextPressureAuto(cwd) {
  const jsonlPath = findLatestSessionJsonl(cwd);
  if (!jsonlPath) return null;
  return getContextPressure(cwd, path.basename(jsonlPath, '.jsonl'));
}
```

In the `module.exports` block at the bottom, add after `getContextPressure,`:

```js
    findLatestSessionJsonl,
    getContextPressureAuto,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/codex/test-skill-activator.js`
Expected: PASS — all new autodiscovery tests green, zero regressions in existing tests.

- [ ] **Step 5: Commit**

```bash
git add hooks/skill-activator.js tests/codex/test-skill-activator.js
git commit -m "Add session-autodiscovery context pressure functions"
```

---

### Task 2: `--pressure` CLI entry point

**Files:**
- Modify: `hooks/skill-activator.js`
- Test: `tests/codex/test-skill-activator.js`

**Security flag:** `none`

**Does NOT cover:** any other CLI flags; `--pressure` with extra/unknown arguments beyond the optional cwd (ignored). Stdin hook mode must remain byte-for-byte unchanged when argv has no `--pressure`.

- [ ] **Step 1: Write failing tests**

Append to `tests/codex/test-skill-activator.js` after the Task 1 test block (still before the summary/exit lines):

```js
// ── --pressure CLI ────────────────────────────────────────────────────────────

const { execFileSync } = require('child_process');
const ACTIVATOR_PATH = path.join(__dirname, '..', '..', 'hooks', 'skill-activator.js');

function runPressureCli(cwd, tmpHome) {
  const out = execFileSync('node', [ACTIVATOR_PATH, '--pressure', cwd], {
    env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
  }).toString();
  return JSON.parse(out);
}

console.log('\n--pressure CLI');

test('CLI reports pressure below threshold', () => {
  withTempHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const projDir = cwdToProjectDir(cwd);
    makeJsonlSession('session-a', projDir, tmpHome, [
      { input_tokens: 0, cache_creation_input_tokens: 40000, cache_read_input_tokens: 0, output_tokens: 10 },
    ]);
    const result = runPressureCli(cwd, tmpHome);
    assert.strictEqual(result.percent, 20);
    assert.strictEqual(result.overThreshold, false);
  });
});

test('CLI reports overThreshold at >= 60%', () => {
  withTempHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const projDir = cwdToProjectDir(cwd);
    makeJsonlSession('session-a', projDir, tmpHome, [
      { input_tokens: 0, cache_creation_input_tokens: 130000, cache_read_input_tokens: 0, output_tokens: 10 },
    ]);
    const result = runPressureCli(cwd, tmpHome);
    assert.strictEqual(result.overThreshold, true);
  });
});

test('CLI prints {"error":"unmeasurable"} when no session data exists', () => {
  withTempHome((tmpHome) => {
    const result = runPressureCli(path.join(tmpHome, 'empty-project'), tmpHome);
    assert.deepStrictEqual(result, { error: 'unmeasurable' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/codex/test-skill-activator.js`
Expected: FAIL — CLI invocation hangs waiting on stdin or returns hook output, not pressure JSON. (If it hangs, the `execFileSync` inherits no stdin and `main()` gets empty input, printing `{}` — the assertions on `percent` then fail.)

- [ ] **Step 3: Implement**

In `hooks/skill-activator.js`, replace:

```js
if (require.main === module) {
  main();
} else {
```

with:

```js
if (require.main === module) {
  if (process.argv[2] === '--pressure') {
    // CLI mode: report context pressure for the given (or current) cwd.
    // Used by subagent-driven-development's batched autonomous mode between tasks.
    const pressure = getContextPressureAuto(process.argv[3] || process.cwd());
    process.stdout.write(JSON.stringify(pressure || { error: 'unmeasurable' }));
  } else {
    main();
  }
} else {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/codex/test-skill-activator.js`
Expected: PASS — 3 new CLI tests green, zero regressions.

- [ ] **Step 5: Run the full hook unit suite for regressions**

Run: `bash tests/codex/run-unit-tests.sh`
Expected: PASS — all suites green.

- [ ] **Step 6: Commit**

```bash
git add hooks/skill-activator.js tests/codex/test-skill-activator.js
git commit -m "Add --pressure CLI entry point to skill-activator"
```

---

### Task 3: Batched Autonomous Mode section in subagent-driven-development SKILL.md

**Files:**
- Modify: `skills/subagent-driven-development/SKILL.md`

**Security flag:** `none`

**Does NOT cover:** automatic `/clear` (impossible from inside a session — user performs it); protecting `state.md` from unrelated overwrites (position survives in plan.md + git per spec non-goals); parallel-session resume.

- [ ] **Step 1: Update frontmatter description**

In `skills/subagent-driven-development/SKILL.md`, replace the frontmatter:

```yaml
---
name: subagent-driven-development
description: >
  Executes plans using parallel subagents with per-task implementation
  and staged review gates. Invoke for parallel plan execution in the
  current session. Routed by writing-plans handoff or using-superpowers
  for large plans with independent tasks.
---
```

with:

```yaml
---
name: subagent-driven-development
description: >
  Executes plans using parallel subagents with per-task implementation
  and staged review gates. Invoke for parallel plan execution in the
  current session. Also provides Batched Autonomous Mode: implement up
  to N tasks per session with a context-pressure batch boundary, write
  a handoff into state.md, and resume after /clear. Triggers on:
  "implement the next N tasks", "execute the plan in batches",
  "resume the plan". Routed by writing-plans handoff or
  using-superpowers for large plans with independent tasks.
---
```

- [ ] **Step 2: Add the mode section**

Insert the following section immediately before the `## Handling Implementer Status` section:

```markdown
## Batched Autonomous Mode

Use this mode when the user asks to execute a plan in batches ("implement the
next N tasks", "execute the plan in batches") or to resume a batched run
("resume the plan"). Inside a batch, execution is fully autonomous — never ask
the user. Announce: `I'm using subagent-driven-development (batched autonomous mode).`

### Batch Loop

1. If `state.md` at the project root records a plan in progress, run the
   Resume Procedure below before executing anything.
2. Execute tasks with the normal per-task flow (implementer → spec review →
   quality review → update plan.md checkbox → commit). Per-task checkboxes and
   commits are the crash-safe position record — never defer them to batch end.
3. After each task, end the batch when ANY of the following holds:
   - **Context pressure ≥ 60% (primary boundary).** Run
     `node "${CLAUDE_PLUGIN_ROOT}/hooks/skill-activator.js" --pressure "$(pwd)"`
     and stop when the JSON output has `"overThreshold": true`.
     **Fallback:** if the command errors or prints `{"error":"unmeasurable"}`,
     cap this batch at 3 tasks total. Never let a failed measurement extend a batch.
   - **The user's explicit task count X is reached.** X is a cap, not a target —
     pressure can end the batch earlier.
   - **The plan is complete.**
   - **A blocker occurred** (see Autonomy Policy below).

### Batch End — Handoff

Write the handoff into `state.md` at the project root (full rewrite of the
plan-execution sections, hard cap 100 lines):

- `## Current Goal` — one line
- `## Plan` — path to the plan file + "Next task: N — <title>"
- `## Batch Summary` — one line per task completed THIS batch
- `## Decisions & Deviations` — choices made autonomously, with a one-line why
- `## Discovered Constraints` — forward-relevant facts (paths, gotchas, versions)
- `## Open Issues` — blockers and questions for the user; mark blocking ones
- `## Resume Instructions` — the exact prompt to paste after /clear

Do NOT re-summarize earlier batches: completed work lives in plan.md checkboxes
and git history. Carry forward only facts a future batch needs.

Then stop with a message stating what was completed, any open issues
(blocking questions first), and verbatim resume instructions:

> Batch complete (N tasks). Context at P%. To continue: run `/clear`, then paste:
> "Resume the plan at <plan-path> (batched autonomous mode)"

### Autonomy Policy (inside a batch)

Never ask the user mid-batch. This overrides the interactive handling of
implementer statuses for the duration of a batch:

- **NEEDS_CONTEXT:** answer from the plan, the spec, and the repository. If the
  answer cannot be derived, treat as BLOCKED.
- **BLOCKED, plan ambiguity, or verification failing 2+ times:** end the batch
  early. Journal the blocker and the specific question under `## Open Issues`
  (marked blocking). Never best-guess a plan ambiguity — a wrong guess poisons
  every downstream task with nobody watching.

Review gates are NOT relaxed: full spec-compliance and code-quality review per
task, and pre-implementation security review for `security`-flagged tasks.

### Resume Procedure (fresh session after /clear)

1. Read `state.md`; read the plan at the recorded path; read recent `git log`.
2. Reconcile position: plan.md checkboxes + git are authoritative; state.md is
   narrative and may be one batch stale. Before dispatching the first unchecked
   task, check `git log` for evidence it was already implemented (a crash
   between commit and checkbox update leaves it done but unchecked); if so,
   mark its checkbox complete and advance.
3. If `## Open Issues` contains a blocking question and the resume prompt does
   not answer it, present the question to the user and STOP — never execute
   past an unanswered blocker. Record the eventual answer under
   `## Decisions & Deviations`.
4. Start the next batch at the first genuinely unchecked task.
```

- [ ] **Step 3: Verify structure**

Run: `grep -c "^### " skills/subagent-driven-development/SKILL.md && grep -n "Batched Autonomous Mode\|Resume Procedure\|Autonomy Policy\|Batch End" skills/subagent-driven-development/SKILL.md`
Expected: the four new headings present; file remains valid Markdown with frontmatter intact (`head -1` is `---`).

- [ ] **Step 4: Commit**

```bash
git add skills/subagent-driven-development/SKILL.md
git commit -m "Add Batched Autonomous Mode to subagent-driven-development"
```

---

### Task 4: Batch/resume triggers in skill-rules.json

**Files:**
- Modify: `hooks/skill-rules.json`
- Test: `tests/codex/test-skill-activator.js`

**Security flag:** `none`

**Does NOT cover:** phrasings without the word "plan", "task", or "batch" (e.g. bare "continue" or "resume" must NOT trigger — too ambiguous); routing priority changes for the existing SDD entry (stays `medium`).

- [ ] **Step 1: Write failing tests**

Append to `tests/codex/test-skill-activator.js` (before the summary/exit lines):

```js
// ── Batched autonomous mode triggers ─────────────────────────────────────────

const { matchSkills } = require('../../hooks/skill-activator');

console.log('\nBatched autonomous mode triggers');

function matchesSdd(prompt) {
  return matchSkills(prompt).some(m => m.skill === 'subagent-driven-development');
}

test('"implement the next 3 tasks of the plan" triggers SDD', () => {
  assert.strictEqual(matchesSdd('implement the next 3 tasks of the plan'), true);
});

test('"execute the plan in batches" triggers SDD', () => {
  assert.strictEqual(matchesSdd('execute the plan in batches'), true);
});

test('"resume the plan" triggers SDD', () => {
  assert.strictEqual(matchesSdd('resume the plan'), true);
});

test('"resume the implementation" triggers SDD', () => {
  assert.strictEqual(matchesSdd('resume the implementation'), true);
});

test('bare "resume" does NOT trigger SDD', () => {
  assert.strictEqual(matchesSdd('resume'), false);
});

test('"what is the plan" does NOT trigger SDD', () => {
  assert.strictEqual(matchesSdd('what is the plan here?'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/codex/test-skill-activator.js`
Expected: FAIL — the three positive-trigger tests fail (no matching keywords/patterns yet).

- [ ] **Step 3: Implement**

In `hooks/skill-rules.json`, replace the `subagent-driven-development` rule:

```json
{
 "skill": "subagent-driven-development",
 "type": "workflow",
 "priority": "medium",
 "keywords": [
  "parallel",
  "subagent",
  "run in parallel",
  "concurrent"
 ],
 "intentPatterns": [
  "(run|do|execute)\\s+(these|them|tasks?)\\s+(in\\s+)?parallel",
  "use\\s+subagent"
 ]
}
```

with:

```json
{
 "skill": "subagent-driven-development",
 "type": "workflow",
 "priority": "medium",
 "keywords": [
  "parallel",
  "subagent",
  "run in parallel",
  "concurrent",
  "in batches",
  "batched",
  "next tasks",
  "resume the plan",
  "handoff"
 ],
 "intentPatterns": [
  "(run|do|execute)\\s+(these|them|tasks?)\\s+(in\\s+)?parallel",
  "use\\s+subagent",
  "implement\\s+the\\s+next\\s+\\d+\\s+tasks?",
  "(execute|run|implement)\\s+(the\\s+)?plan\\s+in\\s+batch(es)?",
  "resume\\s+the\\s+(plan|implementation)"
 ]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/codex/test-skill-activator.js`
Expected: PASS — all 6 trigger tests green (positive prompts score ≥ threshold via intent patterns at weight 2; negatives stay below), zero regressions in other rules' tests.

- [ ] **Step 5: Validate JSON and run full suite**

Run: `node -e "JSON.parse(require('fs').readFileSync('hooks/skill-rules.json','utf8')); console.log('valid')" && bash tests/codex/run-unit-tests.sh`
Expected: `valid`, then all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add hooks/skill-rules.json tests/codex/test-skill-activator.js
git commit -m "Add batch/resume triggers for subagent-driven-development"
```

---

### Task 5: Integration test for batched mode (headless Claude)

**Files:**
- Create: `tests/claude-code/test-batched-autonomous-mode.sh`

**Security flag:** `none`

**Does NOT cover:** full end-to-end plan execution with real subagents (existing SDD integration tests are skill-comprehension style — this follows the same convention; a live batch run would take 30+ minutes and burn quota).

- [ ] **Step 1: Create the test following the existing convention**

Create `tests/claude-code/test-batched-autonomous-mode.sh` (mode 755, matching `test-subagent-driven-development.sh` style):

```bash
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
```

- [ ] **Step 2: Make executable and lint**

Run: `chmod +x tests/claude-code/test-batched-autonomous-mode.sh && bash -n tests/claude-code/test-batched-autonomous-mode.sh && echo "syntax OK"`
Expected: `syntax OK`

- [ ] **Step 3: Run the test (requires claude CLI; skip in CI-less environments)**

Run: `cd tests/claude-code && ./test-batched-autonomous-mode.sh`
Expected: PASS — all 4 assertions green. (If `claude` is unavailable, record the skip in the task notes — Step 2's syntax check is the minimum gate.)

- [ ] **Step 4: Commit**

```bash
git add tests/claude-code/test-batched-autonomous-mode.sh
git commit -m "Add integration test for batched autonomous mode"
```

---

### Task 6: Skill-triggering prompt for batched mode

**Files:**
- Create: `tests/skill-triggering/prompts/subagent-driven-development.txt`
- Modify: `tests/skill-triggering/run-all.sh`

**Security flag:** `none`

**Does NOT cover:** trigger testing of other new phrasings (one representative prompt per skill, matching the existing one-file-per-skill convention).

- [ ] **Step 1: Create the prompt file**

Create `tests/skill-triggering/prompts/subagent-driven-development.txt`:

```
Implement the next 3 tasks of the plan in docs/plans/plan.md, then write a handoff so I can resume after /clear.
```

- [ ] **Step 2: Register the skill in the runner**

In `tests/skill-triggering/run-all.sh`, in the `SKILLS=(` array, add after the `"executing-plans"` line:

```bash
    "subagent-driven-development"
```

- [ ] **Step 3: Verify wiring**

Run: `bash -n tests/skill-triggering/run-all.sh && ls tests/skill-triggering/prompts/subagent-driven-development.txt`
Expected: no syntax error; prompt file listed. (Full run requires the claude CLI: `cd tests/skill-triggering && ./run-all.sh` — expected: subagent-driven-development PASSES.)

- [ ] **Step 4: Commit**

```bash
git add tests/skill-triggering/prompts/subagent-driven-development.txt tests/skill-triggering/run-all.sh
git commit -m "Add skill-triggering test for batched execution prompts"
```

---

### Task 7: Release prep — version bump and release notes

**Files:**
- Modify: `VERSION`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugin.universal.yaml`
- Modify: `RELEASE-NOTES.md`

**Security flag:** `none`

**Does NOT cover:** publishing/tagging (user-driven); resolving the pre-existing plugin.universal.yaml drift beyond syncing its version number.

- [ ] **Step 1: Bump versions to 6.7.0**

- `VERSION`: replace `6.6.1` with `6.7.0`
- `.claude-plugin/plugin.json`: `"version": "6.6.1"` → `"version": "6.7.0"`
- `.claude-plugin/marketplace.json`: `"version": "6.6.1"` → `"version": "6.7.0"`
- `plugin.universal.yaml`: `version: "6.5.2"` → `version: "6.7.0"`

- [ ] **Step 2: Add release notes entry**

In `RELEASE-NOTES.md`, insert after the `# Superpowers Optimized Release Notes` heading (before the `## v6.6.1` section):

```markdown
## v6.7.0 (2026-07-06)

Batched Autonomous Mode: resumable, context-bounded plan execution.

### New Features

**Batched Autonomous Mode (subagent-driven-development)** — Execute up to N plan tasks per session, each via a fresh subagent with full review gates, ending the batch when context pressure reaches 60% (measured live via the new `--pressure` CLI on the skill-activator hook, with a conservative 3-task fallback cap when measurement fails). At batch end the orchestrator writes a handoff into `state.md` (100-line cap, no cumulative re-summarizing) and prints exact resume instructions; after `/clear`, "resume the plan" reconciles position from plan.md checkboxes + git (authoritative) against the state.md narrative, refuses to run past unanswered blocking questions, and starts the next batch. Inside a batch the run is fully autonomous: blockers and plan ambiguities end the batch early with a journaled question instead of a guess. Spec: `docs/specs/2026-07-06-sdd-batched-autonomous-mode-design.md`.

**`--pressure` CLI on skill-activator** — `node hooks/skill-activator.js --pressure [cwd]` reports the current session's context pressure as JSON by reading the most recently modified session JSONL, reusing the v6.6.1 pressure-gate estimation. Prints `{"error":"unmeasurable"}` when no usable session data exists.

### Changes

**subagent-driven-development triggers** — `hooks/skill-rules.json` now routes "implement the next N tasks", "execute the plan in batches", and "resume the plan/implementation" to subagent-driven-development.

**Test coverage** — Unit tests for session autodiscovery and the `--pressure` CLI in `test-skill-activator.js`; new integration test `tests/claude-code/test-batched-autonomous-mode.sh`; skill-triggering prompt for batched execution.
```

- [ ] **Step 3: Verify version consistency**

Run: `cat VERSION && grep '"version"' .claude-plugin/plugin.json .claude-plugin/marketplace.json && grep 'version:' plugin.universal.yaml | head -1`
Expected: all four report `6.7.0`.

- [ ] **Step 4: Final full test run**

Run: `bash tests/codex/run-unit-tests.sh && bash tests/smart-compress/run-tests.sh`
Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add VERSION .claude-plugin/plugin.json .claude-plugin/marketplace.json plugin.universal.yaml RELEASE-NOTES.md
git commit -m "v6.7.0 - Batched Autonomous Mode: resumable, context-bounded plan execution"
```
