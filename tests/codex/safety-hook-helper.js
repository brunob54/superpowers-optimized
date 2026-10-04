/**
 * Helper for the tests of the two safety hooks (hooks/safety/).
 *
 * It runs the real hook script the way Claude Code runs it: one process for
 * each tool call, the hook input as JSON on standard input, the decision as
 * JSON on standard output. A hook that ends with an exit status other than 0,
 * or that prints something that is not JSON, is an error of the test run.
 *
 * The hook process gets its own home folder, because a hook writes its
 * refusal log below the home folder (~/.claude/hooks-logs). The real log of
 * the person who runs the tests stays untouched.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS_DIR = path.join(__dirname, '..', '..', 'hooks', 'safety');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const DENY = 'deny';
const ALLOW = 'allow';
const BASH = 'Bash';
// The work folder that a case gets when it names none. It does not have to exist.
const DEFAULT_CWD = '/Users/tester/project';
// How many hook processes run at the same time.
const PARALLEL = 8;

const hookPath = (name) => path.join(HOOKS_DIR, name);

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'safety-hook-home-'));
}

// The environment of the hook process: the test home folder, and no project folder unless the case sets one.
function hookEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  if (!('CLAUDE_PROJECT_DIR' in extra)) delete env.CLAUDE_PROJECT_DIR;
  return env;
}

/**
 * Runs one hook script with one hook input.
 * Resolves to { decision, rule, reason }: decision is 'deny' or 'allow';
 * rule is the name between `[` and `]` at the start of the reason.
 */
function runHook(hookFile, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookFile], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) return reject(new Error(`hook ended with exit status ${status}: ${stderr.trim()}`));
      let output;
      try { output = JSON.parse(stdout); } catch (e) { return reject(new Error(`hook output is not JSON: ${stdout.slice(0, 200)}`)); }
      const specific = output.hookSpecificOutput || {};
      const reason = specific.permissionDecisionReason || '';
      const rule = (/^\[([^\]]+)\]/.exec(reason) || [])[1] || '';
      resolve({ decision: specific.permissionDecision === DENY ? DENY : ALLOW, rule, reason });
    });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

const bashInput = (command, cwd = DEFAULT_CWD) => ({ tool_name: BASH, tool_input: { command }, cwd, session_id: 'test' });

// Runs `worker` on every item, at most PARALLEL at a time. Returns the results in the order of the items.
async function runAll(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const k = next++;
      try { results[k] = await worker(items[k]); } catch (e) { results[k] = { error: e.message }; }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, lane));
  return results;
}

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')).cases;
}

/**
 * Collects checks and prints them. `check(label, problem)`: `problem` is '' when the check holds.
 * `quiet` checks print only when they fail (the fixture has several hundred of them).
 */
function makeReport(title) {
  let passed = 0;
  let failed = 0;
  return {
    section(text) { console.log(`\n${title}: ${text}`); },
    check(label, problem, quiet = false) {
      if (!problem) { passed++; if (!quiet) console.log(`  ✓ ${label}`); return; }
      failed++;
      console.log(`  ✗ ${label}`);
      console.log(`    ${problem}`);
    },
    finish() {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`${title}: ${passed} passed, ${failed} failed`);
      if (failed > 0) process.exit(1);
    },
  };
}

// '' when the result is the expected decision (and rule, when one is given), else a text that says what differs.
function compare(result, expect, rule) {
  if (result.error) return result.error;
  if (result.decision !== expect) return `expected ${expect}, got ${result.decision}${result.rule ? ` [${result.rule}]` : ''}`;
  if (rule && result.rule !== rule) return `expected the rule [${rule}], got [${result.rule}]`;
  return '';
}

module.exports = {
  hookPath, makeHome, hookEnv, runHook, bashInput, runAll, loadFixture, makeReport, compare,
  DENY, ALLOW, BASH, DEFAULT_CWD,
};
