'use strict';
// tests/dashboard/helpers.js itself: a test file that ends without calling
// finish() must fail. Each case writes a small test file that loads the
// helpers, runs it as a child process, and reads its exit code and output.
const path = require('path');
const h = require('./helpers');

const HELPERS = path.join(__dirname, 'helpers.js');
const NEVER_CALLED = 'finish() was never called';

// Writes a test file that loads the helpers, passes one check and then runs
// <body>; runs it and returns { code, out, err }.
function runTestFile(name, body) {
  const text = [`const h = require(${JSON.stringify(HELPERS)});`, "h.check('one passing check', true);", body, ''].join('\n');
  return h.node(h.ROOT, [h.write(h.ROOT, `${name}.js`, text)]);
}

// Exit code, and whether the output names the missing finish() call.
function outcome(result) {
  return [result.code, result.out.includes(NEVER_CALLED)];
}

// 1. A test file that calls finish() passes and prints no message.
h.eq('finish() called: exit code 0 and no message', outcome(runTestFile('calls-finish', 'h.finish();')), [0, false]);

// 2. An early return before finish().
h.eq('an early return before finish(): exit code 1 and the message', outcome(runTestFile('early-return', 'return;\nh.finish();')), [1, true]);

// 3. An awaited promise that never settles, so finish() is never reached.
const neverSettles = '(async () => {\n  await new Promise(() => {});\n  h.finish();\n})();';
h.eq('a promise that never settles: exit code 1 and the message', outcome(runTestFile('never-settles', neverSettles)), [1, true]);

h.finish();
