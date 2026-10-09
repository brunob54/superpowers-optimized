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
const HOOK_EVENT = 'PreToolUse';
// The field names of a refusal, sorted and joined.
const REFUSAL_FIELDS = 'hookEventName,permissionDecision,permissionDecisionReason';
// A home folder that is not below a temporary folder, so that no rule can take it for a scratch folder.
// It does not exist: the hook then writes no log. The log test uses makeHome().
const PLAIN_HOME = '/Users/shared-homes/safety-hook-tester';
// The work folder that a case gets when it names none. It does not have to exist.
const DEFAULT_CWD = '/Users/tester/project';
// How many hook processes run at the same time.
const PARALLEL = 8;
// The switch of protect-secrets. A user who sets it in settings.json passes it to every command that the
// assistant runs, so a test run would see it. hookEnv removes it unless a case sets it.
const SECRETS_SWITCH = 'SUPERPOWERS_SECRETS_RULES_OFF';
// The field of a refusal that carries a message for the user. A case that expects one says so.
const SYSTEM_MESSAGE_FIELD = 'systemMessage';

const hookPath = (name) => path.join(HOOKS_DIR, name);

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'safety-hook-home-'));
}

// The environment of the hook process: the test home folder, no project folder and no switch unless the case sets one.
function hookEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  if (!('CLAUDE_PROJECT_DIR' in extra)) delete env.CLAUDE_PROJECT_DIR;
  if (!(SECRETS_SWITCH in extra)) delete env[SECRETS_SWITCH];
  return env;
}

/**
 * Runs one hook script with one hook input.
 * Resolves to { decision, rule, reason, output, systemMessage }: decision is 'deny' or 'allow';
 * rule is the name between `[` and `]` at the start of the reason; output is the parsed JSON.
 * `allowSystemMessage`: the case expects a top-level `systemMessage` next to `hookSpecificOutput` (the report of
 * unknown names). Every other case keeps the exact shape, so a `systemMessage` where none is expected rejects.
 * Rejects when a refusal reason contains SECRETS_SWITCH and the input text does not: no reason may show the
 * model the name of the switch, unless the refused command names it itself.
 */
function runHook(hookFile, input, env, { allowSystemMessage = false } = {}) {
  const inputText = typeof input === 'string' ? input : JSON.stringify(input);
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
      // A pass is exactly `{}`: the hook reports no decision and the tool call goes on.
      if (Object.keys(output).length === 0) return resolve({ decision: ALLOW, rule: '', reason: '', output });
      // A refusal has exactly the shape that the hooks reference of Claude Code gives for PreToolUse
      // (https://code.claude.com/docs/en/hooks.md, read 2026-10-05):
      //   { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny",
      //                             "permissionDecisionReason": "<reason>" } }
      // `permissionDecision` may also be "allow", "ask" or "defer"; the safety hooks never print those.
      const specific = output.hookSpecificOutput || {};
      const reason = specific.permissionDecisionReason;
      const topLevel = Object.keys(output).sort().join();
      const messageOk = typeof output[SYSTEM_MESSAGE_FIELD] === 'string' && output[SYSTEM_MESSAGE_FIELD].length > 0;
      const topLevelOk = topLevel === 'hookSpecificOutput'
        || (allowSystemMessage && topLevel === `hookSpecificOutput,${SYSTEM_MESSAGE_FIELD}` && messageOk);
      const shapeOk = topLevelOk
        && Object.keys(specific).sort().join() === REFUSAL_FIELDS
        && specific.hookEventName === HOOK_EVENT && specific.permissionDecision === DENY
        && typeof reason === 'string' && reason.length > 0;
      if (!shapeOk) return reject(new Error(`hook output is neither a pass nor a refusal: ${stdout.slice(0, 200)}`));
      if (reason.includes(SECRETS_SWITCH) && !inputText.includes(SECRETS_SWITCH)) {
        return reject(new Error(`the refusal reason names the switch variable ${SECRETS_SWITCH}, and the refused input does not: ${reason.slice(0, 200)}`));
      }
      const rule = (/^\[([^\]]+)\]/.exec(reason) || [])[1] || '';
      resolve({ decision: DENY, rule, reason, output, systemMessage: output[SYSTEM_MESSAGE_FIELD] });
    });
    child.stdin.end(inputText);
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

// The records of the refusal log below a test home folder (<home>/.claude/hooks-logs/*.jsonl), oldest file first.
function readLog(home) {
  const dir = path.join(home, '.claude', 'hooks-logs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((file) =>
    fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
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
  hookPath, makeHome, hookEnv, runHook, bashInput, runAll, loadFixture, readLog, makeReport, compare,
  DENY, ALLOW, BASH, DEFAULT_CWD, PLAIN_HOME, SECRETS_SWITCH,
};
