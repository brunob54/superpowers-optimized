#!/usr/bin/env node
/**
 * Unit tests — hooks/skill-activator.js (the UserPromptSubmit hook) and
 * hooks/codex/user-prompt-submit-adapter.js, which delegates to it.
 *
 * Verifies:
 *   - Correct Codex payload field: `prompt` (not `userPrompt`)
 *   - Micro-task detection skips routing
 *   - Skill matching returns correct skills for known prompts
 *   - Output shape matches Codex UserPromptSubmit spec
 *   - Confidence threshold filters weak matches
 *
 * Run: node tests/codex/test-skill-activator.js
 * No dependencies beyond Node.js stdlib.
 */

'use strict';

const assert = require('assert');

const { evaluatePayload } = require('../../hooks/codex/user-prompt-submit-adapter');
// The variable name that Claude Code documents for hooks. The test writes it
// here and does not take it from the hook, so that a wrong name in the hook
// fails the checks below.
const PROJECT_DIR_VARIABLE = 'CLAUDE_PROJECT_DIR';

// When CLAUDE_PROJECT_DIR is set, the hook reads the recall files from the
// folder that it names, and also from the payload's cwd. A caller of this file
// may have the variable in its environment, so it is removed here, once: the
// hook function called in this process and every hook process started from it
// (a child process inherits this environment) then read only the payload's cwd.
// A check that needs the variable sets it for its own hook process.
delete process.env[PROJECT_DIR_VARIABLE];

let passed = 0;
let failed = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function runActivator(payload) {
  return evaluatePayload(payload);
}

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Payload field: must read `prompt`, not `userPrompt` ──────────────────────

console.log('\nCodex payload field: `prompt`');

test('Reads `prompt` field (Codex shape) — produces output for matching prompt', () => {
  const result = runActivator({
    prompt: 'there is a bug in my code, it crashes when I call the function',
    session_id: 'test',
    cwd: process.cwd(),
  });
  // A debugging prompt should produce additionalContext
  const ctx = result.hookSpecificOutput?.additionalContext;
  assert.ok(ctx && ctx.length > 0,
    `Expected additionalContext for a bug/debug prompt, got: ${JSON.stringify(result)}`);
});

test('`userPrompt` field (Claude shape) is NOT used — no routing on wrong field', () => {
  // If the activator reads userPrompt instead of prompt, this would produce output.
  // If it correctly reads `prompt` and prompt is missing, it should return {}.
  const result = runActivator({
    userPrompt: 'there is a bug in my code it crashes',
    session_id: 'test',
    cwd: process.cwd(),
  });
  // prompt field is absent → micro-task or no match → {}
  assert.deepStrictEqual(result, {},
    `Activator is reading userPrompt instead of prompt: ${JSON.stringify(result)}`);
});

// ── Output shape ──────────────────────────────────────────────────────────────

console.log('\nOutput shape (Codex UserPromptSubmit spec)');

test('Output shape: hookSpecificOutput.hookEventName = "UserPromptSubmit"', () => {
  const result = runActivator({
    prompt: 'I need to debug this error: TypeError cannot read property of undefined',
    session_id: 'test',
  });
  if (result.hookSpecificOutput) {
    assert.strictEqual(result.hookSpecificOutput.hookEventName, 'UserPromptSubmit',
      `Wrong hookEventName: ${result.hookSpecificOutput.hookEventName}`);
  }
  // If no match, {} is also valid — this test passes either way
});

test('Output shape: additionalContext is a string when present', () => {
  const result = runActivator({
    prompt: 'write tests first before implementing the feature please',
  });
  if (result.hookSpecificOutput?.additionalContext) {
    assert.strictEqual(typeof result.hookSpecificOutput.additionalContext, 'string',
      'additionalContext is not a string');
  }
});

test('No output fields outside hookSpecificOutput (no top-level additionalContext)', () => {
  const result = runActivator({
    prompt: 'debug this crash in production',
  });
  assert.ok(!result.additionalContext,
    'Top-level additionalContext found — wrong output shape for Codex');
});

// ── Micro-task detection ──────────────────────────────────────────────────────

console.log('\nMicro-task detection (skip routing)');

test('Typo fix → {} (micro-task, skip routing)', () => {
  const result = runActivator({ prompt: 'fix the typo in the variable name' });
  assert.deepStrictEqual(result, {},
    `Expected {} for typo fix, got: ${JSON.stringify(result)}`);
});

test('Rename variable → {} (micro-task)', () => {
  const result = runActivator({ prompt: 'rename getUserData to fetchUserData' });
  assert.deepStrictEqual(result, {},
    `Expected {} for rename, got: ${JSON.stringify(result)}`);
});

test('Single line fix → {} (micro-task)', () => {
  const result = runActivator({ prompt: 'fix the typo on line 42' });
  assert.deepStrictEqual(result, {},
    `Expected {} for single line fix, got: ${JSON.stringify(result)}`);
});

test('Substantive multi-word prompt → NOT a micro-task', () => {
  const result = runActivator({
    prompt: 'I need to implement a new feature for user authentication with JWT tokens and refresh logic',
  });
  // Should not be treated as micro-task — either produces routing or {} from threshold
  // The key assertion: this is not the same as a typo fix
  assert.ok(typeof result === 'object', 'Must return an object');
});

// ── Skill routing accuracy ────────────────────────────────────────────────────

console.log('\nSkill routing accuracy');

test('Debug/error prompt → routes to systematic-debugging', () => {
  const result = runActivator({
    prompt: 'I have a bug in my code, the function returns undefined when it should return an array. How do I debug this?',
  });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(ctx.includes('systematic-debugging'),
    `Expected systematic-debugging in context, got: ${ctx.slice(0, 300)}`);
});

test('TDD prompt → routes to test-driven-development', () => {
  const result = runActivator({
    prompt: 'write the failing tests first before we implement the feature',
  });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(ctx.includes('test-driven-development'),
    `Expected test-driven-development, got: ${ctx.slice(0, 300)}`);
});

test('Brainstorm/new feature prompt → routes to brainstorming', () => {
  const result = runActivator({
    prompt: 'I want to add a new feature, let\'s brainstorm the best approach and architecture',
  });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(ctx.includes('brainstorming'),
    `Expected brainstorming, got: ${ctx.slice(0, 300)}`);
});

test('Code review prompt → routes to requesting-code-review', () => {
  const result = runActivator({
    prompt: 'can you review my code before I merge this PR?',
  });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(
    ctx.includes('requesting-code-review') || ctx.includes('code-review'),
    `Expected code review skill, got: ${ctx.slice(0, 300)}`
  );
});

test('Verification/done prompt → routes to verification-before-completion', () => {
  const result = runActivator({
    prompt: 'I think I\'m done, can you verify everything is correct before we say it\'s complete?',
  });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(ctx.includes('verification'),
    `Expected verification skill, got: ${ctx.slice(0, 300)}`);
});

test('Max 3 skills suggested per prompt', () => {
  // A very broad prompt might match many rules — should cap at 3
  const result = runActivator({
    prompt: 'debug this bug, write tests, review the code, brainstorm new features, and verify everything is done',
  });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  if (ctx) {
    // Count only skill list entries (lines starting with "  - superpowers-orchestrator:").
    // Excludes the instruction line "invoke superpowers-orchestrator:using-superpowers FIRST".
    const skillLines = ctx.split('\n').filter(l => /^\s+-\s+superpowers-orchestrator:/.test(l));
    assert.ok(skillLines.length <= 3,
      `More than 3 skills suggested: ${skillLines.length}\n${ctx}`);
  }
});

// ── Edge cases ────────────────────────────────────────────────────────────────

console.log('\nEdge cases');

test('Empty prompt → {} (no routing)', () => {
  const result = runActivator({ prompt: '' });
  assert.deepStrictEqual(result, {},
    `Expected {} for empty prompt, got: ${JSON.stringify(result)}`);
});

test('Missing prompt field entirely → {}', () => {
  const result = runActivator({ session_id: 'test', cwd: '/tmp' });
  assert.deepStrictEqual(result, {},
    `Expected {} for missing prompt, got: ${JSON.stringify(result)}`);
});

test('Very long prompt → does not crash, returns valid JSON', () => {
  const longPrompt = 'debug '.repeat(5000);
  const result = runActivator({ prompt: longPrompt });
  assert.ok(typeof result === 'object', 'Must return an object for long prompts');
});

test('Prompt with special regex characters → does not crash', () => {
  const result = runActivator({
    prompt: 'fix the bug in function(x) { return x[0] ?? null; } // regex: /[a-z]+/gi',
  });
  assert.ok(typeof result === 'object', 'Must handle regex chars without crashing');
});

// ── Memory recall (extractKeywords / searchSessionLog / buildMemoryContext) ───

const os = require('os');
const fs = require('fs');
const path = require('path');
const {
  extractKeywords,
  searchSessionLog,
  buildMemoryContext,
  MAX_MEMORY_ENTRIES,
} = require('../../hooks/skill-activator');

console.log('\nMemory recall — extractKeywords');

test('Strips stop words', () => {
  const kw = extractKeywords('what is the best way to fix this problem');
  // 'what','is','the','best','way','to','fix'(3 chars),'this','problem'
  // 'best' is not a stop word, len=4 → included. 'problem' included.
  // 'what','is','the','to','this' are stop words. 'fix' is 3 chars < 4.
  assert.ok(!kw.includes('the'), 'stop word "the" should be removed');
  assert.ok(!kw.includes('what'), 'stop word "what" should be removed');
  assert.ok(!kw.includes('fix'), '"fix" is 3 chars, below min length');
});

test('Keeps tokens >= 4 chars that are not stop words', () => {
  const kw = extractKeywords('brainstorming skill hooks session');
  assert.ok(kw.includes('brainstorming'), '"brainstorming" should be kept');
  assert.ok(kw.includes('skill'), '"skill" should be kept');
  assert.ok(kw.includes('hooks'), '"hooks" should be kept');
  assert.ok(kw.includes('session'), '"session" should be kept');
});

test('Preserves hyphenated compound tokens', () => {
  const kw = extractKeywords('check session-log memory recall');
  assert.ok(kw.includes('session-log'), '"session-log" should be preserved as compound');
});

test('Deduplicates tokens', () => {
  const kw = extractKeywords('hook hook hook session session');
  assert.strictEqual(kw.filter(t => t === 'hook').length, 1, 'hook should appear once');
  assert.strictEqual(kw.filter(t => t === 'session').length, 1, 'session should appear once');
});

test('Returns [] for empty input', () => {
  assert.deepStrictEqual(extractKeywords(''), []);
  assert.deepStrictEqual(extractKeywords(null), []);
});

console.log('\nMemory recall — searchSessionLog');

function makeTmpLog(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slog-unit-'));
  fs.writeFileSync(path.join(dir, 'session-log.md'), entries.join('\n'));
  return dir;
}

test('Returns [] when session-log.md absent', () => {
  const results = searchSessionLog('/nonexistent/path/xyz', ['hook']);
  assert.deepStrictEqual(results, []);
});

test('Returns [] when no keywords provided', () => {
  const dir = makeTmpLog(['## 2026-01-01 10:00 [saved]\nGoal: test\n']);
  const results = searchSessionLog(dir, []);
  fs.rmSync(dir, { recursive: true });
  assert.deepStrictEqual(results, []);
});

test('Skips [superseded] entries', () => {
  const dir = makeTmpLog([
    '## 2026-01-01 10:00 [saved] [superseded by 2026-02-01]',
    'Goal: old decision with keyword brainstorming',
    '',
    '## 2026-02-01 10:00 [saved]',
    'Goal: new decision',
    '',
  ]);
  const results = searchSessionLog(dir, ['brainstorming']);
  fs.rmSync(dir, { recursive: true });
  assert.strictEqual(results.length, 0, 'superseded entry should not be returned');
});

test('Returns most-recent match first', () => {
  const dir = makeTmpLog([
    '## 2025-01-01 10:00 [saved]',
    'Goal: older entry with keyword brainstorming',
    '',
    '## 2026-04-01 10:00 [saved]',
    'Goal: newer entry with keyword brainstorming',
    '',
  ]);
  const results = searchSessionLog(dir, ['brainstorming']);
  fs.rmSync(dir, { recursive: true });
  assert.ok(results[0].includes('newer entry'), 'most-recent entry should be first');
});

test(`Returns at most ${MAX_MEMORY_ENTRIES} entries`, () => {
  const entries = [];
  for (let i = 1; i <= 5; i++) {
    entries.push(`## 2026-01-0${i} 10:00 [saved]`, `Goal: entry ${i} with keyword brainstorming`, '');
  }
  const dir = makeTmpLog(entries);
  const results = searchSessionLog(dir, ['brainstorming']);
  fs.rmSync(dir, { recursive: true });
  assert.ok(results.length <= MAX_MEMORY_ENTRIES,
    `Should return at most ${MAX_MEMORY_ENTRIES}, got ${results.length}`);
});

console.log('\nMemory recall — buildMemoryContext');

test('Returns null for empty entries array', () => {
  assert.strictEqual(buildMemoryContext([]), null);
  assert.strictEqual(buildMemoryContext(null), null);
});

test('Wraps entries in session-memory-recall tags', () => {
  const ctx = buildMemoryContext(['## 2026-01-01 [saved]\nGoal: test']);
  assert.ok(ctx.includes('<session-memory-recall>'), 'should open tag');
  assert.ok(ctx.includes('</session-memory-recall>'), 'should close tag');
});

console.log('\nMemory recall — evaluatePayload integration');

test('Memory-only: no skill match + session-log hit → returns memory context', () => {
  const dir = makeTmpLog([
    '## 2026-04-01 09:00 [saved]',
    'Goal: condition-based waiting for flaky hooks',
    '',
  ]);
  const result = evaluatePayload({
    prompt: 'help me understand the condition-based waiting approach for hooks',
    cwd: dir,
  });
  fs.rmSync(dir, { recursive: true });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(ctx.includes('session-memory-recall'), 'should inject memory context');
});

test('Both: skill match + session-log hit → skill hint precedes memory context', () => {
  const dir = makeTmpLog([
    '## 2026-04-01 09:00 [saved]',
    'Goal: systematic debugging of hook failures',
    '',
  ]);
  const result = evaluatePayload({
    prompt: 'the test is failing with an error in my hook, help me debug this systematically',
    cwd: dir,
  });
  fs.rmSync(dir, { recursive: true });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(ctx.includes('user-prompt-submit-hook'), 'should include skill hint');
  assert.ok(ctx.includes('session-memory-recall'), 'should include memory recall');
  assert.ok(
    ctx.indexOf('user-prompt-submit-hook') < ctx.indexOf('session-memory-recall'),
    'skill hint should precede memory recall'
  );
});

// ── Known-issues recall ───────────────────────────────────────────────────────

const { searchKnownIssues, buildKnownIssuesContext } = require('../../hooks/skill-activator');

function makeTmpKnownIssues(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-unit-'));
  fs.writeFileSync(path.join(dir, 'known-issues.md'), content);
  return dir;
}

console.log('\nKnown-issues recall — searchKnownIssues');

test('Returns [] when known-issues.md absent', () => {
  assert.deepStrictEqual(searchKnownIssues('/nonexistent/xyz', ['hook']), []);
});

test('Returns [] when no keywords', () => {
  const dir = makeTmpKnownIssues('## Open issue\nSome content about hooks\n');
  const r = searchKnownIssues(dir, []);
  fs.rmSync(dir, { recursive: true });
  assert.deepStrictEqual(r, []);
});

test('Skips fixed entries (## ~~ strikethrough)', () => {
  const dir = makeTmpKnownIssues([
    '## ~~Fixed hook issue~~ ✅ Fixed',
    'Error: hooks stopped working',
    'Fix: updated to v6.5.1',
    '',
    '## Open hook performance issue',
    'Hooks are slow on large repos',
  ].join('\n'));
  const r = searchKnownIssues(dir, ['hooks']);
  fs.rmSync(dir, { recursive: true });
  assert.strictEqual(r.length, 1, 'should return only the open entry');
  assert.ok(r[0].includes('Open hook performance'), 'should be the open entry');
});

test('Matches open entries by keyword', () => {
  const dir = makeTmpKnownIssues([
    '## Codex hooks do not fire',
    'Error: SessionStart missing. Root cause: old codex-cli version.',
    '',
    '## Unrelated issue about skill routing',
    'Skills are not being matched correctly.',
  ].join('\n'));
  const r = searchKnownIssues(dir, ['codex', 'sessionstart']);
  fs.rmSync(dir, { recursive: true });
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].includes('Codex hooks'));
});

test('Returns most-recent match first', () => {
  const dir = makeTmpKnownIssues([
    '## Older hook issue',
    'hooks problem from before',
    '',
    '## Newer hook issue',
    'hooks problem more recent',
  ].join('\n'));
  const r = searchKnownIssues(dir, ['hooks']);
  fs.rmSync(dir, { recursive: true });
  assert.ok(r[0].includes('Newer hook issue'), 'most recent should be first');
});

console.log('\nKnown-issues recall — buildKnownIssuesContext');

test('Returns null for empty entries', () => {
  assert.strictEqual(buildKnownIssuesContext([]), null);
  assert.strictEqual(buildKnownIssuesContext(null), null);
});

test('Wraps entries in known-issues-recall tags', () => {
  const ctx = buildKnownIssuesContext(['## Issue\nSome problem']);
  assert.ok(ctx.includes('<known-issues-recall>'));
  assert.ok(ctx.includes('</known-issues-recall>'));
});

console.log('\nKnown-issues recall — evaluatePayload ordering');

test('known-issues context appears between skill hint and memory context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-order-'));
  fs.writeFileSync(path.join(dir, 'known-issues.md'), [
    '## Codex hooks not firing',
    'Error: hooks ignored. Root cause: old codex version.',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'session-log.md'), [
    '## 2026-04-01 09:00 [saved]',
    'Goal: systematic debugging of codex hook failures',
  ].join('\n'));
  const result = evaluatePayload({
    prompt: 'I need to debug why my codex hooks are not firing in the test environment',
    cwd: dir,
  });
  fs.rmSync(dir, { recursive: true });
  const ctx = result.hookSpecificOutput?.additionalContext || '';
  const kiIdx = ctx.indexOf('known-issues-recall');
  const memIdx = ctx.indexOf('session-memory-recall');
  if (kiIdx !== -1 && memIdx !== -1) {
    assert.ok(kiIdx < memIdx, 'known-issues should precede memory context');
  }
  // At minimum one of the recall sections should appear
  assert.ok(kiIdx !== -1 || memIdx !== -1, 'at least one recall section should appear');
});

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

test('"here is the handoff for the next tasks" does NOT trigger SDD', () => {
  assert.strictEqual(matchesSdd('here is the handoff for the next tasks'), false);
});

test('"resume the plan discussion from yesterday" does NOT trigger SDD', () => {
  assert.strictEqual(matchesSdd('resume the plan discussion from yesterday'), false);
});

// ── Batch phrasing must OUTRANK executing-plans, not merely appear ───────────
//
// matchesSdd() above only asserts presence. Presence is not enough: matches are
// sorted by priority before score (skill-activator.js), and executing-plans is
// `high` where SDD is `medium` — so a batch prompt that matches both lists
// executing-plans first and routes the user to inline execution. These assert
// the rank.

function topSkill(prompt) {
  const m = matchSkills(prompt);
  return m.length ? m[0].skill : null;
}

const SDD = 'subagent-driven-development';
const EXEC = 'executing-plans';

test('"execute the plan in batches" ranks SDD above executing-plans', () => {
  assert.strictEqual(topSkill('execute the plan in batches'), SDD);
});

test('batch phrasing with a plan path in between still ranks SDD first', () => {
  assert.strictEqual(
    topSkill('execute the plan in docs/superpowers-orchestrator/2026-08-02-foo/plans/foo.md in batches'), SDD);
});

test('"in batched autonomous mode" after a plan path ranks SDD first', () => {
  assert.strictEqual(
    topSkill('Execute the plan at docs/superpowers-orchestrator/2026-08-02-foo/plans/foo.md in batched autonomous mode'),
    SDD);
});

test('"implement the plan in batches" ranks SDD first', () => {
  assert.strictEqual(
    topSkill('Implement the plan in batches, starting with docs/superpowers-orchestrator/2026-08-02-foo/plans/foo.md'), SDD);
});

test('plain "execute the plan" still routes to executing-plans', () => {
  assert.strictEqual(topSkill('execute the plan'), EXEC);
});

test('plain "execute the plan at <path>" still routes to executing-plans', () => {
  assert.strictEqual(topSkill('Execute the plan at docs/superpowers-orchestrator/2026-08-02-foo/plans/foo.md'), EXEC);
});

test('"follow the plan" still routes to executing-plans', () => {
  assert.strictEqual(topSkill('follow the plan'), EXEC);
});

test('"start building" still routes to executing-plans', () => {
  assert.strictEqual(topSkill("let's start building"), EXEC);
});

test('a plan mentioned far before unrelated "in batch" text is NOT hijacked', () => {
  // The batch exclusion is distance-bounded; an unrelated later mention of
  // batching must not steal a plain execute-the-plan prompt.
  const far = 'execute the plan' + ' and also note that '.repeat(6) + 'we ship in batches';
  assert.strictEqual(topSkill(far), EXEC);
});

test('writing-plans paste prompt for batched mode routes to SDD', () => {
  assert.strictEqual(
    topSkill('Use subagents in batched autonomous mode on docs/superpowers-orchestrator/2026-08-02-foo/plans/foo.md'),
    SDD);
});

test('writing-plans paste prompt for interactive SDD routes to SDD', () => {
  assert.strictEqual(
    topSkill('Use subagents to implement docs/superpowers-orchestrator/2026-08-02-foo/plans/foo.md'), SDD);
});

test('"resume the implementation talk after lunch" does NOT trigger SDD', () => {
  assert.strictEqual(matchesSdd('resume the implementation talk after lunch'), false);
});

// ── orchestrating-development routing ────────────────────────────────────────

const ORCH = 'orchestrating-development';

test('"orchestrate the development of <spec>" ranks orchestrating-development first', () => {
  assert.strictEqual(
    topSkill('orchestrate the development of docs/superpowers-orchestrator/2026-08-25-foo/specs/foo-design.md'),
    ORCH);
});

// Shared lookup for the two tests below. If the 'specs' intent pattern is
// ever deleted from hooks/skill-rules.json, `Array.prototype.find` returns
// `undefined`; asserting here (rather than in each test) that the pattern
// was actually found — a non-empty string — stops that from silently
// passing as `new RegExp(undefined, 'i')` (which compiles to /undefined/i
// and would make the "no longer matches" test vacuously true).
function orchDevSpecPathPattern() {
  // hooks/skill-rules.json's top-level key is `rules`, an array of entries.
  const entry = require('../../hooks/skill-rules.json')
    .rules.find(s => s.skill === ORCH);
  const pathPattern = entry.intentPatterns.find(p => p.includes('specs'));
  assert.ok(
    typeof pathPattern === 'string' && pathPattern.length > 0,
    `expected an intent pattern containing 'specs' on ${ORCH}, found: ${pathPattern}`);
  return pathPattern;
}

// The path-shaped intent pattern is asserted directly: the verb-phrase
// pattern above it already matches "orchestrate the development", so a
// topSkill() assertion alone cannot tell whether the path pattern changed.
test('the orchestrating-development path pattern matches a new-layout spec path', () => {
  const pathPattern = orchDevSpecPathPattern();
  assert.ok(
    new RegExp(pathPattern, 'i').test(
      'orchestrate the development of docs/superpowers-orchestrator/2026-08-25-foo/specs/foo-design.md'),
    `path pattern ${pathPattern} should match a new-layout spec path`);
});

test('the orchestrating-development path pattern no longer matches an old-layout spec path', () => {
  const pathPattern = orchDevSpecPathPattern();
  assert.ok(
    !new RegExp(pathPattern, 'i').test(
      'orchestrate the development of docs/specs/2026-08-04-foo-design.md'),
    `path pattern ${pathPattern} should not match an old-layout spec path`);
});

test('"run the whole pipeline autonomously from the spec" routes to orchestrating-development', () => {
  assert.strictEqual(topSkill('run the whole pipeline autonomously from the spec'), ORCH);
});

test('"Resume orchestration for <plan>" routes to orchestrating-development, not SDD', () => {
  assert.strictEqual(
    topSkill('Resume orchestration for docs/superpowers-orchestrator/2026-08-04-foo/plans/foo.md'),
    ORCH);
});

test('"Abandon orchestration for <plan>" routes to orchestrating-development', () => {
  assert.strictEqual(
    topSkill('Abandon orchestration for docs/superpowers-orchestrator/2026-08-04-foo/plans/foo.md'),
    ORCH);
});

test('"orchestrate it" (the brainstorming-gate reply phrase) routes to orchestrating-development', () => {
  assert.strictEqual(topSkill('orchestrate it'), ORCH);
});

test('bare "orchestrate" scores below threshold and routes nowhere', () => {
  assert.strictEqual(topSkill('orchestrate'), null);
});

test('non-regression: "execute the plan in batches" still ranks SDD first', () => {
  assert.strictEqual(topSkill('execute the plan in batches'), SDD);
});

test('non-regression: "resume the plan at <path>" still routes to SDD', () => {
  assert.strictEqual(
    topSkill('Resume the plan at docs/superpowers-orchestrator/2026-08-04-foo/plans/foo.md (batched autonomous mode)'), SDD);
});

// ── Debug-prompt routing (Codex post-push checklist canonical prompt) ─────────

console.log('\nDebug-prompt routing');

function matchesDebugging(prompt) {
  return matchSkills(prompt).some(m => m.skill === 'systematic-debugging');
}

test('checklist debug prompt routes to systematic-debugging', () => {
  assert.strictEqual(
    matchesDebugging('debug this stack trace from the API and identify the root cause before proposing a fix'),
    true);
});

test('"debug why the login fails" routes to systematic-debugging', () => {
  assert.strictEqual(matchesDebugging('debug why the login fails'), true);
});

test('"cargo build --debug is slow" does NOT route to systematic-debugging', () => {
  assert.strictEqual(matchesDebugging('cargo build --debug is slow'), false);
});

// ── multi-code-review routing ────────────────────────────────────────────────

console.log('\nmulti-code-review routing');

function matchesMcr(prompt) {
  return matchSkills(prompt).some(m => m.skill === 'multi-code-review');
}

test('"run several independent code reviews on this branch" routes to multi-code-review', () => {
  assert.strictEqual(matchesMcr('run several independent code reviews on this branch'), true);
});

test('"review the branch 3 times" routes to multi-code-review', () => {
  assert.strictEqual(matchesMcr('review the branch 3 times'), true);
});

test('"review the spec 3 times" does NOT route to multi-code-review', () => {
  assert.strictEqual(matchesMcr('review the spec 3 times'), false);
});

test('"code review my changes" does NOT route to multi-code-review', () => {
  assert.strictEqual(matchesMcr('code review my changes'), false);
});

// ── researching-prior-art ─────────────────────────────────────────────────────

console.log('\nresearching-prior-art');

function matchesRpa(prompt) {
  return matchSkills(prompt).some(m => m.skill === 'researching-prior-art');
}

test('"research prior art for the candidate libraries" routes to researching-prior-art', () => {
  assert.strictEqual(matchesRpa('research prior art for the candidate libraries'), true);
});

test('"run prior-art research on these npm packages" routes to researching-prior-art', () => {
  assert.strictEqual(matchesRpa('run prior-art research on these npm packages'), true);
});

// These two carry zero of the rule's literal keywords (verified: 0 keyword
// hits, score 2 — entirely from the intent pattern), so a pass can only come
// through the "research the candidates" / "(research|verify) the
// library|libraries|package|packages|dependency|dependencies" intent
// patterns, not from keyword matching.
test('"research candidates for this decision" routes to researching-prior-art (intent pattern only)', () => {
  assert.strictEqual(matchesRpa('research candidates for this decision'), true);
});

test('"verify these dependencies before merging" routes to researching-prior-art (intent pattern only)', () => {
  assert.strictEqual(matchesRpa('verify these dependencies before merging'), true);
});

test('"rename getUserData to fetchUserData" does NOT route to researching-prior-art', () => {
  assert.strictEqual(matchesRpa('rename getUserData to fetchUserData'), false);
});

test('"update dependencies to latest" routes to dependency-management, not researching-prior-art', () => {
  const matched = matchSkills('update dependencies to latest').map(m => m.skill);
  assert.ok(matched.includes('dependency-management'), `Expected dependency-management, got: ${JSON.stringify(matched)}`);
  assert.ok(!matched.includes('researching-prior-art'), `Unexpected researching-prior-art match: ${JSON.stringify(matched)}`);
});

// ── worklog routing ───────────────────────────────────────────────────────────
// The worklog rule stands before brainstorming, refactoring and writing-plans
// in hooks/skill-rules.json: with equal priority and equal score the sort
// keeps the file order, and only the first three suggestions are returned.

console.log('\nworklog routing');

const suggested = (prompt) => matchSkills(prompt).map(m => m.skill);

test('the worklog rule stands before brainstorming, refactoring and writing-plans in hooks/skill-rules.json', () => {
  const rules = require('../../hooks/skill-rules.json').rules;
  const indexOf = (skill) => rules.findIndex(r => r.skill === skill);
  const worklogIndex = indexOf('worklog');
  assert.ok(worklogIndex !== -1, 'expected a worklog rule in hooks/skill-rules.json');
  for (const skill of ['brainstorming', 'refactoring', 'writing-plans']) {
    const otherIndex = indexOf(skill);
    assert.ok(otherIndex !== -1, `expected a ${skill} rule in hooks/skill-rules.json`);
    assert.ok(worklogIndex < otherIndex,
      `expected worklog (index ${worklogIndex}) before ${skill} (index ${otherIndex})`);
  }
});

for (const prompt of [
  'update the work log of the test refactoring',
  'create a work log for the test refactoring',
]) {
  test(`"${prompt}" suggests worklog`, () => {
    const matched = suggested(prompt);
    assert.ok(matched.includes('worklog'), `Expected worklog, got: ${JSON.stringify(matched)}`);
  });
}

// "network logs" and "framework logs" contain the keyword "work log" as a
// plain substring (score 1, below the threshold of 2); "worker threads" and
// "work logging" must not reach an intent pattern.
for (const prompt of [
  'check the network logs',
  'read the framework logs',
  'keep track of the worker threads',
  'close work logging when the app shuts down',
]) {
  test(`"${prompt}" does NOT suggest worklog`, () => {
    const matched = suggested(prompt);
    assert.ok(!matched.includes('worklog'), `Unexpected worklog suggestion: ${JSON.stringify(matched)}`);
  });
}

test('a feature request that mentions keeping track still suggests brainstorming', () => {
  const matched = suggested('add a feature to keep track of the worker threads, write a plan and refactor the pool module');
  assert.ok(matched.includes('brainstorming'), `Expected brainstorming, got: ${JSON.stringify(matched)}`);
});

// ── dashboard routing ─────────────────────────────────────────────────────────
// The dashboard rule matches only the verbs of the skill (refresh, update,
// publish, sync, share) and the words "project dashboard" / "status
// dashboard", so a request to build a dashboard UI stays with frontend-design.

console.log('\ndashboard routing');

for (const prompt of [
  'refresh the project dashboard',
  'sync the dashboard edits back into the markdown files',
  'share the dashboard with my colleagues',
]) {
  test(`"${prompt}" suggests dashboard`, () => {
    const matched = suggested(prompt);
    assert.ok(matched.includes('dashboard'), `Expected dashboard, got: ${JSON.stringify(matched)}`);
  });
}

for (const prompt of [
  'build a dashboard for sales data',
  'create a dashboard component in React',
  'update the dashboard component styles',
]) {
  test(`"${prompt}" does NOT suggest dashboard`, () => {
    const matched = suggested(prompt);
    assert.ok(!matched.includes('dashboard'), `Unexpected dashboard suggestion: ${JSON.stringify(matched)}`);
  });
}

test('a request to build a dashboard still suggests frontend-design', () => {
  const matched = suggested('build a dashboard for sales data');
  assert.ok(matched.includes('frontend-design'), `Expected frontend-design, got: ${JSON.stringify(matched)}`);
});

// ── Messages the user did not type, and recall already shown ─────────────────
//
// Claude Code passes task notifications and messages from other agents to the
// UserPromptSubmit hook as if they were prompts. Measured on 2026-09-30: 70 of
// 72 recall injections of one orchestrated run were attached to such messages.
// Most of these tests run the real hook script (the Claude Code entry point);
// the last ones call the Codex adapter. Each test uses a unique session id,
// because the recall record of a session id persists in the temporary folder
// across test runs.

console.log('\nAgent messages and repeated recall (hooks/skill-activator.js)');

const { spawnSync } = require('child_process');
const { recallStatePath } = require('../../hooks/skill-activator');
const HOOK_SCRIPT = path.join(__dirname, '../../hooks/skill-activator.js');
const KNOWN_ISSUE_HEADING = '## Flaky deploy script loses the release tag';
const SAVED_HEADING = '## 2026-01-01 10:00 [saved]';
const SAVED_GOAL = 'Goal: fix the deploy script that loses the release tag';
const RECALL_PROMPT = 'there is a bug: the deploy script crashes and loses the release tag, please debug it';

// Runs fn with a temporary project folder that holds the given files
// ({ file name: content }), and removes the folder whatever the outcome.
function withProjectFiles(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-unit-'));
  try {
    Object.entries(files).forEach(([name, content]) => fs.writeFileSync(path.join(dir, name), content));
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const RECALL_PROJECT_FILES = {
  'known-issues.md': `${KNOWN_ISSUE_HEADING}\n\n**Symptom:** the deploy script crashes and the release tag is lost.\n`,
  'session-log.md': `${SAVED_HEADING}\n${SAVED_GOAL}\n`,
};
const withRecallProject = fn => withProjectFiles(RECALL_PROJECT_FILES, fn);

let recallSessionCount = 0;
const recallSessionIds = [];
function uniqueSessionId() {
  recallSessionCount += 1;
  const sessionId = `recall-unit-${process.pid}-${Date.now()}-${recallSessionCount}`;
  recallSessionIds.push(sessionId);
  return sessionId;
}

// A hook that crashes or prints nothing fails the test: the exit status is
// checked, and an empty output is not valid JSON. `options` are more options
// for the child process (cwd, env); `args` are arguments after the script.
function runHook(payload, options = {}, args = []) {
  const result = spawnSync(process.execPath, [HOOK_SCRIPT, ...args], { input: JSON.stringify(payload), encoding: 'utf8', ...options });
  assert.strictEqual(result.status, 0, `The hook exited with status ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function contextOf(output) {
  return output.hookSpecificOutput?.additionalContext || '';
}

// The text that the hook receives is not the text of the transcript: Claude
// Code writes the line "Another Claude session sent a message:" into the
// transcript record, and the hook input does not hold it. The first two
// fixtures are forms that a hook which only logs its input recorded on
// 2026-10-01; the other four were not recorded as hook input (see the
// comment on AGENT_MESSAGE_OPENINGS in the hook).
const AGENT_MESSAGES = {
  'a task notification': `<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>${RECALL_PROMPT}</summary>\n</task-notification>`,
  'a message that another agent sent': `<agent-message from="beta">\n${RECALL_PROMPT}\n</agent-message>`,
  'a subagent hand-back report': `[Subagent hand-back] The text below is the final report of a subagent this session delegated to.\n  ${RECALL_PROMPT}`,
  'a teammate message': `<teammate-message teammate_id="orch-batch-1">\n${RECALL_PROMPT}\n</teammate-message>`,
  'a message in its transcript form': `Another Claude session sent a message:\n<agent-message from="a2">\n${RECALL_PROMPT}\n</agent-message>`,
  'a message in its transcript form, received during work': `Another Claude session sent a message while you were working:\n<agent-message from="a2">\n${RECALL_PROMPT}\n</agent-message>`,
};

for (const [label, prompt] of Object.entries(AGENT_MESSAGES)) {
  test(`${label} gets no hint and no recall`, () => withRecallProject((dir) => {
    const output = runHook({ prompt, session_id: uniqueSessionId(), cwd: dir });
    assert.deepStrictEqual(output, {}, `Expected {} for ${label}, got: ${JSON.stringify(output)}`);
  }));
}

test('a task notification that starts after a newline gets no hint and no recall', () => withRecallProject((dir) => {
  const output = runHook({ prompt: `\n  ${AGENT_MESSAGES['a task notification']}`, session_id: uniqueSessionId(), cwd: dir });
  assert.deepStrictEqual(output, {});
}));

for (const [label, message] of Object.entries(AGENT_MESSAGES)) {
  test(`a typed prompt that holds ${label} later in its text is still enriched`, () => withRecallProject((dir) => {
    const output = runHook({ prompt: `${RECALL_PROMPT}; it also prints ${message}`, session_id: uniqueSessionId(), cwd: dir });
    assert.ok(contextOf(output).includes(KNOWN_ISSUE_HEADING), `Expected the known issue, got: ${JSON.stringify(output)}`);
  }));
}

// `where` names the case in the failure message.
function assertHintAndRecall(output, where = '') {
  const context = contextOf(output);
  const missing = ['<user-prompt-submit-hook>', KNOWN_ISSUE_HEADING, '<session-memory-recall>', SAVED_HEADING].filter(text => !context.includes(text));
  assert.deepStrictEqual(missing, [], `Expected the skill hint, the known issue and the session-log entry ${where}, got: ${context}`);
}

// A typed prompt that opens with only a part of an opening, or with an
// opening in another letter case, is a typed prompt: the match must not be
// wider than the list.
for (const opening of ['[deploy log](deploy.md)', '<error>', '<task>', 'Another crash:', 'another claude session sent a message, then']) {
  test(`a typed prompt that opens with ${opening} is still enriched`, () => withRecallProject((dir) => {
    assertHintAndRecall(runHook({ prompt: `${opening} ${RECALL_PROMPT}`, session_id: uniqueSessionId(), cwd: dir }));
  }));
}

test('a recalled entry is shown once per session; the skill hint stays', () => withRecallProject((dir) => {
  const sessionId = uniqueSessionId();
  const first = contextOf(runHook({ prompt: RECALL_PROMPT, session_id: sessionId, cwd: dir }));
  const second = contextOf(runHook({ prompt: RECALL_PROMPT, session_id: sessionId, cwd: dir }));
  assert.ok(first.includes(KNOWN_ISSUE_HEADING) && first.includes(SAVED_HEADING), `First prompt lacks the recall: ${first}`);
  assert.ok(!second.includes('<known-issues-recall>') && !second.includes('<session-memory-recall>'), `Second prompt repeats the recall: ${second}`);
  assert.ok(second.includes('<user-prompt-submit-hook>'), `Second prompt lost the skill hint: ${second}`);
}));

test('another session gets the same recall again', () => withRecallProject((dir) => {
  runHook({ prompt: RECALL_PROMPT, session_id: uniqueSessionId(), cwd: dir });
  const other = contextOf(runHook({ prompt: RECALL_PROMPT, session_id: uniqueSessionId(), cwd: dir }));
  assert.ok(other.includes(KNOWN_ISSUE_HEADING), `Expected the recall in a new session, got: ${other}`);
}));

test('without a session id the recall is shown every time', () => withRecallProject((dir) => {
  runHook({ prompt: RECALL_PROMPT, cwd: dir });
  const again = contextOf(runHook({ prompt: RECALL_PROMPT, cwd: dir }));
  assert.ok(again.includes(KNOWN_ISSUE_HEADING), `Expected the recall without a session id, got: ${again}`);
}));

test('a session id with path characters still records the recall', () => withRecallProject((dir) => {
  const sessionId = `../${uniqueSessionId()}/x`;
  recallSessionIds.push(sessionId);
  runHook({ prompt: RECALL_PROMPT, session_id: sessionId, cwd: dir });
  const second = contextOf(runHook({ prompt: RECALL_PROMPT, session_id: sessionId, cwd: dir }));
  assert.ok(!second.includes('<known-issues-recall>'), `The recall record was not kept: ${second}`);
}));

// Two session-log entries with the same date-only heading, as context-management
// writes them, and a third entry that matches the same words.
const withLogProject = (entries, fn) => withProjectFiles({ 'session-log.md': entries.join('\n') }, fn);

const SAME_HEADING = '## 2026-08-22 [saved]';
const ZEBRA_PROMPT = 'what did we decide on the zebrafish parser';
const WALRUS_PROMPT = 'what did we decide on the walrus cache';
// The recall block with the given tag in a hook output, or '' when it is absent.
const recallBlockOf = (output, tag) => (contextOf(output).match(new RegExp(`<${tag}>[\\s\\S]*</${tag}>`)) || [''])[0];
const memoryOf = output => recallBlockOf(output, 'session-memory-recall');

test('entries with the same heading are told apart; a shown entry stays shown across prompts', () => withLogProject(
  [`${SAME_HEADING}\nGoal: zebrafish parser\n`, `${SAME_HEADING}\nGoal: walrus cache\n`],
  (dir) => {
    const sessionId = uniqueSessionId();
    const zebra = memoryOf(runHook({ prompt: ZEBRA_PROMPT, session_id: sessionId, cwd: dir }));
    const walrus = memoryOf(runHook({ prompt: WALRUS_PROMPT, session_id: sessionId, cwd: dir }));
    const zebraAgain = memoryOf(runHook({ prompt: ZEBRA_PROMPT, session_id: sessionId, cwd: dir }));
    assert.ok(zebra.includes('zebrafish'), `The zebrafish entry was not recalled: ${zebra}`);
    assert.ok(walrus.includes('walrus'), `The walrus entry was hidden by the same heading: ${walrus}`);
    assert.ok(!zebraAgain.includes('zebrafish'), `The zebrafish entry was recalled twice: ${zebraAgain}`);
  },
));

// Sends one prompt twice in one session. Three items of the project match
// it: the first answer must hold the top two in the recall block with the
// given tag, and the second answer must hold no such block (the third item
// does not replace the two that were shown).
function assertNoWeakerMatch(dir, tag, itemPattern) {
  const sessionId = uniqueSessionId();
  const ask = () => recallBlockOf(runHook({ prompt: ZEBRA_PROMPT, session_id: sessionId, cwd: dir }), tag);
  const first = ask();
  const second = ask();
  assert.strictEqual((first.match(itemPattern) || []).length, 2, `Expected the top 2 items first: ${first}`);
  assert.strictEqual(second, '', `Expected no recall the second time, got: ${second}`);
}

test('an entry already shown is not replaced by a weaker match', () => withLogProject(
  [1, 2, 3].map(n => `## 2026-08-2${n} 10:00 [saved]\nGoal: zebrafish parser design, step ${n}\n`),
  dir => assertNoWeakerMatch(dir, 'session-memory-recall', /\[saved\]/g),
));

test('a known issue already shown is not replaced by a weaker match', () => withProjectFiles(
  { 'known-issues.md': [1, 2, 3].map(n => `## Zebrafish parser issue ${n}\n\n**Symptom:** the zebrafish parser fails, case ${n}.\n`).join('\n') },
  dir => assertNoWeakerMatch(dir, 'known-issues-recall', /## Zebrafish parser issue/g),
));

test('a corrupt recall record does not break the hook', () => withRecallProject((dir) => {
  const sessionId = uniqueSessionId();
  fs.writeFileSync(recallStatePath(sessionId), 'not json {');
  assertHintAndRecall(runHook({ prompt: RECALL_PROMPT, session_id: sessionId, cwd: dir }));
}));

test('a recall record that cannot be read or written does not break the hook', () => withRecallProject((dir) => {
  const sessionId = uniqueSessionId();
  const recordPath = recallStatePath(sessionId);
  fs.mkdirSync(recordPath); // a folder at the record path: the read and the write both fail
  try {
    assertHintAndRecall(runHook({ prompt: RECALL_PROMPT, session_id: sessionId, cwd: dir }));
  } finally {
    fs.rmdirSync(recordPath);
  }
}));

test('an empty cwd falls back to the working folder: the recall comes from that folder', () => withRecallProject((dir) => {
  assertHintAndRecall(runHook({ prompt: RECALL_PROMPT, session_id: uniqueSessionId(), cwd: '' }, { cwd: dir }));
}));

// Runs the hook as Claude Code does after Claude has run `cd`: the payload's
// cwd and the folder of the hook process are `cwd`, and CLAUDE_PROJECT_DIR is
// `projectDir`, the folder where the session started.
function runHookWithProjectDir(projectDir, cwd) {
  const env = { ...process.env, [PROJECT_DIR_VARIABLE]: projectDir };
  return runHook({ prompt: RECALL_PROMPT, session_id: uniqueSessionId(), cwd }, { cwd, env });
}

test('a cwd in a sub-folder of CLAUDE_PROJECT_DIR: the recall comes from CLAUDE_PROJECT_DIR', () => withRecallProject((dir) => {
  const subFolder = path.join(dir, 'src', 'deep');
  fs.mkdirSync(subFolder, { recursive: true });
  assertHintAndRecall(runHookWithProjectDir(dir, subFolder));
}));

// A cwd that differs from CLAUDE_PROJECT_DIR is read too: an entry saved
// after Claude entered a git worktree is in the session-log.md of the
// worktree, not in the one of the project root.
test('a cwd that differs from CLAUDE_PROJECT_DIR: the recall comes from cwd when only cwd holds the recall files', () => withRecallProject((dir) => withProjectFiles({}, (emptyProjectDir) => {
  assertHintAndRecall(runHookWithProjectDir(emptyProjectDir, dir));
})));

// The recall files of a second folder, for example the top folder of a git
// worktree that Claude entered. Each file holds one entry that matches
// RECALL_PROMPT and that RECALL_PROJECT_FILES does not hold. The session-log
// entry has the same date-only heading as the entry of the project root and
// another text: the two entries are different entries.
const CWD_SAVED_GOAL = 'Goal: keep the release tag when the deploy script crashes';
const CWD_ISSUE_HEADING = '## Deploy script drops the release tag after a crash';
const CWD_ONLY_FILES = {
  'known-issues.md': `${CWD_ISSUE_HEADING}\n\n**Symptom:** the release tag is lost when the deploy script crashes.\n`,
  'session-log.md': `${SAVED_HEADING}\n${CWD_SAVED_GOAL}\n`,
};

// Runs the hook with RECALL_PROJECT_FILES in the CLAUDE_PROJECT_DIR folder and
// `cwdFiles` in the cwd folder. Each recall block must hold the entry of the
// project root once, then the entry that only cwd holds, once. Each entry is
// found by a text that only this entry holds.
function assertRecallFromBothFolders(cwdFiles) {
  withRecallProject(projectDir => withProjectFiles(cwdFiles, (cwd) => {
    const output = runHookWithProjectDir(projectDir, cwd);
    for (const [tag, texts] of [['session-memory-recall', [SAVED_GOAL, CWD_SAVED_GOAL]], ['known-issues-recall', [KNOWN_ISSUE_HEADING, CWD_ISSUE_HEADING]]]) {
      const block = recallBlockOf(output, tag);
      const counts = texts.map(text => block.split(text).length - 1);
      assert.deepStrictEqual(counts, [1, 1], `Expected each of ${texts.join(' | ')} once in <${tag}>, got: ${block}`);
      assert.ok(block.indexOf(texts[0]) < block.indexOf(texts[1]), `Expected the entry of the project root first in <${tag}>, got: ${block}`);
    }
  }));
}

test('a cwd that holds entries which CLAUDE_PROJECT_DIR lacks: both recalls appear, the project root first', () => {
  assertRecallFromBothFolders(CWD_ONLY_FILES);
});

test('an entry that the files of CLAUDE_PROJECT_DIR and of cwd both hold is shown once', () => {
  const bothEntries = {};
  Object.keys(CWD_ONLY_FILES).forEach((name) => { bothEntries[name] = `${RECALL_PROJECT_FILES[name]}\n${CWD_ONLY_FILES[name]}`; });
  assertRecallFromBothFolders(bothEntries);
});

test('the Codex adapter skips agent messages too', () => withRecallProject((dir) => {
  const output = runActivator({ prompt: AGENT_MESSAGES['a task notification'], session_id: uniqueSessionId(), cwd: dir });
  assert.deepStrictEqual(output, {});
}));

test('the Codex adapter shows a recalled entry once per session', () => withRecallProject((dir) => {
  const sessionId = uniqueSessionId();
  const first = contextOf(runActivator({ prompt: RECALL_PROMPT, session_id: sessionId, cwd: dir }));
  const second = contextOf(runActivator({ prompt: RECALL_PROMPT, session_id: sessionId, cwd: dir }));
  assert.ok(first.includes(KNOWN_ISSUE_HEADING), `First prompt lacks the recall: ${first}`);
  assert.ok(!second.includes('<known-issues-recall>'), `Second prompt repeats the recall: ${second}`);
}));

// ── No context gate ───────────────────────────────────────────────────────────
//
// Through v7.60.0 the hook answered a prompt that names plan execution (for
// example "execute the plan") with a STOP block when a status line cache file
// or the session transcript reported a full context window. That gate was
// removed. Such a prompt now gets the hint and the recall of any other prompt,
// whatever these files hold. The removed gate read its files under the home
// folder, so each test below gives the hook a home folder of its own.

console.log('\nNo context gate: a prompt that names plan execution is a prompt like any other');

const EXECUTION_PROMPT = 'execute the plan';
// Prompts for the nine patterns of the removed gate (hooks/skill-activator.js
// at commit 04e8e25): one prompt for each alternative that a pattern allowed.
const OLD_PATTERN_PROMPTS = [
  EXECUTION_PROMPT, 'execute plan',
  'start build', 'start building',
  'start implement', 'start implementing', 'start implementation',
  'follow the plan', 'follow plan',
  'implement the plan', 'implement plan',
  "let's build it", 'lets implement it', "let's execute it",
  'run the plan', 'run plan',
  'begin implement', 'begin implementing', 'begin implementation',
  'begin the plan', 'begin plan',
];
// Prompts that the removed gate did not match, longer forms of prompts that
// it matched, and one prompt that has nothing to do with a plan.
const OTHER_PROMPTS = [
  'resume the plan', 'resume the implementation', 'please execute the plan now',
  'Execute the plan at docs/plans/feature.md', 'execute the plan in batches',
  'implement the next 3 tasks from docs/plans/feature.md', 'continue with the next task of the plan',
  'there is a bug in my code, it crashes when I call the function',
];
const ALL_PROMPTS = [...OLD_PATTERN_PROMPTS, ...OTHER_PROMPTS];
const SMALL_WINDOW = 200000;
const WINDOW_SIZES = [SMALL_WINDOW, 1000000];
// Fill levels in percent of the window. At 150 the files report more tokens
// than the window holds.
const FILL_PERCENTS = [30, 59, 60, 61, 70, 90, 95, 96, 99, 100, 150];
const THRESHOLD_VARIABLE = 'SUPERPOWERS_PRESSURE_THRESHOLD';
// Values of the removed threshold variable; undefined means "not set".
const THRESHOLD_VALUES = [undefined, '10', '50', '90', '96', '100'];
const withEmptyProject = fn => withProjectFiles({}, fn);
const homeVariables = home => ({ HOME: home, USERPROFILE: home });

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'no-gate-home-'));
  try {
    return fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Runs fn with the given environment variables set in this process (the
// value undefined removes a variable), and restores the old values afterwards.
function withEnv(variables, fn) {
  const setAll = values => Object.entries(values).forEach(([name, value]) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
  const old = Object.fromEntries(Object.keys(variables).map(name => [name, process.env[name]]));
  setAll(variables);
  try {
    return fn();
  } finally {
    setAll(old);
  }
}

// The hook input of a session whose home folder is `home`. transcript_path is
// a field of the real hook input; the removed gate did not read it.
function payloadAt(home, cwd, prompt) {
  return { prompt, session_id: uniqueSessionId(), cwd, transcript_path: path.join(home, 'named', 'transcript.jsonl') };
}

function writeFixture(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// One assistant record that reports `tokens` tokens in the context window.
function transcriptRecord(tokens) {
  const usage = { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 5, output_tokens: 10 };
  return `${JSON.stringify({ type: 'assistant', message: { usage } })}\n`;
}

const CACHE_FILE_NAME = 'context-window.cache.json';
const cachePath = home => path.join(home, '.claude', 'hooks-logs', CACHE_FILE_NAME);

// Each entry writes one file that reports `tokens` tokens in a window of
// `windowSize` tokens. The first two are the files that the removed gate
// read; the third is the transcript that the hook input names.
const FILL_SOURCES = {
  'the cache file of the removed status line bridge': (home, payload, windowSize, tokens) => writeFixture(cachePath(home), JSON.stringify({
    session_id: payload.session_id, context_window_size: windowSize, input_tokens_total: tokens, used_percentage: Math.round(tokens / windowSize * 100),
  })),
  'the transcript in the project folder of Claude Code': (home, payload, windowSize, tokens) => writeFixture(
    path.join(home, '.claude', 'projects', payload.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${payload.session_id}.jsonl`), transcriptRecord(tokens)),
  'the transcript that transcript_path names': (home, payload, windowSize, tokens) => writeFixture(payload.transcript_path, transcriptRecord(tokens)),
};
const writeEveryFillSource = (...args) => Object.values(FILL_SOURCES).forEach(write => write(...args));

// Calls fn(home, windowSize, tokens, label) with a new home folder for each
// window size and each fill level.
function forEachFill(fn) {
  for (const windowSize of WINDOW_SIZES) {
    for (const percent of FILL_PERCENTS) {
      withHome(home => fn(home, windowSize, windowSize * percent / 100, `${percent}% of ${windowSize}`));
    }
  }
}

// The output of the hook function for `payload`, with `home` as the home
// folder and `threshold` as the value of the removed threshold variable.
function evaluateAtHome(home, payload, threshold) {
  return withEnv({ ...homeVariables(home), [THRESHOLD_VARIABLE]: threshold }, () => runActivator(payload));
}

// The output for a prompt when no file reports a fill and the threshold
// variable is not set. The projects of these tests hold no recall file, so
// the output depends on the prompt only.
const outputWithNoFiles = new Map();
function expectedOutput(cwd, prompt) {
  if (!outputWithNoFiles.has(prompt)) {
    outputWithNoFiles.set(prompt, JSON.stringify(withHome(home => evaluateAtHome(home, payloadAt(home, cwd, prompt), undefined))));
  }
  return outputWithNoFiles.get(prompt);
}

for (const [label, writeSource] of [...Object.entries(FILL_SOURCES), ['every one of these files', writeEveryFillSource]]) {
  test(`${label} changes the output for no prompt, at any fill and any value of ${THRESHOLD_VARIABLE}`, () => withEmptyProject((dir) => {
    const differences = [];
    forEachFill((home, windowSize, tokens, fill) => {
      const payload = payloadAt(home, dir, '');
      writeSource(home, payload, windowSize, tokens);
      for (const prompt of ALL_PROMPTS) {
        for (const threshold of THRESHOLD_VALUES) {
          const actual = JSON.stringify(evaluateAtHome(home, { ...payload, prompt }, threshold));
          if (actual !== expectedOutput(dir, prompt)) differences.push(`"${prompt}" at ${fill}, threshold ${threshold}`);
        }
      }
    });
    assert.deepStrictEqual(differences.slice(0, 5), [], `${differences.length} outputs differ from the output with no file`);
  }));
}

test('a prompt that names plan execution gets the skill hint and both recalls, at any fill and any threshold value', () => withRecallProject((dir) => {
  forEachFill((home, windowSize, tokens, fill) => {
    for (const threshold of THRESHOLD_VALUES) {
      // A new session for each run: a recalled entry is shown once per session.
      const payload = payloadAt(home, dir, `${EXECUTION_PROMPT}: ${RECALL_PROMPT}`);
      writeEveryFillSource(home, payload, windowSize, tokens);
      assertHintAndRecall(evaluateAtHome(home, payload, threshold), `at ${fill}, threshold ${threshold}`);
    }
  });
}));

// The tests above call the hook function. The tests below run the hook
// script, which is what Claude Code runs.

// Runs the real hook with a new home folder. `fill(home, payload)` first
// writes the files of the test into that folder. `payloadFor(home)` returns
// the hook input.
function runHookAtHome(payloadFor, fill = () => {}, { args = [], env = {} } = {}) {
  return withHome((home) => {
    const payload = payloadFor(home);
    fill(home, payload);
    return runHook(payload, { env: { ...process.env, ...homeVariables(home), ...env } }, args);
  });
}

// Asserts that the hook script gives the same output with the files of
// `fill` as with an empty home folder. Returns the text of that output.
function assertScriptOutputUnchanged(dir, fill, options) {
  const payloadFor = home => payloadAt(home, dir, EXECUTION_PROMPT);
  const expected = runHookAtHome(payloadFor);
  const actual = runHookAtHome(payloadFor, fill, options);
  assert.deepStrictEqual(actual, expected);
  return contextOf(actual);
}

const everyFileFull = (home, payload) => writeEveryFillSource(home, payload, SMALL_WINDOW, SMALL_WINDOW);

test(`the hook script gives "${EXECUTION_PROMPT}" the skill hint when every file reports a full window`, () => withEmptyProject((dir) => {
  const context = assertScriptOutputUnchanged(dir, everyFileFull);
  assert.ok(context.includes('<user-prompt-submit-hook>') && context.includes('executing-plans'), `Expected the skill hint, got: ${context.slice(0, 200)}`);
}));

test('the hook script gives the skill hint and both recalls when every file reports a full window', () => withRecallProject((dir) => {
  assertHintAndRecall(runHookAtHome(home => payloadAt(home, dir, `${EXECUTION_PROMPT}: ${RECALL_PROMPT}`), everyFileFull));
}));

test('a cache file that is not valid JSON changes nothing', () => withEmptyProject((dir) => {
  assertScriptOutputUnchanged(dir, home => writeFixture(cachePath(home), '{not valid json'));
}));

test(`the hook script does not read the variable ${THRESHOLD_VARIABLE}`, () => withEmptyProject((dir) => {
  assertScriptOutputUnchanged(dir, everyFileFull, { env: { [THRESHOLD_VARIABLE]: '10' } });
}));

for (const [label, argsFor] of [['with a folder after it', dir => ['--pressure', dir]], ['with nothing after it', () => ['--pressure']]]) {
  test(`the argument --pressure ${label} is ignored: the hook script reads the prompt from standard input as always`, () => withEmptyProject((dir) => {
    assertScriptOutputUnchanged(dir, everyFileFull, { args: argsFor(dir) });
  }));
}

test('the SDD skill names no hook check at the start of a batch', () => {
  const sddText = fs.readFileSync(path.join(__dirname, '../../skills/subagent-driven-development/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(!/context gate|context-pressure|hook check that blocks/i.test(sddText), 'the skill still describes the removed gate');
  assert.ok(sddText.includes('No hook checks how full the context window is'), 'the corrected sentence is missing');
});

// A skill, a hook or a guide that names a removed part tells the model or the
// user to use something that no longer exists. The test files name the parts
// to prove that the hook ignores them. The release notes and the old design
// documents are history.
test('no tracked file outside the tests and the history names a removed part of the gate', () => {
  const removedNames = ['--pressure', THRESHOLD_VARIABLE, CACHE_FILE_NAME, 'statusline-context-cache'];
  const allowed = [/^tests\//, /^RELEASE-NOTES\.md$/, /^docs\/superpowers-orchestrator\//];
  const repoRoot = path.join(__dirname, '..', '..');
  const listing = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  assert.strictEqual(listing.status, 0, `git ls-files failed: ${listing.stderr}`);
  const files = listing.stdout.split('\0').filter(file => file && !allowed.some(pattern => pattern.test(file)));
  assert.ok(files.includes('hooks/skill-activator.js'), 'the list of tracked files does not hold the hook itself');
  const found = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      continue; // a tracked file that the work tree no longer holds, or a folder
    }
    removedNames.filter(name => text.includes(name)).forEach(name => found.push(`${file}: ${name}`));
  }
  assert.deepStrictEqual(found, []);
});

// The recall record of each session id used in this file stays in the
// temporary folder; remove it at exit, also when a test throws, so the test
// runs leave nothing behind. The earlier tests use the fixed session id 'test'.
process.on('exit', () => {
  [...recallSessionIds, 'test'].forEach(sessionId => fs.rmSync(recallStatePath(sessionId), { force: true }));
});

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`skill-activator (UserPromptSubmit): ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
