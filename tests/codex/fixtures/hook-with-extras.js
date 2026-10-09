/**
 * A hook whose decision carries the optional extras that runHook (hooks/safety/hook-io.js) writes:
 * `systemMessage` (a message for the user) and `logFields` (fields added to the log record).
 * The input decides what the extras do:
 *   - a command or file name with the word `good`: both extras work;
 *   - the word `leak`: the reason names the switch variable of protect-secrets (the test helper must reject it);
 *   - any other input: reading either extra throws an error.
 */

'use strict';

const path = require('path');
const { runHook, decideCommand } = require(path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'hook-io.js'));

const FIXTURE_RULE = 'fixture-rule';
const MESSAGE = 'fixture message';
const FIELD = 'fixture_field';

function decision(input) {
  if (input.includes('leak')) {
    return { blocked: true, pattern: { id: FIXTURE_RULE, reason: 'the fixture names SUPERPOWERS_SECRETS_RULES_OFF.' } };
  }
  const refused = { blocked: true, pattern: { id: FIXTURE_RULE, reason: 'the fixture refuses.' } };
  if (input.includes('good')) return { ...refused, systemMessage: MESSAGE, logFields: { [FIELD]: 'x' } };
  const throwsWhenRead = (what) => ({ enumerable: true, get() { throw new Error(`${what} failed`); } });
  return Object.defineProperties(refused, { systemMessage: throwsWhenRead('message'), logFields: throwsWhenRead('fields') });
}

runHook('hook-with-extras', ['Bash', 'Read'], (data) => {
  const input = String(data.tool_input.command || data.tool_input.file_path);
  return data.tool_name === 'Bash' ? decideCommand(input, () => decision(input)) : decision(input);
});
