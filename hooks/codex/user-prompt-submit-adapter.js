#!/usr/bin/env node
/**
 * Codex UserPromptSubmit adapter.
 *
 * Reuses the shared skill-matching logic while keeping Codex's wire shape,
 * stdin handling, and file pathing isolated from Claude Code.
 */

'use strict';

const { evaluatePrompt } = require('../skill-activator');
const { readJsonStdin } = require('./utils');

// The whole decision is shared with the Claude Code hook (hooks/skill-activator.js).
const evaluatePayload = evaluatePrompt;

function main() {
  try {
    const data = readJsonStdin();
    process.stdout.write(JSON.stringify(evaluatePayload(data)));
  } catch {
    process.stdout.write('{}');
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { evaluatePayload, main };
}
