# A per-rule switch for protect-secrets — design

Status: approved in brainstorming on 2026-10-09.

## 1. Summary

`hooks/safety/protect-secrets.js` is a PreToolUse hook: Claude Code runs it
before every Read, Edit, Write, Grep and Bash tool call, and the hook can
refuse the call. Every refusal reason starts with the name of the rule that
refused, in square brackets, for example `[env-file]`. Today no rule can be
turned off: the hook reads no setting, and Claude Code cannot turn off one
hook of a plugin. The hooks page says: "There is no way to disable an
individual hook while keeping it in the configuration"; its setting
`disableAllHooks` turns off every hook.

This design adds an environment variable, `SUPERPOWERS_SECRETS_RULES_OFF`. It
holds a comma-separated list of rule names. The hook does not apply a rule
whose name is in the list. Every other rule works as before. The model is
the existing switch `SUPERPOWERS_STOP_REMINDERS_OFF` of
`hooks/stop-reminders.js`.

## 2. Problem

A colleague who uses plugin version 7.63.0 reported that protect-secrets
refuses calls on `.env` files and on `*.env` file name patterns. Since
v7.61.0 the hook checks the Grep tool, every Bash redirect, every word of
every Bash program that has no named exemption, and every file name pattern
that can match a secret file name. Calls such as `grep KEY .env`,
`git add .env`, `rg -g '*.env'` and the Grep tool with the glob `*.env` passed
up to v7.60.0 and are refused since v7.61.0. A user whose `.env` files hold no
real secrets has no way to let these calls through, except turning off every
hook, disabling the plugin, or editing the installed copy.

## 3. Scope and non-goals

In scope:

- The variable, its parsing, and its effect on every rule of protect-secrets
  that has a stable name (section 5).
- A report of unknown names to the user (section 7).
- One helper module that parses a name list, shared by protect-secrets and
  stop-reminders (section 6.4).
- Tests, documentation and a release (sections 9 and 10).

Non-goals:

- **A path allow-list.** A list of exact paths that may pass would be finer
  than a rule switch. The user asked for a rule switch; an allow-list is a
  separate feature.
- **Switching off `unreadable-command`.** This is the refusal for a Bash
  command that the shared reader cannot read to its end, or for an internal
  error. It is the fail-closed refusal (a refusal that happens when the hook
  cannot decide), and block-dangerous-commands emits it too.
- **block-dangerous-commands.** It gets no switch and its behaviour does not
  change.
- **The OpenCode copy** in `.opencode/plugins/superpowers-orchestrator.js`.
  It holds an older copy of the rule tables with other rule names; the README
  already says that it does not have the changes since v7.61.0.
- **Codex.** `hooks/codex/pretool-bash-adapter.js` calls
  `checkBashCommand`, so it gets the switch without a change. Codex is not a
  supported platform; this is not tested.
- **A record for an allowed call.** The hook logs refusals only. A call that
  passes because of the switch is not logged.

No decision in this design matched the prior-art trigger predicate.

The predicate is brainstorming's test for a decision that needs external
research first: a new dependency, behaviour of an external interface that
changes between its versions, or a hosted service.

## 4. Interface

- **Name:** `SUPERPOWERS_SECRETS_RULES_OFF`.
- **Where the user sets it:** the `env` block of a Claude Code settings file,
  for example `~/.claude/settings.json`:

  ```json
  { "env": { "SUPERPOWERS_SECRETS_RULES_OFF": "env-file,envrc" } }
  ```

- **Format:** names separated by commas. Spaces around a name are ignored.
  Letter case does not matter. An empty entry (for example from `a,,b`) is
  ignored. A name that appears twice has the same effect as once, and the
  report of section 7.2 lists each unknown name once.
- **Unknown name:** a name that is not one of the 43 known names in section 5
  switches nothing off. It is reported as described in section 7. Names from
  block-dangerous-commands refusals (for example `[git-clean]`) are unknown
  names too. They are reported only when protect-secrets refuses a call.
- **When a change takes effect:** the hook reads the variable on every call
  (section 6.1). Claude Code documents that a new or changed value of the
  `env` block reaches a running session when the file is saved, and that a
  variable deleted from the file stays set in a running session (env-vars
  page, "In settings files"; not verified live). The user-facing text keeps
  the README's existing instruction, "a changed value takes effect after the
  CLI is restarted", because a restart is correct in every case. It adds
  that deleting the whole variable from the file has no effect until a
  restart.

## 5. Known names

The known names are derived from the hook's own tables at run time, never
written out a second time in code. There are 43:

- **27 rows of the path table** (`SENSITIVE_FILES`), by their `id`:
  `env-file`, `envrc`, `ssh-private-key`, `ssh-private-key-2`,
  `ssh-authorized`, `aws-credentials`, `aws-config`, `kube-config`,
  `pem-key`, `key-file`, `p12-key`, `credentials-json`, `secrets-file`,
  `service-account`, `gcloud-creds`, `azure-creds`, `docker-config`,
  `netrc`, `npmrc`, `pypirc`, `gem-creds`, `vault-token`, `keystore`,
  `htpasswd`, `pgpass`, `my-cnf`, `proc-environ`.
- **14 content patterns** (`HARDCODED_SECRET_PATTERNS`), by the name that a
  refusal shows, which is `hardcoded-` followed by the pattern's `id`:
  `hardcoded-aws-access-key`, `hardcoded-aws-secret-key`,
  `hardcoded-github-token`, `hardcoded-openai-key`,
  `hardcoded-anthropic-key`, `hardcoded-stripe-key`,
  `hardcoded-stripe-pub-key`, `hardcoded-private-key-block`,
  `hardcoded-generic-api-key`, `hardcoded-connection-string`,
  `hardcoded-slack-token`, `hardcoded-sendgrid-key`,
  `hardcoded-twilio-key`, `hardcoded-supabase-key`.
- **2 Bash rules:** `env-dump` (a command that prints every environment
  variable, such as a bare `env`) and `echo-secret-var` (a command that prints
  a variable whose name holds a secret word, such as `echo $API_KEY`). These
  two names are inline string literals today; they become named constants,
  used both by the rule and by the list of known names.

The name a user writes is the same text that a refusal shows in square
brackets. A user copies it from the refusal.

## 6. Architecture and data flow

### 6.1 Filter the tables, not the result

The hook reads the variable each time it decides (not once when the module is
loaded, so that a test can set the variable after `require`). It builds the
set of switched-off names, then decides with:

- the path table without the switched-off rows;
- the content patterns without the switched-off patterns;
- the `env-dump` check skipped when `env-dump` is off;
- the `echo-secret-var` check skipped when `echo-secret-var` is off.

Every path decision of every tool goes through `secretRow`: the file of
Read, Edit and Write, the `path` and the `glob` of Grep, every Bash redirect
target and every Bash word (through `secretRowOfWord` and
`secretRowOfPattern`). `secretRow` uses the table without the switched-off
rows. This one change covers every tool.

**Rejected alternative: filter the result.** The hook would decide as today
and drop a refusal whose name is off. This leaks. In one Bash command the
first refusal wins. With `env-file` off, `cat .env ~/.ssh/id_rsa` would report
only `env-file`, the refusal would be dropped, and the command would read the
SSH private key. Filtering the tables makes the hook find the
`ssh-private-key` refusal instead.

### 6.2 Overlapping rules

`secretRow` returns the first row whose expression matches. Some files match
two or three rows. Examples:

- `~/.ssh/id_rsa`: `ssh-private-key` and `ssh-private-key-2`;
- `~/.ssh/id_rsa.pem`: `ssh-private-key` and `pem-key`;
- `credentials.json`: `credentials-json` and `secrets-file`; every file of
  `credentials-json` is also a file of `secrets-file`, so switching off
  `credentials-json` alone changes no decision;
- `~/.azure/credentials.json`: `credentials-json`, `secrets-file` and
  `azure-creds`.

The content patterns overlap too: `secret_key = "<40 letters>"` matches
`hardcoded-aws-secret-key` and `hardcoded-generic-api-key`.

This is the intended behaviour: a literal file path or a value stays refused
while any rule that is still on covers it. The next refusal names that rule,
so a user can switch it off too. The README states this rule and gives the
examples above as examples, not as a complete list.

The rule does not hold for every file name pattern. A pattern is refused
when its own text matches a row, or when a sample name of section 6.3
matches it. `~/.ssh/id_*` is refused today only because its text matches
`ssh-private-key`. With that row off, the pattern passes: `ssh-private-key-2`
matches only the exact names (`id_rsa` and three others), and no sample
name starts with `id_`. Adding those names to the samples would also refuse
patterns such as `id_*` in any folder, a new refusal for every user, so this
design does not do it. The README states this limit (section 11).

### 6.3 File name patterns

`secretRowOfPattern` tests a pattern such as `*.env` against a list of sample
secret file names (`HIDDEN_SAMPLE_NAMES`: `.env`, `.env.local`, `.envrc`,
`.netrc`, `.npmrc`, `.pypirc`, `.pgpass`, `.vault-token`, `.htpasswd`,
`.my.cnf`). Today it tests only the first sample that the pattern matches.
With every row on, the first matching sample always has a row, so this is
correct today. With a row off it is not: with `env-file` off, the pattern `.*`
matches `.env` first, `.env` has no row that is on, and the pattern would pass
although it also covers `.netrc`.

Change: the check tries every sample that the pattern matches, in list order,
and returns the first row that is on. A pattern passes only when no matching
sample has a row that is on.

### 6.4 Shared name-list helper

`hooks/stop-reminders.js` parses its variable in `namesSwitchedOff` and finds
unknown names in `unknownNameWarning`. protect-secrets needs the same two
steps. One small helper module provides them to both hooks:

- parse a variable's value into a list of names (split on commas, trim, lower
  case, drop empty entries). The helper keeps duplicates, in order;
- given the list and the known names, return the unknown names, in order,
  duplicates kept.

Each hook keeps its own message text and its own known names. stop-reminders
behaves exactly as before, including a repeated unknown name that its
warning lists twice; its existing tests are the check. protect-secrets
removes duplicates itself, both from the switched-off names and from the
unknown names that it reports. The plan chooses
the module's place and name; it must be reachable from `hooks/` and from
`hooks/safety/` with a relative `require`, and it must work on Node 16 and in
Git Bash like every other hook file.

### 6.5 Effect on the content scan

The content scan of Edit and Write skips paths that end in `.env` or
`.env.<suffix>` (`CONTENT_SCAN_ALLOWLIST`). This does not change. With
`env-file` off, a Write of a real key into `.env` passes and is not scanned.
This is correct: a `.env` file is where a real key belongs.

The skip covers only `.env` names. A file of another switched-off row, for
example `.envrc` or `~/.aws/credentials`, is still content-scanned. A Write
of a real key into it is refused by a `hardcoded-*` pattern. This is
intended: the content scan stays narrow and unchanged, and a user who wants
such a Write to pass switches off that pattern as well. The README states
this.

## 7. The hidden name and the report of unknown names

### 7.1 The hidden name

No refusal reason names the variable. A refusal reason goes to the model, and
a model that learns the switch could set it in a settings file to get past
its own refusal. The stop-reminder switch differs: its unknown-name warning
names `SUPERPOWERS_STOP_REMINDERS_OFF` in the block reason, which the model
reads. protect-secrets differs on purpose, because its refusal is the moment
at which a model looks for a way past a safety rule. stop-reminders is not
changed.

One existing refusal names the variable, and it stays. The name holds the
part `SECRETS`, so the rule `echo-secret-var` treats it as a secret
variable: `echo $SUPERPOWERS_SECRETS_RULES_OFF` and
`printenv SUPERPOWERS_SECRETS_RULES_OFF` are refused, and the reason names
the variable (checked against the current hook). Such a refusal reveals
nothing, because the refused command itself names the variable. The rule of
this section is therefore: no refusal reason names the variable unless the
refused command names it. A user checks the value in a terminal of their
own or in the settings file; `echo "${SUPERPOWERS_SECRETS_RULES_OFF:+set}"`
passes and shows only whether it is set.

Hiding the name is not enough on its own. The bracketed rule name of a
refusal is a search key: a model can search the installed plugin for
`env-file`, find the README text that explains the switch, and write the
settings file. So two texts tell an assistant not to do this:

- every protect-secrets refusal reason ends with one more sentence, which
  does not name the variable: "Never change Claude Code settings or hook
  files to get past this refusal; ask the user.";
- the README bullet and the guide entry that explain the switch state that
  only the user sets the variable, and that an assistant that reads the
  text after a refusal must ask the user instead of setting it.

These texts lower the chance of a self-unlock; they do not make it
impossible (section 11). Claude Code treats the `.claude` folder as a protected path: a write there
asks the user in the default and acceptEdits modes, and the classifier (the
model that Claude Code uses in auto mode to approve or refuse a tool call)
decides in auto mode (permission-modes page, "Protected paths").

### 7.2 Unknown names

When the variable holds at least one unknown name and one of protect-secrets'
own rules refuses a call, the hook:

- adds a `systemMessage` field to its output. The text names the variable,
  the unknown names (each once) and the 43 known names. The hooks page of
  the Claude Code documentation describes the field, in its table of JSON
  output fields, as "Warning message shown to the user", and adds that in
  Agent SDK and `--output-format stream-json` output it "can arrive as an
  SDKInformationalMessage";
- adds the unknown names to the refusal's log record, under a field whose
  name does not contain the variable's name.

A call that passes gets no message: the hook never refuses only to report an
unknown name, the same as stop-reminders. An `unreadable-command` refusal
carries no report either: it is produced before any rule runs (section 8),
and it is not a refusal that the switch can change.

The documentation does not say whether a PreToolUse `systemMessage` also
reaches the model. Probe 2 (section 9.2) decides it, by the decision rule
stated there. When probe 2 does not select the `systemMessage`, it is left
out and only the log record remains. In both cases the README tells the user
to check the log after changing the variable.

### 7.3 Shared output code

The output of a refusal is written by `runHook` in
`hooks/safety/hook-io.js`, which block-dangerous-commands also uses. The
change lets a decision carry the extra message and the extra log fields.
block-dangerous-commands sets neither, so its output and its log records stay
the same. Today's tests check only parts of a log record, so section 9.1
adds a case that pins one complete block-dangerous-commands refusal: its
output and the keys of its log record.

## 8. Error handling

- **No variable, or an empty value:** every rule is on, exactly as today.
- **Every name unknown:** every rule is on; the report of section 7.2 applies.
- **Internal error:** unchanged. Read, Edit, Write and Grep pass on an
  internal error and the error is logged; a Bash command is refused as
  `unreadable-command`. This holds only for code that runs inside the rules
  that `decideCommand` calls: the outer catch of `runHook`
  (`hooks/safety/hook-io.js`) lets every tool pass, Bash included.
  `decideCommand` first runs the shared reader (the code in
  `hooks/safety/shell-words.js` that splits a Bash command into its programs
  and words) and refuses the command as `unreadable-command` when the reader
  reports a problem; only then does it call the rules. Two requirements
  follow. (1) For Bash, the variable is read and parsed inside the rules
  that `decideCommand` calls, so that an error there refuses the command.
  (2) An error while building the extra message or the extra log fields of
  section 7.2 never turns a refusal into a pass: the plain refusal is
  written as before. Requirement (1) is checked in code review: reading an
  environment variable does not throw in practice. Requirement (2) gets a
  test (section 9.1): a fixture hook in the style of
  `tests/codex/fixtures/hook-that-throws.js` returns a refusal whose extra
  message or extra log field throws when it is read, and the output must be
  the plain refusal.
- **`unreadable-command` in the list:** an unknown name; it switches nothing
  off. An `unreadable-command` refusal itself carries no report (section
  7.2), so the user who copied that name sees the same refusal again. The
  README states that `unreadable-command` cannot be switched off and that
  the remedy is to split or rewrite the command.

## 9. Testing strategy

### 9.1 Automated tests

The suite is `bash tests/codex/run-unit-tests.sh`.

- **Isolation from the user's setting.** The test helper of the safety hooks
  (`tests/codex/safety-hook-helper.js`, `hookEnv`) removes
  `SUPERPOWERS_SECRETS_RULES_OFF` from the environment of every hook it runs,
  unless the case sets the variable in `extra` (the same rule as for
  `CLAUDE_PROJECT_DIR` today). Every test file that loads protect-secrets
  in-process (for example `tests/codex/test-pretool-bash-adapter.js`) clears
  the variable at its start. A user who sets the variable in `settings.json`
  passes it to every command the assistant runs (settings reference, `env`
  row: "Set environment variables for every session and its subprocesses";
  observed in this repository: a variable of the user's `env` block is
  visible to a Bash command). Without this the suites would fail for that
  user, as the stop-reminder suites did before v7.53.0 cleared their
  variable.
- **Output shape in the helper.** The helper's `runHook` accepts a refusal
  only when `hookSpecificOutput` is the one top-level key. It changes so
  that a case that expects an unknown-name report accepts a top-level
  `systemMessage` as well and returns it to the case. Every other case keeps
  the exact shape check, so a `systemMessage` that appears where it should
  not, for example in a block-dangerous-commands refusal, fails the suite.
- **Behavioural test.** `tests/claude-code/test-subagent-hook-scope.sh`
  expects an `echo-secret-var` refusal and runs with the user's own
  settings. With `echo-secret-var` switched off it would print a false
  safety conclusion ("Subagents bypass safety hooks"). The test does three
  things, and its header comment states why:
  - it unsets the variable in its own shell, for a value exported there;
  - each `claude` run passes
    `--settings '{"env":{"SUPERPOWERS_SECRETS_RULES_OFF":""}}'`. Claude
    Code reads the `env` block of a settings file itself, so a shell unset
    alone does not remove a value set in `settings.json`. The settings page
    ("Settings precedence") ranks command-line settings above local,
    project and user settings, and its `env` block follows the same levels;
    an empty value means every rule is on (section 8);
  - only managed settings rank above the command line. A new function next
    to `check_no_superpowers_defaults_setting` in
    `tests/claude-code/test-helpers.sh`, sharing its file-reading code,
    stops the test with a clear message when managed settings set the
    variable. The existing function and its list do not change, so
    `test-multi-code-review.sh` and `test-multi-doc-review.sh`, which do not
    depend on protect-secrets, keep running for users of the switch.
- **New cases for protect-secrets**, each run with the variable set only for
  that case:
  - one file row off (`env-file`): `cat .env`, `grep KEY .env`,
    `git add .env`, Read, Edit and Write of `.env`, Grep with path `.env` and
    with glob `*.env` all pass; Read of `.env.local` and of
    `.env.production` passes too, which pins the documented reach of the
    name (section 10); Read of `~/.ssh/id_rsa` is still refused;
  - the mixed command `cat .env ~/.ssh/id_rsa` with `env-file` off is refused
    as `ssh-private-key`;
  - overlapping rows: Read of `~/.ssh/id_rsa` with only `ssh-private-key` off
    is refused as `ssh-private-key-2`;
  - patterns: with `env-file` and `envrc` off, `cat .*` is still refused (by
    the `.netrc` sample) and `cat *.env` passes;
  - the pattern limit of section 6.2: with only `ssh-private-key` off,
    `cat ~/.ssh/id_*` passes; the case pins the documented limit;
  - one content pattern off: for the Write of `src/config.js` (outside the
    content-scan skip of section 6.5), a value that matches only
    `hardcoded-github-token` passes with that pattern off, and a value that
    matches only `hardcoded-stripe-key` is still refused. The plan checks
    that each chosen value matches exactly one pattern;
  - `env-dump` off: bare `env` passes, `echo $API_KEY` is still refused;
    `echo-secret-var` off: the reverse;
  - parsing: `' Env-File , envrc '` switches off both rows;
  - unknown names: `env_file` and `unreadable-command` switch nothing off; a
    refused call carries the unknown names in its message (or, after probe 2,
    in its log record only); a call that passes carries no message;
  - the hidden name: the helper's `runHook` checks every refusal reason it
    receives, for every case and every fixture, and fails when a reason
    contains `SUPERPOWERS_SECRETS_RULES_OFF` while the refused input does
    not (section 7.1). Each test file that gets refusals in-process (without
    the helper) makes the same check on each refusal reason it reads. One
    case pins the allowed exception: `echo $SUPERPOWERS_SECRETS_RULES_OFF`
    is refused as `echo-secret-var`;
- **Pins for "unchanged" claims.** Two new cases make the claims of
  sections 6.4 and 7.3 testable, because today's tests do not check them:
  - one block-dangerous-commands refusal: its output equals the expected
    object exactly, and its log record has exactly the expected keys;
  - stop-reminders with a repeated unknown name (`foo,foo`): its warning
    lists the name twice, as today.
- **Fail-closed output.** The fixture hook of section 8 requirement (2)
  shows that a throwing extra field still yields the plain refusal, for a
  Bash command and for a Read.
- **Refusal text.** Every protect-secrets refusal reason ends with the
  sentence of section 7.1; the existing message checks of
  `tests/codex/test-protect-secrets.js` are updated to expect it.
- **Every existing case** of `tests/codex/test-protect-secrets.js`,
  `tests/codex/test-block-dangerous-commands.js`,
  `tests/codex/test-stop-reminders.js`, `tests/codex/test-stop-adapter.js`
  and `tests/codex/test-pretool-bash-adapter.js` passes unchanged.
- **The shared helper** has its own unit tests: comma splitting, spaces,
  letter case, empty entries, duplicates kept in order, unknown names in
  order. A protect-secrets case checks that a repeated unknown name is
  reported once.

### 9.2 Live probes

These run against a real Claude Code CLI, in an empty scratch folder with no
git remote, with the branch's plugin loaded through `--plugin-dir`.

Common setup of both probes:

- **Permission mode.** Each run uses `--permission-mode bypassPermissions`,
  as `tests/claude-code/test-subagent-hook-scope.sh` does, so that no
  permission prompt is needed for the Bash call. The permission-modes page
  says that a few calls are still refused in this mode; the outcome rules
  below cover a run in which the call does not happen.
- **The real HOME.** The runs keep the user's HOME: with HOME set to an
  empty folder, headless Claude Code is not logged in and makes no model
  call (observed by a spec reviewer with Claude Code 2.1.295: "Not logged
  in · Please run /login", exit status 1). The hook log of a run is
  therefore the shared folder `~/.claude/hooks-logs/`, whose files are named
  by the UTC date (`hooks/safety/hook-io.js` uses
  `new Date().toISOString().slice(0, 10)`). The probe reads every file of
  the folder and selects the run's records by the `session_id` field, which
  every refusal record carries. The session id of a run is in the `init`
  event of its stream-json output.
- **The user's own setting.** The probe uses the setup of the behavioural
  test of section 9.1: it unsets the variable in its shell, stops when
  managed settings set it (the new function of section 9.1), and passes the
  variable in every run with `--settings`, which ranks above local, project
  and user settings. The flag accepts an inline JSON string; the hooks page
  shows `--settings '{"disableAllHooks": true}'`.
- **Valid run.** A run counts only when (1) the `init` event of its
  stream-json output lists the plugin loaded from the branch checkout, not
  the installed copy, and (2) the stream-json output holds a Bash tool call
  whose command is exactly `cat .env` (for a subagent's call, the Bash call
  is looked for in the subagent's transcript). A run that misses either condition
  is inconclusive. Condition (1) catches the states in which the installed
  copy loads instead of the branch (the plugins page, "Name conflicts");
  condition (2) catches a model that read the file in another way.
- **Random tokens** are made of lower-case letters and digits only (for
  example the output of `openssl rand -hex 8`), because the hook lower-cases
  names. Every search for a token ignores letter case.

- **Probe 1 — the variable reaches the hook.** Claude Code's documentation
  does not state that a value of the settings `env` block reaches a hook
  process. The scratch folder holds a dummy `.env` file whose only content
  is a random marker token. Two headless runs ask the model to run
  `cat .env` with the Bash tool. Run A passes
  `--settings '{"env":{"SUPERPOWERS_SECRETS_RULES_OFF":""}}'`; run B passes
  `--settings '{"env":{"SUPERPOWERS_SECRETS_RULES_OFF":"env-file"}}'`. Each
  run is judged by two signals, never by the model's own account:
  - **record:** the hook log holds a `BLOCKED` record with `id: env-file`
    and the run's session id;
  - **marker:** a tool result in the stream-json output holds the marker
    token.

  A run that holds a record counts as "record", whether or not it also holds
  the marker: the model can reach a file through a form that the hook lets
  through by design (README limits, for example interpreter code).

  | Run A | Run B | Outcome |
  |---|---|---|
  | record | marker, no record | pass: the variable reaches the hook through `--settings` |
  | record | record | fail: the plan stops and reports that a value passed with `--settings` does not reach the hook |
  | no record, no marker | any | inconclusive: the model made no matching call; repeat both runs once |
  | marker, no record | any | fail: the hook did not refuse in run A; the plan stops and reports that the plugin is not loaded |
  | record | no record, no marker | inconclusive: repeat run B once |

  A second inconclusive result stops the plan and reports both stream-json
  outputs to the user. The probe tests the `--settings` channel. That the
  `env` block of `~/.claude/settings.json` behaves the same is not verified
  live; the settings page lists both as sources of the same settings.
- **Probe 2 — where the `systemMessage` of a refusal appears.** The variable
  holds one unknown name made of a random token, and the hook refuses
  `cat .env`. The probe makes the refusal happen in two kinds of call,
  because most tool calls of this plugin's orchestrated work are made by
  subagents, and the hooks page says that PreToolUse fires for a subagent's
  call too ("When a subagent calls a tool, tool events such as `PreToolUse`
  and `PostToolUse` fire the same configured hooks as in the main
  conversation") without saying where its `systemMessage` goes:
  - a call of the main session;
  - a call of a subagent that the Agent tool starts, with the dispatch
    prompt of `tests/claude-code/test-subagent-hook-scope.sh`.

  Each kind runs a second turn too (`claude -p --resume <session id>` with
  the same token-listing request), in case a message reaches the model only
  with the next turn. Two questions are answered for each kind of call:
  - **(b) Can the model read the message?** Two observations: the prompt
    asks the model to list every unexplained token in its context, without
    naming the token, after each turn; and the session transcripts (the
    `.jsonl` file of the run under `~/.claude/projects/`, and every file in
    that session's `subagents/` folder) are searched for the token. The
    transcript is not the model's context: it also stores records that only
    the user interface shows (`system` records such as usage-limit notices)
    and the raw output of each hook (`hook_success` attachments, observed by
    two spec reviewers). A transcript hit therefore counts only inside
    content sent to the model: the `message.content` of a `user` or
    `assistant` record (tool results included), or an attachment record of
    another type. A hit only in a `system` record or in a `hook_success`
    attachment does not count. The probe report lists the type of every
    record that holds the token. The model can read the message when either
    counted observation finds the token.
  - **(a) Is the user shown the message?** The user runs one interactive
    session with the same setting, triggers one refusal in the main session
    and one in a subagent, and reports for each whether the message appears
    on the screen. The stream-json output is recorded too, but it does not
    decide (a): the hooks page says a `systemMessage` can arrive there as an
    SDKInformationalMessage, which says nothing about the terminal.

  Decision rule: the `systemMessage` ships only when, for both kinds of
  call, (b) finds the token nowhere and the user confirms (a). In every
  other case, including when the user does not make the interactive check,
  only the log record of section 7.2 ships. Even when the message ships,
  the README keeps the instruction to check the log after a change.

## 10. Documentation and release

- **README.md:** the environment-variable section gets the variable: its
  format, the 43 names grouped as in section 5, and the restart facts of
  section 4, consistent with the section's existing sentence "a changed
  value takes effect after the CLI is restarted". The count sentence "The
  remaining three are read by hook code directly" becomes four. The
  protect-secrets bullet names the switch, the overlap rule and the pattern
  limit of section 6.2, the content-scan behaviour of section 6.5, the trust
  note of section 11, and that names from block-dangerous-commands refusals
  switch nothing off. It also states:
  - what each name covers. In particular, `env-file` covers `.env` and every
    `.env.<suffix>` file except the template names (`.env.example`,
    `.env.sample`, `.env.template`, `.env.schema`, `.env.defaults`): with it
    off, `.env.local` and `.env.production` pass too. A `hardcoded-*` name
    turns that pattern off for every file that the content scan reads;
  - that a value set at a higher settings level replaces a lower one: the
    lists are not merged. A project's `.claude/settings.json` that sets the
    variable, even to an empty value, replaces the user's own list in that
    project;
  - that `unreadable-command` cannot be switched off (section 8);
  - the instruction to assistants of section 7.1.
- **docs/guide/README.md:** the Troubleshooting section gets an entry next to
  the stop-reminder entry: a protect-secrets refusal of a file that holds no
  secret, and how to switch off its rule. The entry names two places to find
  the rule name: the refusal text in square brackets, and the `id` field of
  the refusal record in `~/.claude/hooks-logs/<date>.jsonl`, where `<date>`
  is the UTC date of the refusal. The hooks page
  (PreToolUse decision control) says that the reason of a `deny` is "shown
  to Claude"; whether the user also sees it, in particular for a call that a
  subagent made, is not documented and not verified. The log therefore
  serves as the place that always holds the name. The entry says to restart
  the CLI after a change, like the stop-reminder entry. It repeats the reach
  of `env-file` (every `.env.<suffix>` file), and the instruction to
  assistants of section 7.1.
- **RELEASE-NOTES.md:** a v7.70.0 entry with the three-line summary.
- **Version bump** in every file that `CLAUDE.md` lists under Releases.

## 11. Limits

These failure modes were found in the failure-mode check (the step of
brainstorming that tries to break a design before it is approved) and in
the spec review, and were accepted:

- **Overlapping rules** (section 6.2): a user must switch off every rule
  that covers a file or a value. Each refusal names the next rule.
- **A pattern that only a switched-off row matched as text** (section 6.2):
  with `ssh-private-key` off, `cat ~/.ssh/id_*` passes, although
  `ssh-private-key-2` still refuses `cat ~/.ssh/id_rsa`.
- **Content scan of other switched-off rows** (section 6.5): a file other
  than `.env` stays content-scanned.
- **Project settings:** a variable set in a committed `.claude/settings.json`
  switches a rule off for everyone who clones the project, once each of them
  trusts the folder. The settings page says that "most `env` values apply
  only after each teammate trusts the folder". A project's settings file
  can already define hooks that run any command, so the switch adds no new
  trust.
- **A name reaches further than one file.** `env-file` covers every
  `.env.<suffix>` file. A project that keeps harmless defaults in `.env`
  and real secrets in `.env.local` opens both when it switches off
  `env-file`. The README says so (section 10); the finer tool would be the
  path allow-list, a non-goal of this design (section 3).
- **Self-unlock by the model.** In bypassPermissions mode Claude Code
  allows writes to the `.claude` folder without asking (permission-modes
  page, "Protected paths" table: `bypassPermissions` — "Allowed"); in auto
  mode the classifier decides. So a model can set the variable. It can
  equally write `disableAllHooks` into the same file, so the switch adds no
  new capability (an inference from the same table, not tested). The switch
  does make a self-unlock more likely: it is a narrow, documented remedy
  indexed by the rule name that a refusal shows, so it looks legitimate. The
  model can also find the name without the README: `compgen -e` lists
  exported variable names, and with `env-dump` switched off a bare `env`
  prints the variable. The texts of section 7.1 lower this risk; they do not
  remove it.
- **Deleting the whole variable** from the settings file has no effect
  until a CLI restart (section 4).
- **The hidden name is not secret.** The README documents the variable, and
  a model can read the README. The rule of section 7.1 only keeps the name out
  of the refusal, the moment at which a model is looking for a way past it.
