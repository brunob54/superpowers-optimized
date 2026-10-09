# A per-rule switch for protect-secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-orchestrator:subagent-driven-development (recommended) or superpowers-orchestrator:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Body authority:** Exactly two things in this plan bind: the `**Global Constraints:**` block, and a block whose immediately preceding paragraph reads `**Exact content:** <reason>` where that reason names a pin this plan does not itself write or edit. Everything else is reference: fenced code blocks and block-quoted wording in task steps are reference implementations, and so is every other code block, every quoted wording, every header field, and this note itself — a finding against any of them is an ordinary fix, not a plan conflict, unless it contradicts a stated `**Contract:**` or a global constraint. A finding whose subject is this note's own wording is never a plan conflict: record it against the plan-writing skill at `skills/writing-plans/SKILL.md` and continue. That disposition covers the note's own text alone; a finding that this note contradicts something specific to this plan — one of its global constraints, say — is about that interaction and is triaged as an ordinary finding.

**Goal:** Add the environment variable `SUPERPOWERS_SECRETS_RULES_OFF`, a comma-separated list of rule names that `hooks/safety/protect-secrets.js` does not apply, with a report of unknown names, tests, documentation and release v7.70.0.
**Spec:** `/Users/bruno/Programming/AI/AI_Coding/My_tools/Superpowers/docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/specs/secrets-rules-switch-design.md` *(multi-doc-review reads this line to locate the spec on direct plan reviews; an old-layout path here would produce a plan whose spec is outside the layout)*
**Architecture:** protect-secrets reads the variable at every decision and filters its own rule tables (the path table, the content patterns, the two Bash rules) instead of dropping a refusal afterwards, so a command that names a second secret file is still refused by the rule of that file. A small shared module `hooks/name-list.js` parses a name list for protect-secrets and stop-reminders. The shared output code `hooks/safety/hook-io.js` lets a decision carry two optional extras (`systemMessage`, `logFields`) that block-dangerous-commands never sets. No refusal reason names the variable; every protect-secrets refusal ends with one sentence that tells an assistant to ask the user.
**Tech Stack:** Node.js (>= 16, standard library only), Bash (3.2 compatible), Markdown; the repository's own test runners (`bash tests/codex/run-unit-tests.sh`); the `claude` CLI (live probes only, Task 8).
**Assumptions:**
- Assumes the `claude` CLI (2.1.295 or later) is installed and logged in on the machine that runs Task 8 — will NOT work if it is not; Task 8 then returns BLOCKED and the plan stops there: Tasks 1-7 and 9 stay valid, and Task 10 waits for the results file of Task 8 (Task 10 writes its section 5 from that file).
- Assumes a hook process gets the variables of the `env` block of a settings file that `--settings` passes — will NOT work if Claude Code does not pass them; probe 1 (Task 8) tests this and the run stops when it fails.
- Assumes the stream-json `init` event of `claude -p --output-format stream-json --verbose` has a `plugins` array whose entries hold a `path` — will NOT work if the field has another name; the judge then reports every run as not valid; Task 8 Step 2 repairs `loadsBranchPlugin` once from the real `init` event and repeats, and it returns BLOCKED only when the repaired judge is still inconclusive (this is the planned reaction, not a defect).
- Assumes the interactive check (a) of probe 2 needs the user and an autonomous run cannot make it — so `SYSTEM_MESSAGE_SHIPS` stays `false` at the end of Task 8 (the decision rule of the spec, section 9.2: "including when the user does not make the interactive check, only the log record ships"). The message code and its tests stay in the code.
- Assumes no other suite reads the README text that Task 9 changes — will NOT hold if a suite pins it; Task 10 runs every fast suite of `CLAUDE.md` to find out.
- Assumes git tracks every file this plan modifies and ignores none of the new files (checked with `git ls-files --error-unmatch` and `git check-ignore -v` on 2026-10-09: all tracked, none ignored, none of the new paths exists).
**Global Constraints:** *(copied from the spec named above; they bind every task)*
- The variable is named `SUPERPOWERS_SECRETS_RULES_OFF`. Format: names separated by commas; spaces around a name are ignored; letter case does not matter; an empty entry is ignored; a name that appears twice has the same effect as once. (Spec section 4.)
- The known names are exactly 43 and are derived at run time from the hook's own tables, never written out a second time in code: the 27 `id` values of `SENSITIVE_FILES`, the 14 names `hardcoded-` followed by the `id` of each entry of `HARDCODED_SECRET_PATTERNS`, and the two Bash rules `env-dump` and `echo-secret-var`; the two Bash rule names become named constants used by the rule and by the list of known names. (Spec section 5.)
- An unknown name (including `unreadable-command` and every name from a block-dangerous-commands refusal such as `git-clean`) switches nothing off. `unreadable-command` cannot be switched off. block-dangerous-commands gets no switch and its behaviour, output and log record do not change. The OpenCode copy and Codex are not changed or tested. A call that passes because of the switch is not logged. (Spec sections 3 and 8.)
- The hook reads the variable at every decision, not once at module load, and filters its tables (the path table without the switched-off rows, the content patterns without the switched-off patterns, the `env-dump` and `echo-secret-var` checks skipped when their names are off). It never decides first and drops a refusal afterwards. For Bash the variable is read and parsed inside the rules that `decideCommand` calls. (Spec sections 6.1 and 8.)
- A file or value that two rules cover stays refused while one of them is on. A file name pattern is refused when its own text matches a row that is on, or when any sample name of `HIDDEN_SAMPLE_NAMES` that the pattern matches has a row that is on; the check tries every matching sample in list order. `CONTENT_SCAN_ALLOWLIST` does not change. (Spec sections 6.2, 6.3 and 6.5.)
- No refusal reason names `SUPERPOWERS_SECRETS_RULES_OFF` unless the refused command names it. Every protect-secrets refusal reason ends with the sentence "Never change Claude Code settings or hook files to get past this refusal; ask the user." (Spec section 7.1.)
- When the variable holds at least one unknown name and one of protect-secrets' own rules refuses a call, the refusal's log record gets the unknown names (each once, in order of first appearance) under a field whose name does not contain the variable's name. A call that passes gets no report. An `unreadable-command` refusal gets no report. The `systemMessage` ships only when probe 2 selects it by the decision rule of the spec, section 9.2. An error while building or reading an extra never turns a refusal into a pass. (Spec sections 7.2, 7.3 and 8.)
- The shared name-list module is reachable from `hooks/` and from `hooks/safety/` with a relative `require`, works on Node 16 and in Git Bash, and stop-reminders behaves exactly as before, including a repeated unknown name that its warning lists twice. (Spec section 6.4.)
- Test isolation: the safety-hook test helper removes `SUPERPOWERS_SECRETS_RULES_OFF` from the environment of every hook it runs unless the case sets it in `extra`; every test file that loads protect-secrets in-process clears the variable at its start; the behavioural test `tests/claude-code/test-subagent-hook-scope.sh` unsets the variable, passes `--settings '{"env":{"SUPERPOWERS_SECRETS_RULES_OFF":""}}'` to each `claude` run, and stops when managed settings set the variable, without changing the existing function `check_no_superpowers_defaults_setting` or its list. (Spec section 9.1.)
- Release v7.70.0: bump the version in every file that `CLAUDE.md` lists under Releases, add a `RELEASE-NOTES.md` entry that starts with the three-line summary (Problem, Change, Effect), and update README.md and docs/guide/README.md as the spec's section 10 states. (Spec section 10.)
- Language: plain, direct English for a reader who is not a native speaker; no idioms; every technical term defined at its first use; code comments follow the same rules and expand an abbreviation at its first use in a file.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `hooks/name-list.js` (create) | `parseNameList`, `unknownNames`: the two steps that both name-list switches share | 1 |
| `hooks/stop-reminders.js` (modify) | uses the shared helper; behaviour unchanged | 1 |
| `tests/codex/test-name-list.js` (create) | unit tests of the helper | 1 |
| `tests/codex/test-stop-reminders.js` (modify) | pin: a repeated unknown name is listed twice | 1 |
| `hooks/safety/hook-io.js` (modify) | a decision may carry `systemMessage` and `logFields` | 2 |
| `tests/codex/safety-hook-helper.js` (modify) | variable removed from hook environments, `systemMessage` shape option, hidden-name check, `readLog` | 2 |
| `tests/codex/fixtures/hook-with-extras.js` (create) | fixture hook for the extras | 2 |
| `tests/codex/test-block-dangerous-commands.js` (modify) | pin of one refusal; extras tests | 2 |
| `hooks/safety/protect-secrets.js` (modify) | the switch, the closing sentence, the report of unknown names | 3, 4, 5 |
| `tests/codex/test-protect-secrets.js` (modify) | switch, sentence, hidden-name, report and README tests | 3, 4, 5, 9 |
| `tests/codex/test-pretool-bash-adapter.js` (modify) | clears the variable; hidden-name check | 3, 4 |
| `tests/claude-code/test-helpers.sh` (modify) | `check_no_secrets_rules_managed_setting` (the existing function is not edited) | 6 |
| `tests/codex/test-check-no-secrets-rules-setting.sh` (create) | unit test of that function | 6 |
| `tests/claude-code/test-subagent-hook-scope.sh` (modify) | isolation from the user's setting | 6 |
| `tests/claude-code/probe-secrets-judge.js` (create) | judge of the live probes | 7 |
| `tests/claude-code/probe-secrets-rules-switch.sh` (create) | driver of the live probes | 7 |
| `tests/codex/test-probe-secrets-judge.js` (create) | unit test of the judge | 7 |
| `tests/codex/run-unit-tests.sh` (modify) | registers the new suites | 1, 6, 7 |
| `docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/implementation/secrets-rules-switch-probe-results.md` (create) | record of the probe results | 8 |
| `README.md`, `docs/guide/README.md` (modify) | the variable, the 43 names, the limits, the troubleshooting entry | 9 |
| `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.universal.yaml`, `RELEASE-NOTES.md`, `README.md` (modify) | release v7.70.0 | 10 |

Order: Tasks 1 and 2 build the shared parts; Tasks 3, 4 and 5 change protect-secrets in three steps (each step keeps every suite passing); Task 6 isolates the behavioural test; Tasks 7 and 8 make and run the live probes; Tasks 9 and 10 document and release. Each task commits on its own. Every command below runs from the repository root `/Users/bruno/Programming/AI/AI_Coding/My_tools/Superpowers`.

A note for every executor: the safety hook of your own session refuses a Bash command that names a secret file, for example one with the word `.env` in a command line. Write files with the Write or Edit tool, not with a here-document, and when a command below holds that word, build it exactly as shown.

---

### Task 1: The shared name-list helper

**Files:**
- Create: `hooks/name-list.js`
- Create: `tests/codex/test-name-list.js`
- Modify: `hooks/stop-reminders.js` (lines 22-78 area: the require block, `namesSwitchedOff`, `unknownNameWarning`)
- Modify: `tests/codex/test-stop-reminders.js` (add one pin test after the test "Known names only: the block has no unknown-name warning")
- Modify: `tests/codex/run-unit-tests.sh` (register the new suite)

**Security flag:** `none`

**Does NOT cover:** The helper does not know any rule name or any message text; each hook keeps its own known names and its own message. It does not remove duplicates (protect-secrets does that itself: Task 3 for the switched-off names, Task 5 for the report). It reads no environment variable itself.

**Contract:**
- `parseNameList(value)`: Input: a string, `undefined` or `null`. Output: an array of names in order — the value split on commas, white space around each entry removed, lower case, empty entries dropped, duplicates kept. An unset or empty value gives `[]`.
- `unknownNames(names, knownNames)`: Output: the entries of `names` that `knownNames` does not hold, in order, duplicates kept.
- stop-reminders behaves exactly as before: its 40+ existing tests pass unchanged, and a repeated unknown name (`foo,foo`) is still listed twice in its warning.
- Verification: `node tests/codex/test-name-list.js` and `node tests/codex/test-stop-reminders.js` both end with `0 failed`; the pin test passes before and after the change of stop-reminders.
- Interface not externally pinned — the names and signatures above are descriptive and may change in a fix (rule 2).

- [ ] **Step 1: Write the pin test for stop-reminders (it must pass on the present code)**

In `tests/codex/test-stop-reminders.js`, insert directly after the test `'Known names only: the block has no unknown-name warning'` (the test that ends with `assert.ok(!result.reason.includes(UNKNOWN_NAME_WARNING), ...)`):

```js
test('A repeated unknown name is listed twice in the warning (the parser keeps duplicates)', () => {
  const result = withRemindersOff('foo,foo', () => evaluateStop(TDD_SCENARIO.arrange));
  const reason = result.reason || '';
  assert.ok(reason.includes('"foo", "foo"'), `Expected the name twice, got: ${reason}`);
});
```

- [ ] **Step 2: Run the pin test on the present code**

Run: `node tests/codex/test-stop-reminders.js`
Expected: PASS — the output ends with `0 failed` and the new test line shows a check mark. (This is a pin of today's behaviour, so it passes before the change.)

- [ ] **Step 3: Write the unit test of the helper**

Create `tests/codex/test-name-list.js`:

```js
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
```

- [ ] **Step 4: Run the unit test to verify it fails**

Run: `node tests/codex/test-name-list.js`
Expected: FAIL with `Cannot find module '../../hooks/name-list'` (exit status 1).

- [ ] **Step 5: Create the helper**

Create `hooks/name-list.js`:

```js
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
```

- [ ] **Step 6: Use the helper in stop-reminders**

In `hooks/stop-reminders.js`, add this line after the `require('./save-marker')` block (after the line `} = require('./save-marker');`):

```js
const { parseNameList, unknownNames } = require('./name-list');
```

Replace the function `namesSwitchedOff`:

```js
function namesSwitchedOff() {
  return parseNameList(process.env[REMINDERS_OFF_VARIABLE]);
}
```

In `unknownNameWarning`, replace the first two lines of the body (`const unknownNames = namesSwitchedOff().filter(...)` and the `if` that follows) with:

```js
  const unknownEntries = unknownNames(namesSwitchedOff(), KNOWN_REMINDER_NAMES);
  if (unknownEntries.length === 0) return null;
```

and in the returned template replace `unknownNames.map(name => ...)` with `unknownEntries.map(name => ...)` (the rest of the message stays byte for byte).

- [ ] **Step 7: Register the suite**

In `tests/codex/run-unit-tests.sh`, add directly after the `stop-reminders (Claude Stop shape)` line:

```bash
run_test "name-list (the parser of the name-list switches)" "${SCRIPT_DIR}/test-name-list.js"
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node tests/codex/test-name-list.js && node tests/codex/test-stop-reminders.js | tail -3`
Expected: PASS — both outputs end with `0 failed`.

- [ ] **Step 9: Commit**

```bash
git add hooks/name-list.js hooks/stop-reminders.js tests/codex/test-name-list.js tests/codex/test-stop-reminders.js tests/codex/run-unit-tests.sh
git commit -m "refactor(hooks): share the name-list parser of the switches" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 1/10"
```

---

### Task 2: Hook output extras, test helper and pins

**Files:**
- Modify: `hooks/safety/hook-io.js` (`runHook`)
- Modify: `tests/codex/safety-hook-helper.js`
- Create: `tests/codex/fixtures/hook-with-extras.js`
- Modify: `tests/codex/test-block-dangerous-commands.js`

**Security flag:** `none`

**Does NOT cover:** Reading the variable or filtering any rule (Task 3). Any change of a block-dangerous-commands rule or message. A `systemMessage` for a pass: a pass is still exactly `{}`. The extras never change the permission decision.

**Contract:**
- `runHook` (hook-io.js): a decision `{ blocked: true, pattern, logFields?, systemMessage? }` writes (a) the log record `{ ts, hook, ...logFields, level, id, tool, target, session_id, cwd, permission_mode }` — the extras come before `level`, `id`, `tool`, `target`, `session_id`, `cwd` and `permission_mode`, so they can never overwrite those keys (a `ts` or `hook` key in the extras would overwrite the first two; no caller sends one) — and (b) the output `{ hookSpecificOutput: {...} }` plus a top-level `systemMessage` only when `systemMessage` is a non-empty string. A decision without extras (every block-dangerous-commands refusal) gives the same output and the same log keys as before this task. Invariant: an error while reading `logFields` or `systemMessage` (a getter that throws, a value that JSON cannot copy) never turns a refusal into a pass; the plain refusal is written without that extra.
- `safety-hook-helper.js`: `hookEnv` removes `SUPERPOWERS_SECRETS_RULES_OFF` unless `extra` sets it. `runHook(hookFile, input, env, { allowSystemMessage })` keeps the exact shape check (`hookSpecificOutput` is the one top-level key) unless `allowSystemMessage` is true, and then also accepts a non-empty string `systemMessage`; it returns `output` (the parsed JSON) and `systemMessage`; it rejects when a refusal reason contains the variable name while the input text does not. `readLog(home)` returns the parsed records of `<home>/.claude/hooks-logs/*.jsonl`, oldest file first, `[]` when the folder is absent.
- Verification: the new checks in `tests/codex/test-block-dangerous-commands.js` (pin of one complete refusal; throwing extras; working extras; leak rejected); the existing checks of that file and of `tests/codex/test-protect-secrets.js` keep passing.
- Interface not externally pinned — signatures above are descriptive and may change in a fix (rule 2).

- [ ] **Step 1: Change the test helper (test infrastructure, no hook behaviour yet)**

In `tests/codex/safety-hook-helper.js`:

(a) After the line `const PARALLEL = 8;` add:

```js
// The switch of protect-secrets. A user who sets it in settings.json passes it to every command that the
// assistant runs, so a test run would see it. hookEnv removes it unless a case sets it.
const SECRETS_SWITCH = 'SUPERPOWERS_SECRETS_RULES_OFF';
// The field of a refusal that carries a message for the user. A case that expects one says so.
const SYSTEM_MESSAGE_FIELD = 'systemMessage';
```

(b) Replace `hookEnv` with:

```js
// The environment of the hook process: the test home folder, no project folder and no switch unless the case sets one.
function hookEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  if (!('CLAUDE_PROJECT_DIR' in extra)) delete env.CLAUDE_PROJECT_DIR;
  if (!(SECRETS_SWITCH in extra)) delete env[SECRETS_SWITCH];
  return env;
}
```

(c) Replace the doc comment and the whole function `runHook` with:

```js
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
```

(d) Add after `loadFixture`:

```js
// The records of the refusal log below a test home folder (<home>/.claude/hooks-logs/*.jsonl), oldest file first.
function readLog(home) {
  const dir = path.join(home, '.claude', 'hooks-logs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((file) =>
    fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
}
```

(e) Replace the export block with:

```js
module.exports = {
  hookPath, makeHome, hookEnv, runHook, bashInput, runAll, loadFixture, readLog, makeReport, compare,
  DENY, ALLOW, BASH, DEFAULT_CWD, PLAIN_HOME, SECRETS_SWITCH,
};
```

- [ ] **Step 2: Run the two safety suites to see that the helper change broke nothing**

Run: `node tests/codex/test-block-dangerous-commands.js | tail -2 && node tests/codex/test-protect-secrets.js | tail -2`
Expected: PASS — both end with `0 failed`.

- [ ] **Step 3: Write the fixture hook**

Create `tests/codex/fixtures/hook-with-extras.js`:

```js
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
```

- [ ] **Step 4: Write the pin and the extras tests**

In `tests/codex/test-block-dangerous-commands.js`:

(a) Add `readLog` to the import list of `./safety-hook-helper`.

(b) After the line `const RM_CWD = 'rm-cwd';` add:

```js
// One complete refusal of this hook, pinned so that a change of the shared output code (hook-io.js) shows here.
const RESET_REASON = '[git-reset-hard] `git reset --hard` would discard the uncommitted changes of the work tree. '
  + 'Safe form: `git stash` first, or `git reset --soft`, `--mixed` or `--keep`; in a scratch repository below a temporary folder, '
  + 'name the folder in the command: `git -C <full path> ...`. For text that only names a command, use the Write tool. '
  + 'Do not retry with another spelling.';
const RESET_LOG_KEYS = 'cwd,hook,id,level,permission_mode,session_id,target,tool,ts';
```

(c) In `main`, directly before the line `const otherTool = await runHook(HOOK, { tool_name: 'Read', ...` (inside the section `message, log and hook input`), insert:

```js
  const pinHome = makeHome();
  const pinned = await runHook(HOOK, { ...bashInput('git reset --hard'), permission_mode: 'default' }, hookEnv(pinHome, { TMPDIR: OWN_TMPDIR }));
  const expectedOutput = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: RESET_REASON } };
  report.check('pin: one refusal has exactly this output, with no other top-level key',
    JSON.stringify(pinned.output) === JSON.stringify(expectedOutput) ? '' : `output: ${JSON.stringify(pinned.output)}`);
  const pinnedKeys = Object.keys(readLog(pinHome)[0] || {}).sort().join();
  report.check('pin: its log record has exactly the keys ts, hook, level, id, tool, target, session_id, cwd, permission_mode',
    pinnedKeys === RESET_LOG_KEYS ? '' : `keys: ${pinnedKeys}`);
  fs.rmSync(pinHome, { recursive: true, force: true });

  report.section('extras of a decision (systemMessage, logFields)');
  const extras = path.join(__dirname, 'fixtures', 'hook-with-extras.js');
  const extrasHome = makeHome();
  const extrasEnv = hookEnv(extrasHome);
  const readInput = { tool_name: 'Read', tool_input: { file_path: '/proj/a.js' } };
  for (const [label, input] of [['Bash', bashInput('ls')], ['Read', readInput]]) {
    // The default shape check rejects a `systemMessage` key, so this also proves that no message was written.
    const refused = await runHook(extras, input, extrasEnv);
    report.check(`an extra that throws when it is read leaves the plain refusal (${label})`, compare(refused, DENY, 'fixture-rule'));
  }
  const good = await runHook(extras, bashInput('echo good'), extrasEnv, { allowSystemMessage: true });
  report.check('an extra that works: the message is in the output',
    compare(good, DENY, 'fixture-rule') || (good.systemMessage === 'fixture message' ? '' : `systemMessage: ${good.systemMessage}`));
  const fixtureRecords = readLog(extrasHome).filter((r) => r.id === 'fixture-rule');
  report.check('each of the three refusals is logged, and only the working extra adds its field',
    fixtureRecords.length === 3 && fixtureRecords.filter((r) => r.fixture_field === 'x').length === 1
      ? '' : `records: ${JSON.stringify(fixtureRecords)}`);
  const leak = await runHook(extras, bashInput('echo leak'), extrasEnv).then(() => 'no error', (e) => e.message);
  report.check('the helper rejects a refusal reason that names the switch variable when the input does not',
    /names the switch variable/.test(leak) ? '' : `got: ${leak}`);
  fs.rmSync(extrasHome, { recursive: true, force: true });
  report.section('message, log and hook input');
```

- [ ] **Step 5: Run the tests to verify the new checks fail**

Run: `node tests/codex/test-block-dangerous-commands.js | grep -E "✗|passed"`
Expected: FAIL — the checks `an extra that works: the message is in the output` and `each of the three refusals is logged, and only the working extra adds its field` fail (hook-io.js does not write extras yet); the two `pin:` checks pass; the leak check passes (the helper change of Step 1 already does it).

- [ ] **Step 6: Change the shared output code**

In `hooks/safety/hook-io.js`, add this function directly before the comment block of `runHook` (after `firstRefusal`):

```js
// An optional extra of a decision (see runHook). An error while it is read gives no extra: the refusal is
// still written, without that extra. A refusal must never turn into a pass because an extra failed.
function readExtra(read) {
  try { return read(); } catch { return undefined; }
}
```

Replace the sentence `\`decide\` returns { blocked, pattern: { id, reason } }.` in the comment of `runHook` with:

```
 * `decide` returns { blocked, pattern: { id, reason } } and may add two extras to a refusal:
 * `logFields` (an object whose fields are added to the log record, before the standard fields, so that they
 * cannot overwrite one) and `systemMessage` (a non-empty string, written as a top-level `systemMessage` of
 * the output, which Claude Code shows to the user). The hooks that do not set them are unchanged.
```

Replace the body of `if (result.blocked) { ... }` with:

```js
    if (result.blocked) {
      const p = result.pattern;
      const target = tool_name === BASH_TOOL ? tool_input?.command : (tool_input?.file_path || tool_input?.path || tool_input?.glob);
      const logFields = readExtra(() => JSON.parse(JSON.stringify(result.logFields || {})));
      const systemMessage = readExtra(() => (typeof result.systemMessage === 'string' && result.systemMessage ? result.systemMessage : undefined));
      log(hook, { ...logFields, level: 'BLOCKED', id: p.id, tool: tool_name, target, session_id, cwd, permission_mode });
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[${p.id}] ${p.reason}`,
        },
      };
      if (systemMessage) output.systemMessage = systemMessage;
      process.stdout.write(JSON.stringify(output));
      return;
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node tests/codex/test-block-dangerous-commands.js | tail -2 && node tests/codex/test-protect-secrets.js | tail -2 && node tests/codex/test-pretool-bash-adapter.js | tail -2`
Expected: PASS — every output ends with `0 failed`.

- [ ] **Step 8: Commit**

```bash
git add hooks/safety/hook-io.js tests/codex/safety-hook-helper.js tests/codex/fixtures/hook-with-extras.js tests/codex/test-block-dangerous-commands.js
git commit -m "feat(hooks): a refusal may carry a message and log fields" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 2/10"
```

---

### Task 3: protect-secrets — the switch

**Files:**
- Modify: `hooks/safety/protect-secrets.js`
- Modify: `tests/codex/test-protect-secrets.js`
- Modify: `tests/codex/test-pretool-bash-adapter.js` (clears the variable at its start)

**Security flag:** `security` *(the task changes which credential rules the hook applies)*

**Does NOT cover:** The closing sentence of the refusal reasons (Task 4). The report of unknown names (Task 5). Any change of `CONTENT_SCAN_ALLOWLIST`, of the `ALLOWLIST` of template names, of the shared reader or of `unreadable-command`. A path allow-list. Codex and OpenCode (except that `tests/codex/test-pretool-bash-adapter.js` clears the variable, as spec section 9.1 requires; Task 4 adds its hidden-name check).

**Contract:**
- `rulesOff()` returns a `Set` of the lower-case names in `SUPERPOWERS_SECRETS_RULES_OFF`, read at each call (not at module load); an unset or empty variable gives the empty set; unknown names stay in the set and match no rule.
- `KNOWN_RULE_NAMES` has exactly 43 entries derived from `SENSITIVE_FILES` (27 `id` values), `HARDCODED_SECRET_PATTERNS` (14, as `hardcoded-<id>`), and the constants `ENV_DUMP_RULE` and `ECHO_SECRET_VAR_RULE`.
- `secretRow(path)` returns the first row of `SENSITIVE_FILES` whose expression matches and whose `id` is not in `rulesOff()`. `secretRowOfPattern` returns the first row that is on for any sample of `HIDDEN_SAMPLE_NAMES` that the pattern matches (every matching sample is tried, in list order). `checkOne` skips `dumpsEnvironment` when `env-dump` is off and `printedSecretVariable` when `echo-secret-var` is off. `checkWriteContent` skips a content pattern whose `hardcoded-<id>` is off.
- Invariants: with the variable unset every decision equals the decision before this task (all existing cases pass unchanged); a rule that is off is never the id of a refusal; a rule that is on still refuses a path or value that a switched-off rule also covers; `unreadable-command` is never affected.
- Verification: the new section `the switch` in `tests/codex/test-protect-secrets.js` (each documented example of the spec's section 9.1) and all existing cases.
- Interface not externally pinned — names above are descriptive and may change in a fix (rule 2).

- [ ] **Step 1: Write the failing tests**

In `tests/codex/test-protect-secrets.js`:

(a) Replace the import block with one that also imports `SECRETS_SWITCH`:

```js
const {
  hookPath, makeHome, hookEnv, runHook, bashInput, runAll, loadFixture, makeReport, compare, DENY, ALLOW, SECRETS_SWITCH,
} = require('./safety-hook-helper');
```

(b) Directly after the import block of (a), before any other line of the file that loads or runs code, add:

```js
// A user who sets the switch in settings.json passes it to every command that the assistant runs, and so to
// this file. Every case below expects the default (every rule on) unless it sets the variable itself.
delete process.env[SECRETS_SWITCH];
```

(c) After the constant `UNREADABLE_CASES` (before `async function runNamed`), add:

```js
// The switch SUPERPOWERS_SECRETS_RULES_OFF. A case: the list in the variable, the input, the decision, the rule.
const STRIPE_KEY = 'sk_' + 'live_' + 'a1B2c3'.repeat(5);
// Matches `hardcoded-aws-secret-key` and `hardcoded-generic-api-key`, and no other content pattern.
const AWS_SECRET_ASSIGNMENT = 'secret_key = "' + 'a1B2c3D4e5'.repeat(4) + '"';
const SOURCE_FILE = '/proj/src/config.js';
const switched = (label, list, input, shown, expect, rule) => ({ label, list, input, shown, expect, rule });
const switchedBash = (label, list, command, expect, rule) => switched(label, list, bashInput(command), command, expect, rule);
const switchedTool = (label, list, toolName, toolInput, expect, rule) =>
  switched(label, list, { tool_name: toolName, tool_input: toolInput }, `${toolName} ${JSON.stringify(toolInput)}`, expect, rule);
const writeOf = (content) => ({ file_path: SOURCE_FILE, content });

const SWITCH_CASES = [
  // One path row off: every tool passes, and the other rows still refuse.
  switchedBash('cat of the file', ENV_FILE, `cat ${ENV}`, ALLOW),
  switchedBash('grep of the file', ENV_FILE, `grep KEY ${ENV}`, ALLOW),
  switchedBash('git add of the file', ENV_FILE, `git add ${ENV}`, ALLOW),
  switchedBash('a redirect to the file', ENV_FILE, `echo A=1 > ${ENV}`, ALLOW),
  switchedBash('rg with a glob for the file', ENV_FILE, `rg -g '*${ENV}' KEY`, ALLOW),
  switchedTool('Read of the file', ENV_FILE, 'Read', { file_path: `/proj/${ENV}` }, ALLOW),
  switchedTool('Edit of the file', ENV_FILE, 'Edit', { file_path: `/proj/${ENV}`, old_string: 'a', new_string: 'b' }, ALLOW),
  switchedTool('Write of the file', ENV_FILE, 'Write', { file_path: `/proj/${ENV}`, content: 'A=1' }, ALLOW),
  switchedTool('Grep with the file as its path', ENV_FILE, 'Grep', { pattern: 'KEY', path: `/proj/${ENV}` }, ALLOW),
  switchedTool('Grep with a glob for the file', ENV_FILE, 'Grep', { pattern: 'KEY', glob: `*${ENV}` }, ALLOW),
  switchedTool('Read of .env.local (the name covers every suffix)', ENV_FILE, 'Read', { file_path: `/proj/${ENV}.local` }, ALLOW),
  switchedTool('Read of .env.production', ENV_FILE, 'Read', { file_path: `/proj/${ENV}.production` }, ALLOW),
  switchedTool('Read of a private key is still refused', ENV_FILE, 'Read', { file_path: '/home/me/.ssh/id_rsa' }, DENY, SSH_KEY),
  switchedBash('the file and a private key in one command: the key is refused', ENV_FILE, `cat ${ENV} ~/.ssh/id_rsa`, DENY, SSH_KEY),
  // Overlapping rows: a path stays refused while one of its rows is on.
  switchedTool('a private key with only ssh-private-key off', SSH_KEY, 'Read', { file_path: '/home/me/.ssh/id_rsa' }, DENY, 'ssh-private-key-2'),
  switchedTool('a private key with both rows off', `${SSH_KEY},ssh-private-key-2`, 'Read', { file_path: '/home/me/.ssh/id_rsa' }, ALLOW),
  switchedTool('credentials.json with credentials-json off alone (secrets-file still covers it)', 'credentials-json',
    'Read', { file_path: '/proj/credentials.json' }, DENY, 'secrets-file'),
  // File name patterns.
  switchedBash('.* with env-file and envrc off: the .netrc sample still refuses', 'env-file,envrc', 'cat .*', DENY, 'netrc'),
  switchedBash('*.env with env-file and envrc off passes', 'env-file,envrc', `cat *${ENV}`, ALLOW),
  switchedBash('.env* with env-file off: the .envrc sample still refuses', ENV_FILE, `cat ${ENV}*`, DENY, 'envrc'),
  switchedBash('documented limit: ~/.ssh/id_* passes with only ssh-private-key off', SSH_KEY, 'cat ~/.ssh/id_*', ALLOW),
  // Content patterns. The two ALLOW cases with one pattern off are also the check that spec section 9.1 asks for:
  // each value (the GitHub token, the Stripe key) matches exactly one pattern, because a second matching pattern
  // would still refuse it.
  switchedTool('a GitHub token with its pattern off', 'hardcoded-github-token', 'Write', writeOf(`const t = "${fakeToken}";`), ALLOW),
  switchedTool('a Stripe key while only the GitHub pattern is off', 'hardcoded-github-token', 'Write', writeOf(`const k = "${STRIPE_KEY}";`),
    DENY, 'hardcoded-stripe-key'),
  switchedTool('a Stripe key with its pattern off', 'hardcoded-stripe-key', 'Write', writeOf(`const k = "${STRIPE_KEY}";`), ALLOW),
  switchedTool('a value that two patterns match, one off', 'hardcoded-aws-secret-key', 'Write', writeOf(AWS_SECRET_ASSIGNMENT),
    DENY, 'hardcoded-generic-api-key'),
  switchedTool('a value that two patterns match, both off', 'hardcoded-aws-secret-key,hardcoded-generic-api-key', 'Write',
    writeOf(AWS_SECRET_ASSIGNMENT), ALLOW),
  // The two Bash rules.
  switchedBash('env with env-dump off', ENV_DUMP, 'env', ALLOW),
  switchedBash('echo of a secret variable with env-dump off is still refused', ENV_DUMP, 'echo $API_KEY', DENY, SECRET_VAR),
  switchedBash('echo of a secret variable with echo-secret-var off', SECRET_VAR, 'echo $API_KEY', ALLOW),
  switchedBash('env with echo-secret-var off is still refused', SECRET_VAR, 'env', DENY, ENV_DUMP),
  // Parsing and unknown names.
  switchedBash('spaces and letter case: the first name', ' Env-File , envrc ', `cat ${ENV}`, ALLOW),
  switchedBash('spaces and letter case: the second name', ' Env-File , envrc ', `cat ${ENV}rc`, ALLOW),
  switchedBash('a name with an underscore is unknown and switches nothing off', 'env_file', `cat ${ENV}`, DENY, ENV_FILE),
  switchedBash('an empty value switches nothing off', '', `cat ${ENV}`, DENY, ENV_FILE),
  switchedBash('unreadable-command cannot be switched off', UNREADABLE, `echo "abc; cat ${ENV}`, DENY, UNREADABLE),
  switchedBash('a name from block-dangerous-commands switches nothing off', 'git-clean', `cat ${ENV}`, DENY, ENV_FILE),
];

async function runSwitched(report, title, cases) {
  report.section(title);
  const results = await runAll(cases, (c) => runHook(HOOK, c.input, hookEnv(home, { [SECRETS_SWITCH]: c.list }), { allowSystemMessage: true }));
  cases.forEach((c, k) => {
    const problem = compare(results[k], c.expect, c.rule);
    report.check(`${c.label} [${JSON.stringify(c.list)}] → ${c.expect}`, problem && `${problem}\n    input: ${JSON.stringify(c.shown)}`);
  });
}
```

(d) No new constant is needed for the rule names: `ENV_FILE`, `ENV_DUMP`, `SECRET_VAR`, `SSH_KEY` and `UNREADABLE` already exist at the top of the file, and `fakeToken` is defined before the new block.

(e) In `main`, directly after the line `await runNamed(report, 'neighbours of the corrections, on both sides', NEIGHBOURS);` add:

```js
  await runSwitched(report, 'the switch SUPERPOWERS_SECRETS_RULES_OFF', SWITCH_CASES);
```

In `tests/codex/test-pretool-bash-adapter.js`, directly before the line `const { evaluatePayload } = require('../../hooks/codex/pretool-bash-adapter');` (that module loads protect-secrets) add:

```js
const { SECRETS_SWITCH } = require('./safety-hook-helper');

// A user who sets the switch of protect-secrets in settings.json passes it to every command that the assistant
// runs, and so to this file. Every test below expects the default (every rule on).
delete process.env[SECRETS_SWITCH];
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/codex/test-protect-secrets.js | grep -E "✗|passed" | head -40`
Expected: FAIL — the cases of the section `the switch SUPERPOWERS_SECRETS_RULES_OFF` that expect `allow` fail (for example `cat of the file ["env-file"] → allow`: `expected allow, got deny [env-file]`); the cases that expect `deny` and name the rule that stays on (for example `a private key with only ssh-private-key off` → `ssh-private-key-2`) also fail until Step 3 is done; the other `deny` cases pass.

- [ ] **Step 3: Change protect-secrets: names, the switch and the filter**

In `hooks/safety/protect-secrets.js`:

(a) After the line `const { runHook, refusal, ... } = require('./hook-io');` add:

```js
const { parseNameList } = require('../name-list');
```

(b) Directly after the constant `ASK_USER = ...;` (it ends with `` `cp -n <template> <file>`'; ``) add:

```js
// The environment variable that switches rules off: a comma-separated list of rule names (KNOWN_RULE_NAMES).
// A rule in the list is not applied. The name of a rule is the text that its refusal shows in square brackets.
const RULES_OFF_VARIABLE = 'SUPERPOWERS_SECRETS_RULES_OFF';
// The two Bash rules have no table row; their names are constants that the rule and KNOWN_RULE_NAMES share.
const ENV_DUMP_RULE = 'env-dump';
const ECHO_SECRET_VAR_RULE = 'echo-secret-var';
// The refusal for hardcoded content shows this text before the `id` of the content pattern.
const HARDCODED_PREFIX = 'hardcoded-';
```

(c) Directly after the array `HARDCODED_SECRET_PATTERNS` (after its closing `];`) add:

```js
const contentRuleName = (pattern) => `${HARDCODED_PREFIX}${pattern.id}`;

// Every name that the switch knows, derived from the tables above: 27 path rows, 14 content patterns, 2 Bash rules.
const KNOWN_RULE_NAMES = [
  ...SENSITIVE_FILES.map(row => row.id),
  ...HARDCODED_SECRET_PATTERNS.map(contentRuleName),
  ENV_DUMP_RULE,
  ECHO_SECRET_VAR_RULE,
];
```

(d) Directly after the line `const normalizePath = ...;` add:

```js
// The names that the user switched off, as a set. The variable is read at each decision, not once when the
// module loads, so that a test can set it after `require`. The last value is kept with its set, so a Bash
// command with thousands of words parses the list once.
let lastValue;
let lastSet = new Set();
function rulesOff() {
  const value = process.env[RULES_OFF_VARIABLE];
  if (value !== lastValue) {
    lastValue = value;
    lastSet = new Set(parseNameList(value));
  }
  return lastSet;
}
```

(e) In `secretRow`, replace the last line (`return SENSITIVE_FILES.find(row => row.regex.test(p)) || null;`) with:

```js
  const off = rulesOff();
  return SENSITIVE_FILES.find(row => row.regex.test(p) && !off.has(row.id)) || null;
```

(f) In `secretRowOfPattern`, replace these three lines:

```js
    const sample = HIDDEN_SAMPLE_NAMES.find(s => matchesPattern(parts, s));
    const row = sample ? secretRow(dir + sample) : null;
    if (row) return row;
```

with:

```js
    // Every sample that the pattern matches is tried: the first one can have a row that is switched off.
    for (const sample of HIDDEN_SAMPLE_NAMES) {
      const row = matchesPattern(parts, sample) ? secretRow(dir + sample) : null;
      if (row) return row;
    }
```

(g) In `checkOne`, replace the block from `if (dumpsEnvironment(c)) {` through the closing brace of the `if (secretVariable) {...}` with:

```js
  const off = rulesOff();
  if (!off.has(ENV_DUMP_RULE) && dumpsEnvironment(c)) {
    return refusal(ENV_DUMP_RULE, `\`${c.program}\` would print every variable of the environment, and some hold secrets.`,
      '`printenv NAME` for one variable that is not a secret, or `echo "${NAME:+set}"` to see whether a variable is set');
  }
  const secretVariable = off.has(ECHO_SECRET_VAR_RULE) ? null : printedSecretVariable(c);
  if (secretVariable) {
    return refusal(ECHO_SECRET_VAR_RULE, `\`${c.program}\` would print the value of the secret variable \`${secretVariable}\`.`,
      `\`echo "\${${secretVariable}:+set}"\` shows whether it is set and does not print the value`);
  }
```

(h) In `checkWriteContent`, replace the loop `for (const p of HARDCODED_SECRET_PATTERNS) { if (p.regex.test(content)) { return { blocked: true, pattern: { id: \`hardcoded-${p.id}\`, ...` so that it reads:

```js
  const off = rulesOff();
  for (const p of HARDCODED_SECRET_PATTERNS) {
    const name = contentRuleName(p);
    if (!off.has(name) && p.regex.test(content)) {
      return {
        blocked: true,
        pattern: {
          id: name,
          reason: `Hardcoded ${p.name} detected in content. Do not write the value into a file. Write code that reads it from the environment (process.env.${p.envHint}), and ask the user to store the value. ${NO_RETRY}`,
        },
      };
    }
  }
```

(keep the `return ALLOWED;` after the loop as it is).

(i) Replace the export object with:

```js
  module.exports = {
    SENSITIVE_FILES, HARDCODED_SECRET_PATTERNS, CONTENT_SCAN_ALLOWLIST, ALLOWLIST, KNOWN_RULE_NAMES, RULES_OFF_VARIABLE,
    check, checkFilePath, checkBashCommand, checkWriteContent, isAllowlisted, isContentScanAllowlisted,
  };
```

(j) In the file header comment, directly before the line ` * Limits. The hook reads text;` add:

```
 * Switch. The environment variable SUPERPOWERS_SECRETS_RULES_OFF holds a comma-separated list of rule names
 * (KNOWN_RULE_NAMES). A rule in the list is not applied: the hook filters its rule tables, so a command that
 * names a second secret file is still refused by the rule of that file. `unreadable-command` cannot be
 * switched off.
 *
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/codex/test-protect-secrets.js | tail -3 && node tests/codex/test-pretool-bash-adapter.js | tail -2 && node tests/codex/test-block-dangerous-commands.js | tail -2`
Expected: PASS — every output ends with `0 failed`.

- [ ] **Step 5: Check the count of known names**

Run: `node -e "console.log(require('./hooks/safety/protect-secrets.js').KNOWN_RULE_NAMES.length)"`
Expected: `43`

- [ ] **Step 6: Commit**

```bash
git add hooks/safety/protect-secrets.js tests/codex/test-protect-secrets.js tests/codex/test-pretool-bash-adapter.js
git commit -m "feat(protect-secrets): a per-rule switch SUPERPOWERS_SECRETS_RULES_OFF" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 3/10"
```

---

### Task 4: protect-secrets — the closing sentence and the hidden name

**Files:**
- Modify: `hooks/safety/protect-secrets.js`
- Modify: `tests/codex/test-protect-secrets.js`
- Modify: `tests/codex/test-pretool-bash-adapter.js` (hidden-name check on every refusal it reads)

**Security flag:** `security` *(the task changes the text that a refusal shows to the model, to lower the chance that a model unlocks a rule by itself)*

**Does NOT cover:** block-dangerous-commands refusals (they get no new sentence). Any text that names the variable in a refusal reason. The report of unknown names (Task 5). A change of the existing refusal for `echo $SUPERPOWERS_SECRETS_RULES_OFF` (it names the variable because the refused command names it; this stays).

**Contract:**
- `finishRefusal(result)` returns `result` unchanged when it is not a refusal; for a refusal it returns a copy whose `pattern.reason` is the old reason, one space, and `NO_SETTINGS_CHANGE`. It is applied to every result that `check` and `checkBashCommand` return, so it covers path rules, content rules, the two Bash rules and `unreadable-command`.
- Invariants: every protect-secrets refusal reason ends with ` ` + `NO_SETTINGS_CHANGE`; no refusal reason contains `SUPERPOWERS_SECRETS_RULES_OFF` unless the refused input contains it; a block-dangerous-commands reason is unchanged.
- Verification: the new section in `tests/codex/test-protect-secrets.js` (ending of seven kinds of refusal; the three hidden-name cases; the variable set while a key is refused); the changed message regex of the same file; the hidden-name check that `tests/codex/safety-hook-helper.js` runs on every refusal of every case and fixture; the same check inside `tests/codex/test-pretool-bash-adapter.js`.
- Interface not externally pinned — names above are descriptive and may change in a fix (rule 2).

- [ ] **Step 1: Write the failing tests**

In `tests/codex/test-protect-secrets.js`:

(a) Directly after the definition of `SWITCH_CASES` and `runSwitched` (added in Task 3) add:

```js
// The last sentence of every refusal reason of this hook.
const NO_SETTINGS_CHANGE = 'Never change Claude Code settings or hook files to get past this refusal; ask the user.';
const REFUSED_FORMS = [
  bash('a file in a command', `cat ${ENV}`, DENY, ENV_FILE),
  bash('the environment', 'env', DENY, ENV_DUMP),
  bash('a secret variable', 'echo $API_KEY', DENY, SECRET_VAR),
  bash('a command that cannot be read to its end', `echo "abc; cat ${ENV}`, DENY, UNREADABLE),
  tool('Read of a file', 'Read', { file_path: `/proj/${ENV}` }, DENY, ENV_FILE),
  tool('Grep with a glob', 'Grep', { pattern: 'KEY', glob: '*.pem' }, DENY, 'pem-key'),
  tool('Write of a hardcoded token', 'Write', writeOf(`const t = "${fakeToken}";`), DENY, 'hardcoded-github-token'),
];
// No refusal reason names the switch variable, except when the refused command names it itself.
const HIDDEN_NAME = [
  bash('echo of the variable: the command names it, so the reason may', `echo $${SECRETS_SWITCH}`, DENY, SECRET_VAR),
  bash('printenv of the variable', `printenv ${SECRETS_SWITCH}`, DENY, SECRET_VAR),
  bash('the form that shows only whether it is set', `echo "\${${SECRETS_SWITCH}:+set}"`, ALLOW),
];
```

(b) In `main`, replace the regular expression of the check `the message for a write names the rule and tells to ask the user` so that the whole check reads:

```js
  report.check('the message for a write names the rule and tells to ask the user',
    /^\[env-file\] The redirect `>` would write the secret file `\.env` .+ Safe form: ask the user to create or change the file.+ Do not retry with another spelling\. Never change Claude Code settings or hook files to get past this refusal; ask the user\.$/.test(write.reason)
      ? '' : `message: ${write.reason}`);
```

(c) In `main`, directly after the line `await runSwitched(report, 'the switch SUPERPOWERS_SECRETS_RULES_OFF', SWITCH_CASES);` add:

```js
  report.section('every refusal reason ends with the sentence that tells an assistant to ask the user');
  const endings = await runAll(REFUSED_FORMS, (c) => runHook(HOOK, c.input, env));
  REFUSED_FORMS.forEach((c, k) => {
    const problem = compare(endings[k], c.expect, c.rule)
      || (endings[k].reason.endsWith(` ${NO_SETTINGS_CHANGE}`) ? '' : `reason: ${endings[k].reason}`);
    report.check(`${c.label} → ends with the sentence`, problem && `${problem}\n    input: ${JSON.stringify(c.shown)}`);
  });

  await runNamed(report, 'the name of the switch in a refusal reason', HIDDEN_NAME);
  const naming = await runHook(HOOK, bashInput(`echo $${SECRETS_SWITCH}`), env);
  report.check('the one allowed exception: the reason names the variable when the command names it',
    naming.reason.includes(SECRETS_SWITCH) ? '' : `reason: ${naming.reason}`);
  const keyRefusal = await runHook(HOOK, bashInput('cat ~/.ssh/id_rsa'), hookEnv(home, { [SECRETS_SWITCH]: ENV_FILE }));
  report.check('a reason does not name the variable while the variable is set',
    compare(keyRefusal, DENY, SSH_KEY) || (keyRefusal.reason.includes(SECRETS_SWITCH) ? `reason: ${keyRefusal.reason}` : ''));
```

In `tests/codex/test-pretool-bash-adapter.js`, replace the function `test` with:

```js
// No refusal reason names the switch variable of protect-secrets, unless the refused command names it.
function assertSwitchNotNamed(result, payload) {
  const reason = result.hookSpecificOutput?.permissionDecisionReason || '';
  assert.ok(!reason.includes(SECRETS_SWITCH) || JSON.stringify(payload).includes(SECRETS_SWITCH),
    `The reason names the switch variable: ${reason}`);
}

function test(label, payload, assertFn) {
  try {
    const result = run(label, payload);
    assertFn(result);
    assertSwitchNotNamed(result, payload);
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/codex/test-protect-secrets.js | grep -E "✗|passed" | head -20`
Expected: FAIL — the seven `→ ends with the sentence` checks and the changed `the message for a write ...` check fail (the reasons do not end with the sentence yet); the hidden-name checks pass.

- [ ] **Step 3: Add the sentence to every refusal of protect-secrets**

In `hooks/safety/protect-secrets.js`, directly after the constant `HARDCODED_PREFIX` (added in Task 3) add this comment:

```js
// The last sentence of every refusal reason of this hook. It names no variable: a refusal reason goes to the
// model, and a model that learns the name of the switch could set it to avoid its own refusal.
```

and, directly below it, this constant. Its text is user-approved copy.

**Exact content:** user-approved copy — the sentence is quoted in the approved spec, section 7.1 (`docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/specs/secrets-rules-switch-design.md`, "every protect-secrets refusal reason ends with one more sentence"); this plan only places it.

```js
const NO_SETTINGS_CHANGE = 'Never change Claude Code settings or hook files to get past this refusal; ask the user.';
```

Then add this function directly before `function checkBashCommand(cmd) {`:

```js
// Ends the reason of a refusal with NO_SETTINGS_CHANGE. A result that is not a refusal is returned as it is.
function finishRefusal(result) {
  if (!result.blocked) return result;
  return { ...result, pattern: { ...result.pattern, reason: `${result.pattern.reason} ${NO_SETTINGS_CHANGE}` } };
}
```

Replace `checkBashCommand` and `check` so that they read:

```js
function checkBashCommand(cmd) {
  if (!cmd) return ALLOWED;
  return finishRefusal(decideCommand(cmd, (commands) => {
    // Found once for the whole call, so that the time for a long list of commands grows with its length.
    const lastXargs = new Map();
    for (const c of commands) {
      if (c.prefixes.includes(XARGS) && !(lastXargs.get(c.pipeline) > c.order)) lastXargs.set(c.pipeline, c.order);
    }
    return firstRefusal(commands, (c) => checkOne(c, lastXargs));
  }));
}
```

```js
function check(toolName, toolInput) {
  if (toolName === BASH_TOOL) return checkBashCommand(toolInput?.command);
  const pathResult = checkToolPaths(toolName, toolInput);
  // Also scan content being written for hardcoded secrets
  return finishRefusal(pathResult.blocked ? pathResult : checkWriteContent(toolName, toolInput));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/codex/test-protect-secrets.js | tail -3 && node tests/codex/test-pretool-bash-adapter.js | tail -2 && node tests/codex/test-block-dangerous-commands.js | tail -2`
Expected: PASS — every output ends with `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add hooks/safety/protect-secrets.js tests/codex/test-protect-secrets.js tests/codex/test-pretool-bash-adapter.js
git commit -m "feat(protect-secrets): every refusal tells an assistant to ask the user" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 4/10"
```

---

### Task 5: protect-secrets — the report of unknown names

**Files:**
- Modify: `hooks/safety/protect-secrets.js`
- Modify: `tests/codex/test-protect-secrets.js`

**Security flag:** `none`

**Does NOT cover:** A report for a call that passes (the hook never refuses only to report). A report for an `unreadable-command` refusal. Switching on the `systemMessage` (the constant `SYSTEM_MESSAGE_SHIPS` is `false` after this task and Task 8 decides). A report in block-dangerous-commands or in stop-reminders (its warning is unchanged). A record for a call that passes because of the switch.

**Contract:**
- `unknownNameReport()` returns `{}` when `rulesOff()` holds only known names; otherwise `{ logFields: { unknown_names: [...] } }` with each unknown name once, in order of first appearance, plus `systemMessage` (a text that names the variable, the unknown names in quotes and every known name) only when `SYSTEM_MESSAGE_SHIPS` is true. An error inside it returns `{}`.
- `finishRefusal` adds the report to a refusal of every rule except `unreadable-command`.
- Invariants: a pass has no report and no log record; the report never changes the decision, the rule id or the reason; with `SYSTEM_MESSAGE_SHIPS` false the hook output has no top-level `systemMessage` key; the field name `unknown_names` does not contain the variable name.
- Verification: the section `the report of unknown names` in `tests/codex/test-protect-secrets.js` (refused Bash call; refused Read; known names only; pass; `unreadable-command`; a block-dangerous-commands name), and the name count check (43 distinct names).
- Interface not externally pinned — names above are descriptive and may change in a fix (rule 2).

- [ ] **Step 1: Write the failing tests**

In `tests/codex/test-protect-secrets.js`:

(a) Add `readLog` to the import list from `./safety-hook-helper`, and, after the line `delete process.env[SECRETS_SWITCH];` of Task 3, add:

```js
const { KNOWN_RULE_NAMES, SYSTEM_MESSAGE_SHIPS } = require('../../hooks/safety/protect-secrets');
```

(b) Directly after the `HIDDEN_NAME` constant of Task 4 add:

```js
// The report of unknown names: a field of the log record, and, only when SYSTEM_MESSAGE_SHIPS, a message.
const UNKNOWN_FIELD = 'unknown_names';

// Runs one case with a home folder of its own, so that its log holds only its own records.
async function runWithLog(input, list) {
  const caseHome = makeHome();
  try {
    const result = await runHook(HOOK, input, hookEnv(caseHome, { [SECRETS_SWITCH]: list }), { allowSystemMessage: true });
    return { result, records: readLog(caseHome) };
  } finally {
    fs.rmSync(caseHome, { recursive: true, force: true });
  }
}
const reportedNames = (records) => (records[0] || {})[UNKNOWN_FIELD];
// '' when the run carries no report: no field in the log and no message.
const noReport = ({ result, records }) => (reportedNames(records) === undefined && result.systemMessage === undefined
  ? '' : `records: ${JSON.stringify(records)}, message: ${result.systemMessage}`);
const sameList = (actual, expected) => (JSON.stringify(actual) === JSON.stringify(expected)
  ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
```

(c) In `main`, directly before the section `messages and hook input` (the line `report.section('messages and hook input');`) add:

```js
  report.section('the report of unknown names');
  report.check('there are 43 known names, all different',
    KNOWN_RULE_NAMES.length === 43 && new Set(KNOWN_RULE_NAMES).size === 43 ? '' : `names: ${KNOWN_RULE_NAMES.length}`);
  const refusedCall = await runWithLog(bashInput(`cat ${ENV}`), 'foo,Foo , env_file,foo');
  report.check('a refused call: the unknown names are in the log record, each once, in order',
    compare(refusedCall.result, DENY, ENV_FILE) || sameList(reportedNames(refusedCall.records), ['foo', 'env_file']));
  const message = refusedCall.result.systemMessage;
  report.check(SYSTEM_MESSAGE_SHIPS ? 'the message names the variable, the unknown names and every known name' : 'no message is written (SYSTEM_MESSAGE_SHIPS is false)',
    SYSTEM_MESSAGE_SHIPS
      ? (typeof message === 'string' && message.includes(SECRETS_SWITCH) && message.includes('"foo", "env_file"')
        && KNOWN_RULE_NAMES.every((name) => message.includes(name)) ? '' : `message: ${message}`)
      : (message === undefined ? '' : `message: ${message}`));
  const readRefused = await runWithLog({ tool_name: 'Read', tool_input: { file_path: `/proj/${ENV}` } }, 'foo');
  report.check('a refused Read carries the same report',
    compare(readRefused.result, DENY, ENV_FILE) || sameList(reportedNames(readRefused.records), ['foo']));
  const otherHook = await runWithLog(bashInput(`cat ${ENV}`), 'git-clean');
  report.check('a name from a block-dangerous-commands refusal is reported as unknown',
    compare(otherHook.result, DENY, ENV_FILE) || sameList(reportedNames(otherHook.records), ['git-clean']));
  const passing = await runWithLog(bashInput('cat README.md'), 'foo');
  report.check('a call that passes has no message and no log record',
    compare(passing.result, ALLOW) || (passing.records.length === 0 ? noReport(passing) : `records: ${JSON.stringify(passing.records)}`));
  const passedBySwitch = await runWithLog(bashInput(`cat ${ENV}`), ENV_FILE);
  report.check('a call that passes because of the switch is not logged',
    compare(passedBySwitch.result, ALLOW) || (passedBySwitch.records.length === 0 ? '' : `records: ${JSON.stringify(passedBySwitch.records)}`));
  const unreadable = await runWithLog(bashInput(`echo "abc; cat ${ENV}`), 'foo');
  report.check('an unreadable-command refusal carries no report', compare(unreadable.result, DENY, UNREADABLE) || noReport(unreadable));
  const knownOnly = await runWithLog(bashInput('cat ~/.ssh/id_rsa'), ENV_FILE);
  report.check('known names only: no report', compare(knownOnly.result, DENY, SSH_KEY) || noReport(knownOnly));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/codex/test-protect-secrets.js | grep -E "✗|passed" | head`
Expected: FAIL — the checks `a refused call: the unknown names are in the log record, each once, in order`, `a refused Read carries the same report` and `a name from a block-dangerous-commands refusal is reported as unknown` fail (the log record has no `unknown_names` field yet). `SYSTEM_MESSAGE_SHIPS` is not exported yet, so it reads as `undefined`, which counts as false.

- [ ] **Step 3: Build the report in protect-secrets**

In `hooks/safety/protect-secrets.js`:

(a) Replace the two require lines for the shared modules so that they read:

```js
const { runHook, refusal, decideCommand, firstRefusal, ALLOWED, BASH_TOOL, UNREADABLE_RULE, NO_RETRY } = require('./hook-io');
const { parseNameList, unknownNames } = require('../name-list');
```

(the `hook-io` line replaces the existing `require('./hook-io')` line; the name-list line replaces the one added in Task 3).

(b) Directly after the constant `NO_SETTINGS_CHANGE` add:

```js
// A refusal that comes after an unknown name in the switch carries a report: the field UNKNOWN_NAMES_FIELD
// of its log record (its name does not hold the name of the variable) and, when SYSTEM_MESSAGE_SHIPS, a
// `systemMessage` for the user. The live probe 2 of the spec (section 9.2) decides whether the message
// ships: it ships only when the model cannot read it and the user sees it. Until that is shown, only the
// log record is written.
const UNKNOWN_NAMES_FIELD = 'unknown_names';
const SYSTEM_MESSAGE_SHIPS = false;
```

(c) Replace `finishRefusal` (added in Task 4) and add `unknownNameReport` before it, so that the two read:

```js
// The report of the unknown names in the switch: the extras of a decision (see runHook in hook-io.js).
// Each unknown name is listed once, in order of first appearance. An error while it is built gives no
// report: the refusal itself is still written.
function unknownNameReport() {
  try {
    const unknown = unknownNames([...rulesOff()], KNOWN_RULE_NAMES);
    if (unknown.length === 0) return {};
    const report = { logFields: { [UNKNOWN_NAMES_FIELD]: unknown } };
    if (SYSTEM_MESSAGE_SHIPS) {
      report.systemMessage = `Unknown name in ${RULES_OFF_VARIABLE}: ${unknown.map(name => `"${name}"`).join(', ')}. `
        + `Separate names with commas. Known names: ${KNOWN_RULE_NAMES.join(', ')}.`;
    }
    return report;
  } catch {
    return {};
  }
}

// Ends the reason of a refusal with NO_SETTINGS_CHANGE and adds the report of unknown names. A result that is
// not a refusal is returned as it is. `unreadable-command` is produced before any rule runs and no switch
// can change it, so it gets no report.
function finishRefusal(result) {
  if (!result.blocked) return result;
  const refused = { ...result, pattern: { ...result.pattern, reason: `${result.pattern.reason} ${NO_SETTINGS_CHANGE}` } };
  return result.pattern.id === UNREADABLE_RULE ? refused : { ...refused, ...unknownNameReport() };
}
```

(d) Add `SYSTEM_MESSAGE_SHIPS` to the export object:

```js
  module.exports = {
    SENSITIVE_FILES, HARDCODED_SECRET_PATTERNS, CONTENT_SCAN_ALLOWLIST, ALLOWLIST, KNOWN_RULE_NAMES, RULES_OFF_VARIABLE,
    SYSTEM_MESSAGE_SHIPS,
    check, checkFilePath, checkBashCommand, checkWriteContent, isAllowlisted, isContentScanAllowlisted,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/codex/test-protect-secrets.js | tail -3 && node tests/codex/test-pretool-bash-adapter.js | tail -2 && node tests/codex/test-block-dangerous-commands.js | tail -2`
Expected: PASS — every output ends with `0 failed`.

- [ ] **Step 5: Check the live shape of one refusal with an unknown name**

Run: `H=$(mktemp -d) && echo '{"tool_name":"Read","tool_input":{"file_path":"/p/'$(printf '.%s' env)'"},"session_id":"s1"}' | HOME=$H SUPERPOWERS_SECRETS_RULES_OFF=foo node hooks/safety/protect-secrets.js && echo && cat $H/.claude/hooks-logs/*.jsonl && rm -rf $H`
Expected: the first line is a refusal with `[env-file]` and no top-level `systemMessage` key; the log line holds `"unknown_names":["foo"]` before `"level":"BLOCKED"`.

- [ ] **Step 6: Commit**

```bash
git add hooks/safety/protect-secrets.js tests/codex/test-protect-secrets.js
git commit -m "feat(protect-secrets): the log record names unknown names of the switch" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 5/10"
```

---

### Task 6: The behavioural test is isolated from the user's switch

**Files:**
- Modify: `tests/claude-code/test-helpers.sh` (the new function and its export; the existing function is not edited)
- Create: `tests/codex/test-check-no-secrets-rules-setting.sh`
- Modify: `tests/claude-code/test-subagent-hook-scope.sh`
- Modify: `tests/codex/run-unit-tests.sh` (register the new suite)

**Security flag:** `none`

**Does NOT cover:** `test-multi-code-review.sh` and `test-multi-doc-review.sh` (they do not depend on protect-secrets and keep running for users of the switch). The existing function `check_no_superpowers_defaults_setting` is not edited at all: its list of variables, its list of files and its code stay as they are (Global Constraints, spec section 9.1). The spec's words "sharing its file-reading code" are not done on purpose: they contradict "The existing function and its list do not change" in the same bullet, so the new function holds its own copy of one grep line. Project and user settings files (the `--settings` flag outranks them).

**Contract:**
- `check_no_secrets_rules_managed_setting [file...]`: a file counts as setting the variable when it exists and its text holds a key `"SUPERPOWERS_SECRETS_RULES_OFF":` (plain grep, no jq, the same test as the existing function); with no argument it checks the two managed settings files (`/Library/Application Support/ClaudeCode/managed-settings.json`, `/etc/claude-code/managed-settings.json`); with arguments it checks those files. It prints `ABORT: SUPERPOWERS_SECRETS_RULES_OFF is set in the env block of <file>.` plus the reason and returns 1 when a file sets the variable (any value, also an empty one); returns 0 otherwise.
- `test-subagent-hook-scope.sh`: unsets the variable in its shell, calls the function and exits when it returns 1, and passes `--settings "$SECRETS_RULES_SETTINGS"` (the JSON `{"env":{"SUPERPOWERS_SECRETS_RULES_OFF":""}}`) to each of its two `claude` runs; its header comment states why.
- Verification: `bash tests/codex/test-check-no-secrets-rules-setting.sh`; `bash tests/codex/test-check-no-superpowers-defaults-setting.sh` (unchanged cases still pass); `bash tests/codex/test-claude-code-workdir.sh`; `grep -c -- '--settings "$SECRETS_RULES_SETTINGS"' tests/claude-code/test-subagent-hook-scope.sh` prints `2`; `bash -n` on both scripts.
- Interface not externally pinned — names above are descriptive and may change in a fix (rule 2).

- [ ] **Step 1: Write the failing unit test**

Create `tests/codex/test-check-no-secrets-rules-setting.sh`:

```bash
#!/usr/bin/env bash
# Unit test: check_no_secrets_rules_managed_setting (tests/claude-code/test-helpers.sh)
#
# The behavioural test test-subagent-hook-scope.sh expects the protect-secrets rule echo-secret-var to refuse a
# command. If that rule is switched off, the test would print the false conclusion "Subagents bypass safety
# hooks". The test clears the switch SUPERPOWERS_SECRETS_RULES_OFF with `--settings`, which ranks above user,
# project and local settings. Only managed settings rank above it, so the function stops the test when a managed
# settings file sets the variable. The two real managed paths are absolute and cannot be redirected, so each case
# below passes its own fixture paths as arguments; the function uses the two real paths only without arguments.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../claude-code/test-helpers.sh
source "${REPO_ROOT}/tests/claude-code/test-helpers.sh"

PASS=0
FAIL=0
ok()  { PASS=$(( PASS + 1 )); echo "  ok   - $1"; }
bad() { FAIL=$(( FAIL + 1 )); echo "  FAIL - $1"; }

VARIABLE=SUPERPOWERS_SECRETS_RULES_OFF
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# run_function <file...>: sets FUNCTION_STATUS and FUNCTION_OUTPUT.
run_function() {
  FUNCTION_OUTPUT="$(check_no_secrets_rules_managed_setting "$@" 2>&1)" && FUNCTION_STATUS=0 || FUNCTION_STATUS=$?
}

# expect_status <label> <wanted status> <file...>
expect_status() {
  local label="$1" wanted="$2"
  shift 2
  run_function "$@"
  if [ "$FUNCTION_STATUS" -eq "$wanted" ]; then ok "$label: exits $wanted"; else bad "$label: expected exit $wanted, got $FUNCTION_STATUS ($FUNCTION_OUTPUT)"; fi
}

printf '{"env": {"%s": "env-file"}}\n' "$VARIABLE" > "$WORK/with-value.json"
printf '{"env": {"%s": ""}}\n' "$VARIABLE" > "$WORK/with-empty-value.json"
printf '{"env": {"SUPERPOWERS_REVIEW_ROUNDS": "3"}}\n' > "$WORK/other-variable.json"

expect_status "a file that sets the variable" 1 "$WORK/with-value.json"
if echo "$FUNCTION_OUTPUT" | grep -qF -- "$VARIABLE" && echo "$FUNCTION_OUTPUT" | grep -qF -- "$WORK/with-value.json"; then
  ok "the message names the variable and the file"
else
  bad "the message does not name the variable and the file ($FUNCTION_OUTPUT)"
fi
expect_status "a file that sets the variable to an empty value" 1 "$WORK/with-empty-value.json"
expect_status "a file that sets another variable" 0 "$WORK/other-variable.json"
expect_status "a file that does not exist" 0 "$WORK/missing.json"
expect_status "the second of two files sets the variable" 1 "$WORK/other-variable.json" "$WORK/with-value.json"
if echo "$FUNCTION_OUTPUT" | grep -qF -- "$WORK/with-value.json"; then
  ok "the message names the second file"
else
  bad "the message does not name the second file ($FUNCTION_OUTPUT)"
fi

echo ""
echo "check_no_secrets_rules_managed_setting: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
```

In `tests/codex/run-unit-tests.sh`, add after the line `run_test "check-no-superpowers-defaults-setting" ...`:

```bash
run_test "check-no-secrets-rules-managed-setting" "${SCRIPT_DIR}/test-check-no-secrets-rules-setting.sh" bash
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `bash tests/codex/test-check-no-secrets-rules-setting.sh`
Expected: FAIL — `check_no_secrets_rules_managed_setting: command not found` (exit status 127 inside the function call, so every `expect_status` reports a wrong status).

- [ ] **Step 3: Add the functions to the test helpers**

In `tests/claude-code/test-helpers.sh`:

(a) Directly before the line `# Export functions for use in tests`, add:

```bash
# The per-rule switch of protect-secrets (README, "Environment variables") is the variable
# SUPERPOWERS_SECRETS_RULES_OFF. A test that expects a protect-secrets rule to refuse a command passes an empty
# value of it with `--settings`, which ranks above user, project and local settings. Only managed settings rank
# above `--settings`, so this function stops the test when a managed settings file sets the variable, with any
# value. Plain grep, no jq dependency, like check_no_superpowers_defaults_setting. Without arguments it checks the
# two managed settings files; with arguments it checks those files.
# Usage: check_no_secrets_rules_managed_setting [file...]
check_no_secrets_rules_managed_setting() {
    local var=SUPERPOWERS_SECRETS_RULES_OFF
    local files=("$@")
    local f
    if [ "${#files[@]}" -eq 0 ]; then
        files=("/Library/Application Support/ClaudeCode/managed-settings.json" "/etc/claude-code/managed-settings.json")
    fi
    for f in "${files[@]}"; do
        if [ -f "$f" ] && grep -qE "\"$var\"[[:space:]]*:" "$f"; then
            echo "ABORT: $var is set in the env block of $f."
            echo "Managed settings rank above the --settings flag of this test, so the test cannot clear the variable."
            echo "This test expects the protect-secrets rule echo-secret-var to refuse a command; with that rule switched off it would report a false conclusion. Remove the variable from $f before running this test."
            return 1
        fi
    done
    return 0
}

```

(b) Directly after the line `export -f check_no_superpowers_defaults_setting`, add:

```bash
export -f check_no_secrets_rules_managed_setting
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `bash tests/codex/test-check-no-secrets-rules-setting.sh && bash tests/codex/test-check-no-superpowers-defaults-setting.sh | tail -3`
Expected: PASS — the first prints `check_no_secrets_rules_managed_setting: 7 passed, 0 failed` and exits 0; the second prints no `FAIL` line.

- [ ] **Step 5: Isolate the behavioural test**

In `tests/claude-code/test-subagent-hook-scope.sh`, directly after the line `source "$SCRIPT_DIR/test-helpers.sh"` add:

```bash

# protect-secrets has a per-rule switch: the variable SUPERPOWERS_SECRETS_RULES_OFF holds rule names that the hook
# does not apply. Test 1 below expects the rule echo-secret-var to refuse a command. A user who switched that rule
# off (in settings.json, in a shell, or in a managed settings file) would see no refusal, and this test would print
# the false conclusion "Subagents bypass safety hooks". The test therefore:
#   1. unsets the variable in its own shell (for a value exported there);
#   2. passes an empty value with --settings in every claude run below. Claude Code reads the env block of its
#      settings files itself, so the unset alone does not remove a value of settings.json. The settings page ranks
#      command-line settings above local, project and user settings, and an empty value means every rule is on;
#   3. stops when managed settings set the variable: only managed settings rank above the command line.
unset SUPERPOWERS_SECRETS_RULES_OFF
check_no_secrets_rules_managed_setting || exit 1
SECRETS_RULES_SETTINGS='{"env":{"SUPERPOWERS_SECRETS_RULES_OFF":""}}'
```

In both `run_claude_in_workdir` calls (the ones that run `-p "$PROMPT_PRETOOL"` and `-p "$PROMPT_POSTTOOL"`), add the line `    --settings "$SECRETS_RULES_SETTINGS" \` directly after the line `    --permission-mode bypassPermissions \`.

- [ ] **Step 6: Verify the behavioural test script and the static scan**

Run: `bash -n tests/claude-code/test-subagent-hook-scope.sh && bash -n tests/claude-code/test-helpers.sh && grep -c -- '--settings "$SECRETS_RULES_SETTINGS"' tests/claude-code/test-subagent-hook-scope.sh && bash tests/codex/test-claude-code-workdir.sh | tail -3`
Expected: no syntax error; the count prints `2`; the last command ends with a line that has no `FAIL` (all checks `ok`).

- [ ] **Step 7: Commit**

```bash
git add tests/claude-code/test-helpers.sh tests/claude-code/test-subagent-hook-scope.sh tests/codex/test-check-no-secrets-rules-setting.sh tests/codex/run-unit-tests.sh
git commit -m "test: the subagent hook-scope test clears the secrets switch" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 6/10"
```

---

### Task 7: The judge and the driver of the live probes

**Files:**
- Create: `tests/claude-code/probe-secrets-judge.js`
- Create: `tests/claude-code/probe-secrets-rules-switch.sh`
- Create: `tests/codex/test-probe-secrets-judge.js`
- Modify: `tests/codex/run-unit-tests.sh` (register the judge test)

**Security flag:** `none`

**Does NOT cover:** Running the probes (Task 8). The interactive check (a) of probe 2, which needs the user at a terminal. Any run of the driver from a test suite: it costs model calls, so no suite starts it and `tests/claude-code/run-skill-tests.sh` does not list it.

**Contract:**
- `probe-secrets-judge.js` exports `classifyRun`, `verdictProbe1`, `tokenHits`, `transcriptFiles`, `kindReport` and the helpers they use, and has a command line with three commands: `session <stream file>` (prints the session id of the `init` event, exit 2 when there is none), `probe1 <stream A> <stream B> <repo folder> <marker> <hook log folder>` (prints a JSON verdict; exit 0 pass, 1 fail, 2 inconclusive) and `probe2 <output folder> <repo folder> <hook log folder> <projects folder>` (reads the token of each kind from the file `<output folder>/<kind>.token`; prints one JSON report for the kinds `main` and `subagent`; exit 0 when both runs are valid, 2 otherwise).
- A run is **valid** only when its `init` event lists a plugin whose `path` is the repository folder of this checkout or a folder inside it, and the Bash tool calls (for a subagent: those in the subagent transcripts) hold the command `cat .env` exactly.
- A run's **state** is `record` when the hook log holds a `BLOCKED` record with `id: env-file` and the run's session id; else `marker` when a tool result holds the marker, compared without letter case; else `none`. A run that holds a record counts as `record` whether or not it holds the marker.
- `verdictProbe1` follows the table of the spec (section 9.2): an invalid run gives `inconclusive`; A `record` and B `marker` gives `pass`; A `record` and B `record` gives `fail`; A `marker` gives `fail` (the plugin is not loaded); A `none` gives `inconclusive`; A `record` and B `none` gives `inconclusive`.
- `tokenHits(records, token)` lists every record that holds the token, with a label (`user`, `assistant`, `system`, `attachment:<type>`) and `counted`: true for a `user` or `assistant` record whose `message.content` holds the token and for an `attachment` record of any type except `hook_success`; false for every other record type. The comparison ignores letter case.
- `kindReport` sets `modelCanRead` to true when a counted hit exists or the text of a `result` event holds the token, and `logHit` to true when any `BLOCKED` log record has the token in `unknown_names`.
- The driver `probe-secrets-rules-switch.sh` takes the mode `probe1` or `probe2` and an output folder, and exits 64 for any other arguments. It loads the plugin of the checkout with `--plugin-dir`, passes the value of the switch of each run with `--settings`, and writes one stream file per run (`probe1-a`, `probe1-b`, `main-1`, `main-2`, `subagent-1`, `subagent-2`, each `.jsonl`) and, for probe 2, one token file per kind (`main.token`, `subagent.token`) into the output folder. It then calls the judge, whose exit status it returns.
- Verification: `node tests/codex/test-probe-secrets-judge.js` (each rule above, each row of the table); `bash -n` on the driver; the usage exit status 64 (Step 6); the behaviour of the driver is verified by the live runs of Task 8.
- Interface not externally pinned — names above are descriptive and may change in a fix (rule 2).

- [ ] **Step 1: Write the failing unit test**

Create `tests/codex/test-probe-secrets-judge.js`:

```js
#!/usr/bin/env node
/**
 * Unit tests — tests/claude-code/probe-secrets-judge.js (the judge of the live probes of the switch
 * SUPERPOWERS_SECRETS_RULES_OFF). It runs on synthetic stream-json events (JSON, JavaScript Object Notation, one
 * event per line), hook log records and transcripts;
 * it starts no `claude` process.
 * Run: node tests/codex/test-probe-secrets-judge.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const judge = require('../claude-code/probe-secrets-judge');

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

const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-repo-'));
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-work-'));
const MARKER = '0a1b2c3d4e5f6071';
const TOKEN = 'f0e1d2c3b4a59687';
const SID = 'sid-main';
const COMMAND = 'cat .env';

const initOf = (pluginPath) => ({ type: 'system', subtype: 'init', session_id: SID, plugins: [{ name: 'superpowers-orchestrator', path: pluginPath }] });
const bashCall = (command) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
const toolResult = (text) => ({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } });
const blocked = (extra = {}) => ({ level: 'BLOCKED', id: 'env-file', session_id: SID, ...extra });
const validEvents = (...more) => [initOf(repoDir), bashCall(COMMAND), ...more];
const classify = (events, logRecords = []) => judge.classifyRun({ events, logRecords, repoDir, marker: MARKER });

console.log('\nclassifyRun');

test('a refusal in the hook log is state record', () => {
  const run = classify(validEvents(toolResult('refused')), [blocked()]);
  assert.deepStrictEqual([run.valid, run.state], [true, 'record']);
});
test('the marker in a tool result is state marker, without letter case', () => {
  const run = classify(validEvents(toolResult(`${MARKER.toUpperCase()}\n`)));
  assert.deepStrictEqual([run.valid, run.state], [true, 'marker']);
});
test('no record and no marker is state none', () => assert.strictEqual(classify(validEvents(toolResult('nothing'))).state, 'none'));
test('a record wins over the marker', () => assert.strictEqual(classify(validEvents(toolResult(MARKER)), [blocked()]).state, 'record'));
test('a record of another session does not count', () =>
  assert.strictEqual(classify(validEvents(), [blocked({ session_id: 'other' })]).state, 'none'));
test('a record of another rule does not count', () => assert.strictEqual(classify(validEvents(), [blocked({ id: 'envrc' })]).state, 'none'));
test('a plugin from another folder makes the run not valid', () =>
  assert.strictEqual(classify([initOf('/elsewhere/installed'), bashCall(COMMAND)]).valid, false));
test('a plugin path with a longer folder name does not count as this checkout', () =>
  assert.strictEqual(classify([initOf(`${repoDir}-old`), bashCall(COMMAND)]).valid, false));
test('a plugin inside the checkout counts', () =>
  assert.strictEqual(classify([initOf(path.join(repoDir, '.claude-plugin')), bashCall(COMMAND)]).valid, true));
test('another command makes the run not valid', () =>
  assert.strictEqual(classify([initOf(repoDir), bashCall(`${COMMAND} | head`)]).valid, false));
test('no init event makes the run not valid', () => assert.strictEqual(classify([bashCall(COMMAND)]).valid, false));

console.log('\nverdictProbe1');

const run = (state, valid = true) => ({ valid, state });
const verdictOf = (a, b) => judge.verdictProbe1(a, b).outcome;
test('A record, B marker: pass', () => assert.strictEqual(verdictOf(run('record'), run('marker')), 'pass'));
test('A record, B record: fail', () => assert.strictEqual(verdictOf(run('record'), run('record')), 'fail'));
test('A marker: fail, whatever B is', () => {
  for (const b of ['record', 'marker', 'none']) assert.strictEqual(verdictOf(run('marker'), run(b)), 'fail');
});
test('A none: inconclusive, whatever B is', () => {
  for (const b of ['record', 'marker', 'none']) assert.strictEqual(verdictOf(run('none'), run(b)), 'inconclusive');
});
test('A record, B none: inconclusive', () => assert.strictEqual(verdictOf(run('record'), run('none')), 'inconclusive'));
test('a run that is not valid: inconclusive', () => {
  assert.strictEqual(verdictOf(run('record', false), run('marker')), 'inconclusive');
  assert.strictEqual(verdictOf(run('record'), run('marker', false)), 'inconclusive');
});

console.log('\ntokenHits');

test('a record counts only when the model can have received it', () => {
  const records = [
    { type: 'user', message: { content: [{ type: 'tool_result', content: `x ${TOKEN.toUpperCase()}` }] } },
    { type: 'system', content: TOKEN },
    { type: 'attachment', attachment: { type: 'hook_success', stdout: TOKEN } },
    { type: 'attachment', attachment: { type: 'hook_additional_context', content: TOKEN } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'none' }] } },
    { type: 'queue-operation', content: TOKEN },
  ];
  const hits = judge.tokenHits(records, TOKEN).map((h) => [h.label, h.counted]);
  assert.deepStrictEqual(hits, [
    ['user', true], ['system', false], ['attachment:hook_success', false],
    ['attachment:hook_additional_context', true], ['queue-operation', false],
  ]);
});

console.log('\ntranscriptFiles and kindReport');

const SID_QUIET = 'sid-quiet';
const SID_SUB = 'sid-sub';
const projects = path.join(workRoot, 'projects');
const projectFolder = path.join(projects, 'proj');
for (const id of [SID, SID_SUB]) fs.mkdirSync(path.join(projectFolder, id, 'subagents'), { recursive: true });
const writeJsonl = (file, records) => fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
const streamOf = (name, records) => {
  const file = path.join(workRoot, name);
  writeJsonl(file, records);
  return file;
};
const initFor = (sessionId) => ({ ...initOf(repoDir), session_id: sessionId });
const report = (kind, stream, logRecords = [], projectsDir = projects) =>
  judge.kindReport({ kind, streamFiles: [stream], repoDir, token: TOKEN, logRecords, projectsDir });

// SID: a main transcript and one subagent transcript, for the lookup of the files.
writeJsonl(path.join(projectFolder, `${SID}.jsonl`), [{ type: 'system', content: TOKEN }]);
writeJsonl(path.join(projectFolder, SID, 'subagents', 'agent-a1.jsonl'), [bashCall(COMMAND)]);
// SID_QUIET: the token only in a system record of the main transcript.
writeJsonl(path.join(projectFolder, `${SID_QUIET}.jsonl`), [{ type: 'system', content: TOKEN }]);
// SID_SUB: a subagent that ran the command and received the token in a tool result.
writeJsonl(path.join(projectFolder, `${SID_SUB}.jsonl`), [{ type: 'assistant', message: { content: [{ type: 'text', text: 'dispatching' }] } }]);
writeJsonl(path.join(projectFolder, SID_SUB, 'subagents', 'agent-a1.jsonl'), [bashCall(COMMAND), toolResult(`the unknown name ${TOKEN}`)]);

test('transcriptFiles finds the main transcript and the subagent transcripts of a session', () => {
  const files = judge.transcriptFiles(projects, SID).map((f) => [path.basename(f.file), f.subagent]);
  assert.deepStrictEqual(files, [[`${SID}.jsonl`, false], ['agent-a1.jsonl', true]]);
});
test('main kind: a hit only in a system record does not let the model read the token; the log record is found', () => {
  const main = streamOf('main-quiet.jsonl', [initFor(SID_QUIET), bashCall(COMMAND), toolResult('refused'), { type: 'result', result: 'none' }]);
  const result = report('main', main, [blocked({ unknown_names: [TOKEN] })]);
  assert.deepStrictEqual([result.valid, result.modelCanRead, result.logHit], [true, false, true]);
  assert.deepStrictEqual(result.hits.map((h) => [h.label, h.counted]), [['system', false]]);
});
test('subagent kind: the Bash call is found in the subagent transcript, and the counted hit there is read', () => {
  const sub = streamOf('subagent-1.jsonl', [initFor(SID_SUB), { type: 'result', result: 'the subagent said it was refused' }]);
  const result = report('subagent', sub);
  assert.deepStrictEqual([result.valid, result.modelCanRead, result.logHit], [true, true, false]);
});
test('subagent kind: no Bash call in a subagent transcript makes the run not valid', () => {
  const sub = streamOf('subagent-none.jsonl', [initFor(SID_QUIET), { type: 'result', result: 'none' }]);
  assert.strictEqual(report('subagent', sub).valid, false);
});
test('the text of a result event that holds the token lets the model read it', () => {
  const answer = streamOf('answer.jsonl', [initOf(repoDir), bashCall(COMMAND), { type: 'result', result: `I see ${TOKEN}` }]);
  assert.strictEqual(report('main', answer, [], path.join(workRoot, 'no-projects')).modelCanRead, true);
});

fs.rmSync(workRoot, { recursive: true, force: true });
fs.rmSync(repoDir, { recursive: true, force: true });
console.log(`\nprobe-secrets-judge: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

In `tests/codex/run-unit-tests.sh`, add after the `check-no-secrets-rules-managed-setting` line:

```bash
run_test "probe-secrets-judge (the judge of the live probes)" "${SCRIPT_DIR}/test-probe-secrets-judge.js"
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `node tests/codex/test-probe-secrets-judge.js`
Expected: FAIL with `Cannot find module '../claude-code/probe-secrets-judge'` (exit status 1).

- [ ] **Step 3: Write the judge**

Create `tests/claude-code/probe-secrets-judge.js`:

```js
#!/usr/bin/env node
/**
 * Judge for the live probes of the switch SUPERPOWERS_SECRETS_RULES_OFF (spec section 9.2, probes 1 and 2).
 * The driver tests/claude-code/probe-secrets-rules-switch.sh runs `claude -p --output-format stream-json`
 * and calls this file to read the outputs. This file only reads files; it starts no process.
 *
 * Usage:
 *   node probe-secrets-judge.js session <stream file>
 *   node probe-secrets-judge.js probe1 <stream A> <stream B> <repo folder> <marker> <hook log folder>
 *   node probe-secrets-judge.js probe2 <output folder> <repo folder> <hook log folder> <projects folder>
 *     (the token of each kind is the content of the file <output folder>/<kind>.token)
 * Exit status of probe1: 0 pass, 1 fail, 2 inconclusive. probe2 exits 0 when both runs are valid, else 2.
 *
 * Words used here: a "stream" is the stdout (standard output) of one `claude -p --output-format stream-json --verbose` run, one
 * JSON (JavaScript Object Notation) event per line. A "transcript" is the .jsonl file that Claude Code keeps for a session below
 * ~/.claude/projects/. The "hook log" is ~/.claude/hooks-logs/<date>.jsonl, which the safety hooks write.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The command that both probes ask the model to run, exactly.
const TARGET_COMMAND = 'cat .env';
const ENV_RULE = 'env-file';
const BLOCKED = 'BLOCKED';
const UNKNOWN_NAMES_FIELD = 'unknown_names';
const KIND_MAIN = 'main';
const KIND_SUBAGENT = 'subagent';
const HOOK_SUCCESS = 'attachment:hook_success';
const STATE = { RECORD: 'record', MARKER: 'marker', NONE: 'none' };
const OUTCOME = { PASS: 'pass', FAIL: 'fail', INCONCLUSIVE: 'inconclusive' };
const EXIT_OF = { [OUTCOME.PASS]: 0, [OUTCOME.FAIL]: 1, [OUTCOME.INCONCLUSIVE]: 2 };
const EXIT_USAGE = 64;

const parseLines = (text) => text.split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const readRecords = (file) => parseLines(fs.readFileSync(file, 'utf8'));

// Every record of every .jsonl file in the hook log folder; none when the folder does not exist.
function readLogRecords(logDir) {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl')).sort()
    .flatMap((f) => readRecords(path.join(logDir, f)));
}

const initEvent = (events) => events.find((e) => e.type === 'system' && e.subtype === 'init') || null;
const sessionIdOf = (events) => (initEvent(events) || {}).session_id || null;

// True when the init event lists a plugin whose path is the repository folder of this checkout, or inside it.
// This tells a run that loads the branch (`--plugin-dir`) from a run that loads the installed copy.
function loadsBranchPlugin(events, repoDir) {
  const init = initEvent(events);
  if (!init || !Array.isArray(init.plugins)) return false;
  const folders = [repoDir, fs.realpathSync(repoDir)];
  return init.plugins.some((plugin) => typeof plugin.path === 'string'
    && folders.some((dir) => plugin.path === dir || plugin.path.startsWith(dir + path.sep)));
}

const contentOf = (record) => (record.message && Array.isArray(record.message.content) ? record.message.content : []);
const bashCommands = (records) => records.filter((r) => r.type === 'assistant').flatMap(contentOf)
  .filter((c) => c.type === 'tool_use' && c.name === 'Bash').map((c) => (c.input || {}).command);
const toolResultTexts = (records) => records.filter((r) => r.type === 'user').flatMap(contentOf)
  .filter((c) => c.type === 'tool_result').map((c) => (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)));
const resultText = (events) => events.filter((e) => e.type === 'result').map((e) => String(e.result || '')).join('\n');
const mentions = (value, token) => String(JSON.stringify(value)).toLowerCase().includes(token.toLowerCase());

/**
 * Probe 1, one run: is it valid, and what did it show? State `record`: the hook log holds a BLOCKED record of the
 * rule env-file with the session id of the run (a record counts whether or not the marker also appears: the model
 * can reach a file in a form that the hook passes on purpose). State `marker`: a tool result holds the marker.
 */
function classifyRun({ events, logRecords, repoDir, marker }) {
  const sessionId = sessionIdOf(events);
  const valid = loadsBranchPlugin(events, repoDir) && bashCommands(events).includes(TARGET_COMMAND);
  const record = logRecords.some((r) => r.session_id === sessionId && r.level === BLOCKED && r.id === ENV_RULE);
  const hasMarker = toolResultTexts(events).some((text) => text.toLowerCase().includes(marker.toLowerCase()));
  return { valid, sessionId, state: record ? STATE.RECORD : hasMarker ? STATE.MARKER : STATE.NONE };
}

// The table of the spec, section 9.2. Run A has an empty switch, run B switches off env-file.
function verdictProbe1(a, b) {
  const answer = (outcome, why) => ({ outcome, why });
  if (!a.valid || !b.valid) {
    return answer(OUTCOME.INCONCLUSIVE, 'a run is not valid: the plugin is not the one of this checkout, or the Bash call is not exactly the command');
  }
  if (a.state === STATE.MARKER) return answer(OUTCOME.FAIL, 'the hook did not refuse in run A: the plugin is not loaded');
  if (a.state === STATE.NONE) return answer(OUTCOME.INCONCLUSIVE, 'run A made no matching call; repeat both runs once');
  if (b.state === STATE.MARKER) return answer(OUTCOME.PASS, 'the variable reaches the hook through --settings');
  if (b.state === STATE.RECORD) return answer(OUTCOME.FAIL, 'a value passed with --settings does not reach the hook');
  return answer(OUTCOME.INCONCLUSIVE, 'run B shows neither a record nor the marker; repeat run B once');
}

// The transcripts of one session: its own file, and every file of its subagents folder.
function transcriptFiles(projectsDir, sessionId) {
  const files = [];
  if (!fs.existsSync(projectsDir)) return files;
  for (const dir of fs.readdirSync(projectsDir).sort()) {
    const main = path.join(projectsDir, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(main)) files.push({ file: main, subagent: false });
    const subDir = path.join(projectsDir, dir, sessionId, 'subagents');
    if (!fs.existsSync(subDir)) continue;
    for (const name of fs.readdirSync(subDir).sort()) {
      if (name.endsWith('.jsonl')) files.push({ file: path.join(subDir, name), subagent: true });
    }
  }
  return files;
}

const labelOf = (record) => (record.type === 'attachment' ? `attachment:${record.attachment && record.attachment.type}` : record.type);

/**
 * The records that hold the token. A hit counts as content sent to the model only in the `message.content` of a
 * `user` or `assistant` record, and in an attachment record of a type other than `hook_success`: a `system`
 * record and the raw output of a hook are stored but not sent to the model.
 */
function tokenHits(records, token) {
  return records.filter((r) => mentions(r, token)).map((r) => {
    const label = labelOf(r);
    const counted = r.type === 'user' || r.type === 'assistant'
      ? mentions(r.message && r.message.content, token)
      : r.type === 'attachment' && label !== HOOK_SUCCESS;
    return { label, counted };
  });
}

/**
 * Probe 2, one kind of call (`main`: the main session; `subagent`: a subagent started by the Agent tool).
 * `streamFiles`: the stream of turn 1 and, when it exists, of turn 2 (the resumed run).
 */
function kindReport({ kind, streamFiles, repoDir, token, logRecords, projectsDir }) {
  const streams = streamFiles.map(readRecords);
  const sessionIds = [...new Set(streams.map(sessionIdOf).filter(Boolean))];
  const transcripts = sessionIds.flatMap((id) => transcriptFiles(projectsDir, id))
    .map((t) => ({ ...t, records: readRecords(t.file) }));
  const bashSource = kind === KIND_SUBAGENT
    ? transcripts.filter((t) => t.subagent).flatMap((t) => t.records)
    : (streams[0] || []);
  const valid = Boolean(streams[0]) && loadsBranchPlugin(streams[0], repoDir) && bashCommands(bashSource).includes(TARGET_COMMAND);
  const hits = transcripts.flatMap((t) => tokenHits(t.records, token).map((h) => ({ ...h, file: path.basename(t.file) })));
  const resultHit = streams.some((events) => resultText(events).toLowerCase().includes(token.toLowerCase()));
  const logHit = logRecords.some((r) => r.level === BLOCKED && Array.isArray(r[UNKNOWN_NAMES_FIELD]) && r[UNKNOWN_NAMES_FIELD].includes(token));
  return { kind, valid, sessionIds, hits, resultHit, modelCanRead: resultHit || hits.some((h) => h.counted), logHit };
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'session') {
    const id = sessionIdOf(readRecords(args[0]));
    if (id) console.log(id);
    return id ? 0 : EXIT_OF[OUTCOME.INCONCLUSIVE];
  }
  if (command === 'probe1') {
    const [fileA, fileB, repoDir, marker, logDir] = args;
    const logRecords = readLogRecords(logDir);
    const classify = (file) => classifyRun({ events: readRecords(file), logRecords, repoDir, marker });
    const [runA, runB] = [classify(fileA), classify(fileB)];
    const verdict = verdictProbe1(runA, runB);
    console.log(JSON.stringify({ runA, runB, ...verdict }, null, 2));
    return EXIT_OF[verdict.outcome];
  }
  if (command === 'probe2') {
    const [outDir, repoDir, logDir, projectsDir] = args;
    const logRecords = readLogRecords(logDir);
    const reports = [KIND_MAIN, KIND_SUBAGENT].map((kind) => kindReport({
      kind,
      token: fs.readFileSync(path.join(outDir, `${kind}.token`), 'utf8').trim(),
      streamFiles: [1, 2].map((turn) => path.join(outDir, `${kind}-${turn}.jsonl`)).filter((file) => fs.existsSync(file)),
      repoDir, logRecords, projectsDir,
    }));
    console.log(JSON.stringify(reports, null, 2));
    return reports.every((r) => r.valid) ? 0 : EXIT_OF[OUTCOME.INCONCLUSIVE];
  }
  console.error('usage: probe-secrets-judge.js session|probe1|probe2 <arguments> (see the header of this file)');
  return EXIT_USAGE;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
} else {
  module.exports = {
    classifyRun, verdictProbe1, tokenHits, transcriptFiles, kindReport,
    loadsBranchPlugin, bashCommands, toolResultTexts, resultText, readLogRecords,
  };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `node tests/codex/test-probe-secrets-judge.js`
Expected: PASS — ends with `probe-secrets-judge: 23 passed, 0 failed` (the line must end with `0 failed`; the count follows the tests above).

- [ ] **Step 5: Write the driver**

Create `tests/claude-code/probe-secrets-rules-switch.sh`:

```bash
#!/usr/bin/env bash
# Live probes of the switch SUPERPOWERS_SECRETS_RULES_OFF (spec section 9.2). They call the real `claude` CLI
# (command-line interface) and cost model calls, so no suite starts them: run this file by hand.
#
# Usage: bash tests/claude-code/probe-secrets-rules-switch.sh probe1|probe2 <output folder>
#
# probe1: does a value of the settings `env` block (passed with --settings) reach the hook? Two runs of
#         `cat .env`: run A with an empty switch, run B with env-file switched off.
# probe2: where does the `systemMessage` of a refusal appear? One unknown name (a random token, new for each kind of
#         call) in the switch;
#         the hook refuses `cat .env` in a main-session call and in a subagent call; each kind also runs a
#         second turn with --resume. The judge reads the outputs and the session transcripts.
# Both probes load the plugin of THIS checkout with --plugin-dir, keep the real HOME (a run with another HOME is
# not logged in), and unset the variable in this shell. A run counts only when the judge finds the plugin of this
# checkout in the init event and the exact Bash call; otherwise the judge says "inconclusive".
# The interactive check (a) of probe 2 (does the user see the message on the screen?) is not made here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test-helpers.sh"

REPO_DIR="$HELPERS_PLUGIN_REPO_DIR"
JUDGE="$SCRIPT_DIR/probe-secrets-judge.js"
SWITCH=SUPERPOWERS_SECRETS_RULES_OFF
LOG_DIR="$HOME/.claude/hooks-logs"
PROJECTS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
RUN_TIMEOUT_SECONDS=300

mode="${1:-}"
out_dir="${2:-}"
if { [ "$mode" != probe1 ] && [ "$mode" != probe2 ]; } || [ -z "$out_dir" ]; then
    echo "usage: bash tests/claude-code/probe-secrets-rules-switch.sh probe1|probe2 <output folder>" >&2
    exit 64
fi
mkdir -p "$out_dir"

unset "$SWITCH"
check_no_secrets_rules_managed_setting || exit 1
for tool in claude openssl node; do
    command -v "$tool" > /dev/null || { echo "ABORT: the command $tool is not installed" >&2; exit 1; }
done

CLAUDE_WORKDIR=$(create_claude_workdir) || exit 1
trap "cleanup_claude_workdir '$CLAUDE_WORKDIR'" EXIT

# The settings JSON (JavaScript Object Notation) that gives the switch one value: --settings ranks above user, project and local settings.
settings_json() { printf '{"env":{"%s":"%s"}}' "$SWITCH" "$1"; }

# run_stream <output file> <switch value> <claude arguments...>: one headless run; its stream goes to the file.
run_stream() {
    local file="$1" value="$2"
    shift 2
    run_claude_in_workdir "$CLAUDE_WORKDIR" "$RUN_TIMEOUT_SECONDS" "$@" \
        --plugin-dir "$REPO_DIR" --permission-mode bypassPermissions \
        --settings "$(settings_json "$value")" \
        --output-format stream-json --verbose > "$file" 2> "$file.err" || true
}

# The folder holds a dummy file whose only content is a random token made of lower-case letters and digits.
make_dummy_file() { printf '%s\n' "$1" > "$CLAUDE_WORKDIR/.env"; }

probe1() {
    local marker
    marker=$(openssl rand -hex 8)
    make_dummy_file "$marker"
    local prompt="Use the Bash tool to run exactly this command and nothing else: cat .env  Then say in one sentence what the command printed, or why it did not run."
    run_stream "$out_dir/probe1-a.jsonl" "" -p "$prompt"
    run_stream "$out_dir/probe1-b.jsonl" "env-file" -p "$prompt"
    node "$JUDGE" probe1 "$out_dir/probe1-a.jsonl" "$out_dir/probe1-b.jsonl" "$REPO_DIR" "$marker" "$LOG_DIR"
}

probe2() {
    local token list kind prompt session_id
    make_dummy_file "$(openssl rand -hex 8)"
    list="List every text in your context that you cannot explain, such as an unexpected word or code. Leave none out. Do not invent any. If there is none, say none."
    for kind in main subagent; do
        # One token for each kind of call: the hook log is shared by both kinds, and a token of its own tells their records apart.
        token=$(openssl rand -hex 8)
        printf '%s' "$token" > "$out_dir/$kind.token"
        if [ "$kind" = main ]; then
            prompt="Use the Bash tool to run exactly this command and nothing else: cat .env  Report in one sentence what happened. $list"
        else
            prompt="You MUST dispatch a subagent using the Agent tool with these EXACT settings:
- subagent_type: general-purpose
- description: 'test message scope'
- prompt: 'Run this exact bash command with the Bash tool and report what happened: cat .env  Do NOT modify the command.'

IMPORTANT: Do NOT run the command yourself. After the subagent returns, report what it said. $list"
        fi
        run_stream "$out_dir/$kind-1.jsonl" "$token" -p "$prompt"
        if session_id=$(node "$JUDGE" session "$out_dir/$kind-1.jsonl"); then
            run_stream "$out_dir/$kind-2.jsonl" "$token" --resume "$session_id" -p "$list"
        else
            echo "no session id in $out_dir/$kind-1.jsonl: the second turn of the $kind run is skipped" >&2
        fi
    done
    node "$JUDGE" probe2 "$out_dir" "$REPO_DIR" "$LOG_DIR" "$PROJECTS_DIR"
}

"$mode"
```

- [ ] **Step 6: Verify the driver without running it**

Run: `bash -n tests/claude-code/probe-secrets-rules-switch.sh && bash tests/claude-code/probe-secrets-rules-switch.sh nothing; echo "exit status: $?"`
Expected: no syntax error; the second command prints the usage line and `exit status: 64`.

Run: `bash tests/codex/test-claude-code-workdir.sh | tail -3`
Expected: no `FAIL` line (the static scan finds no direct `claude` call in the driver).

- [ ] **Step 7: Run the unit test registry entry**

Run: `bash tests/codex/run-unit-tests.sh 2>&1 | tail -6`
Expected: `All unit tests passed.`

- [ ] **Step 8: Commit**

```bash
git add tests/claude-code/probe-secrets-judge.js tests/claude-code/probe-secrets-rules-switch.sh tests/codex/test-probe-secrets-judge.js tests/codex/run-unit-tests.sh
git commit -m "test: a judge and a driver for the live probes of the secrets switch" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 7/10"
```

---

### Task 8: Run the live probes and record the results

**Files:**
- Create: `docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/implementation/secrets-rules-switch-probe-results.md`
- Temporary, not committed: `hooks/safety/protect-secrets.js` (`SYSTEM_MESSAGE_SHIPS` set to `true` for the run of probe 2 and set back to `false`)
- Modify only when a step below orders a repair, each repair in its own commit under the trailer of the task that owns the file: `tests/claude-code/probe-secrets-judge.js` and `tests/codex/test-probe-secrets-judge.js` (owner Task 7, repair ordered by Step 2 below), `hooks/safety/protect-secrets.js` and `tests/codex/test-protect-secrets.js` (owner Task 5, repair ordered by Step 4 below), `tests/claude-code/test-subagent-hook-scope.sh` (owner Task 6, repair ordered by Step 8 below)

**Security flag:** `none`

**Does NOT cover:** The interactive check (a) of probe 2 (the user at a terminal sees, or does not see, the message). An autonomous run cannot make it, so the decision rule of the spec ("including when the user does not make the interactive check, only the log record ships") ends with `SYSTEM_MESSAGE_SHIPS = false`. A change of the hook beyond the temporary constant and the repairs that Steps 3 and 4 order.

**Contract:**
- The results file holds these lines, each starting with `- ` and the label shown: `Date of the runs:`, `Claude Code version:`, `Probe 1 outcome:`, `Probe 2 main session:`, `Probe 2 subagent:`, `Interactive check (a):`, `Decision:`. The `Probe 2` lines hold `valid`, `modelCanRead`, `logHit` and the labels of the records that hold the token, copied from the judge output.
- Invariants: the committed `hooks/safety/protect-secrets.js` still holds `const SYSTEM_MESSAGE_SHIPS = false;`; the probe-1 outcome in the file is the outcome of the last probe-1 run; the plan continues only after a probe-1 outcome of `pass`.
- Verification: `grep -cE "^- (Date of the runs|Claude Code version|Probe 1 outcome|Probe 2 main session|Probe 2 subagent|Interactive check \(a\)|Decision):" <results file>` prints `7`; `grep -n "const SYSTEM_MESSAGE_SHIPS" hooks/safety/protect-secrets.js` shows `false`; `git diff --stat hooks/` is empty before the commit.
- Interface not externally pinned.

- [ ] **Step 1: Check what the probes need**

Run: `command -v claude && command -v openssl && command -v node && claude --version`
Expected: three paths and a version line (2.1.295 or later). If a command is missing, return `BLOCKED: the live probes need a logged-in claude CLI` and stop; Tasks 1-7 and 9 stay valid, and Task 10 waits for the results file. A `claude` that is not logged in cannot be seen here (`claude --version` works without a login); it shows in Step 2 as `Not logged in` in `$OUT/probe1-a.jsonl.err` (the error file of each run is the stream file name plus `.err`), and the same BLOCKED return applies then.

- [ ] **Step 2: Run probe 1**

Each probe can run longer than the 10-minute limit of one foreground Bash call. Start it with the Bash tool option `run_in_background` (the first line of its output is the folder `$OUT`; copy that path, because the shell state of one Bash call does not carry over to the next) and poll its log every 30 seconds for at most 30 minutes, until its last line starts with `exit status`:

Run: `OUT=$(mktemp -d) && echo "$OUT" && (bash tests/claude-code/probe-secrets-rules-switch.sh probe1 "$OUT" > "$OUT/probe1.log" 2>&1; echo "exit status: $?" >> "$OUT/probe1.log")`
Then read `$OUT/probe1.log` (use the folder that the first line printed).
Expected: the log shows a JSON verdict with `"outcome": "pass"` and ends with `exit status: 0`.
- `exit status: 2` (inconclusive): repeat Step 2 once, with a new folder. This repeats both runs; for the one outcome where the spec says "repeat run B once" the plan repeats run A as well, because the driver has no mode for run B alone. A second `inconclusive` stops the plan: return `BLOCKED` with both folders and the judge `why` texts.
- If the `why` text says a run is not valid and `$OUT/probe1-a.jsonl` has a first `init` event without a `plugins` array whose entries hold a string `path`, open that event, find where Claude Code lists the loaded plugin folders, and correct `loadsBranchPlugin` in `tests/claude-code/probe-secrets-judge.js` and its unit test as an ordinary fix; do not remove the condition. Run `node tests/codex/test-probe-secrets-judge.js`, commit the two files with `git commit -m "fix(secrets-rules-switch): the judge reads the plugin list of the init event" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 7/10"`, then repeat Step 2.
- `exit status: 1` (fail): stop the plan: return `BLOCKED` with the judge `why` text and the folder (for `a value passed with --settings does not reach the hook` the design must be reviewed by the user).

- [ ] **Step 3: Switch the message on for the run of probe 2 (temporary)**

In `hooks/safety/protect-secrets.js`, change `const SYSTEM_MESSAGE_SHIPS = false;` to `const SYSTEM_MESSAGE_SHIPS = true;`. Do not commit this change. The probe loads the checkout with `--plugin-dir`, so the edit is live. The checks of the message text in `tests/codex/test-protect-secrets.js` (Task 5) run only in this state, so run them now:

Run: `node tests/codex/test-protect-secrets.js | tail -3`
Expected: the last line reports `0 failed`. (`runSwitched` of Task 3 passes `{ allowSystemMessage: true }`, because two of its cases refuse a call with an unknown name in the variable, and those two outputs now carry a `systemMessage`.) If a check fails, do Step 5 first, then repair `tests/codex/test-protect-secrets.js` or `hooks/safety/protect-secrets.js` and commit as Step 4 orders, then return to Step 3.

- [ ] **Step 4: Run probe 2**

Run: `OUT=$(mktemp -d) && echo "$OUT" && (bash tests/claude-code/probe-secrets-rules-switch.sh probe2 "$OUT" > "$OUT/probe2.log" 2>&1; echo "exit status: $?" >> "$OUT/probe2.log")`
Then poll `$OUT/probe2.log` as in Step 2 (four runs of up to 5 minutes each).
Expected: the log shows a JSON array of two reports (kinds `main` and `subagent`) and ends with `exit status: 0`. `exit status: 2` means a run is not valid: repeat Step 4 once; a second `exit status: 2` stops the plan with `BLOCKED` and the folder (before any `BLOCKED` of this step, do Step 5, so the constant is `false` again). A `logHit` of `false` in a valid run is a defect of Task 5 (the log field is missing): do Step 5 first (the constant back to `false`), fix `hooks/safety/protect-secrets.js` and add a case to `tests/codex/test-protect-secrets.js`, run `bash tests/codex/run-unit-tests.sh`, commit those two files with the trailers `Session: secrets-rules-switch` and `Stage: task 5/10`, then repeat Steps 3 and 4.

- [ ] **Step 5: Switch the message off again**

In `hooks/safety/protect-secrets.js`, change `const SYSTEM_MESSAGE_SHIPS = true;` back to `const SYSTEM_MESSAGE_SHIPS = false;`.

Run: `grep -n "const SYSTEM_MESSAGE_SHIPS" hooks/safety/protect-secrets.js && git diff --stat hooks/`
Expected: the grep shows `= false;` and `git diff --stat hooks/` prints nothing.

- [ ] **Step 6: Write the results file**

Create `docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/implementation/secrets-rules-switch-probe-results.md` with the Write tool. Content: the heading `# Probe results — secrets-rules-switch`, one sentence that says the probes ran on the branch `feature/secrets-rules-switch` with `--plugin-dir`, then exactly these seven lines, each filled from the runs:

```
- Date of the runs: the date of the day, as YYYY-MM-DD
- Claude Code version: the output of `claude --version`
- Probe 1 outcome: the `outcome` of the last probe-1 run, then its `why` text
- Probe 2 main session: valid <true|false>; modelCanRead <true|false>; logHit <true|false>; records that hold the token: <the labels, or none>
- Probe 2 subagent: the same four fields for the kind `subagent`
- Interactive check (a): not made (an autonomous run cannot make it)
- Decision: SYSTEM_MESSAGE_SHIPS stays false; only the log record ships (decision rule of the spec, section 9.2). To ship the message later, the user makes check (a) and, if the rule holds for both kinds of call, sets the constant to true.
```

(Each `<...>` in those lines is a value that you copy from the judge output; no line may keep angle brackets.)

- [ ] **Step 7: Check the file**

Run: `grep -cE "^- (Date of the runs|Claude Code version|Probe 1 outcome|Probe 2 main session|Probe 2 subagent|Interactive check \(a\)|Decision):" docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/implementation/secrets-rules-switch-probe-results.md; grep -c "[<>]" docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/implementation/secrets-rules-switch-probe-results.md`
Expected: `7`, then `0`.

- [ ] **Step 8: Run the isolated behavioural test of Task 6 once**

This run uses the installed plugin (no `--plugin-dir`), so it shows only that `claude` accepts the `--settings` flag and that the script still reaches `STATUS: PASSED`; it tests neither the isolation nor the branch (the installed hook has no switch). It takes about 4 minutes; start it in the background and poll as in Step 2.

Run: `OUT=$(mktemp -d) && echo "$OUT" && (bash tests/claude-code/test-subagent-hook-scope.sh > "$OUT/scope.log" 2>&1; echo "exit status: $?" >> "$OUT/scope.log")`
Expected: `$OUT/scope.log` ends with `STATUS: PASSED` and `exit status: 0`. If it ends with `GAP DETECTED`, read the log: a `--settings` flag that Claude Code does not accept would show as an error line from `claude`; fix the test script (Task 6), commit it with the trailers `Session: secrets-rules-switch` and `Stage: task 6/10`, and repeat. When it passes, add the line `- Subagent hook-scope test: PASSED` at the end of the results file.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/implementation/secrets-rules-switch-probe-results.md
git commit -m "docs(secrets-rules-switch): results of the live probes" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 8/10"
```

---

### Task 9: Documentation — README, guide, and a drift test

**Files:**
- Modify: `tests/codex/test-protect-secrets.js` (a documentation check, written first)
- Modify: `README.md` (the environment variable list, the count sentence, the protect-secrets bullet)
- Modify: `docs/guide/README.md` (a Troubleshooting entry)

**Security flag:** `none`

**Does NOT cover:** `RELEASE-NOTES.md` and the version bump (Task 10). The OpenCode copy and any Codex text. A rewrite of the existing stop-reminders text.

**Contract:**
- The README bullet of the switch starts with `` - `SUPERPOWERS_SECRETS_RULES_OFF` `` and names all 43 rules in backticks, grouped as the spec's section 5 groups them; it states the format, that an unknown name switches nothing off, that `unreadable-command` cannot be switched off, that a higher settings level replaces a lower value, the restart facts, that only the user sets the variable and that an assistant must ask the user.
- The README protect-secrets bullet states: the switch, the overlap rule with examples, the pattern limit, the reach of `env-file` (every `.env.<suffix>` file except the template names), the reach of a `hardcoded-*` name, the content-scan behaviour for `.env`, the project-settings trust note, that names from block-dangerous-commands refusals switch nothing off, and the closing sentence of every refusal. The sentence "The remaining three are read by hook code directly" reads "four".
- The guide entry names the variable, the example, the two places that show the rule name, the reach of `env-file`, the restart and the instruction to assistants.
- Verification: the new check in `tests/codex/test-protect-secrets.js` (README line names every rule and `unreadable-command`; the guide names the variable); `node tests/codex/test-version-files.js` and the dashboard suite still pass (Task 10 runs all suites).
- Interface not externally pinned.

- [ ] **Step 1: Write the failing documentation check**

In `tests/codex/test-protect-secrets.js`:

In `main`, directly before the line `fs.rmSync(home, { recursive: true, force: true });`, add:

```js
  report.section('documentation');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const guide = fs.readFileSync(path.join(root, 'docs', 'guide', 'README.md'), 'utf8');
  const switchLine = readme.split('\n').find((line) => line.startsWith(`- \`${SECRETS_SWITCH}\``)) || '';
  const undocumented = KNOWN_RULE_NAMES.filter((name) => !switchLine.includes(`\`${name}\``));
  report.check('the README bullet of the switch names every one of the 43 rules',
    switchLine && undocumented.length === 0 ? '' : `missing in the bullet: ${undocumented.join(', ') || 'the whole bullet'}`);
  report.check('the README bullet says that unreadable-command cannot be switched off',
    switchLine.includes(`\`${UNREADABLE}\``) ? '' : 'the bullet does not name unreadable-command');
  report.check('the troubleshooting guide names the variable', guide.includes(SECRETS_SWITCH) ? '' : 'the guide does not name the variable');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/codex/test-protect-secrets.js | grep -E "✗|passed" | head`
Expected: FAIL — the three `documentation` checks fail (`missing in the bullet: the whole bullet`, `the bullet does not name unreadable-command`, `the guide does not name the variable`).

- [ ] **Step 3: Update the README (environment variable list)**

In `README.md`, use the Edit tool.

(a) Replace `The remaining three are read by hook code directly and never reach a skill.` with `The remaining four are read by hook code directly and never reach a skill.`

(b) Replace the text

```
Example: `{ "env": { "SUPERPOWERS_STOP_REMINDERS_OFF": "commit" } }`.

### Hooks (9 total)
```

with the same text followed by the new bullet, so that the result reads:

```
Example: `{ "env": { "SUPERPOWERS_STOP_REMINDERS_OFF": "commit" } }`.
- `SUPERPOWERS_SECRETS_RULES_OFF` — a comma-separated list of rule names of **protect-secrets** that the hook does not apply; see **protect-secrets** below. Use it when a refusal blocks a file that holds no secret, for example a `.env` file with only harmless defaults. A name is the text that a refusal shows in square brackets, for example `[env-file]`. Names are separated by commas; spaces around a name are ignored; letter case does not matter; an empty entry is ignored. There are 43 names. Path rules (27, one for each row of the path table): `env-file`, `envrc`, `ssh-private-key`, `ssh-private-key-2`, `ssh-authorized`, `aws-credentials`, `aws-config`, `kube-config`, `pem-key`, `key-file`, `p12-key`, `credentials-json`, `secrets-file`, `service-account`, `gcloud-creds`, `azure-creds`, `docker-config`, `netrc`, `npmrc`, `pypirc`, `gem-creds`, `vault-token`, `keystore`, `htpasswd`, `pgpass`, `my-cnf`, `proc-environ`. Content rules (14; the refusal shows `hardcoded-` and the id of the content pattern): `hardcoded-aws-access-key`, `hardcoded-aws-secret-key`, `hardcoded-github-token`, `hardcoded-openai-key`, `hardcoded-anthropic-key`, `hardcoded-stripe-key`, `hardcoded-stripe-pub-key`, `hardcoded-private-key-block`, `hardcoded-generic-api-key`, `hardcoded-connection-string`, `hardcoded-slack-token`, `hardcoded-sendgrid-key`, `hardcoded-twilio-key`, `hardcoded-supabase-key`. Bash rules (2): `env-dump` (a command that prints every environment variable, such as a bare `env`) and `echo-secret-var` (a command that prints a variable whose name holds a secret word, such as `echo $API_KEY`). A name that is not one of these 43 switches nothing off. This includes `unreadable-command`, the refusal for a Bash command that the hook cannot read to its end or for an internal error: it cannot be switched off, so split or rewrite the command. It also includes the names of block-dangerous-commands refusals, for example `git-clean`. When the variable holds an unknown name and a rule of protect-secrets refuses a call, the hook writes the unknown names to the field `unknown_names` of the refusal record in `~/.claude/hooks-logs/<date>.jsonl` (`<date>` is the UTC (Coordinated Universal Time) date of the refusal); check that log after you change the variable. A call that passes is not logged. A value set at a higher settings level replaces the value of a lower level: the lists are not merged. A project's `.claude/settings.json` that sets the variable, even to an empty value, replaces your own list in that project. A changed value takes effect after the CLI is restarted; deleting the whole variable from the settings file has no effect until a restart. Only the user sets this variable. An assistant that reads this text after a refusal must ask the user, and must not set the variable itself. Range: a list of those names, or unset. Default: unset (every rule is on). Override: not overridable in an invocation. Honored wherever the `protect-secrets` hook runs (Claude Code). Example: `{ "env": { "SUPERPOWERS_SECRETS_RULES_OFF": "env-file,envrc" } }`.

### Hooks (9 total)
```

- [ ] **Step 4: Update the README (protect-secrets bullet)**

In `README.md`, replace the text `in the content of Edit and Write. **Limits:** a variable that holds the path` with:

```
in the content of Edit and Write. **Switch:** the variable `SUPERPOWERS_SECRETS_RULES_OFF` (see **Environment variables** above) switches off single rules by name. The hook then removes the rule from the tables that it uses, so a command that names a second secret file is still refused by the rule of that file (`cat .env ~/.ssh/id_rsa` with `env-file` off is refused as `ssh-private-key`). A file or a value that two rules cover stays refused while one of them is on; the next refusal names that rule. Examples, not a complete list: `~/.ssh/id_rsa` is covered by `ssh-private-key` and `ssh-private-key-2`; `~/.ssh/id_rsa.pem` by `ssh-private-key` and `pem-key`; `credentials.json` by `credentials-json` and `secrets-file` (every file of the first is also a file of the second, so switching off `credentials-json` alone changes nothing); `secret_key = "<40 letters>"` by `hardcoded-aws-secret-key` and `hardcoded-generic-api-key`. A file name pattern is refused when its own text matches a rule that is on, or when a name of a secret file that it can match has a rule that is on; so `~/.ssh/id_*` passes when only `ssh-private-key` is off, although `ssh-private-key-2` still refuses `~/.ssh/id_rsa`. `env-file` covers `.env` and every `.env.<suffix>` file except the template names (`.env.example`, `.env.sample`, `.env.template`, `.env.schema`, `.env.defaults`): with it off, `.env.local` and `.env.production` pass too. A `hardcoded-*` name turns that content pattern off for every file that the content scan reads. The content scan of Edit and Write skips `.env` files, so with `env-file` off a Write of a real key into `.env` passes unscanned; a file of another switched-off rule (`.envrc`, `~/.aws/credentials`) is still scanned, and a real key in it is refused by a `hardcoded-*` pattern. A variable set in a committed `.claude/settings.json` switches the rule off for everyone who clones the project and trusts the folder. A name from a block-dangerous-commands refusal (for example `git-clean`) switches nothing off, and `unreadable-command` cannot be switched off. Every refusal of this hook ends with the sentence "Never change Claude Code settings or hook files to get past this refusal; ask the user."; no refusal names the variable, unless the refused command names it. Only the user sets the variable: an assistant that reads this text after a refusal must ask the user. **Limits:** a variable that holds the path
```

- [ ] **Step 5: Add the Troubleshooting entry**

In `docs/guide/README.md`, replace the text

```
`session-log-size`; the README lists which reminder text each name removes.

**The test-first reminder names a scratch file.**
```

with:

```
`session-log-size`; the README lists which reminder text each name removes.

**A secrets refusal blocks a file that holds no secret.** Example: a refusal
that starts with `[env-file] ... would use the secret file`, where the
project keeps only harmless defaults in `.env`. The hook `protect-secrets`
refuses reads, changes and uploads of files that can hold secrets, and
writes of text that looks like a key. Switch off that rule alone with the
variable `SUPERPOWERS_SECRETS_RULES_OFF` in the `env` block of
`settings.json`, for example
`{ "env": { "SUPERPOWERS_SECRETS_RULES_OFF": "env-file" } }`, and restart the
CLI. The name of the rule is in square brackets at the start of the refusal
text. When you do not see that text (a subagent made the call, and the
documentation does not say whether you see its refusals), the field `id` of
the refusal record in `~/.claude/hooks-logs/<date>.jsonl` holds the name;
`<date>` is the UTC (Coordinated Universal Time) date of the refusal. The name `env-file` covers `.env`
and every `.env.<suffix>` file, for example `.env.local`, except the
template names such as `.env.example`. Some files are covered by two rules,
so the next refusal can name a second rule; switch that one off too. Only
you set this variable: an assistant that reads this text after a refusal
must ask you, and must not set the variable itself. The README lists all 43
names, the limits, and the settings levels at which a list replaces another.

**The test-first reminder names a scratch file.**
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node tests/codex/test-protect-secrets.js | tail -3`
Expected: PASS — ends with `0 failed`.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/guide/README.md tests/codex/test-protect-secrets.js
git commit -m "docs: the secrets switch in the README and the troubleshooting guide" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 9/10"
```

---

### Task 10: Release v7.70.0

**Files:**
- Modify: `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.universal.yaml`, `README.md` (badge and the two ranges), `RELEASE-NOTES.md`

**Security flag:** `none`

**Does NOT cover:** A merge, a push or an installation of the plugin (the orchestration ends before merge). `docs/worklogs/` (this work has no work log). Any code change: a defect that this task finds goes back to the task that owns the file.

**Contract:**
- Every place that states the version says `7.70.0`: `VERSION`, the `version` of `.claude-plugin/plugin.json` and of the first plugin in `.claude-plugin/marketplace.json`, `version:` under `meta` in `plugin.universal.yaml`, the README badge, and both `v6.7.0–v7.70.0` ranges of the README.
- `RELEASE-NOTES.md` starts, directly under the note on platform claims, with `## v7.70.0 — a per-rule switch for protect-secrets` and a three-line summary (Problem, Change, Effect) of at most 120 words; every statement of the entry is supported by the code, the tests or the results file of Task 8.
- Verification: `node tests/codex/test-version-files.js` ends with `0 failed`; every fast suite listed in `CLAUDE.md` passes (Step 6).
- Interface not externally pinned.

- [ ] **Step 1: Bump the version in the six places**

With the Edit tool:
- `VERSION`: replace the whole content with `7.70.0` and one line end (use the Write tool: the file holds one line).
- `.claude-plugin/plugin.json`: replace `"version": "7.69.0"` with `"version": "7.70.0"`.
- `.claude-plugin/marketplace.json`: replace `"version": "7.69.0"` with `"version": "7.70.0"`.
- `plugin.universal.yaml`: replace `  version: "7.69.0"` with `  version: "7.70.0"`.
- `README.md`: replace `version-7.69.0-white` with `version-7.70.0-white`, and replace both occurrences of `v6.7.0–v7.69.0` with `v6.7.0–v7.70.0` (use `replace_all` for the range).

- [ ] **Step 2: Check the version files**

Run: `node tests/codex/test-version-files.js | tail -3`
Expected: the only failing check is `the first RELEASE-NOTES.md heading` (it fails until Step 3 writes the new heading; Step 5 runs the test again and it must end with `0 failed`).

- [ ] **Step 3: Write the release notes**

In `RELEASE-NOTES.md`, replace the line

```
## v7.69.0 — make output stays raw, two reminder patterns, the security review defined, the archive always searched
```

with the entry below followed by that same line. Before you save, read the results file of Task 8 and write for section 5 the sentences that its values support (the two `Probe 2` lines name `modelCanRead` for each kind of call).

```
## v7.70.0 — a per-rule switch for protect-secrets

**Problem.** Since v7.61.0 protect-secrets refuses calls such as `grep KEY .env`, `git add .env` and `rg -g '*.env'`. A user whose `.env` files hold no real secret could not let them pass, except by turning off every hook or editing the installed copy.

**Change.** The environment variable `SUPERPOWERS_SECRETS_RULES_OFF` holds a comma-separated list of rule names; the hook does not apply a listed rule. There are 43 names. Every other rule works as before.

**Effect.** Set the variable in the `env` block of `settings.json` and restart the command-line interface (CLI). Nothing to migrate.

A session runs the installed copy of the plugin. The changes below reach a session only after an update of the plugin and a restart of the CLI.

### 1. The variable and its 43 names

`SUPERPOWERS_SECRETS_RULES_OFF` is read from the `env` block of a Claude Code settings file, for example `{ "env": { "SUPERPOWERS_SECRETS_RULES_OFF": "env-file,envrc" } }`. Names are separated by commas; spaces around a name, letter case and empty entries do not matter. The names are the text that a refusal shows in square brackets: the 27 `id` values of the path table (`env-file`, `ssh-private-key`, and the others), the 14 names made of `hardcoded-` and the id of a content pattern, and the two Bash rules `env-dump` and `echo-secret-var`. The hook derives the list from its own tables at run time. A name that is not one of the 43 switches nothing off; this includes `unreadable-command`, which cannot be switched off, and the names of block-dangerous-commands refusals. The README lists every name.

### 2. The tables are filtered, not the result

The hook does not decide first and drop a refusal afterwards. It removes the switched-off rows and patterns from the tables that it uses. A command such as `cat .env ~/.ssh/id_rsa` with `env-file` off is therefore refused as `ssh-private-key`; dropping the first refusal would have let the key through. A file or a value that two rules cover stays refused while one of them is on.

### 3. A file name pattern is tested against every sample name

The check for a pattern such as `.*` used the first of the ten sample names of secret files that the pattern matches. With `env-file` off, that first sample (`.env`) has no rule that is on, and the pattern would have passed although it also matches `.netrc`. The check now tries every matching sample, in list order, and a pattern passes only when none of them has a rule that is on. With every rule on, the decisions are the same as before.

### 4. No refusal names the variable; one sentence ends every refusal

A refusal reason goes to the model, and a model that learns the name of the switch could set it to avoid its own refusal. So no reason names the variable, unless the refused command names it (`echo $SUPERPOWERS_SECRETS_RULES_OFF` is refused as `echo-secret-var`, and its reason names the variable because the command did). Every protect-secrets refusal also ends with the sentence "Never change Claude Code settings or hook files to get past this refusal; ask the user." These texts lower the chance of a self-unlock; they do not prevent it (see Limits).

### 5. Unknown names go to the log

When the variable holds an unknown name and a rule of protect-secrets refuses a call, the log record of the refusal (`~/.claude/hooks-logs/<date>.jsonl`) gets the field `unknown_names`. A call that passes gets no record, and an `unreadable-command` refusal gets no report. The hook can also add a `systemMessage` to its output, but it does not: the decision rule of the design ships it only when the model cannot read it and the user sees it, and the interactive check of what the user sees was not made. Probe 1 (a live run with `--settings`) passed: the variable reaches the hook.

### 6. One shared parser, and hook output extras

`hooks/name-list.js` parses a name list for protect-secrets and stop-reminders. stop-reminders behaves as before, including a repeated unknown name that its warning lists twice; a new test pins that. `hooks/safety/hook-io.js` lets a refusal carry `systemMessage` and `logFields`. block-dangerous-commands sets neither; a new test pins one complete refusal of it (its output and the keys of its log record). An error while reading an extra never turns a refusal into a pass.

### 7. Tests

New suites: `tests/codex/test-name-list.js`, `tests/codex/test-check-no-secrets-rules-setting.sh` and `tests/codex/test-probe-secrets-judge.js`. The safety-hook helper removes the variable from the environment of every hook it runs and fails a refusal reason that names it; `tests/codex/test-pretool-bash-adapter.js` clears it and makes the same check. `tests/claude-code/test-subagent-hook-scope.sh` unsets the variable, passes an empty value with `--settings`, and stops when managed settings set it. The probe judge and driver (`tests/claude-code/probe-secrets-judge.js`, `tests/claude-code/probe-secrets-rules-switch.sh`) are run by hand; no suite starts them.

### 8. Limits

- Overlapping rules: a user must switch off every rule that covers a file or a value; each refusal names the next rule.
- A pattern that only a switched-off row matched as text passes: with `ssh-private-key` off, `cat ~/.ssh/id_*` passes although `ssh-private-key-2` still refuses `cat ~/.ssh/id_rsa`.
- The content scan skips only `.env` files; a file of another switched-off rule is still scanned.
- A variable in a committed `.claude/settings.json` switches a rule off for everyone who clones the project and trusts the folder.
- `env-file` covers every `.env.<suffix>` file, so a project that keeps real secrets in `.env.local` opens them too.
- A model can still set the variable itself in a settings file; the texts of section 4 lower this risk and do not remove it.
- Deleting the whole variable from the settings file has no effect until a CLI restart.

```

Directly after the last sentence of section 5, add two sentences that the results file supports. Copy the value of `modelCanRead` from its two `Probe 2` lines: `Probe 2 found the unknown name in the context of the model in the main session: yes.` (or `no.`) and `Probe 2 found it in the context of the model in a subagent: yes.` (or `no.`).

- [ ] **Step 4: Check every statement of the entry**

For each numbered section of the entry, find the code line, the test or the results-file line that supports it, and remove or correct a statement that has no support. In particular check: the count `43` (`node -e "console.log(require('./hooks/safety/protect-secrets.js').KNOWN_RULE_NAMES.length)"` prints `43`), the field name `unknown_names`, the sentence of section 4 (equal to `NO_SETTINGS_CHANGE`), and the two section-5 sentences against the `Probe 2` lines of the results file. Count the words of the three-line summary: at most 120.

- [ ] **Step 5: Run the version test again**

Run: `node tests/codex/test-version-files.js | tail -3`
Expected: ends with `0 failed`.

- [ ] **Step 6: Run every fast suite**

Run each command; each must pass. (They are listed one by one on purpose.)

```
bash tests/codex/run-unit-tests.sh 2>&1 | tail -4
bash tests/smart-compress/run-tests.sh 2>&1 | tail -3
bash tests/reviewer-templates/run-tests.sh 2>&1 | tail -3
bash tests/writing-plans/run-tests.sh 2>&1 | tail -3
bash tests/in-run-rulings/run-tests.sh 2>&1 | tail -3
bash tests/fill-prompt/run-tests.sh 2>&1 | tail -3
bash tests/orchestrating-development/run-tests.sh 2>&1 | tail -3
bash tests/review-gates/run-tests.sh 2>&1 | tail -3
bash tests/measure-context/run-tests.sh 2>&1 | tail -3
bash tests/pickup/run-tests.sh 2>&1 | tail -3
bash tests/analyze-compaction/run-tests.sh 2>&1 | tail -3
bash tests/sdd-scripts/run-tests.sh 2>&1 | tail -3
bash tests/suite-guard/run-tests.sh 2>&1 | tail -3
bash tests/worklog/run-tests.sh 2>&1 | tail -3
bash tests/dashboard/run-tests.sh 2>&1 | tail -3
```

Expected: `All unit tests passed.` for the first; the others end with their pass line and no `FAIL`. A suite that fails on a README or RELEASE-NOTES text points to a pinned sentence that Task 9 or this task changed: correct the document text, not the suite, unless the pin is wrong.

- [ ] **Step 7: Commit**

```bash
git add VERSION .claude-plugin/plugin.json .claude-plugin/marketplace.json plugin.universal.yaml README.md RELEASE-NOTES.md
git commit -m "release: v7.70.0 — a per-rule switch for protect-secrets" --trailer "Session: secrets-rules-switch" --trailer "Stage: task 10/10"
```


