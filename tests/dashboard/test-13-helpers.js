'use strict';
// tests/dashboard/helpers.js itself: a test file that ends without calling
// finish(), or that records a failed check, must fail. Each case writes a
// small test file that loads the helpers, runs it as a child process, and
// reads its exit code and output.
const path = require('path');
const h = require('./helpers');

const HELPERS = path.join(__dirname, 'helpers.js');
const NEVER_CALLED = 'finish() was never called';
// Statements of the test files that the cases write.
const FINISH = 'h.finish();';
const FAILED_CHECK = "h.check('one failed check', false);";
const EARLY_RETURN = 'return;';
const EXIT_ZERO = 'process.exit(0);';

// Writes a test file that loads the helpers, passes one check and then runs
// the statements <body>, one per line; runs it and returns { code, out, err }.
function runTestFile(name, ...body) {
  const text = [`const h = require(${JSON.stringify(HELPERS)});`, "h.check('one passing check', true);", ...body, ''].join('\n');
  return h.node(h.ROOT, [h.write(h.ROOT, `${name}.js`, text)]);
}

// The exit code of this file must not come from the helpers under test: a
// helpers.js that never sets exit code 1 would make this file pass too. So
// this file counts its own failed cases and sets exit code 1 itself, in an
// 'exit' listener that Node runs after the listeners of helpers.js (they were
// added first, when helpers.js was loaded).
let failedCases = 0;
process.on('exit', () => {
  if (failedCases) process.exitCode = 1;
});

// Compares the exit code of <result>, and whether its output names the
// missing finish() call, with <expected>; h.eq prints the PASS or FAIL line.
function expectOutcome(desc, result, expected) {
  const actual = [result.code, result.out.includes(NEVER_CALLED)];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failedCases += 1;
  h.eq(desc, actual, expected);
}

// 1. A test file that calls finish() passes and prints no message.
expectOutcome('finish() called: exit code 0 and no message', runTestFile('calls-finish', FINISH), [0, false]);

// 2. An early return before finish().
expectOutcome('an early return before finish(): exit code 1 and the message', runTestFile('early-return', EARLY_RETURN, FINISH), [1, true]);

// 3. An awaited promise that never settles, so finish() is never reached.
const neverSettles = '(async () => {\n  await new Promise(() => {});\n  h.finish();\n})();';
expectOutcome('a promise that never settles: exit code 1 and the message', runTestFile('never-settles', neverSettles), [1, true]);

// 4. A failed check, then finish().
expectOutcome('a failed check then finish(): exit code 1 and no message', runTestFile('fail-then-finish', FAILED_CHECK, FINISH), [1, false]);

// 5. A failed check, then an early return before finish().
expectOutcome('a failed check then an early return: exit code 1 and the message', runTestFile('fail-then-return', FAILED_CHECK, EARLY_RETURN, FINISH), [1, true]);

// 6. process.exit(0) before finish(): Node runs the 'exit' listeners also then.
expectOutcome('process.exit(0) before finish(): exit code 1 and the message', runTestFile('exit-before-finish', EXIT_ZERO, FINISH), [1, true]);

// 7. A check that fails after finish() (code that goes on after finish()).
expectOutcome('a failed check after finish(): exit code 1', runTestFile('fail-after-finish', FINISH, FAILED_CHECK), [1, false]);

// 8. process.exit(0) after a finish() that counted a failed check.
expectOutcome('process.exit(0) after a finish() with a failed check: exit code 1', runTestFile('fail-finish-exit', FAILED_CHECK, FINISH, EXIT_ZERO), [1, false]);

h.finish();
