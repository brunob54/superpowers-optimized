#!/usr/bin/env node
/**
 * Unit tests — hooks/name-list.js (the parser that SUPERPOWERS_STOP_REMINDERS_OFF and
 * SUPERPOWERS_SECRETS_RULES_OFF share).
 * Run: node tests/codex/test-name-list.js
 */

'use strict';

const assert = require('assert');
const { parseNameList, unknownNames } = require('../../hooks/name-list');

let passed = 0;
let failed = 0;

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

console.log('\nparseNameList');

test('splits on commas', () => assert.deepStrictEqual(parseNameList('a,b,c'), ['a', 'b', 'c']));
test('ignores white space around a name and keeps a space inside a name',
  () => assert.deepStrictEqual(parseNameList(' a , b c ,\td\t'), ['a', 'b c', 'd']));
test('ignores letter case', () => assert.deepStrictEqual(parseNameList('Env-File,ENVRC'), ['env-file', 'envrc']));
test('drops empty entries', () => assert.deepStrictEqual(parseNameList('a,,b, ,'), ['a', 'b']));
test('keeps a duplicate, in order', () => assert.deepStrictEqual(parseNameList('b,a,b'), ['b', 'a', 'b']));
test('an unset, null or empty value gives no names', () => {
  assert.deepStrictEqual(parseNameList(undefined), []);
  assert.deepStrictEqual(parseNameList(null), []);
  assert.deepStrictEqual(parseNameList(''), []);
});

console.log('\nunknownNames');

test('returns the names that are not known, in order, duplicates kept',
  () => assert.deepStrictEqual(unknownNames(['x', 'a', 'x', 'y'], ['a', 'b']), ['x', 'x', 'y']));
test('returns nothing when every name is known', () => assert.deepStrictEqual(unknownNames(['a', 'b'], ['a', 'b']), []));
test('returns nothing for no names', () => assert.deepStrictEqual(unknownNames([], ['a']), []));

console.log(`\nname-list: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
