/**
 * Hook Input and Output — the parts that the two safety hooks share
 * (block-dangerous-commands.js and protect-secrets.js): reading the hook input
 * from standard input, writing the decision, the refusal log, and the wording
 * that every refusal message ends with.
 *
 * Logs refusals to: ~/.claude/hooks-logs/YYYY-MM-DD.jsonl
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readCommand } = require('./shell-words');

const BASH_TOOL = 'Bash';
const ALLOW_OUTPUT = '{}';
const UNREADABLE_RULE = 'unreadable-command';
const WRITE_TOOL_HINT = 'For text that only names a command, use the Write tool.';
const NO_RETRY = 'Do not retry with another spelling.';

const LOG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.claude',
  'hooks-logs'
);

function log(hook, data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook, ...data }) + '\n');
  } catch {}
}

/**
 * Builds the result of a rule that refuses: { blocked: true, pattern: { id, reason } }.
 * `what`: one sentence that names the program, the effect and the operand.
 * `safeForm`: the alternative that the model can use instead.
 */
function refusal(id, what, safeForm) {
  return { blocked: true, pattern: { id, reason: `${what} Safe form: ${safeForm}. ${WRITE_TOOL_HINT} ${NO_RETRY}` } };
}

const ALLOWED = { blocked: false, pattern: null };

// The refusal for a command that the reader could not read to its end.
function unreadableRefusal(problems) {
  return {
    blocked: true,
    pattern: {
      id: UNREADABLE_RULE,
      reason: `The hook could not read this command to its end (${problems.join('; ')}), so it cannot tell what would run. `
        + `Safe form: split it into separate, simpler commands. ${WRITE_TOOL_HINT} ${NO_RETRY}`,
    },
  };
}

/**
 * Decides one Bash command: reads it with the shared reader and gives its
 * simple commands to `rules(commands)`, which returns a refusal or null.
 * A command that the reader cannot read to its end is refused. An error inside
 * the reader or inside a rule counts the same way: the hook cannot tell what
 * would run.
 */
function decideCommand(cmd, rules) {
  try {
    const { commands, problems } = readCommand(cmd);
    if (problems.length) return unreadableRefusal(problems);
    return rules(commands) || ALLOWED;
  } catch (e) {
    return unreadableRefusal([`the hook stopped with an error: ${e.message}`]);
  }
}

// The first refusal that `rule(command)` returns for one of the commands, or null.
function firstRefusal(commands, rule) {
  for (const c of commands) {
    const hit = rule(c);
    if (hit) return hit;
  }
  return null;
}

/**
 * Runs one hook: reads the hook input (JSON) from standard input, asks
 * `decide(data)` for a result, and writes the decision to standard output.
 * `decide` returns { blocked, pattern: { id, reason } }.
 * A tool that is not in `tools`, and an input that is not JSON, pass.
 *
 * What an error inside a hook does:
 * - For a Bash command, `decideCommand` turns the error into a refusal. The
 *   hook could not judge the command, the command may destroy data, and the
 *   model can write the command in a simpler form.
 * - For Read, Edit, Write and Grep, an error inside `decide` arrives here and
 *   the call passes. The error is written to the log. Reason: these checks
 *   are a lookup in a table, and a defect that refused every Read, Edit and
 *   Write would stop all work, with no other form that the model could use.
 */
async function runHook(hook, tools, decide) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, session_id, cwd, permission_mode } = data;

    if (!tools.includes(tool_name)) {
      process.stdout.write(ALLOW_OUTPUT);
      return;
    }

    const result = decide(data);

    if (result.blocked) {
      const p = result.pattern;
      const target = tool_name === BASH_TOOL ? tool_input?.command : (tool_input?.file_path || tool_input?.path || tool_input?.glob);
      log(hook, { level: 'BLOCKED', id: p.id, tool: tool_name, target, session_id, cwd, permission_mode });
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[${p.id}] ${p.reason}`,
        },
      }));
      return;
    }

    process.stdout.write(ALLOW_OUTPUT);
  } catch (e) {
    log(hook, { level: 'ERROR', error: e.message });
    process.stdout.write(ALLOW_OUTPUT);
  }
}

module.exports = { runHook, refusal, decideCommand, firstRefusal, ALLOWED, BASH_TOOL, UNREADABLE_RULE, NO_RETRY };
