#!/usr/bin/env node
/**
 * Unit tests — hooks/subagent-guard.js
 *
 * Verifies:
 *   - Skill invocation detection (action verbs + skill names)
 *   - Expanded action verb coverage (activate, trigger, execute, launch, spawn, start)
 *   - Skill tool invocation detection
 *   - False positive avoidance (bare mentions without action verbs)
 *   - SKILL_NAMES completeness (includes new skills)
 *   - Output shape: decision=block + reason string
 *   - Marker search window: a marker at the start of any of the first 10
 *     non-blank lines exempts; the 11th does not
 *
 * Run: node tests/codex/test-subagent-guard.js
 * No dependencies beyond Node.js stdlib.
 *
 * Note: subagent-guard.js uses stdin event-based parsing (not async iterator),
 * so we test by spawning it as a child process with piped stdin.
 */

'use strict';

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOK_PATH = path.join(__dirname, '..', '..', 'hooks', 'subagent-guard.js');
const source = fs.readFileSync(HOOK_PATH, 'utf8');

// The hook appends one record per blocked message to a log file under
// $HOME/.claude. The test gives the hook a temporary HOME, so a test run
// never writes into the real ~/.claude of the person who runs it. The
// folder is removed when the process exits.
const TEMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-guard-test-'));
process.on('exit', () => fs.rmSync(TEMP_HOME, { recursive: true, force: true }));
const HOOK_ENV = { ...process.env, HOME: TEMP_HOME };
const VIOLATION_LOG = path.join(TEMP_HOME, '.claude', 'hooks-logs', 'subagent-violations.jsonl');
const TEST_AGENT_ID = 'test-agent';

let passed = 0;
let failed = 0;
// The number of runGuard calls that returned decision=block. Each one must
// leave exactly one record in VIOLATION_LOG.
let blockCount = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  \u2713 ${label}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

/**
 * Run subagent-guard.js with a given last_assistant_message.
 * Returns parsed JSON output.
 */
function runGuard(lastMessage) {
  const input = JSON.stringify({
    last_assistant_message: lastMessage,
    agent_id: TEST_AGENT_ID,
    agent_type: 'test',
  });
  let output;
  try {
    output = execSync(`node "${HOOK_PATH}"`, {
      input,
      env: HOOK_ENV,
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (err) {
    // execSync throws on non-zero exit, but the hook should always exit 0
    if (!err.stdout) throw err;
    output = err.stdout;
  }
  const result = JSON.parse(output.trim());
  if (result.decision === 'block') blockCount++;
  return result;
}

const REVIEW_MARKER = '<!-- multi-review report -->';
const ORCHESTRATION_MARKER = '<!-- orchestration report -->';
const RESEARCH_MARKER = '<!-- research report -->';
// The window the guard searches, in non-blank lines. Kept in step with
// MARKER_SEARCH_LINES in hooks/subagent-guard.js.
const WINDOW = 10;
// A body that pairs an action verb with a skill name. Every exemption test
// carries one, so the test fails on the unmodified guard instead of passing
// vacuously — the convention this file already states at its whitespace tests.
const VERB_SKILL_BODY =
  'BLOCKED task=3: plan says use executing-plans semantics but the spec forbids it.';

/**
 * A message whose Nth non-blank line is `marker`, with (n - 1) lines of
 * narration above it and a verb+skill body below.
 */
function markerOnNonBlankLine(marker, n) {
  const lines = [];
  for (let i = 1; i < n; i++) {
    lines.push(`Narration line ${i} of the controller's own summary.`);
  }
  lines.push(marker, VERB_SKILL_BODY);
  return lines.join('\n');
}

// ── SKILL_NAMES completeness ─────────────────────────────────────────────────

console.log('\nSKILL_NAMES completeness');

test('Includes original 21 skills', () => {
  const originals = [
    'using-superpowers', 'brainstorming', 'deliberation', 'writing-plans',
    'executing-plans', 'subagent-driven-development', 'systematic-debugging',
    'test-driven-development', 'verification-before-completion', 'token-efficiency',
    'context-management', 'dispatching-parallel-agents', 'requesting-code-review',
    'receiving-code-review', 'finishing-a-development-branch', 'error-recovery',
    'frontend-design', 'claude-md-creator', 'self-consistency-reasoner',
    'using-git-worktrees', 'premise-check',
  ];
  for (const name of originals) {
    assert.ok(source.includes(`'${name}'`), `Missing original skill: ${name}`);
  }
});

test('Includes red-team skill', () => {
  assert.ok(source.includes("'red-team'"), 'Missing red-team skill');
});

test('Includes new refactoring skill', () => {
  assert.ok(source.includes("'refactoring'"), 'Missing refactoring skill');
});

test('Includes new performance-investigation skill', () => {
  assert.ok(source.includes("'performance-investigation'"), 'Missing performance-investigation skill');
});

test('Includes new dependency-management skill', () => {
  assert.ok(source.includes("'dependency-management'"), 'Missing dependency-management skill');
});

// ── Action verb coverage ─────────────────────────────────────────────────────

console.log('\nAction verb coverage');

test('Original verbs: invoking, using, running, calling', () => {
  assert.ok(source.includes('invoking?'), 'Missing invoke/invoking');
  assert.ok(source.includes('using'), 'Missing using');
  assert.ok(source.includes('running?'), 'Missing run/running');
  assert.ok(source.includes('called?'), 'Missing call/called');
  assert.ok(source.includes('calling'), 'Missing calling');
});

test('New verbs: activate, trigger, execute, launch, spawn, start', () => {
  assert.ok(source.includes('activat'), 'Missing activate/activating');
  assert.ok(source.includes('trigger'), 'Missing trigger/triggering');
  assert.ok(source.includes('execut'), 'Missing execute/executing');
  assert.ok(source.includes('launch'), 'Missing launch/launching');
  assert.ok(source.includes('spawn'), 'Missing spawn/spawning');
  assert.ok(source.includes('start'), 'Missing start/starting');
});

// ── Skill tool detection patterns ────────────────────────────────────────────

console.log('\nSkill tool detection');

test('Detects Skill() function call pattern', () => {
  assert.ok(source.includes('Skill\\s*\\(\\s*'), 'Missing Skill() invocation pattern');
});

test('Detects skill: key pattern', () => {
  assert.ok(source.includes('skill:\\s*'), 'Missing skill: key pattern');
});

// ── Violation detection (end-to-end via child process) ───────────────────────

console.log('\nViolation detection (end-to-end)');

test('Blocks "I\'m using the brainstorming skill"', () => {
  const result = runGuard("I'm using the brainstorming skill to help with this.");
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

test('Blocks "Invoke the superpowers-orchestrator skill"', () => {
  const result = runGuard('Invoke the superpowers-orchestrator using-superpowers skill.');
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

test('Blocks "I activated the systematic-debugging skill"', () => {
  const result = runGuard('I activated the systematic-debugging skill to investigate.');
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

test('Blocks "triggering the test-driven-development skill"', () => {
  const result = runGuard('I am triggering the test-driven-development skill now.');
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

test('Blocks "executing the context-management skill"', () => {
  const result = runGuard('Let me try executing the context-management skill.');
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

test('Blocks "launching the frontend-design skill"', () => {
  const result = runGuard('I am launching the frontend-design skill for this UI work.');
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

test('Blocks "spawning the refactoring skill"', () => {
  const result = runGuard('I will be spawning the refactoring skill to restructure.');
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

test('Blocks "starting the performance-investigation skill"', () => {
  const result = runGuard('Starting the performance-investigation skill to profile.');
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

test('Blocks "calling the dependency-management skill"', () => {
  const result = runGuard('I am calling the dependency-management skill for updates.');
  assert.strictEqual(result.decision, 'block', `Expected block, got: ${JSON.stringify(result)}`);
});

// ── False positive avoidance ─────────────────────────────────────────────────

console.log('\nFalse positive avoidance');

test('Does NOT block bare skill name mention without action verb', () => {
  const result = runGuard('The brainstorming skill exists in this codebase. I read it.');
  assert.deepStrictEqual(result, {}, `Bare mention should not block: ${JSON.stringify(result)}`);
});

test('Does NOT block file path containing skill name', () => {
  const result = runGuard('I read the file at skills/systematic-debugging/SKILL.md');
  assert.deepStrictEqual(result, {}, `File path should not block: ${JSON.stringify(result)}`);
});

test('Does NOT block normal task completion messages', () => {
  const result = runGuard('I have completed the refactoring task. All tests pass. Here is the summary of changes made.');
  assert.deepStrictEqual(result, {}, `Normal message should not block: ${JSON.stringify(result)}`);
});

test('Does NOT block empty messages', () => {
  const result = runGuard('');
  assert.deepStrictEqual(result, {}, 'Empty message should not block');
});

// ── Output shape ─────────────────────────────────────────────────────────────

console.log('\nOutput shape');

test('Block output has decision and reason fields', () => {
  const result = runGuard("I'm using the brainstorming skill.");
  assert.strictEqual(result.decision, 'block');
  assert.strictEqual(typeof result.reason, 'string');
  assert.ok(result.reason.includes('SKILL LEAKAGE DETECTED'), `Reason should mention leakage: ${result.reason}`);
});

test('Allow output is empty object', () => {
  const result = runGuard('I completed the task using Read and Edit tools.');
  assert.deepStrictEqual(result, {});
});

test('Handles invalid JSON input gracefully', () => {
  try {
    const output = execSync(`echo "not json" | node "${HOOK_PATH}"`, {
      env: HOOK_ENV,
      encoding: 'utf8',
      timeout: 5000,
    });
    const result = JSON.parse(output.trim());
    assert.deepStrictEqual(result, {}, 'Invalid JSON should produce {}');
  } catch (err) {
    if (err.stdout) {
      const result = JSON.parse(err.stdout.trim());
      assert.deepStrictEqual(result, {});
    }
  }
});

// ── multi-doc-review ─────────────────────────────────────────────────────────

console.log('\nmulti-doc-review');

test('Includes multi-doc-review skill in roster', () => {
  assert.ok(source.includes("'multi-doc-review'"), 'Missing multi-doc-review skill');
});

test('Blocks "using multi-doc-review" without marker', () => {
  const out = runGuard('I completed the task by using multi-doc-review on the doc.');
  assert.strictEqual(out.decision, 'block');
});

test('Marker-prefixed report quoting skill names is exempt', () => {
  const report = [
    '<!-- multi-review report -->',
    '### Verdict',
    'Critical: 0 | Important: 1 | Minor: 0',
    '',
    '### Findings',
    '#### Important',
    '- [I1] Section 2: the doc tells implementers to start using brainstorming before invoking writing-plans | contradicts section 4 | reword',
  ].join('\n');
  const out = runGuard(report);
  assert.deepStrictEqual(out, {});
});

test('multi-review marker on the second non-blank line exempts', () => {
  const out = runGuard(`I was invoking brainstorming.\n${REVIEW_MARKER}\n${VERB_SKILL_BODY}`);
  assert.deepStrictEqual(out, {});
});

test('Leading whitespace before marker still exempts', () => {
  const report = [
    '',
    '  <!-- multi-review report -->',
    '### Verdict',
    'Critical: 0 | Important: 1 | Minor: 0',
    '',
    '### Findings',
    '#### Important',
    '- [I1] Section 3: the doc recommends using brainstorming here | wrong gate | reword',
  ].join('\n');
  const out = runGuard(report);
  assert.deepStrictEqual(out, {});
});

// ── multi-code-review ────────────────────────────────────────────────────────

console.log('\nmulti-code-review');

test('Includes multi-code-review skill in roster', () => {
  assert.ok(source.includes("'multi-code-review'"), 'Missing multi-code-review skill');
});

test('Blocks "using multi-code-review" without marker', () => {
  const out = runGuard('I finished by using multi-code-review on the branch.');
  assert.strictEqual(out.decision, 'block');
});

test('Marker-prefixed code-review report quoting skill names is exempt', () => {
  const report = [
    '<!-- multi-review report -->',
    '### Verdict',
    'Critical: 0 | Important: 1 | Minor: 0',
    '',
    '### Findings',
    '#### Important',
    '- [I1] skills/foo/SKILL.md:12 — tells the agent to start using subagent-driven-development mid-task | wrong layer | reword',
  ].join('\n');
  const out = runGuard(report);
  assert.deepStrictEqual(out, {});
});

// ── Orchestration report marker ──────────────────────────────────────────────

console.log('\nOrchestration report marker');

test('orchestration-marked BLOCKED return naming a skill is allowed', () => {
  const out = runGuard([
    '<!-- orchestration report -->',
    'BLOCKED task=3: plan says use executing-plans semantics but the spec forbids it — which governs?',
  ].join('\n'));
  assert.deepStrictEqual(out, {});
});

test('same skill-naming BLOCKED text without the marker is blocked', () => {
  const out = runGuard(
    'BLOCKED task=3: plan says use executing-plans semantics but the spec forbids it — which governs?'
  );
  assert.strictEqual(out.decision, 'block');
});

test('orchestration marker on the second non-blank line exempts', () => {
  const out = runGuard(`I was using executing-plans.\n${ORCHESTRATION_MARKER}\n${VERB_SKILL_BODY}`);
  assert.deepStrictEqual(out, {});
});

test('leading whitespace before the orchestration marker still exempts', () => {
  // Body must contain a verb+skill pair so this fails on the unmodified
  // guard — a benign body would pass vacuously.
  const out = runGuard(
    '  <!-- orchestration report -->\nBLOCKED task=3: plan says use executing-plans semantics'
  );
  assert.deepStrictEqual(out, {});
});

// ── researching-prior-art ────────────────────────────────────────────────────

console.log('\nresearching-prior-art');

test('Includes researching-prior-art skill in roster', () => {
  assert.ok(source.includes("'researching-prior-art'"), 'Missing researching-prior-art skill');
});

test('Blocks "spawn researching-prior-art" (spawn verb form) without marker', () => {
  const out = runGuard('I will spawn researching-prior-art to look at the candidates.');
  assert.strictEqual(out.decision, 'block');
});

test('Blocks "using researching-prior-art" without marker', () => {
  const out = runGuard('I finished by using researching-prior-art on the candidates.');
  assert.strictEqual(out.decision, 'block');
});

test('Blocks skill: "researching-prior-art" form without marker', () => {
  const out = runGuard('skill: "researching-prior-art"');
  assert.strictEqual(out.decision, 'block');
});

test('Marker-prefixed research report quoting skill names is exempt', () => {
  const report = [
    '<!-- research report -->',
    '## Findings',
    '- The candidate README tells adopters to start using test-driven-development before invoking writing-plans (README.md:12).',
    '- Evidence gap: changelog fetch failed; claim labeled "degraded: memory only".',
  ].join('\n');
  const out = runGuard(report);
  assert.deepStrictEqual(out, {});
});

test('research marker on the second non-blank line exempts', () => {
  const out = runGuard(`I was invoking brainstorming.\n${RESEARCH_MARKER}\n${VERB_SKILL_BODY}`);
  assert.deepStrictEqual(out, {});
});

test('Leading whitespace before research marker still exempts', () => {
  // Body must contain a verb+skill pair so this fails on the unmodified
  // guard — a benign body would pass vacuously.
  const out = runGuard('  <!-- research report -->\nSummary: the docs recommend using refactoring before adoption.');
  assert.deepStrictEqual(out, {});
});

// ── Marker search window ─────────────────────────────────────────────────────

console.log('\nMarker search window');

test('The marker search window is a single named constant', () => {
  const declarations = source.match(/const\s+MARKER_SEARCH_LINES\b/g) || [];
  assert.strictEqual(
    declarations.length, 1,
    `Expected exactly one MARKER_SEARCH_LINES declaration, found ${declarations.length}`
  );
  assert.ok(
    /const\s+MARKER_SEARCH_LINES\s*=\s*10\s*;/.test(source),
    'MARKER_SEARCH_LINES must be 10'
  );
});

test('The hook comments state the window rule', () => {
  assert.ok(
    !/opens with/.test(source),
    'No comment in hooks/subagent-guard.js may still say a marker "opens with" the message'
  );
  assert.ok(
    source.includes('MARKER_SEARCH_LINES non-blank lines'),
    'The hook comments must state the window in terms of MARKER_SEARCH_LINES non-blank lines'
  );
});

for (const [label, marker] of [
  ['multi-review', REVIEW_MARKER],
  ['orchestration', ORCHESTRATION_MARKER],
  ['research', RESEARCH_MARKER],
]) {
  test(`${label} marker on the 10th non-blank line exempts`, () => {
    const out = runGuard(markerOnNonBlankLine(marker, WINDOW));
    assert.deepStrictEqual(out, {}, `Expected exempt, got: ${JSON.stringify(out)}`);
  });

  test(`${label} marker on the 11th non-blank line does not exempt`, () => {
    const out = runGuard(markerOnNonBlankLine(marker, WINDOW + 1));
    assert.strictEqual(out.decision, 'block', `Expected block, got: ${JSON.stringify(out)}`);
  });
}

test('Twelve blank lines before the marker still exempt (blanks do not consume the window)', () => {
  const message = new Array(12).fill('').concat([ORCHESTRATION_MARKER, VERB_SKILL_BODY]).join('\n');
  const out = runGuard(message);
  assert.deepStrictEqual(out, {}, `Expected exempt, got: ${JSON.stringify(out)}`);
});

// This case documents the intended behaviour: a line holding only
// whitespace is blank and does not consume the window. It does not
// distinguish trim() from trimStart(), because trailing whitespace can
// never affect a startsWith test, and either function empties a line
// that holds only a carriage return.
test('Twelve CRLF blank lines before the marker still exempt', () => {
  const message = new Array(12).fill('').concat([ORCHESTRATION_MARKER, VERB_SKILL_BODY]).join('\r\n');
  const out = runGuard(message);
  assert.deepStrictEqual(out, {}, `Expected exempt, got: ${JSON.stringify(out)}`);
});

// This case documents the intended behaviour: a line holding only
// whitespace is blank and does not consume the window. It does not
// distinguish trim() from trimStart(), because trailing whitespace can
// never affect a startsWith test, and either function empties a
// spaces-only line.
test('Twelve spaces-only lines before the marker still exempt', () => {
  const message = new Array(12).fill('   ').concat([ORCHESTRATION_MARKER, VERB_SKILL_BODY]).join('\n');
  const out = runGuard(message);
  assert.deepStrictEqual(out, {}, `Expected exempt, got: ${JSON.stringify(out)}`);
});

test('Marker followed by text on the first line still exempts (prefix match)', () => {
  const out = runGuard([
    '<!-- orchestration report --> REVIEW_DONE rounds=2',
    'The loop finished by using multi-code-review semantics.',
  ].join('\n'));
  assert.deepStrictEqual(out, {}, `Expected exempt, got: ${JSON.stringify(out)}`);
});

test('A marker quoted after other text on its line does not exempt', () => {
  const out = runGuard([
    'Round 1 findings:',
    `- [C1] the ${ORCHESTRATION_MARKER} marker is described wrongly | reword`,
    'I was using executing-plans to check that.',
  ].join('\n'));
  assert.strictEqual(out.decision, 'block', `Expected block, got: ${JSON.stringify(out)}`);
});

test('Leading whitespace before a marker on the third non-blank line still exempts', () => {
  const out = runGuard([
    'Self-Review complete.',
    'No spec requirement is left without a task.',
    `   ${ORCHESTRATION_MARKER}`,
    VERB_SKILL_BODY,
  ].join('\n'));
  assert.deepStrictEqual(out, {}, `Expected exempt, got: ${JSON.stringify(out)}`);
});

test('Two marker lines inside the window exempt', () => {
  const out = runGuard([
    'The round 2 reviewer returned this, quoted below in full.',
    REVIEW_MARKER,
    'Quoted above from the round 2 reviewer return.',
    ORCHESTRATION_MARKER,
    'REVIEW_DONE rounds=2 — the loop ran by using multi-code-review semantics.',
  ].join('\n'));
  assert.deepStrictEqual(out, {}, `Expected exempt, got: ${JSON.stringify(out)}`);
});

test('A CRLF message with the marker on the second non-blank line exempts', () => {
  const out = runGuard(`Self-Review complete.\r\n${ORCHESTRATION_MARKER}\r\n${VERB_SKILL_BODY}\r\n`);
  assert.deepStrictEqual(out, {}, `Expected exempt, got: ${JSON.stringify(out)}`);
});

// ── Violation log isolation ──────────────────────────────────────────────────

console.log('\nViolation log isolation');

// This test must stay the last one: it counts the records of every
// runGuard call above.
test('Each blocked message writes one record to the log in the temporary HOME', () => {
  assert.ok(blockCount > 0, 'No runGuard call returned decision=block');
  assert.ok(
    fs.existsSync(VIOLATION_LOG),
    `No log at ${VIOLATION_LOG}: the hook did not receive the temporary HOME`
  );
  const records = fs.readFileSync(VIOLATION_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.strictEqual(records.length, blockCount, `Expected ${blockCount} records, found ${records.length}`);
  for (const record of records) {
    assert.strictEqual(record.agentId, TEST_AGENT_ID, `Unexpected record: ${JSON.stringify(record)}`);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`subagent-guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
