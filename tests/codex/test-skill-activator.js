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

// ── Context pressure gate ─────────────────────────────────────────────────────

const {
  isExecutionTrigger,
  cwdToProjectDir,
  getContextPressure,
  readContextWindowCache,
  buildContextPressureBlock,
} = require('../../hooks/skill-activator');

console.log('\nContext pressure gate — isExecutionTrigger');

test('Recognises "execute the plan"', () => {
  assert.strictEqual(isExecutionTrigger('execute the plan'), true);
});
test('Recognises "start building"', () => {
  assert.strictEqual(isExecutionTrigger('start building the feature'), true);
});
test('Recognises "start implementing"', () => {
  assert.strictEqual(isExecutionTrigger('let\'s start implementing'), true);
});
test('Recognises "follow the plan"', () => {
  assert.strictEqual(isExecutionTrigger('follow the plan we wrote'), true);
});
test('Recognises "implement the plan"', () => {
  assert.strictEqual(isExecutionTrigger('implement the plan now'), true);
});
test('Recognises "let\'s build"', () => {
  assert.strictEqual(isExecutionTrigger('let\'s build this'), true);
});
test('Recognises "run the plan"', () => {
  assert.strictEqual(isExecutionTrigger('run the plan'), true);
});
test('Recognises "begin implementing"', () => {
  assert.strictEqual(isExecutionTrigger('begin implementing the auth module'), true);
});
test('Does NOT trigger on "what is the plan"', () => {
  assert.strictEqual(isExecutionTrigger('what is the plan here?'), false);
});
test('Does NOT trigger on "fix this bug"', () => {
  assert.strictEqual(isExecutionTrigger('fix this bug in auth.js'), false);
});
test('Does NOT trigger on "review the code"', () => {
  assert.strictEqual(isExecutionTrigger('review the code before merging'), false);
});
test('Does NOT trigger on empty string', () => {
  assert.strictEqual(isExecutionTrigger(''), false);
});
test('Does NOT trigger on null', () => {
  assert.strictEqual(isExecutionTrigger(null), false);
});

console.log('\nContext pressure gate — prompts the skills tell the user to paste');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SDD_SKILL = fs.readFileSync(
  path.join(REPO_ROOT, 'skills', 'subagent-driven-development', 'SKILL.md'), 'utf8');
const WRITING_PLANS_SKILL = fs.readFileSync(
  path.join(REPO_ROOT, 'skills', 'writing-plans', 'SKILL.md'), 'utf8');
// Whitespace is collapsed so that a prompt or a sentence wrapped over lines still matches.
const SDD_TEXT = SDD_SKILL.replace(/\s+/g, ' ');
const INLINE_APPROACH = 'Inline';
const HANDOFF_APPROACHES = ['Subagent-Driven, batched', 'Subagent-Driven, interactive', INLINE_APPROACH];
const RESUME_PROMPT_START = 'Resume the plan at';

// Rows of the writing-plans handoff table: | Approach | `paste prompt` | Behavior |
const handoffPrompts = [...WRITING_PLANS_SKILL.matchAll(/^\| ([^|]+?) \| `([^`]+)` \|/gm)]
  .map(m => ({ approach: m[1], prompt: m[2] }));
// Resume prompts of the batch handoff, written in double quotes.
const resumePrompts = [...SDD_TEXT.matchAll(new RegExp(`"(${RESUME_PROMPT_START} [^"]+)"`, 'g'))]
  .map(m => m[1]);
const SHORT_REPLIES = ['subagent', 'inline', 'go', 'yes'];

test('Every row of the writing-plans handoff table is extracted', () => {
  assert.deepStrictEqual(handoffPrompts.map(p => p.approach), HANDOFF_APPROACHES);
});
test('Every resume prompt of the SDD skill is extracted', () => {
  const mentions = SDD_TEXT.split(RESUME_PROMPT_START).length - 1;
  assert.ok(resumePrompts.length > 0, 'no resume prompt extracted from SDD');
  assert.strictEqual(resumePrompts.length, mentions,
    `extracted ${resumePrompts.length} of ${mentions} resume prompts`);
});
test('The gate fires on the Inline paste prompt only', () => {
  for (const { approach, prompt } of handoffPrompts) {
    assert.strictEqual(isExecutionTrigger(prompt), approach === INLINE_APPROACH, prompt);
  }
});
test('The gate does not fire on resume prompts or short replies', () => {
  for (const prompt of [...resumePrompts, ...SHORT_REPLIES]) {
    assert.strictEqual(isExecutionTrigger(prompt), false, prompt);
  }
});
test('The gate fires on "execute the plan in batches"', () => {
  assert.strictEqual(isExecutionTrigger('execute the plan in batches'), true);
});
test('SDD states what the gate covers, not that it catches mid-session starts', () => {
  assert.ok(!SDD_TEXT.includes('catches mid-session starts'), 'false claim still present');
  assert.ok(SDD_TEXT.includes('fires only on a prompt that matches its execution patterns'),
    'corrected sentence missing');
});

console.log('\nContext pressure gate — cwdToProjectDir');

test('Windows path with spaces encodes correctly', () => {
  const result = cwdToProjectDir('C:\\Users\\Tjerk Pieksma\\Documents\\Github\\project');
  assert.strictEqual(result, 'c--Users-Tjerk-Pieksma-Documents-Github-project');
});
test('Windows path without spaces encodes correctly', () => {
  const result = cwdToProjectDir('C:\\Users\\user\\project');
  assert.strictEqual(result, 'c--Users-user-project');
});
test('Lowercase drive letter for any uppercase drive', () => {
  const result = cwdToProjectDir('D:\\work\\repo');
  assert.ok(result.startsWith('d-'), `Expected d- prefix, got: ${result}`);
});
test('Unix path encodes correctly', () => {
  const result = cwdToProjectDir('/home/user/projects/foo');
  assert.strictEqual(result, '-home-user-projects-foo');
});
test('No trailing dashes', () => {
  const result = cwdToProjectDir('C:\\project\\');
  assert.ok(!result.endsWith('-'), `Should not end with dash, got: ${result}`);
});
test('Forward slashes treated same as backslashes', () => {
  const win = cwdToProjectDir('C:\\Users\\user\\project');
  const fwd = cwdToProjectDir('C:/Users/user/project');
  assert.strictEqual(win, fwd, 'Forward and backslash paths should produce the same result');
});
test('Underscores encode to dashes (matches real Claude Code encoding)', () => {
  const result = cwdToProjectDir('/Users/bruno/Programming/AI/AI_Coding/My_tools/Superpowers');
  assert.strictEqual(result, '-Users-bruno-Programming-AI-AI-Coding-My-tools-Superpowers');
});

console.log('\nContext pressure gate — getContextPressure');

function makeJsonlSession(sessionId, projectDir, homeDir, turns) {
  const projectPath = path.join(homeDir, '.claude', 'projects', projectDir);
  fs.mkdirSync(projectPath, { recursive: true });
  const jsonlPath = path.join(projectPath, sessionId + '.jsonl');
  const lines = turns.map(t => JSON.stringify({
    type: 'assistant',
    message: { usage: t },
    sessionId,
    timestamp: new Date().toISOString(),
  }));
  fs.writeFileSync(jsonlPath, lines.join('\n'));
  return jsonlPath;
}

test('Returns null when sessionId is missing', () => {
  assert.strictEqual(getContextPressure(process.cwd(), null), null);
  assert.strictEqual(getContextPressure(process.cwd(), undefined), null);
});

test('Returns null when JSONL file does not exist', () => {
  const result = getContextPressure('/nonexistent/path/xyz', 'fake-session-id');
  assert.strictEqual(result, null);
});

test('Returns correct percent for known token counts (below threshold)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-unit-'));
  const cwd = path.join(tmpHome, 'myproject');
  const projDir = cwdToProjectDir(cwd);
  const sessionId = 'test-below-' + Date.now();
  // Last turn: 40K total input (20% of 200K)
  makeJsonlSession(sessionId, projDir, tmpHome, [
    { input_tokens: 5, cache_creation_input_tokens: 20000, cache_read_input_tokens: 0, output_tokens: 100 },
    { input_tokens: 3, cache_creation_input_tokens: 500, cache_read_input_tokens: 39500, output_tokens: 200 },
  ]);
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  const result = getContextPressure(cwd, sessionId);
  process.env.USERPROFILE = orig.up;
  process.env.HOME = orig.home;
  fs.rmSync(tmpHome, { recursive: true });

  assert.ok(result !== null, 'Should return a result');
  assert.strictEqual(result.overThreshold, false, 'Should be below threshold');
  assert.ok(result.percent < 60, `Expected <60%, got ${result.percent}%`);
});

test('Returns overThreshold=true for ≥60% context (120K tokens)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-unit-'));
  const cwd = path.join(tmpHome, 'myproject');
  const projDir = cwdToProjectDir(cwd);
  const sessionId = 'test-above-' + Date.now();
  // Last turn: 125K total input (62.5% of 200K) → over threshold
  makeJsonlSession(sessionId, projDir, tmpHome, [
    { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
  ]);
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  const result = getContextPressure(cwd, sessionId);
  process.env.USERPROFILE = orig.up;
  process.env.HOME = orig.home;
  fs.rmSync(tmpHome, { recursive: true });

  assert.ok(result !== null, 'Should return a result');
  assert.strictEqual(result.overThreshold, true, 'Should be over threshold');
  assert.ok(result.percent >= 60, `Expected ≥60%, got ${result.percent}%`);
  assert.strictEqual(result.inputK, 125, `Expected 125K, got ${result.inputK}K`);
});

test('Uses LAST assistant turn, not first', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-unit-'));
  const cwd = path.join(tmpHome, 'myproject');
  const projDir = cwdToProjectDir(cwd);
  const sessionId = 'test-last-' + Date.now();
  // First turn: tiny. Last turn: over threshold.
  makeJsonlSession(sessionId, projDir, tmpHome, [
    { input_tokens: 3, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 50 },
    { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
  ]);
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  const result = getContextPressure(cwd, sessionId);
  process.env.USERPROFILE = orig.up;
  process.env.HOME = orig.home;
  fs.rmSync(tmpHome, { recursive: true });

  assert.ok(result !== null, 'Should return a result');
  assert.strictEqual(result.overThreshold, true, 'Last turn is over threshold');
});

test('Skips non-assistant lines without crashing', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-unit-'));
  const cwd = path.join(tmpHome, 'myproject');
  const projDir = cwdToProjectDir(cwd);
  const sessionId = 'test-mixed-' + Date.now();
  const projectPath = path.join(tmpHome, '.claude', 'projects', projDir);
  fs.mkdirSync(projectPath, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { content: 'hello' }, sessionId }),
    'not valid json at all',
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 3, cache_creation_input_tokens: 500, cache_read_input_tokens: 0, output_tokens: 50 } }, sessionId }),
  ];
  fs.writeFileSync(path.join(projectPath, sessionId + '.jsonl'), lines.join('\n'));
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  let threw = false;
  try { getContextPressure(cwd, sessionId); } catch { threw = true; }
  process.env.USERPROFILE = orig.up;
  process.env.HOME = orig.home;
  fs.rmSync(tmpHome, { recursive: true });
  assert.strictEqual(threw, false, 'Should not throw on mixed/invalid lines');
});

console.log('\nContext pressure gate — statusline cache bridge');

function makeContextCache(homeDir, entry, mtimeMs) {
  const dir = path.join(homeDir, '.claude', 'hooks-logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'context-window.cache.json');
  fs.writeFileSync(file, typeof entry === 'string' ? entry : JSON.stringify(entry));
  if (mtimeMs) fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  return file;
}

function withTmpHome(fn) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-cache-'));
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  try {
    return fn(tmpHome);
  } finally {
    process.env.USERPROFILE = orig.up;
    process.env.HOME = orig.home;
    fs.rmSync(tmpHome, { recursive: true });
  }
}

test('Cache with matching session wins over transcript and carries true window size', () => {
  const result = withTmpHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const sessionId = 'cache-match-' + Date.now();
    // Transcript alone would read 125K/200K = 62% (over threshold).
    makeJsonlSession(sessionId, cwdToProjectDir(cwd), tmpHome, [
      { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
    ]);
    // Cache knows the real window is 1M → 13%, under threshold.
    makeContextCache(tmpHome, {
      session_id: sessionId, context_window_size: 1000000,
      input_tokens_total: 130000, used_percentage: 13,
    });
    return getContextPressure(cwd, sessionId);
  });
  assert.ok(result !== null, 'Should return a result');
  assert.strictEqual(result.overThreshold, false, '13% of 1M must be under threshold');
  assert.strictEqual(result.percent, 13, `Expected 13%, got ${result.percent}%`);
  assert.strictEqual(result.windowK, 1000, `Expected windowK 1000, got ${result.windowK}`);
});

test('Cache with a DIFFERENT session id is ignored — transcript fallback applies', () => {
  const result = withTmpHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const sessionId = 'cache-mismatch-' + Date.now();
    makeJsonlSession(sessionId, cwdToProjectDir(cwd), tmpHome, [
      { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
    ]);
    makeContextCache(tmpHome, {
      session_id: 'some-other-session', context_window_size: 1000000,
      input_tokens_total: 130000, used_percentage: 13,
    });
    return getContextPressure(cwd, sessionId);
  });
  assert.ok(result !== null, 'Should return a result');
  assert.strictEqual(result.overThreshold, true, 'Transcript fallback: 62% of 200K');
  assert.strictEqual(result.windowK, 200, 'Fallback carries the 200K default window');
});

test('Stale cache (>30 min) is ignored — transcript fallback applies', () => {
  const result = withTmpHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const sessionId = 'cache-stale-' + Date.now();
    makeJsonlSession(sessionId, cwdToProjectDir(cwd), tmpHome, [
      { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
    ]);
    makeContextCache(tmpHome, {
      session_id: sessionId, context_window_size: 1000000,
      input_tokens_total: 130000, used_percentage: 13,
    }, Date.now() - 31 * 60 * 1000);
    return getContextPressure(cwd, sessionId);
  });
  assert.ok(result !== null, 'Should return a result');
  assert.strictEqual(result.overThreshold, true, 'Stale cache must not be trusted');
});

test('Malformed cache falls back to transcript without throwing', () => {
  const result = withTmpHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const sessionId = 'cache-bad-' + Date.now();
    makeJsonlSession(sessionId, cwdToProjectDir(cwd), tmpHome, [
      { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
    ]);
    makeContextCache(tmpHome, '{not valid json');
    return getContextPressure(cwd, sessionId);
  });
  assert.ok(result !== null, 'Should fall back to transcript');
  assert.strictEqual(result.overThreshold, true, 'Transcript fallback result expected');
});

test('readContextWindowCache returns null for zero/missing window or totals', () => {
  const results = withTmpHome((tmpHome) => {
    const sessionId = 'cache-zero-' + Date.now();
    const out = [];
    makeContextCache(tmpHome, { session_id: sessionId, context_window_size: 0, input_tokens_total: 130000 });
    out.push(readContextWindowCache(sessionId));
    makeContextCache(tmpHome, { session_id: sessionId, context_window_size: 1000000 });
    out.push(readContextWindowCache(sessionId));
    return out;
  });
  assert.strictEqual(results[0], null, 'Zero window size must be rejected');
  assert.strictEqual(results[1], null, 'Missing token total must be rejected');
});

console.log('\nContext pressure gate — SUPERPOWERS_PRESSURE_THRESHOLD override');

function withThresholdEnv(value, fn) {
  const orig = process.env.SUPERPOWERS_PRESSURE_THRESHOLD;
  if (value === undefined) delete process.env.SUPERPOWERS_PRESSURE_THRESHOLD;
  else process.env.SUPERPOWERS_PRESSURE_THRESHOLD = value;
  try {
    return fn();
  } finally {
    if (orig === undefined) delete process.env.SUPERPOWERS_PRESSURE_THRESHOLD;
    else process.env.SUPERPOWERS_PRESSURE_THRESHOLD = orig;
  }
}

function transcriptPressureAt55Percent() {
  // 110K/200K = 55% via the transcript fallback path.
  return withTmpHome((tmpHome) => {
    const cwd = path.join(tmpHome, 'myproject');
    const sessionId = 'thr-' + Math.random().toString(36).slice(2);
    makeJsonlSession(sessionId, cwdToProjectDir(cwd), tmpHome, [
      { input_tokens: 5, cache_creation_input_tokens: 90000, cache_read_input_tokens: 19995, output_tokens: 100 },
    ]);
    return getContextPressure(cwd, sessionId);
  });
}

test('55% is under the default 60% threshold', () => {
  const result = withThresholdEnv(undefined, transcriptPressureAt55Percent);
  assert.strictEqual(result.overThreshold, false);
  assert.strictEqual(result.thresholdPercent, 60);
});

test('SUPERPOWERS_PRESSURE_THRESHOLD=50 puts 55% over threshold', () => {
  const result = withThresholdEnv('50', transcriptPressureAt55Percent);
  assert.strictEqual(result.overThreshold, true, '55% must exceed a 50% threshold');
  assert.strictEqual(result.thresholdPercent, 50);
});

test('Override applies to the statusline-cache path too', () => {
  const result = withThresholdEnv('50', () => withTmpHome((tmpHome) => {
    const sessionId = 'thr-cache-' + Date.now();
    makeContextCache(tmpHome, {
      session_id: sessionId, context_window_size: 1000000,
      input_tokens_total: 550000, used_percentage: 55,
    });
    return readContextWindowCache(sessionId);
  }));
  assert.strictEqual(result.overThreshold, true, '55% of 1M must exceed a 50% threshold');
  assert.strictEqual(result.thresholdPercent, 50);
});

test('Invalid or out-of-range values fall back to 60%', () => {
  for (const bad of ['abc', '', '5', '95', '-20', '0']) {
    const result = withThresholdEnv(bad, transcriptPressureAt55Percent);
    assert.strictEqual(result.overThreshold, false, `"${bad}" must fall back to 60% (55% under)`);
    assert.strictEqual(result.thresholdPercent, 60, `"${bad}" must report the default threshold`);
  }
});

test('Block message reports the active threshold', () => {
  const block = buildContextPressureBlock({ inputK: 110, percent: 55, windowK: 200, thresholdPercent: 50 });
  assert.ok(block.includes('≥50%'), `Expected ≥50% in block, got: ${block.slice(0, 300)}`);
});

console.log('\nContext pressure gate — buildContextPressureBlock');

test('Contains opening and closing context-pressure-gate tags', () => {
  const block = buildContextPressureBlock({ inputK: 125, percent: 62 });
  assert.ok(block.includes('<context-pressure-gate>'), 'Missing opening tag');
  assert.ok(block.includes('</context-pressure-gate>'), 'Missing closing tag');
});
test('Interpolates inputK correctly', () => {
  const block = buildContextPressureBlock({ inputK: 142, percent: 71 });
  assert.ok(block.includes('142K'), `Expected 142K in block, got: ${block.slice(0, 200)}`);
});
test('Interpolates percent correctly', () => {
  const block = buildContextPressureBlock({ inputK: 142, percent: 71 });
  assert.ok(block.includes('71%'), `Expected 71% in block, got: ${block.slice(0, 200)}`);
});
test('Contains all 4 required action steps', () => {
  const block = buildContextPressureBlock({ inputK: 100, percent: 60 });
  assert.ok(block.includes('1.'), 'Missing step 1');
  assert.ok(block.includes('2.'), 'Missing step 2');
  assert.ok(block.includes('3.'), 'Missing step 3');
  assert.ok(block.includes('4.'), 'Missing step 4');
});
test('References /compact in step 3', () => {
  const block = buildContextPressureBlock({ inputK: 100, percent: 60 });
  assert.ok(block.includes('/compact'), 'Step 3 should reference /compact');
});
test('References state.md in step 1', () => {
  const block = buildContextPressureBlock({ inputK: 100, percent: 60 });
  assert.ok(block.includes('state.md'), 'Step 1 should reference state.md');
});
test('Interpolates the true window size when windowK is present', () => {
  const block = buildContextPressureBlock({ inputK: 620, percent: 62, windowK: 1000 });
  assert.ok(block.includes('1000K limit'), `Expected 1000K limit, got: ${block.slice(0, 200)}`);
});
test('Falls back to 200K limit when windowK is absent', () => {
  const block = buildContextPressureBlock({ inputK: 125, percent: 62 });
  assert.ok(block.includes('200K limit'), `Expected 200K limit, got: ${block.slice(0, 200)}`);
});

console.log('\nContext pressure gate — evaluatePayload integration');

test('Execution trigger + high pressure → returns pressure block, not skill hints', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-int-'));
  const cwd = path.join(tmpHome, 'myproject');
  const projDir = cwdToProjectDir(cwd);
  const sessionId = 'test-int-' + Date.now();
  makeJsonlSession(sessionId, projDir, tmpHome, [
    { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
  ]);
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  const result = evaluatePayload({ prompt: 'execute the plan', session_id: sessionId, cwd });
  process.env.USERPROFILE = orig.up;
  process.env.HOME = orig.home;
  fs.rmSync(tmpHome, { recursive: true });

  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(ctx.includes('context-pressure-gate'), 'Should return pressure block');
  assert.ok(!ctx.includes('user-prompt-submit-hook'), 'Should NOT include skill hints when gate fires');
});

test('Execution trigger + low pressure → returns skill hints, not pressure block', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-int2-'));
  const cwd = path.join(tmpHome, 'myproject');
  const projDir = cwdToProjectDir(cwd);
  const sessionId = 'test-int2-' + Date.now();
  makeJsonlSession(sessionId, projDir, tmpHome, [
    { input_tokens: 3, cache_creation_input_tokens: 500, cache_read_input_tokens: 5000, output_tokens: 100 },
  ]);
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  const result = evaluatePayload({ prompt: 'execute the plan and start building the feature', session_id: sessionId, cwd });
  process.env.USERPROFILE = orig.up;
  process.env.HOME = orig.home;
  fs.rmSync(tmpHome, { recursive: true });

  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(!ctx.includes('context-pressure-gate'), 'Should NOT return pressure block at low pressure');
});

test('Non-execution prompt + high pressure → no pressure block', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-int3-'));
  const cwd = path.join(tmpHome, 'myproject');
  const projDir = cwdToProjectDir(cwd);
  const sessionId = 'test-int3-' + Date.now();
  makeJsonlSession(sessionId, projDir, tmpHome, [
    { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
  ]);
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  const result = evaluatePayload({ prompt: 'fix this bug in the auth middleware', session_id: sessionId, cwd });
  process.env.USERPROFILE = orig.up;
  process.env.HOME = orig.home;
  fs.rmSync(tmpHome, { recursive: true });

  const ctx = result.hookSpecificOutput?.additionalContext || '';
  assert.ok(!ctx.includes('context-pressure-gate'), 'Non-execution prompt should never get pressure block');
});

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

// ── Messages the user did not type, and recall already shown ─────────────────
//
// Claude Code passes task notifications and messages from other agents to the
// UserPromptSubmit hook as if they were prompts. Measured on 2026-09-30: 70 of
// 72 recall injections of one orchestrated run were attached to such messages.
// These tests run the real hook script (the Claude Code entry point) with a
// unique session id each, because the recall record of a session id persists
// in the temporary folder across test runs.

console.log('\nAgent messages and repeated recall (hooks/skill-activator.js)');

const { spawnSync } = require('child_process');
const { recallStatePath } = require('../../hooks/skill-activator');
const HOOK_SCRIPT = path.join(__dirname, '../../hooks/skill-activator.js');
const KNOWN_ISSUE_HEADING = '## Flaky deploy script loses the release tag';
const SAVED_HEADING = '## 2026-01-01 10:00 [saved]';
const RECALL_PROMPT = 'there is a bug: the deploy script crashes and loses the release tag, please debug it';

function makeRecallProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-unit-'));
  fs.writeFileSync(path.join(dir, 'known-issues.md'),
    `${KNOWN_ISSUE_HEADING}\n\n**Symptom:** the deploy script crashes and the release tag is lost.\n`);
  fs.writeFileSync(path.join(dir, 'session-log.md'),
    `${SAVED_HEADING}\nGoal: fix the deploy script that loses the release tag\n`);
  return dir;
}

let recallSessionCount = 0;
const recallSessionIds = [];
function uniqueSessionId() {
  recallSessionCount += 1;
  const sessionId = `recall-unit-${process.pid}-${Date.now()}-${recallSessionCount}`;
  recallSessionIds.push(sessionId);
  return sessionId;
}

// Removes a test's project folder whatever the test's outcome.
function withRecallProject(fn) {
  const dir = makeRecallProject();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runHook(payload) {
  const result = spawnSync(process.execPath, [HOOK_SCRIPT], { input: JSON.stringify(payload), encoding: 'utf8' });
  return JSON.parse(result.stdout || '{}');
}

function contextOf(output) {
  return output.hookSpecificOutput?.additionalContext || '';
}

const AGENT_MESSAGES = {
  'a task notification': `<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>${RECALL_PROMPT}</summary>\n</task-notification>`,
  'a message from another session (subagent hand-back)': `Another Claude session sent a message:\n<agent-message from="a2">\n[Subagent hand-back] ${RECALL_PROMPT}\n</agent-message>`,
  'a teammate message': `Another Claude session sent a message:\n<teammate-message teammate_id="orch-batch-1">\n${RECALL_PROMPT}\n</teammate-message>`,
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

test('a typed prompt that mentions <task-notification> later in its text is still enriched', () => withRecallProject((dir) => {
  const output = runHook({ prompt: `${RECALL_PROMPT}; it also prints <task-notification>`, session_id: uniqueSessionId(), cwd: dir });
  assert.ok(contextOf(output).includes(KNOWN_ISSUE_HEADING), `Expected the known issue, got: ${JSON.stringify(output)}`);
}));

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
function makeLogProject(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-log-unit-'));
  fs.writeFileSync(path.join(dir, 'session-log.md'), entries.join('\n'));
  return dir;
}

function withLogProject(entries, fn) {
  const dir = makeLogProject(entries);
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SAME_HEADING = '## 2026-08-22 [saved]';
const ZEBRA_PROMPT = 'what did we decide on the zebrafish parser';
const WALRUS_PROMPT = 'what did we decide on the walrus cache';
const memoryOf = output => (contextOf(output).match(/<session-memory-recall>[\s\S]*<\/session-memory-recall>/) || [''])[0];

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

test('an entry already shown is not replaced by a weaker match', () => withLogProject(
  [1, 2, 3].map(n => `## 2026-08-2${n} 10:00 [saved]\nGoal: zebrafish parser design, step ${n}\n`),
  (dir) => {
    const sessionId = uniqueSessionId();
    const first = memoryOf(runHook({ prompt: ZEBRA_PROMPT, session_id: sessionId, cwd: dir }));
    const second = memoryOf(runHook({ prompt: ZEBRA_PROMPT, session_id: sessionId, cwd: dir }));
    assert.strictEqual((first.match(/\[saved\]/g) || []).length, 2, `Expected the top 2 entries first: ${first}`);
    assert.strictEqual(second, '', `Expected no recall the second time, got: ${second}`);
  },
));

test('an agent message that names an execution trigger skips the context-pressure gate', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-agent-'));
  const cwd = path.join(tmpHome, 'myproject');
  const sessionId = uniqueSessionId();
  makeJsonlSession(sessionId, cwdToProjectDir(cwd), tmpHome, [
    { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
  ]);
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  try {
    const prompt = '<task-notification>\n<summary>execute the plan</summary>\n</task-notification>';
    assert.deepStrictEqual(runActivator({ prompt, session_id: sessionId, cwd }), {});
  } finally {
    process.env.USERPROFILE = orig.up;
    process.env.HOME = orig.home;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('an empty cwd falls back to the working folder, so the context-pressure gate still fires', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-emptycwd-'));
  const sessionId = uniqueSessionId();
  makeJsonlSession(sessionId, cwdToProjectDir(process.cwd()), tmpHome, [
    { input_tokens: 5, cache_creation_input_tokens: 100000, cache_read_input_tokens: 25000, output_tokens: 2000 },
  ]);
  const orig = { up: process.env.USERPROFILE, home: process.env.HOME };
  process.env.USERPROFILE = tmpHome;
  process.env.HOME = tmpHome;
  try {
    const ctx = contextOf(runActivator({ prompt: 'execute the plan', session_id: sessionId, cwd: '' }));
    assert.ok(ctx.includes('context-pressure-gate'), `Expected the pressure block, got: ${ctx.slice(0, 200)}`);
  } finally {
    process.env.USERPROFILE = orig.up;
    process.env.HOME = orig.home;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('the Codex adapter skips agent messages too', () => withRecallProject((dir) => {
  const output = runActivator({ prompt: AGENT_MESSAGES['a task notification'], session_id: uniqueSessionId(), cwd: dir });
  assert.deepStrictEqual(output, {});
}));

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
