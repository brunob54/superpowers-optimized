/**
 * Name lists for the switches that a user sets in the `env` block of a settings file:
 * SUPERPOWERS_STOP_REMINDERS_OFF (hooks/stop-reminders.js) and SUPERPOWERS_SECRETS_RULES_OFF
 * (hooks/safety/protect-secrets.js). Each hook keeps its own known names and its own message text;
 * only the two steps that both share are here.
 *
 * Plain Node.js (version 16 or later) with no dependency, like every hook file.
 */

'use strict';

const SEPARATOR = ',';

/**
 * The names in a switch value, in order: the value is split on commas, white space around each entry
 * is removed, each entry is changed to lower case, and an empty entry is dropped. A name that appears
 * twice stays twice.
 */
function parseNameList(value) {
  return String(value || '')
    .split(SEPARATOR)
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0);
}

/** The names of `names` that `knownNames` does not hold, in order, duplicates kept. */
function unknownNames(names, knownNames) {
  return names.filter(name => !knownNames.includes(name));
}

module.exports = { parseNameList, unknownNames };
