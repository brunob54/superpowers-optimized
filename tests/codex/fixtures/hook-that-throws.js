/**
 * A hook whose rule always fails. The tests run it to see what the shared
 * code of the safety hooks (hooks/safety/hook-io.js) does with an error:
 * for a Bash command the result is a refusal, for a file tool it is a pass.
 */

'use strict';

const path = require('path');
const { runHook, decideCommand } = require(path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'hook-io.js'));

const fail = () => { throw new Error('rule failed'); };

runHook('hook-that-throws', ['Bash', 'Read'], (data) => (
  data.tool_name === 'Bash' ? decideCommand(data.tool_input.command, fail) : fail()
));
